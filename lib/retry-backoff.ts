/** Indice maximal pour n dans 2 + 2×n secondes. */
export const MAX_BACKOFF_N = 64;

/**
 * Délai de backoff pour la tentative `attempt` (0-indexée) : (2 + 2×n) secondes,
 * avec n plafonné à MAX_BACKOFF_N (soit 130 s max).
 */
export function backoffMs(attempt: number): number {
  const n = Math.min(Math.max(0, attempt), MAX_BACKOFF_N);
  return (2 + 2 * n) * 1000;
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
