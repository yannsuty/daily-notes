export type ThoughtNodeType = 'word' | 'concept' | 'theme' | 'tag';

export interface ThoughtNode {
  id: string;
  label: string;
  type: ThoughtNodeType;
  count: number;
  lastSeen: string;
  recent: boolean;
  score: number;
}

export interface ThoughtLink {
  source: string;
  target: string;
  weight: number;
}

export interface ThoughtGraph {
  nodes: ThoughtNode[];
  links: ThoughtLink[];
}

const RECENT_DAYS = 7;
const MIN_WORD_LEN = 3;
const MIN_TOTAL_COUNT = 2;
const MAX_NODES = 48;
const MAX_LINKS_PER_ENTRY = 120;

const STOP_WORDS = new Set([
  'a', 'ai', 'aie', 'aient', 'ais', 'ait', 'as', 'au', 'aux', 'avais', 'avait', 'avant', 'avec',
  'avoir', 'avons', 'avez', 'ont', 'sont', 'est', 'etais', 'etait', 'ete', 'etre', 'suis', 'es',
  'sommes', 'etes', 'ce', 'ces', 'cet', 'cette', 'cela', 'celui', 'celle', 'ceux', 'celles',
  'd', 'de', 'des', 'du', 'dans', 'en', 'et', 'ou', 'où', 'ou', 'on', 'ne', 'pas', 'plus', 'moins',
  'très', 'tres', 'trop', 'peu', 'bien', 'mal', 'comme', 'si', 'mais', 'donc', 'car', 'ni', 'or',
  'que', 'qui', 'quoi', 'dont', 'où', 'le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de',
  'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'notre', 'nos', 'votre', 'vos', 'leur', 'leurs',
  'je', 'tu', 'il', 'elle', 'ils', 'elles', 'nous', 'vous', 'me', 'te', 'se', 'moi', 'toi', 'lui',
  'y', 'en', 'ici', 'la', 'là', 'voici', 'voila', 'voilà', 'alors', 'ainsi', 'aussi', 'encore',
  'deja', 'déjà', 'jamais', 'toujours', 'souvent', 'parfois', 'tout', 'tous', 'toute', 'toutes',
  'autre', 'autres', 'meme', 'même', 'quel', 'quelle', 'quels', 'quelles', 'certain', 'certains',
  'plusieurs', 'chaque', 'aucun', 'aucune', 'rien', 'personne', 'quelque', 'quelques',
  'faire', 'fait', 'fais', 'font', 'dit', 'dire', 'va', 'vai', 'vait', 'aller', 'venir', 'vois',
  'voir', 'vu', 'peut', 'peuvent', 'pouvoir', 'doit', 'doivent', 'devoir', 'faut', 'falloir',
  'avoir', 'ete', 'été', 'etait', 'étais', 'sera', 'serait', 'aurait', 'ayant', 'suis', 'sommes',
  'jour', 'jours', 'aujourd', 'hui', 'aujourdhui', "aujourd'hui", 'hier', 'demain', 'matin',
  'soir', 'midi', 'nuit', 'semaine', 'mois', 'annee', 'année', 'fois', 'moment', 'temps',
  'bon', 'bonne', 'mauvais', 'grand', 'grande', 'petit', 'petite', 'nouveau', 'nouvelle',
  'premier', 'premiere', 'première', 'dernier', 'derniere', 'dernière', 'meme', 'même',
  'chose', 'choses', 'quelqu', 'qu', 'quoi', 'comment', 'pourquoi', 'quand', 'combien',
  'peu', 'beaucoup', 'trop', 'assez', 'vraiment', 'probablement', 'peut', 'être', 'etre',
  'sans', 'sous', 'sur', 'chez', 'entre', 'vers', 'par', 'pour', 'depuis', 'pendant', 'apres',
  'après', 'avant', 'contre', 'selon', 'malgre', 'malgré', 'grace', 'grâce',
  'ecrit', 'écris', 'écrire', 'ecrire', 'note', 'notes', 'pense', 'penser', 'pensée', 'pensee',
  'merlin', 'journal',
]);

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;

interface TermStats {
  label: string;
  type: ThoughtNodeType;
  totalCount: number;
  recentCount: number;
  docFreq: number;
  lastSeen: string;
}

