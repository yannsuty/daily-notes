import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_JOB_TIMEOUT_MS,
  JOB_STREAM_MAX_MS,
  MERLIN_AGENT_MAX_DURATION_SEC,
  STALE_RUNNING_MS,
} from './agent-duration.js';

describe('agent-duration', () => {
  it('aligne les timeouts sur la durée Vercel', () => {
    expect(BACKGROUND_JOB_TIMEOUT_MS).toBe(MERLIN_AGENT_MAX_DURATION_SEC * 1000 - 2_000);
    expect(JOB_STREAM_MAX_MS).toBeLessThan(BACKGROUND_JOB_TIMEOUT_MS);
    expect(STALE_RUNNING_MS).toBeGreaterThan(BACKGROUND_JOB_TIMEOUT_MS);
  });
});
