import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  addAppUpdateBreadcrumb,
  buildAppUpdateContext,
  captureAppUpdateIssue,
  extractPluginErrorContext,
} from './app-update-telemetry';
import { logger } from './logger';

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

export class GitHubApiError extends Error {
  readonly context: ReturnType<typeof buildAppUpdateContext>;

  constructor(message: string, context: ReturnType<typeof buildAppUpdateContext>) {
    super(message);
    this.name = 'GitHubApiError';
    this.context = context;
  }
}

const LATEST_RELEASE_CACHE_MS = 5 * 60_000;
let latestReleaseCache: { expiresAt: number; release: GitHubRelease } | null = null;

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
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'Merlin-Android-App',
  };

  const token = import.meta.env.VITE_GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function downloadHeaders(): HeadersInit {
  return { 'User-Agent': 'Merlin-Android-App' };
}

async function readGitHubErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) {
      return '';
    }
    try {
      const body = JSON.parse(text) as { message?: string; documentation_url?: string };
      return [body.message, body.documentation_url].filter(Boolean).join(' — ');
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return '';
  }
}

function gitHubRateLimitContext(response: Response): Pick<
  ReturnType<typeof buildAppUpdateContext>,
  'rateLimitLimit' | 'rateLimitRemaining' | 'rateLimitReset'
> {
  return {
    rateLimitLimit: response.headers.get('x-ratelimit-limit') ?? undefined,
    rateLimitRemaining: response.headers.get('x-ratelimit-remaining') ?? undefined,
    rateLimitReset: response.headers.get('x-ratelimit-reset') ?? undefined,
  };
}

async function githubFetch(
  url: string,
  accept: string,
  stage: 'github_latest_release' | 'github_version_manifest',
  installed?: { versionCode: number; versionName: string },
): Promise<Response> {
  addAppUpdateBreadcrumb(`GitHub request: ${stage}`, { url });

  let response: Response;
  try {
    response = await fetch(url, { headers: githubHeaders(accept) });
  } catch (error) {
    const context = buildAppUpdateContext(stage, {
      githubUrl: url,
      installedVersionCode: installed?.versionCode,
      installedVersionName: installed?.versionName,
    });
    captureAppUpdateIssue('GitHub fetch réseau impossible', error, context);
    throw new GitHubApiError('Impossible de contacter GitHub.', context);
  }

  if (response.ok) {
    return response;
  }

  const detail = await readGitHubErrorBody(response);
  const context = buildAppUpdateContext(
    response.status === 403 && /rate limit/i.test(detail) ? 'github_rate_limit' : stage,
    {
      githubUrl: url,
      httpStatus: response.status,
      httpStatusText: response.statusText,
      responseBody: detail,
      installedVersionCode: installed?.versionCode,
      installedVersionName: installed?.versionName,
      ...gitHubRateLimitContext(response),
    },
  );

  captureAppUpdateIssue(`GitHub HTTP ${response.status}`, new Error(detail || response.statusText), context);

  if (response.status === 403 && /rate limit/i.test(detail)) {
    throw new GitHubApiError(
      'Limite GitHub atteinte (60 requêtes/h par IP). Réessayez dans une heure.',
      context,
    );
  }

  throw new GitHubApiError(
    `GitHub a répondu ${response.status}${detail ? ` : ${detail}` : '.'}`,
    context,
  );
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
  } catch (error) {
    const context = buildAppUpdateContext('installed_version');
    captureAppUpdateIssue('Lecture version installée impossible', error, context);
    logger.warn('app-update', 'Impossible de lire la version installée', error);
    return null;
  }
}

export async function getInstalledAppVersion(): Promise<string | null> {
  const info = await getInstalledAppInfo();
  return info?.versionName ?? null;
}

