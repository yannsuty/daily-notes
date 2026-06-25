import { describe, expect, it } from 'vitest';
import { mergeSpaceData, normalizeComparisonData, normalizeComparisonRow, repairComparisonRow } from './space-merge.js';

describe('repairComparisonRow', () => {
  const columns = ['Modèle', 'Prix estimé (€)', 'Diamètre', 'Puissance (W)'];

  it('répare une ligne décalée avec fragment de diamètre après le modèle', () => {
    const broken = ['Hunter Original', '52"', '120-180', '52" (132 cm)', '80'];
    expect(repairComparisonRow(broken, columns)).toEqual([
      'Hunter Original',
      '120-180',
      '52" (132 cm)',
      '80',
    ]);
  });

  it('répare une ligne de longueur correcte mais décalée', () => {
    const broken = ['Minka Aire LightWave', '50"', '200-280', '50" (127 cm)', '90'];
    expect(repairComparisonRow(broken, columns)).toEqual([
      'Minka Aire LightWave',
      '200-280',
      '50" (127 cm)',
      '90',
    ]);
  });
});

describe('normalizeComparisonData', () => {
  const columns = ['Modèle', 'Prix estimé (€)', 'Diamètre', 'Puissance (W)'];

  it('supprime une cellule vide parasite après un modèle en pouces', () => {
    const data = normalizeComparisonData({
      columns,
      rows: [['Philips Classic 44', '', '150-200', '44" (110 cm)', '75']],
    });
    expect(data.rows?.[0]).toEqual(['Philips Classic 44', '150-200', '44" (110 cm)', '75']);
  });

  it('tronque les lignes trop longues', () => {
    const data = normalizeComparisonData({
      columns: ['A', 'B'],
      rows: [['1', '2', '3']],
    });
    expect(data.rows?.[0]).toEqual(['1', '2']);
  });

  it('complète les lignes trop courtes', () => {
    const data = normalizeComparisonData({
      columns: ['A', 'B', 'C'],
      rows: [['1', '2']],
    });
    expect(data.rows?.[0]).toEqual(['1', '2', '']);
  });
});

describe('normalizeComparisonRow', () => {
  it('répare une ligne avec guillemet pouce mal échappé', () => {
    expect(normalizeComparisonRow(['Hunter Original', '', '120-180', '52" (132 cm)'], 3)).toEqual([
      'Hunter Original',
      '120-180',
      '52" (132 cm)',
    ]);
  });
});

describe('mergeSpaceData — comparison', () => {
  const existing = {
    columns: ['Modèle', 'Prix', 'Bruit'],
    rows: [['Alpha', '150 €', '30 dB']],
  };

  it('fusionne une nouvelle ligne en mode append', () => {
    const merged = mergeSpaceData(
      'comparison',
      existing,
      { rows: [['Beta', '180 €', '28 dB']] },
      { append: true },
    );
    expect(merged.rows).toHaveLength(2);
    expect(merged.rows?.[1][0]).toBe('Beta');
  });

  it('met à jour une ligne existante par nom (colonne 1)', () => {
    const merged = mergeSpaceData(
      'comparison',
      existing,
      { rows: [['Alpha', '160 €', '29 dB']] },
      { append: true },
    );
    expect(merged.rows).toHaveLength(1);
    expect(merged.rows?.[0][1]).toBe('160 €');
  });

  it('unionne les colonnes', () => {
    const merged = mergeSpaceData(
      'comparison',
      existing,
      { columns: ['Modèle', 'Garantie'], rows: [['Gamma', '5 ans']] },
      { append: true },
    );
    expect(merged.columns).toContain('Garantie');
    expect(merged.rows?.[1][0]).toBe('Gamma');
  });

  it('remplace tout le tableau si le patch contient colonnes et toutes les lignes', () => {
    const full = {
      columns: ['Modèle', 'Prix', 'Bruit'],
      rows: [
        ['Alpha', '150 €', '30 dB'],
        ['Beta', '180 €', '28 dB'],
        ['Gamma', '200 €', '27 dB'],
      ],
    };
    const merged = mergeSpaceData('comparison', existing, full, { append: true });
    expect(merged.rows).toHaveLength(3);
    expect(merged.rows?.[2][0]).toBe('Gamma');
  });

  it('normalise les lignes décalées lors d un append', () => {
    const merged = mergeSpaceData(
      'comparison',
      existing,
      {
        rows: [['Beta', '', '180 €', '28 dB']],
      },
      { append: true },
    );
    expect(merged.rows?.[1]).toEqual(['Beta', '180 €', '28 dB']);
  });
});
