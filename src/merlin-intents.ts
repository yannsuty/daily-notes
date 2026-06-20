import { executeMerlinTool, type ToolResult } from './merlin-tools';

export interface IntentResult {
  handled: boolean;
  reply?: string;
  sideEffects?: ToolResult['mutation'];
  usedTool?: string;
}

function stripMerlinPrefix(text: string): string {
  return text.replace(/^merlin[,:\s]+/i, '').trim();
}

function parseTimeFromText(text: string): { timeOfDay?: string; recurrence?: string } {
  const lower = text.toLowerCase();
  let recurrence: string | undefined;
  if (/tous les midis|chaque midi|à midi|le midi/.test(lower)) {
    return { timeOfDay: '12:00', recurrence: 'daily' };
  }
  if (/tous les matins|chaque matin|le matin/.test(lower)) {
    return { timeOfDay: '08:00', recurrence: 'daily' };
  }
  if (/tous les soirs|chaque soir|le soir/.test(lower)) {
    return { timeOfDay: '20:00', recurrence: 'daily' };
  }
  if (/tous les jours|chaque jour|quotidien/.test(lower)) {
    recurrence = 'daily';
  }
  const hm = lower.match(/(\d{1,2})[:h](\d{2})/);
  if (hm) {
    const h = String(Number(hm[1])).padStart(2, '0');
    const m = hm[2] ?? '00';
    return { timeOfDay: `${h}:${m}`, recurrence: recurrence ?? 'daily' };
  }
  return { recurrence };
}

const CONTEXT_MAP: Record<string, string> = {
  travail: 'travail',
  bureau: 'travail',
  maison: 'maison',
  domicile: 'maison',
  courses: 'courses',
  'super marché': 'courses',
  supermarche: 'courses',
};

function detectContextTags(text: string): string[] {
  const lower = text.toLowerCase();
  const tags = new Set<string>();
  for (const [phrase, tag] of Object.entries(CONTEXT_MAP)) {
    if (lower.includes(phrase)) tags.add(tag);
  }
  if (/au travail|en rentrant|rentrant du travail/.test(lower)) {
    tags.add('maison');
  }
  return [...tags];
}

