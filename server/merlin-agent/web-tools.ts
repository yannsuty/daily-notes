import {
  clampWebResultCount,
  formatWebSearchResults,
  hitsToWebSources,
  htmlToPlainText,
  isPublicHttpUrl,
  pageWebSource,
  type WebSearchHit,
  type WebSearchProvider,
} from '../../lib/merlin-agent/web.js';
import { fetchPageBlockedHint } from '../../lib/merlin-agent/fetch-page-log.js';
import type { AgentClientConfig, ToolResult } from '../../lib/merlin-agent/types.js';
import {
  getWebCache,
  setWebCache,
  WEB_PAGE_CACHE_TTL_SECONDS,
  WEB_SEARCH_CACHE_TTL_SECONDS,
} from './web-cache.js';

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';
const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const FETCH_TIMEOUT_MS = 12_000;
const SEARCH_TIMEOUT_MS = 10_000;

interface CachedWebPayload {
  content: string;
  webSources?: ToolResult['webSources'];
  provider?: WebSearchProvider;
}

function resolveBraveApiKey(config: AgentClientConfig): string | undefined {
  return config.braveSearchApiKey?.trim() || process.env.BRAVE_SEARCH_API_KEY?.trim() || undefined;
}

function resolveTavilyApiKey(config: AgentClientConfig): string | undefined {
  return config.tavilyApiKey?.trim() || process.env.TAVILY_API_KEY?.trim() || undefined;
}

function resolveCustomScraperUrl(): string | undefined {
  return process.env.WEB_SEARCH_SCRAPER_URL?.trim() || undefined;
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

function buildSearchCacheKey(query: string, count: number): string {
  return `${query}::${count}`;
}

async function readSearchCache(query: string, count: number): Promise<ToolResult | null> {
  const raw = await getWebCache('search', buildSearchCacheKey(query, count));
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as CachedWebPayload;
    if (!payload.content) return null;
    return {
      ok: true,
      content: payload.content,
      webSources: payload.webSources,
    };
  } catch {
    return null;
  }
}

async function writeSearchCache(
  query: string,
  count: number,
  result: ToolResult,
  provider: WebSearchProvider,
): Promise<void> {
  const payload: CachedWebPayload = {
    content: result.content,
    webSources: result.webSources,
    provider,
  };
  await setWebCache(
    'search',
    buildSearchCacheKey(query, count),
    JSON.stringify(payload),
    WEB_SEARCH_CACHE_TTL_SECONDS,
  );
}

async function searchBrave(query: string, count: number, apiKey: string): Promise<ToolResult | null> {
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    text_decorations: 'false',
    search_lang: 'fr',
  });

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

  if (!response.ok) return null;

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

  return {
    ok: true,
    content: formatWebSearchResults(query, hits),
    webSources: hitsToWebSources(hits),
  };
}

async function searchTavily(query: string, count: number, apiKey: string): Promise<ToolResult | null> {
  const response = await fetchWithTimeout(
    TAVILY_SEARCH_URL,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: count,
        search_depth: 'basic',
        include_answer: false,
      }),
    },
    SEARCH_TIMEOUT_MS,
  );

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };

  const hits: WebSearchHit[] = (payload.results ?? [])
    .slice(0, count)
    .map((item) => ({
      title: item.title?.trim() || '(sans titre)',
      url: item.url?.trim() || '',
      snippet: item.content?.trim() || '',
    }))
    .filter((item) => item.url);

  return {
    ok: true,
    content: formatWebSearchResults(query, hits),
    webSources: hitsToWebSources(hits),
  };
}

async function searchCustomScraper(query: string, count: number, endpoint: string): Promise<ToolResult | null> {
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, max_results: count }),
    },
    SEARCH_TIMEOUT_MS,
  );

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    results?: { title?: string; url?: string; snippet?: string; description?: string }[];
  };

  const hits: WebSearchHit[] = (payload.results ?? [])
    .slice(0, count)
    .map((item) => ({
      title: item.title?.trim() || '(sans titre)',
      url: item.url?.trim() || '',
      snippet: (item.snippet ?? item.description ?? '').trim(),
    }))
    .filter((item) => item.url);

  if (hits.length === 0) return null;

  return {
    ok: true,
    content: formatWebSearchResults(query, hits),
    webSources: hitsToWebSources(hits),
  };
}

