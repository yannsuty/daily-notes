import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentContext } from './types.js';
import { AgentStore, isMutationTool } from '../../server/merlin-agent/tools.js';

function emptyContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    days: {},
    facts: [],
    lists: [],
    reminders: [],
    customTools: [],
    spaces: [],
    conversationSummary: '',
    recentMessages: [],
    ...overrides,
  };
}

describe('AgentStore — espaces', () => {
  let store: AgentStore;

  beforeEach(() => {
    store = new AgentStore(emptyContext());
  });

  it('marque create_space et update_space comme mutations', () => {
    expect(isMutationTool('create_space')).toBe(true);
    expect(isMutationTool('update_space')).toBe(true);
    expect(isMutationTool('show_space')).toBe(false);
  });

  it('crée un espace comparison avec data_json', async () => {
    const result = await store.executeTool('create_space', {
      kind: 'comparison',
      title: 'Ordinateurs',
      recap: 'Mac vs PC',
      data_json: JSON.stringify({
        columns: ['Modèle', 'Prix'],
        rows: [['Mac', '2000']],
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.mutation).toBe('space_updated');
    expect(store.spaces).toHaveLength(1);
    expect(store.spaces[0].kind).toBe('comparison');
    expect(store.spaces[0].data.columns).toEqual(['Modèle', 'Prix']);
    expect(store.getMutations().spaces).toHaveLength(1);
  });

  it('crée une todo liée pour un projet DIY', async () => {
    const result = await store.executeTool('create_space', {
      kind: 'diy',
      title: 'Étagère',
      recap: 'Projet salon',
      create_todo_list: 'true',
    });

    expect(result.ok).toBe(true);
    expect(store.lists.some((l) => l.title.includes('Étagère'))).toBe(true);
    expect(store.spaces[0].data.listId).toBeDefined();
  });

  it('met à jour un espace par titre', async () => {
    await store.executeTool('create_space', {
      kind: 'recipe',
      title: 'Soupe',
      recap: 'Version initiale',
    });

    const spaceId = store.spaces[0].id;
    const result = await store.executeTool('update_space', {
      title: 'Soupe',
      recap: 'Version enrichie',
      data_json: JSON.stringify({ servings: 6 }),
    });

    expect(result.ok).toBe(true);
    expect(store.spaces[0].recap).toBe('Version enrichie');
    expect(store.spaces[0].data.servings).toBe(6);
    expect(store.getMutations().spaces?.[0].id).toBe(spaceId);
  });

  it('liste et affiche les espaces actifs', async () => {
    await store.executeTool('create_space', {
      kind: 'plan',
      title: 'API v2',
      recap: 'Plan de migration',
    });

    const list = await store.executeTool('list_spaces', {});
    expect(list.content).toContain('API v2');

    const show = await store.executeTool('show_space', { title: 'API v2' });
    expect(show.content).toContain('Plan de migration');
    expect(show.content).toContain('id:');
  });

  it('inspecte un dépôt GitHub via l’outil agent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          description: 'Repo test',
          default_branch: 'main',
          language: 'TS',
          topics: [],
        }),
      }),
    );

    const storeWithToken = new AgentStore(emptyContext(), {
      githubToken: 'ghp_test',
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          description: 'Repo test',
          default_branch: 'main',
          language: 'TS',
          topics: [],
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: false } as Response);

    const result = await storeWithToken.executeTool('inspect_github_repo', {
      owner: 'acme',
      repo: 'merlin',
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain('acme/merlin');

    vi.unstubAllGlobals();
  });

  it('rejette un kind invalide', async () => {
    const result = await store.executeTool('create_space', {
      kind: 'unknown',
      title: 'Test',
    });
    expect(result.ok).toBe(false);
    expect(result.content).toContain('invalide');
  });
});
