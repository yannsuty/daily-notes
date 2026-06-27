import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { AgentClientConfig, MerlinSpace } from '../../lib/merlin-agent/types.js';
import { autoEnrichComparisonSpaces } from './comparison-image-auto.js';
import { AgentStore } from './tools.js';

vi.mock('./image-tools.js', () => ({
  searchBraveImages: vi.fn(async (query: string) => [
    {
      title: query,
      imageUrl: `https://cdn.example.com/${encodeURIComponent(query)}.jpg`,
    },
  ]),
}));

function comparisonSpace(id: string, rows: string[][]): MerlinSpace {
  return {
    id,
    kind: 'comparison',
    title: 'Ventilateurs',
    recap: 'Test',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    data: {
      columns: ['Modèle', 'Prix'],
      rows,
    },
  };
}

describe('autoEnrichComparisonSpaces', () => {
  const config: AgentClientConfig = { braveSearchApiKey: 'test-key' };

  beforeEach(() => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('ajoute des images manquantes sans overwrite', async () => {
    const store = AgentStore.fromSnapshot({
      days: {},
      lists: [],
      reminders: [],
      customTools: [],
      spaces: [
        comparisonSpace('s1', [
          ['Alpha', '100 €'],
          ['Beta', '120 €'],
        ]),
      ],
      dirtySpaces: ['s1'],
      dirtyLists: [],
      dirtyReminders: [],
      dirtyCustomTools: [],
    });

    const result = await autoEnrichComparisonSpaces(store, config);
    expect(result.spacesTouched).toBe(1);
    expect(result.imagesFound).toBe(2);

    const space = store.getSpaceById('s1');
    expect(space?.data.rowImages?.alpha).toContain('https://cdn.example.com/');
    expect(space?.data.rowImages?.beta).toContain('https://cdn.example.com/');
  });

  it('ne remplace pas les images existantes sans overwrite', async () => {
    const store = AgentStore.fromSnapshot({
      days: {},
      lists: [],
      reminders: [],
      customTools: [],
      spaces: [
        {
          ...comparisonSpace('s1', [['Alpha', '100 €']]),
          data: {
            columns: ['Modèle', 'Prix'],
            rows: [['Alpha', '100 €']],
            rowImages: { alpha: 'https://cdn.example.com/existing.jpg' },
          },
        },
      ],
      dirtySpaces: ['s1'],
      dirtyLists: [],
      dirtyReminders: [],
      dirtyCustomTools: [],
    });

    const result = await autoEnrichComparisonSpaces(store, config);
    expect(result.spacesTouched).toBe(0);
    expect(store.getSpaceById('s1')?.data.rowImages?.alpha).toBe('https://cdn.example.com/existing.jpg');
  });

  it('remplace les images en mode overwrite', async () => {
    const store = AgentStore.fromSnapshot({
      days: {},
      lists: [],
      reminders: [],
      customTools: [],
      spaces: [
        {
          ...comparisonSpace('s1', [['Alpha', '100 €']]),
          data: {
            columns: ['Modèle', 'Prix'],
            rows: [['Alpha', '100 €']],
            rowImages: { alpha: 'https://cdn.example.com/old.jpg' },
          },
        },
      ],
      dirtySpaces: ['s1'],
      dirtyLists: [],
      dirtyReminders: [],
      dirtyCustomTools: [],
    });

    const result = await autoEnrichComparisonSpaces(store, config, { overwrite: true });
    expect(result.spacesTouched).toBe(1);
    expect(store.getSpaceById('s1')?.data.rowImages?.alpha).not.toBe('https://cdn.example.com/old.jpg');
  });
});
