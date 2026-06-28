import { beforeEach, describe, expect, it, vi } from 'vitest';

const cache = vi.hoisted(() => ({
  getWebCache: vi.fn(),
  setWebCache: vi.fn(),
}));

vi.mock('./web-cache.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./web-cache.js')>();
  return {
    ...actual,
    getWebCache: cache.getWebCache,
    setWebCache: cache.setWebCache,
  };
});

import { runFetchPage } from './web-tools.js';

describe('runFetchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.getWebCache.mockResolvedValue(null);
    cache.setWebCache.mockResolvedValue(undefined);
  });

  it('retourne des métadonnées debug sur un 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        url: 'https://example.com/produit',
        headers: { get: () => 'text/html' },
        text: async () => '',
      }),
    );

    const result = await runFetchPage({ url: 'https://example.com/produit' });

    expect(result.ok).toBe(false);
    expect(result.content).toContain('HTTP 403');
    expect(result.content).toContain('anti-bot');
    expect(result.devMeta).toMatchObject({
      url: 'https://example.com/produit',
      httpStatus: 403,
      httpStatusText: 'Forbidden',
      errorCode: 'http_error',
      blockedHint: expect.stringContaining('403'),
    });
  });

  it('retourne des métadonnées debug sur une page lue avec succès', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://example.com/page',
        headers: { get: () => 'text/html' },
        text: async () => '<html><title>Test</title><body><p>Hello</p></body></html>',
      }),
    );

    const result = await runFetchPage({ url: 'https://example.com/page' });

    expect(result.ok).toBe(true);
    expect(result.devMeta).toMatchObject({
      url: 'https://example.com/page',
      httpStatus: 200,
      pageTitle: 'Test',
      fromCache: false,
      textLength: expect.any(Number),
    });
    expect(cache.setWebCache).toHaveBeenCalled();
  });

  it('indique un cache hit dans devMeta', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    cache.getWebCache.mockResolvedValue(
      JSON.stringify({
        content: 'Contenu de https://example.com/cached :\n\nDepuis le cache',
        webSources: [{ title: 'Cached', url: 'https://example.com/cached', kind: 'page' }],
      }),
    );

    const result = await runFetchPage({ url: 'https://example.com/cached' });

    expect(result.ok).toBe(true);
    expect(result.devMeta).toMatchObject({
      url: 'https://example.com/cached',
      fromCache: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
