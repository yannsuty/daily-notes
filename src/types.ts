export interface DayEntry {
  content: string;
  updatedAt: number;
}

export interface ScrollAnchor {
  date: string;
  offsetPx: number;
}

export interface AppMeta {
  scrollAnchor: ScrollAnchor;
  lastVisitDate: string;
  passphraseSet: boolean;
  lastSyncAt: number;
  merlinEnabled: boolean;
  merlinTtsEnabled?: boolean;
  merlinTtsRate?: number;
  merlinContinuousListen?: boolean;
}

export interface MerlinMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface MerlinFact {
  id: string;
  key: string;
  value: string;
  source: 'explicit' | 'inferred';
  createdAt: number;
  updatedAt: number;
}

export interface MerlinConversation {
  id: string;
  messages: MerlinMessage[];
  summary: string;
  updatedAt: number;
}

export interface MerlinListItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MerlinList {
  id: string;
  title: string;
  items: MerlinListItem[];
  createdAt: number;
  updatedAt: number;
}

export type MerlinReminderRecurrence = 'once' | 'daily' | 'weekly';

export type MerlinReminderTrigger =
  | { kind: 'time'; at?: number; timeOfDay?: string; recurrence?: MerlinReminderRecurrence }
  | { kind: 'context'; tags: string[] };

export type MerlinReminderStatus = 'active' | 'done' | 'snoozed';

export interface MerlinReminder {
  id: string;
  text: string;
  trigger: MerlinReminderTrigger;
  status: MerlinReminderStatus;
  createdAt: number;
  updatedAt: number;
}

export interface MerlinShortcut {
  id: string;
  label: string;
  prompt: string;
  pinned: boolean;
  usageCount: number;
  source: 'auto' | 'user';
  lastUsedAt: number;
  createdAt: number;
}

export interface MerlinToolStep {
  tool: string;
  args: Record<string, string>;
}

export interface MerlinCustomToolParam {
  name: string;
  description: string;
}

export interface MerlinCustomTool {
  id: string;
  name: string;
  description: string;
  steps: MerlinToolStep[];
  params?: MerlinCustomToolParam[];
  source: 'auto' | 'user';
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface MerlinEnvVar {
  key: string;
  value: string;
  updatedAt: number;
}

export interface MerlinSyncData {
  conversation: MerlinConversation;
  facts: MerlinFact[];
  lists?: MerlinList[];
  reminders?: MerlinReminder[];
  shortcuts?: MerlinShortcut[];
  customTools?: MerlinCustomTool[];
  env?: MerlinEnvVar[];
  updatedAt: number;
}

export interface SyncPayload {
  days: Record<string, DayEntry>;
  meta: Partial<AppMeta>;
  merlin?: MerlinSyncData;
}

export interface EncryptedBlob {
  ciphertext: string;
  iv: string;
}

export function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, '0');
  const nd = String(date.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export function formatDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function defaultMeta(): AppMeta {
  const today = todayKey();
  return {
    scrollAnchor: { date: today, offsetPx: 0 },
    lastVisitDate: today,
    passphraseSet: false,
    lastSyncAt: 0,
    merlinEnabled: false,
    merlinTtsEnabled: true,
    merlinTtsRate: 1,
    merlinContinuousListen: true,
  };
}
