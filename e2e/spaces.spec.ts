import { test, expect } from '@playwright/test';
import { installAgentMock } from './helpers/agent-mock';
import { installSpaceImageMock, seedComparisonRowImage } from './helpers/space-image-mock';
import { resetAppStorage } from './helpers/storage';
import {
  clearActiveContext,
  countComparisonDataRows,
  expectContextBar,
  expectLastAssistantMessage,
  openEspacesGallery,
  openSpaceDetail,
  sendMerlinMessage,
  waitForThinkingDone,
} from './helpers/merlin-chat';

test.describe('Espaces — parcours comparaison (agent mocké)', () => {
  test.beforeEach(async ({ page }) => {
    await resetAppStorage(page);
    await installAgentMock(page);
  });

  test('création : compare des ventilateurs → espace actif + carte Galerie', async ({ page }) => {
    await sendMerlinMessage(page, 'Compare des ventilateurs de plafond silencieux');
    await waitForThinkingDone(page);

    await expectLastAssistantMessage(page, /Alpha|Beta|comparaison/i);
    await expectContextBar(page, /Ventilateurs de plafond/i);

    await openEspacesGallery(page);
    await expect(page.locator('.espaces-page__card-title', { hasText: 'Ventilateurs de plafond' })).toBeVisible();
    await openSpaceDetail(page, 'Ventilateurs de plafond');
    await expect(page.locator('.espaces-page__table')).toContainText('Alpha');
  });

  test('extension : compares avec d’autres ventilateurs → même espace enrichi', async ({ page }) => {
    await sendMerlinMessage(page, 'Compare des ventilateurs de plafond');
    await waitForThinkingDone(page);
    await expectContextBar(page, /Ventilateurs/i);

    await sendMerlinMessage(
      page,
      'Je veux bien que tu compares avec d’autres ventilateurs de plafond',
    );
    await waitForThinkingDone(page);

    await expectLastAssistantMessage(page, /Gamma/i);
    await expectContextBar(page, /Ventilateurs/i);

    await openEspacesGallery(page);
    await openSpaceDetail(page, 'Ventilateurs de plafond');
    await expect(page.locator('.espaces-page__table')).toContainText('Gamma');
    expect(await countComparisonDataRows(page)).toBe(3);
  });

  test('conseil : question sans extension → pas de nouvelle ligne dans l’espace', async ({ page }) => {
    await sendMerlinMessage(page, 'Compare des ventilateurs de plafond');
    await waitForThinkingDone(page);

    await sendMerlinMessage(page, 'Quel modèle pour une chambre de 20 m² ?');
    await waitForThinkingDone(page);

    await expectLastAssistantMessage(page, /20 m²|silencieux/i);

    await openEspacesGallery(page);
    await openSpaceDetail(page, 'Ventilateurs de plafond');
    expect(await countComparisonDataRows(page)).toBe(2);
  });

  test('changement de sujet : recette → nouvel espace actif', async ({ page }) => {
    await sendMerlinMessage(page, 'Compare des ventilateurs de plafond');
    await waitForThinkingDone(page);
    await expectContextBar(page, /Ventilateurs/i);

    await sendMerlinMessage(page, 'Recette de crêpes pour 4 personnes');
    await waitForThinkingDone(page);

    await expectLastAssistantMessage(page, /crêpes/i);
    await expectContextBar(page, /Crêpes/i);

    await openEspacesGallery(page);
    await expect(page.locator('.espaces-page__card-title', { hasText: 'Crêpes pour 4' })).toBeVisible();
    await expect(page.locator('.espaces-page__card-title', { hasText: 'Ventilateurs de plafond' })).toBeVisible();
  });

  test('quitter le contexte actif', async ({ page }) => {
    await sendMerlinMessage(page, 'Compare des ventilateurs de plafond');
    await waitForThinkingDone(page);
    await expectContextBar(page, /Ventilateurs/i);

    await clearActiveContext(page);
    await expect(page.locator('.merlin-chat__context')).toBeHidden();
  });

  test('images auto : création comparaison → vignettes dans Galerie', async ({ page }) => {
    await sendMerlinMessage(page, 'Compare des ventilateurs de plafond');
    await waitForThinkingDone(page);

    await openEspacesGallery(page);
    await expect(page.locator('.espaces-page__card-preview img').first()).toHaveAttribute(
      'src',
      /cdn\.example\.com\/e2e-alpha\.jpg/,
    );
    await expect(page.locator('.espaces-page__card-meta').first()).toContainText(/photos/i);

    await openSpaceDetail(page, 'Ventilateurs de plafond');
    await expect(page.locator('.espaces-page__comparison-card .espaces-page__comparison-image')).toHaveAttribute(
      'src',
      /cdn\.example\.com\/e2e-alpha\.jpg/,
    );
    await expect(page.locator('.espaces-page__comparison-photos')).toContainText(/photos/i);
  });

  test('tableau : vignettes et navigation par clic sur une ligne', async ({ page }) => {
    await sendMerlinMessage(page, 'Compare des ventilateurs de plafond');
    await waitForThinkingDone(page);

    await openEspacesGallery(page);
    await openSpaceDetail(page, 'Ventilateurs de plafond');

    await page.locator('summary', { hasText: 'Tableau complet' }).click();
    await expect(page.locator('.espaces-page__table-product img').first()).toBeVisible();

    await page.locator('.espaces-page__table-row', { hasText: 'Beta' }).click();
    await expect(page.locator('.espaces-page__comparison-pager')).toHaveText('2 / 2');
    await expect(page.locator('.espaces-page__comparison-name')).toContainText('Beta');
  });

  test('override images : rafraîchir toutes les images sur demande', async ({ page }) => {
    await sendMerlinMessage(page, 'Compare des ventilateurs de plafond');
    await waitForThinkingDone(page);

    await sendMerlinMessage(page, 'Rafraîchis les images de la comparaison');
    await waitForThinkingDone(page);

    await expectLastAssistantMessage(page, /images|remplac/i);

    await openEspacesGallery(page);
    await openSpaceDetail(page, 'Ventilateurs de plafond');
    await expect(page.locator('.espaces-page__comparison-card .espaces-page__comparison-image')).toHaveAttribute(
      'src',
      /cdn\.example\.com\/e2e-alpha-override\.jpg/,
    );
  });

  test('rafraîchir l’image : bouton met à jour la vignette', async ({ page }) => {
    await installSpaceImageMock(page, {
      imageUrl: 'https://cdn.example.com/e2e-refreshed.jpg',
    });

    await sendMerlinMessage(page, 'Compare des ventilateurs de plafond');
    await waitForThinkingDone(page);

    await seedComparisonRowImage(
      page,
      'Ventilateurs de plafond',
      'https://cdn.example.com/e2e-old.jpg',
    );

    await openEspacesGallery(page);
    await openSpaceDetail(page, 'Ventilateurs de plafond');

    const image = page.locator('.espaces-page__comparison-card .espaces-page__comparison-image');
    await expect(image).toHaveAttribute('src', /e2e-old\.jpg/);

    await page.getByRole('button', { name: "Rafraîchir l'image" }).click();
    await expect(page.getByRole('button', { name: 'Recherche…' })).toBeHidden();
    await expect(image).toHaveAttribute('src', /e2e-refreshed\.jpg/);
  });
});
