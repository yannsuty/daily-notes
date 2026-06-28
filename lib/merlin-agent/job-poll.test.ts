import { describe, expect, it } from 'vitest';
import { isJobNotFoundError, isRetryableJobNotFound, JOB_POST_GRACE_MS } from './job-poll';

describe('job-poll', () => {
  it('détecte les erreurs job introuvable', () => {
    expect(isJobNotFoundError(new Error('Job introuvable ou expiré'))).toBe(true);
    expect(isJobNotFoundError(new Error('Failed to fetch'))).toBe(false);
  });

  it('retente un 404 tant que le POST est en cours', () => {
    const now = Date.now();
    expect(
      isRetryableJobNotFound({
        startedAt: now,
        postPending: true,
      }),
    ).toBe(true);
  });

  it('retente un 404 jeune job non encore enregistré serveur', () => {
    const now = Date.now();
    expect(
      isRetryableJobNotFound({
        startedAt: now - 5_000,
        serverRegistered: false,
      }),
    ).toBe(true);
    expect(
      isRetryableJobNotFound({
        startedAt: now - JOB_POST_GRACE_MS - 1_000,
        serverRegistered: false,
      }),
    ).toBe(false);
  });

  it('retente un 404 jeune job enregistré serveur', () => {
    const now = Date.now();
    expect(
      isRetryableJobNotFound({
        startedAt: now - 30_000,
        serverRegistered: true,
      }),
    ).toBe(true);
    expect(
      isRetryableJobNotFound({
        startedAt: now - JOB_POST_GRACE_MS - 1_000,
        serverRegistered: true,
      }),
    ).toBe(false);
  });
});
