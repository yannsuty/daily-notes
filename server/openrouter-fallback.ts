export const OPENROUTER_FREE_ROUTER = 'openrouter/free';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const AI_TIMEOUT_MS = 25_000;
export const AI_RETRY_BACKOFF_MS = 500;

export interface OpenRouterBody {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  response_format?: { type: string };
}

export interface FallbackResult {
  ok: boolean;
  status: number;
  payload: string;
  modelUsed?: string;
  triedModels: string[];
  retryable?: boolean;
}

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 529]);
const PERMANENT_STATUSES = new Set([400, 401, 403, 413]);

export function parseModelChain(envChain?: string): string[] {
  const raw = envChain?.trim();
  if (!raw) return [OPENROUTER_FREE_ROUTER];
  const models = raw.split(',').map((m) => m.trim()).filter(Boolean);
  return models.length > 0 ? models : [OPENROUTER_FREE_ROUTER];
}

function buildModelChain(requestedModel: string, envChain?: string): string[] {
  const chain = parseModelChain(envChain);
  if (requestedModel && !chain.includes(requestedModel)) {
    return [requestedModel, ...chain];
  }
  return chain;
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

export async function callOpenRouterWithFallback(
  apiKey: string,
  body: OpenRouterBody,
  options: {
    referer: string;
    envChain?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<FallbackResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const models = buildModelChain(body.model, options.envChain);
  const triedModels: string[] = [];
  let lastStatus = 0;
  let lastPayload = '';

  for (const model of models) {
    triedModels.push(model);
    let attempts = 0;

    while (attempts < 2) {
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

      try {
        const upstream = await fetchFn(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': options.referer,
            'X-Title': 'Merlin',
          },
          body: JSON.stringify({
            model,
            messages: body.messages,
            temperature: body.temperature ?? 0.4,
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

        if (PERMANENT_STATUSES.has(upstream.status)) {
          return {
            ok: false,
            status: upstream.status,
            payload: lastPayload,
            triedModels,
            retryable: false,
          };
        }

        if (TRANSIENT_STATUSES.has(upstream.status) && attempts < 2) {
          await sleep(AI_RETRY_BACKOFF_MS);
          continue;
        }

        if (upstream.status === 404) {
          break;
        }

        if (TRANSIENT_STATUSES.has(upstream.status)) {
          break;
        }

        return {
          ok: false,
          status: upstream.status,
          payload: lastPayload,
          triedModels,
          retryable: false,
        };
      } catch (err) {
        clearTimeout(timer);
        const isAbort = err instanceof Error && err.name === 'AbortError';
        lastStatus = isAbort ? 408 : 503;
        lastPayload = JSON.stringify({
          error: { message: isAbort ? 'Request timeout' : 'Network error' },
        });

        if (attempts < 2) {
          await sleep(AI_RETRY_BACKOFF_MS);
          continue;
        }
        break;
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
