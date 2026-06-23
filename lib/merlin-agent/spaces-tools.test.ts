import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentContext } from './types.js';
import { AgentStore, isImmediateReplyTool, isMutationTool, normalizeToolArgs, parseSpaceDataJson } from '../../server/merlin-agent/tools.js';

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

  it('marque create_space comme mutation sans réponse immédiate', () => {
    expect(isMutationTool('create_space')).toBe(true);
    expect(isMutationTool('update_space')).toBe(true);
    expect(isImmediateReplyTool('create_space')).toBe(false);
    expect(isImmediateReplyTool('update_space')).toBe(false);
    expect(isImmediateReplyTool('create_list')).toBe(true);
    expect(isMutationTool('show_space')).toBe(false);
  });

  it('parse data_json objet ou chaîne', () => {
    expect(parseSpaceDataJson({ columns: ['A'], rows: [['1']] })).toEqual({
      columns: ['A'],
      rows: [['1']],
    });
    expect(parseSpaceDataJson('{"columns":["B"]}')).toEqual({ columns: ['B'] });
    expect(parseSpaceDataJson('not-json')).toBeNull();
  });

  it('normalise les args outil avec objets imbriqués', () => {
    expect(
      normalizeToolArgs({
        kind: 'comparison',
        data_json: { columns: ['Prix'], rows: [['100 €']] },
      }),
    ).toEqual({
      kind: 'comparison',
      data_json: '{"columns":["Prix"],"rows":[["100 €"]]}',
    });
  });

  it('crée une comparaison avec data_json objet', async () => {
    const result = await store.executeTool('create_space', {
      kind: 'comparison',
      title: 'Ventilateurs plafond',
      recap: 'Comparer modèles silencieux',
      data_json: {
        columns: ['Modèle', 'Diamètre', 'Bruit'],
        rows: [
          ['Alpha', '132 cm', '30 dB'],
          ['Beta', '142 cm', '28 dB'],
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain('Alpha');
    expect(result.content).toContain('| Modèle |');
    expect(store.spaces[0].data.rows).toHaveLength(2);
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

  it('ajoute des lignes à une comparaison en mode append', async () => {
    await store.executeTool('create_space', {
      kind: 'comparison',
      title: 'Ventilateurs',
      recap: 'Initiale',
      data_json: {
        columns: ['Modèle', 'Prix'],
        rows: [['Alpha', '150 €']],
      },
    });

    const result = await store.executeTool('update_space', {
      title: 'Ventilateurs',
      append: 'true',
      data_json: {
        rows: [['Beta', '180 €']],
      },
    });

    expect(result.ok).toBe(true);
    expect(store.spaces[0].data.rows).toHaveLength(2);
    expect(store.spaces[0].data.rows?.[1][0]).toBe('Beta');
  });

  it('résout update_space via le contexte actif', async () => {
    const comparison = {
      id: 'cmp-1',
      kind: 'comparison' as const,
      title: 'Ventilateurs plafond',
      recap: 'Comparaison initiale',
      data: {
        columns: ['Modèle', 'Bruit'],
        rows: [['Alpha', '30 dB']],
      },
      status: 'active' as const,
      createdAt: 1,
      updatedAt: 1,
    };

    const contextualStore = new AgentStore(
      emptyContext({ spaces: [comparison], activeSpaceId: 'cmp-1', activeSpace: comparison }),
    );

    const result = await contextualStore.executeTool('update_space', {
      append: 'true',
      data_json: { rows: [['Beta', '28 dB']] },
    });

    expect(result.ok).toBe(true);
    expect(contextualStore.spaces[0].data.rows).toHaveLength(2);
  });

  it('show_space sans id affiche le contexte actif', async () => {
    const plan = {
      id: 'plan-1',
      kind: 'plan' as const,
      title: 'API v2',
      recap: 'Plan de migration',
      data: { goal: 'Migrer' },
      status: 'active' as const,
      createdAt: 1,
      updatedAt: 1,
    };

    const contextualStore = new AgentStore(
      emptyContext({ spaces: [plan], activeSpaceId: 'plan-1', activeSpace: plan }),
    );

    const show = await contextualStore.executeTool('show_space', {});
    expect(show.content).toContain('Plan de migration');
    expect(show.content).toContain('id: plan-1');
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
