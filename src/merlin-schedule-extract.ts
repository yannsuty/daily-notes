import { chatCompletion, parseJsonFromAi } from './ai-provider';
import {
  buildReminderScheduleExtractPrompt,
  parseReminderScheduleExtractPayload,
} from '../lib/merlin-agent/reminder-schedule-extract';
import type { ReminderScheduleFromText } from '../lib/merlin-agent/reminder-datetime';

const EXTRACTION_TIMEOUT_MS = 12_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), ms);
  });
  try {
    return (await Promise.race([promise, timeout])) as T | null;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function extractReminderScheduleFields(
  userText: string,
): Promise<ReminderScheduleFromText | null> {
  const trimmed = userText.trim();
  if (!trimmed || !navigator.onLine) return null;

  const now = new Date();
  const result = await withTimeout(
    chatCompletion(
      [
        { role: 'system', content: buildReminderScheduleExtractPrompt(now) },
        { role: 'user', content: trimmed },
      ],
      { temperature: 0.1, jsonMode: true, maxRetries: 1 },
    ),
    EXTRACTION_TIMEOUT_MS,
  );

  if (!result?.ok || !result.text) return null;

  const parsed = parseJsonFromAi<unknown>(result.text);
  return parseReminderScheduleExtractPayload(parsed, now);
}
