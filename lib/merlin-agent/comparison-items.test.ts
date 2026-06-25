import { describe, expect, it } from 'vitest';
import {
  comparisonRowKey,
  getIgnoredComparisonRows,
  getVisibleComparisonRows,
  ignoreComparisonRow,
  restoreComparisonRow,
} from './comparison-items.js';

const sampleData = {
  columns: ['Modèle', 'Prix', 'Diamètre'],
  rows: [
    ['Alpha', '150 €', '132 cm'],
    ['Beta', '120 €', '120 cm'],
    ['Gamma', '200 €', '140 cm'],
  ],
};

describe('comparisonRowKey', () => {
  it('normalise la première colonne', () => {
    expect(comparisonRowKey(['  Alpha  ', '150 €'])).toBe('alpha');
  });
});

describe('getVisibleComparisonRows', () => {
  it('retourne toutes les lignes sans ignoredRows', () => {
    expect(getVisibleComparisonRows(sampleData)).toHaveLength(3);
  });

  it('exclut les lignes ignorées', () => {
    const data = { ...sampleData, ignoredRows: ['beta'] };
    const visible = getVisibleComparisonRows(data);
    expect(visible).toHaveLength(2);
    expect(visible.map((e) => e.key)).toEqual(['alpha', 'gamma']);
  });
});

describe('ignoreComparisonRow', () => {
  it('ajoute une clé ignorée', () => {
    const next = ignoreComparisonRow(sampleData, 'Beta');
    expect(next.ignoredRows).toEqual(['beta']);
    expect(getVisibleComparisonRows(next)).toHaveLength(2);
  });

  it('ne duplique pas une clé existante', () => {
    const data = { ...sampleData, ignoredRows: ['beta'] };
    const next = ignoreComparisonRow(data, 'beta');
    expect(next.ignoredRows).toEqual(['beta']);
  });
});

describe('restoreComparisonRow', () => {
  it('retire une clé ignorée', () => {
    const data = { ...sampleData, ignoredRows: ['beta', 'gamma'] };
    const next = restoreComparisonRow(data, 'beta');
    expect(next.ignoredRows).toEqual(['gamma']);
    expect(getVisibleComparisonRows(next)).toHaveLength(2);
  });

  it('supprime ignoredRows quand la liste est vide', () => {
    const data = { ...sampleData, ignoredRows: ['beta'] };
    const next = restoreComparisonRow(data, 'beta');
    expect(next.ignoredRows).toBeUndefined();
  });
});

describe('getIgnoredComparisonRows', () => {
  it('liste uniquement les lignes ignorées', () => {
    const data = { ...sampleData, ignoredRows: ['beta'] };
    const ignored = getIgnoredComparisonRows(data);
    expect(ignored).toHaveLength(1);
    expect(ignored[0].row[0]).toBe('Beta');
  });
});
