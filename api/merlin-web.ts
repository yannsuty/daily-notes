import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runWebTool } from './lib/merlin-agent/web-tools.js';
import type { AgentClientConfig } from '../lib/merlin-agent/types.js';
import { isWebTool } from '../lib/merlin-agent/primitive-tools.js';

interface WebToolRequestBody {
  tool: string;
  args?: Record<string, string>;
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

  const body = req.body as WebToolRequestBody;
  const tool = body?.tool?.trim();
  const args = body.args ?? {};

  if (!tool || !isWebTool(tool)) {
    return res.status(400).json({ ok: false, error: 'Outil web invalide', content: '' });
  }

  const config: AgentClientConfig = {
    apiKey: body.config?.apiKey,
    modelChain: body.config?.modelChain,
    model: body.config?.model,
    braveSearchApiKey:
      body.config?.braveSearchApiKey?.trim() || process.env.BRAVE_SEARCH_API_KEY,
    tavilyApiKey: body.config?.tavilyApiKey?.trim() || process.env.TAVILY_API_KEY,
  };

  try {
    const result = await runWebTool(tool, args, config);
    return res.status(result.ok ? 200 : 503).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return res.status(500).json({ ok: false, content: message });
  }
}
