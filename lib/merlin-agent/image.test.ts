import { describe, expect, it } from 'vitest';
import {
  buildComparisonImageQuery,
  formatImageSearchResults,
  isValidImageUrl,
} from './image.js';

describe('isValidImageUrl', () => {
  it('accepte une URL https publique', () => {
    expect(isValidImageUrl('https://cdn.example.com/product.jpg')).toBe(true);
  });

  it('rejette http et localhost', () => {
    expect(isValidImageUrl('http://example.com/a.jpg')).toBe(false);
    expect(isValidImageUrl('https://localhost/a.jpg')).toBe(false);
  });
});

describe('buildComparisonImageQuery', () => {
  it('combine nom et contexte', () => {
    expect(buildComparisonImageQuery('Hunter Original', 'Comparaison — ventilateurs')).toBe(
      'Hunter Original ventilateurs',
    );
  });

  it('retourne le nom seul si le contexte est absent', () => {
    expect(buildComparisonImageQuery('Alpha', '')).toBe('Alpha');
  });
});

describe('formatImageSearchResults', () => {
  it('formate les résultats', () => {
    const text = formatImageSearchResults('test', [
      {
        title: 'Produit',
        imageUrl: 'https://cdn.example.com/a.jpg',
        pageUrl: 'https://shop.example.com',
      },
    ]);
    expect(text).toContain('1 image(s)');
    expect(text).toContain('https://cdn.example.com/a.jpg');
  });
});
