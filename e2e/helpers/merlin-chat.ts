import { expect, type Page } from '@playwright/test';

export async function sendMerlinMessage(page: Page, text: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Message à Merlin' });
  await input.fill(text);
  await page.getByRole('button', { name: 'Envoyer' }).click();
}

export async function waitForThinkingDone(page: Page): Promise<void> {
  const status = page.locator('.merlin-chat__status');
  await expect(status).toBeEmpty();
}

export async function expectLastAssistantMessage(
  page: Page,
  pattern: RegExp | string,
): Promise<void> {
  const log = page.getByRole('log', { name: 'Conversation avec Merlin' });
  const lastAssistant = log.locator('.merlin-chat__bubble--assistant').last();
  await expect(lastAssistant).toContainText(pattern);
}

export async function expectContextBar(
  page: Page,
  titlePattern: RegExp | string,
): Promise<void> {
  const context = page.locator('.merlin-chat__context');
  await expect(context).toBeVisible();
  await expect(context.locator('.merlin-chat__context-title')).toContainText(titlePattern);
}

export async function clearActiveContext(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Quitter le contexte' }).click();
  await expect(page.locator('.merlin-chat__context')).toBeHidden();
}

export async function openEspacesGallery(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Galerie' }).click();
  await page.getByRole('button', { name: 'Espaces' }).click();
  await expect(page.locator('.espaces-page')).toBeVisible();
}

export async function openSpaceDetail(page: Page, titlePattern: RegExp | string): Promise<void> {
  await page.locator('.espaces-page__card-main', { hasText: titlePattern }).click();
  await expect(page.locator('.espaces-page__detail')).toBeVisible();
}

export async function countComparisonDataRows(page: Page): Promise<number> {
  return page.locator('.espaces-page__table tr:has(td)').count();
}
