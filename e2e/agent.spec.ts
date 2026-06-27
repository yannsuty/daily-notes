import { test, expect } from '@playwright/test';
import { installAgentMock } from './helpers/agent-mock';
import { resetAppStorage } from './helpers/storage';
import {
  expectLastAssistantMessage,
  sendMerlinMessage,
  waitForThinkingDone,
} from './helpers/merlin-chat';

test.describe('Agent — trace et retry (agent mocké)', () => {
  test.beforeEach(async ({ page }) => {
    await resetAppStorage(page);
  });

  test('affiche l’indicateur de réflexion pendant l’agent', async ({ page }) => {
    await installAgentMock(page);

    const input = page.getByRole('textbox', { name: 'Message à Merlin' });
    await input.fill('Compare des ventilateurs de plafond');
    await page.getByRole('button', { name: 'Envoyer' }).click();

    await expect(page.locator('.merlin-chat__bubble--thinking')).toContainText(/réfléchit|analyse/i);
    await waitForThinkingDone(page);
    await expectLastAssistantMessage(page, /comparaison/i);
  });

  test('retry : réessaie après une erreur agent', async ({ page }) => {
    await installAgentMock(page, { failFirstRequest: true });

    await sendMerlinMessage(page, 'Compare des ventilateurs de plafond');
    await waitForThinkingDone(page);
    const log = page.getByRole('log', { name: 'Conversation avec Merlin' });
    await expect(log.locator('.merlin-chat__bubble--user')).toContainText(
      'Compare des ventilateurs de plafond',
    );
    await expect(page.locator('.merlin-chat__error')).toContainText(/indisponible/i);

    await sendMerlinMessage(page, 'Compare des ventilateurs de plafond');
    await waitForThinkingDone(page);
    await expectLastAssistantMessage(page, /Alpha|Beta/i);
    await expect(page.locator('.merlin-chat__context')).toBeVisible();
  });
});

test.describe('Agent — arrière-plan', () => {
  test('ne bloque pas l’UI avec le bandeau arrière-plan', async ({ page }) => {
    await resetAppStorage(page);
    await installAgentMock(page);

    await sendMerlinMessage(page, 'Compare des ventilateurs de plafond');
    await waitForThinkingDone(page);

    await expect(page.locator('.merlin-chat__background')).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Message à Merlin' })).toBeEnabled();
  });
});
