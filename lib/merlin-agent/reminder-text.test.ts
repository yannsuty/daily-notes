import { describe, expect, it, vi } from 'vitest';
import {
  buildLocalReminderFallback,
  cleanReminderActionText,
  normalizeReminderArgs,
} from './reminder-text.js';

describe('cleanReminderActionText', () => {
  it('retire les amorces conditionnelles corrompues par le LLM', () => {
    expect(cleanReminderActionText('quand je suis de sortir les poubelles')).toBe(
      'sortir les poubelles',
    );
  });

  it('retire le lieu et la condition', () => {
    expect(
      cleanReminderActionText('quand je rentre à la maison je dois sortir les poubelles'),
    ).toBe('sortir les poubelles');
  });
});

describe('buildLocalReminderFallback', () => {
  it('extrait action et contexte maison', () => {
    expect(
      buildLocalReminderFallback('quand je rentre à la maison je dois sortir les poubelles'),
    ).toEqual({
      text: 'sortir les poubelles',
      contextTags: ['maison'],
    });
  });

  it('retourne null pour une phrase sans signal utile', () => {
    expect(buildLocalReminderFallback('bonjour')).toBeNull();
  });
});

describe('normalizeReminderArgs', () => {
  it('nettoie text quand contextTags est déjà renseigné', () => {
    expect(
      normalizeReminderArgs({
        text: 'quand je suis de sortir les poubelles',
        contextTags: 'maison',
      }),
    ).toEqual({
      text: 'sortir les poubelles',
      contextTags: 'maison',
    });
  });

  it('détecte le contexte depuis le texte si absent', () => {
    expect(
      normalizeReminderArgs({
        text: 'faire la vaisselle à la maison',
      }),
    ).toMatchObject({
      text: 'faire la vaisselle',
      contextTags: 'maison',
    });
  });

  it('convertit un rappel relatif en at ISO', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-23T14:00:00'));
    try {
      const result = normalizeReminderArgs(
        { text: 'dans 1h30 de vider la machine' },
        'dans 1h30 de vider la machine',
      );
      expect(result.text).toBe('vider la machine');
      expect(result.recurrence).toBe('once');
      expect(Date.parse(result.at!)).toBe(new Date('2026-06-23T14:00:00').getTime() + 90 * 60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
