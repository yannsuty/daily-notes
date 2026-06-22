import { CONTEXT_PHRASES, detectContextTags, normalizeContextTags } from './context.js';

const LOCATION_FRAGMENT =
  '(?:à\\s+la\\s+maison|a\\s+la\\s+maison|au\\s+travail|chez\\s+moi|au\\s+bureau)';

const CONDITIONAL_PATTERNS: RegExp[] = [
  new RegExp(
    `^(?:quand|lorsque)\\s+je\\s+rentre(?:\\s+${LOCATION_FRAGMENT})?(?:\\s*,)?\\s*(?:je\\s+dois\\s+|il\\s+faut\\s+|de\\s+)?(.+)$`,
    'i',
  ),
  new RegExp(
    `^en\\s+rentrant(?:\\s+${LOCATION_FRAGMENT})?(?:\\s*,)?\\s*(?:je\\s+dois\\s+|il\\s+faut\\s+|de\\s+)?(.+)$`,
    'i',
  ),
  new RegExp(
    `^(?:quand|lorsque)\\s+je\\s+suis\\s+${LOCATION_FRAGMENT}(?:\\s*,)?\\s*(?:je\\s+dois\\s+|il\\s+faut\\s+|de\\s+)?(.+)$`,
    'i',
  ),
  /^(?:je\s+dois|il\s+faut|faut)\s+(.+?)\s+(?:quand|lorsque)\s+je\s+(?:rentre|suis|arrive)/i,
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Retire les mentions de lieu et les amorces conditionnelles du texte d'action. */
export function cleanReminderActionText(text: string): string {
  let cleaned = text.trim();

  cleaned = cleaned
    .replace(/^(?:quand|lorsque)\s+je\s+(?:suis|rentre|arrive)\s+(?:de\s+)?/i, '')
    .replace(/^en\s+rentrant\s+/i, '')
    .replace(/^je\s+dois\s+/i, '')
    .replace(/^il\s+faut\s+/i, '')
    .replace(/^de\s+/i, '');

  const phrases = Object.keys(CONTEXT_PHRASES).sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    cleaned = cleaned.replace(new RegExp(escapeRegex(phrase), 'gi'), '');
  }

  return cleaned.replace(/\s+/g, ' ').replace(/^[,.\s]+|[,.\s]+$/g, '').trim();
}

/** Extrait action + contexte d'une phrase du type « quand je rentre à la maison je dois … ». */
export function parseContextualReminder(
  rawText: string,
): { text: string; contextTags: string[] } | null {
  const text = rawText.trim();
  if (!text) return null;

  for (const pattern of CONDITIONAL_PATTERNS) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const contextTags = detectContextTags(text);
    if (contextTags.length === 0) continue;

    const action = cleanReminderActionText(match[1].trim());
    if (!action) continue;

    return { text: action, contextTags };
  }

  return null;
}

export interface ReminderArgsInput {
  text: string;
  timeOfDay?: string;
  at?: string;
  recurrence?: string;
  contextTags?: string;
}

/** Normalise texte et contextTags avant création d'un rappel. */
export function normalizeReminderArgs<T extends ReminderArgsInput>(args: T): T {
  const hasTime = !!(args.timeOfDay?.trim() || args.at?.trim());
  let text = args.text.trim();
  let contextTags = args.contextTags?.trim();

  if (!text) return args;

  if (!hasTime) {
    const parsed = parseContextualReminder(text);
    if (parsed) {
      return {
        ...args,
        text: parsed.text,
        contextTags: parsed.contextTags.join(','),
      };
    }
  }

  if (contextTags && !hasTime) {
    const tags = normalizeContextTags(contextTags);
    const cleaned = cleanReminderActionText(text);
    if (cleaned) text = cleaned;
    return { ...args, text, contextTags: tags.join(',') };
  }

  if (!contextTags && !hasTime) {
    const detected = detectContextTags(text);
    if (detected.length > 0) {
      const cleaned = cleanReminderActionText(text);
      return {
        ...args,
        text: cleaned || text,
        contextTags: detected.join(','),
      };
    }
  }

  return { ...args, text };
}
