import { apiUrl } from './api-base';

export interface BackendVersionInfo {
  version: string;
  env?: string;
  commit?: string;
  deployment?: string;
}

export function formatDevVersionHeader(
  frontVersion: string,
  back: BackendVersionInfo | null,
): string {
  const front = `front v${frontVersion}`;
  if (!back) return `${front} · back …`;
  const backCore = back.commit ? `v${back.version}@${back.commit}` : `v${back.version}`;
  return `${front} · back ${backCore}`;
}

export function devVersionTitle(
  frontVersion: string,
  frontEnv: string | undefined,
  back: BackendVersionInfo | null,
): string {
  const lines = [
    `Front : v${frontVersion}${frontEnv ? ` (${frontEnv})` : ''}`,
  ];
  if (back) {
    lines.push(`Back : v${back.version}${back.commit ? ` @ ${back.commit}` : ''}`);
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
