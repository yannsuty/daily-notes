import { chatCompletion, parseJsonFromAi } from './ai-provider';
import {
  REMINDER_EXTRACT_PROMPT,
  parseReminderExtractPayload,
  type ReminderExtractResult,
} from '../lib/merlin-agent/reminder-extract';

export async function extractReminderFields(
  userText: string,
): Promise<ReminderExtractResult | null> {
  const trimmed = userText.trim();
  if (!trimmed) return null;

  const result = await chatCompletion(
    [
      { role: 'system', content: REMINDER_EXTRACT_PROMPT },
      { role: 'user', content: trimmed },
    ],
    { temperature: 0.1, jsonMode: true },
  );

  if (!result.ok || !result.text) return null;

  const parsed = parseJsonFromAi<unknown>(result.text);
  return parseReminderExtractPayload(parsed);
}
