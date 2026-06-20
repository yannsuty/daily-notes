import {
  deleteMerlinList,
  getMerlinCustomToolByName,
  getMerlinLists,
  getMerlinReminders,
  saveMerlinList,
  saveMerlinReminder,
} from './db';
import { isCustomToolName } from './merlin-tool-registry';
import type { MerlinList, MerlinListItem, MerlinReminder } from './types';
import { getAllDays } from './db';
import { addDays, formatDateLabel, todayKey } from './types';

export interface ToolResult {
  ok: boolean;
  content: string;
  mutation?: 'list_updated' | 'reminder_created' | 'reminder_completed';
}

export function createEntityId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

function findListByTitle(lists: MerlinList[], title: string): MerlinList | undefined {
  const n = normalizeTitle(title);
  return lists.find((l) => normalizeTitle(l.title) === n);
}

function findListFuzzy(lists: MerlinList[], title: string): MerlinList | undefined {
  const exact = findListByTitle(lists, title);
  if (exact) return exact;
  const n = normalizeTitle(title);
  return lists.find(
    (l) => normalizeTitle(l.title).includes(n) || n.includes(normalizeTitle(l.title)),
  );
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

export async function createList(title: string): Promise<ToolResult> {
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, content: 'Titre de liste vide.' };

  const lists = await getMerlinLists();
  const existing = findListByTitle(lists, trimmed);
  if (existing) {
    return { ok: true, content: `La liste « ${existing.title} » existe déjà.` };
  }

  const now = Date.now();
  const list: MerlinList = {
    id: createEntityId(),
    title: trimmed,
    items: [],
    createdAt: now,
    updatedAt: now,
  };
  await saveMerlinList(list);
  return {
    ok: true,
    content: `Liste « ${trimmed} » créée.`,
    mutation: 'list_updated',
  };
}

export async function addListItem(listTitle: string, itemText: string): Promise<ToolResult> {
  const text = itemText.trim();
  if (!text) return { ok: false, content: 'Article vide.' };

  const lists = await getMerlinLists();
  let list = findListFuzzy(lists, listTitle);
  if (!list) {
    const created = await createList(listTitle.trim() || 'courses');
    if (!created.ok) return created;
    list = findListByTitle(await getMerlinLists(), listTitle.trim() || 'courses');
    if (!list) return { ok: false, content: 'Impossible de créer la liste.' };
  }

  const now = Date.now();
  const item: MerlinListItem = {
    id: createEntityId(),
    text,
    done: false,
    createdAt: now,
    updatedAt: now,
  };
  list.items.push(item);
  await saveMerlinList(list);
  return {
    ok: true,
    content: `« ${text} » ajouté à ${list.title}.`,
    mutation: 'list_updated',
  };
}

export async function toggleListItem(
  listTitle: string,
  itemText: string,
): Promise<ToolResult> {
  const lists = await getMerlinLists();
  const list = findListFuzzy(lists, listTitle);
  if (!list) return { ok: false, content: `Liste « ${listTitle} » introuvable.` };

  const n = itemText.trim().toLowerCase();
  const item = list.items.find((i) => i.text.toLowerCase().includes(n));
  if (!item) return { ok: false, content: `« ${itemText} » introuvable dans ${list.title}.` };

  item.done = !item.done;
  item.updatedAt = Date.now();
  await saveMerlinList(list);
  return {
    ok: true,
    content: item.done
      ? `« ${item.text} » coché dans ${list.title}.`
      : `« ${item.text} » décoché dans ${list.title}.`,
    mutation: 'list_updated',
  };
}

export async function showLists(listTitle?: string): Promise<ToolResult> {
  const lists = await getMerlinLists();
  if (lists.length === 0) {
    return { ok: true, content: 'Aucune liste pour le moment.' };
  }

  const target = listTitle ? findListFuzzy(lists, listTitle) : null;
  const toShow = target ? [target] : lists;

  const blocks = toShow.map((list) => {
    const pending = list.items.filter((i) => !i.done);
    const done = list.items.filter((i) => i.done);
    const pendingLines =
      pending.length > 0
        ? pending.map((i) => `  ○ ${i.text}`).join('\n')
        : '  (rien à faire)';
    const doneLines =
      done.length > 0 ? done.map((i) => `  ✓ ${i.text}`).join('\n') : '';
    return `**${list.title}**\n${pendingLines}${doneLines ? '\n' + doneLines : ''}`;
  });

  return { ok: true, content: blocks.join('\n\n') };
}

