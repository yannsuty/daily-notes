import { describe, expect, it } from 'vitest';
import type { MerlinSpace } from './types.js';
import { formatSpaceForAgent, formatSpacesSummary } from './space-format.js';

const baseSpace = (overrides: Partial<MerlinSpace> = {}): MerlinSpace => ({
  id: 'space-1',
  kind: 'comparison',
  title: 'Téléphones photo',
  recap: 'Comparer iPhone et Pixel pour la photo',
  data: {},
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('formatSpaceForAgent', () => {
  it('formate une comparaison avec tableau', () => {
    const text = formatSpaceForAgent(
      baseSpace({
        data: {
          columns: ['Modèle', 'Prix'],
          rows: [
            ['iPhone', '999 €'],
            ['Pixel', '799 €'],
          ],
        },
      }),
    );

    expect(text).toContain('[Comparaison] Téléphones photo');
    expect(text).toContain('id: space-1');
    expect(text).toContain('Modèle | Prix');
    expect(text).toContain('iPhone | 999 €');
  });

  it('formate un projet DIY avec intro, sections et liste liée', () => {
    const text = formatSpaceForAgent(
      baseSpace({
        kind: 'diy',
        title: 'Étagère palette',
        data: {
          intro: 'Projet pour le salon',
          sections: [{ id: 's1', title: 'Matériaux', content: '2 palettes' }],
          listId: 'list-diy-1',
        },
      }),
    );

    expect(text).toContain('[Projet DIY]');
    expect(text).toContain('Intro : Projet pour le salon');
    expect(text).toContain('## Matériaux');
    expect(text).toContain('Liste liée : list-diy-1');
  });

  it('formate un plan avec objectif, repo et jalons', () => {
    const text = formatSpaceForAgent(
      baseSpace({
        kind: 'plan',
        title: 'Refacto sync',
        data: {
          goal: 'Simplifier la sync',
          github: { owner: 'acme', repo: 'merlin' },
          milestones: [
            { id: 'm1', title: 'Audit', done: false },
            { id: 'm2', title: 'Tests', done: true },
          ],
        },
      }),
    );

    expect(text).toContain('Objectif : Simplifier la sync');
    expect(text).toContain('Repo : acme/merlin');
    expect(text).toContain('○ Audit');
    expect(text).toContain('✓ Tests');
  });

  it('formate une recette avec ingrédients triés et étapes ordonnées', () => {
    const text = formatSpaceForAgent(
      baseSpace({
        kind: 'recipe',
        title: 'Crêpes',
        data: {
          servings: 4,
          ingredients: [{ id: 'i1', text: 'farine', quantity: '250', unit: 'g' }],
          steps: [
            { id: 'st2', order: 2, text: 'Cuire' },
            { id: 'st1', order: 1, text: 'Mélanger' },
          ],
        },
      }),
    );

    expect(text).toContain('Portions : 4');
    expect(text).toContain('- 250 g farine');
    expect(text.indexOf('1. Mélanger')).toBeLessThan(text.indexOf('2. Cuire'));
  });
});

describe('formatSpacesSummary', () => {
  it('retourne une chaîne vide sans espace actif', () => {
    expect(formatSpacesSummary([])).toBe('');
    expect(
      formatSpacesSummary([baseSpace({ status: 'archived' })]),
    ).toBe('');
  });

  it('liste les espaces actifs avec kind et id', () => {
    const summary = formatSpacesSummary([
      baseSpace({ id: 'a', kind: 'recipe', title: 'Gâteau' }),
      baseSpace({ id: 'b', kind: 'plan', title: 'API' }),
    ]);

    expect(summary).toContain('[recipe] Gâteau (id: a)');
    expect(summary).toContain('[plan] API (id: b)');
  });

  it('limite à 12 espaces', () => {
    const spaces = Array.from({ length: 15 }, (_, i) =>
      baseSpace({ id: `s${i}`, title: `Espace ${i}` }),
    );
    const lines = formatSpacesSummary(spaces).split('\n');
    expect(lines).toHaveLength(12);
  });
});
