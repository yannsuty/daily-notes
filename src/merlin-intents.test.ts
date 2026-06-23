import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  extractReminderFields: vi.fn(),
  extractReminderScheduleFields: vi.fn(),
  executeMerlinTool: vi.fn(),
}));

vi.mock('./merlin-reminder-extract', () => ({
  extractReminderFields: mocks.extractReminderFields,
}));

vi.mock('./merlin-schedule-extract', () => ({
  extractReminderScheduleFields: mocks.extractReminderScheduleFields,
}));

vi.mock('./merlin-tools', () => ({
  executeMerlinTool: mocks.executeMerlinTool,
}));

import { tryFastIntent } from './merlin-intents';

describe('tryFastIntent — rappels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractReminderScheduleFields.mockResolvedValue(null);
    mocks.executeMerlinTool.mockResolvedValue({
      ok: true,
      content: 'Rappel créé : « sortir les poubelles » (contexte : maison)',
      mutation: 'reminder_created',
    });
  });

  it('crée un rappel implicite via extraction IA', async () => {
    mocks.extractReminderFields.mockResolvedValue({
      isReminder: true,
      text: 'sortir les poubelles',
      contextTags: ['maison'],
    });

    const result = await tryFastIntent(
      'quand je rentre à la maison je dois sortir les poubelles',
    );

    expect(result.handled).toBe(true);
    expect(result.reply).toContain('sortir les poubelles');
    expect(mocks.executeMerlinTool).toHaveBeenCalledWith('create_reminder', {
      text: 'sortir les poubelles',
      contextTags: 'maison',
    });
  });

  it('utilise le repli local si l’IA échoue', async () => {
    mocks.extractReminderFields.mockResolvedValue(null);

    const result = await tryFastIntent(
      'quand je rentre à la maison je dois sortir les poubelles',
    );

    expect(result.handled).toBe(true);
    expect(mocks.executeMerlinTool).toHaveBeenCalledWith('create_reminder', {
      text: 'sortir les poubelles',
      contextTags: 'maison',
    });
  });

  it('répond toujours avec un contenu non vide', async () => {
    mocks.extractReminderFields.mockResolvedValue(null);

    const result = await tryFastIntent(
      'quand je rentre à la maison je dois sortir les poubelles',
    );

    expect(result.handled).toBe(true);
    expect(result.reply?.trim()).not.toBe('');
  });

  it('ne crée pas de rappel si l’IA dit isReminder false', async () => {
    mocks.extractReminderFields.mockResolvedValue({ isReminder: false });

    const result = await tryFastIntent('quand je rentre à la maison je dois sortir les poubelles');

    expect(result.handled).toBe(false);
    expect(mocks.executeMerlinTool).not.toHaveBeenCalled();
  });

  it('crée un rappel relatif explicite sans IA', async () => {
    mocks.extractReminderFields.mockResolvedValue(null);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-23T14:00:00'));
    try {
      const result = await tryFastIntent('rappelle-moi dans 1h30 de vider la machine');

      expect(result.handled).toBe(true);
      expect(mocks.executeMerlinTool).toHaveBeenCalledWith('create_reminder', {
        text: 'vider la machine',
        at: new Date('2026-06-23T15:30:00').toISOString(),
        recurrence: 'once',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
