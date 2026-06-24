import { describe, expect, it } from 'vitest';
import {
  acquireSegmentLease,
  expireStaleRunningJob,
  isStaleRunningJob,
  releaseSegmentLease,
  STALE_RUNNING_MS,
  STALE_WITH_CHECKPOINT_MS,
} from '../../server/agent-jobs.js';
import type { AgentJobRecord } from './types.js';

describe('agent jobs — segment lease', () => {
  it('empêche deux segments simultanés', async () => {
    const jobId = 'lease-test-1';
    expect(await acquireSegmentLease(jobId)).toBe(true);
    expect(await acquireSegmentLease(jobId)).toBe(false);
    await releaseSegmentLease(jobId);
    expect(await acquireSegmentLease(jobId)).toBe(true);
    await releaseSegmentLease(jobId);
  });
});

describe('agent jobs — expiration running', () => {
  it('détecte un job running sans activité récente', () => {
    const job: AgentJobRecord = {
      status: 'running',
      steps: [{ phase: 'think', label: 'Réflexion…' }],
      updatedAt: Date.now() - STALE_RUNNING_MS - 1000,
    };
    expect(isStaleRunningJob(job)).toBe(true);
  });

  it('laisse un job running actif', () => {
    const job: AgentJobRecord = {
      status: 'running',
      steps: [],
      updatedAt: Date.now() - 5000,
    };
    expect(isStaleRunningJob(job)).toBe(false);
  });

  it('tolère plus longtemps un job segmenté en attente', () => {
    const job: AgentJobRecord = {
      status: 'running',
      steps: [],
      updatedAt: Date.now() - STALE_WITH_CHECKPOINT_MS + 5000,
      checkpoint: {
        userMessage: 'test',
        context: {
          days: {},
          facts: [],
          lists: [],
          reminders: [],
          customTools: [],
          spaces: [],
          conversationSummary: '',
          recentMessages: [],
        },
        config: {},
        depth: 'standard',
        steps: [],
        storeSnapshot: {
          days: {},
          lists: [],
          reminders: [],
          customTools: [],
          spaces: [],
          dirtyLists: [],
          dirtyReminders: [],
          dirtyCustomTools: [],
          dirtySpaces: [],
        },
        memoryBlock: '',
        planner: null,
        memoryQueries: [],
        messages: [],
        iteration: 0,
        maxIterations: 3,
        toolResultsForSynthesis: [],
        continueAfterTools: false,
        webSources: [],
        phase: 'llm',
      },
    };
    expect(isStaleRunningJob(job)).toBe(false);
  });

  it('marque un job bloqué en erreur', async () => {
    const job = await expireStaleRunningJob('missing');
    expect(job).toBeNull();
  });
});
