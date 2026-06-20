import * as Sentry from '@sentry/capacitor';
import type { SeverityLevel } from '@sentry/capacitor';
import { isSentryEnabled } from './sentry';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function toSeverity(level: LogLevel): SeverityLevel {
  if (level === 'warn') {
    return 'warning';
  }
  return level;
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  if (typeof err === 'object' && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function writeConsole(level: LogLevel, tag: string, message: string, err?: unknown): void {
  const line = `[${tag}] ${message}`;
  if (level === 'error') {
    console.error(line, err ?? '');
    return;
  }
  if (level === 'warn') {
    console.warn(line, err ?? '');
    return;
  }
  if (level === 'debug') {
    console.debug(line);
    return;
  }
  console.log(line);
}

function reportToSentry(level: LogLevel, tag: string, message: string, err?: unknown): void {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.addBreadcrumb({
    category: tag,
    message,
    level: toSeverity(level),
    data: err != null ? { detail: formatError(err) } : undefined,
  });

  if (level !== 'error' && level !== 'warn') {
    return;
  }

  Sentry.withScope((scope) => {
    scope.setTag('module', tag);
    if (err instanceof Error) {
      scope.setExtra('context', message);
      Sentry.captureException(err);
      return;
    }
    Sentry.captureMessage(message, toSeverity(level));
  });
}

export function log(level: LogLevel, tag: string, message: string, err?: unknown): void {
  writeConsole(level, tag, message, err);
  reportToSentry(level, tag, message, err);
}

export const logger = {
  debug: (tag: string, message: string): void => log('debug', tag, message),
  info: (tag: string, message: string): void => log('info', tag, message),
  warn: (tag: string, message: string, err?: unknown): void => log('warn', tag, message, err),
  error: (tag: string, message: string, err?: unknown): void => log('error', tag, message, err),
};
