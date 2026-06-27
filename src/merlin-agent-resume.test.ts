import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunResult } from '../lib/merlin-agent';

const mocks = vi.hoisted(() => ({
  watchAgentJob: vi.fn(),
  getAgentJobStatus: vi.fn(),
  startNativeAgentJobWatch: vi.fn(),
  stopNativeAgentJobWatch: vi.fn(),
  updateMerlinMessageContent: vi.fn(),
  removePendingAgentJob: vi.fn(),
  getActivePollController: vi.fn(),
  releaseActivePoll: vi.fn(),
  stopPollingAgentJob: vi.fn(),
  stopAllAgentJobPolls: vi.fn(),
  isWatchingAgentJob: vi.fn(),
  applyAgentMutations: vi.fn(),
  syncNow: vi.fn(),
  recordShortcutUsage: vi.fn(),
  noteAgentReplyForFacts: vi.fn(),
  listPendingAgentJobs: vi.fn(),
  removeStalePendingAgentJobs: vi.fn(),
  setPendingJobSteps: vi.fn(),
  isStalePendingJob: vi.fn(),
}));

vi.mock('./merlin-agent-client', () => ({
  watchAgentJob: mocks.watchAgentJob,
  getAgentJobStatus: mocks.getAgentJobStatus,
}));

vi.mock('./merlin-agent-native-watch', () => ({
  startNativeAgentJobWatch: mocks.startNativeAgentJobWatch,
  stopNativeAgentJobWatch: mocks.stopNativeAgentJobWatch,
}));

vi.mock('./db', () => ({
  updateMerlinMessageContent: mocks.updateMerlinMessageContent,
}));

vi.mock('./merlin-agent-context', () => ({
  applyAgentMutations: mocks.applyAgentMutations,
}));

vi.mock('./merlin-shortcuts', () => ({
  recordShortcutUsage: mocks.recordShortcutUsage,
}));

vi.mock('./sync', () => ({
  syncNow: mocks.syncNow,
}));

vi.mock('./merlin-agent', () => ({
  noteAgentReplyForFacts: mocks.noteAgentReplyForFacts,
}));

vi.mock('./merlin-agent-jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./merlin-agent-jobs')>();
  return {
    ...actual,
    removePendingAgentJob: mocks.removePendingAgentJob,
    getActivePollController: mocks.getActivePollController,
    releaseActivePoll: mocks.releaseActivePoll,
    stopPollingAgentJob: mocks.stopPollingAgentJob,
    stopAllAgentJobPolls: mocks.stopAllAgentJobPolls,
    isWatchingAgentJob: mocks.isWatchingAgentJob,
    listPendingAgentJobs: mocks.listPendingAgentJobs,
    removeStalePendingAgentJobs: mocks.removeStalePendingAgentJobs,
    setPendingJobSteps: mocks.setPendingJobSteps,
    isStalePendingJob: mocks.isStalePendingJob,
  };
});

import {
  abandonPendingAgentJobs,
  loadPendingJobProgress,
  resumePendingAgentJobs,
  watchPendingJobUntilDone,
} from './merlin-agent-resume';

const job = {
  jobId: 'job-1',
  userText: 'Compare des ventilateurs',
  placeholderId: 'ph-1',
  startedAt: Date.now(),
};

const doneResult: AgentRunResult = {
  ok: true,
  reply: 'Voici la comparaison.',
  steps: [],
  mutations: {},
  depth: 'standard',
};

function stubDocument(visibilityState: DocumentVisibilityState = 'visible'): void {
  vi.stubGlobal('document', {
    visibilityState,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

describe('watchPendingJobUntilDone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDocument();
    mocks.getActivePollController.mockReturnValue(new AbortController());
    mocks.startNativeAgentJobWatch.mockResolvedValue(undefined);
    mocks.stopNativeAgentJobWatch.mockResolvedValue(undefined);
    mocks.updateMerlinMessageContent.mockResolvedValue(undefined);
    mocks.applyAgentMutations.mockResolvedValue(undefined);
    mocks.syncNow.mockResolvedValue(undefined);
    mocks.recordShortcutUsage.mockResolvedValue(undefined);
    mocks.noteAgentReplyForFacts.mockResolvedValue(undefined);
  });

  it('conserve le job et lance la surveillance native sur erreur réseau', async () => {
    mocks.watchAgentJob.mockRejectedValue(new Error('Failed to fetch'));

    const result = await watchPendingJobUntilDone(job);

    expect(result).toEqual({ backgroundPending: true });
    expect(mocks.removePendingAgentJob).not.toHaveBeenCalled();
    expect(mocks.startNativeAgentJobWatch).toHaveBeenCalledWith('job-1');
    expect(mocks.updateMerlinMessageContent).not.toHaveBeenCalled();
  });

  it('applique le résultat quand le job se termine en premier plan', async () => {
    mocks.watchAgentJob.mockResolvedValue(doneResult);

    const result = await watchPendingJobUntilDone(job);

    expect('backgroundPending' in result).toBe(false);
    if (!('backgroundPending' in result)) {
      expect(result.ok).toBe(true);
      expect(result.content).toBe('Voici la comparaison.');
    }
    expect(mocks.removePendingAgentJob).toHaveBeenCalledWith('job-1');
  });

  it('passe en arrière-plan sur AbortError (pause / app masquée)', async () => {
    mocks.watchAgentJob.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    const result = await watchPendingJobUntilDone(job);

    expect(result).toEqual({ backgroundPending: true });
    expect(mocks.removePendingAgentJob).not.toHaveBeenCalled();
    expect(mocks.startNativeAgentJobWatch).toHaveBeenCalledWith('job-1');
  });

  it('échoue proprement si le job a expiré côté serveur', async () => {
    mocks.watchAgentJob.mockRejectedValue(new Error('Job expiré ou introuvable'));

    const result = await watchPendingJobUntilDone({
      ...job,
      postPending: false,
      serverRegistered: true,
      startedAt: Date.now() - 130_000,
    });

    expect(result).toEqual({
      ok: false,
      error: 'Job expiré ou introuvable',
      aiUnavailable: true,
    });
    expect(mocks.removePendingAgentJob).toHaveBeenCalledWith('job-1');
    expect(mocks.updateMerlinMessageContent).toHaveBeenCalledWith(
      'ph-1',
      'Job expiré ou introuvable',
    );
  });
});

