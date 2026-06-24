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
  setPendingJobSteps,
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
import type { AgentRunResult, AgentStep } from '../lib/merlin-agent';

let resumeInFlight = false;
let resumeQueued = false;

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

function emitJobSteps(steps: AgentStep[], callbacks?: AgentJobCallbacks): void {
  if (steps.length === 0) return;
  if (callbacks?.onStepsBatch) {
    callbacks.onStepsBatch(steps);
    return;
  }
  for (const step of steps) {
    callbacks?.onStep?.(step);
  }
}

function watchJobInBackground(
  job: PendingAgentJob,
  callbacks?: AgentJobCallbacks,
  fromStep = 0,
): void {
  const controller = getActivePollController(job.jobId);
  void watchAgentJob(job.jobId, {
    onStep: (step) => {
      callbacks?.onStep?.(step);
    },
    signal: controller.signal,
    fromStep,
  })
    .then((result) => applyAgentJobResult(job, result, callbacks))
    .catch(async (err) => {
      if (isJobExpiredError(err)) {
        const message = err instanceof Error ? err.message : 'Job expiré';
        await failPendingJob(job, message, callbacks);
        return;
      }
      if (isAbortError(err)) {
        await startNativeAgentJobWatch(job.jobId);
        return;
      }
      await startNativeAgentJobWatch(job.jobId);
    })
    .finally(() => {
      releaseActivePoll(job.jobId);
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJobStatusWithRetry(
  jobId: string,
  attempts = 4,
): Promise<Awaited<ReturnType<typeof getAgentJobStatus>>> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await getAgentJobStatus(jobId);
    } catch (err) {
      lastErr = err;
      if (isJobExpiredError(err)) throw err;
      if (i < attempts - 1) {
        await sleep(400 * (i + 1));
      }
    }
  }
  throw lastErr;
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

/** Charge l'état courant d'un job en cours (étapes déjà effectuées). */
export async function loadPendingJobProgress(
  jobId: string,
  callbacks?: AgentJobCallbacks,
): Promise<AgentStep[]> {
  try {
    const status = await getAgentJobStatus(jobId);
    const steps = status.steps ?? [];
    setPendingJobSteps(jobId, steps);
    emitJobSteps(steps, callbacks);
    return steps;
  } catch {
    const cached = listPendingAgentJobs().find((j) => j.jobId === jobId)?.steps ?? [];
    emitJobSteps(cached, callbacks);
    return cached;
  }
}

export async function resumePendingAgentJobs(
  callbacks?: AgentJobCallbacks,
): Promise<number> {
  if (resumeInFlight) {
    resumeQueued = true;
    return 0;
  }
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
          const status = await fetchJobStatusWithRetry(job.jobId);
          const applied = await tryApplyFinishedJobStatus(job, status, callbacks);
          if (applied) {
            completed += 1;
            continue;
          }

          const steps = status.steps ?? [];
          setPendingJobSteps(job.jobId, steps);
          emitJobSteps(steps, callbacks);

          if (status.status === 'pending' || status.status === 'running') {
            await startNativeAgentJobWatch(job.jobId);
            watchJobInBackground(job, callbacks, steps.length);
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
    if (resumeQueued) {
      resumeQueued = false;
      void resumePendingAgentJobs(callbacks);
    }
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
