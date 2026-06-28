import { callMegaserveurChat, isMegaserveurConfigured } from './megaserveur-ai.js';
import {
  callOpenRouterWithFallback,
  type FallbackResult,
  type OpenRouterBody,
} from './openrouter-fallback.js';

export interface LlmCompletionOptions {
  /** Clé OpenRouter (réglages client ou env) — ignorée si Megaserveur est configuré. */
  apiKey?: string;
  referer: string;
  envChain?: string;
  fetchImpl?: typeof fetch;
}

export async function callLlmCompletion(
  body: OpenRouterBody,
  options: LlmCompletionOptions,
): Promise<FallbackResult> {
  if (isMegaserveurConfigured()) {
    return callMegaserveurChat(body, { fetchImpl: options.fetchImpl });
  }

  const apiKey = options.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      payload: JSON.stringify({
        error: {
          message:
            'OPENROUTER_API_KEY not configured (Réglages ou serveur). ' +
            'Ou configurez MEGASERVEUR_AI_BASE_URL + MEGASERVEUR_AI_API_KEY.',
        },
      }),
      triedModels: [],
      retryable: false,
    };
  }

  return callOpenRouterWithFallback(apiKey, body, {
    referer: options.referer,
    envChain: options.envChain,
    fetchImpl: options.fetchImpl,
  });
}

export { isMegaserveurConfigured };
