import { describe, expect, it } from 'vitest';
import type { AgentContext, MerlinSpace } from './types.js';
import { gatherMemory, searchSpaces } from './memory.js';

const space = (overrides: Partial<MerlinSpace> = {}): MerlinSpace => ({
  id: 's1',
  kind: 'recipe',
  title: 'Crêpes maison',
  recap: 'Recette simple pour le brunch',
  data: {},
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('searchSpaces', () => {
  it('trouve un espace par titre ou récap', () => {
    const hits = searchSpaces([space()], 'crêpes');
    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBe('space');
    expect(hits[0].label).toContain('Crêpes maison');
  });

  it('ignore les espaces archivés', () => {
    const hits = searchSpaces([space({ status: 'archived' })], 'crêpes');
    expect(hits).toHaveLength(0);
  });

  it('retourne vide pour une requête vide', () => {
    expect(searchSpaces([space()], '   ')).toEqual([]);
  });
});

describe('gatherMemory — espaces', () => {
  const context = (): AgentContext => ({
    days: {},
    facts: [],
    lists: [],
    reminders: [],
    customTools: [],
    spaces: [space()],
    conversationSummary: '',
    recentMessages: [],
  });

  it('inclut les espaces dans le bloc mémoire', () => {
    const { hits, block } = gatherMemory(context(), ['brunch']);

    expect(hits.some((h) => h.source === 'space')).toBe(true);
    expect(block).toContain('[espace [recipe] Crêpes maison]');
  });
});