describe('loadPendingJobProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDocument();
    mocks.isWatchingAgentJob.mockReturnValue(false);
  });

  it('charge les étapes serveur et les émet en batch', async () => {
    const steps = [
      { phase: 'think' as const, label: 'Réflexion…' },
      { phase: 'tool' as const, label: 'Recherche web' },
    ];
    mocks.listPendingAgentJobs.mockReturnValue([job]);
    mocks.getAgentJobStatus.mockResolvedValue({ status: 'running', steps });
    const onStepsBatch = vi.fn();

    const loaded = await loadPendingJobProgress('job-1', { onStepsBatch });

    expect(loaded).toEqual(steps);
    expect(mocks.setPendingJobSteps).toHaveBeenCalledWith('job-1', steps);
    expect(onStepsBatch).toHaveBeenCalledWith(steps);
  });

  it('repli sur les étapes en cache si le statut serveur échoue', async () => {
    const cachedSteps = [{ phase: 'think' as const, label: 'En cache' }];
    mocks.getAgentJobStatus.mockRejectedValue(new Error('offline'));
    mocks.listPendingAgentJobs.mockReturnValue([
      { ...job, steps: cachedSteps },
    ]);
    const onStepsBatch = vi.fn();

    const loaded = await loadPendingJobProgress('job-1', { onStepsBatch });

    expect(loaded).toEqual(cachedSteps);
    expect(onStepsBatch).toHaveBeenCalledWith(cachedSteps);
  });

  it('applique un job déjà terminé côté serveur', async () => {
    mocks.listPendingAgentJobs.mockReturnValue([job]);
    mocks.getAgentJobStatus.mockResolvedValue({
      status: 'done',
      result: doneResult,
      steps: [],
    });

    await loadPendingJobProgress('job-1');

    expect(mocks.removePendingAgentJob).toHaveBeenCalledWith('job-1');
  });

  it('évite un poll JSON si un watch SSE est déjà actif', async () => {
    const cachedSteps = [{ phase: 'think' as const, label: 'En cours' }];
    mocks.listPendingAgentJobs.mockReturnValue([{ ...job, steps: cachedSteps }]);
    mocks.isWatchingAgentJob.mockReturnValue(true);
    const onStepsBatch = vi.fn();

    const loaded = await loadPendingJobProgress('job-1', { onStepsBatch });

    expect(loaded).toEqual(cachedSteps);
    expect(mocks.getAgentJobStatus).not.toHaveBeenCalled();
    expect(onStepsBatch).toHaveBeenCalledWith(cachedSteps);
  });
});

