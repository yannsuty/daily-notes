import { updateMerlinMessageContent } from './db';
import { applyAgentMutations } from './merlin-agent-context';
import { setActiveSpaceId } from './merlin-space-session';
import { getAgentJobStatus, watchAgentJob } from './merlin-agent-client';
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

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function isJobExpiredError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('introuvable') || message.includes('expiré');
}

async function failPendingJob(job: PendingAgentJob, message: string): Promise<void> {
  removePendingAgentJob(job.jobId);
  await stopNativeAgentJobWatch();
  await updateMerlinMessageContent(job.placeholderId, message);
}

export async function applyAgentJobResult(
  job: PendingAgentJob,
  result: AgentRunResult,
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

async function tryApplyFinishedJobStatus(
  job: PendingAgentJob,
  status: Awaited<ReturnType<typeof getAgentJobStatus>>,
): Promise<AgentReply | null> {
  if (status.status === 'done' && status.result) {
    return applyAgentJobResult(job, status.result);
  }

  if (status.status === 'error') {
    return applyAgentJobResult(job, {
      ok: false,
      error: status.error ?? 'Merlin n\'a pas pu terminer sa réflexion.',
      steps: status.steps ?? [],
      mutations: {},
      depth: 'standard',
    });
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
    for (const job of listPendingAgentJobs()) {
      stopPollingAgentJob(job.jobId);
      const controller = getActivePollController(job.jobId);

      try {
        try {
          const status = await getAgentJobStatus(job.jobId);
          const applied = await tryApplyFinishedJobStatus(job, status);
          if (applied) {
            completed += 1;
            continue;
          }
        } catch (statusErr) {
          if (isJobExpiredError(statusErr)) {
            const message =
              statusErr instanceof Error ? statusErr.message : 'Job expiré';
            await failPendingJob(job, message);
            completed += 1;
            continue;
          }
          // Erreur réseau transitoire — on tente le flux SSE ci-dessous.
        }

        const result = await watchAgentJob(job.jobId, {
          onStep: callbacks?.onStep,
          signal: controller.signal,
        });
        await applyAgentJobResult(job, result);
        completed += 1;
      } catch (err) {
        if (isAbortError(err)) {
          continue;
        }

        if (isJobExpiredError(err)) {
          const message = err instanceof Error ? err.message : 'Job expiré';
          await failPendingJob(job, message);
          completed += 1;
          continue;
        }

        // Réseau instable ou SSE coupé — conserver le job et relancer la surveillance native.
        await startNativeAgentJobWatch(job.jobId);
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
