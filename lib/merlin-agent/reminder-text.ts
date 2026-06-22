import { CONTEXT_PHRASES, detectContextTags, normalizeContextTags } from './context.js';

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

export interface ReminderArgsInput {
  text: string;
  timeOfDay?: string;
  at?: string;
  recurrence?: string;
  contextTags?: string;
}

/** Filet de sécurité après extraction IA ou appel agent. */
export function normalizeReminderArgs<T extends ReminderArgsInput>(args: T): T {
  const hasTime = !!(args.timeOfDay?.trim() || args.at?.trim());
  let text = args.text.trim();
  let contextTags = args.contextTags?.trim();

  if (!text) return args;

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
