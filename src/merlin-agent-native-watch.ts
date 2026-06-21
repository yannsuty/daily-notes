import { Capacitor, registerPlugin } from '@capacitor/core';
import { apiUrl } from './api-base';
import { logger } from './logger';

export interface MerlinAgentWatchPlugin {
  watchAgentJob(options: { jobId: string; pollUrl: string }): Promise<{ ok: boolean }>;
  stopAgentJobWatch(): Promise<void>;
}

const MerlinAgentWatch = registerPlugin<MerlinAgentWatchPlugin>('MerlinBackground');

export function agentJobPollUrl(jobId: string): string {
  return apiUrl(`/api/merlin-agent?jobId=${encodeURIComponent(jobId)}`);
}

export async function startNativeAgentJobWatch(jobId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await MerlinAgentWatch.watchAgentJob({
      jobId,
      pollUrl: agentJobPollUrl(jobId),
    });
  } catch (err) {
    logger.warn('merlin-agent-native-watch', 'startNativeAgentJobWatch failed', err);
  }
}

export async function stopNativeAgentJobWatch(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await MerlinAgentWatch.stopAgentJobWatch();
  } catch (err) {
    logger.warn('merlin-agent-native-watch', 'stopNativeAgentJobWatch failed', err);
  }
}
