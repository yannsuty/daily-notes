import { callLlmCompletion } from '../llm-completion.js';
import { OPENROUTER_FREE_ROUTER } from '../openrouter-fallback.js';
import type { OpenRouterBody } from '../openrouter-fallback.js';
import type { AgentClientConfig, ChatMessage } from '../../lib/merlin-agent/types.js';

export interface LlmResult {
  ok: boolean;
  text?: string;
  error?: string;
  modelUsed?: string;
  retryable?: boolean;
}

export async function callMerlinLlm(
  messages: ChatMessage[],
  config: AgentClientConfig,
  options?: { temperature?: number; jsonMode?: boolean; referer?: string },
): Promise<LlmResult> {
  const body: OpenRouterBody = {
    model: config.model ?? OPENROUTER_FREE_ROUTER,
    messages,
    temperature: options?.temperature ?? 0.4,
  };

  if (options?.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const envChain = config.modelChain?.trim() || process.env.OPENROUTER_MODEL_CHAIN;

  try {
    const result = await callLlmCompletion(body, {
      apiKey: config.apiKey?.trim(),
      referer: options?.referer ?? 'https://merlin.app',
      envChain,
    });

    if (!result.ok) {
      let detail = result.payload.slice(0, 200);
      try {
        const parsed = JSON.parse(result.payload) as { error?: { message?: string } };
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        // keep raw
      }
      return {
        ok: false,
        error: detail,
        retryable: result.retryable ?? false,
      };
    }

    let text: string | undefined;
    try {
      const parsed = JSON.parse(result.payload) as {
        choices?: { message?: { content?: string } }[];
      };
      text = parsed.choices?.[0]?.message?.content?.trim();
    } catch {
      text = undefined;
    }

    if (!text) {
      return { ok: false, error: 'Réponse vide de l\'API.', retryable: true };
    }

    return { ok: true, text, modelUsed: result.modelUsed };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Erreur réseau',
      retryable: true,
    };
  }
}
