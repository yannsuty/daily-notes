import type { MerlinSpaceKind } from './types.js';

const SPACE_INTENT: { kind: MerlinSpaceKind; pattern: RegExp }[] = [
  { kind: 'comparison', pattern: /\b(compare|comparer|comparaison|versus|vs\.?)\b/i },
  { kind: 'recipe', pattern: /\b(recette|cuisine|ingrédients?|ingredients?)\b/i },
  { kind: 'diy', pattern: /\b(diy|bricolage|construire|fabriquer|fabrique)\b/i },
  { kind: 'plan', pattern: /\b(plan\s+(de|pour)|planif|refacto|programm|architecture)\b/i },
];

export function detectSpaceKind(text: string): MerlinSpaceKind | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const { kind, pattern } of SPACE_INTENT) {
    if (pattern.test(trimmed)) return kind;
  }
  return null;
}

export function inferSpaceTitle(userMessage: string, kind: MerlinSpaceKind): string {
  const trimmed = userMessage.trim().replace(/\s+/g, ' ');
  const short = trimmed.length > 72 ? `${trimmed.slice(0, 69)}…` : trimmed;
  const prefixes: Record<MerlinSpaceKind, string> = {
    comparison: 'Comparaison',
    diy: 'Projet',
    plan: 'Plan',
    recipe: 'Recette',
  };
  if (short.length < 24) return `${prefixes[kind]} — ${short}`;
  return short;
}
