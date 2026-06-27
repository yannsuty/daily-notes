/** Fenêtre pendant laquelle un 404 peut signifier « POST pas encore terminé ». */
export const JOB_POST_GRACE_MS = 120_000;

export const JOB_NOT_FOUND_MESSAGE = 'Job introuvable ou expiré';

export function isJobNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('introuvable') || message.includes('expiré');
}

export function isRetryableJobNotFound(options: {
  startedAt: number;
  postPending?: boolean;
  serverRegistered?: boolean;
  now?: number;
}): boolean {
  const now = options.now ?? Date.now();
  const age = now - options.startedAt;
  if (options.postPending) return true;
  if (!options.serverRegistered && age < JOB_POST_GRACE_MS) return true;
  // Propagation Redis / cold start Vercel après enregistrement serveur.
  if (options.serverRegistered && age < JOB_POST_GRACE_MS) return true;
  return false;
}
