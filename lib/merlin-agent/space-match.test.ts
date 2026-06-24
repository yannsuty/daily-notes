import { describe, expect, it } from 'vitest';
import type { MerlinSpace } from './types.js';
import { findSpaceByRef, scoreSpaceTitleMatch } from './space-match.js';

const comparison = (overrides: Partial<MerlinSpace> = {}): MerlinSpace => ({
  id: 'cmp-salon',
  kind: 'comparison',
  title: 'Comparaison — ventilateurs de plafond salon',
  recap: 'Modèles silencieux',
  data: { columns: ['Modèle'], rows: [['Alpha']] },
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('scoreSpaceTitleMatch', () => {
  it('matche un titre inventé par le LLM', () => {
    const score = scoreSpaceTitleMatch(
      'Comparaison ventilateurs de plafond salon',
      'Comparaison — ventilateurs de plafond salon',
    );
    expect(score).toBeGreaterThanOrEqual(45);
  });

  it('matche mal un titre sans rapport', () => {
    expect(scoreSpaceTitleMatch('Recette crêpes', 'Comparaison ventilateurs')).toBeLessThan(45);
  });
});

describe('findSpaceByRef', () => {
  const spaces = [
    comparison(),
    comparison({
      id: 'cmp-chambre',
      title: 'Ventilateurs chambre',
    }),
  ];

  it('trouve par id exact', () => {
    expect(findSpaceByRef(spaces, 'cmp-salon')?.id).toBe('cmp-salon');
  });

  it('trouve par titre flou', () => {
    const found = findSpaceByRef(spaces, 'Comparaison ventilateurs de plafond salon');
    expect(found?.id).toBe('cmp-salon');
  });

  it('retombe sur le contexte actif si le titre ne matche pas', () => {
    const found = findSpaceByRef(spaces, 'Comparaison bidon inexistant', {
      activeSpaceId: 'cmp-chambre',
    });
    expect(found?.id).toBe('cmp-chambre');
  });
});
