/** Phrases reconnues dans le texte → tag canonique (travail, maison, courses, …). */
export const CONTEXT_PHRASES: Record<string, string> = {
  travail: 'travail',
  bureau: 'travail',
  maison: 'maison',
  domicile: 'maison',
  'à la maison': 'maison',
  'a la maison': 'maison',
  'chez moi': 'maison',
  courses: 'courses',
  'super marché': 'courses',
  supermarche: 'courses',
};

/** Détecte les tags canoniques présents dans une phrase. */
export function detectContextTags(text: string): string[] {
  const lower = text.toLowerCase();
  const tags = new Set<string>();
  const entries = Object.entries(CONTEXT_PHRASES).sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, tag] of entries) {
    if (lower.includes(phrase)) tags.add(tag);
  }
  if (/au travail|en rentrant|rentrant du travail/.test(lower)) {
    tags.add('maison');
  }
  if (/quand je rentre(?:\s+à la maison|\s+a la maison|\s+chez moi)?/.test(lower) && !tags.has('travail')) {
    tags.add('maison');
  }
  return [...tags];
}

/** Normalise une liste de tags (entrée outil ou stockée) vers les tags canoniques. */
export function normalizeContextTags(input: string | string[]): string[] {
  const pieces =
    typeof input === 'string'
      ? input
          .split(/[,;]+/)
          .map((t) => t.trim())
          .filter(Boolean)
      : input.filter(Boolean);

  const tags = new Set<string>();
  for (const piece of pieces) {
    const detected = detectContextTags(piece);
    if (detected.length > 0) {
      for (const tag of detected) tags.add(tag);
    } else {
      tags.add(piece.toLowerCase());
    }
  }
  return [...tags];
}

/** Vérifie si deux ensembles de tags partagent au moins un contexte canonique. */
export function contextTagsMatch(query: string[], stored: string[]): boolean {
  const q = new Set(normalizeContextTags(query));
  const s = new Set(normalizeContextTags(stored));
  for (const tag of q) {
    if (s.has(tag)) return true;
  }
  return false;
}
