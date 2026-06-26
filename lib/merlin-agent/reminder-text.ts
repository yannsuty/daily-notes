import { CONTEXT_PHRASES, detectContextTags, normalizeContextTags } from './context.js';

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
      .replace(
        /\s+(?:quand|lorsque)\s+je\s+(?:suis|rentre|arrive)\s+(?:de\s+)?(?:à\s+la\s+maison|a\s+la\s+maison|chez\s+moi|au\s+travail|aux?\s+courses)\s*$/i,
        '',
      )
      .replace(/\s+(?:quand|lorsque)\s+je\s+(?:suis|rentre|arrive)\s*$/i, '')
      .replace(/\s+en\s+rentrant\s*$/i, '')
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

/** Repli local quand l'extraction IA est indisponible ou trop lente. */
export function buildLocalReminderFallback(
  text: string,
): { text: string; contextTags: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const contextTags = detectContextTags(trimmed);
  const cleaned = cleanReminderActionText(trimmed);
  const action = cleaned || trimmed;

  if (!action || action.length < 2) return null;
  if (action.toLowerCase() === trimmed.toLowerCase() && contextTags.length === 0) return null;

  return { text: action, contextTags };
}
