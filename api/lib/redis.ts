import { Redis } from '@upstash/redis';

export function getRedis(): Redis {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error(
      'Missing Redis env vars (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)',
    );
  }

  return new Redis({ url, token });
}

export function syncKvKey(id: string): string {
  return `sync:${id}`;
}

export function agentJobKey(jobId: string): string {
  return `agent:${jobId}`;
}
