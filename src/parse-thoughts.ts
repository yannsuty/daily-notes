export type ThoughtNodeType = 'tag' | 'concept' | 'theme';

export interface ThoughtNode {
  id: string;
  label: string;
  type: ThoughtNodeType;
  count: number;
  lastSeen: string;
  recent: boolean;
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

const TAG_RE = /#([\p{L}\p{N}_-]+)/gu;
const CONCEPT_RE = /\[\[([^\]]+)\]\]/g;
const THEME_RE = /^##\s+(.+)$/gm;

const RECENT_DAYS = 7;

export function parseThoughtsFromDays(
  days: Record<string, { content: string }>,
  today: string,
): ThoughtGraph {
  const nodeMap = new Map<string, ThoughtNode>();
  const linkWeights = new Map<string, number>();

  const upsertNode = (
    id: string,
    label: string,
    type: ThoughtNodeType,
    dateKey: string,
  ): ThoughtNode => {
    const existing = nodeMap.get(id);
    if (existing) {
      existing.count += 1;
      if (dateKey > existing.lastSeen) {
        existing.lastSeen = dateKey;
      }
      if (isRecent(dateKey, today)) {
        existing.recent = true;
      }
      return existing;
    }
    const node: ThoughtNode = {
      id,
      label,
      type,
      count: 1,
      lastSeen: dateKey,
      recent: isRecent(dateKey, today),
    };
    nodeMap.set(id, node);
    return node;
  };

  const addLink = (source: string, target: string): void => {
    if (source === target) return;
    const key = [source, target].sort().join('|');
    linkWeights.set(key, (linkWeights.get(key) ?? 0) + 1);
  };

  const sortedDates = Object.keys(days).sort();

  for (const dateKey of sortedDates) {
    const content = days[dateKey]?.content ?? '';
    if (!content.trim()) continue;

    const entryIdeas: string[] = [];

    let match: RegExpExecArray | null;

    TAG_RE.lastIndex = 0;
    while ((match = TAG_RE.exec(content)) !== null) {
      const tag = match[1].toLowerCase();
      const tagId = `tag:${tag}`;
      upsertNode(tagId, `#${tag}`, 'tag', dateKey);
      entryIdeas.push(tagId);
    }

    CONCEPT_RE.lastIndex = 0;
    while ((match = CONCEPT_RE.exec(content)) !== null) {
      const concept = match[1].trim();
      if (!concept) continue;
      const conceptId = `concept:${concept.toLowerCase()}`;
      upsertNode(conceptId, concept, 'concept', dateKey);
      entryIdeas.push(conceptId);
    }

    THEME_RE.lastIndex = 0;
    while ((match = THEME_RE.exec(content)) !== null) {
      const theme = match[1].trim();
      if (!theme) continue;
      const themeId = `theme:${theme.toLowerCase()}`;
      upsertNode(themeId, theme, 'theme', dateKey);
      entryIdeas.push(themeId);
    }

    const unique = [...new Set(entryIdeas)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        addLink(unique[i], unique[j]);
      }
    }
  }

  const links: ThoughtLink[] = [];
  for (const [key, weight] of linkWeights) {
    const [source, target] = key.split('|');
    links.push({ source, target, weight });
  }

  const nodes = Array.from(nodeMap.values()).sort((a, b) => {
    if (a.recent !== b.recent) return a.recent ? -1 : 1;
    return b.count - a.count;
  });

  return { nodes, links };
}

export function getTopIdeas(graph: ThoughtGraph, limit = 5): ThoughtNode[] {
  return [...graph.nodes]
    .sort((a, b) => {
      if (a.recent !== b.recent) return a.recent ? -1 : 1;
      return b.count - a.count;
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
    .sort((a, b) => b.count - a.count);
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
