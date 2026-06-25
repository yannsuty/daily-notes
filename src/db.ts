import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AppMeta,
  DayEntry,
  MerlinConversation,
  MerlinCustomTool,
  MerlinEntityDeletions,
  MerlinEnvVar,
  MerlinFact,
  MerlinList,
  MerlinMessage,
  MerlinReminder,
  MerlinShortcut,
  MerlinSpace,
  MerlinSyncData,
  SyncPayload,
} from './types';
import { defaultMeta } from './types';

interface DailyNoteDB extends DBSchema {
  days: {
    key: string;
    value: DayEntry;
  };
  meta: {
    key: string;
    value: AppMeta;
  };
  merlin_conversation: {
    key: string;
    value: MerlinConversation;
  };
  merlin_facts: {
    key: string;
    value: MerlinFact;
  };
  merlin_lists: {
    key: string;
    value: MerlinList;
  };
  merlin_reminders: {
    key: string;
    value: MerlinReminder;
  };
  merlin_shortcuts: {
    key: string;
    value: MerlinShortcut;
  };
  merlin_custom_tools: {
    key: string;
    value: MerlinCustomTool;
  };
  merlin_env: {
    key: string;
    value: MerlinEnvVar;
  };
  merlin_spaces: {
    key: string;
    value: MerlinSpace;
  };
}

const DB_NAME = 'daily-note';
const DB_VERSION = 5;
export const MERLIN_CONVERSATION_ID = 'main';
const MERLIN_DELETIONS_META_KEY = 'merlin_deletions';

let dbPromise: Promise<IDBPDatabase<DailyNoteDB>> | null = null;

function getDb(): Promise<IDBPDatabase<DailyNoteDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DailyNoteDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('days')) {
          db.createObjectStore('days');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('merlin_conversation')) {
            db.createObjectStore('merlin_conversation');
          }
          if (!db.objectStoreNames.contains('merlin_facts')) {
            db.createObjectStore('merlin_facts');
          }
        }
        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains('merlin_lists')) {
            db.createObjectStore('merlin_lists');
          }
          if (!db.objectStoreNames.contains('merlin_reminders')) {
            db.createObjectStore('merlin_reminders');
          }
          if (!db.objectStoreNames.contains('merlin_shortcuts')) {
            db.createObjectStore('merlin_shortcuts');
          }
          if (!db.objectStoreNames.contains('merlin_custom_tools')) {
            db.createObjectStore('merlin_custom_tools');
          }
        }
        if (oldVersion < 4) {
          if (!db.objectStoreNames.contains('merlin_env')) {
            db.createObjectStore('merlin_env');
          }
        }
        if (oldVersion < 5) {
          if (!db.objectStoreNames.contains('merlin_spaces')) {
            db.createObjectStore('merlin_spaces');
          }
        }
      },
    });
  }
  return dbPromise;
}

export async function getDay(dateKey: string): Promise<DayEntry | undefined> {
  const db = await getDb();
  return db.get('days', dateKey);
}

export async function getDays(dateKeys: string[]): Promise<Map<string, DayEntry>> {
  const db = await getDb();
  const result = new Map<string, DayEntry>();
  await Promise.all(
    dateKeys.map(async (key) => {
      const entry = await db.get('days', key);
      if (entry) result.set(key, entry);
    }),
  );
  return result;
}

export async function saveDay(dateKey: string, content: string): Promise<void> {
  const db = await getDb();
  await db.put('days', { content, updatedAt: Date.now() }, dateKey);
}

export async function getMeta(): Promise<AppMeta> {
  const db = await getDb();
  const meta = await db.get('meta', 'app');
  return { ...defaultMeta(), ...meta };
}

export async function saveMeta(partial: Partial<AppMeta>): Promise<AppMeta> {
  const db = await getDb();
  const current = await getMeta();
  const next = { ...current, ...partial };
  await db.put('meta', next, 'app');
  return next;
}

