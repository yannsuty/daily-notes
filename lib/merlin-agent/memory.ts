import { formatDateLabel } from './dates.js';
import type { AgentContext, MerlinFact, MerlinSpace } from './types.js';

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface MemoryHit {
  source: 'fact' | 'journal' | 'space';
  label: string;
  content: string;
  score: number;
}

export function searchFacts(facts: MerlinFact[], query: string, max = 6): MemoryHit[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const terms = normalized.split(/\s+/).filter((t) => t.length > 2);
  const hits: MemoryHit[] = [];

  for (const fact of facts) {
    const hay = `${fact.key} ${fact.value}`.toLowerCase();
    let score = 0;
    if (hay.includes(normalized)) score += 5;
    for (const term of terms) {
      if (hay.includes(term)) score += 1;
    }
    if (score > 0) {
      hits.push({
        source: 'fact',
        label: fact.key,
        content: fact.value,
        score,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, max);
}

export function searchJournalInContext(
  days: AgentContext['days'],
  query: string,
  maxResults = 6,
): MemoryHit[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const matches: MemoryHit[] = [];

  for (const [dateKey, entry] of Object.entries(days)) {
    const content = entry.content.trim();
    if (!content) continue;
    const lower = content.toLowerCase();
    if (!lower.includes(normalized)) continue;

    const idx = lower.indexOf(normalized);
    const start = Math.max(0, idx - 80);
    const end = Math.min(content.length, idx + normalized.length + 120);
    let excerpt = content.slice(start, end).trim();
    if (start > 0) excerpt = '…' + excerpt;
    if (end < content.length) excerpt = excerpt + '…';

    const score =
      (lower.match(new RegExp(escapeRegex(normalized), 'g')) ?? []).length +
      (dateKey >= normalized ? 0 : 0);

    matches.push({
      source: 'journal',
      label: `${formatDateLabel(dateKey)} (${dateKey})`,
      content: excerpt,
      score,
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

export function searchSpaces(spaces: MerlinSpace[], query: string, max = 4): MemoryHit[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const terms = normalized.split(/\s+/).filter((t) => t.length > 2);
  const hits: MemoryHit[] = [];

  for (const space of spaces) {
    if (space.status !== 'active') continue;
    const hay = `${space.title} ${space.recap} ${space.kind}`.toLowerCase();
    let score = 0;
    if (hay.includes(normalized)) score += 5;
    for (const term of terms) {
      if (hay.includes(term)) score += 1;
    }
    if (score > 0) {
      hits.push({
        source: 'space',
        label: `[${space.kind}] ${space.title}`,
        content: space.recap.slice(0, 200),
        score,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, max);
}

export function gatherMemory(
  context: AgentContext,
  queries: string[],
): { hits: MemoryHit[]; block: string } {
  const seen = new Set<string>();
  const hits: MemoryHit[] = [];

  for (const query of queries) {
    for (const hit of searchFacts(context.facts, query)) {
      const key = `fact:${hit.label}:${hit.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
    for (const hit of searchJournalInContext(context.days, query)) {
      const key = `journal:${hit.label}:${hit.content.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
    for (const hit of searchSpaces(context.spaces ?? [], query)) {
      const key = `space:${hit.label}:${hit.content.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
  }

  if (hits.length === 0) {
    return { hits, block: '' };
  }

  const lines = hits.map((hit) => {
    if (hit.source === 'fact') {
      return `- [mémoire] ${hit.label} : ${hit.content}`;
    }
    if (hit.source === 'space') {
      return `- [espace ${hit.label}] ${hit.content}`;
    }
    return `- [journal ${hit.label}] ${hit.content}`;
  });

  return {
    hits,
    block: `Éléments retrouvés en mémoire :\n${lines.join('\n')}`,
  };
}
