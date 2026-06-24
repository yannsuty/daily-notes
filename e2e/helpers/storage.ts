import type { Page } from '@playwright/test';

const DB_NAME = 'daily-note';

/** Réinitialise localStorage, sessionStorage et IndexedDB entre les scénarios. */
export async function resetAppStorage(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (dbName) => {
    localStorage.clear();
    sessionStorage.clear();
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs
        .map((db) => db.name)
        .filter((name): name is string => !!name)
        .map(
          (name) =>
            new Promise<void>((resolve, reject) => {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = () => resolve();
              req.onerror = () => reject(req.error);
              req.onblocked = () => resolve();
            }),
        ),
    );
    if (!dbs.some((db) => db.name === dbName)) {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
      });
    }
  }, DB_NAME);
  await page.reload();
  await page.getByRole('tab', { name: 'Merlin' }).waitFor({ state: 'visible' });
}
