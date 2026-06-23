import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatGitHubSummary, inspectGitHubRepo } from './github.js';

describe('formatGitHubSummary', () => {
  it('formate les métadonnées et extraits', () => {
    const text = formatGitHubSummary({
      owner: 'acme',
      repo: 'merlin',
      description: 'Assistant perso',
      defaultBranch: 'main',
      language: 'TypeScript',
      topics: ['pwa'],
      readmeExcerpt: '# Merlin',
      treeSummary: 'src/app.ts',
    });

    expect(text).toContain('Dépôt : acme/merlin');
    expect(text).toContain('Langage principal : TypeScript');
    expect(text).toContain('src/app.ts');
    expect(text).toContain('# Merlin');
  });
});

describe('inspectGitHubRepo', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retourne un résumé pour un dépôt public', async () => {
    const readmeB64 = Buffer.from('# Hello').toString('base64');

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          description: 'Test repo',
          default_branch: 'main',
          language: 'TypeScript',
          topics: ['test'],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: readmeB64 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tree: [{ path: 'src/index.ts', type: 'blob' }],
        }),
      } as Response);

    const result = await inspectGitHubRepo('acme', 'merlin', 'ghp_test');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.owner).toBe('acme');
      expect(result.summary.readmeExcerpt).toContain('# Hello');
      expect(result.summary.treeSummary).toContain('src/index.ts');
    }

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/merlin',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_test',
        }),
      }),
    );
  });

  it('signale un dépôt introuvable', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    const result = await inspectGitHubRepo('acme', 'missing');
    expect(result).toEqual({ ok: false, error: 'Dépôt acme/missing introuvable.' });
  });

  it('signale un accès refusé sans token valide', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    const result = await inspectGitHubRepo('acme', 'private');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('GITHUB_TOKEN');
    }
  });
});
