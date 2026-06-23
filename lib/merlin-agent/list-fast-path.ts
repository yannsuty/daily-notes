/** Articles / pronoms — nécessitent le contexte conversationnel (agent). */
const VAGUE_LIST_ITEM_RE =
  /^(?:ça|ca|cela|ceci|qq?\s*chose|quelque\s+chose|this|that|it)$/i;

const VAGUE_SINGLE_WORD_RE = /^(?:ce|la|le|les|un|une|des)$/i;

/** Consignes méta ou multi-intentions — hors périmètre du fast path. */
const LIST_AGENT_DEFER_RE =
  /\b(dorénavant|à partir de maintenant|désormais|desormais|retiens que|souviens[- ]toi|chaque fois|si je te (?:parle|dis|demande)|à l'avenir|a l'avenir|pareil pour|comme (?:ça|ca|ceci)|ajoute aussi)\b/i;

/** Item de liste suffisamment explicite pour un ajout sans contexte. */
export function isConcreteListItem(item: string): boolean {
  const t = item.trim();
  if (t.length < 2) return false;
  if (VAGUE_LIST_ITEM_RE.test(t)) return false;
  if (VAGUE_SINGLE_WORD_RE.test(t)) return false;
  return true;
}

/** Message trop riche pour le regex « ajoute X à Y ». */
export function shouldDeferListAddToAgent(fullText: string): boolean {
  const t = fullText.trim();
  if (t.length > 100) return true;
  if (LIST_AGENT_DEFER_RE.test(t)) return true;
  return false;
}

/** Extrait et valide un ajout liste ; null → passer à l'agent. */
export function tryParseAddListIntent(text: string): { item: string; list: string } | null {
  if (shouldDeferListAddToAgent(text)) return null;

  const addMatch = text.match(
    /^ajoute(?:r)?\s+(.+?)\s+(?:à la liste\s+|à\s+(?:la\s+|une\s+|les\s+)?liste\s+|à\s+|sur\s+(?:la\s+)?liste\s+)(.+)$/i,
  );
  if (!addMatch) return null;

  const item = addMatch[1].trim();
  let list = addMatch[2].trim();
  list = list.replace(/^(?:ma|la|les|une?)\s+(?:liste\s+)?/i, '');
  list = list.replace(/[,.].*$/, '').trim();

  if (!isConcreteListItem(item) || !list) return null;

  return { item, list };
}
