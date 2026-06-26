import type { VercelRequest, VercelResponse } from '@vercel/node';
import { refreshComparisonRowImage } from '../server/merlin-agent/image-tools.js';
import type { AgentClientConfig } from '../lib/merlin-agent/types.js';

interface SpaceImageRequestBody {
  rowName?: string;
  contextHint?: string;
  config?: AgentClientConfig;
}

function cors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as SpaceImageRequestBody;
  const rowName = body.rowName?.trim() ?? '';
  const contextHint = body.contextHint?.trim() ?? '';

  if (!rowName) {
    return res.status(400).json({ ok: false, content: 'rowName requis.' });
  }

  const config: AgentClientConfig = {
    braveSearchApiKey:
      body.config?.braveSearchApiKey?.trim() || process.env.BRAVE_SEARCH_API_KEY,
  };

  try {
    const result = await refreshComparisonRowImage(rowName, contextHint, config);
    return res.status(result.ok ? 200 : 503).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return res.status(500).json({ ok: false, content: message });
  }
}
