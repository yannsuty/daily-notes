import type { MerlinSpaceKind } from './types.js';

const SPACE_INTENT: { kind: MerlinSpaceKind; pattern: RegExp }[] = [
  {
    kind: 'comparison',
    pattern: /\b(compare[rzs]?|comparons|comparer|comparaison|versus|vs\.?)\b/i,
  },
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

/** Extension d'une comparaison existante (autres produits, élargir le tableau). */
export function isComparisonExtensionRequest(text: string): boolean {
  return (
    /\b(compare[rzs]?|comparer)\b[\s\S]{0,40}\b(autres?|d'autres|plus|encore)\b/i.test(text) ||
    /\b(autres?|d'autres)\b[\s\S]{0,40}\b(ventilateur|modèle|produit)/i.test(text) ||
    /\b(étoffe|enrichi|élargi|complète|compléter)\b[\s\S]{0,30}\b(comparaison|tableau)/i.test(
      text,
    ) ||
    /\bje veux bien que tu compares\b/i.test(text)
  );
}

/** L'espace actif doit être enrichi plutôt qu'un nouvel espace créé. */
export function shouldExtendActiveSpace(
  userMessage: string,
  activeKind: MerlinSpaceKind,
): boolean {
  if (shouldUpdateActiveSpace(userMessage, activeKind)) return true;
  const kind = detectSpaceKind(userMessage);
  return kind === activeKind && !isExplicitNewSpaceIntent(userMessage);
}

export function shouldUpdateActiveSpace(
  userMessage: string,
  activeKind: MerlinSpaceKind,
): boolean {
  if (isExplicitNewSpaceIntent(userMessage)) return false;
  if (detectSpaceUpdateIntent(userMessage)) return true;

  if (activeKind === 'comparison' && isComparisonExtensionRequest(userMessage)) {
    return true;
  }

  const kind = detectSpaceKind(userMessage);
  if (kind !== activeKind) return false;

  if (kind === activeKind && !isExplicitNewSpaceIntent(userMessage)) {
    return true;
  }

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
