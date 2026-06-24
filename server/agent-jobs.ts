import {
  BACKGROUND_JOB_TIMEOUT_MS,
  SEGMENT_LEASE_MS,
  STALE_RUNNING_MS,
  STALE_WITH_CHECKPOINT_MS,
} from '../lib/merlin-agent/agent-duration.js';
import type { AgentJobRecord, AgentRunResult, AgentStep } from '../lib/merlin-agent/types.js';
import { agentJobKey, agentJobLeaseKey, getRedis } from './redis.js';

export { BACKGROUND_JOB_TIMEOUT_MS, STALE_RUNNING_MS, STALE_WITH_CHECKPOINT_MS };

const JOB_TTL_SECONDS = 60 * 60;
const memoryJobs = new Map<string, AgentJobRecord>();
const memoryLeases = new Map<string, number>();

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

/** Rafraîchit l'activité du job (heartbeat pendant LLM / outils longs). */
export async function touchAgentJob(jobId: string): Promise<void> {
  const current = await getAgentJob(jobId);
  if (!current) return;
  if (current.status !== 'pending' && current.status !== 'running') return;
  await saveAgentJob(jobId, {
    ...current,
    updatedAt: Date.now(),
  });
}

export async function saveAgentJobCheckpoint(
  jobId: string,
  patch: Pick<AgentJobRecord, 'checkpoint' | 'segmentCount' | 'steps' | 'status'>,
): Promise<void> {
  const current = await getAgentJob(jobId);
  if (!current) return;
  await saveAgentJob(jobId, {
    ...current,
    ...patch,
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
  const limit = record.checkpoint ? STALE_WITH_CHECKPOINT_MS : STALE_RUNNING_MS;
  return now - record.updatedAt > limit;
}

export async function acquireSegmentLease(jobId: string): Promise<boolean> {
  const ttlMs = SEGMENT_LEASE_MS;
  if (!isRedisConfigured()) {
    const now = Date.now();
    const until = memoryLeases.get(jobId) ?? 0;
    if (until > now) return false;
    memoryLeases.set(jobId, now + ttlMs);
    return true;
  }

  const redis = getRedis();
  const result = await redis.set(agentJobLeaseKey(jobId), '1', { nx: true, px: ttlMs });
  return result === 'OK';
}

export async function releaseSegmentLease(jobId: string): Promise<void> {
  if (!isRedisConfigured()) {
    memoryLeases.delete(jobId);
    return;
  }
  const redis = getRedis();
  await redis.del(agentJobLeaseKey(jobId));
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
