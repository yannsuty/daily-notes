import { chatCompletion, type ChatMessage } from './ai-provider';
import { updateMerlinMessageContent } from './db';
import type { PendingAutomation } from './merlin-pending-action';
import { backoffMs, sleep, waitForOnline } from '../lib/retry-backoff';

type AgentSideEffect = 'list_updated' | 'reminder_created' | 'reminder_completed';

export interface DeferredReplyInfo {
  userText: string;
  reply: string;
  sideEffects?: AgentSideEffect;
  pendingAutomation?: PendingAutomation;
}

type DeferredHandler = (info: DeferredReplyInfo) => void;

export interface DeferredReplyJob {
  userText: string;
  messages: ChatMessage[];
  placeholderId: string;
  processReply: (
    rawText: string,
    messages: ChatMessage[],
  ) => Promise<{ reply: string; sideEffects?: AgentSideEffect; pendingAutomation?: PendingAutomation }>;
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

async function drainQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      await runDeferredJob(job);
    }
  } finally {
    processing = false;
  }
}

async function runDeferredJob(job: DeferredReplyJob): Promise<void> {
  let attempt = 0;

  while (true) {
    if (!navigator.onLine) {
      await waitForOnline();
    }

    const result = await chatCompletion(job.messages, {
      temperature: 0.5,
      maxRetries: 0,
    });

    if (result.ok && result.text) {
      const processed = await job.processReply(result.text, job.messages);
      await updateMerlinMessageContent(job.placeholderId, processed.reply);
      onReady?.({
        userText: job.userText,
        reply: processed.reply,
        sideEffects: processed.sideEffects,
        pendingAutomation: processed.pendingAutomation,
      });
      return;
    }

    if (!result.retryable) return;

    await sleep(backoffMs(attempt));
    attempt += 1;
  }
}
