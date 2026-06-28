import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callMegaserveurChat,
  isMegaserveurConfigured,
  resolveMegaserveurModel,
} from './megaserveur-ai.js';
import { OPENROUTER_FREE_ROUTER } from './openrouter-fallback.js';
import { callLlmCompletion } from './llm-completion.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('resolveMegaserveurModel', () => {
  it('remplace openrouter/free par le modèle Ollama par défaut', () => {
    expect(resolveMegaserveurModel(OPENROUTER_FREE_ROUTER)).toBe('qwen2.5-coder:7b');
    expect(resolveMegaserveurModel('')).toBe('qwen2.5-coder:7b');
  });

  it('respecte MEGASERVEUR_DEFAULT_MODEL', () => {
    process.env.MEGASERVEUR_DEFAULT_MODEL = 'tinyllama';
    expect(resolveMegaserveurModel(undefined)).toBe('tinyllama');
  });

  it('conserve un modèle explicite', () => {
    expect(resolveMegaserveurModel('llama3.1:8b')).toBe('llama3.1:8b');
  });
});

describe('isMegaserveurConfigured', () => {
  it('est vrai si base URL et clé sont définies', () => {
    process.env.MEGASERVEUR_AI_BASE_URL = 'https://api.example.fr/api/ai';
    process.env.MEGASERVEUR_AI_API_KEY = 'secret';
    expect(isMegaserveurConfigured()).toBe(true);
  });

  it('est faux si une variable manque', () => {
    process.env.MEGASERVEUR_AI_BASE_URL = 'https://api.example.fr/api/ai';
    delete process.env.MEGASERVEUR_AI_API_KEY;
    expect(isMegaserveurConfigured()).toBe(false);
  });
});

describe('callMegaserveurChat', () => {
  it('appelle /chat/completions avec Bearer', async () => {
    process.env.MEGASERVEUR_AI_BASE_URL = 'https://api.example.fr/api/ai/';
    process.env.MEGASERVEUR_AI_API_KEY = 'test-key';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Bonjour' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callMegaserveurChat({
      model: OPENROUTER_FREE_ROUTER,
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(result.ok).toBe(true);
    expect(result.modelUsed).toBe('qwen2.5-coder:7b');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.fr/api/ai/chat/completions');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-key',
    });
    const body = JSON.parse(init.body as string) as { model: string; stream: boolean };
    expect(body.model).toBe('qwen2.5-coder:7b');
    expect(body.stream).toBe(false);
  });
});

describe('callLlmCompletion', () => {
  it('utilise Megaserveur sans clé OpenRouter', async () => {
    process.env.MEGASERVEUR_AI_BASE_URL = 'https://api.example.fr/api/ai';
    process.env.MEGASERVEUR_AI_API_KEY = 'test-key';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callLlmCompletion(
      {
        model: OPENROUTER_FREE_ROUTER,
        messages: [{ role: 'user', content: 'hi' }],
      },
      { referer: 'http://localhost' },
    );

    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('/chat/completions');
  });
});
