import { test, expect } from '@playwright/test';
import { resetAppStorage } from './helpers/storage';
import {
  expectLastAssistantMessage,
  sendMerlinMessage,
  waitForThinkingDone,
} from './helpers/merlin-chat';

test.describe('Fast path — sans API agent', () => {
  test.beforeEach(async ({ page }) => {
    await resetAppStorage(page);
  });

  test('ajoute un article à une liste de courses', async ({ page }) => {
    await sendMerlinMessage(page, 'ajoute du lait à la liste courses');
    await waitForThinkingDone(page);
    await expectLastAssistantMessage(page, /lait/i);
  });

  test('déclenche un contexte « au travail »', async ({ page }) => {
    await sendMerlinMessage(page, 'je suis au travail');
    await waitForThinkingDone(page);
    await expectLastAssistantMessage(page, /travail|contexte/i);
  });
});
