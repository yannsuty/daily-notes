import { Sentry, isSentryEnabled } from './sentry';

export type AppUpdateStage =
  | 'check_update'
  | 'github_latest_release'
  | 'github_version_manifest'
  | 'github_rate_limit'
  | 'apk_download'
  | 'apk_install'
  | 'apk_permission'
  | 'installed_version';

export interface AppUpdateTelemetryContext extends Record<string, unknown> {
  stage: AppUpdateStage;
  online?: boolean;
  installedVersionCode?: number;
  installedVersionName?: string;
  targetVersionCode?: number;
  githubUrl?: string;
  httpStatus?: number;
  httpStatusText?: string;
  responseBody?: string;
  rateLimitRemaining?: string;
  rateLimitReset?: string;
  rateLimitLimit?: string;
  downloadUrlHost?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  attempt?: number;
  pluginCode?: string;
  pluginMessage?: string;
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

export function buildAppUpdateContext(
  stage: AppUpdateStage,
  extra: Omit<AppUpdateTelemetryContext, 'stage' | 'online'> = {},
): AppUpdateTelemetryContext {
  const context: AppUpdateTelemetryContext = {
    stage,
    online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
    ...extra,
  };

  if (typeof extra.githubUrl === 'string') {
    context.githubUrl = sanitizeUrl(extra.githubUrl);
  }
  if (typeof extra.downloadUrlHost === 'string') {
    context.downloadUrlHost = sanitizeUrl(extra.downloadUrlHost);
  }

  return context;
}

export function captureAppUpdateIssue(
  message: string,
  error: unknown,
  context: AppUpdateTelemetryContext,
): void {
  if (!isSentryEnabled()) {
    console.error('[app-update]', message, context, error);
    return;
  }

  Sentry.addBreadcrumb({
    category: 'app-update',
    message,
    level: 'error',
    data: context,
  });

  Sentry.withScope((scope) => {
    scope.setTag('feature', 'app-update');
    scope.setTag('app_update.stage', context.stage);
    scope.setContext('app_update', context);
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) {
        scope.setExtra(key, value);
      }
    }
    if (error instanceof Error) {
      Sentry.captureException(error);
      return;
    }
    Sentry.captureMessage(message, 'error');
  });
}

export function addAppUpdateBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.addBreadcrumb({
    category: 'app-update',
    message,
    level: 'info',
    data,
  });
}

export function extractPluginErrorContext(error: unknown): Record<string, unknown> {
  if (typeof error !== 'object' || error === null) {
    return {};
  }

  const record = error as Record<string, unknown>;
  const data =
    typeof record.data === 'object' && record.data !== null
      ? (record.data as Record<string, unknown>)
      : {};

  return {
    pluginMessage: record.message,
    pluginCode: record.code,
    ...data,
  };
}
