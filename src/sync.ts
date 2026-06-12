import { exportPayload, importDays, saveMeta } from './db';
import {
  decryptPayload,
  deriveSyncId,
  encryptPayload,
  getStoredPassphrase,
} from './crypto';
import type { EncryptedBlob, SyncPayload } from './types';

const SYNC_INTERVAL_MS = 60_000;

let syncTimer: ReturnType<typeof setInterval> | null = null;
let syncing = false;

async function fetchRemote(syncId: string): Promise<EncryptedBlob | null> {
  const res = await fetch(`/api/sync?id=${encodeURIComponent(syncId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  return res.json() as Promise<EncryptedBlob>;
}

async function pushRemote(syncId: string, blob: EncryptedBlob): Promise<void> {
  const res = await fetch('/api/sync', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: syncId, ...blob }),
  });
  if (!res.ok) throw new Error(`Push failed: ${res.status}`);
}

function mergeDays(
  local: SyncPayload['days'],
  remote: SyncPayload['days'],
): SyncPayload['days'] {
  const merged = { ...local };
  for (const [dateKey, remoteDay] of Object.entries(remote)) {
    const localDay = merged[dateKey];
    if (!localDay || remoteDay.updatedAt > localDay.updatedAt) {
      merged[dateKey] = remoteDay;
    }
  }
  return merged;
}

export async function syncNow(): Promise<{ ok: boolean; error?: string }> {
  const passphrase = getStoredPassphrase();
  if (!passphrase || syncing || !navigator.onLine) {
    return { ok: false, error: 'offline or no passphrase' };
  }

  syncing = true;
  try {
    const syncId = await deriveSyncId(passphrase);
    const localPayload = await exportPayload();

    let mergedDays = localPayload.days;
    let mergedMeta = localPayload.meta;

    const remoteBlob = await fetchRemote(syncId);
    if (remoteBlob) {
      const decrypted = await decryptPayload(
        passphrase,
        remoteBlob.ciphertext,
        remoteBlob.iv,
      );
      const remotePayload = JSON.parse(decrypted) as SyncPayload;
      mergedDays = mergeDays(localPayload.days, remotePayload.days);
      mergedMeta = { ...remotePayload.meta, ...localPayload.meta };
    }

    await importDays(mergedDays);

    const mergedPayload: SyncPayload = { days: mergedDays, meta: mergedMeta };
    const encrypted = await encryptPayload(
      passphrase,
      JSON.stringify(mergedPayload),
    );
    await pushRemote(syncId, encrypted);
    await saveMeta({ lastSyncAt: Date.now() });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync error';
    return { ok: false, error: message };
  } finally {
    syncing = false;
  }
}

export function startSyncLoop(
  onSync?: (result: { ok: boolean; error?: string }) => void,
): void {
  if (syncTimer) return;

  const run = () => {
    void syncNow().then((result) => onSync?.(result));
  };

  run();
  syncTimer = setInterval(run, SYNC_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void syncNow();
    }
  });
}

export function stopSyncLoop(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}
