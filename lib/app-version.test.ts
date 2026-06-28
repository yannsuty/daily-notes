import { describe, expect, it } from 'vitest';
import { getBuildVersionInfo } from './app-version.js';

describe('getBuildVersionInfo', () => {
  it('expose version, env et commit court', () => {
    const info = getBuildVersionInfo({
      APP_ENV: 'dev',
      VERCEL_GIT_COMMIT_SHA: '101c51bdeadbeef',
      VERCEL_URL: 'daily-notes-dev.vercel.app',
    });

    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(info.env).toBe('dev');
    expect(info.commit).toBe('101c51b');
    expect(info.deployment).toBe('daily-notes-dev.vercel.app');
  });
});
