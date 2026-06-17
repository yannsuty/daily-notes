import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const appVersion = (JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }).version;

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function createOpenRouterDevProxy(apiKey: string) {
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

    if (!apiKey) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured in .env' }));
      return;
    }

    try {
      const rawBody = await readRequestBody(req);
      const parsed = JSON.parse(rawBody) as { model?: string };
      const freeRouter = 'openrouter/free';

      const call = (body: string) =>
        fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:5173',
            'X-Title': 'Merlin',
          },
          body,
        });

      let upstream = await call(rawBody);
      if (upstream.status === 404 && parsed.model && parsed.model !== freeRouter) {
        parsed.model = freeRouter;
        upstream = await call(JSON.stringify(parsed));
      }

      const payload = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(payload);
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
          const proxy = createOpenRouterDevProxy(env.OPENROUTER_API_KEY ?? '');
          server.middlewares.use((req, res, next) => {
            void proxy(req, res, next);
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
