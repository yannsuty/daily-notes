import { Capacitor } from '@capacitor/core';
import {
  formatAgentDevLogEntry,
  redactDevLogDetail,
  trimAgentDevLogs,
  type AgentDevLogEntry,
} from '../lib/merlin-agent/agent-dev-log';
import { apiUrl } from './api-base';
import { listPendingAgentJobs } from './merlin-agent-jobs';
import type { AgentJobPollResponse } from '../lib/merlin-agent';

const STORAGE_ENABLED = 'merlin-agent-dev-log';
const STORAGE_LOGS = 'merlin-agent-dev-log-entries';

export function isAgentDevLogEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem(STORAGE_ENABLED) === '1';
  } catch {
    return false;
  }
}

export function setAgentDevLogEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(STORAGE_ENABLED, '1');
    } else {
      localStorage.removeItem(STORAGE_ENABLED);
      localStorage.removeItem(STORAGE_LOGS);
    }
  } catch {
    // ignore
  }
}

function readClientLogs(): AgentDevLogEntry[] {
  if (!isAgentDevLogEnabled()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_LOGS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentDevLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeClientLogs(logs: AgentDevLogEntry[]): void {
  if (!isAgentDevLogEnabled()) return;
  try {
    localStorage.setItem(STORAGE_LOGS, JSON.stringify(trimAgentDevLogs(logs)));
  } catch {
    // ignore
  }
}

export function logAgentDev(
  tag: string,
  event: string,
  detail?: Record<string, unknown> | string,
  jobId?: string,
): void {
  if (!isAgentDevLogEnabled()) return;

  const entry: AgentDevLogEntry = {
    ts: Date.now(),
    source: 'client',
    tag,
    event,
    jobId,
    detail:
      typeof detail === 'string'
        ? detail
        : redactDevLogDetail(detail),
  };

  writeClientLogs([...readClientLogs(), entry]);
}

export function clearAgentDevLogs(): void {
  try {
    localStorage.removeItem(STORAGE_LOGS);
  } catch {
    // ignore
  }
}

async function fetchJobDevLogs(jobId: string): Promise<AgentJobPollResponse | null> {
  try {
    const response = await fetch(
      apiUrl(`/api/merlin-agent?jobId=${encodeURIComponent(jobId)}&devLog=1`),
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) return null;
    return (await response.json()) as AgentJobPollResponse;
  } catch {
    return null;
  }
}

export async function buildAgentDevLogExport(): Promise<string> {
  const clientLogs = readClientLogs();
  const pending = listPendingAgentJobs();
  const lines: string[] = [
    'Merlin — logs agent (debug)',
    `Exporté : ${new Date().toISOString()}`,
    `App : ${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'inconnue'}`,
    `Plateforme : ${Capacitor.getPlatform()}`,
    `API : ${apiUrl('/api/merlin-agent')}`,
    `Dev log : ${isAgentDevLogEnabled() ? 'activé' : 'désactivé'}`,
    '',
    '--- CLIENT ---',
  ];

  if (clientLogs.length === 0) {
    lines.push('(aucun log client)');
  } else {
    lines.push(...clientLogs.map(formatAgentDevLogEntry));
  }

  lines.push('', '--- JOBS EN ATTENTE ---');
  if (pending.length === 0) {
    lines.push('(aucun)');
  } else {
    for (const job of pending) {
      lines.push(
        `- ${job.jobId} | démarré ${new Date(job.startedAt).toISOString()} | étapes ${job.steps?.length ?? 0} | « ${job.userText.slice(0, 80)} »`,
      );
    }
  }

  for (const job of pending) {
    const status = await fetchJobDevLogs(job.jobId);
    lines.push('', `--- SERVEUR (${job.jobId}) ---`);
    if (!status) {
      lines.push('(job introuvable ou erreur réseau)');
      continue;
    }
    lines.push(`status=${status.status} steps=${status.steps?.length ?? 0}`);
    if (status.error) lines.push(`error=${status.error}`);
    if (status.devLogs?.length) {
      lines.push(...status.devLogs.map(formatAgentDevLogEntry));
    } else {
      lines.push('(aucun log serveur — activer avant le prochain job)');
    }
  }

  return lines.join('\n');
}

export async function copyAgentDevLogsToClipboard(): Promise<string> {
  const text = await buildAgentDevLogExport();
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
  return text;
}
