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
  /** Horodatage de la dernière modification du contenu (ex. placeholder → réponse). */
  updatedAt?: number;
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
  when?: import('../lib/merlin-agent/routine').RoutineCondition;
  unless?: import('../lib/merlin-agent/routine').RoutineCondition;
}

export interface MerlinCustomToolParam {
  name: string;
  description: string;
  required?: boolean;
  default?: string;
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

/** Type d'espace structuré (comparaison, DIY, plan, recette). */
export type MerlinSpaceKind = 'comparison' | 'diy' | 'plan' | 'recipe';

export interface MerlinSpaceSection {
  id: string;
  title: string;
  content: string;
}

export interface MerlinSpaceIngredient {
  id: string;
  text: string;
  quantity?: string;
  unit?: string;
}

export interface MerlinSpaceStep {
  id: string;
  order: number;
  text: string;
}

export interface MerlinSpaceMilestone {
  id: string;
  title: string;
  done: boolean;
}

export interface MerlinSpaceGitHub {
  owner: string;
  repo: string;
  defaultBranch?: string;
}

export interface MerlinSpaceData {
  columns?: string[];
  rows?: string[][];
  intro?: string;
  sections?: MerlinSpaceSection[];
  listId?: string;
  goal?: string;
  milestones?: MerlinSpaceMilestone[];
  github?: MerlinSpaceGitHub;
  servings?: number;
  ingredients?: MerlinSpaceIngredient[];
  steps?: MerlinSpaceStep[];
}

export interface MerlinSpace {
  id: string;
  kind: MerlinSpaceKind;
  title: string;
  recap: string;
  data: MerlinSpaceData;
  status: 'active' | 'archived';
  createdAt: number;
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
  spaces?: MerlinSpace[];
  /** id → horodatage de suppression (sync multi-appareils). */
  deletedSpaces?: Record<string, number>;
  deletedLists?: Record<string, number>;
  updatedAt: number;
}

/** Tombstones locaux pour suppressions Merlin (stockage IndexedDB). */
export interface MerlinEntityDeletions {
  spaces: Record<string, number>;
  lists: Record<string, number>;
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
