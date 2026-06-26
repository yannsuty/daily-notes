import { describe, expect, it } from 'vitest';
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

  it('retire le lieu et la condition en fin de phrase', () => {
    expect(
      cleanReminderActionText('sortir les poubelles quand je rentre à la maison'),
    ).toBe('sortir les poubelles');
  });

  it('retire le lieu et la condition en début de phrase', () => {
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
});
