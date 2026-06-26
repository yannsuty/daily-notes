import { describe, expect, it, vi } from 'vitest';
import {
  enrichComparisonRowImages,
  getRowImage,
  mergeRowImages,
} from './comparison-images.js';

const entries = [
  { row: ['Alpha', '100 €'], key: 'alpha', sourceIndex: 0 },
  { row: ['Beta', '120 €'], key: 'beta', sourceIndex: 1 },
];

describe('getRowImage', () => {
  it('lit une URL par clé', () => {
    expect(getRowImage({ rowImages: { alpha: 'https://cdn.example.com/a.jpg' } }, 'Alpha')).toBe(
      'https://cdn.example.com/a.jpg',
    );
  });
});

describe('mergeRowImages', () => {
  it('fusionne en mode append', () => {
    expect(
      mergeRowImages({ alpha: 'https://a.test/img.jpg' }, { beta: 'https://b.test/img.jpg' }),
    ).toEqual({
      alpha: 'https://a.test/img.jpg',
      beta: 'https://b.test/img.jpg',
    });
  });

  it('remplace en mode replace', () => {
    expect(
      mergeRowImages({ alpha: 'https://old.test/img.jpg' }, { beta: 'https://b.test/img.jpg' }, false),
    ).toEqual({ beta: 'https://b.test/img.jpg' });
  });
});

describe('enrichComparisonRowImages', () => {
  it('recherche une image par ligne visible', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce('https://cdn.example.com/alpha.jpg')
      .mockResolvedValueOnce(null);

    const result = await enrichComparisonRowImages({
      entries,
      contextHint: 'ventilateurs',
      search,
    });

    expect(result.found).toBe(1);
    expect(result.failed).toEqual(['Beta']);
    expect(result.rowImages.alpha).toBe('https://cdn.example.com/alpha.jpg');
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('ignore les lignes déjà illustrées sans overwrite', async () => {
    const search = vi.fn().mockResolvedValue('https://cdn.example.com/new.jpg');

    const result = await enrichComparisonRowImages({
      entries,
      existingImages: { alpha: 'https://cdn.example.com/old.jpg' },
      contextHint: 'ventilateurs',
      search,
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(result.rowImages.alpha).toBe('https://cdn.example.com/old.jpg');
    expect(result.skipped).toBeGreaterThan(0);
  });
});
