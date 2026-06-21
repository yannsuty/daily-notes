import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as Sentry from '@sentry/node';

type ApiHandler = (
  req: VercelRequest,
  res: VercelResponse,
) => Promise<unknown> | unknown;

let initialized = false;

function getDsn(): string | undefined {
  return process.env.SENTRY_DSN?.trim() || process.env.VITE_SENTRY_DSN?.trim();
}

function getRelease(): string {
  const fromEnv = process.env.SENTRY_RELEASE?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version?: string;
    };
    if (pkg.version) {
      return `merlin@${pkg.version}`;
    }
  } catch {
    // ignore
  }

  return 'merlin@unknown';
}

export function isServerSentryEnabled(): boolean {
  return Boolean(getDsn());
}

export function initServerSentry(): void {
  const dsn = getDsn();
  if (!dsn || initialized) {
    return;
  }

  initialized = true;
  Sentry.init({
    dsn,
    release: getRelease(),
    environment: process.env.VERCEL_ENV ?? 'development',
    enableLogs: true,
    tracesSampleRate: 0.1,
  });
}

export function captureApiException(
  error: unknown,
  context?: { route?: string; extra?: Record<string, unknown> },
): void {
  if (!isServerSentryEnabled()) {
    return;
  }

  initServerSentry();
  Sentry.withScope((scope) => {
    scope.setTag('component', 'api');
    scope.setTag('runtime', 'vercel-node');
    if (context?.route) {
      scope.setTag('api.route', context.route);
    }
    if (context?.extra) {
      for (const [key, value] of Object.entries(context.extra)) {
        scope.setExtra(key, value);
      }
    }
    Sentry.captureException(error);
  });
}

export function withSentry(handler: ApiHandler): ApiHandler {
  initServerSentry();

  return async (req, res) => {
    if (!isServerSentryEnabled()) {
      return handler(req, res);
    }

    const route = req.url?.split('?')[0] ?? 'unknown';

    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('component', 'api');
      scope.setTag('runtime', 'vercel-node');
      scope.setTag('api.route', route);

      try {
        return await handler(req, res);
      } catch (error) {
        Sentry.captureException(error);
        if (!res.headersSent) {
          return res.status(500).json({ error: 'Internal server error' });
        }
      } finally {
        await Sentry.flush(2000);
      }
    });
  };
}
