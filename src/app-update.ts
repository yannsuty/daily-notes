import { Capacitor, registerPlugin } from '@capacitor/core';

const GITHUB_OWNER = 'yannsuty';
const GITHUB_REPO = 'daily-notes';
const APK_ASSET_NAME = 'app-release.apk';

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
  latestVersion: string;
  apkUrl?: string;
  releaseNotes?: string;
  error?: string;
}

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  assets: Array<{ name: string; browser_download_url: string }>;
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

export async function getInstalledAppVersion(): Promise<string | null> {
  if (!isNativeAndroid()) {
    return null;
  }

  try {
    const info = await AppUpdate.getAppInfo();
    return info.versionName;
  } catch {
    return null;
  }
}

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!isNativeAndroid()) {
    return {
      available: false,
      currentVersion: '',
      latestVersion: '',
      error: 'Disponible uniquement sur l’app Android.',
    };
  }

  const currentVersion = (await getInstalledAppVersion()) ?? '';
  if (!currentVersion) {
    return {
      available: false,
      currentVersion: '',
      latestVersion: '',
      error: 'Impossible de lire la version installée.',
    };
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
        },
      },
    );

    if (!response.ok) {
      return {
        available: false,
        currentVersion,
        latestVersion: '',
        error: `GitHub a répondu ${response.status}.`,
      };
    }

    const release = (await response.json()) as GitHubRelease;
    const latestVersion = release.tag_name.replace(/^v/i, '');
    const apkAsset = release.assets.find((asset) => asset.name === APK_ASSET_NAME);

    if (!apkAsset) {
      return {
        available: false,
        currentVersion,
        latestVersion,
        error: `Asset ${APK_ASSET_NAME} introuvable dans la dernière release.`,
      };
    }

    return {
      available: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion,
      apkUrl: apkAsset.browser_download_url,
      releaseNotes: release.body?.trim() || undefined,
    };
  } catch {
    return {
      available: false,
      currentVersion,
      latestVersion: '',
      error: 'Impossible de contacter GitHub.',
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
