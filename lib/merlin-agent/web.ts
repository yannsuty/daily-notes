export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '[::1]']);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return false;
  }
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

/** Bloque les URLs locales / privées (SSRF). */
export function isPublicHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || BLOCKED_HOSTNAMES.has(host)) return false;
    if (host === '127.0.0.1' || host.endsWith('.local')) return false;
    if (isPrivateIpv4(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export function clampWebResultCount(raw: string | undefined, fallback = 5): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(8, Math.max(1, n));
}

export function formatWebSearchResults(query: string, hits: WebSearchHit[]): string {
  if (hits.length === 0) {
    return `Aucun résultat web pour « ${query} ».`;
  }

  const lines = hits.map(
    (hit, index) =>
      `${index + 1}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet.trim() || '(pas de résumé)'}`,
  );

  return `${hits.length} résultat(s) pour « ${query} » :\n\n${lines.join('\n\n')}`;
}

/** Extrait du texte lisible depuis du HTML (sans dépendance externe). */
export function htmlToPlainText(html: string, maxChars = 12_000): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  text = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (text.length > maxChars) {
    return `${text.slice(0, maxChars)}…`;
  }
  return text;
}
