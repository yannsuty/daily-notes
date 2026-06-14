import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

    const payload = await upstream.text();
    if (!upstream.ok) {
      return res.status(upstream.status).send(payload.slice(0, 500));
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy error';
    return res.status(500).json({ error: message });
  }
}
