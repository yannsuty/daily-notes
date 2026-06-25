import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentContext, MerlinSpace } from '../../lib/merlin-agent/types.js';
import { AgentStore } from './tools.js';

const extractMocks = vi.hoisted(() => ({
  extractSpaceUpdate: vi.fn(),
  extractSpaceData: vi.fn(),
}));

vi.mock('./space-extract.js', () => ({
  extractSpaceUpdate: extractMocks.extractSpaceUpdate,
  extractSpaceData: extractMocks.extractSpaceData,
}));

import { ensureSpacePersisted } from './space-ensure.js';

const config = { apiKey: 'test', model: 'test' };

const activeComparison: MerlinSpace = {
  id: 'space-1',
  kind: 'comparison',
  title: 'Ventilateurs plafond',
  recap: 'Comparaison initiale',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
  data: {
    columns: ['Modèle', 'Prix'],
    rows: [['Alpha', '150 €']],
  },
};

function makeStore(spaces: MerlinSpace[] = [activeComparison]): AgentStore {
  const context: AgentContext = {
    days: {},
    facts: [],
    lists: [],
    reminders: [],
    customTools: [],
    spaces,
    activeSpaceId: spaces[0]?.id ?? null,
    activeSpace: spaces[0] ?? null,
    conversationSummary: '',
    recentMessages: [],
  };
  return new AgentStore(context);
}

