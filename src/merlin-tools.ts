import { getAllDays } from './db';
import { addDays, formatDateLabel, todayKey } from './types';

export interface ToolResult {
  ok: boolean;
  content: string;
}

export async function readJournal(dateKey: string): Promise<ToolResult> {
  const days = await getAllDays();
  const entry = days[dateKey];
  if (!entry?.content.trim()) {
    return {
      ok: true,
      content: `Aucune note pour le ${formatDateLabel(dateKey)} (${dateKey}).`,
    };
  }
  return {
    ok: true,
    content: `Note du ${formatDateLabel(dateKey)} (${dateKey}) :\n${entry.content.trim()}`,
  };
}

export async function searchJournal(
  query: string,
  maxResults = 8,
): Promise<ToolResult> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return { ok: false, content: 'Requête de recherche vide.' };
  }

  const days = await getAllDays();
  const matches: { dateKey: string; excerpt: string; score: number }[] = [];

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

    const score = (lower.match(new RegExp(escapeRegex(normalized), 'g')) ?? []).length;
    matches.push({ dateKey, excerpt, score });
  }

  matches.sort((a, b) => b.score - a.score || b.dateKey.localeCompare(a.dateKey));
  const top = matches.slice(0, maxResults);

  if (top.length === 0) {
    return {
      ok: true,
      content: `Aucun résultat dans le journal pour « ${query} ».`,
    };
  }

  const body = top
    .map((m) => `• ${formatDateLabel(m.dateKey)} (${m.dateKey}) : ${m.excerpt}`)
    .join('\n');

  return {
    ok: true,
    content: `${top.length} résultat(s) pour « ${query} » :\n${body}`,
  };
}

export async function summarizePeriod(
  fromDate: string,
  toDate: string,
): Promise<ToolResult> {
  const days = await getAllDays();
  const dates = Object.keys(days)
    .filter((d) => d >= fromDate && d <= toDate && days[d].content.trim())
    .sort();

  if (dates.length === 0) {
    return {
      ok: true,
      content: `Aucune note entre le ${fromDate} et le ${toDate}.`,
    };
  }

  const excerpts = dates.map((dateKey) => {
    const body = days[dateKey].content.trim().slice(0, 600);
    return `## ${dateKey}\n${body}`;
  });

  return {
    ok: true,
    content: `Notes du ${fromDate} au ${toDate} (${dates.length} jour(s)) :\n\n${excerpts.join('\n\n')}`,
  };
}

export async function executeMerlinTool(
  name: string,
  args: Record<string, string>,
): Promise<ToolResult> {
  switch (name) {
    case 'read_journal':
      return readJournal(args.date ?? todayKey());
    case 'search_journal':
      return searchJournal(args.query ?? '');
    case 'summarize_period':
      return summarizePeriod(
        args.from ?? addDays(todayKey(), -7),
        args.to ?? todayKey(),
      );
    default:
      return { ok: false, content: `Outil inconnu : ${name}` };
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
