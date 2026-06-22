import { updateMerlinMessageContent } from './db';
import { applyAgentMutations } from './merlin-agent-context';
import { watchAgentJob } from './merlin-agent-client';
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
import {
  startNativeAgentJobWatch,
  stopNativeAgentJobWatch,
} from './merlin-agent-native-watch';
import { recordShortcutUsage } from './merlin-shortcuts';
import type { AgentRunResult } from '../lib/merlin-agent';

let resumeInFlight = false;

export async function applyAgentJobResult(
  job: PendingAgentJob,
  result: AgentRunResult,
): Promise<AgentReply> {
  removePendingAgentJob(job.jobId);
  await stopNativeAgentJobWatch();

  const replyText = result.reply?.trim();
  if (result.ok && replyText) {
    await applyAgentMutations(result.mutations);
    await updateMerlinMessageContent(job.placeholderId, replyText);
    const { noteAgentReplyForFacts } = await import('./merlin-agent');
    await noteAgentReplyForFacts(job.userText, replyText);
    void recordShortcutUsage(job.userText);
    const { syncNow } = await import('./sync');
    await syncNow();
    return {
      ok: true,
      content: replyText,
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
    await stopNativeAgentJobWatch();

    for (const job of listPendingAgentJobs()) {
      stopPollingAgentJob(job.jobId);
      const controller = getActivePollController(job.jobId);

      try {
        const result = await watchAgentJob(job.jobId, {
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

export async function watchPendingJobUntilDone(
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
    const result = await watchAgentJob(job.jobId, {
      onStep: callbacks?.onStep,
      signal: controller.signal,
    });
    return applyAgentJobResult(job, result);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      releaseActivePoll(job.jobId);
      await startNativeAgentJobWatch(job.jobId);
      return { backgroundPending: true };
    }
    removePendingAgentJob(job.jobId);
    await stopNativeAgentJobWatch();
    const message = err instanceof Error ? err.message : 'Erreur réseau';
    await updateMerlinMessageContent(job.placeholderId, message);
    return { ok: false, error: message, aiUnavailable: true };
  } finally {
    document.removeEventListener('visibilitychange', onVisibility);
    releaseActivePoll(job.jobId);
  }
}

/** @deprecated Utiliser watchPendingJobUntilDone. */
export const pollPendingJobUntilDone = watchPendingJobUntilDone;
