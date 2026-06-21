import type { QueryDepth } from './types';

const DEEP_PATTERNS = [
  /\b(pourquoi|comment|analyse|analyser|compare|comparer|explique|expliquer|réfléch|reflech|synthèse|synthese|plan|stratég|strateg|avis|recommand|pense|évalue|evalue|détail|detail|approfond|contexte)\b/i,
  /\b(journal|notes|souviens|dernière|derniere|semaine|mois|historique|souvenir|rappelle-toi|rappelle toi)\b/i,
  /\b(résume|resume|raconte|qu'est-ce que|quest ce que|dis-moi ce que|dis moi ce que)\b/i,
];

export function assessQueryDepth(text: string): QueryDepth {
  const t = text.trim();
  if (t.length > 120) return 'deep';
  if (DEEP_PATTERNS.some((re) => re.test(t))) return 'deep';
  if (/\?\s*$/.test(t) && t.length > 50) return 'deep';
  if ((t.match(/\?/g) ?? []).length >= 2) return 'deep';
  return 'standard';
}

export function extractMemoryQueries(text: string): string[] {
  const queries = new Set<string>();
  const trimmed = text.trim();
  if (trimmed.length >= 3) queries.add(trimmed);

  const quoted = trimmed.match(/["«]([^"»]{2,80})["»]/g);
  if (quoted) {
    for (const q of quoted) {
      queries.add(q.replace(/^["«]|["»]$/g, '').trim());
    }
  }

  const keywords = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  if (keywords.length > 0) {
    queries.add(keywords.slice(0, 5).join(' '));
  }

  return [...queries].slice(0, 4);
}

const STOP_WORDS = new Set([
  'merlin',
  'pour',
  'dans',
  'avec',
  'sans',
  'plus',
  'tous',
  'toute',
  'toutes',
  'comment',
  'quoi',
  'peux',
  'peut',
  'faire',
  'être',
  'est',
  'sont',
  'cette',
  'celui',
  'celle',
  'mon',
  'mes',
  'ton',
  'tes',
  'notre',
  'votre',
]);
