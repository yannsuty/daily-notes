import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_FREE_ROUTER = 'openrouter/free';

interface AiBody {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  response_format?: { type: string };
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

async function callOpenRouter(
  apiKey: string,
  body: AiBody,
): Promise<{ status: number; payload: string }> {
  const upstream = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': referer(),
      'X-Title': 'Daily Note',
    },
    body: JSON.stringify({
      model: body.model,
      messages: body.messages,
      temperature: body.temperature ?? 0.4,
      ...(body.response_format ? { response_format: body.response_format } : {}),
    }),
  });

  return { status: upstream.status, payload: await upstream.text() };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'OPENROUTER_API_KEY not configured' });
  }

  const body = req.body as AiBody;
  if (!body?.model || !Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'Missing model or messages' });
  }

  try {
    let usedModel = body.model;
    let result = await callOpenRouter(apiKey, body);

    if (result.status === 404 && usedModel !== OPENROUTER_FREE_ROUTER) {
      usedModel = OPENROUTER_FREE_ROUTER;
      result = await callOpenRouter(apiKey, { ...body, model: OPENROUTER_FREE_ROUTER });
    }

    if (result.status < 200 || result.status >= 300) {
      let detail = result.payload.slice(0, 300);
      try {
        const parsed = JSON.parse(result.payload) as { error?: { message?: string } };
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        // keep raw snippet
      }
      return res.status(result.status).json({
        error: {
          message: detail,
          source: 'openrouter',
          model: usedModel,
          requestedModel: body.model,
        },
      });
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(result.payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy error';
    return res.status(500).json({ error: message });
  }
}