export function parseThoughtsFromDays(
  days: Record<string, { content: string }>,
  today: string,
): ThoughtGraph {
  const stats = new Map<string, TermStats>();
  const entryTermSets: string[][] = [];
  const totalDocs = Object.values(days).filter((d) => d.content.trim()).length;

  if (totalDocs === 0) {
    return { nodes: [], links: [] };
  }

  const sortedDates = Object.keys(days).sort();

  for (const dateKey of sortedDates) {
    const content = days[dateKey]?.content ?? '';
    if (!content.trim()) continue;

    const recent = isRecent(dateKey, today);
    const termIds = extractFromEntry(content, dateKey, recent, stats);
    if (termIds.length > 0) {
      entryTermSets.push([...new Set(termIds)]);
    }
  }

  const candidates = [...stats.entries()]
    .map(([id, s]) => ({
      id,
      score: computeScore(s, totalDocs, today),
      stats: s,
    }))
    .filter((c) => c.stats.totalCount >= MIN_TOTAL_COUNT)
    .sort((a, b) => b.score - a.score);

  const selectedIds = selectNodes(candidates);
  const selectedSet = new Set(selectedIds);

  const nodes: ThoughtNode[] = selectedIds
    .map((id) => {
      const s = stats.get(id)!;
      return {
        id,
        label: s.label,
        type: s.type,
        count: s.totalCount,
        lastSeen: s.lastSeen,
        recent: s.recentCount > 0,
        score: computeScore(s, totalDocs, today),
      };
    })
    .sort((a, b) => {
      if (a.recent !== b.recent) return a.recent ? -1 : 1;
      return b.score - a.score;
    });

  const linkWeights = new Map<string, number>();

  for (const termIds of entryTermSets) {
    const present = termIds.filter((id) => selectedSet.has(id));
    const unique = [...new Set(present)];
    let linkCount = 0;

    for (let i = 0; i < unique.length && linkCount < MAX_LINKS_PER_ENTRY; i++) {
      for (let j = i + 1; j < unique.length && linkCount < MAX_LINKS_PER_ENTRY; j++) {
        const key = [unique[i], unique[j]].sort().join('|');
        linkWeights.set(key, (linkWeights.get(key) ?? 0) + 1);
        linkCount++;
      }
    }
  }

  const links: ThoughtLink[] = [];
  for (const [key, weight] of linkWeights) {
    const [source, target] = key.split('|');
    links.push({ source, target, weight });
  }

  return { nodes, links };
}

function extractFromEntry(
  content: string,
  dateKey: string,
  recent: boolean,
  stats: Map<string, TermStats>,
): string[] {
  const found: string[] = [];

  extractExplicitMarkup(content, dateKey, recent, stats, found);

  const plain = stripMarkup(content);
  const paragraphs = plain.split(/\n+/).filter((p) => p.trim().length > 0);

  for (const paragraph of paragraphs) {
    const tokens = tokenize(paragraph);
    const unigramSeen = new Set<string>();
    const bigramSeen = new Set<string>();

    for (const token of tokens) {
      const id = `word:${token}`;
      const firstInEntry = !unigramSeen.has(id);
      if (firstInEntry) {
        unigramSeen.add(id);
        found.push(id);
      }
      bump(stats, id, token, 'word', dateKey, recent, 1, firstInEntry);
    }

    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];
      const phrase = `${a} ${b}`;
      const id = `concept:${phrase}`;
      const firstInEntry = !bigramSeen.has(id);
      if (firstInEntry) {
        bigramSeen.add(id);
        found.push(id);
      }
      bump(stats, id, phrase, 'concept', dateKey, recent, 1, firstInEntry);
    }
  }

  return found;
}

function extractExplicitMarkup(
  content: string,
  dateKey: string,
  recent: boolean,
  stats: Map<string, TermStats>,
  found: string[],
): void {
  const tagRe = /#([\p{L}\p{N}_-]+)/gu;
  const conceptRe = /\[\[([^\]]+)\]\]/g;
  const themeRe = /^##\s+(.+)$/gm;

  let m: RegExpExecArray | null;

  tagRe.lastIndex = 0;
  while ((m = tagRe.exec(content)) !== null) {
    const tag = m[1].toLowerCase();
    const id = `tag:${tag}`;
    found.push(id);
    bump(stats, id, `#${tag}`, 'tag', dateKey, recent, 2, true);
  }

  conceptRe.lastIndex = 0;
  while ((m = conceptRe.exec(content)) !== null) {
    const label = m[1].trim();
    if (!label) continue;
    const id = `concept:${normalizeKey(label)}`;
    found.push(id);
    bump(stats, id, label, 'concept', dateKey, recent, 3, true);
  }

  themeRe.lastIndex = 0;
  while ((m = themeRe.exec(content)) !== null) {
    const label = m[1].trim();
    if (!label) continue;
    const id = `theme:${normalizeKey(label)}`;
    found.push(id);
    bump(stats, id, label, 'theme', dateKey, recent, 3, true);
  }
}

