import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  callOpenRouterWithFallback,
  OPENROUTER_FREE_ROUTER,
  type OpenRouterBody,
} from './lib/openrouter-fallback.js';

interface AiClientConfigPayload {
  apiKey?: string;
  modelChain?: string;
}

interface AiBody {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  response_format?: { type: string };
  config?: AiClientConfigPayload;
}

function cors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function referer(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:5173';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as AiBody;
  if (!body?.model || !Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'Missing model or messages', retryable: false });
  }

  const apiKey =
    body.config?.apiKey?.trim() || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'OPENROUTER_API_KEY not configured (Réglages ou serveur)',
      retryable: false,
    });
  }

  const envChain =
    body.config?.modelChain?.trim() || process.env.OPENROUTER_MODEL_CHAIN;

  try {
    const openRouterBody: OpenRouterBody = {
      model: body.model || OPENROUTER_FREE_ROUTER,
      messages: body.messages,
      temperature: body.temperature,
      response_format: body.response_format,
    };

    const result = await callOpenRouterWithFallback(apiKey, openRouterBody, {
      referer: referer(),
      envChain,
    });

    if (result.ok && result.modelUsed) {
      res.setHeader('X-Merlin-Model-Used', result.modelUsed);
    }

    if (!result.ok) {
      let detail = result.payload.slice(0, 300);
      try {
        const parsed = JSON.parse(result.payload) as { error?: { message?: string } };
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        // keep raw
      }
      return res.status(result.status >= 400 ? result.status : 503).json({
        error: { message: detail, source: 'openrouter' },
        triedModels: result.triedModels,
        retryable: result.retryable ?? false,
      });
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(result.payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy error';
    return res.status(500).json({ error: message, retryable: true });
  }
}
