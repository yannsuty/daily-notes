import { OPENROUTER_FREE_ROUTER } from './openrouter-fallback.js';
import type { FallbackResult, OpenRouterBody } from './openrouter-fallback.js';

export const MEGASERVEUR_DEFAULT_MODEL = 'tinyllama';
export const MEGASERVEUR_TIMEOUT_MS = 55_000;
export const MEGASERVEUR_RETRY_BACKOFF_MS = 500;

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 529]);

export function megaserveurBaseUrl(): string | undefined {
  const raw = process.env.MEGASERVEUR_AI_BASE_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/$/, '');
}

export function megaserveurApiKey(): string | undefined {
  return process.env.MEGASERVEUR_AI_API_KEY?.trim() || undefined;
}

export function isMegaserveurConfigured(): boolean {
  return !!(megaserveurBaseUrl() && megaserveurApiKey());
}

export function resolveMegaserveurModel(requested?: string): string {
  const fallback =
    process.env.MEGASERVEUR_DEFAULT_MODEL?.trim() || MEGASERVEUR_DEFAULT_MODEL;
  const model = requested?.trim();
  if (!model || model === OPENROUTER_FREE_ROUTER) return fallback;
  return model;
}

function extractContent(payload: string): string | null {
  try {
    const data = JSON.parse(payload) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callMegaserveurChat(
  body: OpenRouterBody,
  options?: { fetchImpl?: typeof fetch },
): Promise<FallbackResult> {
  const baseUrl = megaserveurBaseUrl();
  const apiKey = megaserveurApiKey();
  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      status: 503,
      payload: JSON.stringify({
        error: { message: 'MEGASERVEUR_AI_BASE_URL / MEGASERVEUR_AI_API_KEY not configured' },
      }),
      triedModels: [],
      retryable: false,
    };
  }

  const fetchFn = options?.fetchImpl ?? fetch;
  const model = resolveMegaserveurModel(body.model);
  const triedModels = [model];
  let lastStatus = 0;
  let lastPayload = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEGASERVEUR_TIMEOUT_MS);

    try {
      const upstream = await fetchFn(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: body.messages,
          temperature: body.temperature ?? 0.4,
          stream: false,
          ...(body.response_format ? { response_format: body.response_format } : {}),
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      lastStatus = upstream.status;
      lastPayload = await upstream.text();

      if (upstream.ok) {
        const content = extractContent(lastPayload);
        if (content) {
          return {
            ok: true,
            status: upstream.status,
            payload: lastPayload,
            modelUsed: model,
            triedModels,
          };
        }
        lastStatus = 502;
        lastPayload = JSON.stringify({ error: { message: 'Empty response from model' } });
      }

      if (!TRANSIENT_STATUSES.has(upstream.status) || attempt >= 1) {
        return {
          ok: false,
          status: upstream.status,
          payload: lastPayload,
          triedModels,
          retryable: TRANSIENT_STATUSES.has(upstream.status),
        };
      }

      await sleep(MEGASERVEUR_RETRY_BACKOFF_MS);
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      lastStatus = isAbort ? 408 : 503;
      lastPayload = JSON.stringify({
        error: { message: isAbort ? 'Request timeout' : 'Network error' },
      });

      if (attempt < 1) {
        await sleep(MEGASERVEUR_RETRY_BACKOFF_MS);
        continue;
      }
    }
  }

  return {
    ok: false,
    status: lastStatus || 503,
    payload: lastPayload,
    triedModels,
    retryable: true,
  };
}
