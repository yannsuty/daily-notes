import { chatCompletion, type ChatMessage } from './ai-provider';
import { updateMerlinMessageContent } from './db';

const DEFERRED_RETRY_DELAYS_MS = [8000, 15000, 30000];
const OFFLINE_WAIT_MS = 15_000;

type AgentSideEffect = 'list_updated' | 'reminder_created' | 'reminder_completed';

export interface DeferredReplyInfo {
  userText: string;
  reply: string;
  sideEffects?: AgentSideEffect;
}

type DeferredHandler = (info: DeferredReplyInfo) => void;

export interface DeferredReplyJob {
  userText: string;
  messages: ChatMessage[];
  placeholderId: string;
  processReply: (
    rawText: string,
    messages: ChatMessage[],
  ) => Promise<{ reply: string; sideEffects?: AgentSideEffect }>;
}

let onReady: DeferredHandler | null = null;
const queue: DeferredReplyJob[] = [];
let processing = false;

export function setDeferredReplyHandler(handler: DeferredHandler | null): void {
  onReady = handler;
}

export function scheduleDeferredReply(job: DeferredReplyJob): void {
  queue.push(job);
  void drainQueue();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOnline(maxMs: number): Promise<boolean> {
  if (navigator.onLine) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener('online', onOnline);
      resolve(false);
    }, maxMs);
    const onOnline = (): void => {
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      resolve(true);
    };
    window.addEventListener('online', onOnline);
  });
}

async function drainQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      const done = await runDeferredJob(job);
      if (!done) {
        queue.push(job);
        window.addEventListener('online', () => void drainQueue(), { once: true });
        break;
      }
    }
  } finally {
    processing = false;
  }
}

async function runDeferredJob(job: DeferredReplyJob): Promise<boolean> {
  if (!navigator.onLine) {
    await waitForOnline(OFFLINE_WAIT_MS);
  }

  const maxAttempts = DEFERRED_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!navigator.onLine) {
      const back = await waitForOnline(DEFERRED_RETRY_DELAYS_MS[attempt] ?? 8000);
      if (!back) continue;
    }

    const result = await chatCompletion(job.messages, { temperature: 0.5 });
    if (!result.ok || !result.text) {
      if (attempt < maxAttempts - 1) {
        await sleep(DEFERRED_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      return false;
    }

    const processed = await job.processReply(result.text, job.messages);
    await updateMerlinMessageContent(job.placeholderId, processed.reply);
    onReady?.({
      userText: job.userText,
      reply: processed.reply,
      sideEffects: processed.sideEffects,
    });
    return true;
  }

  return false;
}
