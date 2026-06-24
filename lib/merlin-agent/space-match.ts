import type { MerlinSpace } from './types.js';

function normalizeSpaceRef(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[—–-]/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Retire les préfixes générés par inferSpaceTitle ou le libellé kind. */
export function stripSpaceTitlePrefix(title: string): string {
  return title
    .replace(/^comparaison\s*[—–-]\s*/i, '')
    .replace(/^comparaison\s+/i, '')
    .replace(/^projet\s*[—–-]\s*/i, '')
    .replace(/^projet\s+/i, '')
    .replace(/^plan\s*[—–-]\s*/i, '')
    .replace(/^recette\s*[—–-]\s*/i, '')
    .trim();
}

function tokenize(title: string): string[] {
  const normalized = normalizeSpaceRef(stripSpaceTitlePrefix(title));
  return normalized.split(' ').filter((w) => w.length > 2);
}

export function scoreSpaceTitleMatch(ref: string, spaceTitle: string): number {
  const a = normalizeSpaceRef(stripSpaceTitlePrefix(ref));
  const b = normalizeSpaceRef(stripSpaceTitlePrefix(spaceTitle));
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.includes(a) || a.includes(b)) return 85;

  const tokensA = tokenize(ref);
  const tokensB = new Set(tokenize(spaceTitle));
  if (tokensA.length === 0) return 0;

  const hits = tokensA.filter((t) => tokensB.has(t)).length;
  return Math.round((hits / tokensA.length) * 75);
}

const MATCH_THRESHOLD = 45;

export function findSpaceByRef(
  spaces: MerlinSpace[],
  idOrTitle: string,
  options?: { activeSpaceId?: string | null; kindHint?: MerlinSpace['kind'] },
): MerlinSpace | undefined {
  const trimmed = idOrTitle.trim();
  if (!trimmed) return undefined;

  const byId = spaces.find((s) => s.id === trimmed);
  if (byId) return byId;

  const normalizedRef = normalizeSpaceRef(stripSpaceTitlePrefix(trimmed));

  const exact = spaces.find(
    (s) => normalizeSpaceRef(stripSpaceTitlePrefix(s.title)) === normalizedRef,
  );
  if (exact) return exact;

  let candidates = spaces.filter((s) => s.status === 'active');
  if (options?.kindHint) {
    const kindMatches = candidates.filter((s) => s.kind === options.kindHint);
    if (kindMatches.length > 0) candidates = kindMatches;
  }

  let best: MerlinSpace | undefined;
  let bestScore = 0;

  for (const space of candidates) {
    const score = scoreSpaceTitleMatch(trimmed, space.title);
    if (score > bestScore) {
      bestScore = score;
      best = space;
    }
  }

  if (best && bestScore >= MATCH_THRESHOLD) return best;

  if (options?.activeSpaceId) {
    const active = spaces.find((s) => s.id === options.activeSpaceId);
    if (active) return active;
  }

  return undefined;
}
