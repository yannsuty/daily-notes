import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import {
  callOpenRouterWithFallback,
  OPENROUTER_FREE_ROUTER,
  type OpenRouterBody,
} from './lib/openrouter-fallback';

const appVersion = (JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }).version;

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

interface AiProxyBody extends OpenRouterBody {
  config?: { apiKey?: string; modelChain?: string };
}

interface AgentProxyBody {
  message: string;
  context: import('./lib/merlin-agent/types').AgentContext;
  stream?: boolean;
  background?: boolean;
  jobId?: string;
  config?: { apiKey?: string; modelChain?: string; model?: string; braveSearchApiKey?: string; tavilyApiKey?: string };
}

function writeSse(res: ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function streamAgentJobDev(
  req: IncomingMessage,
  res: ServerResponse,
  jobId: string,
  fromStep: number,
  getAgentJob: (id: string) => Promise<import('./lib/merlin-agent/types').AgentJobRecord | null>,
): Promise<void> {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const started = Date.now();
  let seen = fromStep;

  while (Date.now() - started < 55_000) {
    if (req.socket?.destroyed) {
      return;
    }

    const job = await getAgentJob(jobId);
    if (!job) {
      writeSse(res, 'error', { error: 'Job not found' });
      res.end();
      return;
    }

    for (let i = seen; i < job.steps.length; i += 1) {
      writeSse(res, 'step', { step: job.steps[i] });
    }
    seen = job.steps.length;

    if (job.status === 'done' && job.result) {
      writeSse(res, 'done', { result: job.result });
      res.end();
      return;
    }

    if (job.status === 'error') {
      writeSse(res, 'error', {
        error: job.error ?? 'Erreur agent',
        steps: job.steps,
      });
      res.end();
      return;
    }

    await sleep(400);
  }

  writeSse(res, 'reconnect', { fromStep: seen });
  res.end();
}

function createMerlinWebDevProxy() {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/merlin-web')) {
      next();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      next();
      return;
    }

    try {
      const { runWebTool } = await import('./server/merlin-agent/web-tools');
      const { isWebTool } = await import('./lib/merlin-agent/primitive-tools');
      const rawBody = await readRequestBody(req);
      const parsed = JSON.parse(rawBody) as {
        tool?: string;
        args?: Record<string, string>;
        config?: {
          braveSearchApiKey?: string;
          tavilyApiKey?: string;
        };
      };

      const tool = parsed.tool?.trim() ?? '';
      if (!isWebTool(tool)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, content: 'Outil web invalide' }));
        return;
      }

      const result = await runWebTool(tool, parsed.args ?? {}, {
        braveSearchApiKey:
          parsed.config?.braveSearchApiKey?.trim() || process.env.BRAVE_SEARCH_API_KEY,
        tavilyApiKey: parsed.config?.tavilyApiKey?.trim() || process.env.TAVILY_API_KEY,
      });

      res.statusCode = result.ok ? 200 : 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      const message = err instanceof Error ? err.message : 'Proxy error';
      res.end(JSON.stringify({ ok: false, content: message }));
    }
  };
}

function createMerlinAgentDevProxy(fallbackApiKey: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/merlin-agent')) {
      next();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      const {
        appendAgentJobStep,
        createJobId,
        failAgentJob,
        finishAgentJob,
        getAgentJob,
        saveAgentJob,
      } = await import('./server/agent-jobs');
      const { runMerlinAgent } = await import('./server/merlin-agent/runner');
      const { scheduleBackground } = await import('./server/wait-until');

      if (req.method === 'GET') {
        const parsedUrl = new URL(url, 'http://localhost');
        const jobId = parsedUrl.searchParams.get('jobId');
        if (!jobId) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing jobId' }));
          return;
        }

        const streamParam = parsedUrl.searchParams.get('stream');
        const stream = streamParam === '1' || streamParam === 'true' || streamParam === 'sse';
        const fromStep = Math.max(
          0,
          Number.parseInt(parsedUrl.searchParams.get('fromStep') ?? '0', 10) || 0,
        );

        if (stream) {
          await streamAgentJobDev(req, res, jobId, fromStep, getAgentJob);
          return;
        }

        const job = await getAgentJob(jobId);
        if (!job) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Job not found' }));
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            jobId,
            status: job.status,
            steps: job.steps,
            result: job.result,
            error: job.error,
          }),
        );
        return;
      }

      if (req.method !== 'POST') {
        next();
        return;
      }

      const rawBody = await readRequestBody(req);
      const parsed = JSON.parse(rawBody) as AgentProxyBody;
      const config = {
        apiKey: parsed.config?.apiKey?.trim() || fallbackApiKey,
        modelChain: parsed.config?.modelChain?.trim() || process.env.OPENROUTER_MODEL_CHAIN,
        model: parsed.config?.model,
        braveSearchApiKey:
          parsed.config?.braveSearchApiKey?.trim() || process.env.BRAVE_SEARCH_API_KEY,
        tavilyApiKey: parsed.config?.tavilyApiKey?.trim() || process.env.TAVILY_API_KEY,
      };

      if (parsed.background) {
        const jobId = parsed.jobId?.trim() || createJobId();
        await saveAgentJob(jobId, { status: 'pending', steps: [], updatedAt: Date.now() });
        scheduleBackground(async () => {
          try {
            await saveAgentJob(jobId, { status: 'running', steps: [], updatedAt: Date.now() });
            const result = await runMerlinAgent(parsed.message, parsed.context, config, {
              referer: 'http://localhost:5173',
              onStep: (step) => {
                void appendAgentJobStep(jobId, step);
              },
            });
            await finishAgentJob(jobId, result);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Agent error';
            await failAgentJob(jobId, message);
          }
        });
        res.statusCode = 202;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ jobId, status: 'pending' }));
        return;
      }

      if (parsed.stream) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        const result = await runMerlinAgent(parsed.message, parsed.context, config, {
          referer: 'http://localhost:5173',
          onStep: (step) => {
            res.write(`${JSON.stringify({ type: 'step', step })}\n`);
          },
        });
        res.write(`${JSON.stringify({ type: 'done', result })}\n`);
        res.end();
        return;
      }

      const result = await runMerlinAgent(parsed.message, parsed.context, config, {
        referer: 'http://localhost:5173',
      });
      res.statusCode = result.ok ? 200 : 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      const message = err instanceof Error ? err.message : 'Agent proxy error';
      res.end(JSON.stringify({ ok: false, error: message, steps: [], mutations: {} }));
    }
  };
}

