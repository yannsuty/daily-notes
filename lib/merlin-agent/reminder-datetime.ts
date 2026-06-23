export interface ReminderScheduleFromText {
  at?: number;
  timeOfDay?: string;
  recurrence?: 'once';
  text: string;
}

interface ScheduleMatch {
  index: number;
  length: number;
  phrase: string;
}

const SCHEDULE_PHRASE_PATTERNS: RegExp[] = [
  /\bdans\s+\d+\s*h\s*\d{1,2}\b/i,
  /\bdans\s+\d+\s*h(?:eure?s?)?(?:\s*(?:et\s+)?\d+\s*(?:min(?:ute?s?)?|mn))?/i,
  /\bdans\s+\d+\s*(?:min(?:ute?s?)?|mn)\b/i,
  /\bdans\s+\d+\s*jours?\b/i,
  /\baprès[- ]demain(?:\s+(?:matin|midi|soir|(?:à|a)\s+\d{1,2}(?:[:h]\d{2})?))?/i,
  /\bdemain(?:\s+(?:matin|midi|soir|(?:à|a)\s+\d{1,2}(?:[:h]\d{2})?))?/i,
];

function findSchedulePhrase(text: string): ScheduleMatch | null {
  let best: ScheduleMatch | null = null;

  for (const pattern of SCHEDULE_PHRASE_PATTERNS) {
    const match = text.match(pattern);
    if (!match || match.index === undefined) continue;

    const candidate: ScheduleMatch = {
      index: match.index,
      length: match[0].length,
      phrase: match[0],
    };

    if (
      !best ||
      candidate.index < best.index ||
      (candidate.index === best.index && candidate.length > best.length)
    ) {
      best = candidate;
    }
  }

  return best;
}

function addMinutes(base: Date, minutes: number): number {
  return base.getTime() + minutes * 60_000;
}

function scheduleAtFromPhrase(phrase: string, now: Date): number | null {
  const p = phrase.trim().toLowerCase();

  let m = p.match(/^dans\s+(\d+)\s*h\s*(\d{1,2})$/i);
  if (m) {
    return addMinutes(now, Number(m[1]) * 60 + Number(m[2]));
  }

  m = p.match(/^dans\s+(\d+)\s*h(?:eure?s?)?(?:\s*(?:et\s+)?(\d+)\s*(?:min(?:ute?s?)?|mn))?$/i);
  if (m) {
    const hours = Number(m[1]);
    const minutes = m[2] ? Number(m[2]) : 0;
    return addMinutes(now, hours * 60 + minutes);
  }

  m = p.match(/^dans\s+(\d+)\s*(?:min(?:ute?s?)?|mn)$/i);
  if (m) {
    return addMinutes(now, Number(m[1]));
  }

  m = p.match(/^dans\s+(\d+)\s*jours?$/i);
  if (m) {
    const target = new Date(now);
    target.setDate(target.getDate() + Number(m[1]));
    target.setHours(9, 0, 0, 0);
    return target.getTime();
  }

  const dayOffset = /^après[- ]demain/.test(p) ? 2 : /^demain/.test(p) ? 1 : null;
  if (dayOffset !== null) {
    const target = new Date(now);
    target.setDate(target.getDate() + dayOffset);
    target.setSeconds(0, 0);

    const timeM = p.match(/(?:à|a)\s+(\d{1,2})(?:[:h](\d{2}))?/);
    if (timeM) {
      target.setHours(Number(timeM[1]), Number(timeM[2] ?? '0'), 0, 0);
    } else if (/\bmatin\b/.test(p)) {
      target.setHours(9, 0, 0, 0);
    } else if (/\bmidi\b/.test(p)) {
      target.setHours(12, 0, 0, 0);
    } else if (/\bsoir\b/.test(p)) {
      target.setHours(19, 0, 0, 0);
    } else {
      target.setHours(9, 0, 0, 0);
    }

    return target.getTime();
  }

  return null;
}

function cleanActionAfterScheduleRemoval(text: string): string {
  return text
    .trim()
    .replace(/^de\s+/i, '')
    .replace(/^d[''’]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrait un horaire relatif/absolu court et nettoie le texte d'action. */
export function parseReminderScheduleFromText(
  text: string,
  now: Date = new Date(),
): ReminderScheduleFromText | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const match = findSchedulePhrase(trimmed);
  if (!match) return null;

  const at = scheduleAtFromPhrase(match.phrase, now);
  if (at === null) return null;

  const withoutSchedule =
    trimmed.slice(0, match.index) + trimmed.slice(match.index + match.length);
  const action = cleanActionAfterScheduleRemoval(withoutSchedule);
  if (!action || action.length < 2) return null;

  return {
    at,
    recurrence: 'once',
    text: action,
  };
}

/** Détecte une expression temporelle relative dans la phrase. */
export function hasRelativeReminderSchedule(text: string): boolean {
  return findSchedulePhrase(text.trim()) !== null;
}
