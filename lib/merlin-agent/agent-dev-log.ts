export type AgentDevLogSource = 'client' | 'server';

export interface AgentDevLogEntry {
  ts: number;
  source: AgentDevLogSource;
  tag: string;
  event: string;
  jobId?: string;
  detail?: Record<string, unknown> | string;
}

export const MAX_AGENT_DEV_LOGS = 250;

export function formatAgentDevLogEntry(entry: AgentDevLogEntry): string {
  const time = new Date(entry.ts).toISOString();
  const detail =
    entry.detail === undefined
      ? ''
      : typeof entry.detail === 'string'
        ? ` ${entry.detail}`
        : ` ${JSON.stringify(entry.detail)}`;
  const job = entry.jobId ? ` job=${entry.jobId}` : '';
  return `[${time}] [${entry.source}] [${entry.tag}]${job} ${entry.event}${detail}`;
}

export function trimAgentDevLogs(logs: AgentDevLogEntry[]): AgentDevLogEntry[] {
  if (logs.length <= MAX_AGENT_DEV_LOGS) return logs;
  return logs.slice(logs.length - MAX_AGENT_DEV_LOGS);
}

export function redactDevLogDetail(
  detail?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!detail) return detail;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (/api[_-]?key|token|secret|password|passphrase/i.test(key)) {
      out[key] = value ? '[redacted]' : value;
    } else {
      out[key] = value;
    }
  }
  return out;
}