export async function getAllDays(): Promise<Record<string, DayEntry>> {
  const db = await getDb();
  const keys = await db.getAllKeys('days');
  const entries = await db.getAll('days');
  const result: Record<string, DayEntry> = {};
  keys.forEach((key, i) => {
    result[key] = entries[i];
  });
  return result;
}

function emptyConversation(): MerlinConversation {
  return {
    id: MERLIN_CONVERSATION_ID,
    messages: [],
    summary: '',
    updatedAt: Date.now(),
  };
}

export async function getMerlinConversation(): Promise<MerlinConversation> {
  const db = await getDb();
  const conv = await db.get('merlin_conversation', MERLIN_CONVERSATION_ID);
  return conv ?? emptyConversation();
}

export async function saveMerlinConversation(
  conversation: MerlinConversation,
): Promise<void> {
  const db = await getDb();
  const next = { ...conversation, updatedAt: Date.now() };
  await db.put('merlin_conversation', next, MERLIN_CONVERSATION_ID);
}

export async function appendMerlinMessage(
  message: MerlinMessage,
): Promise<MerlinConversation> {
  const conv = await getMerlinConversation();
  conv.messages.push(message);
  conv.updatedAt = Date.now();
  await saveMerlinConversation(conv);
  return conv;
}

export async function updateMerlinMessageContent(
  messageId: string,
  content: string,
): Promise<MerlinConversation | null> {
  const conv = await getMerlinConversation();
  const message = conv.messages.find((m) => m.id === messageId);
  if (!message) return null;
  message.content = content;
  message.updatedAt = Date.now();
  conv.updatedAt = Date.now();
  await saveMerlinConversation(conv);
  return conv;
}

export async function updateMerlinConversationSummary(
  summary: string,
  trimmedMessages: MerlinMessage[],
): Promise<MerlinConversation> {
  const conv = await getMerlinConversation();
  conv.summary = summary;
  conv.messages = trimmedMessages;
  conv.updatedAt = Date.now();
  await saveMerlinConversation(conv);
  return conv;
}

export async function clearMerlinConversation(): Promise<void> {
  await saveMerlinConversation(emptyConversation());
}

export async function getMerlinFacts(): Promise<MerlinFact[]> {
  const db = await getDb();
  return db.getAll('merlin_facts');
}

export async function saveMerlinFact(fact: MerlinFact): Promise<void> {
  const db = await getDb();
  await db.put('merlin_facts', fact, fact.id);
}

