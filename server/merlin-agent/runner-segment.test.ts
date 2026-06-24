import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AgentContext } from '../../lib/merlin-agent/types.js';
import { advanceAgentRun, createBootstrapCheckpoint } from './runner-segment.js';
import { AgentStore } from './tools.js';

vi.mock('./llm.js', () => ({
  callMerlinLlm: vi.fn(),
}));

import { callMerlinLlm } from './llm.js';

const baseContext: AgentContext = {
  facts: [],
  lists: [],
  reminders: [],
  customTools: [],
  spaces: [],
  days: {},
  recentMessages: [],
  conversationSummary: '',
};

describe('runner-segment', () => {
  beforeEach(() => {
    vi.mocked(callMerlinLlm).mockReset();
  });

  it('bootstrap standard yield avant le premier LLM', async () => {
    const checkpoint = createBootstrapCheckpoint({
      message: 'quelle heure est-il',
      context: baseContext,
    });

    const outcome = await advanceAgentRun(checkpoint);

    expect(outcome.status).toBe('yield');
    if (outcome.status !== 'yield') return;
    expect(outcome.checkpoint.phase).toBe('llm');
    expect(outcome.checkpoint.steps.some((s) => s.phase === 'memory')).toBe(true);
  });

  it('bootstrap profond yield vers la phase plan', async () => {
    const checkpoint = createBootstrapCheckpoint({
      message: 'compare en détail plusieurs modèles de ventilateurs de plafond avec prix et bruit',
      context: baseContext,
    });

    const outcome = await advanceAgentRun(checkpoint);

    expect(outcome.status).toBe('yield');
    if (outcome.status !== 'yield') return;
    expect(outcome.checkpoint.phase).toBe('plan');
  });

  it('yield après LLM quand un outil web est demandé', async () => {
    vi.mocked(callMerlinLlm).mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        action: 'tool',
        name: 'web_search',
        args: { query: 'ventilateur plafond' },
      }),
    });

    let checkpoint = createBootstrapCheckpoint({
      message: 'ajoute d\'autres ventilateurs en comparaison',
      context: baseContext,
    });

    let outcome = await advanceAgentRun(checkpoint);
    while (outcome.status === 'yield' && outcome.checkpoint.phase !== 'llm') {
      checkpoint = outcome.checkpoint;
      outcome = await advanceAgentRun(checkpoint);
    }

    expect(outcome.status).toBe('yield');
    if (outcome.status !== 'yield') return;

    outcome = await advanceAgentRun(outcome.checkpoint);
    expect(outcome.status).toBe('yield');
    if (outcome.status !== 'yield') return;
    expect(outcome.checkpoint.phase).toBe('tool');
    expect(outcome.checkpoint.pendingTool?.name).toBe('web_search');
  });
});

describe('AgentStore snapshot', () => {
  it('roundtrip serialize / restore', () => {
    const store = new AgentStore(baseContext);
    const restored = AgentStore.fromSnapshot(store.toSnapshot());
    expect(restored.getMutations()).toEqual(store.getMutations());
  });
});
