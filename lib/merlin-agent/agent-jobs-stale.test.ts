import { describe, expect, it } from 'vitest';
import {
  expireStaleRunningJob,
  isStaleRunningJob,
  STALE_RUNNING_MS,
} from '../../server/agent-jobs.js';
import type { AgentJobRecord } from './types.js';

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

  it('marque un job bloqué en erreur', async () => {
    const job = await expireStaleRunningJob('missing');
    expect(job).toBeNull();
  });
});
