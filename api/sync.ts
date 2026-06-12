import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

const MAX_BLOB_SIZE = 512_000;

interface SyncBody {
  id: string;
  ciphertext: string;
  iv: string;
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

  if (req.method === 'GET') {
    const id = req.query.id;
    if (typeof id !== 'string' || !id) {
      return res.status(400).json({ error: 'Missing id' });
    }

    const data = await kv.get<{ ciphertext: string; iv: string }>(kvKey(id));
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

    await kv.set(kvKey(body.id), {
      ciphertext: body.ciphertext,
      iv: body.iv,
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
