import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

const GITHUB_OWNER = 'yannsuty';
const GITHUB_REPO = 'daily-notes';
const APK_ASSET_NAME = 'app-release.apk';
const VERSION_ASSET_NAME = 'app-version.json';

export interface AppUpdatePlugin {
  getAppInfo(): Promise<{ versionName: string; versionCode: number }>;
  canInstallPackages(): Promise<{ allowed: boolean }>;
  openInstallPermissionSettings(): Promise<{ allowed: boolean }>;
  getDownloadState(): Promise<DownloadState>;
  clearDownload(): Promise<void>;
  downloadAndInstall(options: { url: string; versionCode: number }): Promise<void>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (event: DownloadProgressEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export interface DownloadProgressEvent {
  downloadedBytes: number;
  totalBytes: number;
  percent?: number;
}

export interface DownloadState {
  status: 'idle' | 'paused' | 'complete';
  url?: string;
  versionCode?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  percent?: number;
}

const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate');

export interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  currentVersionCode: number;
  currentReleaseLabel: string;
  latestVersion: string;
  latestVersionCode?: number;
  apkUrl?: string;
  releaseNotes?: string;
  error?: string;
}

interface GitHubAsset {
  id: number;
  name: string;
  url: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  assets: GitHubAsset[];
}

interface VersionManifest {
  versionCode: number;
  versionName: string;
  tag?: string;
}

interface ReleaseIndexEntry {
  tag: string;
  versionCode: number;
  versionName: string;
}

let releaseIndexCache: { expiresAt: number; entries: ReleaseIndexEntry[] } | null = null;

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

function githubHeaders(accept: string): HeadersInit {
  return {
    Accept: accept,
    'User-Agent': 'Merlin-Android-App',
  };
}

function normalizeTag(tag: string): string {
  return tag.replace(/^v/i, '');
}

function formatReleaseLabel(tag: string, versionCode: number): string {
  return `v${normalizeTag(tag)} · build ${versionCode}`;
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

async function fetchRecentReleases(): Promise<GitHubRelease[]> {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=20`,
    {
      headers: githubHeaders('application/vnd.github+json'),
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub a répondu ${response.status}.`);
  }

  return (await response.json()) as GitHubRelease[];
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    {
      headers: githubHeaders('application/vnd.github+json'),
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

  const response = await fetch(asset.url, {
    headers: githubHeaders('application/octet-stream'),
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

async function getReleaseIndex(): Promise<ReleaseIndexEntry[]> {
  const now = Date.now();
  if (releaseIndexCache && releaseIndexCache.expiresAt > now) {
    return releaseIndexCache.entries;
  }

  const releases = await fetchRecentReleases();
  const entries: ReleaseIndexEntry[] = [];

  for (const release of releases) {
    const manifest = await fetchVersionManifest(release);
    if (!manifest) {
      continue;
    }

    entries.push({
      tag: manifest.tag ?? release.tag_name,
      versionCode: manifest.versionCode,
      versionName: manifest.versionName,
    });
  }

  releaseIndexCache = {
    entries,
    expiresAt: now + 5 * 60_000,
  };

  return entries;
}

export async function resolveInstalledReleaseLabel(
  versionCode: number,
  versionName?: string,
): Promise<string> {
  try {
    const entries = await getReleaseIndex();
    const match = entries.find((entry) => entry.versionCode === versionCode);
    if (match) {
      return formatReleaseLabel(match.tag, versionCode);
    }
  } catch {
    // ignore and fall back below
  }

  if (versionName) {
    return `v${normalizeTag(versionName)} · build ${versionCode}`;
  }

  return `build ${versionCode}`;
}

function getApkDownloadUrl(asset: GitHubAsset): string {
  return asset.url;
}

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!isNativeAndroid()) {
    return {
      available: false,
      currentVersion: '',
      currentVersionCode: 0,
      currentReleaseLabel: '',
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
      currentReleaseLabel: '',
      latestVersion: '',
      error: 'Impossible de lire la version installée.',
    };
  }

  const currentReleaseLabel = await resolveInstalledReleaseLabel(
    installed.versionCode,
    installed.versionName,
  );

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
        currentReleaseLabel,
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
      currentReleaseLabel,
      latestVersion,
      latestVersionCode,
      apkUrl: getApkDownloadUrl(apkAsset),
      releaseNotes: release.body?.trim() || undefined,
    };
  } catch (error) {
    return {
      available: false,
      currentVersion: installed.versionName,
      currentVersionCode: installed.versionCode,
      currentReleaseLabel,
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

export async function getPendingDownloadState(): Promise<DownloadState | null> {
  if (!isNativeAndroid()) {
    return null;
  }

  try {
    const state = await AppUpdate.getDownloadState();
    if (state.status === 'idle') {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export async function clearPendingDownload(): Promise<void> {
  if (!isNativeAndroid()) {
    return;
  }

  await AppUpdate.clearDownload();
}

export function formatDownloadProgress(state: DownloadState): string {
  if (state.status === 'complete') {
    return 'Téléchargement terminé — prêt à installer.';
  }

  const percent =
    state.percent ??
    (state.totalBytes && state.downloadedBytes
      ? Math.floor((state.downloadedBytes * 100) / state.totalBytes)
      : undefined);

  if (percent != null && percent > 0) {
    return `Téléchargement interrompu à ${percent} % — appuyez pour reprendre.`;
  }

  return 'Téléchargement interrompu — appuyez pour reprendre.';
}

let progressListener: PluginListenerHandle | null = null;

export async function onDownloadProgress(
  listener: (event: DownloadProgressEvent) => void,
): Promise<void> {
  if (!isNativeAndroid()) {
    return;
  }

  if (progressListener) {
    await progressListener.remove();
    progressListener = null;
  }

  progressListener = await AppUpdate.addListener('downloadProgress', listener);
}

export async function offDownloadProgress(): Promise<void> {
  if (progressListener) {
    await progressListener.remove();
    progressListener = null;
  }
}

export async function installDownloadedUpdate(): Promise<void> {
  if (!isNativeAndroid()) {
    throw new Error('Disponible uniquement sur l’app Android.');
  }

  const allowed = await ensureInstallPermission();
  if (!allowed) {
    throw new Error('Autorisez l’installation d’apps inconnues pour Merlin.');
  }

  await AppUpdate.downloadAndInstall({ url: 'ready', versionCode: 0 });
}

export async function downloadAndInstallUpdate(
  apkUrl: string,
  versionCode: number,
): Promise<void> {
  if (!isNativeAndroid()) {
    throw new Error('Disponible uniquement sur l’app Android.');
  }

  const allowed = await ensureInstallPermission();
  if (!allowed) {
    throw new Error('Autorisez l’installation d’apps inconnues pour Merlin.');
  }

  await AppUpdate.downloadAndInstall({ url: apkUrl, versionCode });
}
