import type { ComparisonRowEntry } from './comparison-items.js';
import { comparisonRowKey, getVisibleComparisonRows } from './comparison-items.js';
import {
  buildComparisonImageQuery,
  COMPARISON_IMAGE_CONCURRENCY,
  MAX_COMPARISON_IMAGE_ROWS,
} from './image.js';
import type { MerlinSpaceData } from './types.js';

export function getRowImage(data: MerlinSpaceData, rowKey: string): string | undefined {
  const key = rowKey.trim().toLowerCase();
  if (!key) return undefined;
  return data.rowImages?.[key];
}

export function mergeRowImages(
  existing: Record<string, string> | undefined,
  incoming: Record<string, string> | undefined,
  append = true,
): Record<string, string> | undefined {
  if (!incoming || Object.keys(incoming).length === 0) return existing;
  const cleaned = Object.fromEntries(
    Object.entries(incoming).filter(([k, v]) => k.trim() && v.trim()),
  );
  if (Object.keys(cleaned).length === 0) return existing;
  if (!append) return cleaned;
  return { ...(existing ?? {}), ...cleaned };
}

export interface EnrichComparisonImagesResult {
  rowImages: Record<string, string>;
  found: number;
  skipped: number;
  failed: string[];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Recherche et associe une image à chaque ligne visible de la comparaison. */
export async function enrichComparisonRowImages(options: {
  entries: ComparisonRowEntry[];
  existingImages?: Record<string, string>;
  contextHint: string;
  overwrite?: boolean;
  rowKeys?: string[];
  search: (query: string) => Promise<string | null>;
  maxRows?: number;
}): Promise<EnrichComparisonImagesResult> {
  const {
    entries,
    existingImages = {},
    contextHint,
    overwrite = false,
    rowKeys,
    search,
    maxRows = MAX_COMPARISON_IMAGE_ROWS,
  } = options;

  const filter = rowKeys?.length
    ? new Set(rowKeys.map((k) => k.trim().toLowerCase()).filter(Boolean))
    : null;

  const targets = entries.filter((entry) => {
    if (!entry.key) return false;
    if (filter && !filter.has(entry.key)) return false;
    if (!overwrite && existingImages[entry.key]) return false;
    return true;
  });

  const limited = targets.slice(0, maxRows);
  const skipped = targets.length - limited.length + (entries.length - targets.length);

  const rowImages = { ...existingImages };
  const failed: string[] = [];
  let found = 0;

  await mapWithConcurrency(limited, COMPARISON_IMAGE_CONCURRENCY, async (entry) => {
    const label = entry.row[0]?.trim() || entry.key;
    const query = buildComparisonImageQuery(label, contextHint);
    const imageUrl = await search(query);
    if (imageUrl) {
      rowImages[entry.key] = imageUrl;
      found += 1;
    } else {
      failed.push(label);
    }
  });

  return { rowImages, found, skipped, failed };
}

export function parseRowKeysArg(raw?: string): string[] | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
    }
  } catch {
    // liste séparée par virgules
  }
  return raw
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

export function rowKeyFromName(name: string): string {
  return comparisonRowKey([name]);
}

/** True si au moins un article visible n'a pas encore d'image (ou si overwrite). */
export function needsComparisonImageEnrichment(
  data: MerlinSpaceData,
  overwrite = false,
): boolean {
  const visible = getVisibleComparisonRows(data);
  if (visible.length === 0) return false;
  if (overwrite) return true;
  return visible.some((entry) => entry.key && !getRowImage(data, entry.key));
}

export function countComparisonImages(data: MerlinSpaceData): {
  withImage: number;
  total: number;
} {
  const visible = getVisibleComparisonRows(data);
  const withImage = visible.filter((entry) => entry.key && getRowImage(data, entry.key)).length;
  return { withImage, total: visible.length };
}

export function formatComparisonImageCount(data: MerlinSpaceData): string | null {
  const { withImage, total } = countComparisonImages(data);
  if (total === 0) return null;
  if (withImage === 0) return 'Sans photo';
  if (withImage === total) {
    return total === 1 ? '1 photo' : `${total} photos`;
  }
  return `${withImage}/${total} photos`;
}
