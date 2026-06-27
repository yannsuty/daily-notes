import { apiUrl } from './api-base';

export interface BackendVersionInfo {
  version: string;
  env?: string;
  commit?: string;
  deployment?: string;
}

function formatVersionCore(version: string, commit?: string): string {
  return commit ? `v${version}@${commit}` : `v${version}`;
}

export function formatDevVersionHeader(
  frontVersion: string,
  frontCommit: string | undefined,
  back: BackendVersionInfo | null,
): string {
  const front = `front ${formatVersionCore(frontVersion, frontCommit)}`;
  if (!back) return `${front} · back …`;
  return `${front} · back ${formatVersionCore(back.version, back.commit)}`;
}

export function devVersionTitle(
  frontVersion: string,
  frontCommit: string | undefined,
  frontEnv: string | undefined,
  back: BackendVersionInfo | null,
): string {
  const lines = [
    `Front : ${formatVersionCore(frontVersion, frontCommit)}${frontEnv ? ` (${frontEnv})` : ''}`,
  ];
  if (back) {
    lines.push(`Back : ${formatVersionCore(back.version, back.commit)}`);
    if (back.env) lines.push(`API env : ${back.env}`);
    if (back.deployment) lines.push(`Déploiement : ${back.deployment}`);
  }
  return lines.join('\n');
}

export async function fetchBackendVersion(): Promise<BackendVersionInfo | null> {
  try {
    const response = await fetch(apiUrl('/api/version'), {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as BackendVersionInfo;
  } catch {
    return null;
  }
}
