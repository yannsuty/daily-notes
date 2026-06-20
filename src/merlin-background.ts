import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { logger } from './logger';

export type MerlinWakeType = 'assistant' | 'journal';

export interface MerlinBackgroundPlugin {
  startListening(): Promise<{ ok: boolean }>;
  stopListening(): Promise<void>;
  isListening(): Promise<{ active: boolean }>;
  addListener(
    eventName: 'wakeDetected',
    listenerFunc: (event: { type: MerlinWakeType; query: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const MerlinBackground = registerPlugin<MerlinBackgroundPlugin>('MerlinBackground');

export interface MerlinBackgroundCallbacks {
  onWake: (type: MerlinWakeType, query: string) => void;
}

let listenerHandle: PluginListenerHandle | null = null;

export async function initMerlinBackground(
  callbacks: MerlinBackgroundCallbacks,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  if (listenerHandle) {
    await listenerHandle.remove();
    listenerHandle = null;
  }

  listenerHandle = await MerlinBackground.addListener('wakeDetected', (event) => {
    const type = event.type === 'journal' ? 'journal' : 'assistant';
    callbacks.onWake(type, event.query ?? '');
  });
}

export async function startBackgroundListening(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await MerlinBackground.startListening();
    return result.ok === true;
  } catch (err) {
    logger.warn('merlin-background', 'startBackgroundListening failed', err);
    return false;
  }
}

export async function stopBackgroundListening(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await MerlinBackground.stopListening();
  } catch (err) {
    logger.warn('merlin-background', 'stopBackgroundListening failed', err);
  }
}

export async function isBackgroundListening(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await MerlinBackground.isListening();
    return result.active === true;
  } catch (err) {
    logger.warn('merlin-background', 'isBackgroundListening failed', err);
    return false;
  }
}

export async function destroyMerlinBackground(): Promise<void> {
  if (listenerHandle) {
    await listenerHandle.remove();
    listenerHandle = null;
  }
  await stopBackgroundListening();
}
