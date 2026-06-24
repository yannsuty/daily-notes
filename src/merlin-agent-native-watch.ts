import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { apiUrl } from './api-base';
import { logger } from './logger';

export interface MerlinAgentWatchPlugin {
  watchAgentJob(options: { jobId: string; pollUrl: string }): Promise<{ ok: boolean }>;
  stopAgentJobWatch(): Promise<void>;
  addListener(
    eventName: 'agentJobFinished',
    listenerFunc: (event: { jobId: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'appForeground',
    listenerFunc: () => void,
  ): Promise<PluginListenerHandle>;
}

const MerlinAgentWatch = registerPlugin<MerlinAgentWatchPlugin>('MerlinBackground');

export function agentJobPollUrl(jobId: string): string {
  return apiUrl(`/api/merlin-agent?jobId=${encodeURIComponent(jobId)}`);
}

export async function startNativeAgentJobWatch(jobId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const pollUrl = agentJobPollUrl(jobId);
  if (!pollUrl.startsWith('http')) {
    logger.error(
      'merlin-agent-native-watch',
      'pollUrl invalide (VITE_API_BASE_URL manquant ?)',
      pollUrl,
    );
    return;
  }

  try {
    await MerlinAgentWatch.watchAgentJob({
      jobId,
      pollUrl,
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

let nativeResumeHandles: PluginListenerHandle[] = [];

/** Reprise quand le service Android signale la fin d'un job ou le retour au premier plan. */
export async function registerNativeAgentJobResume(
  onResume: () => void,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) {
    return () => {};
  }

  for (const handle of nativeResumeHandles) {
    await handle.remove();
  }
  nativeResumeHandles = [];

  const finished = await MerlinAgentWatch.addListener('agentJobFinished', () => {
    onResume();
  });
  const foreground = await MerlinAgentWatch.addListener('appForeground', () => {
    onResume();
  });
  nativeResumeHandles = [finished, foreground];

  return async () => {
    for (const handle of nativeResumeHandles) {
      await handle.remove();
    }
    nativeResumeHandles = [];
  };
}
