export function scheduleBackground(task: () => Promise<void>): void {
  const promise = task().catch((err) => {
    console.error('[merlin-agent] background task failed', err);
  });

  try {
    const sym = Symbol.for('@vercel/request-context');
    const store = (globalThis as Record<symbol, unknown>)[sym] as
      | { get?: () => { waitUntil?: (p: Promise<unknown>) => void } }
      | undefined;
    const ctx = store?.get?.();
    if (ctx?.waitUntil) {
      ctx.waitUntil(promise);
      return;
    }
  } catch {
    // ignore
  }

  void promise;
}
