import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AppMeta, DayEntry, SyncPayload } from './types';
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
}

const DB_NAME = 'daily-note';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<DailyNoteDB>> | null = null;

function getDb(): Promise<IDBPDatabase<DailyNoteDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DailyNoteDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('days')) {
          db.createObjectStore('days');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
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
  return meta ?? defaultMeta();
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

export async function exportPayload(): Promise<SyncPayload> {
  const [days, meta] = await Promise.all([getAllDays(), getMeta()]);
  return {
    days,
    meta: {
      scrollAnchor: meta.scrollAnchor,
      lastVisitDate: meta.lastVisitDate,
      lastSyncAt: meta.lastSyncAt,
    },
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
