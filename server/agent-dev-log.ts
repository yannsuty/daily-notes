import {
  formatAgentDevLogEntry,
  redactDevLogDetail,
  trimAgentDevLogs,
  type AgentDevLogEntry,
} from '../lib/merlin-agent/agent-dev-log.js';
import { getAgentJob, saveAgentJob } from './agent-jobs.js';

export async function appendAgentJobDevLog(
  jobId: string,
  tag: string,
  event: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  const job = await getAgentJob(jobId);
  if (!job?.devLog) return;

  const entry: AgentDevLogEntry = {
    ts: Date.now(),
    source: 'server',
    tag,
    event,
    jobId,
    detail: redactDevLogDetail(detail),
  };

  const devLogs = trimAgentDevLogs([...(job.devLogs ?? []), entry]);
  await saveAgentJob(jobId, {
    ...job,
    devLogs,
    updatedAt: Date.now(),
  });
}

export function formatJobDevLogs(logs: AgentDevLogEntry[] | undefined): string {
  if (!logs?.length) return '(aucun log serveur)';
  return logs.map(formatAgentDevLogEntry).join('\n');
}
