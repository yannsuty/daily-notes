import { describe, expect, it } from 'vitest';
import { formatDevVersionHeader } from './api-version';

describe('formatDevVersionHeader', () => {
  it('affiche front et back avec commit', () => {
    expect(
      formatDevVersionHeader('3.8.0', 'abc1234', {
        version: '3.8.0',
        commit: 'def5678',
      }),
    ).toBe('front v3.8.0@abc1234 · back v3.8.0@def5678');
  });

  it('gère un front sans commit', () => {
    expect(
      formatDevVersionHeader('3.8.0', undefined, {
        version: '3.8.0',
        commit: 'def5678',
      }),
    ).toBe('front v3.8.0 · back v3.8.0@def5678');
  });
});
