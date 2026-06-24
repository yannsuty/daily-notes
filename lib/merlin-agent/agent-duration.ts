/**
 * Durées agent alignées sur `vercel.json` → `api/merlin-agent.ts` → `maxDuration`.
 * Plan Vercel Pro : 300 s (Fluid Compute). Monter ici + vercel.json si le plan le permet.
 */
export const MERLIN_AGENT_MAX_DURATION_SEC = 300;

const TIMEOUT_MARGIN_MS = 2_000;

/** Race interne avant que Vercel coupe la fonction. */
export const BACKGROUND_JOB_TIMEOUT_MS =
  MERLIN_AGENT_MAX_DURATION_SEC * 1000 - TIMEOUT_MARGIN_MS;

/** SSE : se termine un peu avant pour émettre `reconnect` et reprendre le poll. */
export const JOB_STREAM_MAX_MS = BACKGROUND_JOB_TIMEOUT_MS - 3_000;

/** Job `running` sans activité → marqué en erreur (process tué, réseau, etc.). */
export const STALE_RUNNING_MS = BACKGROUND_JOB_TIMEOUT_MS + 60_000;
