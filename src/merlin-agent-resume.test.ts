import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunResult } from '../lib/merlin-agent';

const mocks = vi.hoisted(() => ({
  watchAgentJob: vi.fn(),
  startNativeAgentJobWatch: vi.fn(),
  stopNativeAgentJobWatch: vi.fn(),
  updateMerlinMessageContent: vi.fn(),
  removePendingAgentJob: vi.fn(),
  getActivePollController: vi.fn(),
  releaseActivePoll: vi.fn(),
  stopPollingAgentJob: vi.fn(),
  applyAgentMutations: vi.fn(),
  syncNow: vi.fn(),
  recordShortcutUsage: vi.fn(),
  noteAgentReplyForFacts: vi.fn(),
}));

vi.mock('./merlin-agent-client', () => ({
  watchAgentJob: mocks.watchAgentJob,
  getAgentJobStatus: vi.fn(),
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
  };
});

import { watchPendingJobUntilDone } from './merlin-agent-resume';

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

describe('watchPendingJobUntilDone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
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
});
