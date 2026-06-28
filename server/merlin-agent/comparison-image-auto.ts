import {
  enrichComparisonRowImages,
  needsComparisonImageEnrichment,
} from '../../lib/merlin-agent/comparison-images.js';
import { getVisibleComparisonRows } from '../../lib/merlin-agent/comparison-items.js';
import type { AgentClientConfig, MerlinSpace } from '../../lib/merlin-agent/types.js';
import { searchBraveImages } from './image-tools.js';
import type { AgentStore } from './tools.js';

function resolveBraveApiKey(config: AgentClientConfig): string | undefined {
  return config.braveSearchApiKey?.trim() || process.env.BRAVE_SEARCH_API_KEY?.trim() || undefined;
}

export interface AutoEnrichComparisonResult {
  spacesTouched: number;
  imagesFound: number;
  skippedNoKey: boolean;
}

/** Enrichit automatiquement les comparaisons modifiées (images manquantes, ou overwrite). */
export async function autoEnrichComparisonSpaces(
  store: AgentStore,
  config: AgentClientConfig,
  options: { overwrite?: boolean; spaceIds?: string[] } = {},
): Promise<AutoEnrichComparisonResult> {
  const braveKey = resolveBraveApiKey(config);
  if (!braveKey) {
    return { spacesTouched: 0, imagesFound: 0, skippedNoKey: true };
  }

  const overwrite = options.overwrite ?? false;
  const candidates = options.spaceIds?.length
    ? options.spaceIds
        .map((id) => store.getSpaceById(id))
        .filter((s): s is MerlinSpace => !!s && s.kind === 'comparison' && s.status === 'active')
    : store.getDirtyComparisonSpaces();

  let spacesTouched = 0;
  let imagesFound = 0;

  for (const space of candidates) {
    if (!needsComparisonImageEnrichment(space.data, overwrite)) continue;

    const visible = getVisibleComparisonRows(space.data);
    const result = await enrichComparisonRowImages({
      entries: visible,
      existingImages: space.data.rowImages,
      contextHint: space.title,
      overwrite,
      search: async (query) => {
        const hits = await searchBraveImages(query, 3, braveKey);
        return hits[0]?.imageUrl ?? null;
      },
    });

    if (result.found === 0 && !overwrite) continue;

    store.applyComparisonRowImages(space.id, result.rowImages);
    spacesTouched += 1;
    imagesFound += result.found;
  }

  return { spacesTouched, imagesFound, skippedNoKey: false };
}
