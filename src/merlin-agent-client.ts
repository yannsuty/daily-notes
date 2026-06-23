import { apiUrl } from './api-base';
import { getAiClientConfig } from './merlin-env';
import type {
  AgentContext,
  AgentJobPollResponse,
  AgentJobStartResponse,
  AgentRunResult,
  AgentStep,
} from '../lib/merlin-agent';

export interface RunServerAgentOptions {
  onStep?: (step: AgentStep) => void;
  stream?: boolean;
  background?: boolean;
  jobId?: string;
  signal?: AbortSignal;
}

type AgentJobSseOutcome =
  | { kind: 'done'; result: AgentRunResult }
  | { kind: 'error'; error: string; steps?: AgentStep[] }
  | { kind: 'reconnect'; fromStep: number };

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

async function readAgentJobSseStream(
  response: Response,
  options: {
    onStep?: (step: AgentStep) => void;
    signal?: AbortSignal;
  },
): Promise<AgentJobSseOutcome> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Flux de réponse indisponible');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';

  while (true) {
    if (options.signal?.aborted) {
      throw new DOMException('Flux interrompu', 'AbortError');
    }

    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd === -1) break;

      let line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 1);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }

      if (line === '') {
        currentEvent = 'message';
        continue;
      }

      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
        continue;
      }

      if (!line.startsWith('data:')) {
        continue;
      }

      const payload = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;

      if (currentEvent === 'step' && payload.step) {
        options.onStep?.(payload.step as AgentStep);
        continue;
      }

      if (currentEvent === 'done' && payload.result) {
        return { kind: 'done', result: payload.result as AgentRunResult };
      }

      if (currentEvent === 'error') {
        return {
          kind: 'error',
          error: (payload.error as string) ?? 'Erreur agent',
          steps: payload.steps as AgentStep[] | undefined,
        };
      }

      if (currentEvent === 'reconnect') {
        return {
          kind: 'reconnect',
          fromStep: (payload.fromStep as number) ?? 0,
        };
      }
    }
  }

  throw new Error('Flux SSE incomplet');
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

/** Lecture ponctuelle de l'état d'un job (sans SSE) — utile au retour en premier plan. */
export async function getAgentJobStatus(jobId: string): Promise<AgentJobPollResponse> {
  const response = await fetch(
    apiUrl(`/api/merlin-agent?jobId=${encodeURIComponent(jobId)}`),
    { headers: { Accept: 'application/json' } },
  );

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

  return (await response.json()) as AgentJobPollResponse;
}

export async function watchAgentJob(
  jobId: string,
  options?: {
    onStep?: (step: AgentStep) => void;
    signal?: AbortSignal;
    fromStep?: number;
  },
): Promise<AgentRunResult> {
  let fromStep = options?.fromStep ?? 0;

  while (!options?.signal?.aborted) {
    const response = await fetch(
      apiUrl(
        `/api/merlin-agent?jobId=${encodeURIComponent(jobId)}&stream=1&fromStep=${fromStep}`,
      ),
      {
        signal: options?.signal,
        headers: { Accept: 'text/event-stream' },
      },
    );

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

    const outcome = await readAgentJobSseStream(response, {
      onStep: (step) => {
        fromStep += 1;
        options?.onStep?.(step);
      },
      signal: options?.signal,
    });

    if (outcome.kind === 'reconnect') {
      fromStep = outcome.fromStep;
      continue;
    }

    if (outcome.kind === 'error') {
      return {
        ok: false,
        error: outcome.error,
        steps: outcome.steps ?? [],
        mutations: {},
        depth: 'standard',
      };
    }

    return outcome.result;
  }

  throw new DOMException('Flux interrompu', 'AbortError');
}

/** @deprecated Utiliser watchAgentJob (SSE). */
export const pollAgentJob = watchAgentJob;

export async function runServerAgent(
  message: string,
  context: AgentContext,
  options?: RunServerAgentOptions,
): Promise<AgentRunResult> {
  if (options?.background) {
    const started = await startBackgroundAgentJob(message, context, options.jobId);
    return watchAgentJob(started.jobId, {
      onStep: options.onStep,
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