function createOpenRouterDevProxy(fallbackApiKey: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    if (!req.url?.startsWith('/api/ai')) {
      next();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      next();
      return;
    }

    if (!fallbackApiKey) {
      // Pas de clé .env — l'app peut en fournir une via Réglages (body.config.apiKey)
    }

    try {
      const rawBody = await readRequestBody(req);
      const parsed = JSON.parse(rawBody) as AiProxyBody;
      const apiKey = parsed.config?.apiKey?.trim() || fallbackApiKey;

      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'OPENROUTER_API_KEY non configurée (.env ou Réglages Merlin)',
            retryable: false,
          }),
        );
        return;
      }

      const envChain =
        parsed.config?.modelChain?.trim() || process.env.OPENROUTER_MODEL_CHAIN;

      const result = await callOpenRouterWithFallback(
        apiKey,
        {
          model: parsed.model || OPENROUTER_FREE_ROUTER,
          messages: parsed.messages,
          temperature: parsed.temperature,
          response_format: parsed.response_format,
        },
        {
          referer: 'http://localhost:5173',
          envChain,
        },
      );

      if (result.ok && result.modelUsed) {
        res.setHeader('X-Merlin-Model-Used', result.modelUsed);
      }

      res.statusCode = result.status;
      res.setHeader('Content-Type', 'application/json');
      if (!result.ok) {
        let detail = result.payload.slice(0, 300);
        try {
          const errParsed = JSON.parse(result.payload) as { error?: { message?: string } };
          if (errParsed.error?.message) detail = errParsed.error.message;
        } catch {
          // keep raw
        }
        res.end(
          JSON.stringify({
            error: { message: detail },
            triedModels: result.triedModels,
            retryable: result.retryable ?? false,
          }),
        );
        return;
      }

      res.end(result.payload);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      const message = err instanceof Error ? err.message : 'Proxy error';
      res.end(JSON.stringify({ error: message }));
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isCapacitor = process.env.CAPACITOR === 'true';

  return {
    base: isCapacitor ? './' : '/',
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [
      {
        name: 'openrouter-dev-proxy',
        configureServer(server) {
          const aiProxy = createOpenRouterDevProxy(env.OPENROUTER_API_KEY ?? '');
          const agentProxy = createMerlinAgentDevProxy(env.OPENROUTER_API_KEY ?? '');
          const webProxy = createMerlinWebDevProxy();
          server.middlewares.use((req, res, next) => {
            void webProxy(req, res, () => {
              void agentProxy(req, res, () => {
                void aiProxy(req, res, next);
              });
            });
          });
        },
      },
      ...(isCapacitor
        ? []
        : [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
              manifest: {
                name: 'Merlin',
                short_name: 'Merlin',
                description: 'Assistant personnel — local-first',
                theme_color: '#1a1a1a',
                background_color: '#1a1a1a',
                display: 'standalone',
                start_url: '/',
                lang: 'fr',
                icons: [
                  {
                    src: 'icons/icon-192.png',
                    sizes: '192x192',
                    type: 'image/png',
                  },
                  {
                    src: 'icons/icon-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                  },
                  {
                    src: 'icons/icon-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
              },
              workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
                runtimeCaching: [
                  {
                    urlPattern: /^https:\/\/.*\/api\/sync/,
                    handler: 'NetworkFirst',
                    options: {
                      cacheName: 'sync-api',
                      networkTimeoutSeconds: 5,
                    },
                  },
                ],
              },
            }),
          ]),
    ],
  };
});