describe('ensureSpacePersisted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ne persiste rien si le store a déjà des espaces dirty', async () => {
    const store = makeStore();
    store.createSpace({
      kind: 'comparison',
      title: 'Dirty',
    });

    const ok = await ensureSpacePersisted(
      store,
      'Ajoute le modèle B',
      'Voici B.',
      config,
    );

    expect(ok).toBe(false);
    expect(extractMocks.extractSpaceUpdate).not.toHaveBeenCalled();
  });

  it('étend l’espace actif via extractSpaceUpdate', async () => {
    const store = makeStore();
    extractMocks.extractSpaceUpdate.mockResolvedValue({
      title: activeComparison.title,
      recap: 'Avec Beta',
      data: { rows: [['Beta', '180 €']] },
    });

    const ok = await ensureSpacePersisted(
      store,
      'Je veux bien que tu compares avec d’autres ventilateurs',
      'Voici Beta et Gamma.',
      config,
      undefined,
      activeComparison,
    );

    expect(ok).toBe(true);
    expect(store.getActiveSpace()?.data.rows).toHaveLength(2);
    expect(store.getActiveSpace()?.data.rows?.[1][0]).toBe('Beta');
  });

  it('repli sur extractSpaceData si extractSpaceUpdate échoue', async () => {
    const store = makeStore();
    extractMocks.extractSpaceUpdate.mockResolvedValue(null);
    extractMocks.extractSpaceData.mockResolvedValue({
      title: 'Ventilateurs plafond',
      recap: 'Gamma ajouté',
      data: { rows: [['Gamma', '200 €']] },
    });

    const ok = await ensureSpacePersisted(
      store,
      'Compare aussi le modèle Gamma',
      'Gamma est silencieux.',
      config,
      undefined,
      activeComparison,
    );

    expect(ok).toBe(true);
    expect(extractMocks.extractSpaceData).toHaveBeenCalled();
    expect(store.getActiveSpace()?.data.rows).toHaveLength(2);
  });

  it('retourne false si l’extension n’extrait aucune donnée', async () => {
    const store = makeStore();
    extractMocks.extractSpaceUpdate.mockResolvedValue(null);
    extractMocks.extractSpaceData.mockResolvedValue(null);

    const ok = await ensureSpacePersisted(
      store,
      'Compare avec d’autres ventilateurs',
      'Je n’ai pas trouvé de modèles.',
      config,
      undefined,
      activeComparison,
    );

    expect(ok).toBe(false);
  });

  it('retourne false si les données fusionnées sont identiques', async () => {
    const store = makeStore();
    extractMocks.extractSpaceUpdate.mockResolvedValue({
      title: activeComparison.title,
      recap: 'Inchangé',
      data: { rows: [['Alpha', '150 €']] },
    });

    const ok = await ensureSpacePersisted(
      store,
      'Ajoute Alpha',
      'Alpha est déjà là.',
      config,
      undefined,
      activeComparison,
    );

    expect(ok).toBe(false);
  });

  it('crée un nouvel espace quand le kind change', async () => {
    const store = makeStore();
    extractMocks.extractSpaceData.mockResolvedValue({
      title: 'Crêpes',
      recap: 'Pour 4',
      data: { ingredients: [{ text: 'farine' }] },
    });

    const ok = await ensureSpacePersisted(
      store,
      'Recette de crêpes pour 4',
      'Voici la recette.',
      config,
      undefined,
      activeComparison,
    );

    expect(ok).toBe(true);
    const spaces = store.getMutations().spaces ?? [];
    expect(spaces.some((s) => s.kind === 'recipe')).toBe(true);
  });

  it('crée un espace quand aucun actif et kind détecté', async () => {
    const store = makeStore([]);
    extractMocks.extractSpaceData.mockResolvedValue({
      title: 'Ventilateurs',
      recap: 'Comparaison',
      data: { columns: ['Modèle'], rows: [['A']] },
    });

    const ok = await ensureSpacePersisted(
      store,
      'Compare des ventilateurs de plafond',
      'Voici A et B.',
      config,
    );

    expect(ok).toBe(true);
    expect((store.getMutations().spaces ?? []).length).toBeGreaterThan(0);
  });

  it('réutilise un espace existant sans espace actif en session', async () => {
    const context: AgentContext = {
      days: {},
      facts: [],
      lists: [],
      reminders: [],
      customTools: [],
      spaces: [activeComparison],
      activeSpaceId: null,
      activeSpace: null,
      conversationSummary: '',
      recentMessages: [],
    };
    const store = new AgentStore(context);
    extractMocks.extractSpaceUpdate.mockResolvedValue({
      title: activeComparison.title,
      recap: 'Avec Beta',
      data: { rows: [['Beta', '190 €']] },
    });

    const ok = await ensureSpacePersisted(
      store,
      'Compare des ventilateurs de plafond silencieux',
      'Voici Beta.',
      config,
    );

    expect(ok).toBe(true);
    expect(extractMocks.extractSpaceData).not.toHaveBeenCalled();
    expect(store.spaces).toHaveLength(1);
    expect(store.spaces[0].data.rows).toHaveLength(2);
  });

  it('ne crée pas d’espace pour une question informative', async () => {
    const store = makeStore([]);

    const ok = await ensureSpacePersisted(
      store,
      'Quel ventilateur de plafond pour une chambre de 20 m² ?',
      'Voici quelques critères.',
      config,
    );

    expect(ok).toBe(false);
    expect(extractMocks.extractSpaceData).not.toHaveBeenCalled();
  });

  it('enrichit l’espace actif au lieu de créer un doublon', async () => {
    const store = makeStore();
    extractMocks.extractSpaceUpdate.mockResolvedValue({
      title: activeComparison.title,
      recap: 'Silencieux',
      data: { rows: [['Silencieux X', '220 €']] },
    });

    const ok = await ensureSpacePersisted(
      store,
      'Compare des ventilateurs silencieux',
      'Voici le tableau.',
      config,
      undefined,
      activeComparison,
    );

    expect(ok).toBe(true);
    expect(extractMocks.extractSpaceData).not.toHaveBeenCalled();
    expect(store.getActiveSpace()?.data.rows).toHaveLength(2);
  });

  it('crée un nouvel espace si l’utilisateur le demande explicitement', async () => {
    const store = makeStore();
    extractMocks.extractSpaceData.mockResolvedValue({
      title: 'Purificateurs',
      recap: 'Nouvelle comparaison',
      data: { columns: ['Modèle'], rows: [['P1']] },
    });

    const ok = await ensureSpacePersisted(
      store,
      'Crée une nouvelle comparaison de purificateurs',
      'Voici P1.',
      config,
      undefined,
      activeComparison,
    );

    expect(ok).toBe(true);
    expect(extractMocks.extractSpaceData).toHaveBeenCalledWith(
      'comparison',
      expect.any(String),
      expect.any(String),
      config,
      undefined,
    );
  });
});
