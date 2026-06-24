import { Capacitor } from '@capacitor/core';
import type { AgentStep } from '../lib/merlin-agent';

const STORAGE_KEY = 'merlin-pending-agent-jobs';

export const MERLIN_THINKING_PLACEHOLDER = 'Merlin réfléchit…';

export interface PendingAgentJob {
  jobId: string;
  userText: string;
  placeholderId: string;
  startedAt: number;
}

export interface AgentJobCallbacks {
  onStep?: (step: AgentStep) => void;
  onJobFinished?: () => void;
}

/** Aligné sur le TTL Redis des jobs serveur (1 h). */
export const PENDING_JOB_MAX_MS = 60 * 60 * 1000;

function readJobs(): PendingAgentJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingAgentJob[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJobs(jobs: PendingAgentJob[]): void {
  if (jobs.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

export function savePendingAgentJob(job: PendingAgentJob): void {
  const jobs = readJobs().filter((j) => j.jobId !== job.jobId);
  jobs.push(job);
  writeJobs(jobs);
}

export function removePendingAgentJob(jobId: string): void {
  writeJobs(readJobs().filter((j) => j.jobId !== jobId));
}

export function listPendingAgentJobs(): PendingAgentJob[] {
  return readJobs();
}

export function isStalePendingJob(job: PendingAgentJob, now = Date.now()): boolean {
  return now - job.startedAt > PENDING_JOB_MAX_MS;
}

export function removeStalePendingAgentJobs(now = Date.now()): PendingAgentJob[] {
  const stale = readJobs().filter((job) => isStalePendingJob(job, now));
  if (stale.length === 0) return [];
  const staleIds = new Set(stale.map((job) => job.jobId));
  writeJobs(readJobs().filter((job) => !staleIds.has(job.jobId)));
  return stale;
}

export function shouldUseBackgroundAgent(): boolean {
  return Capacitor.isNativePlatform();
}

/** Job serveur : utile si l'app est déjà en arrière-plan ; sinon flux direct en premier plan. */
export function shouldStartBackgroundAgentJob(): boolean {
  return shouldUseBackgroundAgent() && document.visibilityState !== 'visible';
}

export function registerAgentJobResume(onResume: () => void): () => void {
  const handler = (): void => {
    if (document.visibilityState === 'visible') {
      onResume();
    }
  };
  document.addEventListener('visibilitychange', handler);
  window.addEventListener('focus', handler);
  window.addEventListener('pageshow', handler);
  return () => {
    document.removeEventListener('visibilitychange', handler);
    window.removeEventListener('focus', handler);
    window.removeEventListener('pageshow', handler);
  };
}

/** Reprend les jobs en attente tant que l'app est visible (complément au retour premier plan). */
export function startPendingJobResumePoll(onResume: () => void, intervalMs = 8000): () => void {
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible' && listPendingAgentJobs().length > 0) {
      onResume();
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

export function latestStep(steps: AgentStep[]): AgentStep | undefined {
  return steps.length > 0 ? steps[steps.length - 1] : undefined;
}

export function getActivePollController(jobId: string): AbortController {
  let controller = activePolls.get(jobId);
  if (!controller) {
    controller = new AbortController();
    activePolls.set(jobId, controller);
  }
  return controller;
}

export function releaseActivePoll(jobId: string): void {
  activePolls.delete(jobId);
}

const activePolls = new Map<string, AbortController>();

export function stopPollingAgentJob(jobId: string): void {
  activePolls.get(jobId)?.abort();
  activePolls.delete(jobId);
}

export function stopAllAgentJobPolls(): void {
  for (const controller of activePolls.values()) {
    controller.abort();
  }
  activePolls.clear();
}
