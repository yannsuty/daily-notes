import { updateMerlinMessageContent } from './db';
import { applyAgentMutations } from './merlin-agent-context';
import { pollAgentJob } from './merlin-agent-client';
import type { AgentReply, AgentSideEffect } from './merlin-agent';
import {
  getActivePollController,
  listPendingAgentJobs,
  releaseActivePoll,
  removePendingAgentJob,
  stopPollingAgentJob,
  type AgentJobCallbacks,
  type PendingAgentJob,
} from './merlin-agent-jobs';
import { recordShortcutUsage } from './merlin-shortcuts';
import type { AgentRunResult } from '../lib/merlin-agent';

let resumeInFlight = false;

export async function applyAgentJobResult(
  job: PendingAgentJob,
  result: AgentRunResult,
): Promise<AgentReply> {
  removePendingAgentJob(job.jobId);

  if (result.ok && result.reply) {
    await applyAgentMutations(result.mutations);
    await updateMerlinMessageContent(job.placeholderId, result.reply);
    const { noteAgentReplyForFacts } = await import('./merlin-agent');
    await noteAgentReplyForFacts(job.userText, result.reply);
    void recordShortcutUsage(job.userText);
    void import('./sync').then(({ syncNow }) => syncNow());
    return {
      ok: true,
      content: result.reply,
      sideEffects: result.sideEffects as AgentSideEffect | undefined,
      steps: result.steps,
      depth: result.depth,
    };
  }

  const err = result.error ?? 'Merlin n\'a pas pu terminer sa réflexion.';
  await updateMerlinMessageContent(job.placeholderId, err);
  return {
    ok: false,
    error: err,
    aiUnavailable: true,
    steps: result.steps,
    depth: result.depth,
  };
}

export async function resumePendingAgentJobs(
  callbacks?: AgentJobCallbacks,
): Promise<number> {
  if (resumeInFlight) return 0;
  resumeInFlight = true;

  let completed = 0;

  try {
    for (const job of listPendingAgentJobs()) {
      stopPollingAgentJob(job.jobId);
      const controller = getActivePollController(job.jobId);

      try {
        const result = await pollAgentJob(job.jobId, {
          onStep: callbacks?.onStep,
          signal: controller.signal,
        });
        await applyAgentJobResult(job, result);
        completed += 1;
      } catch {
        // Job toujours en cours côté serveur — on réessaiera au prochain retour.
      } finally {
        releaseActivePoll(job.jobId);
      }
    }
  } finally {
    resumeInFlight = false;
  }

  return completed;
}

export async function pollPendingJobUntilDone(
  job: PendingAgentJob,
  callbacks?: AgentJobCallbacks,
): Promise<AgentReply | { backgroundPending: true }> {
  stopPollingAgentJob(job.jobId);
  const controller = getActivePollController(job.jobId);

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      controller.abort();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  try {
    const result = await pollAgentJob(job.jobId, {
      onStep: callbacks?.onStep,
      signal: controller.signal,
    });
    return applyAgentJobResult(job, result);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      releaseActivePoll(job.jobId);
      return { backgroundPending: true };
    }
    removePendingAgentJob(job.jobId);
    const message = err instanceof Error ? err.message : 'Erreur réseau';
    await updateMerlinMessageContent(job.placeholderId, message);
    return { ok: false, error: message, aiUnavailable: true };
  } finally {
    document.removeEventListener('visibilitychange', onVisibility);
    releaseActivePoll(job.jobId);
  }
}
