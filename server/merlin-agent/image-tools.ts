import {
  enrichComparisonRowImages,
  parseRowKeysArg,
} from '../../lib/merlin-agent/comparison-images.js';
import { getVisibleComparisonRows } from '../../lib/merlin-agent/comparison-items.js';
import {
  clampImageResultCount,
  formatImageSearchResults,
  isValidImageUrl,
  buildComparisonImageQuery,
  type ImageSearchHit,
} from '../../lib/merlin-agent/image.js';
import type { AgentClientConfig, MerlinSpace, ToolResult } from '../../lib/merlin-agent/types.js';
import { getWebCache, setWebCache, WEB_SEARCH_CACHE_TTL_SECONDS } from './web-cache.js';

const BRAVE_IMAGE_SEARCH_URL = 'https://api.search.brave.com/res/v1/images/search';
const SEARCH_TIMEOUT_MS = 10_000;

interface CachedImagePayload {
  hits: ImageSearchHit[];
}

function resolveBraveApiKey(config: AgentClientConfig): string | undefined {
  return config.braveSearchApiKey?.trim() || process.env.BRAVE_SEARCH_API_KEY?.trim() || undefined;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildImageCacheKey(query: string, count: number): string {
  return `${query}::${count}`;
}

function extractBraveImageUrl(item: {
  properties?: { url?: string };
  thumbnail?: { src?: string };
  url?: string;
}): string {
  const candidates = [
    item.properties?.url?.trim(),
    item.thumbnail?.src?.trim(),
    item.url?.trim(),
  ].filter(Boolean) as string[];

  return candidates.find((url) => isValidImageUrl(url)) ?? '';
}

async function readImageCache(query: string, count: number): Promise<ImageSearchHit[] | null> {
  const raw = await getWebCache('image', buildImageCacheKey(query, count));
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as CachedImagePayload;
    return Array.isArray(payload.hits) ? payload.hits : null;
  } catch {
    return null;
  }
}

async function writeImageCache(
  query: string,
  count: number,
  hits: ImageSearchHit[],
): Promise<void> {
  const payload: CachedImagePayload = { hits };
  await setWebCache(
    'image',
    buildImageCacheKey(query, count),
    JSON.stringify(payload),
    WEB_SEARCH_CACHE_TTL_SECONDS,
  );
}

export async function searchBraveImages(
  query: string,
  count: number,
  apiKey: string,
): Promise<ImageSearchHit[]> {
  const cached = await readImageCache(query, count);
  if (cached) return cached;

  const params = new URLSearchParams({
    q: query,
    count: String(count),
    safesearch: 'strict',
    search_lang: 'fr',
  });

  const response = await fetchWithTimeout(
    `${BRAVE_IMAGE_SEARCH_URL}?${params}`,
    {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    },
    SEARCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Brave Images HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    results?: {
      title?: string;
      url?: string;
      properties?: { url?: string };
      thumbnail?: { src?: string };
    }[];
  };

  const hits: ImageSearchHit[] = [];
  for (const item of payload.results ?? []) {
    const imageUrl = extractBraveImageUrl(item);
    if (!imageUrl) continue;
    hits.push({
      title: item.title?.trim() || '(sans titre)',
      imageUrl,
      ...(item.url?.trim() ? { pageUrl: item.url.trim() } : {}),
    });
    if (hits.length >= count) break;
  }

  if (hits.length > 0) {
    await writeImageCache(query, count, hits);
  }

  return hits;
}

/** Retourne la première URL image valide pour une requête, ou null. */
export async function resolveFirstImageUrl(
  query: string,
  config: AgentClientConfig,
): Promise<string | null> {
  const braveKey = resolveBraveApiKey(config);
  if (!braveKey) return null;
  const hits = await searchBraveImages(query, 3, braveKey);
  return hits[0]?.imageUrl ?? null;
}

