import type { ReminderScheduleFromText } from './reminder-datetime.js';

export interface ReminderScheduleExtractPayload {
  hasSchedule?: boolean;
  at?: string | null;
  text?: string;
}

export function buildReminderScheduleExtractPrompt(now: Date): string {
  const local = now.toLocaleString('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const iso = now.toISOString();

  return `Tu extrais la date et l'heure d'un rappel exprimé en français naturel.
Maintenant : ${local} (ISO : ${iso})

Réponds UNIQUEMENT en JSON valide :
{
  "hasSchedule": true,
  "at": "2026-07-15T08:00:00.000Z",
  "text": "action courte sans mention temporelle"
}

Règles :
- hasSchedule : false si aucune date/heure planifiable n'est mentionnée
- at : instant ISO 8601 dans le futur (fuseau local de l'utilisateur, puis converti en ISO)
- text : uniquement l'action à faire, sans date, heure, ni amorce (« de », « d' »)
- Heure par défaut si seul un jour est donné : 09:00
- « ce soir » → 19:00 le jour même ; « cette nuit » → 22:00
- « lundi prochain », « la semaine prochaine », dates calendaires (« le 15 juillet »), « dans une quinzaine » : calcule la prochaine occurrence future

Exemples :
- « lundi prochain à 14h appeler le client » → hasSchedule true, at = prochain lundi 14:00, text = appeler le client
- « le 3 juillet envoyer le devis » → hasSchedule true, at = 3 juillet 09:00 (année courante ou suivante)
- « dans une quinzaine payer le loyer » → hasSchedule true, at = +15 jours 09:00
- « appeler le médecin » → hasSchedule false`;
}

export function parseReminderScheduleExtractPayload(
  raw: unknown,
  now: Date = new Date(),
): ReminderScheduleFromText | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as ReminderScheduleExtractPayload;
  if (payload.hasSchedule === false) return null;
  if (payload.hasSchedule !== true) return null;

  const text = payload.text?.trim();
  const atRaw = payload.at?.trim();
  if (!text || !atRaw) return null;

  const at = Date.parse(atRaw);
  if (Number.isNaN(at) || at <= now.getTime()) return null;

  return {
    at,
    recurrence: 'once',
    text,
  };
}
