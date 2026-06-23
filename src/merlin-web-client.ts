import { apiUrl } from './api-base';
import { getAiClientConfig } from './merlin-env';
import type { ToolResult } from './merlin-tools';

export async function runWebToolClient(
  name: string,
  args: Record<string, string>,
): Promise<ToolResult> {
  const clientConfig = await getAiClientConfig();

  const response = await fetch(apiUrl('/api/merlin-web'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool: name,
      args,
      config: {
        apiKey: clientConfig.apiKey,
        modelChain: clientConfig.modelChain,
        model: clientConfig.model,
        braveSearchApiKey: clientConfig.braveSearchApiKey,
        tavilyApiKey: clientConfig.tavilyApiKey,
      },
    }),
  });

  if (!response.ok) {
    let detail = `Erreur serveur (${response.status})`;
    try {
      const body = (await response.json()) as { content?: string; error?: string };
      if (body.content) detail = body.content;
      else if (body.error) detail = body.error;
    } catch {
      // ignore
    }
    return { ok: false, content: detail };
  }

  return (await response.json()) as ToolResult;
}
