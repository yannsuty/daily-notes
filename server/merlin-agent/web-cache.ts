import { getRedis, webCacheKey } from '../redis.js';
import { isRedisConfigured } from '../agent-jobs.js';

const memoryCache = new Map<string, { value: string; expiresAt: number }>();

export const WEB_SEARCH_CACHE_TTL_SECONDS = 15 * 60;
export const WEB_PAGE_CACHE_TTL_SECONDS = 20 * 60;

function readMemory(key: string): string | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeMemory(key: string, value: string, ttlSeconds: number): void {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function normalizeWebCacheKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function getWebCache(
  kind: 'search' | 'page' | 'image',
  rawKey: string,
): Promise<string | null> {
  const key = webCacheKey(kind, normalizeWebCacheKey(rawKey));

  if (isRedisConfigured()) {
    try {
      const redis = getRedis();
      const value = await redis.get<string>(key);
      if (typeof value === 'string' && value) return value;
    } catch {
      // secours mémoire ci-dessous
    }
  }

  return readMemory(key);
}

export async function setWebCache(
  kind: 'search' | 'page' | 'image',
  rawKey: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  const key = webCacheKey(kind, normalizeWebCacheKey(rawKey));
  writeMemory(key, value, ttlSeconds);

  if (!isRedisConfigured()) return;

  try {
    const redis = getRedis();
    await redis.set(key, value, { ex: ttlSeconds });
  } catch {
    // le cache mémoire suffit en secours
  }
}
