import { describe, expect, it } from 'vitest';
import { compareVersions, isUpdateAvailable } from './app-update-compare';

describe('compareVersions', () => {
  it('compare 3.6.2 > 3.6.1', () => {
    expect(compareVersions('3.6.2', '3.6.1')).toBeGreaterThan(0);
  });

  it('compare versions égales', () => {
    expect(compareVersions('3.6.1', '3.6.1')).toBe(0);
  });
});

describe('isUpdateAvailable', () => {
  const installed361 = { versionCode: 35, versionName: '3.6.1' };

  it('détecte 3.6.2 via semver', () => {
    expect(isUpdateAvailable(installed361, '3.6.2')).toBe(true);
  });

  it('détecte un build supérieur à semver égale (re-release)', () => {
    expect(isUpdateAvailable({ versionCode: 35, versionName: '3.6.2' }, '3.6.2', 36)).toBe(true);
  });

  it('ne propose pas de downgrade versionCode', () => {
    expect(isUpdateAvailable({ versionCode: 36, versionName: '3.6.2' }, '3.6.1', 35)).toBe(false);
  });

  it('considère à jour si versionCode et semver identiques', () => {
    expect(isUpdateAvailable({ versionCode: 36, versionName: '3.6.2' }, '3.6.2', 36)).toBe(false);
  });
});
