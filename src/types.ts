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
}

export interface SyncPayload {
  days: Record<string, DayEntry>;
  meta: Partial<AppMeta>;
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
  };
}
