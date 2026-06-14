import { apiUrl } from './api-base';

export const OPENROUTER_FREE_ROUTER = 'openrouter/free';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiResult {
  ok: boolean;
  text?: string;
  error?: string;
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
    detail = `Modèle introuvable (${model}).`;
  }
  if (response.status === 503) {
    detail = 'OPENROUTER_API_KEY non configurée sur le serveur.';
  }
  return `API erreur ${response.status}: ${detail}`;
}

export async function chatCompletion(
  messages: ChatMessage[],
  options?: { temperature?: number; jsonMode?: boolean },
): Promise<AiResult> {
  const model = OPENROUTER_FREE_ROUTER;
  const body: Record<string, unknown> = {
    model,
    temperature: options?.temperature ?? 0.4,
    messages,
  };

  if (options?.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  try {
    const response = await fetch(apiUrl('/api/ai'), {
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
