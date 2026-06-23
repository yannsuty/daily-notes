import {
  clampWebResultCount,
  formatWebSearchResults,
  htmlToPlainText,
  isPublicHttpUrl,
  type WebSearchHit,
} from '../../../lib/merlin-agent/web.js';
import type { AgentClientConfig, ToolResult } from '../../../lib/merlin-agent/types.js';

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';
const FETCH_TIMEOUT_MS = 12_000;
const SEARCH_TIMEOUT_MS = 10_000;

function resolveBraveApiKey(config: AgentClientConfig): string | undefined {
  return config.braveSearchApiKey?.trim() || process.env.BRAVE_SEARCH_API_KEY?.trim() || undefined;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function runWebSearch(
  args: Record<string, string>,
  config: AgentClientConfig,
): Promise<ToolResult> {
  const query = (args.query ?? '').trim();
  if (!query) {
    return { ok: false, content: 'Requête de recherche vide.' };
  }

  const apiKey = resolveBraveApiKey(config);
  if (!apiKey) {
    return {
      ok: false,
      content:
        'Recherche web indisponible : configurez BRAVE_SEARCH_API_KEY sur le serveur (ou dans Réglages Merlin).',
    };
  }

  const count = clampWebResultCount(args.max_results ?? args.count);
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    text_decorations: 'false',
    search_lang: 'fr',
  });

  try {
    const response = await fetchWithTimeout(
      `${BRAVE_SEARCH_URL}?${params}`,
      {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
      },
      SEARCH_TIMEOUT_MS,
    );

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      return {
        ok: false,
        content: `Recherche web échouée (HTTP ${response.status})${detail ? ` : ${detail}` : ''}.`,
      };
    }

    const payload = (await response.json()) as {
      web?: { results?: { title?: string; url?: string; description?: string }[] };
    };

    const hits: WebSearchHit[] = (payload.web?.results ?? [])
      .slice(0, count)
      .map((item) => ({
        title: item.title?.trim() || '(sans titre)',
        url: item.url?.trim() || '',
        snippet: item.description?.trim() || '',
      }))
      .filter((item) => item.url);

    return { ok: true, content: formatWebSearchResults(query, hits) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur réseau';
    return { ok: false, content: `Recherche web impossible : ${message}.` };
  }
}

export async function runFetchPage(args: Record<string, string>): Promise<ToolResult> {
  const url = (args.url ?? '').trim();
  if (!url) {
    return { ok: false, content: 'URL manquante.' };
  }
  if (!isPublicHttpUrl(url)) {
    return { ok: false, content: 'URL non autorisée (seuls http/https publics sont acceptés).' };
  }

  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          'User-Agent': 'Merlin/1.0 (+https://merlin.app; assistant personnel)',
        },
        redirect: 'follow',
      },
      FETCH_TIMEOUT_MS,
    );

    if (!response.ok) {
      return { ok: false, content: `Impossible de lire la page (HTTP ${response.status}).` };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const raw = await response.text();
    const text = contentType.includes('html') ? htmlToPlainText(raw) : raw.trim();

    if (!text) {
      return { ok: true, content: `Page lue mais sans contenu textuel exploitable : ${url}` };
    }

    return {
      ok: true,
      content: `Contenu de ${url} :\n\n${text}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur réseau';
    return { ok: false, content: `Lecture de page impossible : ${message}.` };
  }
}

export async function runWebTool(
  name: string,
  args: Record<string, string>,
  config: AgentClientConfig,
): Promise<ToolResult> {
  if (name === 'web_search') return runWebSearch(args, config);
  if (name === 'fetch_page') return runFetchPage(args);
  return { ok: false, content: `Outil web inconnu : ${name}` };
}
