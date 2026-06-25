import {
  chatCompletion,
  LLM_UNAVAILABLE_MSG,
  parseJsonFromAi,
} from './ai-provider';
import {
  appendMerlinMessage,
  getMerlinConversation,
  getMerlinFacts,
  saveMerlinFact,
  saveMerlinFacts,
  updateMerlinConversationSummary,
  updateMerlinMessageContent,
} from './db';
import { tryFastIntent } from './merlin-intents';
import { applyAgentMutations, buildAgentContext } from './merlin-agent-context';
import { logAgentDev, rememberAgentJobId } from './agent-dev-log';
import { setActiveSpaceId } from './merlin-space-session';
import { runServerAgent, startBackgroundAgentJob } from './merlin-agent-client';
import {
  MERLIN_THINKING_PLACEHOLDER,
  createAgentJobId,
  listPendingAgentJobs,
  markPendingJobPostComplete,
  removePendingAgentJob,
  savePendingAgentJob,
  shouldUseBackgroundAgent,
} from './merlin-agent-jobs';
import {
  startNativeAgentJobWatch,
  stopNativeAgentJobWatch,
} from './merlin-agent-native-watch';
import { pollPendingJobUntilDone } from './merlin-agent-resume';
import { recordShortcutUsage } from './merlin-shortcuts';
import { type AgentStep } from '../lib/merlin-agent';
import type { MerlinFact, MerlinMessage } from './types';

const MAX_CONTEXT_MESSAGES = 24;
const COMPRESS_THRESHOLD = 40;
const MESSAGES_TO_COMPRESS = 16;
const FACT_EXTRACTION_INTERVAL = 4;

let messagesSinceFactExtraction = 0;

export function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getRecentMessages(messages: MerlinMessage[]): MerlinMessage[] {
  return messages.slice(-MAX_CONTEXT_MESSAGES);
}

export async function maybeCompressConversation(): Promise<void> {
  const conv = await getMerlinConversation();
  if (conv.messages.length < COMPRESS_THRESHOLD) return;

  const toCompress = conv.messages.slice(0, MESSAGES_TO_COMPRESS);
  const remaining = conv.messages.slice(MESSAGES_TO_COMPRESS);

  const transcript = toCompress
    .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Merlin'} : ${m.content}`)
    .join('\n');

  const result = await chatCompletion(
    [
      {
        role: 'system',
        content: `Résume cette conversation en français en 5-8 phrases.
Conserve les faits importants, décisions et préférences mentionnées.
Réponds uniquement avec le résumé, sans commentaire.`,
      },
      { role: 'user', content: transcript },
    ],
    { temperature: 0.3 },
  );

  if (!result.ok || !result.text) return;

  const newSummary = conv.summary
    ? `${conv.summary}\n\n${result.text.trim()}`
    : result.text.trim();

  await updateMerlinConversationSummary(newSummary, remaining);
}

function tryExplicitFactWithoutLlm(factText: string): { key: string; value: string } | null {
  const m = factText.match(/^(.+?)\s+(?:s'appelle|s appelle|est|c'est|c est)\s+(.+)$/i);
  if (m) {
    const key = m[1].trim().toLowerCase().replace(/\s+/g, '_').slice(0, 32);
    return { key, value: m[2].trim() };
  }
  if (factText.length < 80) {
    return { key: 'note', value: factText };
  }
  return null;
}

export async function extractFactsFromExchange(
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  const existing = await getMerlinFacts();
  const existingBlock =
    existing.length > 0
      ? existing.map((f) => `- ${f.key}: ${f.value}`).join('\n')
      : '(aucun)';

  const result = await chatCompletion(
    [
      {
        role: 'system',
        content: `Tu extrais des faits stables sur l'utilisateur à partir d'un échange.
Ne retiens que des informations personnelles utiles à long terme (prénom, projets, préférences, relations).
Ignore les questions ponctuelles et le contenu du journal.
Ne duplique pas les faits déjà connus sauf pour les mettre à jour.

Faits déjà connus :
${existingBlock}

Réponds UNIQUEMENT en JSON :
{"facts":[{"key":"snake_case","value":"texte court"}]}
Si rien de nouveau : {"facts":[]}`,
      },
      {
        role: 'user',
        content: `Utilisateur : ${userMessage}\nMerlin : ${assistantReply}`,
      },
    ],
    { temperature: 0.2, jsonMode: true },
  );

  if (!result.ok || !result.text) return;

  const parsed = parseJsonFromAi<{ facts?: { key?: string; value?: string }[] }>(
    result.text,
  );
  if (!parsed?.facts?.length) return;

  const existingByKey = new Map(existing.map((f) => [f.key, f]));
  const now = Date.now();
  const toSave: MerlinFact[] = [];

  for (const item of parsed.facts) {
    const key = item.key?.trim();
    const value = item.value?.trim();
    if (!key || !value) continue;

    const prev = existingByKey.get(key);
    if (prev && prev.value === value) continue;

    toSave.push({
      id: prev?.id ?? createMessageId(),
      key,
      value,
      source: 'inferred',
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    });
  }

  if (toSave.length > 0) {
    await saveMerlinFacts(toSave);
  }
}

