import { chatCompletion, parseJsonFromAi } from './ai-provider';
import {
  REMINDER_EXTRACT_PROMPT,
  parseReminderExtractPayload,
  type ReminderExtractResult,
} from '../lib/merlin-agent/reminder-extract';

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

export async function extractReminderFields(
  userText: string,
): Promise<ReminderExtractResult | null> {
  const trimmed = userText.trim();
  if (!trimmed) return null;
  if (!navigator.onLine) return null;

  const result = await withTimeout(
    chatCompletion(
      [
        { role: 'system', content: REMINDER_EXTRACT_PROMPT },
        { role: 'user', content: trimmed },
      ],
      { temperature: 0.1, jsonMode: true, maxRetries: 1 },
    ),
    EXTRACTION_TIMEOUT_MS,
  );

  if (!result?.ok || !result.text) return null;

  const parsed = parseJsonFromAi<unknown>(result.text);
  return parseReminderExtractPayload(parsed);
}
