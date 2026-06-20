/** Exposant maximal : délai plafonné à 2^64 ms. */
export const MAX_BACKOFF_EXP = 64;

/** Plafond pratique pour setTimeout (≈ 24,8 jours). */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Délai de backoff pour la tentative `attempt` (0-indexée) : 2^attempt ms,
 * plafonné à 2^MAX_BACKOFF_EXP ms puis au max supporté par setTimeout.
 */
export function backoffMs(attempt: number): number {
  const exp = Math.min(Math.max(0, attempt), MAX_BACKOFF_EXP);
  if (exp >= 31) return MAX_TIMEOUT_MS;
  return 2 ** exp;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Attend le retour en ligne sans limite de temps. */
export function waitForOnline(): Promise<void> {
  if (navigator.onLine) return Promise.resolve();
  return new Promise((resolve) => {
    const onOnline = (): void => {
      window.removeEventListener('online', onOnline);
      resolve();
    };
    window.addEventListener('online', onOnline);
  });
}
