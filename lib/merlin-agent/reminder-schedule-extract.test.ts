import { describe, expect, it } from 'vitest';
import { parseReminderScheduleExtractPayload } from './reminder-schedule-extract.js';

const NOW = new Date('2026-06-23T14:00:00');

describe('parseReminderScheduleExtractPayload', () => {
  it('parse un horaire LLM valide', () => {
    expect(
      parseReminderScheduleExtractPayload(
        {
          hasSchedule: true,
          at: '2026-07-15T07:00:00.000Z',
          text: 'envoyer le devis',
        },
        NOW,
      ),
    ).toMatchObject({
      text: 'envoyer le devis',
      recurrence: 'once',
    });
  });

  it('rejette un horaire passé', () => {
    expect(
      parseReminderScheduleExtractPayload(
        {
          hasSchedule: true,
          at: '2026-06-01T07:00:00.000Z',
          text: 'trop tard',
        },
        NOW,
      ),
    ).toBeNull();
  });
});
