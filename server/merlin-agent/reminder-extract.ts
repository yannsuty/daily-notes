import {
  REMINDER_EXTRACT_PROMPT,
  parseReminderExtractPayload,
  type ReminderExtractResult,
} from '../../lib/merlin-agent/reminder-extract.js';
import { parseJsonFromAi } from '../../lib/merlin-agent/parse.js';
import type { AgentClientConfig } from '../../lib/merlin-agent/types.js';
import { callMerlinLlm } from './llm.js';

export async function extractReminderFields(
  userText: string,
  config: AgentClientConfig,
  referer?: string,
): Promise<ReminderExtractResult | null> {
  const trimmed = userText.trim();
  if (!trimmed) return null;

  const result = await callMerlinLlm(
    [
      { role: 'system', content: REMINDER_EXTRACT_PROMPT },
      { role: 'user', content: trimmed },
    ],
    config,
    { temperature: 0.1, jsonMode: true, referer },
  );

  if (!result.ok || !result.text) return null;

  const parsed = parseJsonFromAi<unknown>(result.text);
  return parseReminderExtractPayload(parsed);
}
