import { apiUrl } from './api-base';
import { getAiClientConfig } from './merlin-env';

export interface RefreshComparisonImageResult {
  ok: boolean;
  imageUrl?: string;
  content: string;
}

export async function refreshComparisonRowImageClient(
  rowName: string,
  contextHint: string,
): Promise<RefreshComparisonImageResult> {
  const clientConfig = await getAiClientConfig();

  const response = await fetch(apiUrl('/api/merlin-space-image'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rowName,
      contextHint,
      config: {
        braveSearchApiKey: clientConfig.braveSearchApiKey,
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

  return (await response.json()) as RefreshComparisonImageResult;
}
