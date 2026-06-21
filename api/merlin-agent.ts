import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  runMerlinAgent,
  type AgentRequestBody,
  type AgentRunResult,
  type AgentStep,
} from './lib/merlin-agent/index.js';

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

function writeNdjson(res: VercelResponse, payload: unknown): void {
  res.write(`${JSON.stringify(payload)}\n`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as AgentRequestBody;
  if (!body?.message?.trim() || !body.context) {
    return res.status(400).json({ error: 'Missing message or context', retryable: false });
  }

  const stream = body.stream === true;
  const config = body.config ?? {};

  if (stream) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  }

  const onStep = stream
    ? (step: AgentStep) => {
        writeNdjson(res, { type: 'step', step });
      }
    : undefined;

  try {
    const result: AgentRunResult = await runMerlinAgent(body.message, body.context, config, {
      onStep,
      referer: referer(),
    });

    if (stream) {
      writeNdjson(res, { type: 'done', result });
      return res.end();
    }

    return res.status(result.ok ? 200 : 503).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent error';
    if (stream) {
      writeNdjson(res, { type: 'error', error: message });
      return res.end();
    }
    return res.status(500).json({ ok: false, error: message, steps: [], mutations: {} });
  }
}
