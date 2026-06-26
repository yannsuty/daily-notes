import { isPublicHttpUrl } from './web.js';

export interface ImageSearchHit {
  title: string;
  imageUrl: string;
  pageUrl?: string;
}

export const MAX_IMAGE_SEARCH_RESULTS = 8;
export const MAX_COMPARISON_IMAGE_ROWS = 12;
export const COMPARISON_IMAGE_CONCURRENCY = 3;

export function clampImageResultCount(raw: string | undefined, fallback = 3): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(MAX_IMAGE_SEARCH_RESULTS, Math.max(1, n));
}

/** URL https publique utilisable dans une balise img. */
export function isValidImageUrl(url: string): boolean {
  if (!isPublicHttpUrl(url)) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function formatImageSearchResults(query: string, hits: ImageSearchHit[]): string {
  if (hits.length === 0) {
    return `Aucune image trouvée pour « ${query} ».`;
  }

  const lines = hits.map(
    (hit, index) =>
      `${index + 1}. ${hit.title}\n   ${hit.imageUrl}${hit.pageUrl ? `\n   Page : ${hit.pageUrl}` : ''}`,
  );

  return `${hits.length} image(s) pour « ${query} » :\n\n${lines.join('\n\n')}`;
}

/** Construit une requête de recherche image à partir du nom d'objet et du contexte de l'espace. */
export function buildComparisonImageQuery(objectName: string, contextHint: string): string {
  const name = objectName.trim();
  const hint = contextHint
    .trim()
    .replace(/^comparaison\s*[—–-]\s*/i, '')
    .replace(/^comparaison\s+/i, '')
    .trim();
  if (!hint || hint.length < 3) return name;
  if (name.toLowerCase().includes(hint.toLowerCase().slice(0, 12))) return name;
  return `${name} ${hint}`;
}
