import {
  detectSpaceKind,
  isExplicitNewSpaceIntent,
  shouldUpdateActiveSpace,
} from '../../lib/merlin-agent/space-intent.js';
import { mergeSpaceData } from '../../lib/merlin-agent/space-merge.js';
import type { AgentClientConfig, MerlinSpace } from '../../lib/merlin-agent/types.js';
import { extractSpaceData, extractSpaceUpdate } from './space-extract.js';
import type { AgentStore } from './tools.js';

export async function ensureSpacePersisted(
  store: AgentStore,
  userMessage: string,
  reply: string,
  config: AgentClientConfig,
  referer?: string,
  activeSpace?: MerlinSpace | null,
): Promise<boolean> {
  if (store.hasDirtySpaces()) return false;

  const active = activeSpace ?? store.getActiveSpace() ?? null;

  if (active && shouldUpdateActiveSpace(userMessage, active.kind)) {
    const extracted = await extractSpaceUpdate(active, userMessage, reply, config, referer);
    if (!extracted?.data) return false;

    const preview = mergeSpaceData(active.kind, active.data, extracted.data, { append: true });
    if (JSON.stringify(preview) === JSON.stringify(active.data)) return false;

    const result = store.updateSpace({
      space_id: active.id,
      recap: extracted.recap,
      data_json: JSON.stringify(extracted.data),
      append: 'true',
    });
    return result.ok;
  }

  const kind = detectSpaceKind(userMessage);
  if (!kind) return false;

  if (active && kind === active.kind && !isExplicitNewSpaceIntent(userMessage)) {
    return false;
  }

  const extracted = await extractSpaceData(kind, userMessage, reply, config, referer);

  const result = store.createSpace({
    kind,
    title: extracted?.title ?? userMessage.trim().slice(0, 80),
    recap: extracted?.recap ?? userMessage.trim().slice(0, 400),
    data_json: extracted?.data ? JSON.stringify(extracted.data) : undefined,
  });

  return result.ok;
}

/** @deprecated Utiliser ensureSpacePersisted */
export async function ensureSpaceSaved(
  store: AgentStore,
  userMessage: string,
  reply: string,
  config: AgentClientConfig,
  referer?: string,
): Promise<boolean> {
  return ensureSpacePersisted(store, userMessage, reply, config, referer);
}