export async function saveMerlinFacts(facts: MerlinFact[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('merlin_facts', 'readwrite');
  for (const fact of facts) {
    await tx.store.put(fact, fact.id);
  }
  await tx.done;
}

export async function deleteMerlinFact(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('merlin_facts', id);
}

export async function clearMerlinFacts(): Promise<void> {
  const db = await getDb();
  await db.clear('merlin_facts');
}

export async function getMerlinLists(): Promise<MerlinList[]> {
  const db = await getDb();
  return db.getAll('merlin_lists');
}

export async function getMerlinList(id: string): Promise<MerlinList | undefined> {
  const db = await getDb();
  return db.get('merlin_lists', id);
}

export async function saveMerlinList(list: MerlinList): Promise<void> {
  const db = await getDb();
  await db.put('merlin_lists', { ...list, updatedAt: Date.now() }, list.id);
  const deletions = await getMerlinDeletions();
  if (deletions.lists[list.id]) {
    delete deletions.lists[list.id];
    await saveMerlinDeletions(deletions);
  }
}

export async function getMerlinDeletions(): Promise<MerlinEntityDeletions> {
  const db = await getDb();
  const stored = (await db.get('meta', MERLIN_DELETIONS_META_KEY)) as MerlinEntityDeletions | undefined;
  return stored ?? { spaces: {}, lists: {} };
}

export async function saveMerlinDeletions(deletions: MerlinEntityDeletions): Promise<void> {
  const db = await getDb();
  await db.put('meta', deletions as unknown as AppMeta, MERLIN_DELETIONS_META_KEY);
}

async function markMerlinSpaceDeleted(id: string): Promise<void> {
  const deletions = await getMerlinDeletions();
  deletions.spaces[id] = Date.now();
  await saveMerlinDeletions(deletions);
}

async function markMerlinListDeleted(id: string): Promise<void> {
  const deletions = await getMerlinDeletions();
  deletions.lists[id] = Date.now();
  await saveMerlinDeletions(deletions);
}

function mergeDeletionMaps(
  local: Record<string, number>,
  remote: Record<string, number>,
): Record<string, number> {
  const merged = { ...local };
  for (const [id, ts] of Object.entries(remote)) {
    merged[id] = Math.max(merged[id] ?? 0, ts);
  }
  return merged;
}

function applyEntityDeletions<T extends { id: string; updatedAt: number }>(
  items: T[],
  deletions: Record<string, number>,
): T[] {
  return items.filter((item) => {
    const deletedAt = deletions[item.id];
    return deletedAt === undefined || item.updatedAt > deletedAt;
  });
}

export async function deleteMerlinList(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('merlin_lists', id);
  await markMerlinListDeleted(id);
}

export async function getActiveLists(): Promise<MerlinList[]> {
  const lists = await getMerlinLists();
  return lists.filter((l) => l.items.some((i) => !i.done));
}

export async function getMerlinReminders(): Promise<MerlinReminder[]> {
  const db = await getDb();
  return db.getAll('merlin_reminders');
}

export async function getMerlinReminder(id: string): Promise<MerlinReminder | undefined> {
  const db = await getDb();
  return db.get('merlin_reminders', id);
}

export async function saveMerlinReminder(reminder: MerlinReminder): Promise<void> {
  const db = await getDb();
  await db.put('merlin_reminders', { ...reminder, updatedAt: Date.now() }, reminder.id);
}

export async function deleteMerlinReminder(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('merlin_reminders', id);
}

export async function getPendingReminders(): Promise<MerlinReminder[]> {
  const reminders = await getMerlinReminders();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  return reminders.filter((r) => {
    if (r.status !== 'active') return false;
    if (r.trigger.kind === 'context') return true;
    if (r.trigger.at && r.trigger.at <= now + dayMs) return true;
    if (r.trigger.timeOfDay) return true;
    return false;
  });
}

export async function getMerlinShortcuts(): Promise<MerlinShortcut[]> {
  const db = await getDb();
  return db.getAll('merlin_shortcuts');
}

export async function saveMerlinShortcut(shortcut: MerlinShortcut): Promise<void> {
  const db = await getDb();
  await db.put('merlin_shortcuts', shortcut, shortcut.id);
}

export async function deleteMerlinShortcut(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('merlin_shortcuts', id);
}

export async function getMerlinCustomTools(): Promise<MerlinCustomTool[]> {
  const db = await getDb();
  return db.getAll('merlin_custom_tools');
}

export async function getMerlinCustomTool(id: string): Promise<MerlinCustomTool | undefined> {
  const db = await getDb();
  return db.get('merlin_custom_tools', id);
}

export async function getMerlinCustomToolByName(
  name: string,
): Promise<MerlinCustomTool | undefined> {
  const tools = await getMerlinCustomTools();
  const normalized = name.toLowerCase().trim();
  return tools.find((t) => t.name.toLowerCase() === normalized);
}

export async function saveMerlinCustomTool(tool: MerlinCustomTool): Promise<void> {
  const db = await getDb();
  await db.put('merlin_custom_tools', { ...tool, updatedAt: Date.now() }, tool.id);
}

export async function deleteMerlinCustomTool(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('merlin_custom_tools', id);
}

export async function getMerlinEnvVars(): Promise<MerlinEnvVar[]> {
  const db = await getDb();
  return db.getAll('merlin_env');
}

export async function getMerlinEnvVar(key: string): Promise<MerlinEnvVar | undefined> {
  const db = await getDb();
  return db.get('merlin_env', key);
}

export async function setMerlinEnvVar(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put(
    'merlin_env',
    {
      key,
      value,
      updatedAt: Date.now(),
    },
    key,
  );
}

export async function deleteMerlinEnvVar(key: string): Promise<void> {
  const db = await getDb();
  await db.delete('merlin_env', key);
}

export async function getMerlinSpaces(): Promise<MerlinSpace[]> {
  const db = await getDb();
  return db.getAll('merlin_spaces');
}

export async function getMerlinSpace(id: string): Promise<MerlinSpace | undefined> {
  const db = await getDb();
  return db.get('merlin_spaces', id);
}

export async function saveMerlinSpace(space: MerlinSpace): Promise<void> {
  const db = await getDb();
  await db.put('merlin_spaces', { ...space, updatedAt: Date.now() }, space.id);
  const deletions = await getMerlinDeletions();
  if (deletions.spaces[space.id]) {
    delete deletions.spaces[space.id];
    await saveMerlinDeletions(deletions);
  }
}

export async function deleteMerlinSpace(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('merlin_spaces', id);
  await markMerlinSpaceDeleted(id);
}

export async function getActiveSpaces(): Promise<MerlinSpace[]> {
  const spaces = await getMerlinSpaces();
  return spaces.filter((s) => s.status === 'active');
}

function mergeLists(local: MerlinList[], remote: MerlinList[]): MerlinList[] {
  const map = new Map<string, MerlinList>();
  for (const list of local) map.set(list.id, list);
  for (const remoteList of remote) {
    const existing = map.get(remoteList.id);
    if (!existing) {
      map.set(remoteList.id, remoteList);
      continue;
    }
    const itemMap = new Map<string, MerlinList['items'][0]>();
    for (const item of existing.items) itemMap.set(item.id, item);
    for (const item of remoteList.items) {
      const prev = itemMap.get(item.id);
      if (!prev || item.updatedAt >= prev.updatedAt) itemMap.set(item.id, item);
    }
    const mergedUpdatedAt = Math.max(existing.updatedAt, remoteList.updatedAt);
    map.set(remoteList.id, {
      ...existing,
      title: remoteList.updatedAt >= existing.updatedAt ? remoteList.title : existing.title,
      items: [...itemMap.values()],
      updatedAt: mergedUpdatedAt,
    });
  }
  return [...map.values()];
}

function mergeById<T extends { id: string; updatedAt: number }>(
  local: T[],
  remote: T[],
): T[] {
  const map = new Map<string, T>();
  for (const item of local) map.set(item.id, item);
  for (const item of remote) {
    const existing = map.get(item.id);
    if (!existing || item.updatedAt >= existing.updatedAt) map.set(item.id, item);
  }
  return [...map.values()];
}

function mergeShortcuts(local: MerlinShortcut[], remote: MerlinShortcut[]): MerlinShortcut[] {
  const map = new Map<string, MerlinShortcut>();
  for (const item of local) map.set(item.id, item);
  for (const item of remote) {
    const existing = map.get(item.id);
    if (!existing || item.lastUsedAt >= existing.lastUsedAt) map.set(item.id, item);
  }
  return [...map.values()];
}

function mergeEnvVars(local: MerlinEnvVar[], remote: MerlinEnvVar[]): MerlinEnvVar[] {
  const map = new Map<string, MerlinEnvVar>();
  for (const item of local) map.set(item.key, item);
  for (const item of remote) {
    const existing = map.get(item.key);
    if (!existing || item.updatedAt >= existing.updatedAt) map.set(item.key, item);
  }
  return [...map.values()];
}

function mergeByName(local: MerlinCustomTool[], remote: MerlinCustomTool[]): MerlinCustomTool[] {
  const map = new Map<string, MerlinCustomTool>();
  for (const tool of local) map.set(tool.name.toLowerCase(), tool);
  for (const tool of remote) {
    const k = tool.name.toLowerCase();
    const existing = map.get(k);
    if (!existing || tool.updatedAt >= existing.updatedAt) map.set(k, tool);
  }
  return [...map.values()];
}

export async function exportMerlinData(): Promise<MerlinSyncData> {
  const [conversation, facts, lists, reminders, shortcuts, customTools, env, spaces, deletions] =
    await Promise.all([
    getMerlinConversation(),
    getMerlinFacts(),
    getMerlinLists(),
    getMerlinReminders(),
    getMerlinShortcuts(),
    getMerlinCustomTools(),
    getMerlinEnvVars(),
    getMerlinSpaces(),
    getMerlinDeletions(),
  ]);
  const timestamps = [
    conversation.updatedAt,
    ...facts.map((f) => f.updatedAt),
    ...lists.map((l) => l.updatedAt),
    ...reminders.map((r) => r.updatedAt),
    ...shortcuts.map((s) => s.lastUsedAt),
    ...customTools.map((t) => t.updatedAt),
    ...env.map((e) => e.updatedAt),
    ...spaces.map((s) => s.updatedAt),
    ...Object.values(deletions.spaces),
    ...Object.values(deletions.lists),
  ];
  return {
    conversation,
    facts,
    lists,
    reminders,
    shortcuts,
    customTools,
    env,
    spaces,
    deletedSpaces: deletions.spaces,
    deletedLists: deletions.lists,
    updatedAt: Math.max(...timestamps, 0),
  };
}

export async function importMerlinData(remote: MerlinSyncData): Promise<void> {
  const local = await exportMerlinData();
  const merged = mergeMerlinData(local, remote);
  await saveMerlinConversation(merged.conversation);
  await saveMerlinFacts(merged.facts);

  const db = await getDb();
  const tx = db.transaction(
    ['merlin_lists', 'merlin_reminders', 'merlin_shortcuts', 'merlin_custom_tools', 'merlin_env', 'merlin_spaces'],
    'readwrite',
  );
  await tx.objectStore('merlin_lists').clear();
  for (const list of merged.lists ?? []) {
    await tx.objectStore('merlin_lists').put(list, list.id);
  }
  await tx.objectStore('merlin_reminders').clear();
  for (const reminder of merged.reminders ?? []) {
    await tx.objectStore('merlin_reminders').put(reminder, reminder.id);
  }
  await tx.objectStore('merlin_shortcuts').clear();
  for (const shortcut of merged.shortcuts ?? []) {
    await tx.objectStore('merlin_shortcuts').put(shortcut, shortcut.id);
  }
  await tx.objectStore('merlin_custom_tools').clear();
  for (const tool of merged.customTools ?? []) {
    await tx.objectStore('merlin_custom_tools').put(tool, tool.id);
  }
  await tx.objectStore('merlin_env').clear();
  for (const envVar of merged.env ?? []) {
    await tx.objectStore('merlin_env').put(envVar, envVar.key);
  }
  await tx.objectStore('merlin_spaces').clear();
  for (const space of merged.spaces ?? []) {
    await tx.objectStore('merlin_spaces').put(space, space.id);
  }
  await tx.done;

  await saveMerlinDeletions({
    spaces: merged.deletedSpaces ?? {},
    lists: merged.deletedLists ?? {},
  });
}

export function mergeMerlinData(
  local: MerlinSyncData,
  remote: MerlinSyncData,
): MerlinSyncData {
  const messageMap = new Map<string, MerlinMessage>();
  for (const msg of local.conversation.messages) {
    messageMap.set(msg.id, msg);
  }
  for (const msg of remote.conversation.messages) {
    const existing = messageMap.get(msg.id);
    if (!existing) {
      messageMap.set(msg.id, msg);
      continue;
    }
    const localTs = existing.updatedAt ?? existing.createdAt;
    const remoteTs = msg.updatedAt ?? msg.createdAt;
    if (remoteTs > localTs) {
      messageMap.set(msg.id, msg);
    } else if (remoteTs === localTs && msg.content.length > existing.content.length) {
      messageMap.set(msg.id, msg);
    }
  }
  const messages = [...messageMap.values()].sort((a, b) => a.createdAt - b.createdAt);

  const factMap = new Map<string, MerlinFact>();
  for (const fact of local.facts) {
    factMap.set(fact.key, fact);
  }
  for (const fact of remote.facts) {
    const existing = factMap.get(fact.key);
    if (!existing || fact.updatedAt >= existing.updatedAt) {
      factMap.set(fact.key, fact);
    }
  }

  const summary =
    local.conversation.summary.length >= remote.conversation.summary.length
      ? local.conversation.summary
      : remote.conversation.summary;

  const updatedAt = Math.max(local.updatedAt, remote.updatedAt);

  const deletedSpaces = mergeDeletionMaps(
    local.deletedSpaces ?? {},
    remote.deletedSpaces ?? {},
  );
  const deletedLists = mergeDeletionMaps(local.deletedLists ?? {}, remote.deletedLists ?? {});

  const mergedLists = applyEntityDeletions(
    mergeLists(local.lists ?? [], remote.lists ?? []),
    deletedLists,
  );
  const mergedSpaces = applyEntityDeletions(
    mergeById(local.spaces ?? [], remote.spaces ?? []),
    deletedSpaces,
  );

  return {
    conversation: {
      id: MERLIN_CONVERSATION_ID,
      messages,
      summary,
      updatedAt: Math.max(local.conversation.updatedAt, remote.conversation.updatedAt),
    },
    facts: [...factMap.values()],
    lists: mergedLists,
    reminders: mergeById(local.reminders ?? [], remote.reminders ?? []),
    shortcuts: mergeShortcuts(local.shortcuts ?? [], remote.shortcuts ?? []),
    customTools: mergeByName(local.customTools ?? [], remote.customTools ?? []),
    env: mergeEnvVars(local.env ?? [], remote.env ?? []),
    spaces: mergedSpaces,
    deletedSpaces,
    deletedLists,
    updatedAt,
  };
}

export async function exportPayload(): Promise<SyncPayload> {
  const [days, meta, merlin] = await Promise.all([
    getAllDays(),
    getMeta(),
    exportMerlinData(),
  ]);
  return {
    days,
    meta: {
      scrollAnchor: meta.scrollAnchor,
      lastVisitDate: meta.lastVisitDate,
      lastSyncAt: meta.lastSyncAt,
      merlinEnabled: meta.merlinEnabled,
      merlinTtsEnabled: meta.merlinTtsEnabled,
      merlinTtsRate: meta.merlinTtsRate,
      merlinContinuousListen: meta.merlinContinuousListen,
    },
    merlin,
  };
}

export async function importDays(
  remoteDays: Record<string, DayEntry>,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('days', 'readwrite');
  const localKeys = await tx.store.getAllKeys();
  const localEntries = await tx.store.getAll();
  const localMap = new Map<string, DayEntry>();
  localKeys.forEach((key, i) => localMap.set(key, localEntries[i]));

  for (const [dateKey, remote] of Object.entries(remoteDays)) {
    const local = localMap.get(dateKey);
    if (!local || remote.updatedAt > local.updatedAt) {
      await tx.store.put(remote, dateKey);
    }
  }
  await tx.done;
}

export async function listDayKeysBefore(dateKey: string, limit: number): Promise<string[]> {
  const db = await getDb();
  const keys = (await db.getAllKeys('days'))
    .filter((k) => k < dateKey)
    .sort()
    .reverse()
    .slice(0, limit);
  return keys.reverse();
}
