import { describe, expect, it } from 'vitest';
import { mergeSpaceData } from './space-merge.js';

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
});
