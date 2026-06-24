import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
  },
}));

import { Capacitor } from '@capacitor/core';
import {
  appendPendingJobStep,
  isStalePendingJob,
  PENDING_JOB_MAX_MS,
  removeStalePendingAgentJobs,
  savePendingAgentJob,
  listPendingAgentJobs,
  setPendingJobSteps,
  shouldStartBackgroundAgentJob,
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

  it('accumule les étapes d’un job pending', () => {
    savePendingAgentJob({
      jobId: 'job-1',
      userText: 'test',
      placeholderId: 'ph',
      startedAt: Date.now(),
    });
    appendPendingJobStep('job-1', { phase: 'think', label: 'Réflexion…' });
    appendPendingJobStep('job-1', { phase: 'tool', label: 'Outil : search', detail: 'wifi' });
    expect(listPendingAgentJobs()[0].steps).toHaveLength(2);
  });

  it('remplace les étapes lors d’une reprise serveur', () => {
    savePendingAgentJob({
      jobId: 'job-1',
      userText: 'test',
      placeholderId: 'ph',
      startedAt: Date.now(),
      steps: [{ phase: 'think', label: 'Ancien' }],
    });

    setPendingJobSteps('job-1', [
      { phase: 'think', label: 'Réflexion…' },
      { phase: 'tool', label: 'Recherche' },
    ]);

    expect(listPendingAgentJobs()[0].steps).toHaveLength(2);
    expect(listPendingAgentJobs()[0].steps?.[1].label).toBe('Recherche');
  });

  it('conserve les étapes existantes si on ne repasse pas steps à save', () => {
    savePendingAgentJob({
      jobId: 'job-1',
      userText: 'test',
      placeholderId: 'ph',
      startedAt: Date.now(),
      steps: [{ phase: 'think', label: 'Étape 1' }],
    });
    savePendingAgentJob({
      jobId: 'job-1',
      userText: 'test mis à jour',
      placeholderId: 'ph',
      startedAt: Date.now(),
    });

    expect(listPendingAgentJobs()[0].steps).toHaveLength(1);
    expect(listPendingAgentJobs()[0].userText).toBe('test mis à jour');
  });
});

describe('pending agent jobs — arrière-plan', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });

  it('démarre un job serveur si l’app est déjà masquée (pause immédiate)', () => {
    expect(shouldStartBackgroundAgentJob()).toBe(true);
  });

  it('reste en premier plan si la plateforme n’est pas native', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    expect(shouldStartBackgroundAgentJob()).toBe(false);
  });
});
