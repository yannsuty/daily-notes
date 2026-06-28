import { execSync } from 'node:child_process';
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

export function resolveBuildCommit(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv =
    env.VERCEL_GIT_COMMIT_SHA?.trim() || env.GIT_COMMIT?.trim() || '';
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    const short = execSync('git rev-parse --short=7 HEAD', {
      encoding: 'utf-8',
    }).trim();
    return short || undefined;
  } catch {
    return undefined;
  }
}

export function getBuildVersionInfo(
  env: NodeJS.ProcessEnv = process.env,
): BuildVersionInfo {
  return {
    version: getPackageVersion(),
    env: env.APP_ENV?.trim() || env.VERCEL_ENV?.trim() || '',
    commit: resolveBuildCommit(env),
    deployment: env.VERCEL_URL?.trim() || undefined,
  };
}
