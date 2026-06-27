import { readFileSync } from 'node:fs';

export interface BuildVersionInfo {
  version: string;
  env: string;
  commit?: string;
  deployment?: string;
}

let cachedPackageVersion: string | undefined;

export function getPackageVersion(): string {
  if (cachedPackageVersion) return cachedPackageVersion;
  try {
    cachedPackageVersion = (
      JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string }
    ).version;
  } catch {
    cachedPackageVersion = '0.0.0';
  }
  return cachedPackageVersion;
}

export function getBuildVersionInfo(
  env: NodeJS.ProcessEnv = process.env,
): BuildVersionInfo {
  const commitRaw =
    env.VERCEL_GIT_COMMIT_SHA?.trim() || env.GIT_COMMIT?.trim() || '';
  const commit = commitRaw ? commitRaw.slice(0, 7) : undefined;

  return {
    version: getPackageVersion(),
    env: env.APP_ENV?.trim() || env.VERCEL_ENV?.trim() || '',
    commit,
    deployment: env.VERCEL_URL?.trim() || undefined,
  };
}
