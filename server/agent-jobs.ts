import {
  BACKGROUND_JOB_TIMEOUT_MS,
  STALE_RUNNING_MS,
} from '../lib/merlin-agent/agent-duration.js';
import type { AgentJobRecord, AgentRunResult, AgentStep } from '../lib/merlin-agent/types.js';
import { agentJobKey, getRedis } from './redis.js';

export { BACKGROUND_JOB_TIMEOUT_MS, STALE_RUNNING_MS };

const JOB_TTL_SECONDS = 60 * 60;
const memoryJobs = new Map<string, AgentJobRecord>();

export function createJobId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isRedisConfigured(): boolean {
  try {
    getRedis();
    return true;
  } catch {
    return false;
  }
}

export async function saveAgentJob(jobId: string, record: AgentJobRecord): Promise<void> {
  if (!isRedisConfigured()) {
    memoryJobs.set(jobId, record);
    return;
  }
  const redis = getRedis();
  await redis.set(agentJobKey(jobId), record, { ex: JOB_TTL_SECONDS });
}

export async function getAgentJob(jobId: string): Promise<AgentJobRecord | null> {
  if (!isRedisConfigured()) {
    return memoryJobs.get(jobId) ?? null;
  }
  const redis = getRedis();
  return redis.get<AgentJobRecord>(agentJobKey(jobId));
}

export async function appendAgentJobStep(jobId: string, step: AgentStep): Promise<void> {
  const current = await getAgentJob(jobId);
  if (!current) return;
  const steps = [...current.steps, step];
  await saveAgentJob(jobId, {
    ...current,
    status: current.status === 'pending' ? 'running' : current.status,
    steps,
    updatedAt: Date.now(),
  });
}

export async function finishAgentJob(
  jobId: string,
  result: AgentRunResult,
): Promise<void> {
  const current = await getAgentJob(jobId);
  await saveAgentJob(jobId, {
    status: result.ok ? 'done' : 'error',
    steps: result.steps.length > 0 ? result.steps : (current?.steps ?? []),
    result,
    error: result.ok ? undefined : result.error,
    updatedAt: Date.now(),
  });
}

export async function failAgentJob(jobId: string, error: string): Promise<void> {
  const current = await getAgentJob(jobId);
  await saveAgentJob(jobId, {
    status: 'error',
    steps: current?.steps ?? [],
    error,
    updatedAt: Date.now(),
  });
}

export function isStaleRunningJob(record: AgentJobRecord, now = Date.now()): boolean {
  if (record.status !== 'pending' && record.status !== 'running') return false;
  return now - record.updatedAt > STALE_RUNNING_MS;
}

/** Marque un job bloqué en « running » comme erreur (timeout Vercel, process tué, etc.). */
export async function expireStaleRunningJob(jobId: string): Promise<AgentJobRecord | null> {
  const job = await getAgentJob(jobId);
  if (!job) return null;
  if (!isStaleRunningJob(job)) return job;
  await failAgentJob(
    jobId,
    'La réflexion de Merlin a expiré côté serveur. Rouvrez l’app ou réessayez.',
  );
  return getAgentJob(jobId);
}
