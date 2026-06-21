import { apiUrl } from './api-base';
import { getAiClientConfig } from './merlin-env';
import type {
  AgentContext,
  AgentJobPollResponse,
  AgentJobStartResponse,
  AgentRunResult,
  AgentStep,
} from '../lib/merlin-agent';
import { sleep } from '../lib/retry-backoff';

export interface RunServerAgentOptions {
  onStep?: (step: AgentStep) => void;
  stream?: boolean;
  background?: boolean;
  jobId?: string;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

const POLL_INTERVAL_MS = 2000;

async function readNdjsonStream(
  response: Response,
  onStep: (step: AgentStep) => void,
): Promise<AgentRunResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Flux de réponse indisponible');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: AgentRunResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const event = JSON.parse(trimmed) as
        | { type: 'step'; step: AgentStep }
        | { type: 'done'; result: AgentRunResult }
        | { type: 'error'; error: string };

      if (event.type === 'step') {
        onStep(event.step);
      } else if (event.type === 'done') {
        finalResult = event.result;
      } else if (event.type === 'error') {
        throw new Error(event.error);
      }
    }
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer.trim()) as { type: 'done'; result: AgentRunResult };
    if (event.type === 'done') {
      finalResult = event.result;
    }
  }

  if (!finalResult) {
    throw new Error('Réponse agent incomplète');
  }

  return finalResult;
}

export async function startBackgroundAgentJob(
  message: string,
  context: AgentContext,
  jobId?: string,
): Promise<AgentJobStartResponse> {
  const clientConfig = await getAiClientConfig();

  const response = await fetch(apiUrl('/api/merlin-agent'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      context,
      background: true,
      jobId,
      config: {
        apiKey: clientConfig.apiKey,
        modelChain: clientConfig.modelChain,
        model: clientConfig.model,
      },
    }),
  });

  if (!response.ok) {
    let detail = `Erreur serveur (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return (await response.json()) as AgentJobStartResponse;
}

export async function pollAgentJob(
  jobId: string,
  options?: {
    onStep?: (step: AgentStep) => void;
    pollIntervalMs?: number;
    signal?: AbortSignal;
    lastStepCount?: number;
  },
): Promise<AgentRunResult> {
  const interval = options?.pollIntervalMs ?? POLL_INTERVAL_MS;
  let seenSteps = options?.lastStepCount ?? 0;

  while (!options?.signal?.aborted) {
    const response = await fetch(apiUrl(`/api/merlin-agent?jobId=${encodeURIComponent(jobId)}`), {
      signal: options?.signal,
    });

    if (response.status === 404) {
      throw new Error('Job introuvable ou expiré');
    }

    if (!response.ok) {
      let detail = `Erreur serveur (${response.status})`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        // ignore
      }
      throw new Error(detail);
    }

    const body = (await response.json()) as AgentJobPollResponse;

    if (body.steps.length > seenSteps) {
      for (let i = seenSteps; i < body.steps.length; i += 1) {
        options?.onStep?.(body.steps[i]);
      }
      seenSteps = body.steps.length;
    }

    if (body.status === 'done' && body.result) {
      return body.result;
    }

    if (body.status === 'error') {
      return {
        ok: false,
        error: body.error ?? 'Erreur agent',
        steps: body.steps,
        mutations: {},
        depth: 'standard',
      };
    }

    await sleep(interval);
  }

  throw new DOMException('Polling interrompu', 'AbortError');
}

export async function runServerAgent(
  message: string,
  context: AgentContext,
  options?: RunServerAgentOptions,
): Promise<AgentRunResult> {
  if (options?.background) {
    const started = await startBackgroundAgentJob(message, context, options.jobId);
    return pollAgentJob(started.jobId, {
      onStep: options.onStep,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
    });
  }

  const clientConfig = await getAiClientConfig();
  const stream = options?.stream ?? !!options?.onStep;

  const response = await fetch(apiUrl('/api/merlin-agent'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      context,
      stream,
      config: {
        apiKey: clientConfig.apiKey,
        modelChain: clientConfig.modelChain,
        model: clientConfig.model,
      },
    }),
    signal: options?.signal,
  });

  if (!response.ok && !stream) {
    let detail = `Erreur serveur (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // ignore
    }
    return {
      ok: false,
      error: detail,
      steps: [],
      mutations: {},
      depth: 'standard',
    };
  }

  if (stream && options?.onStep) {
    if (!response.ok) {
      throw new Error(`Erreur serveur (${response.status})`);
    }
    return readNdjsonStream(response, options.onStep);
  }

  const result = (await response.json()) as AgentRunResult;
  if (result.steps) {
    for (const step of result.steps) {
      options?.onStep?.(step);
    }
  }
  return result;
}

export function stepLabelForUi(step: AgentStep): string {
  return step.detail ? `${step.label} — ${step.detail}` : step.label;
}
