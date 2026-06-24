import { test, expect } from '@playwright/test';
import { resetAppStorage } from './helpers/storage';

test.describe('Smoke — chargement application', () => {
  test.beforeEach(async ({ page }) => {
    await resetAppStorage(page);
  });

  test('affiche l’onglet Merlin par défaut', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'Merlin' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('textbox', { name: 'Message à Merlin' })).toBeVisible();
    await expect(
      page.getByRole('log', { name: 'Conversation avec Merlin' }),
    ).toBeVisible();
  });

  test('navigue entre Merlin, Journal et Galerie', async ({ page }) => {
    await page.getByRole('tab', { name: 'Journal' }).click();
    await expect(page.locator('#tab-journal')).toBeVisible();

    await page.getByRole('tab', { name: 'Galerie' }).click();
    await expect(page.getByRole('heading', { name: 'Galerie' })).toBeVisible();

    await page.getByRole('tab', { name: 'Merlin' }).click();
    await expect(page.getByRole('textbox', { name: 'Message à Merlin' })).toBeVisible();
  });
});
