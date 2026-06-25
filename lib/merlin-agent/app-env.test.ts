import { describe, expect, it } from 'vitest';
import { isAppDevEnv } from './app-env.js';

describe('isAppDevEnv', () => {
  it('détecte APP_ENV=dev', () => {
    expect(isAppDevEnv('dev')).toBe(true);
    expect(isAppDevEnv(' DEV ')).toBe(true);
  });

  it('ignore les autres valeurs', () => {
    expect(isAppDevEnv('production')).toBe(false);
    expect(isAppDevEnv(undefined)).toBe(false);
    expect(isAppDevEnv('')).toBe(false);
  });
});
