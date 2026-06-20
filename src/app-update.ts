import { Capacitor, registerPlugin } from '@capacitor/core';

const GITHUB_OWNER = 'yannsuty';
const GITHUB_REPO = 'daily-notes';
const APK_ASSET_NAME = 'app-release.apk';
const VERSION_ASSET_NAME = 'app-version.json';

export interface AppUpdatePlugin {
  getAppInfo(): Promise<{ versionName: string; versionCode: number }>;
  canInstallPackages(): Promise<{ allowed: boolean }>;
  openInstallPermissionSettings(): Promise<{ allowed: boolean }>;
  downloadAndInstall(options: { url: string }): Promise<void>;
}

const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate');

export interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  currentVersionCode: number;
  latestVersion: string;
  latestVersionCode?: number;
  apkUrl?: string;
  releaseNotes?: string;
  error?: string;
}

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  assets: Array<{ name: string; browser_download_url: string }>;
}

interface VersionManifest {
  versionCode: number;
  versionName: string;
  tag?: string;
}

function parseVersion(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function getInstalledAppInfo(): Promise<{
  versionName: string;
  versionCode: number;
} | null> {
  if (!isNativeAndroid()) {
    return null;
  }

  try {
    return await AppUpdate.getAppInfo();
  } catch {
    return null;
  }
}

export async function getInstalledAppVersion(): Promise<string | null> {
  const info = await getInstalledAppInfo();
  return info?.versionName ?? null;
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Merlin-Android-App',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub a répondu ${response.status}.`);
  }

  return (await response.json()) as GitHubRelease;
}

async function fetchVersionManifest(
  release: GitHubRelease,
): Promise<VersionManifest | null> {
  const asset = release.assets.find((item) => item.name === VERSION_ASSET_NAME);
  if (!asset) {
    return null;
  }

  const response = await fetch(asset.browser_download_url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Merlin-Android-App',
    },
  });

  if (!response.ok) {
    return null;
  }

  const manifest = (await response.json()) as VersionManifest;
  if (typeof manifest.versionCode !== 'number') {
    return null;
  }

  return manifest;
}

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!isNativeAndroid()) {
    return {
      available: false,
      currentVersion: '',
      currentVersionCode: 0,
      latestVersion: '',
      error: 'Disponible uniquement sur l’app Android.',
    };
  }

  const installed = await getInstalledAppInfo();
  if (!installed) {
    return {
      available: false,
      currentVersion: '',
      currentVersionCode: 0,
      latestVersion: '',
      error: 'Impossible de lire la version installée.',
    };
  }

  try {
    const release = await fetchLatestRelease();
    const manifest = await fetchVersionManifest(release);
    const apkAsset = release.assets.find((asset) => asset.name === APK_ASSET_NAME);

    const latestVersion =
      manifest?.tag?.replace(/^v/i, '') ??
      manifest?.versionName ??
      release.tag_name.replace(/^v/i, '');

    if (!apkAsset) {
      return {
        available: false,
        currentVersion: installed.versionName,
        currentVersionCode: installed.versionCode,
        latestVersion,
        error: `Asset ${APK_ASSET_NAME} introuvable dans la dernière release.`,
      };
    }

    const latestVersionCode = manifest?.versionCode;
    const available =
      latestVersionCode != null
        ? latestVersionCode > installed.versionCode
        : compareVersions(latestVersion, installed.versionName) > 0;

    return {
      available,
      currentVersion: installed.versionName,
      currentVersionCode: installed.versionCode,
      latestVersion,
      latestVersionCode,
      apkUrl: apkAsset.browser_download_url,
      releaseNotes: release.body?.trim() || undefined,
    };
  } catch (error) {
    return {
      available: false,
      currentVersion: installed.versionName,
      currentVersionCode: installed.versionCode,
      latestVersion: '',
      error: error instanceof Error ? error.message : 'Impossible de contacter GitHub.',
    };
  }
}

export async function ensureInstallPermission(): Promise<boolean> {
  if (!isNativeAndroid()) {
    return false;
  }

  const state = await AppUpdate.canInstallPackages();
  if (state.allowed) {
    return true;
  }

  const result = await AppUpdate.openInstallPermissionSettings();
  return result.allowed;
}

export async function downloadAndInstallUpdate(apkUrl: string): Promise<void> {
  if (!isNativeAndroid()) {
    throw new Error('Disponible uniquement sur l’app Android.');
  }

  const allowed = await ensureInstallPermission();
  if (!allowed) {
    throw new Error('Autorisez l’installation d’apps inconnues pour Merlin.');
  }

  await AppUpdate.downloadAndInstall({ url: apkUrl });
}
