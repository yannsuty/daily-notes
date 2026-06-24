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

/** Demande explicite de créer un nouvel espace plutôt que d'enrichir l'actif. */
export function isExplicitNewSpaceIntent(text: string): boolean {
  return /\b(nouveau|nouvelle|cr[ée]e|cr[ée]er|autre comparaison|from scratch|s[ée]par[ée])\b/i.test(
    text,
  );
}

/** Demande de modifier l'espace actif plutôt que d'en créer un nouveau. */
export function detectSpaceUpdateIntent(text: string): boolean {
  return /\b(ajoute|ajouter|rajoute|rajouter|int[èe]gre|intégrer|met(s|t)?\s+à\s+jour|mets\s+à\s+jour|modifie|modifier|complète|compléter|dans (la |cette |mon )?comparaison|au tableau|au comparatif|retire|supprime|enlève)\b/i.test(
    text,
  );
}

export function shouldUpdateActiveSpace(
  userMessage: string,
  activeKind: MerlinSpaceKind,
): boolean {
  if (isExplicitNewSpaceIntent(userMessage)) return false;
  if (detectSpaceUpdateIntent(userMessage)) return true;

  const kind = detectSpaceKind(userMessage);
  if (kind !== activeKind) return false;

  return /\b(aussi|également|encore|en plus|autre modèle|un modèle de plus)\b/i.test(userMessage);
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
