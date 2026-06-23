import { assessQueryDepth, extractMemoryQueries } from '../../lib/merlin-agent/complexity.js';
import { gatherMemory } from '../../lib/merlin-agent/memory.js';
import { parseJsonFromAi, parseToolCall } from '../../lib/merlin-agent/parse.js';
import { needsReminderExtraction } from '../../lib/merlin-agent/reminder-extract.js';
import { buildLocalReminderFallback } from '../../lib/merlin-agent/reminder-text.js';
import {
  buildSystemPrompt,
  PLANNER_PROMPT,
  SYNTHESIS_PROMPT,
} from '../../lib/merlin-agent/prompts.js';
import { callMerlinLlm } from './llm.js';
import { extractReminderFields } from './reminder-extract.js';
import { AgentStore, isImmediateReplyTool, normalizeToolArgs, templateReplyForTool } from './tools.js';
import type {
  AgentClientConfig,
  AgentContext,
  AgentRunResult,
  AgentSideEffect,
  AgentStep,
  ChatMessage,
} from '../../lib/merlin-agent/types.js';

const MAX_CONTEXT_MESSAGES = 24;
const CONTINUE_TOOLS = new Set([
  'read_journal',
  'search_journal',
  'summarize_period',
  'show_lists',
  'list_reminders',
  'show_space',
  'list_spaces',
  'inspect_github_repo',
  'create_space',
  'update_space',
]);

export type StepCallback = (step: AgentStep) => void;

interface PlannerResult {
  intent?: string;
  memoryQueries?: string[];
  suggestedTools?: string[];
  approach?: string;
}

function pushStep(steps: AgentStep[], step: AgentStep, onStep?: StepCallback): void {
  steps.push(step);
  onStep?.(step);
}

