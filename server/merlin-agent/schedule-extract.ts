import {
  buildReminderScheduleExtractPrompt,
  parseReminderScheduleExtractPayload,
} from '../../lib/merlin-agent/reminder-schedule-extract.js';
import { parseJsonFromAi } from '../../lib/merlin-agent/parse.js';
import type { ReminderScheduleFromText } from '../../lib/merlin-agent/reminder-datetime.js';
import type { AgentClientConfig } from '../../lib/merlin-agent/types.js';
import { callMerlinLlm } from './llm.js';

export async function extractReminderScheduleFields(
  userText: string,
  config: AgentClientConfig,
  referer?: string,
): Promise<ReminderScheduleFromText | null> {
  const trimmed = userText.trim();
  if (!trimmed) return null;

  const now = new Date();
  const result = await callMerlinLlm(
    [
      { role: 'system', content: buildReminderScheduleExtractPrompt(now) },
      { role: 'user', content: trimmed },
    ],
    config,
    { temperature: 0.1, jsonMode: true, referer },
  );

  if (!result.ok || !result.text) return null;

  const parsed = parseJsonFromAi<unknown>(result.text);
  return parseReminderScheduleExtractPayload(parsed, now);
}
