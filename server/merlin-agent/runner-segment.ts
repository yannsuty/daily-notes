import { assessQueryDepth, extractMemoryQueries } from '../../lib/merlin-agent/complexity.js';
import { isComparisonRepairRequest } from '../../lib/merlin-agent/space-intent.js';
import type {
  AgentAdvanceResult,
  AgentJobCheckpoint,
  PlannerSnapshot,
} from '../../lib/merlin-agent/agent-checkpoint.js';
import { appendSourcesCitation, mergeWebSources } from '../../lib/merlin-agent/web.js';
import { gatherMemory } from '../../lib/merlin-agent/memory.js';
import { formatAgentReplyForUser, parseAgentTurn, parseJsonFromAi } from '../../lib/merlin-agent/parse.js';
import { needsReminderExtraction } from '../../lib/merlin-agent/reminder-extract.js';
import { buildLocalReminderFallback } from '../../lib/merlin-agent/reminder-text.js';
import {
  buildSystemPrompt,
  PLANNER_PROMPT,
  STRUCTURED_REPLY_REMINDER,
  SYNTHESIS_PROMPT,
} from '../../lib/merlin-agent/prompts.js';
import type {
  AgentClientConfig,
  AgentContext,
  AgentRequestBody,
  AgentRunResult,
  AgentSideEffect,
  AgentStep,
  ChatMessage,
  WebSource,
} from '../../lib/merlin-agent/types.js';
import { callMerlinLlm } from './llm.js';
import { extractReminderFields } from './reminder-extract.js';
import { ensureSpacePersisted } from './space-ensure.js';
import {
  AgentStore,
  isImmediateReplyTool,
  normalizeToolArgs,
  parseSpaceDataJson,
  templateReplyForTool,
} from './tools.js';
import type { StepCallback } from './runner.js';

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
  'web_search',
  'fetch_page',
]);

function pushStep(
  checkpoint: AgentJobCheckpoint,
  step: AgentStep,
  onStep?: StepCallback,
): void {
  checkpoint.steps.push(step);
  onStep?.(step);
}

