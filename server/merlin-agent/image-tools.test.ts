import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { searchBraveImages } from './image-tools.js';

describe('searchBraveImages', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Ventilateur Hunter',
              url: 'https://shop.example.com/hunter',
              properties: { url: 'https://cdn.example.com/hunter.jpg' },
              thumbnail: { src: 'https://cdn.example.com/hunter-thumb.jpg' },
            },
          ],
        }),
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('extrait l’URL image depuis la réponse Brave', async () => {
    const hits = await searchBraveImages('hunter ventilateur', 3, 'test-key');
    expect(hits).toHaveLength(1);
    expect(hits[0].imageUrl).toBe('https://cdn.example.com/hunter.jpg');
    expect(hits[0].pageUrl).toBe('https://shop.example.com/hunter');
  });
});