describe('resumePendingAgentJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDocument();
    mocks.startNativeAgentJobWatch.mockResolvedValue(undefined);
    mocks.stopNativeAgentJobWatch.mockResolvedValue(undefined);
    mocks.updateMerlinMessageContent.mockResolvedValue(undefined);
    mocks.applyAgentMutations.mockResolvedValue(undefined);
    mocks.syncNow.mockResolvedValue(undefined);
    mocks.recordShortcutUsage.mockResolvedValue(undefined);
    mocks.noteAgentReplyForFacts.mockResolvedValue(undefined);
    mocks.getActivePollController.mockReturnValue(new AbortController());
    mocks.removeStalePendingAgentJobs.mockReturnValue([]);
    mocks.isStalePendingJob.mockReturnValue(false);
    mocks.isWatchingAgentJob.mockReturnValue(false);
  });

  it('termine les jobs expirés au retour dans l’app', async () => {
    const staleJob = {
      jobId: 'stale-1',
      userText: 'old',
      placeholderId: 'ph-old',
      startedAt: Date.now() - 3_700_000,
    };
    mocks.removeStalePendingAgentJobs.mockReturnValue([staleJob]);
    mocks.listPendingAgentJobs.mockReturnValue([]);

    const completed = await resumePendingAgentJobs();

    expect(completed).toBe(1);
    expect(mocks.updateMerlinMessageContent).toHaveBeenCalledWith(
      'ph-old',
      'La réflexion de Merlin a expiré.',
    );
  });

  it('applique un job déjà terminé côté serveur', async () => {
    mocks.listPendingAgentJobs.mockReturnValue([job]);
    mocks.getAgentJobStatus.mockResolvedValue({
      status: 'done',
      result: doneResult,
      steps: [],
    });

    const completed = await resumePendingAgentJobs();

    expect(completed).toBe(1);
    expect(mocks.removePendingAgentJob).toHaveBeenCalledWith('job-1');
  });

  it('reprend un job en cours avec les étapes déjà effectuées', async () => {
    const steps = [{ phase: 'think' as const, label: 'Réflexion…' }];
    mocks.listPendingAgentJobs.mockReturnValue([job]);
    mocks.getAgentJobStatus.mockResolvedValue({
      status: 'running',
      steps,
    });
    mocks.watchAgentJob.mockResolvedValue(doneResult);
    const onStepsBatch = vi.fn();

    const completed = await resumePendingAgentJobs({ onStepsBatch });

    expect(completed).toBe(0);
    expect(mocks.setPendingJobSteps).toHaveBeenCalledWith('job-1', steps);
    expect(onStepsBatch).toHaveBeenCalledWith(steps);
    expect(mocks.startNativeAgentJobWatch).toHaveBeenCalledWith('job-1');
  });

  it('réessaie le statut serveur après une erreur réseau transitoire', async () => {
    mocks.listPendingAgentJobs.mockReturnValue([job]);
    mocks.getAgentJobStatus
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue({
        status: 'done',
        result: doneResult,
        steps: [],
      });

    const completed = await resumePendingAgentJobs();

    expect(completed).toBe(1);
    expect(mocks.getAgentJobStatus).toHaveBeenCalledTimes(2);
  });

  it('ne abandonne pas un job dont le POST est encore en cours (404 transitoire)', async () => {
    mocks.listPendingAgentJobs.mockReturnValue([
      { ...job, postPending: true, serverRegistered: false },
    ]);

    const completed = await resumePendingAgentJobs();

    expect(completed).toBe(0);
    expect(mocks.getAgentJobStatus).not.toHaveBeenCalled();
    expect(mocks.removePendingAgentJob).not.toHaveBeenCalled();
    expect(mocks.startNativeAgentJobWatch).toHaveBeenCalledWith('job-1');
  });

  it('ne relance pas un watch déjà actif', async () => {
    mocks.listPendingAgentJobs.mockReturnValue([job]);
    mocks.isWatchingAgentJob.mockReturnValue(true);

    const completed = await resumePendingAgentJobs();

    expect(completed).toBe(0);
    expect(mocks.stopPollingAgentJob).not.toHaveBeenCalled();
    expect(mocks.getAgentJobStatus).not.toHaveBeenCalled();
    expect(mocks.watchAgentJob).not.toHaveBeenCalled();
  });

  it('réessaie un 404 tant que le job vient d’être créé côté client', async () => {
    mocks.listPendingAgentJobs.mockReturnValue([
      {
        ...job,
        postPending: false,
        serverRegistered: false,
        startedAt: Date.now() - 2_000,
      },
    ]);
    mocks.getAgentJobStatus
      .mockRejectedValueOnce(new Error('Job introuvable ou expiré'))
      .mockResolvedValue({
        status: 'running',
        steps: [],
      });
    mocks.watchAgentJob.mockReturnValue(new Promise(() => {}));

    const completed = await resumePendingAgentJobs();

    expect(completed).toBe(0);
    expect(mocks.getAgentJobStatus).toHaveBeenCalledTimes(2);
    expect(mocks.removePendingAgentJob).not.toHaveBeenCalled();
  });
});

describe('abandonPendingAgentJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDocument();
    mocks.stopNativeAgentJobWatch.mockResolvedValue(undefined);
    mocks.updateMerlinMessageContent.mockResolvedValue(undefined);
  });

  it('nettoie tous les jobs en attente et met à jour les placeholders', async () => {
    mocks.listPendingAgentJobs.mockReturnValue([
      job,
      {
        jobId: 'job-2',
        userText: 'Recette',
        placeholderId: 'ph-2',
        startedAt: Date.now(),
      },
    ]);

    await abandonPendingAgentJobs('Réflexion interrompue.');

    expect(mocks.stopAllAgentJobPolls).toHaveBeenCalled();
    expect(mocks.removePendingAgentJob).toHaveBeenCalledTimes(2);
    expect(mocks.updateMerlinMessageContent).toHaveBeenCalledWith(
      'ph-1',
      'Réflexion interrompue.',
    );
    expect(mocks.updateMerlinMessageContent).toHaveBeenCalledWith(
      'ph-2',
      'Réflexion interrompue.',
    );
  });
});
