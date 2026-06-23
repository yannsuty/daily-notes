import { detectSpaceKind } from '../../lib/merlin-agent/space-intent.js';
import type { AgentClientConfig } from '../../lib/merlin-agent/types.js';
import { extractSpaceData } from './space-extract.js';
import type { AgentStore } from './tools.js';

export async function ensureSpaceSaved(
  store: AgentStore,
  userMessage: string,
  reply: string,
  config: AgentClientConfig,
  referer?: string,
): Promise<boolean> {
  if (store.hasDirtySpaces()) return false;

  const kind = detectSpaceKind(userMessage);
  if (!kind) return false;

  const extracted = await extractSpaceData(kind, userMessage, reply, config, referer);

  const result = store.createSpace({
    kind,
    title: extracted?.title ?? userMessage.trim().slice(0, 80),
    recap: extracted?.recap ?? userMessage.trim().slice(0, 400),
    data_json: extracted?.data ? JSON.stringify(extracted.data) : undefined,
  });

  return result.ok;
}
