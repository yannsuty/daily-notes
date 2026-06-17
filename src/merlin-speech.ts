import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { SpeechRecognitionPlugin } from '@capgo/capacitor-speech-recognition';

const RESTART_DELAY_MS = 500;
const CONTEXTUAL_STRINGS = [
  'Merlin',
  'journal',
  'termine',
  'stop',
  'retiens',
  'au revoir',
  'quoi',
  'hier',
  'aujourd',
];

export interface SpeechEngineCallbacks {
  onStart: () => void;
  onEnd: () => void;
  onError: (code: string) => void;
  onTranscript: (text: string) => void;
}

export interface MerlinSpeechEngine {
  isSupported(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  start(): Promise<boolean>;
  stop(): Promise<void>;
  abort(): Promise<void>;
}

export async function createMerlinSpeechEngine(
  callbacks: SpeechEngineCallbacks,
): Promise<MerlinSpeechEngine> {
  if (Capacitor.isNativePlatform()) {
    const { SpeechRecognition } = await import('@capgo/capacitor-speech-recognition');
    return new CapgoSpeechEngine(SpeechRecognition, callbacks);
  }
  return new WebSpeechEngine(callbacks);
}

interface WebSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): { readonly transcript: string };
  [index: number]: { readonly transcript: string };
}

interface WebSpeechRecognitionEvent extends Event {
  readonly results: {
    readonly length: number;
    item(index: number): WebSpeechRecognitionResult;
    [index: number]: WebSpeechRecognitionResult;
  };
}

interface WebSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface WebMerlinSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((ev: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type WebSpeechRecognitionCtor = new () => WebMerlinSpeechRecognition;

function getWebSpeechCtor(): WebSpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: WebSpeechRecognitionCtor;
    webkitSpeechRecognition?: WebSpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

class WebSpeechEngine implements MerlinSpeechEngine {
  private callbacks: SpeechEngineCallbacks;
  private recognition: WebMerlinSpeechRecognition | null = null;
  private shouldRun = false;

  constructor(callbacks: SpeechEngineCallbacks) {
    this.callbacks = callbacks;
  }

  async isSupported(): Promise<boolean> {
    return getWebSpeechCtor() !== null;
  }

  async requestPermission(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      return true;
    } catch {
      return false;
    }
  }

  async start(): Promise<boolean> {
    if (this.shouldRun && this.recognition) return true;

    const Ctor = getWebSpeechCtor();
    if (!Ctor) return false;

    this.shouldRun = true;

    if (!this.recognition) {
      this.recognition = new Ctor();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'fr-FR';
      this.recognition.onresult = (event) => this.handleResult(event);
      this.recognition.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        this.callbacks.onError(event.error);
      };
      this.recognition.onend = () => {
        this.callbacks.onEnd();
        if (this.shouldRun) {
          setTimeout(() => {
            if (this.shouldRun && this.recognition) {
              try {
                this.recognition.start();
              } catch {
                this.callbacks.onError('restart-failed');
              }
            }
          }, RESTART_DELAY_MS);
        }
      };
      this.recognition.onstart = () => this.callbacks.onStart();
    }

    try {
      this.recognition.start();
      return true;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    this.shouldRun = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
  }

  async abort(): Promise<void> {
    this.shouldRun = false;
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onstart = null;
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
  }

  private handleResult(event: WebSpeechRecognitionEvent): void {
    let longestFinal = '';
    let interim = '';

    for (let i = 0; i < event.results.length; i++) {
      const raw = event.results[i][0]?.transcript ?? '';
      if (!raw) continue;
      if (event.results[i].isFinal) {
        if (raw.length > longestFinal.length) longestFinal = raw;
      } else {
        interim = raw;
      }
    }

    const text = interim.length >= longestFinal.length ? interim : longestFinal || interim;
    if (text) this.callbacks.onTranscript(text);
  }
}

type CapgoSpeechRecognition = SpeechRecognitionPlugin;

class CapgoSpeechEngine implements MerlinSpeechEngine {
  private api: CapgoSpeechRecognition;
  private callbacks: SpeechEngineCallbacks;
  private listeners: PluginListenerHandle[] = [];
  private shouldRun = false;
  private restarting = false;

  constructor(api: CapgoSpeechRecognition, callbacks: SpeechEngineCallbacks) {
    this.api = api;
    this.callbacks = callbacks;
  }

  async isSupported(): Promise<boolean> {
    const { available } = await this.api.available();
    return available;
  }

  async requestPermission(): Promise<boolean> {
    const status = await this.api.requestPermissions();
    return status.speechRecognition === 'granted';
  }

  async start(): Promise<boolean> {
    if (this.shouldRun) return true;
    this.shouldRun = true;
    await this.attachListeners();
    return this.beginSession();
  }

  async stop(): Promise<void> {
    this.shouldRun = false;
    try {
      await this.api.stop();
    } catch {
      // ignore
    }
  }

  async abort(): Promise<void> {
    this.shouldRun = false;
    await this.removeListeners();
    try {
      await this.api.stop();
    } catch {
      // ignore
    }
  }

  private async attachListeners(): Promise<void> {
    await this.removeListeners();

    const partial = await this.api.addListener('partialResults', (event) => {
      const text = event.accumulatedText ?? event.matches?.[0] ?? '';
      if (text) this.callbacks.onTranscript(text);
    });

    const state = await this.api.addListener('listeningState', (event) => {
      const started = event.status === 'started' || event.state === 'started';
      const stopped = event.status === 'stopped' || event.state === 'stopped';

      if (started) this.callbacks.onStart();
      if (stopped) {
        this.callbacks.onEnd();
        if (
          this.shouldRun &&
          !this.restarting &&
          (event.reason === 'silence' ||
            event.reason === 'results' ||
            event.reason === 'unknown')
        ) {
          void this.scheduleRestart();
        }
      }
    });

    const error = await this.api.addListener('error', (event) => {
      const code = event.code ?? 'unknown';
      if (code === 'no-speech' || code === 'aborted' || code === 'recognition-busy') return;
      this.callbacks.onError(code);
    });

    this.listeners = [partial, state, error];
  }

  private async scheduleRestart(): Promise<void> {
    this.restarting = true;
    await new Promise((resolve) => setTimeout(resolve, RESTART_DELAY_MS));
    this.restarting = false;
    if (this.shouldRun) await this.beginSession();
  }

  private async beginSession(): Promise<boolean> {
    try {
      await this.api.start({
        language: 'fr-FR',
        partialResults: true,
        popup: false,
        contextualStrings: CONTEXTUAL_STRINGS,
        allowForSilence: 5000,
      });
      return true;
    } catch {
      this.callbacks.onError('start-failed');
      return false;
    }
  }

  private async removeListeners(): Promise<void> {
    for (const listener of this.listeners) {
      await listener.remove();
    }
    this.listeners = [];
  }
}
