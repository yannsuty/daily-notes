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

const WEEKDAYS: Record<string, number> = {
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
};

const TIME_SUFFIX =
  '(?:\\s+(?:matin|midi|soir|(?:à|a)\\s+\\d{1,2}(?:h\\d{0,2}|:\\d{2})?))?';

const SCHEDULE_PHRASE_PATTERNS: RegExp[] = [
  /\bdans\s+\d+\s*h\s*\d{1,2}\b/i,
  /\bdans\s+\d+\s*h(?:eure?s?)?(?:\s*(?:et\s+)?\d+\s*(?:min(?:ute?s?)?|mn))?/i,
  /\bdans\s+\d+\s*(?:min(?:ute?s?)?|mn)\b/i,
  /\bdans\s+une\s+semaine\b/i,
  /\bdans\s+\d+\s*semaines?\b/i,
  /\bdans\s+\d+\s*jours?\b/i,
  /\b(?:la\s+)?semaine\s+prochaine\b/i,
  /\baprès[- ]demain(?:\s+(?:matin|midi|soir|(?:à|a)\s+\d{1,2}(?:h\d{0,2}|:\d{2})?))?/i,
  /\bdemain(?:\s+(?:matin|midi|soir|(?:à|a)\s+\d{1,2}(?:h\d{0,2}|:\d{2})?))?/i,
  /\baujourd['’]?hui(?:\s+(?:matin|midi|soir|(?:à|a)\s+\d{1,2}(?:h\d{0,2}|:\d{2})?))?/i,
  /\bce\s+matin\b/i,
  /\bce\s+midi\b/i,
  /\bcet\s+après[- ]midi\b/i,
  /\bcet\s+aprem\b/i,
  /\bce\s+soir\b/i,
  /\bcette\s+nuit\b/i,
  new RegExp(`\\b(?:ce\\s+)?(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\\s+prochain${TIME_SUFFIX}`, 'i'),
  new RegExp(
    `\\b(?:ce\\s+)?(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)${TIME_SUFFIX}`,
    'i',
  ),
];

/** Indices heuristiques qu'une planification est mentionnée (parseur local ou LLM). */
export const REMINDER_SCHEDULE_HINT =
  /\b(demain|après[- ]demain|aujourd['’]?hui|ce\s+(?:matin|midi|soir)|cet\s+(?:après[- ]midi|aprem)|cette\s+nuit|dans\s+(?:une\s+)?\d+|semaine\s+prochaine|(?:ce\s+)?(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)|le\s+\d{1,2}(?:er)?|(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)|quinzaine|mois\s+prochain)\b/i;

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

function applyTimeFromPhrase(target: Date, phrase: string, defaultHour: number, defaultMin = 0): void {
  const timeM = phrase.match(/(?:à|a)\s+(\d{1,2})(?:h(\d{1,2})?|:(\d{2}))?/i);
  if (timeM) {
    target.setHours(Number(timeM[1]), Number(timeM[2] ?? timeM[3] ?? '0'), 0, 0);
    return;
  }
  if (/\bmatin\b/.test(phrase)) {
    target.setHours(9, 0, 0, 0);
    return;
  }
  if (/\bmidi\b/.test(phrase)) {
    target.setHours(12, 0, 0, 0);
    return;
  }
  if (/\bsoir\b/.test(phrase)) {
    target.setHours(19, 0, 0, 0);
    return;
  }
  if (/\bnuit\b/.test(phrase)) {
    target.setHours(22, 0, 0, 0);
    return;
  }
  target.setHours(defaultHour, defaultMin, 0, 0);
}

function bumpIfPast(target: Date, now: Date): number {
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

function scheduleWeekdayFromPhrase(phrase: string, now: Date): number | null {
  const p = phrase.trim().toLowerCase();
  const dayM = p.match(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/);
  if (!dayM) return null;

  const weekday = WEEKDAYS[dayM[1]];
  const forceNextWeek = /\bprochain\b/.test(p);
  const allowToday = /\bce\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.test(p);

  const target = new Date(now);
  let delta = (weekday - target.getDay() + 7) % 7;
  if (delta === 0 && !allowToday) delta = 7;

  if (forceNextWeek) {
    const candidate = new Date(target);
    candidate.setDate(candidate.getDate() + delta);
    const endOfWeek = new Date(target);
    endOfWeek.setDate(endOfWeek.getDate() + ((7 - endOfWeek.getDay()) % 7));
    endOfWeek.setHours(23, 59, 59, 999);
    if (candidate.getTime() <= endOfWeek.getTime()) {
      delta += 7;
    }
  }

  target.setDate(target.getDate() + delta);
  target.setSeconds(0, 0);
  applyTimeFromPhrase(target, p, 9, 0);
  return bumpIfPast(target, now);
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

  if (/^dans\s+une\s+semaine$/i.test(p)) {
    const target = new Date(now);
    target.setDate(target.getDate() + 7);
    target.setHours(9, 0, 0, 0);
    return target.getTime();
  }

  m = p.match(/^dans\s+(\d+)\s*semaines?$/i);
  if (m) {
    const target = new Date(now);
    target.setDate(target.getDate() + Number(m[1]) * 7);
    target.setHours(9, 0, 0, 0);
    return target.getTime();
  }

  m = p.match(/^dans\s+(\d+)\s*jours?$/i);
  if (m) {
    const target = new Date(now);
    target.setDate(target.getDate() + Number(m[1]));
    target.setHours(9, 0, 0, 0);
    return target.getTime();
  }

  if (/^(?:la\s+)?semaine\s+prochaine$/i.test(p)) {
    const target = new Date(now);
    target.setDate(target.getDate() + 7);
    target.setHours(9, 0, 0, 0);
    return target.getTime();
  }

  if (/^aujourd['’]?hui/i.test(p)) {
    const target = new Date(now);
    target.setSeconds(0, 0);
    applyTimeFromPhrase(target, p, 18, 0);
    return bumpIfPast(target, now);
  }

  if (/^ce\s+matin$/i.test(p)) {
    const target = new Date(now);
    target.setHours(9, 0, 0, 0);
    return bumpIfPast(target, now);
  }

  if (/^ce\s+midi$/i.test(p)) {
    const target = new Date(now);
    target.setHours(12, 0, 0, 0);
    return bumpIfPast(target, now);
  }

  if (/^cet\s+(?:après[- ]midi|aprem)$/i.test(p)) {
    const target = new Date(now);
    target.setHours(15, 0, 0, 0);
    return bumpIfPast(target, now);
  }

  if (/^ce\s+soir$/i.test(p)) {
    const target = new Date(now);
    target.setHours(19, 0, 0, 0);
    return bumpIfPast(target, now);
  }

  if (/^cette\s+nuit$/i.test(p)) {
    const target = new Date(now);
    target.setHours(22, 0, 0, 0);
    return bumpIfPast(target, now);
  }

  if (/\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.test(p)) {
    return scheduleWeekdayFromPhrase(p, now);
  }

  const dayOffset = /^après[- ]demain/.test(p) ? 2 : /^demain/.test(p) ? 1 : null;
  if (dayOffset !== null) {
    const target = new Date(now);
    target.setDate(target.getDate() + dayOffset);
    target.setSeconds(0, 0);
    applyTimeFromPhrase(target, p, 9, 0);
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

export function hasReminderScheduleHint(text: string): boolean {
  return REMINDER_SCHEDULE_HINT.test(text.trim());
}

/** Indique si un repli LLM est utile pour l'horaire. */
export function needsScheduleLlmFallback(text: string, now: Date = new Date()): boolean {
  const trimmed = text.trim();
  if (!trimmed || !hasReminderScheduleHint(trimmed)) return false;
  return parseReminderScheduleFromText(trimmed, now) === null;
}
