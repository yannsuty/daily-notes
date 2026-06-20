import { apiUrl } from './api-base';
import { getAiClientConfig } from './merlin-env';
import { OPENROUTER_FREE_ROUTER } from '../lib/openrouter-fallback';

export { OPENROUTER_FREE_ROUTER };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiClientConfigPayload {
  apiKey?: string;
  modelChain?: string;
}

export interface AiResult {
  ok: boolean;
  text?: string;
  error?: string;
  modelUsed?: string;
  degraded?: boolean;
  retryable?: boolean;
}

export const LLM_UNAVAILABLE_MSG =
  "Je n'arrive pas à répondre pour l'instant. Tes listes et rappels fonctionnent toujours.";

async function formatAiError(response: Response, model: string, body?: unknown): Promise<string> {
  let errBody = '';
  try {
    errBody = await response.text();
  } catch {
    errBody = '';
  }

  if (body && typeof body === 'object' && body !== null && 'error' in body) {
    const err = (body as { error?: { message?: string } | string }).error;
    if (typeof err === 'string') return err;
    if (err?.message) return err.message;
  }

  let detail = errBody.slice(0, 160);
  try {
    const parsed = JSON.parse(errBody) as { error?: { message?: string } | string };
    if (typeof parsed.error === 'string') detail = parsed.error;
    else if (parsed.error?.message) detail = parsed.error.message;
  } catch {
    // keep raw snippet
  }
  if (response.status === 404) {
    detail = `Modèle introuvable (${model}).`;
  }
  if (response.status === 503) {
    detail = 'Service IA indisponible.';
  }
  return `API erreur ${response.status}: ${detail}`;
}

async function fetchCompletion(
  body: Record<string, unknown>,
): Promise<{ response: Response; data?: unknown }> {
  const response = await fetch(apiUrl('/api/ai'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let data: unknown;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
  }

  return { response, data };
}

export async function chatCompletion(
  messages: ChatMessage[],
  options?: { temperature?: number; jsonMode?: boolean; model?: string },
): Promise<AiResult> {
  const clientConfig = await getAiClientConfig();
  const model =
    options?.model ?? clientConfig.model ?? OPENROUTER_FREE_ROUTER;

  const configPayload: AiClientConfigPayload = {};
  if (clientConfig.apiKey) configPayload.apiKey = clientConfig.apiKey;
  if (clientConfig.modelChain) configPayload.modelChain = clientConfig.modelChain;

  const body: Record<string, unknown> = {
    model,
    temperature: options?.temperature ?? 0.4,
    messages,
    ...(Object.keys(configPayload).length > 0 ? { config: configPayload } : {}),
  };

  if (options?.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  try {
    let { response, data } = await fetchCompletion(body);

    if (!response.ok) {
      const errData = data as { retryable?: boolean } | undefined;
      if (response.status === 503 && errData?.retryable) {
        await new Promise((r) => setTimeout(r, 2000));
        ({ response, data } = await fetchCompletion(body));
      }

      if (!response.ok) {
        const retryable =
          response.status === 503 ||
          (data as { retryable?: boolean } | undefined)?.retryable === true;
        return {
          ok: false,
          error: await formatAiError(response, model, data),
          retryable,
        };
      }
    }

    const modelUsed = response.headers.get('X-Merlin-Model-Used') ?? undefined;
    const payload = data as {
      choices?: { message?: { content?: string } }[];
    };
    const text = payload?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return { ok: false, error: 'Réponse vide de l\'API.', retryable: true };
    }
    return { ok: true, text, modelUsed };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Erreur réseau',
      retryable: true,
    };
  }
}

export async function withAiFallback<T>(
  task: () => Promise<AiResult>,
  degrade: () => T,
): Promise<{ ok: true; value: string } | { ok: false; degraded: T; error?: string }> {
  const result = await task();
  if (result.ok && result.text) {
    return { ok: true, value: result.text };
  }
  return { ok: false, degraded: degrade(), error: result.error };
}

export function parseJsonFromAi<T>(raw: string): T | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim()) as T;
      } catch {
        return null;
      }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
