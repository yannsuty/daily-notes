import {
  formatAgentDevLogEntry,
  previewAgentDevText,
  redactDevLogDetail,
  trimAgentDevLogs,
  type AgentDevLogEntry,
} from '../lib/merlin-agent/agent-dev-log.js';
import type { AgentRunResult } from '../lib/merlin-agent/types.js';
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

export async function logAgentReplyDevLog(
  jobId: string,
  result: Pick<AgentRunResult, 'ok' | 'reply' | 'error' | 'steps' | 'depth'>,
): Promise<void> {
  await appendAgentJobDevLog(jobId, 'reply', result.ok ? 'ok' : 'error', {
    replyPreview: previewAgentDevText(result.reply ?? result.error),
    steps: result.steps?.length ?? 0,
    depth: result.depth,
  });
}

export async function logAgentToolDevLog(
  jobId: string,
  toolName: string,
  toolArgs: Record<string, string>,
  toolResult: { ok: boolean; content: string },
): Promise<void> {
  await appendAgentJobDevLog(jobId, 'tool', toolResult.ok ? 'ok' : 'error', {
    name: toolName,
    ...(toolName === 'fetch_page' && toolArgs.url ? { url: toolArgs.url } : {}),
    ...(toolName === 'web_search' && toolArgs.query ? { query: toolArgs.query } : {}),
    contentPreview: previewAgentDevText(toolResult.content),
  });
}

export function formatJobDevLogs(logs: AgentDevLogEntry[] | undefined): string {
  if (!logs?.length) return '(aucun log serveur)';
  return logs.map(formatAgentDevLogEntry).join('\n');
}
