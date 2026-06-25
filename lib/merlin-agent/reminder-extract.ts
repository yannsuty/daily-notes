import { detectContextTags, normalizeContextTags } from './context.js';

export interface ReminderExtractPayload {
  isReminder?: boolean;
  text?: string;
  contextTags?: string[];
  timeOfDay?: string | null;
  recurrence?: 'daily' | 'weekly' | 'once' | null;
}

export interface ReminderExtractResult {
  isReminder: boolean;
  text?: string;
  contextTags?: string[];
  timeOfDay?: string;
  recurrence?: 'daily' | 'weekly' | 'once';
}

export const REMINDER_EXTRACT_PROMPT = `Tu analyses une phrase en français pour en extraire un rappel ou une tâche à retenir.
Réponds UNIQUEMENT en JSON valide :
{
  "isReminder": true,
  "text": "action courte à retenir",
  "contextTags": ["maison"],
  "timeOfDay": "12:00",
  "recurrence": "daily"
}

Règles :
- isReminder : false si la phrase est une question, une conversation générale, ou ne décrit pas une action à retenir
- text : uniquement l'action à faire (ex. « sortir les poubelles »), sans le lieu ni la condition temporelle (« quand je rentre », « à la maison »)
- Ne reformule pas incorrectement : garde les mots de l'utilisateur pour l'action
- contextTags : tableau parmi travail, maison, courses — seulement si le rappel dépend d'un lieu ou contexte
- timeOfDay : format HH:MM (24h) si un horaire est mentionné, sinon null ou absent
- recurrence : daily, weekly ou once si une récurrence est mentionnée, sinon absent

Exemples :
- « quand je rentre à la maison je dois sortir les poubelles » → {"isReminder":true,"text":"sortir les poubelles","contextTags":["maison"]}
- « rappelle-moi d'appeler le médecin à 15h » → {"isReminder":true,"text":"appeler le médecin","timeOfDay":"15:00","recurrence":"daily"}
- « comment ça va » → {"isReminder":false}`;

/** Heuristique légère : la phrase ressemble-t-elle à un rappel implicite ? */
export function likelyReminderIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t || t.length < 8) return false;
  if (/^(?:pourquoi|comment|qui|qu'est|quest|explique|dis-moi|raconte|bonjour|salut)\b/i.test(t)) {
    return false;
  }
  if (
    /^(?:ajoute|crée|creer|créer|montre|affiche|coche|décoche|mes rappels|liste des|\/|routine\s+|retire|retirer|supprime|supprimer|annule|annuler|enlève|enlever|ne me rappelle)/i.test(
      t,
    )
  ) {
    return false;
  }

  const hasTaskSignal =
    /\b(je dois|il faut|faut |penser à|n'oublie|oublie pas|quand je|lorsque je|en rentrant)\b/i.test(
      t,
    );
  const hasContext = detectContextTags(t).length > 0;
  const hasTime = /\b(midi|matin|soir|\d{1,2}[:h]\d{2})\b/i.test(t);

  return hasTaskSignal || hasContext || hasTime;
}

function parseTimeOfDay(value: string): string | undefined {
  const m = value.trim().match(/(\d{1,2})[:h](\d{2})?/);
  if (!m) return undefined;
  const h = String(Number(m[1])).padStart(2, '0');
  const min = m[2] ? String(Number(m[2])).padStart(2, '0') : '00';
  return `${h}:${min}`;
}

export function parseReminderExtractPayload(raw: unknown): ReminderExtractResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as ReminderExtractPayload;
  if (payload.isReminder === false) {
    return { isReminder: false };
  }
  if (payload.isReminder !== true) return null;

  const text = payload.text?.trim();
  if (!text) return null;

  const contextTags = Array.isArray(payload.contextTags)
    ? normalizeContextTags(payload.contextTags)
    : undefined;

  let timeOfDay: string | undefined;
  if (typeof payload.timeOfDay === 'string' && payload.timeOfDay.trim()) {
    timeOfDay = parseTimeOfDay(payload.timeOfDay);
  }

  let recurrence: 'daily' | 'weekly' | 'once' | undefined;
  if (
    payload.recurrence === 'daily' ||
    payload.recurrence === 'weekly' ||
    payload.recurrence === 'once'
  ) {
    recurrence = payload.recurrence;
  }

  return {
    isReminder: true,
    text,
    contextTags: contextTags?.length ? contextTags : undefined,
    timeOfDay,
    recurrence,
  };
}

/** Indique si les args create_reminder du LLM semblent nécessiter une ré-extraction. */
export function needsReminderExtraction(text: string, contextTags?: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const lower = trimmed.toLowerCase();
  if (/^(?:quand|lorsque|en rentrant)\s+je\b/i.test(lower)) return true;
  if (/je\s+suis\s+de\s+/i.test(lower)) return true;
  if (contextTags && detectContextTags(trimmed).length > 0) return true;

  return false;
}
