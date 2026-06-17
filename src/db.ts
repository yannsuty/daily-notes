import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AppMeta,
  DayEntry,
  MerlinConversation,
  MerlinFact,
  MerlinMessage,
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
}

const DB_NAME = 'daily-note';
const DB_VERSION = 2;
export const MERLIN_CONVERSATION_ID = 'main';

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

export async function exportMerlinData(): Promise<MerlinSyncData> {
  const [conversation, facts] = await Promise.all([
    getMerlinConversation(),
    getMerlinFacts(),
  ]);
  return {
    conversation,
    facts,
    updatedAt: Math.max(conversation.updatedAt, ...facts.map((f) => f.updatedAt), 0),
  };
}

export async function importMerlinData(remote: MerlinSyncData): Promise<void> {
  const local = await exportMerlinData();
  const merged = mergeMerlinData(local, remote);
  await saveMerlinConversation(merged.conversation);
  await saveMerlinFacts(merged.facts);
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
    if (!existing || msg.createdAt >= existing.createdAt) {
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

  return {
    conversation: {
      id: MERLIN_CONVERSATION_ID,
      messages,
      summary,
      updatedAt: Math.max(local.conversation.updatedAt, remote.conversation.updatedAt),
    },
    facts: [...factMap.values()],
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
