import { describe, expect, it } from 'vitest';
import { callOpenRouterWithFallback, OPENROUTER_FREE_ROUTER } from '../../server/openrouter-fallback.js';
import { parseJsonFromAi } from '../../lib/merlin-agent/parse.js';
import {
  REMINDER_EXTRACT_PROMPT,
  parseReminderExtractPayload,
} from '../../lib/merlin-agent/reminder-extract.js';
import {
  checkOpenRouterPreflight,
  preflightSkipReason,
} from './openrouter-preflight.js';

interface GoldenCase {
  input: string;
  isReminder: boolean;
  textIncludes?: string;
  contextTags?: string[];
}

const GOLDEN_CASES: GoldenCase[] = [
  {
    input: 'quand je rentre à la maison je dois sortir les poubelles',
    isReminder: true,
    textIncludes: 'poubelles',
    contextTags: ['maison'],
  },
  {
    input: 'en rentrant au travail il faut envoyer le rapport',
    isReminder: true,
    textIncludes: 'rapport',
    contextTags: ['travail'],
  },
  {
    input: "rappelle-moi d'appeler le médecin à 15h",
    isReminder: true,
    textIncludes: 'médecin',
  },
  {
    input: 'comment ça va',
    isReminder: false,
  },
  {
    input: 'ajoute du lait à la liste courses',
    isReminder: false,
  },
];

function contentFromOpenRouterPayload(payload: string): string | null {
  try {
    const data = JSON.parse(payload) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

async function extractViaLlm(apiKey: string, input: string) {
  const result = await callOpenRouterWithFallback(
    apiKey,
    {
      model: OPENROUTER_FREE_ROUTER,
      messages: [
        { role: 'system', content: REMINDER_EXTRACT_PROMPT },
        { role: 'user', content: input },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    },
    { referer: 'https://merlin.app' },
  );

  expect(result.ok, result.payload.slice(0, 300)).toBe(true);

  const content = contentFromOpenRouterPayload(result.payload);
  expect(content, 'réponse LLM vide').toBeTruthy();

  const json = parseJsonFromAi<unknown>(content!);
  return parseReminderExtractPayload(json);
}

const preflight = await checkOpenRouterPreflight();
const skipReason = preflightSkipReason(preflight);
if (skipReason) {
  console.warn(`[llm-eval] ${skipReason}`);
}
const apiKey = preflight.status === 'ok' ? preflight.apiKey : '';

describe.skipIf(preflight.status !== 'ok')('évaluation LLM — extraction rappels', () => {
  it.each(GOLDEN_CASES)('« $input »', async (golden) => {
    const extracted = await extractViaLlm(apiKey, golden.input);
    expect(extracted?.isReminder).toBe(golden.isReminder);

    if (!golden.isReminder) return;

    expect(extracted?.text?.trim()).toBeTruthy();
    if (golden.textIncludes) {
      expect(extracted!.text!.toLowerCase()).toContain(golden.textIncludes.toLowerCase());
    }
    if (golden.contextTags?.length) {
      for (const tag of golden.contextTags) {
        expect(extracted?.contextTags).toContain(tag);
      }
    }
  });
});
