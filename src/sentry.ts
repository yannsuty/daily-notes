import * as Sentry from '@sentry/capacitor';
import { APP_VERSION } from './version';

const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();

export function isSentryEnabled(): boolean {
  return Boolean(dsn);
}

export function initSentry(): void {
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    release: `merlin@${APP_VERSION}`,
    environment: import.meta.env.PROD ? 'production' : 'development',
    enableLogs: true,
    enableNative: true,
    enableNativeCrashHandling: true,
    attachThreads: true,
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
  });
}

export { Sentry };
