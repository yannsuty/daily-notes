import {
  callOpenRouterWithFallback,
  OPENROUTER_FREE_ROUTER,
} from '../../server/openrouter-fallback.js';

export type OpenRouterPreflight =
  | { status: 'ok'; apiKey: string }
  | { status: 'missing' }
  | { status: 'invalid'; httpStatus: number; detail: string };

export async function checkOpenRouterPreflight(): Promise<OpenRouterPreflight> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return { status: 'missing' };
  }

  const result = await callOpenRouterWithFallback(
    apiKey,
    {
      model: OPENROUTER_FREE_ROUTER,
      messages: [{ role: 'user', content: 'ping' }],
      temperature: 0,
    },
    { referer: 'https://merlin.app' },
  );

  if (!result.ok) {
    return {
      status: 'invalid',
      httpStatus: result.status,
      detail: result.payload.slice(0, 300),
    };
  }

  return { status: 'ok', apiKey };
}

export function preflightSkipReason(preflight: OpenRouterPreflight): string | null {
  if (preflight.status === 'missing') {
    return 'OPENROUTER_API_KEY absent — évaluations LLM ignorées';
  }
  if (preflight.status === 'invalid') {
    return `OPENROUTER_API_KEY invalide (HTTP ${preflight.httpStatus}) — évaluations LLM ignorées`;
  }
  return null;
}
