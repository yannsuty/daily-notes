import {
  detectSpaceKind,
  findRelatedSpace,
  isComparisonRepairRequest,
  isExplicitNewSpaceIntent,
  isInformationalSpaceQuestion,
  shouldExtendActiveSpace,
} from '../../lib/merlin-agent/space-intent.js';
import { mergeSpaceData } from '../../lib/merlin-agent/space-merge.js';
import type { AgentClientConfig, MerlinSpace } from '../../lib/merlin-agent/types.js';
import { extractSpaceData, extractSpaceUpdate } from './space-extract.js';
import type { AgentStore } from './tools.js';

function resolveTargetSpace(
  store: AgentStore,
  userMessage: string,
  activeSpace?: MerlinSpace | null,
): MerlinSpace | null {
  const fromSession = activeSpace ?? store.getActiveSpace() ?? null;
  if (fromSession) return fromSession;

  const kind = detectSpaceKind(userMessage);
  if (!kind) return null;

  return findRelatedSpace(store.spaces, userMessage, kind) ?? null;
}

export async function ensureSpacePersisted(
  store: AgentStore,
  userMessage: string,
  reply: string,
  config: AgentClientConfig,
  referer?: string,
  activeSpace?: MerlinSpace | null,
): Promise<boolean> {
  if (store.hasDirtySpaces()) return false;

  const active = resolveTargetSpace(store, userMessage, activeSpace);

  if (active && shouldExtendActiveSpace(userMessage, active.kind)) {
    const repair = active.kind === 'comparison' && isComparisonRepairRequest(userMessage);

    let extracted = repair
      ? await extractSpaceData(active.kind, userMessage, reply, config, referer)
      : await extractSpaceUpdate(active, userMessage, reply, config, referer);

    if (!extracted?.data) {
      const fallback = await extractSpaceData(active.kind, userMessage, reply, config, referer);
      if (fallback?.data) {
        extracted = {
          title: active.title,
          recap: fallback.recap,
          data: fallback.data,
        };
      }
    }

    if (!extracted?.data) return false;

    const append = repair ? false : true;
    const preview = mergeSpaceData(active.kind, active.data, extracted.data, { append });
    if (JSON.stringify(preview) === JSON.stringify(active.data)) return false;

    const result = store.updateSpace({
      space_id: active.id,
      title: repair && extracted.title ? extracted.title : undefined,
      recap: extracted.recap,
      data_json: JSON.stringify(extracted.data),
      append: append ? 'true' : 'false',
    });
    return result.ok;
  }

  const kind = detectSpaceKind(userMessage);
  if (!kind) return false;

  if (isInformationalSpaceQuestion(userMessage)) return false;

  if (active && kind === active.kind && !isExplicitNewSpaceIntent(userMessage)) {
    return false;
  }

  const existing = findRelatedSpace(store.spaces, userMessage, kind);
  if (existing && !isExplicitNewSpaceIntent(userMessage)) {
    let extracted = await extractSpaceUpdate(existing, userMessage, reply, config, referer);
    if (!extracted?.data) {
      extracted = await extractSpaceData(kind, userMessage, reply, config, referer);
      if (extracted?.data) {
        extracted = {
          title: existing.title,
          recap: extracted.recap,
          data: extracted.data,
        };
      }
    }
    if (!extracted?.data) return false;

    const preview = mergeSpaceData(existing.kind, existing.data, extracted.data, { append: true });
    if (JSON.stringify(preview) === JSON.stringify(existing.data)) return false;

    const result = store.updateSpace({
      space_id: existing.id,
      recap: extracted.recap,
      data_json: JSON.stringify(extracted.data),
      append: 'true',
    });
    return result.ok;
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