export async function rememberExplicitFact(key: string, value: string): Promise<void> {
  const now = Date.now();
  const facts = await getMerlinFacts();
  const existing = facts.find((f) => f.key === key);
  await saveMerlinFact({
    id: existing?.id ?? createMessageId(),
    key,
    value,
    source: 'explicit',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export type AgentSideEffect = 'list_updated' | 'reminder_created' | 'reminder_completed' | 'space_updated';

export interface AgentReply {
  ok: boolean;
  content?: string;
  error?: string;
  sideEffects?: AgentSideEffect;
  fastPath?: boolean;
  aiUnavailable?: boolean;
  steps?: AgentStep[];
  depth?: 'standard' | 'deep';
  /** Réflexion continue côté serveur pendant que l'app est en arrière-plan. */
  backgroundPending?: boolean;
}

export interface HandleUserMessageOptions {
  onAgentStep?: (step: AgentStep) => void;
  /** Id aligné sur la bulle optimiste du chat (évite le flash à renderMessages). */
  userMessageId?: string;
}

async function runBackgroundAgentJobFlow(
  trimmed: string,
  options?: HandleUserMessageOptions,
): Promise<AgentReply | { backgroundPending: true }> {
  const placeholderId = createMessageId();
  await appendMerlinMessage({
    id: placeholderId,
    role: 'assistant',
    content: MERLIN_THINKING_PLACEHOLDER,
    createdAt: Date.now(),
  });

  const context = await buildAgentContext();
  const jobId = createAgentJobId();
  const pendingJob = {
    jobId,
    userText: trimmed,
    placeholderId,
    startedAt: Date.now(),
    postPending: true,
    serverRegistered: false,
  };

  logAgentDev('agent', 'background_flow_start', {
    messagePreview: trimmed.slice(0, 120),
    activeSpaceId: context.activeSpaceId,
    jobId,
  }, jobId);

  savePendingAgentJob(pendingJob);
  rememberAgentJobId(jobId);
  logAgentDev('agent', 'pending_saved_early', { jobId }, jobId);

  if (shouldUseBackgroundAgent()) {
    void startNativeAgentJobWatch(jobId);
  }

  try {
    const started = await startBackgroundAgentJob(trimmed, context, jobId);
    markPendingJobPostComplete(jobId, true);
    if (started.jobId !== jobId) {
      removePendingAgentJob(jobId);
      savePendingAgentJob({
        ...pendingJob,
        jobId: started.jobId,
        postPending: false,
        serverRegistered: true,
      });
      rememberAgentJobId(started.jobId);
      if (shouldUseBackgroundAgent()) {
        void startNativeAgentJobWatch(started.jobId);
      }
    }
  } catch (err) {
    markPendingJobPostComplete(jobId, false);
    const message = err instanceof Error ? err.message : 'Impossible de joindre le serveur.';
    logAgentDev('agent', 'background_start_failed', { message }, jobId);
    removePendingAgentJob(jobId);
    await stopNativeAgentJobWatch();
    await updateMerlinMessageContent(placeholderId, message);
    return { ok: false, error: message, aiUnavailable: true };
  }

  const polled = await pollPendingJobUntilDone(
    listPendingAgentJobs().find((j) => j.placeholderId === placeholderId) ?? pendingJob,
    { onStep: options?.onAgentStep },
  );

  if ('backgroundPending' in polled && polled.backgroundPending) {
    return { ok: true, content: MERLIN_THINKING_PLACEHOLDER, backgroundPending: true };
  }

  return polled as AgentReply;
}

async function appendExchange(userText: string, reply: string): Promise<void> {
  const assistantMsg: MerlinMessage = {
    id: createMessageId(),
    role: 'assistant',
    content: reply,
    createdAt: Date.now(),
  };
  await appendMerlinMessage(assistantMsg);

  await noteAgentReplyForFacts(userText, reply);
  void maybeCompressConversation();
}

export async function noteAgentReplyForFacts(userText: string, reply: string): Promise<void> {
  messagesSinceFactExtraction += 1;
  if (messagesSinceFactExtraction >= FACT_EXTRACTION_INTERVAL) {
    messagesSinceFactExtraction = 0;
    void extractFactsFromExchange(userText, reply);
  }
}

export async function handleUserMessage(
  userText: string,
  options?: HandleUserMessageOptions,
): Promise<AgentReply> {
  const trimmed = userText.trim();
  if (!trimmed) {
    return { ok: false, error: 'Message vide.' };
  }

  const userMsg: MerlinMessage = {
    id: options?.userMessageId ?? createMessageId(),
    role: 'user',
    content: trimmed,
    createdAt: Date.now(),
  };
  await appendMerlinMessage(userMsg);

  const explicitMatch = trimmed.match(
    /^(?:merlin[, ]+)?(?:retiens que|souviens[- ]toi que|rappelle[- ]toi que)\s+(.+)/i,
  );
  if (explicitMatch) {
    const factText = explicitMatch[1].trim();

    let reply = "C'est noté, je m'en souviendrai.";

    const localFact = tryExplicitFactWithoutLlm(factText);
    if (localFact) {
      await rememberExplicitFact(localFact.key, localFact.value);
      reply = `C'est noté — je retiendrai que ${localFact.value}.`;
    } else {
      const factResult = await chatCompletion(
        [
          {
            role: 'system',
            content: `Extrais un fait à mémoriser. Réponds en JSON : {"key":"snake_case","value":"texte court"}`,
          },
          { role: 'user', content: factText },
        ],
        { temperature: 0.2, jsonMode: true },
      );

      if (factResult.ok && factResult.text) {
        const parsed = parseJsonFromAi<{ key?: string; value?: string }>(factResult.text);
        if (parsed?.key && parsed?.value) {
          await rememberExplicitFact(parsed.key, parsed.value);
          reply = `C'est noté — je retiendrai que ${parsed.value}.`;
        }
      } else if (!factResult.ok) {
        await rememberExplicitFact('note', factText);
        reply = "C'est noté, je m'en souviendrai.";
      }
    }

    await appendExchange(trimmed, reply);
    return { ok: true, content: reply };
  }

  const fast = await tryFastIntent(trimmed);
  if (fast.handled) {
    const reply = fast.reply?.trim() || 'C\'est fait.';
    await appendExchange(trimmed, reply);
    void recordShortcutUsage(trimmed);
    void import('./sync').then(({ syncNow }) => syncNow());
    return {
      ok: true,
      content: reply,
      sideEffects: fast.sideEffects,
      fastPath: true,
    };
  }

  if (shouldUseBackgroundAgent()) {
    return runBackgroundAgentJobFlow(trimmed, options) as Promise<AgentReply>;
  }

  const context = await buildAgentContext();
  const agentResult = await runServerAgent(trimmed, context, {
    onStep: options?.onAgentStep,
    stream: !!options?.onAgentStep,
  });

  if (!agentResult.ok || !agentResult.reply) {
    return {
      ok: false,
      error: agentResult.error ?? LLM_UNAVAILABLE_MSG,
      aiUnavailable: true,
      steps: agentResult.steps,
      depth: agentResult.depth,
    };
  }

  await applyAgentMutations(agentResult.mutations);
  if (agentResult.mutations.spaces?.length) {
    const newest = [...agentResult.mutations.spaces].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    )[0];
    if (newest) setActiveSpaceId(newest.id);
  }
  await appendExchange(trimmed, agentResult.reply);
  void recordShortcutUsage(trimmed);
  const { syncNow } = await import('./sync');
  await syncNow();

  return {
    ok: true,
    content: agentResult.reply,
    sideEffects: agentResult.sideEffects,
    steps: agentResult.steps,
    depth: agentResult.depth,
  };
}

export async function getWelcomeMessage(): Promise<string> {
  const facts = await getMerlinFacts();
  const name = facts.find((f) => f.key === 'prenom' || f.key === 'user_name' || f.key === 'name');
  if (name) {
    return `Bonjour ${name.value}. Je suis Merlin, votre assistant. Comment puis-je vous aider ?`;
  }
  return 'Bonjour. Je suis Merlin, votre assistant personnel. Comment puis-je vous aider ?';
}