function getRecentMessages(context: AgentContext): ChatMessage[] {
  return context.recentMessages.slice(-MAX_CONTEXT_MESSAGES).map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

function withWebCitations(reply: string | undefined, sources: WebSource[]): string | undefined {
  if (!reply) return reply;
  return appendSourcesCitation(reply, sources);
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

function restoreStore(checkpoint: AgentJobCheckpoint): AgentStore {
  return AgentStore.fromSnapshot(checkpoint.storeSnapshot);
}

function persistStore(checkpoint: AgentJobCheckpoint, store: AgentStore): void {
  checkpoint.storeSnapshot = store.toSnapshot();
}

function successResult(
  checkpoint: AgentJobCheckpoint,
  store: AgentStore,
  reply: string | undefined,
  sideEffects?: AgentSideEffect,
): AgentRunResult {
  return {
    ok: true,
    reply: withWebCitations(reply, checkpoint.webSources),
    steps: checkpoint.steps,
    mutations: store.getMutations(),
    sideEffects,
    depth: checkpoint.depth,
  };
}

function failResult(
  checkpoint: AgentJobCheckpoint,
  store: AgentStore,
  error: string,
): AgentRunResult {
  return {
    ok: false,
    error,
    steps: checkpoint.steps,
    mutations: store.getMutations(),
    depth: checkpoint.depth,
  };
}

async function runPlanner(
  userMessage: string,
  context: AgentContext,
  config: AgentClientConfig,
  referer?: string,
): Promise<PlannerSnapshot | null> {
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
  return parseJsonFromAi<PlannerSnapshot>(result.text);
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

function prepareMemoryPhase(checkpoint: AgentJobCheckpoint, onStep?: StepCallback): void {
  const { context, userMessage: trimmed } = checkpoint;

  pushStep(checkpoint, {
    phase: 'memory',
    label: 'Recherche en mémoire…',
    detail: checkpoint.memoryQueries.slice(0, 3).join(' · ') || undefined,
  }, onStep);

  const memory = gatherMemory(context, checkpoint.memoryQueries);
  if (memory.block) {
    checkpoint.memoryBlock = memory.block;
    pushStep(checkpoint, {
      phase: 'memory',
      label: `${memory.hits.length} élément(s) retrouvé(s)`,
      detail: memory.hits
        .slice(0, 3)
        .map((h) => (h.source === 'fact' ? h.label : h.label.split(' ')[0]))
        .join(', '),
    }, onStep);
  } else {
    pushStep(checkpoint, {
      phase: 'memory',
      label: 'Aucun élément pertinent en mémoire',
    }, onStep);
  }

  const systemPrompt = buildSystemPrompt(context, checkpoint.memoryBlock);
  checkpoint.messages = [
    { role: 'system', content: systemPrompt },
    ...getRecentMessages(context),
  ];

  if (checkpoint.planner?.approach) {
    checkpoint.messages.push({
      role: 'system',
      content: `Plan interne (ne pas répéter mot pour mot) :\n${checkpoint.planner.approach}`,
    });
  }

  if (checkpoint.planner?.suggestedTools?.length) {
    checkpoint.messages.push({
      role: 'system',
      content: `Outils suggérés : ${checkpoint.planner.suggestedTools.join(', ')}`,
    });
  }

  checkpoint.messages.push({ role: 'user', content: trimmed });
}

export function createBootstrapCheckpoint(body: AgentRequestBody): AgentJobCheckpoint {
  const trimmed = body.message.trim();
  const depth = assessQueryDepth(trimmed);
  const store = new AgentStore(body.context, { githubToken: body.config?.githubToken });

  return {
    userMessage: trimmed,
    context: body.context,
    config: body.config ?? {},
    depth,
    steps: [],
    storeSnapshot: store.toSnapshot(),
    memoryBlock: '',
    planner: null,
    memoryQueries: extractMemoryQueries(trimmed),
    messages: [],
    iteration: 0,
    maxIterations: depth === 'deep' ? 5 : 3,
    toolResultsForSynthesis: [],
    continueAfterTools: false,
    webSources: [],
    phase: 'bootstrap',
  };
}

export async function advanceAgentRun(
  checkpoint: AgentJobCheckpoint,
  options?: { onStep?: StepCallback; referer?: string },
): Promise<AgentAdvanceResult> {
  const onStep = options?.onStep;
  const referer = options?.referer;
  const trimmed = checkpoint.userMessage;

  if (!trimmed) {
    const store = restoreStore(checkpoint);
    return {
      status: 'failed',
      result: failResult(checkpoint, store, 'Message vide.'),
    };
  }

  const store = restoreStore(checkpoint);

  if (checkpoint.phase === 'bootstrap') {
    pushStep(checkpoint, {
      phase: 'analyze',
      label: checkpoint.depth === 'deep'
        ? 'Analyse approfondie de la demande…'
        : 'Analyse de la demande…',
      detail: checkpoint.depth === 'deep' ? 'Question complexe détectée' : undefined,
    }, onStep);

    if (checkpoint.depth === 'deep') {
      checkpoint.phase = 'plan';
      persistStore(checkpoint, store);
      return { status: 'yield', checkpoint };
    }

    prepareMemoryPhase(checkpoint, onStep);
    checkpoint.phase = 'llm';
    persistStore(checkpoint, store);
    return { status: 'yield', checkpoint };
  }

  if (checkpoint.phase === 'plan') {
    pushStep(checkpoint, {
      phase: 'plan',
      label: 'Élaboration d\'un plan…',
    }, onStep);

    checkpoint.planner = await runPlanner(
      trimmed,
      checkpoint.context,
      checkpoint.config,
      referer,
    );

    if (checkpoint.planner?.approach) {
      pushStep(checkpoint, {
        phase: 'plan',
        label: 'Plan établi',
        detail: checkpoint.planner.approach,
      }, onStep);
    }

    if (checkpoint.planner?.memoryQueries?.length) {
      checkpoint.memoryQueries = [
        ...new Set([...checkpoint.memoryQueries, ...checkpoint.planner.memoryQueries]),
      ].slice(0, 6);
    }

    prepareMemoryPhase(checkpoint, onStep);
    checkpoint.phase = 'llm';
    persistStore(checkpoint, store);
    return { status: 'yield', checkpoint };
  }

  if (checkpoint.phase === 'llm') {
    if (checkpoint.iteration >= checkpoint.maxIterations) {
      if (checkpoint.continueAfterTools && checkpoint.toolResultsForSynthesis.length > 0) {
        checkpoint.phase = 'synthesize';
        persistStore(checkpoint, store);
        return { status: 'yield', checkpoint };
      }
      persistStore(checkpoint, store);
      return {
        status: 'failed',
        result: failResult(
          checkpoint,
          store,
          'Merlin n\'a pas pu terminer sa réflexion. Réessayez avec une demande plus simple.',
        ),
      };
    }

    const i = checkpoint.iteration;
    pushStep(checkpoint, {
      phase: 'think',
      label: i === 0 ? 'Réflexion…' : `Réflexion (étape ${i + 1})…`,
    }, onStep);

    const result = await callMerlinLlm(checkpoint.messages, checkpoint.config, {
      temperature: checkpoint.depth === 'deep' ? 0.55 : 0.45,
      jsonMode: true,
      referer,
    });

    if (!result.ok || !result.text) {
      persistStore(checkpoint, store);
      return {
        status: 'failed',
        result: failResult(checkpoint, store, result.error ?? 'Service IA indisponible.'),
      };
    }

    const turn = parseAgentTurn(result.text);
    if (turn.toolCall) {
      checkpoint.pendingTool = {
        name: turn.toolCall.name,
        args: normalizeToolArgs(turn.toolCall.args ?? {}),
        llmText: result.text,
      };
      if (turn.reply) {
        checkpoint.pendingReply = turn.reply;
      }
      checkpoint.phase = 'tool';
      persistStore(checkpoint, store);
      return { status: 'yield', checkpoint };
    }

    checkpoint.pendingReply = turn.reply ?? result.text;
    checkpoint.phase = 'finalize';
    persistStore(checkpoint, store);
    return { status: 'yield', checkpoint };
  }

  if (checkpoint.phase === 'tool') {
    const pending = checkpoint.pendingTool;
    if (!pending) {
      persistStore(checkpoint, store);
      return {
        status: 'failed',
        result: failResult(checkpoint, store, 'État agent invalide (outil manquant).'),
      };
    }

    pushStep(checkpoint, {
      phase: 'tool',
      label: `Outil : ${pending.name}`,
      detail: Object.entries(pending.args)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
        .slice(0, 120) || undefined,
    }, onStep);

    let toolArgs = { ...pending.args };

    if (
      pending.name === 'update_space' &&
      checkpoint.context.activeSpace?.kind === 'comparison'
    ) {
      if (isComparisonRepairRequest(trimmed)) {
        toolArgs.append = 'false';
      }
      const patch = parseSpaceDataJson(toolArgs.data_json);
      const existingRows = checkpoint.context.activeSpace.data.rows?.length ?? 0;
      if (
        patch?.columns?.length &&
        (patch.rows?.length ?? 0) >= existingRows &&
        existingRows > 0
      ) {
        toolArgs.append = 'false';
      }
    }

    if (pending.name === 'create_reminder') {
      const text = toolArgs.text ?? '';
      const contextTags = toolArgs.contextTags ?? toolArgs.tags;
      if (needsReminderExtraction(text, contextTags)) {
        const extracted = await extractReminderFields(trimmed, checkpoint.config, referer);
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

    const toolResult = await store.executeToolAsync(pending.name, toolArgs, checkpoint.config);
    checkpoint.pendingTool = undefined;

    if (toolResult.webSources?.length) {
      checkpoint.webSources = mergeWebSources(checkpoint.webSources, toolResult.webSources);
    }
    if (toolResult.mutation) checkpoint.lastSideEffect = toolResult.mutation;

    const template = templateReplyForTool(pending.name, toolResult);
    if (template) {
      pushStep(checkpoint, { phase: 'respond', label: 'Action effectuée' }, onStep);
      persistStore(checkpoint, store);
      return {
        status: 'done',
        result: successResult(
          checkpoint,
          store,
          template,
          toolResult.mutation ?? checkpoint.lastSideEffect,
        ),
      };
    }

    if (isImmediateReplyTool(pending.name) || toolResult.mutation) {
      pushStep(checkpoint, { phase: 'respond', label: 'Action effectuée' }, onStep);
      persistStore(checkpoint, store);
      return {
        status: 'done',
        result: successResult(
          checkpoint,
          store,
          toolResult.content,
          toolResult.mutation ?? checkpoint.lastSideEffect,
        ),
      };
    }

    if (
      CONTINUE_TOOLS.has(pending.name) ||
      toolResult.webSources?.length ||
      store.isCustomTool(pending.name)
    ) {
      checkpoint.continueAfterTools = true;
      checkpoint.toolResultsForSynthesis.push(`[${pending.name}]\n${toolResult.content}`);
    }

    checkpoint.messages.push({ role: 'assistant', content: pending.llmText });
    checkpoint.messages.push({
      role: 'user',
      content: `Résultat de l'outil ${pending.name} :\n${toolResult.content}\n\nContinue : utilise un autre outil si nécessaire, sinon réponds. ${STRUCTURED_REPLY_REMINDER}`,
    });

    checkpoint.iteration += 1;
    checkpoint.phase = 'llm';
    persistStore(checkpoint, store);
    return { status: 'yield', checkpoint };
  }

  if (checkpoint.phase === 'synthesize') {
    pushStep(checkpoint, {
      phase: 'synthesize',
      label: 'Synthèse de la réponse…',
    }, onStep);

    checkpoint.synthesizedReply = await synthesizeReply(
      trimmed,
      checkpoint.toolResultsForSynthesis.join('\n\n'),
      checkpoint.config,
      referer,
    );
    checkpoint.phase = 'finalize';
    persistStore(checkpoint, store);
    return { status: 'yield', checkpoint };
  }

  if (checkpoint.phase === 'finalize') {
    const rawReply = checkpoint.synthesizedReply ?? checkpoint.pendingReply;
    if (!rawReply) {
      persistStore(checkpoint, store);
      return {
        status: 'failed',
        result: failResult(checkpoint, store, 'Réponse agent manquante.'),
      };
    }

    const userReply = formatAgentReplyForUser(rawReply);

    const autoSaved = await ensureSpacePersisted(
      store,
      trimmed,
      rawReply,
      checkpoint.config,
      referer,
      checkpoint.context.activeSpace,
    );
    if (autoSaved) {
      pushStep(checkpoint, {
        phase: 'tool',
        label: 'Espace sauvegardé',
        detail: 'Extraction automatique depuis la réponse',
      }, onStep);
    }

    pushStep(checkpoint, { phase: 'respond', label: 'Réponse prête' }, onStep);
    persistStore(checkpoint, store);
    return {
      status: 'done',
      result: successResult(
        checkpoint,
        store,
        userReply,
        pickSideEffect(store) ?? checkpoint.lastSideEffect,
      ),
    };
  }

  persistStore(checkpoint, store);
  return {
    status: 'failed',
    result: failResult(checkpoint, store, 'Phase agent inconnue.'),
  };
}

export async function runMerlinAgentSegmented(
  body: AgentRequestBody,
  options?: { onStep?: StepCallback; referer?: string },
): Promise<AgentRunResult> {
  let checkpoint = createBootstrapCheckpoint(body);

  while (true) {
    const outcome = await advanceAgentRun(checkpoint, options);
    if (outcome.status === 'done') return outcome.result;
    if (outcome.status === 'failed') return outcome.result;
    checkpoint = outcome.checkpoint;
  }
}