function bump(
  stats: Map<string, TermStats>,
  id: string,
  label: string,
  type: ThoughtNodeType,
  dateKey: string,
  recent: boolean,
  amount: number,
  countDoc: boolean,
): void {
  const existing = stats.get(id);
  if (existing) {
    existing.totalCount += amount;
    if (recent) existing.recentCount += amount;
    if (dateKey > existing.lastSeen) existing.lastSeen = dateKey;
    if (countDoc) existing.docFreq += 1;
    return;
  }
  stats.set(id, {
    label,
    type,
    totalCount: amount,
    recentCount: recent ? amount : 0,
    docFreq: countDoc ? 1 : 0,
    lastSeen: dateKey,
  });
}

function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const raw = normalized.match(TOKEN_RE) ?? [];
  const tokens: string[] = [];

  for (const token of raw) {
    const clean = token.replace(/^['-]+|['-]+$/g, '');
    if (clean.length < MIN_WORD_LEN) continue;
    if (STOP_WORDS.has(clean)) continue;
    if (/^\d+$/.test(clean)) continue;
    tokens.push(clean);
  }

  return tokens;
}

function stripMarkup(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/#([\p{L}\p{N}_-]+)/gu, '$1')
    .replace(/[>*_~`-]/g, ' ');
}

function computeScore(s: TermStats, totalDocs: number, _today: string): number {
  const docFreq = Math.max(s.docFreq, 1);
  const idf = Math.log(1 + totalDocs / docFreq);
  const recencyBoost = s.recentCount > 0 ? 2.2 : 1;
  const typeBoost =
    s.type === 'theme' ? 1.6 : s.type === 'tag' ? 1.4 : s.type === 'concept' ? 1.25 : 1;
  return s.totalCount * idf * recencyBoost * typeBoost;
}

function selectNodes(
  candidates: { id: string; score: number; stats: TermStats }[],
): string[] {
  const bigrams = candidates.filter((c) => c.stats.type === 'concept');
  const themes = candidates.filter((c) => c.stats.type === 'theme');
  const tags = candidates.filter((c) => c.stats.type === 'tag');
  const words = candidates.filter((c) => c.stats.type === 'word');

  const selected: string[] = [];
  const usedWords = new Set<string>();

  for (const c of [...themes, ...tags, ...bigrams]) {
    if (selected.length >= MAX_NODES) break;
    selected.push(c.id);
    if (c.stats.type === 'concept') {
      const [a, b] = c.stats.label.toLowerCase().split(' ');
      if (a) usedWords.add(a);
      if (b) usedWords.add(b);
    }
  }

  for (const c of words) {
    if (selected.length >= MAX_NODES) break;
    const word = c.stats.label;
    if (usedWords.has(word)) continue;
    selected.push(c.id);
  }

  return selected;
}

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function daysFingerprint(days: Record<string, { content: string; updatedAt?: number }>): string {
  return Object.entries(days)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v.updatedAt ?? 0}:${v.content.length}`)
    .join('|');
}

export function getTopIdeas(graph: ThoughtGraph, limit = 5): ThoughtNode[] {
  return [...graph.nodes]
    .sort((a, b) => {
      if (a.recent !== b.recent) return a.recent ? -1 : 1;
      return b.score - a.score;
    })
    .slice(0, limit);
}

export function getNeighbors(
  graph: ThoughtGraph,
  nodeId: string,
): ThoughtNode[] {
  const neighborIds = new Set<string>();
  for (const link of graph.links) {
    if (link.source === nodeId) neighborIds.add(link.target);
    if (link.target === nodeId) neighborIds.add(link.source);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return [...neighborIds]
    .map((id) => byId.get(id))
    .filter((n): n is ThoughtNode => !!n)
    .sort((a, b) => b.score - a.score);
}

function isRecent(dateKey: string, today: string): boolean {
  const [ty, tm, td] = today.split('-').map(Number);
  const [dy, dm, dd] = dateKey.split('-').map(Number);
  const todayDate = new Date(ty, tm - 1, td);
  const dayDate = new Date(dy, dm - 1, dd);
  const diffMs = todayDate.getTime() - dayDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= RECENT_DAYS;
}

export function formatLastSeen(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
