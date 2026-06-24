import { updateMerlinMessageContent } from './db';
import { applyAgentMutations } from './merlin-agent-context';
import { setActiveSpaceId } from './merlin-space-session';
import { getAgentJobStatus, watchAgentJob } from './merlin-agent-client';
import type { AgentReply, AgentSideEffect } from './merlin-agent';
import {
  getActivePollController,
  isStalePendingJob,
  listPendingAgentJobs,
  releaseActivePoll,
  removePendingAgentJob,
  removeStalePendingAgentJobs,
  stopAllAgentJobPolls,
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

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function isJobExpiredError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('introuvable') || message.includes('expiré');
}

async function failPendingJob(
  job: PendingAgentJob,
  message: string,
  callbacks?: AgentJobCallbacks,
): Promise<void> {
  removePendingAgentJob(job.jobId);
  await stopNativeAgentJobWatch();
  await updateMerlinMessageContent(job.placeholderId, message);
  notifyJobFinished(callbacks);
}

function notifyJobFinished(callbacks?: AgentJobCallbacks): void {
  callbacks?.onJobFinished?.();
}

function watchJobInBackground(
  job: PendingAgentJob,
  callbacks?: AgentJobCallbacks,
): void {
  const controller = getActivePollController(job.jobId);
  void watchAgentJob(job.jobId, {
    onStep: callbacks?.onStep,
    signal: controller.signal,
  })
    .then((result) => applyAgentJobResult(job, result, callbacks))
    .catch(async (err) => {
      if (isAbortError(err) || isJobExpiredError(err)) return;
      await startNativeAgentJobWatch(job.jobId);
    })
    .finally(() => {
      releaseActivePoll(job.jobId);
    });
}

export async function abandonPendingAgentJobs(
  message = 'Réflexion interrompue dans l’app. Merlin peut encore répondre en notification.',
): Promise<void> {
  const jobs = listPendingAgentJobs();
  if (jobs.length === 0) return;

  stopAllAgentJobPolls();
  await stopNativeAgentJobWatch();

  for (const job of jobs) {
    removePendingAgentJob(job.jobId);
    await updateMerlinMessageContent(job.placeholderId, message);
  }
}

export async function applyAgentJobResult(
  job: PendingAgentJob,
  result: AgentRunResult,
  callbacks?: AgentJobCallbacks,
): Promise<AgentReply> {
  removePendingAgentJob(job.jobId);
  await stopNativeAgentJobWatch();

  const replyText = result.reply?.trim();
  if (result.ok && replyText) {
    await applyAgentMutations(result.mutations);
    if (result.mutations.spaces?.length) {
      const newest = [...result.mutations.spaces].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      )[0];
      if (newest) setActiveSpaceId(newest.id);
    }
    await updateMerlinMessageContent(job.placeholderId, replyText);
    const { noteAgentReplyForFacts } = await import('./merlin-agent');
    await noteAgentReplyForFacts(job.userText, replyText);
    void recordShortcutUsage(job.userText);
    const { syncNow } = await import('./sync');
    await syncNow();
    notifyJobFinished(callbacks);
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
  notifyJobFinished(callbacks);
  return {
    ok: false,
    error: err,
    aiUnavailable: true,
    steps: result.steps,
    depth: result.depth,
  };
}

async function tryApplyFinishedJobStatus(
  job: PendingAgentJob,
  status: Awaited<ReturnType<typeof getAgentJobStatus>>,
  callbacks?: AgentJobCallbacks,
): Promise<AgentReply | null> {
  if (status.status === 'done' && status.result) {
    return applyAgentJobResult(job, status.result, callbacks);
  }

  if (status.status === 'error') {
    return applyAgentJobResult(job, {
      ok: false,
      error: status.error ?? 'Merlin n\'a pas pu terminer sa réflexion.',
      steps: status.steps ?? [],
      mutations: {},
      depth: 'standard',
    }, callbacks);
  }

  return null;
}

export async function resumePendingAgentJobs(
  callbacks?: AgentJobCallbacks,
): Promise<number> {
  if (resumeInFlight) return 0;
  resumeInFlight = true;

  let completed = 0;

  try {
    for (const stale of removeStalePendingAgentJobs()) {
      await failPendingJob(stale, 'La réflexion de Merlin a expiré.', callbacks);
      completed += 1;
    }

    for (const job of listPendingAgentJobs()) {
      if (isStalePendingJob(job)) {
        await failPendingJob(job, 'La réflexion de Merlin a expiré.', callbacks);
        completed += 1;
        continue;
      }

      stopPollingAgentJob(job.jobId);

      try {
        try {
          const status = await getAgentJobStatus(job.jobId);
          const applied = await tryApplyFinishedJobStatus(job, status, callbacks);
          if (applied) {
            completed += 1;
            continue;
          }

          if (status.status === 'pending' || status.status === 'running') {
            await startNativeAgentJobWatch(job.jobId);
            watchJobInBackground(job, callbacks);
            continue;
          }
        } catch (statusErr) {
          if (isJobExpiredError(statusErr)) {
            const message =
              statusErr instanceof Error ? statusErr.message : 'Job expiré';
            await failPendingJob(job, message, callbacks);
            completed += 1;
            continue;
          }
        }

        watchJobInBackground(job, callbacks);
      } catch (err) {
        if (isJobExpiredError(err)) {
          const message = err instanceof Error ? err.message : 'Job expiré';
          await failPendingJob(job, message, callbacks);
          completed += 1;
          continue;
        }

        await startNativeAgentJobWatch(job.jobId);
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
    return applyAgentJobResult(job, result, callbacks);
  } catch (err) {
    if (isAbortError(err)) {
      releaseActivePoll(job.jobId);
      await startNativeAgentJobWatch(job.jobId);
      return { backgroundPending: true };
    }

    if (isJobExpiredError(err)) {
      const message = err instanceof Error ? err.message : 'Job expiré';
      await failPendingJob(job, message, callbacks);
      return { ok: false, error: message, aiUnavailable: true };
    }

    // Réseau instable ou SSE coupé — conserver le job pour reprise au retour.
    await startNativeAgentJobWatch(job.jobId);
    return { backgroundPending: true };
  } finally {
    document.removeEventListener('visibilitychange', onVisibility);
    releaseActivePoll(job.jobId);
  }
}

/** @deprecated Utiliser watchPendingJobUntilDone. */
export const pollPendingJobUntilDone = watchPendingJobUntilDone;
