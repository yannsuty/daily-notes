import { addDays, formatDateLabel, todayKey } from '../../lib/merlin-agent/dates.js';
import { formatGitHubSummary, inspectGitHubRepo } from '../../lib/merlin-agent/github.js';
import { mergeSpaceData } from '../../lib/merlin-agent/space-merge.js';
import { findSpaceByRef } from '../../lib/merlin-agent/space-match.js';
import {
  isWebTool,
  MAX_CUSTOM_ROUTINE_STEPS,
} from '../../lib/merlin-agent/primitive-tools.js';
import {
  buildRoutineParams,
  createRoutineContext,
  formatRoutineParamsHint,
  parseRoutineParams,
  parseRoutineSteps,
  recordRoutineStepResult,
  resolveRoutineArgs,
  shouldRunRoutineStep,
} from '../../lib/merlin-agent/routine.js';
import { mergeWebSources } from '../../lib/merlin-agent/web.js';
import { normalizeReminderArgs } from '../../lib/merlin-agent/reminder-text.js';
import { runWebTool } from './web-tools.js';
import type {
  AgentClientConfig,
  AgentContext,
  AgentMutations,
  AgentSideEffect,
  MerlinCustomTool,
  MerlinList,
  MerlinListItem,
  MerlinReminder,
  MerlinSpace,
  MerlinSpaceData,
  MerlinSpaceKind,
  ToolResult,
  WebSource,
} from '../../lib/merlin-agent/types.js';

export function createEntityId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface SerializedAgentStore {
  days: Record<string, { content: string; updatedAt: number }>;
  lists: MerlinList[];
  reminders: MerlinReminder[];
  customTools: MerlinCustomTool[];
  spaces: MerlinSpace[];
  githubToken?: string;
  activeSpaceId?: string | null;
  activeSpace?: MerlinSpace | null;
  dirtyLists: string[];
  dirtyReminders: string[];
  dirtyCustomTools: string[];
  dirtySpaces: string[];
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
  'create_space',
  'update_space',
]);

/** Mutations qui renvoient tout de suite sans laisser l'agent formuler (listes, rappels). */
const IMMEDIATE_REPLY_TOOLS = new Set([
  'create_list',
  'add_list_item',
  'toggle_list_item',
  'create_reminder',
  'complete_reminder',
  'trigger_context',
  'delete_list',
  'save_custom_tool',
]);

const SPACE_KINDS = new Set<MerlinSpaceKind>(['comparison', 'diy', 'plan', 'recipe']);

export function isMutationTool(name: string): boolean {
  return MUTATION_TOOLS.has(name);
}

export function isImmediateReplyTool(name: string): boolean {
  return IMMEDIATE_REPLY_TOOLS.has(name);
}

export function parseSpaceDataJson(raw: unknown): MerlinSpaceData | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as MerlinSpaceData;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as MerlinSpaceData;
  } catch {
    return null;
  }
}