function parseTimeOfDay(input: string): string | undefined {
  const m = input.match(/(\d{1,2})[:h](\d{2})?/);
  if (!m) return undefined;
  const h = String(Number(m[1])).padStart(2, '0');
  const min = m[2] ? String(Number(m[2])).padStart(2, '0') : '00';
  return `${h}:${min}`;
}

export async function createReminder(args: {
  text: string;
  timeOfDay?: string;
  at?: string;
  recurrence?: string;
  contextTags?: string;
}): Promise<ToolResult> {
  const text = args.text.trim();
  if (!text) return { ok: false, content: 'Rappel vide.' };

  const now = Date.now();
  let trigger: MerlinReminder['trigger'];

  if (args.contextTags) {
    const tags = args.contextTags
      .split(/[,;]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    trigger = { kind: 'context', tags: tags.length > 0 ? tags : ['general'] };
  } else {
    const timeOfDay = args.timeOfDay ? parseTimeOfDay(args.timeOfDay) : undefined;
    let at: number | undefined;
    if (args.at) {
      const parsed = Date.parse(args.at);
      if (!Number.isNaN(parsed)) at = parsed;
    }
    const recurrence =
      args.recurrence === 'daily' || args.recurrence === 'weekly' || args.recurrence === 'once'
        ? args.recurrence
        : timeOfDay
          ? 'daily'
          : 'once';
    trigger = { kind: 'time', at, timeOfDay, recurrence };
  }

  const reminder: MerlinReminder = {
    id: createEntityId(),
    text,
    trigger,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await saveMerlinReminder(reminder);

  const { rescheduleMerlinReminders } = await import('./merlin-scheduler');
  void rescheduleMerlinReminders();

  let desc = `Rappel créé : « ${text} »`;
  if (trigger.kind === 'time' && trigger.timeOfDay) {
    desc += ` (${trigger.recurrence ?? 'once'} à ${trigger.timeOfDay})`;
  } else if (trigger.kind === 'context') {
    desc += ` (contexte : ${trigger.tags.join(', ')})`;
  }

  return { ok: true, content: desc, mutation: 'reminder_created' };
}

export async function listReminders(): Promise<ToolResult> {
  const reminders = await getMerlinReminders();
  const active = reminders.filter((r) => r.status === 'active');
  if (active.length === 0) {
    return { ok: true, content: 'Aucun rappel actif.' };
  }

  const lines = active.map((r) => {
    if (r.trigger.kind === 'time') {
      const when = r.trigger.timeOfDay ?? (r.trigger.at ? new Date(r.trigger.at).toLocaleString('fr-FR') : '?');
      return `• ${r.text} (${r.trigger.recurrence ?? 'once'} — ${when})`;
    }
    return `• ${r.text} (contexte : ${r.trigger.tags.join(', ')})`;
  });

  return { ok: true, content: `Rappels actifs :\n${lines.join('\n')}` };
}

export async function completeReminder(text?: string): Promise<ToolResult> {
  const reminders = await getMerlinReminders();
  const active = reminders.filter((r) => r.status === 'active');
  if (active.length === 0) {
    return { ok: false, content: 'Aucun rappel actif à terminer.' };
  }

  let target = active[0];
  if (text?.trim()) {
    const n = text.trim().toLowerCase();
    target = active.find((r) => r.text.toLowerCase().includes(n)) ?? target;
  }

  target.status = 'done';
  target.updatedAt = Date.now();
  await saveMerlinReminder(target);

  const { rescheduleMerlinReminders } = await import('./merlin-scheduler');
  void rescheduleMerlinReminders();

  return {
    ok: true,
    content: `Rappel « ${target.text} » marqué comme fait.`,
    mutation: 'reminder_completed',
  };
}

export async function triggerContext(tagsInput: string): Promise<ToolResult> {
  const tags = tagsInput
    .split(/[,;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tags.length === 0) {
    return { ok: false, content: 'Aucun contexte spécifié.' };
  }

  const reminders = await getMerlinReminders();
  const matching = reminders.filter(
    (r) =>
      r.status === 'active' &&
      r.trigger.kind === 'context' &&
      r.trigger.tags.some((t) => tags.includes(t.toLowerCase())),
  );

  if (matching.length === 0) {
    return { ok: true, content: `Aucun rappel pour le contexte « ${tags.join(', ')} ».` };
  }

  const lines = matching.map((r) => `• ${r.text}`);
  return {
    ok: true,
    content: `Rappels pour ${tags.join(', ')} :\n${lines.join('\n')}`,
    mutation: 'reminder_created',
  };
}

export async function deleteList(title: string): Promise<ToolResult> {
  const lists = await getMerlinLists();
  const list = findListFuzzy(lists, title);
  if (!list) return { ok: false, content: `Liste « ${title} » introuvable.` };
  await deleteMerlinList(list.id);
  return { ok: true, content: `Liste « ${list.title} » supprimée.`, mutation: 'list_updated' };
}

const MUTATION_TOOLS = new Set([
  'create_list',
  'add_list_item',
  'toggle_list_item',
  'create_reminder',
  'complete_reminder',
  'trigger_context',
  'delete_list',
]);

export function isMutationTool(name: string): boolean {
  return MUTATION_TOOLS.has(name);
}

export async function executeMerlinTool(
  name: string,
  args: Record<string, string>,
): Promise<ToolResult> {
  if (await isCustomToolName(name)) {
    const { executeCustomTool } = await import('./merlin-tool-registry');
    return executeCustomTool(name, args);
  }

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
    case 'create_list':
      return createList(args.title ?? args.list ?? '');
    case 'add_list_item':
      return addListItem(args.list ?? args.title ?? 'courses', args.item ?? args.text ?? '');
    case 'toggle_list_item':
      return toggleListItem(args.list ?? args.title ?? '', args.item ?? args.text ?? '');
    case 'show_lists':
      return showLists(args.list ?? args.title);
    case 'create_reminder':
      return createReminder({
        text: args.text ?? '',
        timeOfDay: args.timeOfDay ?? args.time,
        at: args.at,
        recurrence: args.recurrence,
        contextTags: args.contextTags ?? args.tags,
      });
    case 'list_reminders':
      return listReminders();
    case 'complete_reminder':
      return completeReminder(args.text ?? args.item);
    case 'trigger_context':
      return triggerContext(args.tags ?? args.context ?? '');
    case 'delete_list':
      return deleteList(args.list ?? args.title ?? '');
    case 'save_custom_tool': {
      const { saveCustomToolFromArgs } = await import('./merlin-custom-tools');
      return saveCustomToolFromArgs(args);
    }
    default: {
      const custom = await getMerlinCustomToolByName(name);
      if (custom) {
        const { executeCustomTool } = await import('./merlin-tool-registry');
        return executeCustomTool(name, args);
      }
      return { ok: false, content: `Outil inconnu : ${name}` };
    }
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TOOL_DOCS = `- read_journal(date) — lire la note d'un jour (AAAA-MM-JJ)
- search_journal(query) — chercher dans toutes les notes
- summarize_period(from, to) — lister les notes d'une période
- create_list(title) — créer une liste
- add_list_item(list, item) — ajouter un article à une liste
- toggle_list_item(list, item) — cocher/décocher un article
- show_lists(list?) — afficher les listes ou une liste
- create_reminder(text, timeOfDay?, recurrence?, contextTags?) — créer un rappel horaire ou contextuel
- list_reminders() — lister les rappels actifs
- complete_reminder(text?) — marquer un rappel comme fait
- trigger_context(tags) — déclencher les rappels d'un contexte (ex. travail, maison)
- save_custom_tool(name, description, steps_json) — sauvegarder une routine réutilisable`;

export function templateReplyForTool(name: string, toolResult: ToolResult): string | null {
  if (!toolResult.ok) return toolResult.content;
  if (isMutationTool(name) || name === 'save_custom_tool') {
    return toolResult.content;
  }
  return null;
}
