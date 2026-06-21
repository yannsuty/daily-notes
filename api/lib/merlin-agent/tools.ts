import { addDays, formatDateLabel, todayKey } from './dates.js';
import type {
  AgentContext,
  AgentMutations,
  AgentSideEffect,
  MerlinCustomTool,
  MerlinList,
  MerlinListItem,
  MerlinReminder,
  ToolResult,
} from './types.js';

export function createEntityId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const MUTATION_TOOLS = new Set([
  'create_list',
  'add_list_item',
  'toggle_list_item',
  'create_reminder',
  'complete_reminder',
  'trigger_context',
  'delete_list',
  'save_custom_tool',
]);

const PRIMITIVE_TOOLS = new Set([
  'read_journal',
  'search_journal',
  'summarize_period',
  'create_list',
  'add_list_item',
  'toggle_list_item',
  'show_lists',
  'create_reminder',
  'list_reminders',
  'complete_reminder',
  'trigger_context',
  'delete_list',
  'save_custom_tool',
]);

const MAX_CUSTOM_STEPS = 5;

export function isMutationTool(name: string): boolean {
  return MUTATION_TOOLS.has(name);
}

export function templateReplyForTool(name: string, toolResult: ToolResult): string | null {
  if (!toolResult.ok) return toolResult.content;
  if (isMutationTool(name) || name === 'save_custom_tool') {
    return toolResult.content;
  }
  return null;
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

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTimeOfDay(input: string): string | undefined {
  const m = input.match(/(\d{1,2})[:h](\d{2})?/);
  if (!m) return undefined;
  const h = String(Number(m[1])).padStart(2, '0');
  const min = m[2] ? String(Number(m[2])).padStart(2, '0') : '00';
  return `${h}:${min}`;
}

function resolveArgs(
  template: Record<string, string>,
  params: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(template)) {
    resolved[key] = value.replace(/\{\{(\w+)\}\}/g, (_, param) => params[param] ?? '');
  }
  return resolved;
}

export class AgentStore {
  days: Record<string, { content: string; updatedAt: number }>;
  lists: MerlinList[];
  reminders: MerlinReminder[];
  customTools: MerlinCustomTool[];

  private dirtyLists = new Set<string>();
  private dirtyReminders = new Set<string>();
  private dirtyCustomTools = new Set<string>();

  constructor(context: AgentContext) {
    this.days = { ...context.days };
    this.lists = context.lists.map((list) => ({
      ...list,
      items: list.items.map((item) => ({ ...item })),
    }));
    this.reminders = context.reminders.map((r) => ({ ...r, trigger: { ...r.trigger } as MerlinReminder['trigger'] }));
    this.customTools = context.customTools.map((t) => ({
      ...t,
      steps: t.steps.map((s) => ({ ...s, args: { ...s.args } })),
    }));
  }

  getMutations(): AgentMutations {
    const mutations: AgentMutations = {};
    if (this.dirtyLists.size > 0) {
      mutations.lists = this.lists;
    }
    if (this.dirtyReminders.size > 0) {
      mutations.reminders = this.reminders;
    }
    if (this.dirtyCustomTools.size > 0) {
      mutations.customTools = this.customTools;
    }
    return mutations;
  }

  private markList(list: MerlinList): void {
    this.dirtyLists.add(list.id);
  }

  private markReminder(reminder: MerlinReminder): void {
    this.dirtyReminders.add(reminder.id);
  }

  private markCustomTool(tool: MerlinCustomTool): void {
    this.dirtyCustomTools.add(tool.id);
  }

  readJournal(dateKey: string): ToolResult {
    const entry = this.days[dateKey];
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

  searchJournal(query: string, maxResults = 8): ToolResult {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return { ok: false, content: 'Requête de recherche vide.' };
    }

    const matches: { dateKey: string; excerpt: string; score: number }[] = [];

    for (const [dateKey, entry] of Object.entries(this.days)) {
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
      return { ok: true, content: `Aucun résultat dans le journal pour « ${query} ».` };
    }

    const body = top
      .map((m) => `• ${formatDateLabel(m.dateKey)} (${m.dateKey}) : ${m.excerpt}`)
      .join('\n');

    return {
      ok: true,
      content: `${top.length} résultat(s) pour « ${query} » :\n${body}`,
    };
  }

