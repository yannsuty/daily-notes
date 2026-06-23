import { CONTEXT_PHRASES, detectContextTags, normalizeContextTags } from './context.js';
import { parseReminderScheduleFromText } from './reminder-datetime.js';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Retire les mentions de lieu et les amorces conditionnelles du texte d'action. */
export function cleanReminderActionText(text: string): string {
  let cleaned = text.trim();

  for (let i = 0; i < 5; i += 1) {
    const prev = cleaned;
    cleaned = cleaned
      .replace(/^(?:quand|lorsque)\s+je\s+(?:suis|rentre|arrive)\s+(?:de\s+)?/i, '')
      .replace(/^en\s+rentrant\s+/i, '')
      .replace(/\bje\s+dois\s+/gi, '')
      .replace(/\bil\s+faut\s+/gi, '')
      .replace(/^de\s+/i, '');

    const phrases = Object.keys(CONTEXT_PHRASES).sort((a, b) => b.length - a.length);
    for (const phrase of phrases) {
      cleaned = cleaned.replace(new RegExp(escapeRegex(phrase), 'gi'), '');
    }

    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    if (cleaned === prev) break;
  }

  return cleaned.replace(/^[,.\s]+|[,.\s]+$/g, '').trim();
}

export interface ReminderArgsInput {
  text: string;
  timeOfDay?: string;
  at?: string;
  recurrence?: string;
  contextTags?: string;
}

function applyScheduleFromText<T extends ReminderArgsInput>(args: T, sourceText?: string): T {
  if (args.timeOfDay?.trim() || args.at?.trim()) return args;

  const schedule =
    parseReminderScheduleFromText(sourceText?.trim() || args.text) ??
    (sourceText?.trim() && sourceText.trim() !== args.text.trim()
      ? parseReminderScheduleFromText(args.text)
      : null);
  if (!schedule?.at && !schedule?.timeOfDay) return args;

  let text = args.text.trim();
  if (schedule.text) {
    const cleaned = cleanReminderActionText(schedule.text);
    text = cleaned || schedule.text;
  }

  return {
    ...args,
    text,
    at: schedule.at ? new Date(schedule.at).toISOString() : args.at,
    recurrence: schedule.recurrence ?? args.recurrence ?? 'once',
  };
}

/** Filet de sécurité après extraction IA ou appel agent. */
export function normalizeReminderArgs<T extends ReminderArgsInput>(args: T, sourceText?: string): T {
  const withSchedule = applyScheduleFromText(args, sourceText);
  const hasTime = !!(withSchedule.timeOfDay?.trim() || withSchedule.at?.trim());
  let text = withSchedule.text.trim();
  let contextTags = withSchedule.contextTags?.trim();

  if (!text) return withSchedule;

  if (contextTags && !hasTime) {
    const tags = normalizeContextTags(contextTags);
    const cleaned = cleanReminderActionText(text);
    if (cleaned) text = cleaned;
    return { ...withSchedule, text, contextTags: tags.join(',') };
  }

  if (!contextTags && !hasTime) {
    const detected = detectContextTags(text);
    if (detected.length > 0) {
      const cleaned = cleanReminderActionText(text);
      return {
        ...withSchedule,
        text: cleaned || text,
        contextTags: detected.join(','),
      };
    }
  }

  return { ...withSchedule, text };
}

/** Repli local quand l'extraction IA est indisponible ou trop lente. */
export function buildLocalReminderFallback(
  text: string,
): { text: string; contextTags: string[]; at?: string; recurrence?: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const schedule = parseReminderScheduleFromText(trimmed);
  if (schedule?.at) {
    const contextTags = detectContextTags(schedule.text);
    const cleaned = cleanReminderActionText(schedule.text);
    const action = cleaned || schedule.text;
    if (action.length >= 2) {
      return {
        text: action,
        contextTags,
        at: new Date(schedule.at).toISOString(),
        recurrence: schedule.recurrence ?? 'once',
      };
    }
  }

  const contextTags = detectContextTags(trimmed);
  const cleaned = cleanReminderActionText(trimmed);
  const action = cleaned || trimmed;

  if (!action || action.length < 2) return null;
  if (action.toLowerCase() === trimmed.toLowerCase() && contextTags.length === 0) return null;

  return { text: action, contextTags };
}
