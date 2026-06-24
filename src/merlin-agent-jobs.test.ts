import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isStalePendingJob,
  PENDING_JOB_MAX_MS,
  removeStalePendingAgentJobs,
  savePendingAgentJob,
  listPendingAgentJobs,
} from './merlin-agent-jobs';

describe('pending agent jobs — expiration', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('détecte un job trop ancien', () => {
    const job = {
      jobId: 'old',
      userText: 'test',
      placeholderId: 'ph',
      startedAt: Date.now() - PENDING_JOB_MAX_MS - 1000,
    };
    expect(isStalePendingJob(job)).toBe(true);
  });

  it('retire les jobs expirés du stockage', () => {
    savePendingAgentJob({
      jobId: 'fresh',
      userText: 'ok',
      placeholderId: 'ph1',
      startedAt: Date.now(),
    });
    savePendingAgentJob({
      jobId: 'stale',
      userText: 'old',
      placeholderId: 'ph2',
      startedAt: Date.now() - PENDING_JOB_MAX_MS - 5000,
    });

    const removed = removeStalePendingAgentJobs();
    expect(removed).toHaveLength(1);
    expect(removed[0].jobId).toBe('stale');
    expect(listPendingAgentJobs().map((j) => j.jobId)).toEqual(['fresh']);
  });
});
