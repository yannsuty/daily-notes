import { describe, expect, it } from 'vitest';
import {
  hasRelativeReminderSchedule,
  hasReminderScheduleHint,
  needsScheduleLlmFallback,
  parseReminderScheduleFromText,
} from './reminder-datetime.js';

const BASE = new Date('2026-06-23T14:00:00'); // mardi

describe('parseReminderScheduleFromText', () => {
  it('parse « dans 1h30 de vider la machine »', () => {
    const result = parseReminderScheduleFromText('dans 1h30 de vider la machine', BASE);
    expect(result?.text).toBe('vider la machine');
    expect(result?.recurrence).toBe('once');
    expect(result?.at).toBe(BASE.getTime() + 90 * 60_000);
  });

  it('parse « dans 45 min appeler Paul »', () => {
    const result = parseReminderScheduleFromText('dans 45 min appeler Paul', BASE);
    expect(result?.text).toBe('appeler Paul');
    expect(result?.at).toBe(BASE.getTime() + 45 * 60_000);
  });

  it('parse « demain d\'appeler le notaire »', () => {
    const result = parseReminderScheduleFromText("demain d'appeler le notaire", BASE);
    expect(result?.text).toBe('appeler le notaire');
    const at = new Date(result!.at!);
    expect(at.getDate()).toBe(24);
    expect(at.getHours()).toBe(9);
    expect(at.getMinutes()).toBe(0);
  });

  it('parse « demain à 10h30 appeler le notaire »', () => {
    const result = parseReminderScheduleFromText('demain à 10h30 appeler le notaire', BASE);
    expect(result?.text).toBe('appeler le notaire');
    const at = new Date(result!.at!);
    expect(at.getDate()).toBe(24);
    expect(at.getHours()).toBe(10);
    expect(at.getMinutes()).toBe(30);
  });

  it('parse « dans 2 jours payer la facture »', () => {
    const result = parseReminderScheduleFromText('dans 2 jours payer la facture', BASE);
    expect(result?.text).toBe('payer la facture');
    const at = new Date(result!.at!);
    expect(at.getDate()).toBe(25);
    expect(at.getHours()).toBe(9);
  });

  it('parse « ce soir sortir les poubelles »', () => {
    const result = parseReminderScheduleFromText('ce soir sortir les poubelles', BASE);
    expect(result?.text).toBe('sortir les poubelles');
    const at = new Date(result!.at!);
    expect(at.getDate()).toBe(23);
    expect(at.getHours()).toBe(19);
  });

  it('parse « vendredi appeler le client »', () => {
    const result = parseReminderScheduleFromText('vendredi appeler le client', BASE);
    expect(result?.text).toBe('appeler le client');
    const at = new Date(result!.at!);
    expect(at.getDay()).toBe(5);
    expect(at.getDate()).toBe(26);
  });

  it('parse « dans une semaine relancer le devis »', () => {
    const result = parseReminderScheduleFromText('dans une semaine relancer le devis', BASE);
    expect(result?.text).toBe('relancer le devis');
    const at = new Date(result!.at!);
    expect(at.getDate()).toBe(30);
  });

  it('parse « aujourd\'hui à 18h prendre le médicament »', () => {
    const result = parseReminderScheduleFromText("aujourd'hui à 18h prendre le médicament", BASE);
    expect(result?.text).toBe('prendre le médicament');
    const at = new Date(result!.at!);
    expect(at.getDate()).toBe(23);
    expect(at.getHours()).toBe(18);
  });

  it('retourne null sans horaire relatif', () => {
    expect(parseReminderScheduleFromText('appeler le médecin', BASE)).toBeNull();
  });
});

describe('hasRelativeReminderSchedule', () => {
  it('détecte demain et dans 1h', () => {
    expect(hasRelativeReminderSchedule('rappelle-moi demain de sortir les poubelles')).toBe(true);
    expect(hasRelativeReminderSchedule('dans 1h30 vider la machine')).toBe(true);
    expect(hasRelativeReminderSchedule('appeler le médecin à 15h')).toBe(false);
  });
});

describe('needsScheduleLlmFallback', () => {
  it('propose le LLM pour une date calendaire complexe', () => {
    expect(hasReminderScheduleHint('le 15 juillet signer le contrat')).toBe(true);
    expect(parseReminderScheduleFromText('le 15 juillet signer le contrat', BASE)).toBeNull();
    expect(needsScheduleLlmFallback('le 15 juillet signer le contrat', BASE)).toBe(true);
  });

  it('ne propose pas le LLM si le parseur local suffit', () => {
    expect(needsScheduleLlmFallback('demain appeler Paul', BASE)).toBe(false);
  });
});
