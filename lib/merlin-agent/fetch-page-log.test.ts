import { describe, expect, it } from 'vitest';
import { fetchPageBlockedHint } from './fetch-page-log';

describe('fetchPageBlockedHint', () => {
  it('décrit un 403 anti-bot', () => {
    expect(fetchPageBlockedHint(403)).toContain('403');
    expect(fetchPageBlockedHint(403)).toContain('anti-bot');
  });

  it('décrit les autres codes courants', () => {
    expect(fetchPageBlockedHint(404)).toContain('404');
    expect(fetchPageBlockedHint(429)).toContain('429');
    expect(fetchPageBlockedHint(503)).toContain('503');
  });

  it('retourne undefined pour un succès', () => {
    expect(fetchPageBlockedHint(200)).toBeUndefined();
  });
});
