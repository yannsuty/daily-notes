import {
  needsScheduleLlmFallback,
  parseReminderScheduleFromText,
  type ReminderScheduleFromText,
} from './reminder-datetime.js';

export type ReminderScheduleLlmExtract = (
  text: string,
) => Promise<ReminderScheduleFromText | null>;

export async function resolveReminderSchedule(
  text: string,
  options?: { now?: Date; llmExtract?: ReminderScheduleLlmExtract },
): Promise<ReminderScheduleFromText | null> {
  const now = options?.now ?? new Date();
  const trimmed = text.trim();
  if (!trimmed) return null;

  const local = parseReminderScheduleFromText(trimmed, now);
  if (local) return local;

  if (needsScheduleLlmFallback(trimmed, now) && options?.llmExtract) {
    return options.llmExtract(trimmed);
  }

  return null;
}

export function reminderArgsFromSchedule(
  schedule: ReminderScheduleFromText,
): Record<string, string> {
  return {
    text: schedule.text,
    at: new Date(schedule.at!).toISOString(),
    recurrence: schedule.recurrence ?? 'once',
  };
}
