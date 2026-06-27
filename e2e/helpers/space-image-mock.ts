import type { Page, Route } from '@playwright/test';

export interface SpaceImageMockOptions {
  imageUrl?: string;
  fail?: boolean;
}

/**
 * Mock de /api/merlin-space-image pour les tests E2E (rafraîchir une vignette).
 */
export async function installSpaceImageMock(
  page: Page,
  options: SpaceImageMockOptions = {},
): Promise<void> {
  const imageUrl = options.imageUrl ?? 'https://cdn.example.com/e2e-refreshed.jpg';

  await page.route('**/api/merlin-space-image**', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    if (options.fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, content: 'Recherche indisponible (mock).' }),
      });
      return;
    }

    const body = route.request().postDataJSON() as { rowName?: string };
    const rowName = body.rowName?.trim() || 'article';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        imageUrl,
        content: `Image trouvée pour « ${rowName} ».`,
      }),
    });
  });
}

/** Injecte une URL d'image existante sur la première ligne visible d'une comparaison. */
export async function seedComparisonRowImage(
  page: Page,
  spaceTitle: string,
  imageUrl: string,
): Promise<void> {
  await page.evaluate(
    async ({ title, url }) => {
      const dbName = 'daily-note';
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const tx = db.transaction('merlin_spaces', 'readwrite');
      const store = tx.objectStore('merlin_spaces');
      const all = await new Promise<unknown[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as unknown[]);
        req.onerror = () => reject(req.error);
      });

      const space = (all as {
        id?: string;
        title?: string;
        data?: { rows?: string[][]; rowImages?: Record<string, string> };
      }[]).find((s) => s.title === title);
      if (!space?.id || !space.data?.rows?.[0]?.[0]) return;

      const key = space.data.rows[0][0].trim().toLowerCase();
      space.data.rowImages = { ...(space.data.rowImages ?? {}), [key]: url };

      await new Promise<void>((resolve, reject) => {
        const req = store.put(space, space.id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { title: spaceTitle, url: imageUrl },
  );
}
