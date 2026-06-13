export type ThoughtNodeType = 'day' | 'tag' | 'concept' | 'theme';

export interface ThoughtNode {
  id: string;
  label: string;
  type: ThoughtNodeType;
  dateKey?: string;
  recent: boolean;
}

export interface ThoughtLink {
  source: string;
  target: string;
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
  const linkSet = new Set<string>();
  const links: ThoughtLink[] = [];

  const addNode = (id: string, label: string, type: ThoughtNodeType, dateKey?: string): ThoughtNode => {
    const recent = dateKey ? isRecent(dateKey, today) : false;
    const existing = nodeMap.get(id);
    if (existing) {
      if (recent) existing.recent = true;
      return existing;
    }
    const node: ThoughtNode = { id, label, type, dateKey, recent };
    nodeMap.set(id, node);
    return node;
  };

  const addLink = (source: string, target: string): void => {
    if (source === target) return;
    const key = [source, target].sort().join('|');
    if (linkSet.has(key)) return;
    linkSet.add(key);
    links.push({ source, target });
  };

  const sortedDates = Object.keys(days).sort();

  for (const dateKey of sortedDates) {
    const content = days[dateKey]?.content ?? '';
    if (!content.trim()) continue;

    const dayId = `day:${dateKey}`;
    addNode(dayId, formatDayLabel(dateKey), 'day', dateKey);

    const dayTags: string[] = [];
    const dayConcepts: string[] = [];
    const dayThemes: string[] = [];

    let match: RegExpExecArray | null;

    TAG_RE.lastIndex = 0;
    while ((match = TAG_RE.exec(content)) !== null) {
      const tag = match[1].toLowerCase();
      const tagId = `tag:${tag}`;
      addNode(tagId, `#${tag}`, 'tag', dateKey);
      dayTags.push(tagId);
      addLink(dayId, tagId);
    }

    CONCEPT_RE.lastIndex = 0;
    while ((match = CONCEPT_RE.exec(content)) !== null) {
      const concept = match[1].trim();
      if (!concept) continue;
      const conceptId = `concept:${concept.toLowerCase()}`;
      addNode(conceptId, concept, 'concept', dateKey);
      dayConcepts.push(conceptId);
      addLink(dayId, conceptId);
    }

    THEME_RE.lastIndex = 0;
    while ((match = THEME_RE.exec(content)) !== null) {
      const theme = match[1].trim();
      if (!theme) continue;
      const themeId = `theme:${dateKey}:${theme.toLowerCase()}`;
      addNode(themeId, theme, 'theme', dateKey);
      dayThemes.push(themeId);
      addLink(dayId, themeId);
    }

    for (let i = 0; i < dayConcepts.length; i++) {
      for (let j = i + 1; j < dayConcepts.length; j++) {
        addLink(dayConcepts[i], dayConcepts[j]);
      }
    }

    for (let i = 0; i < dayTags.length; i++) {
      for (let j = i + 1; j < dayTags.length; j++) {
        addLink(dayTags[i], dayTags[j]);
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    links,
  };
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

function formatDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