export function normalizeToolArgs(args: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      normalized[key] = value;
    } else if (typeof value === 'object') {
      normalized[key] = JSON.stringify(value);
    } else {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

export function templateReplyForTool(name: string, toolResult: ToolResult): string | null {
  if (!toolResult.ok) return toolResult.content;
  if (isImmediateReplyTool(name)) {
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

export class AgentStore {
  days: Record<string, { content: string; updatedAt: number }>;
  lists: MerlinList[];
  reminders: MerlinReminder[];
  customTools: MerlinCustomTool[];
  spaces: MerlinSpace[];
  githubToken?: string;
  private activeSpaceId?: string | null;
  private activeSpace?: MerlinSpace | null;

  private dirtyLists = new Set<string>();
  private dirtyReminders = new Set<string>();
  private dirtyCustomTools = new Set<string>();
  private dirtySpaces = new Set<string>();

  constructor(context: AgentContext, options?: { githubToken?: string }) {
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
    this.spaces = (context.spaces ?? []).map((s) => ({
      ...s,
      data: JSON.parse(JSON.stringify(s.data)) as MerlinSpaceData,
    }));
    this.activeSpaceId = context.activeSpaceId ?? context.activeSpace?.id ?? null;
    this.activeSpace = context.activeSpace ?? null;

    if (
      context.activeSpace &&
      !this.spaces.some((s) => s.id === context.activeSpace!.id)
    ) {
      this.spaces.push({
        ...context.activeSpace,
        data: JSON.parse(JSON.stringify(context.activeSpace.data)) as MerlinSpaceData,
      });
    }

    this.githubToken = options?.githubToken;
  }

  getActiveSpace(): MerlinSpace | undefined {
    if (this.activeSpaceId) {
      const inStore = this.spaces.find((s) => s.id === this.activeSpaceId);
      if (inStore) return inStore;
    }
    if (this.activeSpace) {
      const inStore = this.spaces.find((s) => s.id === this.activeSpace!.id);
      if (inStore) return inStore;
      return this.activeSpace;
    }
    return undefined;
  }

  private resolveSpace(idOrTitle?: string): MerlinSpace | undefined {
    const trimmed = idOrTitle?.trim();
    if (trimmed) {
      const found = this.findSpace(trimmed);
      if (found) return found;
      return this.getActiveSpace();
    }
    return this.getActiveSpace();
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
    if (this.dirtySpaces.size > 0) {
      mutations.spaces = this.spaces;
    }
    return mutations;
  }

  private markSpace(space: MerlinSpace): void {
    this.dirtySpaces.add(space.id);
  }

  hasDirtySpaces(): boolean {
    return this.dirtySpaces.size > 0;
  }

  toSnapshot(): SerializedAgentStore {
    return {
      days: this.days,
      lists: this.lists,
      reminders: this.reminders,
      customTools: this.customTools,
      spaces: this.spaces,
      githubToken: this.githubToken,
      activeSpaceId: this.activeSpaceId ?? null,
      activeSpace: this.activeSpace ?? null,
      dirtyLists: [...this.dirtyLists],
      dirtyReminders: [...this.dirtyReminders],
      dirtyCustomTools: [...this.dirtyCustomTools],
      dirtySpaces: [...this.dirtySpaces],
    };
  }

  static fromSnapshot(snapshot: SerializedAgentStore): AgentStore {
    const store = Object.create(AgentStore.prototype) as AgentStore;
    store.days = snapshot.days;
    store.lists = snapshot.lists;
    store.reminders = snapshot.reminders;
    store.customTools = snapshot.customTools;
    store.spaces = snapshot.spaces;
    store.githubToken = snapshot.githubToken;
    store.activeSpaceId = snapshot.activeSpaceId;
    store.activeSpace = snapshot.activeSpace;
    store.dirtyLists = new Set(snapshot.dirtyLists);
    store.dirtyReminders = new Set(snapshot.dirtyReminders);
    store.dirtyCustomTools = new Set(snapshot.dirtyCustomTools);
    store.dirtySpaces = new Set(snapshot.dirtySpaces);
    return store;
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
    const normalized = normalizeReminderArgs(args);
    const text = normalized.text.trim();
    if (!text) return { ok: false, content: 'Rappel vide.' };

    const now = Date.now();
    let trigger: MerlinReminder['trigger'];

    if (normalized.contextTags) {
      const tags = normalized.contextTags
        .split(/[,;]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      trigger = { kind: 'context', tags: tags.length > 0 ? tags : ['general'] };
    } else {
      const timeOfDay = normalized.timeOfDay ? parseTimeOfDay(normalized.timeOfDay) : undefined;
      let at: number | undefined;
      if (normalized.at) {
        const parsed = Date.parse(normalized.at);
        if (!Number.isNaN(parsed)) at = parsed;
      }
      const recurrence =
        normalized.recurrence === 'daily' ||
        normalized.recurrence === 'weekly' ||
        normalized.recurrence === 'once'
          ? normalized.recurrence
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

  private findSpace(idOrTitle: string): MerlinSpace | undefined {
    const active = this.getActiveSpace();
    return findSpaceByRef(this.spaces, idOrTitle, {
      activeSpaceId: this.activeSpaceId ?? active?.id,
      kindHint: active?.kind,
    });
  }

  private formatSpaceContent(space: MerlinSpace): string {
    const lines = [`**${space.title}** (${space.kind})`, space.recap];
    const { data } = space;

    if (space.kind === 'comparison' && data.columns?.length) {
      lines.push('\n| ' + data.columns.join(' | ') + ' |');
      lines.push('| ' + data.columns.map(() => '---').join(' | ') + ' |');
      for (const row of data.rows ?? []) {
        lines.push('| ' + row.join(' | ') + ' |');
      }
    }

    if (space.kind === 'diy') {
      if (data.intro) lines.push(`\n${data.intro}`);
      for (const section of data.sections ?? []) {
        lines.push(`\n### ${section.title}\n${section.content}`);
      }
    }

    if (space.kind === 'plan') {
      if (data.goal) lines.push(`\nObjectif : ${data.goal}`);
      if (data.github) lines.push(`Repo : ${data.github.owner}/${data.github.repo}`);
      for (const m of data.milestones ?? []) {
        lines.push(`${m.done ? '✓' : '○'} ${m.title}`);
      }
    }

    if (space.kind === 'recipe') {
      if (data.servings) lines.push(`\nPortions : ${data.servings}`);
      lines.push('\n**Ingrédients**');
      for (const ing of data.ingredients ?? []) {
        const qty = [ing.quantity, ing.unit].filter(Boolean).join(' ');
        lines.push(`- ${qty ? `${qty} ` : ''}${ing.text}`);
      }
      lines.push('\n**Étapes**');
      for (const step of [...(data.steps ?? [])].sort((a, b) => a.order - b.order)) {
        lines.push(`${step.order}. ${step.text}`);
      }
    }

    lines.push(`\n(id: ${space.id})`);
    return lines.join('\n');
  }

  createSpace(args: {
    kind: string;
    title: string;
    recap?: string;
    data_json?: string;
    create_todo_list?: string;
  }): ToolResult {
    const kind = (args.kind ?? '').trim().toLowerCase() as MerlinSpaceKind;
    if (!SPACE_KINDS.has(kind)) {
      return { ok: false, content: `Type d'espace invalide : ${args.kind}` };
    }

    const title = (args.title ?? '').trim();
    if (!title) return { ok: false, content: 'Titre d\'espace vide.' };

    let data: MerlinSpaceData = {};
    const parsedData = parseSpaceDataJson(args.data_json);
    if (parsedData === null && args.data_json !== undefined && args.data_json !== null && String(args.data_json).trim()) {
      return { ok: false, content: 'data_json invalide.' };
    }
    if (parsedData) data = parsedData;

    if (kind === 'diy' && args.create_todo_list === 'true') {
      const listResult = this.createList(`DIY — ${title}`);
      if (listResult.ok) {
        const list = findListByTitle(this.lists, `DIY — ${title}`);
        if (list) data.listId = list.id;
      }
    }

    const now = Date.now();
    const space: MerlinSpace = {
      id: createEntityId(),
      kind,
      title,
      recap: (args.recap ?? '').trim() || title,
      data,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    this.spaces.push(space);
    this.markSpace(space);

    return {
      ok: true,
      content: `Espace « ${title} » créé (${kind}, id: ${space.id}). Consultez-le dans Galerie → Espaces.\n\n${this.formatSpaceContent(space)}`,
      mutation: 'space_updated',
    };
  }

  updateSpace(args: {
    space_id?: string;
    title?: string;
    recap?: string;
    data_json?: string;
    status?: string;
    append?: string;
  }): ToolResult {
    const ref = args.space_id ?? args.title;
    const space = this.resolveSpace(ref);
    if (!space) {
      const label = ref?.trim() || 'contexte actif';
      return { ok: false, content: `Espace « ${label} » introuvable.` };
    }

    if (args.recap?.trim()) space.recap = args.recap.trim();
    if (args.status === 'archived' || args.status === 'active') {
      space.status = args.status;
    }
    if (args.data_json !== undefined && args.data_json !== null && String(args.data_json).trim()) {
      const patch = parseSpaceDataJson(args.data_json);
      if (patch === null) {
        return { ok: false, content: 'data_json invalide.' };
      }
      const append = args.append === 'true' || args.append === '1';
      space.data = mergeSpaceData(space.kind, space.data, patch, { append });
    }

    space.updatedAt = Date.now();
    this.markSpace(space);

    return {
      ok: true,
      content: `Espace « ${space.title} » mis à jour.\n\n${this.formatSpaceContent(space)}`,
      mutation: 'space_updated',
    };
  }

  showSpace(idOrTitle?: string): ToolResult {
    if (!idOrTitle?.trim()) {
      const active = this.getActiveSpace();
      if (active) {
        return { ok: true, content: this.formatSpaceContent(active) };
      }

      const allActive = this.spaces.filter((s) => s.status === 'active');
      if (allActive.length === 0) {
        return { ok: true, content: 'Aucun espace actif.' };
      }
      return {
        ok: true,
        content: allActive.map((s) => this.formatSpaceContent(s)).join('\n\n---\n\n'),
      };
    }

    const space = this.resolveSpace(idOrTitle);
    if (!space) return { ok: false, content: `Espace « ${idOrTitle} » introuvable.` };
    return { ok: true, content: this.formatSpaceContent(space) };
  }

  listSpaces(kind?: string): ToolResult {
    let filtered = this.spaces.filter((s) => s.status === 'active');
    if (kind?.trim()) {
      const k = kind.trim().toLowerCase() as MerlinSpaceKind;
      filtered = filtered.filter((s) => s.kind === k);
    }

    if (filtered.length === 0) {
      return { ok: true, content: 'Aucun espace enregistré.' };
    }

    const lines = filtered
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => `• [${s.kind}] ${s.title} — ${s.recap.slice(0, 80)} (id: ${s.id})`);

    return { ok: true, content: `Espaces (${filtered.length}) :\n${lines.join('\n')}` };
  }

  async inspectGitHubRepo(owner: string, repo: string): Promise<ToolResult> {
    const o = owner.trim();
    const r = repo.trim();
    if (!o || !r) return { ok: false, content: 'owner et repo requis.' };

    const result = await inspectGitHubRepo(o, r, this.githubToken);
    if (!result.ok) return { ok: false, content: result.error };
    return { ok: true, content: formatGitHubSummary(result.summary) };
  }

  saveCustomTool(args: Record<string, string>): ToolResult {
    const name = (args.name ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    const description = (args.description ?? args.desc ?? 'Routine personnalisée').trim();
    const stepsRaw = args.steps_json ?? args.steps ?? '[]';
    const paramsRaw = args.params_json ?? args.params ?? '';

    if (!name) return { ok: false, content: 'Nom de routine manquant.' };

    const parsedSteps = parseRoutineSteps(stepsRaw);
    if (!parsedSteps.ok) return { ok: false, content: parsedSteps.error };

    const parsedParams = parseRoutineParams(paramsRaw);
    if (!Array.isArray(parsedParams)) {
      return { ok: false, content: parsedParams.error };
    }

    const now = Date.now();
    const existing = this.customTools.find((t) => t.name.toLowerCase() === name);
    const tool: MerlinCustomTool = {
      id: existing?.id ?? createEntityId(),
      name,
      description,
      steps: parsedSteps.steps,
      params: parsedParams.length > 0 ? parsedParams : undefined,
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

    return {
      ok: true,
      content: `Routine « ${name} » enregistrée (${parsedSteps.steps.length} étape(s)${formatRoutineParamsHint(parsedParams)}).`,
      mutation: 'list_updated',
    };
  }

  isCustomTool(name: string): boolean {
    return this.customTools.some((t) => t.name.toLowerCase() === name.toLowerCase());
  }

  private findCustomTool(name: string): MerlinCustomTool | undefined {
    return this.customTools.find((t) => t.name.toLowerCase() === name.toLowerCase());
  }

  private executeToolSync(name: string, args: Record<string, string>): ToolResult {
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
      case 'create_space':
        return this.createSpace({
          kind: args.kind ?? '',
          title: args.title ?? '',
          recap: args.recap,
          data_json: args.data_json,
          create_todo_list: args.create_todo_list,
        });
      case 'update_space':
        return this.updateSpace({
          space_id: args.space_id ?? args.id,
          title: args.title,
          recap: args.recap,
          data_json: args.data_json,
          status: args.status,
          append: args.append,
        });
      case 'show_space':
        return this.showSpace(args.space_id ?? args.title ?? args.id);
      case 'list_spaces':
        return this.listSpaces(args.kind);
      default:
        return { ok: false, content: `Outil inconnu : ${name}` };
    }
  }

  private async executeStepAsync(
    name: string,
    args: Record<string, string>,
    config: AgentClientConfig,
  ): Promise<ToolResult> {
    if (isWebTool(name)) {
      return runWebTool(name, args, config);
    }
    if (name === 'inspect_github_repo') {
      return this.inspectGitHubRepo(args.owner ?? '', args.repo ?? '');
    }
    return this.executeToolSync(name, args);
  }

  async executeCustomToolAsync(
    name: string,
    args: Record<string, string>,
    config: AgentClientConfig,
  ): Promise<ToolResult> {
    const tool = this.findCustomTool(name);
    if (!tool) {
      return { ok: false, content: `Routine « ${name} » introuvable.` };
    }

    if (tool.steps.length > MAX_CUSTOM_ROUTINE_STEPS) {
      return { ok: false, content: 'Routine trop longue.' };
    }

    const routineContext = createRoutineContext(buildRoutineParams(tool.params, args));
    const results: string[] = [];
    let lastMutation: AgentSideEffect | undefined;
    let webSources: WebSource[] = [];
    let executed = 0;

    for (const step of tool.steps) {
      if (!shouldRunRoutineStep(step, routineContext)) {
        continue;
      }

      const stepArgs = resolveRoutineArgs(step.args ?? {}, routineContext);
      const result = await this.executeStepAsync(step.tool, stepArgs, config);
      recordRoutineStepResult(routineContext, step.tool, result.content, result.ok);
      if (!result.ok) {
        return { ...result, webSources: mergeWebSources(webSources, result.webSources ?? []) };
      }
      results.push(`[${step.tool}]\n${result.content}`);
      executed += 1;
      if (result.webSources?.length) {
        webSources = mergeWebSources(webSources, result.webSources);
      }
      if (result.mutation) lastMutation = result.mutation;
    }

    if (executed === 0) {
      return { ok: false, content: `Routine « ${name} » : aucune étape exécutée (conditions non remplies).` };
    }

    tool.usageCount += 1;
    tool.updatedAt = Date.now();
    this.markCustomTool(tool);

    return {
      ok: true,
      content: results.join('\n\n'),
      mutation: lastMutation,
      webSources,
    };
  }

  async executeToolAsync(
    name: string,
    rawArgs: Record<string, unknown>,
    config: AgentClientConfig = {},
  ): Promise<ToolResult> {
    const args = normalizeToolArgs(rawArgs);
    if (this.isCustomTool(name)) {
      return this.executeCustomToolAsync(name, args, config);
    }
    if (isWebTool(name)) {
      return runWebTool(name, args, config);
    }
    if (name === 'inspect_github_repo') {
      return this.inspectGitHubRepo(args.owner ?? '', args.repo ?? '');
    }
    return this.executeToolSync(name, args);
  }

  async executeTool(
    name: string,
    rawArgs: Record<string, unknown>,
    config: AgentClientConfig = {},
  ): Promise<ToolResult> {
    return this.executeToolAsync(name, rawArgs, config);
  }
}
