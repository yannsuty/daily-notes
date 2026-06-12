import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const MAX_BLOB_SIZE = 512_000;

interface SyncBody {
  id: string;
  ciphertext: string;
  iv: string;
}

function getRedis(): Redis {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error(
      'Missing Redis env vars (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)',
    );
  }

  return new Redis({ url, token });
}

function kvKey(id: string): string {
  return `sync:${id}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  let redis: Redis;
  try {
    redis = getRedis();
  } catch {
    return res.status(500).json({ error: 'Redis not configured' });
  }

  if (req.method === 'GET') {
    const id = req.query.id;
    if (typeof id !== 'string' || !id) {
      return res.status(400).json({ error: 'Missing id' });
    }

    const data = await redis.get<{ ciphertext: string; iv: string }>(kvKey(id));
    if (!data) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.status(200).json(data);
  }

  if (req.method === 'PUT') {
    const body = req.body as SyncBody;
    if (!body?.id || !body?.ciphertext || !body?.iv) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const payloadSize = body.ciphertext.length + body.iv.length;
    if (payloadSize > MAX_BLOB_SIZE) {
      return res.status(413).json({ error: 'Payload too large' });
    }

    await redis.set(kvKey(body.id), {
      ciphertext: body.ciphertext,
      iv: body.iv,
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