export async function refreshComparisonRowImage(
  rowName: string,
  contextHint: string,
  config: AgentClientConfig,
): Promise<{ ok: boolean; imageUrl?: string; content: string }> {
  const braveKey = resolveBraveApiKey(config);
  if (!braveKey) {
    return {
      ok: false,
      content:
        'Recherche d\'images indisponible : configurez BRAVE_SEARCH_API_KEY (Brave Images).',
    };
  }

  const query = buildComparisonImageQuery(rowName, contextHint);

  try {
    const hits = await searchBraveImages(query, 3, braveKey);
    const imageUrl = hits[0]?.imageUrl;
    if (!imageUrl) {
      return { ok: false, content: `Aucune image trouvée pour « ${rowName} ».` };
    }
    return {
      ok: true,
      imageUrl,
      content: `Image trouvée pour « ${rowName} ».`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur réseau';
    return { ok: false, content: `Recherche d'images impossible : ${message}.` };
  }
}

export async function runImageSearch(
  args: Record<string, string>,
  config: AgentClientConfig,
): Promise<ToolResult> {
  const query = (args.query ?? '').trim();
  if (!query) {
    return { ok: false, content: 'Requête de recherche d\'images vide.' };
  }

  const count = clampImageResultCount(args.max_results ?? args.count);
  const braveKey = resolveBraveApiKey(config);

  if (!braveKey) {
    return {
      ok: false,
      content:
        'Recherche d\'images indisponible : configurez BRAVE_SEARCH_API_KEY (Brave Images).',
    };
  }

  try {
    const hits = await searchBraveImages(query, count, braveKey);
    if (hits.length === 0) {
      return { ok: true, content: formatImageSearchResults(query, hits) };
    }
    return { ok: true, content: formatImageSearchResults(query, hits) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur réseau';
    return { ok: false, content: `Recherche d'images impossible : ${message}.` };
  }
}

export interface EnrichComparisonImagesDeps {
  resolveSpace: (ref?: string) => MerlinSpace | undefined;
  formatSpace: (space: MerlinSpace) => string;
  applyRowImages: (space: MerlinSpace, rowImages: Record<string, string>) => void;
}

export async function runEnrichComparisonImages(
  args: Record<string, string>,
  config: AgentClientConfig,
  deps: EnrichComparisonImagesDeps,
): Promise<ToolResult> {
  const space = deps.resolveSpace(args.space_id ?? args.id ?? args.title);
  if (!space) {
    const label = (args.space_id ?? args.title ?? 'contexte actif').trim();
    return { ok: false, content: `Espace « ${label} » introuvable.` };
  }

  if (space.kind !== 'comparison') {
    return {
      ok: false,
      content: `L'espace « ${space.title} » n'est pas une comparaison (kind=${space.kind}).`,
    };
  }

  const braveKey = resolveBraveApiKey(config);
  if (!braveKey) {
    return {
      ok: false,
      content:
        'Recherche d\'images indisponible : configurez BRAVE_SEARCH_API_KEY (Brave Images).',
    };
  }

  const visible = getVisibleComparisonRows(space.data);
  if (visible.length === 0) {
    return { ok: false, content: 'Aucun article visible dans cette comparaison.' };
  }

  const overwrite = args.overwrite === 'true' || args.overwrite === '1';
  const rowKeys = parseRowKeysArg(args.rows ?? args.row_keys);

  const result = await enrichComparisonRowImages({
    entries: visible,
    existingImages: space.data.rowImages,
    contextHint: space.title,
    overwrite,
    rowKeys,
    search: async (query) => {
      const hits = await searchBraveImages(query, 3, braveKey);
      return hits[0]?.imageUrl ?? null;
    },
  });

  deps.applyRowImages(space, result.rowImages);

  const lines = [
    `Images mises à jour pour « ${space.title} » : ${result.found} trouvée(s), ${result.failed.length} échec(s), ${result.skipped} ignorée(s).`,
  ];
  if (result.failed.length > 0) {
    lines.push(`Sans résultat : ${result.failed.join(', ')}.`);
  }
  lines.push('', deps.formatSpace(space));

  return {
    ok: true,
    content: lines.join('\n'),
    mutation: 'space_updated',
  };
}

export async function runImageTool(
  name: string,
  args: Record<string, string>,
  config: AgentClientConfig,
  deps?: EnrichComparisonImagesDeps,
): Promise<ToolResult> {
  if (name === 'search_images') {
    return runImageSearch(args, config);
  }
  if (name === 'enrich_comparison_images') {
    if (!deps) {
      return { ok: false, content: 'enrich_comparison_images nécessite un contexte espace.' };
    }
    return runEnrichComparisonImages(args, config, deps);
  }
  return { ok: false, content: `Outil image inconnu : ${name}` };
}
