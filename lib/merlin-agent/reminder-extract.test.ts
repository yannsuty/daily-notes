import { describe, expect, it } from 'vitest';
import {
  likelyReminderIntent,
  needsReminderExtraction,
  parseReminderExtractPayload,
} from './reminder-extract.js';

describe('parseReminderExtractPayload', () => {
  it('parse un rappel contextuel valide', () => {
    expect(
      parseReminderExtractPayload({
        isReminder: true,
        text: 'sortir les poubelles',
        contextTags: ['maison'],
      }),
    ).toEqual({
      isReminder: true,
      text: 'sortir les poubelles',
      contextTags: ['maison'],
      timeOfDay: undefined,
      recurrence: undefined,
    });
  });

  it('accepte isReminder false', () => {
    expect(parseReminderExtractPayload({ isReminder: false })).toEqual({ isReminder: false });
  });

  it('rejette un JSON incomplet', () => {
    expect(parseReminderExtractPayload({ isReminder: true })).toBeNull();
    expect(parseReminderExtractPayload(null)).toBeNull();
  });

  it('normalise timeOfDay', () => {
    expect(
      parseReminderExtractPayload({
        isReminder: true,
        text: 'appeler le médecin',
        timeOfDay: '15h00',
      })?.timeOfDay,
    ).toBe('15:00');
  });
});

describe('likelyReminderIntent', () => {
  it('détecte un rappel implicite', () => {
    expect(
      likelyReminderIntent('quand je rentre à la maison je dois sortir les poubelles'),
    ).toBe(true);
  });

  it('ignore une question', () => {
    expect(likelyReminderIntent('comment ça va aujourd hui')).toBe(false);
  });

  it('ignore une commande liste', () => {
    expect(likelyReminderIntent('ajoute du lait à courses')).toBe(false);
  });
});

describe('needsReminderExtraction', () => {
  it('détecte un texte LLM corrompu', () => {
    expect(needsReminderExtraction('quand je suis de sortir les poubelles', 'maison')).toBe(
      true,
    );
  });

  it('ignore un texte déjà propre', () => {
    expect(needsReminderExtraction('sortir les poubelles', 'maison')).toBe(false);
  });
});