export async function runWebSearch(
  args: Record<string, string>,
  config: AgentClientConfig,
): Promise<ToolResult> {
  const query = (args.query ?? '').trim();
  if (!query) {
    return { ok: false, content: 'Requête de recherche vide.' };
  }

  const count = clampWebResultCount(args.max_results ?? args.count);

  const cached = await readSearchCache(query, count);
  if (cached) return cached;

  const braveKey = resolveBraveApiKey(config);
  const tavilyKey = resolveTavilyApiKey(config);
  const scraperUrl = resolveCustomScraperUrl();

  if (!braveKey && !tavilyKey && !scraperUrl) {
    return {
      ok: false,
      content:
        'Recherche web indisponible : configurez BRAVE_SEARCH_API_KEY, TAVILY_API_KEY ou WEB_SEARCH_SCRAPER_URL.',
    };
  }

  const errors: string[] = [];

  if (braveKey) {
    try {
      const result = await searchBrave(query, count, braveKey);
      if (result) {
        await writeSearchCache(query, count, result, 'brave');
        return result;
      }
      errors.push('Brave Search indisponible');
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Brave Search en erreur');
    }
  }

  if (tavilyKey) {
    try {
      const result = await searchTavily(query, count, tavilyKey);
      if (result) {
        await writeSearchCache(query, count, result, 'tavily');
        return result;
      }
      errors.push('Tavily indisponible');
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Tavily en erreur');
    }
  }

  if (scraperUrl) {
    try {
      const result = await searchCustomScraper(query, count, scraperUrl);
      if (result) {
        await writeSearchCache(query, count, result, 'custom');
        return result;
      }
      errors.push('Scraper personnalisé sans résultat');
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Scraper personnalisé en erreur');
    }
  }

  return {
    ok: false,
    content: `Recherche web impossible pour « ${query} » (${errors.join(' ; ') || 'aucun fournisseur'}).`,
  };
}

type FetchPageErrorCode =
  | 'missing_url'
  | 'invalid_url'
  | 'http_error'
  | 'empty_content'
  | 'timeout'
  | 'network';

function fetchPageResult(
  ok: boolean,
  content: string,
  devMeta: Record<string, unknown>,
  extra?: Pick<ToolResult, 'webSources'>,
): ToolResult {
  return { ok, content, devMeta, ...extra };
}

export async function runFetchPage(args: Record<string, string>): Promise<ToolResult> {
  const url = (args.url ?? '').trim();
  const startedAt = Date.now();
  if (!url) {
    return fetchPageResult(false, 'URL manquante.', {
      errorCode: 'missing_url' satisfies FetchPageErrorCode,
    });
  }
  if (!isPublicHttpUrl(url)) {
    return fetchPageResult(false, 'URL non autorisée (seuls http/https publics sont acceptés).', {
      url,
      errorCode: 'invalid_url' satisfies FetchPageErrorCode,
    });
  }

  const cached = await getWebCache('page', url);
  if (cached) {
    try {
      const payload = JSON.parse(cached) as CachedWebPayload;
      if (payload.content) {
        return fetchPageResult(
          true,
          payload.content,
          {
            url,
            fromCache: true,
            durationMs: Date.now() - startedAt,
            contentLength: payload.content.length,
          },
          { webSources: payload.webSources ?? [pageWebSource(url)] },
        );
      }
    } catch {
      // relire la page
    }
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

    const finalUrl = response.url || url;
    const contentType = response.headers.get('content-type') ?? '';
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      const blockedHint = fetchPageBlockedHint(response.status);
      const hintSuffix = blockedHint ? ` — ${blockedHint}` : '';
      return fetchPageResult(
        false,
        `Impossible de lire la page (HTTP ${response.status})${hintSuffix}`,
        {
          url,
          finalUrl: finalUrl !== url ? finalUrl : undefined,
          httpStatus: response.status,
          httpStatusText: response.statusText || undefined,
          contentType: contentType || undefined,
          fromCache: false,
          durationMs,
          errorCode: 'http_error' satisfies FetchPageErrorCode,
          blockedHint,
        },
      );
    }

    const raw = await response.text();
    const text = contentType.includes('html') ? htmlToPlainText(raw) : raw.trim();
    const titleMatch = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch?.[1]?.trim();

    if (!text) {
      return fetchPageResult(
        true,
        `Page lue mais sans contenu textuel exploitable : ${url}`,
        {
          url,
          finalUrl: finalUrl !== url ? finalUrl : undefined,
          httpStatus: response.status,
          contentType: contentType || undefined,
          pageTitle,
          textLength: 0,
          rawLength: raw.length,
          fromCache: false,
          durationMs,
          errorCode: 'empty_content' satisfies FetchPageErrorCode,
        },
        { webSources: [pageWebSource(url, pageTitle)] },
      );
    }

    const content = `Contenu de ${url} :\n\n${text}`;
    const result = fetchPageResult(
      true,
      content,
      {
        url,
        finalUrl: finalUrl !== url ? finalUrl : undefined,
        httpStatus: response.status,
        contentType: contentType || undefined,
        pageTitle,
        textLength: text.length,
        rawLength: raw.length,
        fromCache: false,
        durationMs,
      },
      { webSources: [pageWebSource(url, pageTitle)] },
    );

    const payload: CachedWebPayload = {
      content: result.content,
      webSources: result.webSources,
    };
    await setWebCache('page', url, JSON.stringify(payload), WEB_PAGE_CACHE_TTL_SECONDS);

    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const message = err instanceof Error ? err.message : 'Erreur réseau';
    return fetchPageResult(
      false,
      isTimeout
        ? `Lecture de page impossible : délai dépassé (${FETCH_TIMEOUT_MS / 1000}s).`
        : `Lecture de page impossible : ${message}.`,
      {
        url,
        fromCache: false,
        durationMs,
        errorCode: (isTimeout ? 'timeout' : 'network') satisfies FetchPageErrorCode,
        errorMessage: message,
      },
    );
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
