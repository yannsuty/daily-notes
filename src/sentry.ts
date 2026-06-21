import { Capacitor } from '@capacitor/core';
import * as Sentry from '@sentry/capacitor';
import { APP_VERSION } from './version';

const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/** Sentry n'est actif que dans l'APK Android (pas sur la PWA web). */
export function isSentryEnabled(): boolean {
  return Boolean(dsn) && isNativeAndroid();
}

export function initSentry(): void {
  if (!isSentryEnabled()) {
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
  Sentry.setTag('component', 'android');
}

export { Sentry };