function getRecentMessages(context: AgentContext): ChatMessage[] {
  return context.recentMessages.slice(-MAX_CONTEXT_MESSAGES).map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

function pickSideEffect(store: AgentStore): AgentSideEffect | undefined {
  const mutations = store.getMutations();
  const reminder = mutations.reminders?.[0];
  if (reminder) {
    if (reminder.status === 'done') return 'reminder_completed';
    return 'reminder_created';
  }
  if ((mutations.lists?.length ?? 0) > 0) return 'list_updated';
  if ((mutations.spaces?.length ?? 0) > 0) return 'space_updated';
  return undefined;
}

async function runPlanner(
  userMessage: string,
  context: AgentContext,
  config: AgentClientConfig,
  referer?: string,
): Promise<PlannerResult | null> {
  const messages: ChatMessage[] = [
    { role: 'system', content: PLANNER_PROMPT },
    {
      role: 'user',
      content: `Demande utilisateur : ${userMessage}

Faits connus (${context.facts.length}) : ${context.facts.slice(0, 8).map((f) => f.key).join(', ') || 'aucun'}
Résumé conversation : ${context.conversationSummary.trim() || '(vide)'}`,
    },
  ];

  const result = await callMerlinLlm(messages, config, {
    temperature: 0.2,
    jsonMode: true,
    referer,
  });

  if (!result.ok || !result.text) return null;
  return parseJsonFromAi<PlannerResult>(result.text);
}

async function synthesizeReply(
  userMessage: string,
  draft: string,
  config: AgentClientConfig,
  referer?: string,
): Promise<string> {
  const result = await callMerlinLlm(
    [
      { role: 'system', content: SYNTHESIS_PROMPT },
      {
        role: 'user',
        content: `Demande : ${userMessage}

Brouillon / résultats :
${draft}

Formule la réponse finale.`,
      },
    ],
    config,
    { temperature: 0.5, referer },
  );

  return result.ok && result.text ? result.text : draft;
}

export async function runMerlinAgent(
  userMessage: string,
  context: AgentContext,
  config: AgentClientConfig,
  options?: { onStep?: StepCallback; referer?: string },
): Promise<AgentRunResult> {
  const steps: AgentStep[] = [];
  const onStep = options?.onStep;
  const trimmed = userMessage.trim();

  if (!trimmed) {
    return {
      ok: false,
      error: 'Message vide.',
      steps,
      mutations: {},
      depth: 'standard',
    };
  }

  const depth = assessQueryDepth(trimmed);
  pushStep(steps, {
    phase: 'analyze',
    label: depth === 'deep' ? 'Analyse approfondie de la demande…' : 'Analyse de la demande…',
    detail: depth === 'deep' ? 'Question complexe détectée' : undefined,
  }, onStep);

  const store = new AgentStore(context, { githubToken: config.githubToken });
  let memoryBlock = '';
  let planner: PlannerResult | null = null;
  let memoryQueries = extractMemoryQueries(trimmed);

  if (depth === 'deep') {
    pushStep(steps, {
      phase: 'plan',
      label: 'Élaboration d\'un plan…',
    }, onStep);

    planner = await runPlanner(trimmed, context, config, options?.referer);
    if (planner?.approach) {
      pushStep(steps, {
        phase: 'plan',
        label: 'Plan établi',
        detail: planner.approach,
      }, onStep);
    }

    if (planner?.memoryQueries?.length) {
      memoryQueries = [...new Set([...memoryQueries, ...planner.memoryQueries])].slice(0, 6);
    }
  }

  pushStep(steps, {
    phase: 'memory',
    label: 'Recherche en mémoire…',
    detail: memoryQueries.slice(0, 3).join(' · ') || undefined,
  }, onStep);

  const memory = gatherMemory(context, memoryQueries);
  if (memory.block) {
    memoryBlock = memory.block;
    pushStep(steps, {
      phase: 'memory',
      label: `${memory.hits.length} élément(s) retrouvé(s)`,
      detail: memory.hits
        .slice(0, 3)
        .map((h) => (h.source === 'fact' ? h.label : h.label.split(' ')[0]))
        .join(', '),
    }, onStep);
  } else {
    pushStep(steps, {
      phase: 'memory',
      label: 'Aucun élément pertinent en mémoire',
    }, onStep);
  }

  const systemPrompt = buildSystemPrompt(context, memoryBlock);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...getRecentMessages(context),
  ];

  if (planner?.approach) {
    messages.push({
      role: 'system',
      content: `Plan interne (ne pas répéter mot pour mot) :\n${planner.approach}`,
    });
  }

  if (planner?.suggestedTools?.length) {
    messages.push({
      role: 'system',
      content: `Outils suggérés : ${planner.suggestedTools.join(', ')}`,
    });
  }

  messages.push({ role: 'user', content: trimmed });

  const maxIterations = depth === 'deep' ? 5 : 3;
  let lastSideEffect: AgentSideEffect | undefined;
  let toolResultsForSynthesis: string[] = [];
  let continueAfterTools = false;

  for (let i = 0; i < maxIterations; i += 1) {
    pushStep(steps, {
      phase: 'think',
      label: i === 0 ? 'Réflexion…' : `Réflexion (étape ${i + 1})…`,
    }, onStep);

    const result = await callMerlinLlm(messages, config, {
      temperature: depth === 'deep' ? 0.55 : 0.45,
      referer: options?.referer,
    });

    if (!result.ok || !result.text) {
      return {
        ok: false,
        error: result.error ?? 'Service IA indisponible.',
        steps,
        mutations: store.getMutations(),
        depth,
      };
    }

    const toolCall = parseToolCall(result.text);
    if (!toolCall) {
      pushStep(steps, {
        phase: 'respond',
        label: 'Réponse prête',
      }, onStep);

      return {
        ok: true,
        reply: result.text,
        steps,
        mutations: store.getMutations(),
        sideEffects: pickSideEffect(store) ?? lastSideEffect,
        depth,
      };
    }

    pushStep(steps, {
      phase: 'tool',
      label: `Outil : ${toolCall.name}`,
      detail: Object.entries(toolCall.args ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
        .slice(0, 120) || undefined,
    }, onStep);

    let toolArgs = normalizeToolArgs(toolCall.args ?? {});

    if (toolCall.name === 'create_reminder') {
      const text = toolArgs.text ?? '';
      const contextTags = toolArgs.contextTags ?? toolArgs.tags;
      if (needsReminderExtraction(text, contextTags)) {
        const extracted = await extractReminderFields(trimmed, config, options?.referer);
        if (extracted?.isReminder && extracted.text) {
          toolArgs = {
            ...toolArgs,
            text: extracted.text,
            contextTags: extracted.contextTags?.join(',') ?? contextTags,
            timeOfDay: extracted.timeOfDay ?? toolArgs.timeOfDay ?? toolArgs.time,
            recurrence: extracted.recurrence ?? toolArgs.recurrence,
          };
        } else {
          const local = buildLocalReminderFallback(trimmed);
          if (local?.text) {
            toolArgs = {
              ...toolArgs,
              text: local.text,
              contextTags: local.contextTags.join(',') || contextTags,
            };
          }
        }
      }
    }

    const toolResult = await store.executeTool(toolCall.name, toolArgs);
    if (toolResult.mutation) lastSideEffect = toolResult.mutation;

    const template = templateReplyForTool(toolCall.name, toolResult);
    if (template) {
      pushStep(steps, {
        phase: 'respond',
        label: 'Action effectuée',
      }, onStep);
      return {
        ok: true,
        reply: template,
        steps,
        mutations: store.getMutations(),
        sideEffects: toolResult.mutation ?? lastSideEffect,
        depth,
      };
    }

    if (isImmediateReplyTool(toolCall.name)) {
      pushStep(steps, {
        phase: 'respond',
        label: 'Action effectuée',
      }, onStep);
      return {
        ok: true,
        reply: toolResult.content,
        steps,
        mutations: store.getMutations(),
        sideEffects: toolResult.mutation ?? lastSideEffect,
        depth,
      };
    }

    if (CONTINUE_TOOLS.has(toolCall.name)) {
      continueAfterTools = true;
      toolResultsForSynthesis.push(`[${toolCall.name}]\n${toolResult.content}`);
    }

    messages.push({ role: 'assistant', content: result.text });
    messages.push({
      role: 'user',
      content: `Résultat de l'outil ${toolCall.name} :\n${toolResult.content}\n\nContinue : utilise un autre outil si nécessaire, sinon réponds en texte naturel.`,
    });
  }

  if (continueAfterTools && toolResultsForSynthesis.length > 0) {
    pushStep(steps, {
      phase: 'synthesize',
      label: 'Synthèse de la réponse…',
    }, onStep);

    const reply = await synthesizeReply(
      trimmed,
      toolResultsForSynthesis.join('\n\n'),
      config,
      options?.referer,
    );

    pushStep(steps, {
      phase: 'respond',
      label: 'Réponse prête',
    }, onStep);

    return {
      ok: true,
      reply,
      steps,
      mutations: store.getMutations(),
      sideEffects: pickSideEffect(store) ?? lastSideEffect,
      depth,
    };
  }

  return {
    ok: false,
    error: 'Merlin n\'a pas pu terminer sa réflexion. Réessayez avec une demande plus simple.',
    steps,
    mutations: store.getMutations(),
    depth,
  };
}