export async function tryFastIntent(rawText: string): Promise<IntentResult> {
  const text = stripMerlinPrefix(rawText.trim());
  if (!text) return { handled: false };

  // Context trigger: "je suis au travail"
  const contextMatch = text.match(
    /^(?:je suis|nous sommes|contexte)\s+(?:au\s+|à\s+|chez\s+)?(.+)/i,
  );
  if (contextMatch) {
    const phrase = contextMatch[1].trim().toLowerCase();
    const tags = detectContextTags(phrase);
    if (tags.length > 0) {
      const result = await executeMerlinTool('trigger_context', { tags: tags.join(',') });
      return {
        handled: true,
        reply: result.content,
        sideEffects: result.mutation,
        usedTool: 'trigger_context',
      };
    }
  }

  // Complete reminder: "c'est fait"
  if (/^(?:c'est|c est) fait\.?$/i.test(text) || /^marque(?:r)? (?:comme )?fait/i.test(text)) {
    const result = await executeMerlinTool('complete_reminder', {});
    return {
      handled: true,
      reply: result.content,
      sideEffects: result.mutation,
      usedTool: 'complete_reminder',
    };
  }

  // Add to list: "ajoute X à la liste Y" / "ajoute X à courses"
  const addMatch = text.match(
    /^ajoute(?:r)?\s+(.+?)\s+(?:à la liste\s+|à\s+|sur\s+(?:la\s+)?liste\s+)?(.+)$/i,
  );
  if (addMatch) {
    const item = addMatch[1].trim();
    let list = addMatch[2].trim();
    list = list.replace(/^(?:ma|la|les)\s+/i, '');
    const result = await executeMerlinTool('add_list_item', { list, item });
    return {
      handled: true,
      reply: result.ok ? result.content : result.content,
      sideEffects: result.mutation,
      usedTool: 'add_list_item',
    };
  }

  // Create list
  const createListMatch = text.match(/^(?:crée|creer|créer|nouvelle)\s+(?:une\s+)?liste\s+(.+)/i);
  if (createListMatch) {
    const result = await executeMerlinTool('create_list', { title: createListMatch[1].trim() });
    return {
      handled: true,
      reply: result.content,
      sideEffects: result.mutation,
      usedTool: 'create_list',
    };
  }

  // Show lists
  if (
    /^(?:montre|affiche|liste|qu'est-ce qu'il me reste|quest ce qu'il me reste)/i.test(text) &&
    /(?:courses|liste|acheter|shopping)/i.test(text)
  ) {
    const listMatch = text.match(/liste\s+(\w+)/i);
    const result = await executeMerlinTool('show_lists', {
      list: listMatch?.[1] ?? '',
    });
    return {
      handled: true,
      reply: result.content,
      usedTool: 'show_lists',
    };
  }

  // Toggle item
  const toggleMatch = text.match(/^(?:coche|décoche|decoche)\s+(.+?)(?:\s+(?:dans|sur|de)\s+(?:la\s+)?liste\s+(.+))?$/i);
  if (toggleMatch) {
    const result = await executeMerlinTool('toggle_list_item', {
      item: toggleMatch[1].trim(),
      list: toggleMatch[2]?.trim() ?? 'courses',
    });
    return {
      handled: true,
      reply: result.content,
      sideEffects: result.mutation,
      usedTool: 'toggle_list_item',
    };
  }

  // Reminder
  const reminderMatch = text.match(
    /^(?:rappelle[- ]moi(?: de)?|mets(?: un)? rappel(?: pour)?)\s+(.+)/i,
  );
  if (reminderMatch) {
    const body = reminderMatch[1].trim();
    const { timeOfDay, recurrence } = parseTimeFromText(body);
    const contextTags = detectContextTags(body);
    const cleanText = body
      .replace(/tous les midis|chaque midi|à midi|le midi/gi, '')
      .replace(/tous les matins|chaque matin/gi, '')
      .replace(/tous les soirs|chaque soir/gi, '')
      .replace(/au travail|à la maison|en rentrant/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const args: Record<string, string> = { text: cleanText || body };
    if (contextTags.length > 0 && !timeOfDay) {
      args.contextTags = contextTags.join(',');
    } else {
      if (timeOfDay) args.timeOfDay = timeOfDay;
      if (recurrence) args.recurrence = recurrence;
      if (contextTags.length > 0) args.contextTags = contextTags.join(',');
    }

    const result = await executeMerlinTool('create_reminder', args);
    return {
      handled: true,
      reply: result.content,
      sideEffects: result.mutation,
      usedTool: 'create_reminder',
    };
  }

  // List reminders
  if (/^(?:mes rappels|rappels du jour|liste des rappels)/i.test(text)) {
    const result = await executeMerlinTool('list_reminders', {});
    return {
      handled: true,
      reply: result.content,
      usedTool: 'list_reminders',
    };
  }

  // Custom tool by name: "/prep_courses" or "routine prep_courses"
  const macroMatch = text.match(/^(?:\/|routine\s+)([\w-]+)(?:\s+(.+))?$/i);
  if (macroMatch) {
    const name = macroMatch[1].toLowerCase();
    const paramStr = macroMatch[2]?.trim();
    const args: Record<string, string> = {};
    if (paramStr) args.item = paramStr;
    const result = await executeMerlinTool(name, args);
    if (result.ok || !result.content.includes('introuvable')) {
      return {
        handled: true,
        reply: result.content,
        sideEffects: result.mutation,
        usedTool: name,
      };
    }
  }

  // Save custom tool / routine
  const saveToolMatch = text.match(
    /^(?:retiens ça comme outil|crée(?:r)? une routine(?: pour)?|sauve(?:garde)?(?: cette)? routine)\s*[:\s]?\s*(.*)$/i,
  );
  if (saveToolMatch) {
    return {
      handled: true,
      reply:
        'Pour sauvegarder une routine, décrivez les étapes puis dites « retiens ça comme outil nom X » après utilisation, ou utilisez l\'outil save_custom_tool via le chat.',
      usedTool: 'save_custom_tool',
    };
  }

  return { handled: false };
}

/** Heuristique légère sans effet de bord — pour l'indicateur UI avant appel LLM. */
export function likelyFastPath(text: string): boolean {
  const t = stripMerlinPrefix(text.trim());
  if (!t) return false;
  return (
    /^(?:ajoute|rappelle|c'est fait|c est fait|je suis|crée|creer|créer|montre|affiche|mes rappels|coche|décoche|\/|routine\s+)/i.test(
      t,
    ) || /(?:liste|courses)/i.test(t)
  );
}

export const CONTEXT_CHIPS = [
  { label: 'Travail', tags: 'travail' },
  { label: 'Maison', tags: 'maison' },
  { label: 'Courses', tags: 'courses' },
];