async function fetchLatestRelease(
  installed?: { versionCode: number; versionName: string },
): Promise<GitHubRelease> {
  const now = Date.now();
  if (latestReleaseCache && latestReleaseCache.expiresAt > now) {
    return latestReleaseCache.release;
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
  const response = await githubFetch(url, 'application/vnd.github+json', 'github_latest_release', installed);
  const release = (await response.json()) as GitHubRelease;
  latestReleaseCache = { release, expiresAt: now + LATEST_RELEASE_CACHE_MS };
  return release;
}

async function fetchVersionManifest(
  release: GitHubRelease,
  installed?: { versionCode: number; versionName: string },
): Promise<VersionManifest | null> {
  const asset = release.assets.find((item) => item.name === VERSION_ASSET_NAME);
  if (!asset?.browser_download_url) {
    return null;
  }

  const response = await fetch(asset.browser_download_url, {
    headers: downloadHeaders(),
  });

  if (!response.ok) {
    const detail = await readGitHubErrorBody(response);
    const context = buildAppUpdateContext('github_version_manifest', {
      githubUrl: asset.browser_download_url,
      httpStatus: response.status,
      httpStatusText: response.statusText,
      responseBody: detail,
      installedVersionCode: installed?.versionCode,
      installedVersionName: installed?.versionName,
      ...gitHubRateLimitContext(response),
    });
    captureAppUpdateIssue('Lecture app-version.json échouée', new Error(detail), context);
    return null;
  }

  const manifest = (await response.json()) as VersionManifest;
  if (typeof manifest.versionCode !== 'number') {
    const context = buildAppUpdateContext('github_version_manifest', {
      githubUrl: asset.browser_download_url,
      responseBody: JSON.stringify(manifest).slice(0, 500),
      installedVersionCode: installed?.versionCode,
      installedVersionName: installed?.versionName,
    });
    captureAppUpdateIssue('app-version.json invalide', new Error('versionCode manquant'), context);
    return null;
  }

  return manifest;
}

/** Libellé local — sans appel réseau (évite de brûler le quota API GitHub). */
export function resolveInstalledReleaseLabel(
  versionCode: number,
  versionName?: string,
): string {
  if (versionName) {
    return formatReleaseLabel(versionName, versionCode);
  }

  return `build ${versionCode}`;
}

function getApkDownloadUrl(asset: GitHubAsset): string {
  return asset.browser_download_url;
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

  const currentReleaseLabel = resolveInstalledReleaseLabel(
    installed.versionCode,
    installed.versionName,
  );

  addAppUpdateBreadcrumb('Vérification MAJ démarrée', {
    installedVersionCode: installed.versionCode,
    installedVersionName: installed.versionName,
  });

  try {
    const release = await fetchLatestRelease(installed);
    const manifest = await fetchVersionManifest(release, installed);
    const apkAsset = release.assets.find((asset) => asset.name === APK_ASSET_NAME);

    const latestVersion =
      manifest?.tag?.replace(/^v/i, '') ??
      manifest?.versionName ??
      release.tag_name.replace(/^v/i, '');

    if (!apkAsset) {
      const message = `Asset ${APK_ASSET_NAME} introuvable dans la dernière release.`;
      const context = buildAppUpdateContext('check_update', {
        installedVersionCode: installed.versionCode,
        installedVersionName: installed.versionName,
        responseBody: JSON.stringify(release.assets.map((asset) => asset.name)),
      });
      captureAppUpdateIssue(message, new Error(message), context);
      logger.warn('app-update', message);
      return {
        available: false,
        currentVersion: installed.versionName,
        currentVersionCode: installed.versionCode,
        currentReleaseLabel,
        latestVersion,
        error: message,
      };
    }

    const latestVersionCode = manifest?.versionCode;
    const available =
      latestVersionCode != null
        ? latestVersionCode > installed.versionCode
        : compareVersions(latestVersion, installed.versionName) > 0;

    addAppUpdateBreadcrumb('Vérification MAJ terminée', {
      available,
      latestVersion,
      latestVersionCode,
    });

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
    const context = buildAppUpdateContext('check_update', {
      installedVersionCode: installed.versionCode,
      installedVersionName: installed.versionName,
      ...(error instanceof GitHubApiError ? error.context : {}),
    });
    if (!(error instanceof GitHubApiError)) {
      captureAppUpdateIssue('Vérification GitHub échouée', error, context);
    }
    logger.error('app-update', 'Vérification GitHub échouée', error);
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
  if (!result.allowed) {
    const context = buildAppUpdateContext('apk_permission');
    captureAppUpdateIssue('Permission installation refusée', new Error('INSTALL_PERMISSION_REQUIRED'), context);
  }
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

function reportDownloadFailure(
  error: unknown,
  apkUrl: string,
  versionCode: number,
  installed?: { versionCode: number; versionName: string } | null,
): void {
  const pluginContext = extractPluginErrorContext(error);
  const context = buildAppUpdateContext('apk_download', {
    downloadUrlHost: apkUrl,
    targetVersionCode: versionCode,
    installedVersionCode: installed?.versionCode,
    installedVersionName: installed?.versionName,
    downloadedBytes:
      typeof pluginContext.downloadedBytes === 'number'
        ? pluginContext.downloadedBytes
        : undefined,
    totalBytes:
      typeof pluginContext.totalBytes === 'number' ? pluginContext.totalBytes : undefined,
    attempt: typeof pluginContext.attempt === 'number' ? pluginContext.attempt : undefined,
    httpStatus:
      typeof pluginContext.httpStatus === 'number' ? pluginContext.httpStatus : undefined,
    pluginCode: typeof pluginContext.pluginCode === 'string' ? pluginContext.pluginCode : undefined,
    pluginMessage:
      typeof pluginContext.pluginMessage === 'string' ? pluginContext.pluginMessage : undefined,
  });
  captureAppUpdateIssue('Téléchargement ou installation APK échoué', error, context);
  logger.error('app-update', 'Téléchargement ou installation APK échoué', error);
}

export async function installDownloadedUpdate(): Promise<void> {
  if (!isNativeAndroid()) {
    throw new Error('Disponible uniquement sur l’app Android.');
  }

  const allowed = await ensureInstallPermission();
  if (!allowed) {
    throw new Error('Autorisez l’installation d’apps inconnues pour Merlin.');
  }

  try {
    addAppUpdateBreadcrumb('Installation APK prête');
    await AppUpdate.downloadAndInstall({ url: 'ready', versionCode: 0 });
  } catch (error) {
    const context = buildAppUpdateContext('apk_install', extractPluginErrorContext(error));
    captureAppUpdateIssue('Installation APK prête échouée', error, context);
    logger.error('app-update', 'Installation APK prête échouée', error);
    throw error;
  }
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

  const installed = await getInstalledAppInfo();
  addAppUpdateBreadcrumb('Téléchargement APK démarré', {
    targetVersionCode: versionCode,
    downloadUrlHost: apkUrl,
  });

  try {
    await AppUpdate.downloadAndInstall({ url: apkUrl, versionCode });
    addAppUpdateBreadcrumb('Téléchargement APK terminé', { targetVersionCode: versionCode });
  } catch (error) {
    reportDownloadFailure(error, apkUrl, versionCode, installed);
    throw error;
  }
}
