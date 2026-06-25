import { tryParseAddListIntent } from '../lib/merlin-agent/list-fast-path';
import { likelyReminderIntent } from '../lib/merlin-agent/reminder-extract';
import { buildLocalReminderFallback, cleanReminderActionText } from '../lib/merlin-agent/reminder-text';
import { detectContextTags } from './merlin-context';
import { extractReminderFields } from './merlin-reminder-extract';
import { executeMerlinTool, type ToolResult } from './merlin-tools';
import { getMerlinCustomToolByName } from './db';
import { parseRoutineInvocation } from './merlin-tool-registry';

export interface IntentResult {
  handled: boolean;
  reply?: string;
  sideEffects?: ToolResult['mutation'];
  usedTool?: string;
}

function stripMerlinPrefix(text: string): string {
  return text.replace(/^merlin[,:\s]+/i, '').trim();
}

function reminderArgsFromExtract(
  extracted: NonNullable<Awaited<ReturnType<typeof extractReminderFields>>>,
): Record<string, string> {
  const args: Record<string, string> = { text: extracted.text! };
  if (extracted.contextTags?.length) {
    args.contextTags = extracted.contextTags.join(',');
  }
  if (extracted.timeOfDay) args.timeOfDay = extracted.timeOfDay;
  if (extracted.recurrence) args.recurrence = extracted.recurrence;
  return args;
}

function reminderArgsFromLocal(text: string): Record<string, string> | null {
  const local = buildLocalReminderFallback(text);
  if (!local?.text) return null;
  const args: Record<string, string> = { text: local.text };
  if (local.contextTags.length > 0) {
    args.contextTags = local.contextTags.join(',');
  }
  return args;
}

async function resolveReminderArgs(text: string): Promise<Record<string, string> | null> {
  const extracted = await extractReminderFields(text);
  if (extracted?.isReminder === false) return null;
  if (extracted?.isReminder && extracted.text) {
    return reminderArgsFromExtract(extracted);
  }
  return reminderArgsFromLocal(text);
}

function isDeleteReminderIntent(text: string): boolean {
  if (/^ne (?:me )?rappelle(?:[- ]moi)? plus\b/i.test(text)) return true;
  return /^(?:retire(?:r)?|supprime(?:r)?|annule(?:r)?|enl[eè]ve(?:r)?|oublie)\s+(?:le\s+|mon\s+|un\s+)?rappel\b/i.test(
    text,
  );
}

function deleteReminderHint(text: string): string | undefined {
  const noMoreMatch = text.match(/^ne (?:me )?rappelle(?:[- ]moi)? plus (?:de )?(.+)/i);
  if (noMoreMatch) {
    return cleanReminderActionText(noMoreMatch[1].trim()) || noMoreMatch[1].trim() || undefined;
  }

  const deleteMatch = text.match(
    /^(?:retire(?:r)?|supprime(?:r)?|annule(?:r)?|enl[eè]ve(?:r)?|oublie)\s+(?:le\s+|mon\s+|un\s+)?rappel(?:\s+(?:de|pour|sur|contextuel))?\s+(.+)/i,
  );
  if (deleteMatch) {
    return cleanReminderActionText(deleteMatch[1].trim()) || deleteMatch[1].trim() || undefined;
  }

  return undefined;
}

export async function tryFastIntent(rawText: string): Promise<IntentResult> {
  const text = stripMerlinPrefix(rawText.trim());
  if (!text) return { handled: false };

  // Context trigger: "je suis au travail"
  const contextMatch = text.match(
    /^(?:j[e']?\s*suis|nous sommes|contexte)\s+(?:au\s+|à\s+|a\s+|chez\s+)?(.+)/i,
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

  // Delete reminder: "retire le rappel de sortir les poubelles"
  if (isDeleteReminderIntent(text)) {
    const hint = deleteReminderHint(text);
    const args: Record<string, string> = {};
    if (hint) args.text = hint;
    const result = await executeMerlinTool('delete_reminder', args);
    return {
      handled: true,
      reply: result.content,
      sideEffects: result.mutation,
      usedTool: 'delete_reminder',
    };
  }

  // Add to list : uniquement si l'article est explicite (pas « ça ») et message simple
  const addParsed = tryParseAddListIntent(text);
  if (addParsed) {
    const result = await executeMerlinTool('add_list_item', {
      list: addParsed.list,
      item: addParsed.item,
    });
    return {
      handled: true,
      reply: result.content,
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

  // Reminder explicite : "rappelle-moi de …"
  const reminderMatch = text.match(
    /^(?:rappelle[- ]moi(?: de)?|mets(?: un)? rappel(?: pour)?)\s+(.+)/i,
  );
  if (reminderMatch) {
    const body = reminderMatch[1].trim();
    const args = (await resolveReminderArgs(body)) ?? { text: body };

    const result = await executeMerlinTool('create_reminder', args);
    return {
      handled: true,
      reply: result.content,
      sideEffects: result.mutation,
      usedTool: 'create_reminder',
    };
  }

  // Rappel implicite : "quand je rentre à la maison je dois sortir les poubelles"
  if (likelyReminderIntent(text)) {
    const args = await resolveReminderArgs(text);
    if (args?.text) {
      const result = await executeMerlinTool('create_reminder', args);
      return {
        handled: true,
        reply: result.content,
        sideEffects: result.mutation,
        usedTool: 'create_reminder',
      };
    }
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
    const customTool = await getMerlinCustomToolByName(name);
    const args = parseRoutineInvocation(paramStr, customTool?.params);
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
    /^(?:ajoute|rappelle|c'est fait|c est fait|j[e']?\s*suis|nous sommes|contexte|crée|creer|créer|montre|affiche|mes rappels|coche|décoche|retire|retirer|supprime|supprimer|annule|annuler|enlève|enlever|\/|routine\s+)/i.test(
      t,
    ) ||
    likelyReminderIntent(t) ||
    /(?:liste|courses)/i.test(t)
  );
}

export const CONTEXT_CHIPS = [
  { label: 'Travail', tags: 'travail' },
  { label: 'Maison', tags: 'maison' },
  { label: 'Courses', tags: 'courses' },
];
