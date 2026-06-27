import { describe, expect, it } from 'vitest';
import {
  formatAgentDevLogEntry,
  previewAgentDevText,
  redactDevLogDetail,
  trimAgentDevLogs,
  type AgentDevLogEntry,
} from './agent-dev-log.js';

describe('agent-dev-log', () => {
  it('formate une entrée lisible', () => {
    const line = formatAgentDevLogEntry({
      ts: Date.UTC(2026, 5, 23, 12, 0, 0),
      source: 'client',
      tag: 'poll',
      event: 'ok',
      jobId: 'job-1',
      detail: { status: 'running' },
    });
    expect(line).toContain('[client]');
    expect(line).toContain('job=job-1');
    expect(line).toContain('poll');
  });

  it('masque les secrets', () => {
    expect(redactDevLogDetail({ apiKey: 'sk-test', status: 'ok' })).toEqual({
      apiKey: '[redacted]',
      status: 'ok',
    });
  });

  it('limite le nombre d’entrées', () => {
    const logs: AgentDevLogEntry[] = Array.from({ length: 300 }, (_, i) => ({
      ts: i,
      source: 'client',
      tag: 't',
      event: String(i),
    }));
    expect(trimAgentDevLogs(logs)).toHaveLength(250);
  });

  it('tronque les longues réponses pour les logs', () => {
    expect(previewAgentDevText('abc', 10)).toBe('abc');
    expect(previewAgentDevText(undefined)).toBeUndefined();
    const long = 'x'.repeat(700);
    const preview = previewAgentDevText(long, 600);
    expect(preview).toContain('… (700 car.)');
    expect(preview!.length).toBeLessThan(700);
  });
});
