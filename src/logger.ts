import { Capacitor, registerPlugin } from '@capacitor/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface MerlinLogPlugin {
  writeLog(options: { level: LogLevel; tag: string; message: string }): Promise<void>;
  readLogs(): Promise<{ content: string }>;
  exportLogs(options: { jsBuffer: string }): Promise<void>;
}

const MerlinLog = registerPlugin<MerlinLogPlugin>('MerlinLog');

const MAX_BUFFER = 300;
const buffer: string[] = [];

function formatEntry(level: LogLevel, tag: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `${timestamp} [${level.toUpperCase()}] ${tag}: ${message}`;
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

function pushBuffer(line: string): void {
  buffer.push(line);
  if (buffer.length > MAX_BUFFER) {
    buffer.shift();
  }
}

export function log(level: LogLevel, tag: string, message: string, err?: unknown): void {
  const extra = err != null ? `\n${formatError(err)}` : '';
  const line = formatEntry(level, tag, message) + extra;
  pushBuffer(line);

  const prefix = `[Merlin] ${line}`;
  if (level === 'error') {
    console.error(prefix);
  } else if (level === 'warn') {
    console.warn(prefix);
  } else {
    console.log(prefix);
  }

  if (Capacitor.isNativePlatform()) {
    void MerlinLog.writeLog({ level, tag, message: message + extra }).catch(() => {});
  }
}

export const logger = {
  debug: (tag: string, message: string): void => log('debug', tag, message),
  info: (tag: string, message: string): void => log('info', tag, message),
  warn: (tag: string, message: string, err?: unknown): void => log('warn', tag, message, err),
  error: (tag: string, message: string, err?: unknown): void => log('error', tag, message, err),
};

export function getRecentLogs(): string {
  return buffer.join('\n');
}

export async function readPersistedLogs(): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    return getRecentLogs();
  }
  try {
    const result = await MerlinLog.readLogs();
    return result.content ?? '';
  } catch {
    return getRecentLogs();
  }
}

export async function exportLogs(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([getRecentLogs()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `merlin-logs-${new Date().toISOString().slice(0, 19)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }
  await MerlinLog.exportLogs({ jsBuffer: getRecentLogs() });
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    logger.error('global', event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logger.error('global', 'Unhandled promise rejection', event.reason);
  });
}
