import { Capacitor } from '@capacitor/core';
import { getMeta } from './db';

export interface MerlinTtsOptions {
  rate?: number;
  lang?: string;
}

export interface MerlinTtsEngine {
  isSupported(): Promise<boolean>;
  speak(text: string, options?: MerlinTtsOptions): Promise<void>;
  stop(): Promise<void>;
  isSpeaking(): boolean;
}

let activeEngine: MerlinTtsEngine | null = null;

export async function createMerlinTtsEngine(): Promise<MerlinTtsEngine> {
  if (activeEngine) return activeEngine;
  if (Capacitor.isNativePlatform()) {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
    activeEngine = new NativeTtsEngine(TextToSpeech);
  } else {
    activeEngine = new WebTtsEngine();
  }
  return activeEngine;
}

export async function getMerlinTtsPrefs(): Promise<{
  enabled: boolean;
  rate: number;
}> {
  const meta = await getMeta();
  return {
    enabled: meta.merlinTtsEnabled ?? true,
    rate: meta.merlinTtsRate ?? 1,
  };
}

export async function speakMerlin(
  text: string,
  options?: MerlinTtsOptions,
): Promise<boolean> {
  const prefs = await getMerlinTtsPrefs();
  if (!prefs.enabled) return false;

  const trimmed = text.trim();
  if (!trimmed) return false;

  const engine = await createMerlinTtsEngine();
  const supported = await engine.isSupported();
  if (!supported) return false;

  const spoken = truncateForSpeech(trimmed);
  await engine.speak(spoken, {
    rate: options?.rate ?? prefs.rate,
    lang: options?.lang ?? 'fr-FR',
  });
  return true;
}

export async function stopMerlinSpeech(): Promise<void> {
  if (!activeEngine) return;
  await activeEngine.stop();
}

export function isMerlinSpeaking(): boolean {
  return activeEngine?.isSpeaking() ?? false;
}

function truncateForSpeech(text: string, maxChars = 800): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSentence = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
  if (lastSentence > maxChars * 0.5) {
    return cut.slice(0, lastSentence + 1);
  }
  return cut + '…';
}

class WebTtsEngine implements MerlinTtsEngine {
  private speaking = false;

  async isSupported(): Promise<boolean> {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  async speak(text: string, options?: MerlinTtsOptions): Promise<void> {
    if (!window.speechSynthesis) return;
    await this.stop();

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = options?.lang ?? 'fr-FR';
      utterance.rate = Math.min(Math.max(options?.rate ?? 1, 0.5), 2);
      const voices = window.speechSynthesis.getVoices();
      const frVoice = voices.find((v) => v.lang.startsWith('fr'));
      if (frVoice) utterance.voice = frVoice;

      utterance.onstart = () => {
        this.speaking = true;
      };
      utterance.onend = () => {
        this.speaking = false;
        resolve();
      };
      utterance.onerror = () => {
        this.speaking = false;
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  async stop(): Promise<void> {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    this.speaking = false;
  }

  isSpeaking(): boolean {
    return this.speaking || window.speechSynthesis?.speaking === true;
  }
}

interface NativeTtsPlugin {
  speak(options: {
    text: string;
    lang?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
    queueStrategy?: number;
  }): Promise<void>;
  stop(): Promise<void>;
}

class NativeTtsEngine implements MerlinTtsEngine {
  private api: NativeTtsPlugin;
  private speaking = false;

  constructor(api: NativeTtsPlugin) {
    this.api = api;
  }

  async isSupported(): Promise<boolean> {
    return true;
  }

  async speak(text: string, options?: MerlinTtsOptions): Promise<void> {
    await this.stop();
    this.speaking = true;
    try {
      await this.api.speak({
        text,
        lang: options?.lang ?? 'fr-FR',
        rate: Math.min(Math.max(options?.rate ?? 1, 0.5), 2),
        pitch: 1,
        volume: 1,
      });
    } finally {
      this.speaking = false;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.api.stop();
    } catch {
      // ignore
    }
    this.speaking = false;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }
}
