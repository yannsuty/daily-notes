export type AiProvider = 'openrouter' | 'openai' | 'custom';

export interface AiConfig {
  provider: AiProvider;
  model: string;
  baseUrl?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiResult {
  ok: boolean;
  text?: string;
  error?: string;
}

const PROVIDER_KEY = 'daily-note-ai-provider';
const MODEL_KEY = 'daily-note-ai-model';
const BASE_URL_KEY = 'daily-note-ai-base-url';
const API_KEY_KEY = 'daily-note-merlin-api-key';

export const OPENROUTER_FREE_ROUTER = 'openrouter/free';

const DEFAULT_MODELS: Record<AiProvider, string> = {
  openrouter: OPENROUTER_FREE_ROUTER,
  openai: 'gpt-4o-mini',
  custom: '',
};

/** Modèles gratuits retirés ou renommés par OpenRouter */
const DEPRECATED_OPENROUTER_MODELS = new Set([
  'google/gemma-2-9b-it:free',
  'google/gemma-3-4b-it:free',
  'google/gemma-3-12b-it:free',
  'google/gemma-3-27b-it:free',
]);

const ENDPOINTS: Record<Exclude<AiProvider, 'custom'>, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
};

export function storeAiApiKey(key: string): void {
  localStorage.setItem(API_KEY_KEY, key);
}

export function getStoredAiApiKey(): string | null {
  return localStorage.getItem(API_KEY_KEY);
}

export function clearStoredAiApiKey(): void {
  localStorage.removeItem(API_KEY_KEY);
}

export function storeAiConfig(config: Partial<AiConfig>): void {
  if (config.provider) localStorage.setItem(PROVIDER_KEY, config.provider);
  if (config.model !== undefined) localStorage.setItem(MODEL_KEY, config.model);
  if (config.baseUrl !== undefined) localStorage.setItem(BASE_URL_KEY, config.baseUrl);
}

export function getAiConfig(): AiConfig {
  const storedProvider = localStorage.getItem(PROVIDER_KEY) as AiProvider | null;
  const apiKey = getStoredAiApiKey();
  const provider =
    storedProvider ??
    (apiKey?.startsWith('sk-or-') ? 'openrouter' : apiKey?.startsWith('sk-') ? 'openai' : 'openrouter');
  const modelRaw = localStorage.getItem(MODEL_KEY) ?? DEFAULT_MODELS[provider];
  if (provider === 'openrouter' && DEPRECATED_OPENROUTER_MODELS.has(modelRaw)) {
    localStorage.setItem(MODEL_KEY, DEFAULT_MODELS.openrouter);
  }
  const model =
    provider === 'openrouter' && DEPRECATED_OPENROUTER_MODELS.has(modelRaw)
      ? DEFAULT_MODELS.openrouter
      : modelRaw;
  const baseUrl = localStorage.getItem(BASE_URL_KEY) ?? '';
  return { provider, model, baseUrl: baseUrl || undefined };
}

export function getDefaultModel(provider: AiProvider): string {
  return DEFAULT_MODELS[provider];
}

export function isAiConfigured(): boolean {
  if (getStoredAiApiKey()) return true;
  return getAiConfig().provider === 'openrouter';
}

function usesOpenRouterProxy(config: AiConfig): boolean {
  return config.provider === 'openrouter' && !getStoredAiApiKey();
}

async function chatViaOpenRouterProxy(
  model: string,
  messages: ChatMessage[],
  options?: { temperature?: number; jsonMode?: boolean },
): Promise<AiResult> {
  const body: Record<string, unknown> = {
    model,
    temperature: options?.temperature ?? 0.4,
    messages,
  };

  if (options?.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { ok: false, error: await formatAiError(response, model) };
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return { ok: false, error: 'Réponse vide de l\'API.' };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur réseau' };
  }
}

async function formatAiError(response: Response, model: string): Promise<string> {
  const errBody = await response.text();
  let detail = errBody.slice(0, 160);
  try {
    const parsed = JSON.parse(errBody) as { error?: { message?: string } | string };
    if (typeof parsed.error === 'string') detail = parsed.error;
    else if (parsed.error?.message) detail = parsed.error.message;
  } catch {
    // keep raw snippet
  }
  if (response.status === 404) {
    detail = `Modèle introuvable (${model}). Utilisez ${OPENROUTER_FREE_ROUTER} dans Réglages (sélection auto d'un modèle gratuit).`;
  }
  return `API erreur ${response.status}: ${detail}`;
}

function resolveEndpoint(config: AiConfig): string | null {
  if (config.provider === 'custom') {
    const url = config.baseUrl?.trim();
    if (!url) return null;
    return url.replace(/\/+$/, '');
  }
  return ENDPOINTS[config.provider];
}

export async function chatCompletion(
  messages: ChatMessage[],
  options?: { temperature?: number; jsonMode?: boolean },
): Promise<AiResult> {
  const config = getAiConfig();
  const model = config.model.trim() || DEFAULT_MODELS[config.provider];
  if (!model) {
    return { ok: false, error: 'Modèle non configuré.' };
  }

  if (usesOpenRouterProxy(config)) {
    return chatViaOpenRouterProxy(model, messages, options);
  }

  const apiKey = getStoredAiApiKey();
  if (!apiKey) {
    return { ok: false, error: 'Clé API non configurée.' };
  }

  const endpoint = resolveEndpoint(config);
  if (!endpoint) {
    return { ok: false, error: 'URL de l\'API personnalisée manquante.' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = window.location.origin;
    headers['X-Title'] = 'Daily Note';
  }

  const body: Record<string, unknown> = {
    model,
    temperature: options?.temperature ?? 0.4,
    messages,
  };

  if (options?.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  try {
    let activeModel = model;
    let response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, model: activeModel }),
    });

    if (
      response.status === 404 &&
      config.provider === 'openrouter' &&
      activeModel !== OPENROUTER_FREE_ROUTER
    ) {
      activeModel = OPENROUTER_FREE_ROUTER;
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, model: activeModel }),
      });
    }

    if (!response.ok) {
      return { ok: false, error: await formatAiError(response, activeModel) };
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return { ok: false, error: 'Réponse vide de l\'API.' };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur réseau' };
  }
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