  summarizePeriod(fromDate: string, toDate: string): ToolResult {
    const dates = Object.keys(this.days)
      .filter((d) => d >= fromDate && d <= toDate && this.days[d].content.trim())
      .sort();

    if (dates.length === 0) {
      return { ok: true, content: `Aucune note entre le ${fromDate} et le ${toDate}.` };
    }

    const excerpts = dates.map((dateKey) => {
      const body = this.days[dateKey].content.trim().slice(0, 600);
      return `## ${dateKey}\n${body}`;
    });

    return {
      ok: true,
      content: `Notes du ${fromDate} au ${toDate} (${dates.length} jour(s)) :\n\n${excerpts.join('\n\n')}`,
    };
  }

  createList(title: string): ToolResult {
    const trimmed = title.trim();
    if (!trimmed) return { ok: false, content: 'Titre de liste vide.' };

    const existing = findListByTitle(this.lists, trimmed);
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
    this.lists.push(list);
    this.markList(list);
    return { ok: true, content: `Liste « ${trimmed} » créée.`, mutation: 'list_updated' };
  }

  addListItem(listTitle: string, itemText: string): ToolResult {
    const text = itemText.trim();
    if (!text) return { ok: false, content: 'Article vide.' };

    let list = findListFuzzy(this.lists, listTitle);
    if (!list) {
      const created = this.createList(listTitle.trim() || 'courses');
      if (!created.ok) return created;
      list = findListByTitle(this.lists, listTitle.trim() || 'courses');
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
    list.updatedAt = now;
    this.markList(list);
    return {
      ok: true,
      content: `« ${text} » ajouté à ${list.title}.`,
      mutation: 'list_updated',
    };
  }

  toggleListItem(listTitle: string, itemText: string): ToolResult {
    const list = findListFuzzy(this.lists, listTitle);
    if (!list) return { ok: false, content: `Liste « ${listTitle} » introuvable.` };

    const n = itemText.trim().toLowerCase();
    const item = list.items.find((i) => i.text.toLowerCase().includes(n));
    if (!item) return { ok: false, content: `« ${itemText} » introuvable dans ${list.title}.` };

    item.done = !item.done;
    item.updatedAt = Date.now();
    list.updatedAt = Date.now();
    this.markList(list);
    return {
      ok: true,
      content: item.done
        ? `« ${item.text} » coché dans ${list.title}.`
        : `« ${item.text} » décoché dans ${list.title}.`,
      mutation: 'list_updated',
    };
  }

  showLists(listTitle?: string): ToolResult {
    if (this.lists.length === 0) {
      return { ok: true, content: 'Aucune liste pour le moment.' };
    }

    const target = listTitle ? findListFuzzy(this.lists, listTitle) : null;
    const toShow = target ? [target] : this.lists;

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

  createReminder(args: {
    text: string;
    timeOfDay?: string;
    at?: string;
    recurrence?: string;
    contextTags?: string;
  }): ToolResult {
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
    this.reminders.push(reminder);
    this.markReminder(reminder);

    let desc = `Rappel créé : « ${text} »`;
    if (trigger.kind === 'time' && trigger.timeOfDay) {
      desc += ` (${trigger.recurrence ?? 'once'} à ${trigger.timeOfDay})`;
    } else if (trigger.kind === 'context') {
      desc += ` (contexte : ${trigger.tags.join(', ')})`;
    }

    return { ok: true, content: desc, mutation: 'reminder_created' };
  }

  listReminders(): ToolResult {
    const active = this.reminders.filter((r) => r.status === 'active');
    if (active.length === 0) {
      return { ok: true, content: 'Aucun rappel actif.' };
    }

    const lines = active.map((r) => {
      if (r.trigger.kind === 'time') {
        const when =
          r.trigger.timeOfDay ??
          (r.trigger.at ? new Date(r.trigger.at).toLocaleString('fr-FR') : '?');
        return `• ${r.text} (${r.trigger.recurrence ?? 'once'} — ${when})`;
      }
      return `• ${r.text} (contexte : ${r.trigger.tags.join(', ')})`;
    });

    return { ok: true, content: `Rappels actifs :\n${lines.join('\n')}` };
  }

  completeReminder(text?: string): ToolResult {
    const active = this.reminders.filter((r) => r.status === 'active');
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
    this.markReminder(target);

    return {
      ok: true,
      content: `Rappel « ${target.text} » marqué comme fait.`,
      mutation: 'reminder_completed',
    };
  }

  triggerContext(tagsInput: string): ToolResult {
    const tags = tagsInput
      .split(/[,;]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (tags.length === 0) {
      return { ok: false, content: 'Aucun contexte spécifié.' };
    }

    const matching = this.reminders.filter(
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

  deleteList(title: string): ToolResult {
    const list = findListFuzzy(this.lists, title);
    if (!list) return { ok: false, content: `Liste « ${title} » introuvable.` };
    this.lists = this.lists.filter((l) => l.id !== list.id);
    this.dirtyLists.add(list.id);
    return { ok: true, content: `Liste « ${list.title} » supprimée.`, mutation: 'list_updated' };
  }

  saveCustomTool(args: Record<string, string>): ToolResult {
    const name = (args.name ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    const description = (args.description ?? args.desc ?? 'Routine personnalisée').trim();
    const stepsRaw = args.steps_json ?? args.steps ?? '[]';

    if (!name) return { ok: false, content: 'Nom de routine manquant.' };

    let steps: { tool: string; args: Record<string, string> }[];
    try {
      steps = JSON.parse(stepsRaw) as { tool: string; args: Record<string, string> }[];
    } catch {
      return { ok: false, content: 'steps_json invalide.' };
    }

    if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_CUSTOM_STEPS) {
      return { ok: false, content: 'Routine vide ou trop longue.' };
    }

    for (const step of steps) {
      if (!PRIMITIVE_TOOLS.has(step.tool) || step.tool === 'save_custom_tool') {
        return { ok: false, content: `Étape interdite : ${step.tool}` };
      }
    }

    const now = Date.now();
    const existing = this.customTools.find((t) => t.name.toLowerCase() === name);
    const tool: MerlinCustomTool = {
      id: existing?.id ?? createEntityId(),
      name,
      description,
      steps,
      source: 'auto',
      usageCount: existing?.usageCount ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) {
      this.customTools = this.customTools.map((t) => (t.id === tool.id ? tool : t));
    } else {
      this.customTools.push(tool);
    }
    this.markCustomTool(tool);

    return { ok: true, content: `Routine « ${name} » enregistrée.`, mutation: 'list_updated' };
  }

  executeCustomTool(name: string, args: Record<string, string>): ToolResult {
    const tool = this.customTools.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!tool) {
      return { ok: false, content: `Routine « ${name} » introuvable.` };
    }

    if (tool.steps.length > MAX_CUSTOM_STEPS) {
      return { ok: false, content: 'Routine trop longue.' };
    }

    const results: string[] = [];
    let lastMutation: AgentSideEffect | undefined;

    for (const step of tool.steps) {
      if (!PRIMITIVE_TOOLS.has(step.tool)) {
        return { ok: false, content: `Étape interdite : ${step.tool}` };
      }
      const stepArgs = resolveArgs(step.args, args);
      const result = this.executeTool(step.tool, stepArgs);
      if (!result.ok) return result;
      results.push(result.content);
      if (result.mutation) lastMutation = result.mutation;
    }

    tool.usageCount += 1;
    tool.updatedAt = Date.now();
    this.markCustomTool(tool);

    return { ok: true, content: results.join('\n'), mutation: lastMutation };
  }

  executeTool(name: string, args: Record<string, string>): ToolResult {
    const custom = this.customTools.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (custom) {
      return this.executeCustomTool(name, args);
    }

    switch (name) {
      case 'read_journal':
        return this.readJournal(args.date ?? todayKey());
      case 'search_journal':
        return this.searchJournal(args.query ?? '');
      case 'summarize_period':
        return this.summarizePeriod(
          args.from ?? addDays(todayKey(), -7),
          args.to ?? todayKey(),
        );
      case 'create_list':
        return this.createList(args.title ?? args.list ?? '');
      case 'add_list_item':
        return this.addListItem(args.list ?? args.title ?? 'courses', args.item ?? args.text ?? '');
      case 'toggle_list_item':
        return this.toggleListItem(args.list ?? args.title ?? '', args.item ?? args.text ?? '');
      case 'show_lists':
        return this.showLists(args.list ?? args.title);
      case 'create_reminder':
        return this.createReminder({
          text: args.text ?? '',
          timeOfDay: args.timeOfDay ?? args.time,
          at: args.at,
          recurrence: args.recurrence,
          contextTags: args.contextTags ?? args.tags,
        });
      case 'list_reminders':
        return this.listReminders();
      case 'complete_reminder':
        return this.completeReminder(args.text ?? args.item);
      case 'trigger_context':
        return this.triggerContext(args.tags ?? args.context ?? '');
      case 'delete_list':
        return this.deleteList(args.list ?? args.title ?? '');
      case 'save_custom_tool':
        return this.saveCustomTool(args);
      default:
        return { ok: false, content: `Outil inconnu : ${name}` };
    }
  }
}
