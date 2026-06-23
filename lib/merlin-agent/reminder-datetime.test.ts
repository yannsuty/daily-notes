import { describe, expect, it } from 'vitest';
import {
  hasRelativeReminderSchedule,
  parseReminderScheduleFromText,
} from './reminder-datetime.js';

const BASE = new Date('2026-06-23T14:00:00');

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
