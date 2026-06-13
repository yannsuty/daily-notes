import { getStoredMerlinApiKey, structureJournalText } from './merlin-ai';
import type { Journal } from './journal';
import type { TabBar } from './tabs';

const SILENCE_TIMEOUT_MS = 8000;

const WAKE_PHRASES = ['merlin journal'];
const STOP_PHRASES = ['merlin termine', 'merlin stop', "merlin c'est tout", 'merlin c est tout'];

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface MerlinSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => MerlinSpeechRecognition;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface MerlinOptions {
  journal: Journal;
  tabBar: TabBar;
  onEnabledChange?: (enabled: boolean) => void;
}

type MerlinState = 'off' | 'idle' | 'dictating';

export class Merlin {
  private journal: Journal;
  private tabBar: TabBar;
  private state: MerlinState = 'off';
  private recognition: MerlinSpeechRecognition | null = null;
  private overlay: HTMLElement | null = null;
  private sessionText = '';
  private silenceTimer: ReturnType<typeof setInterval> | null = null;
  private silenceCountdown = 0;
  private restarting = false;

  constructor(options: MerlinOptions) {
    this.journal = options.journal;
    this.tabBar = options.tabBar;
  }

  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  isSupported(): boolean {
    return getSpeechRecognition() !== null;
  }

  private start(): void {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;

    if (this.recognition) {
      this.state = 'idle';
      this.showOverlay('idle');
      return;
    }

    this.recognition = new Ctor();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'fr-FR';

    this.recognition.onresult = (event) => this.handleResult(event);
    this.recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        this.updateStatus(`Erreur : ${event.error}`);
      }
    };
    this.recognition.onend = () => {
      if (this.state !== 'off' && !this.restarting) {
        this.restarting = true;
        try {
          this.recognition?.start();
        } catch {
          // already started
        }
        this.restarting = false;
      }
    };

    this.state = 'idle';
    this.showOverlay('idle');
    try {
      this.recognition.start();
    } catch {
      // mic permission pending
    }
  }

  private stop(): void {
    this.state = 'off';
    this.clearSilenceTimer();
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.abort();
      this.recognition = null;
    }
    this.hideOverlay();
  }

  private handleResult(event: SpeechRecognitionEvent): void {
    let interim = '';
    let finalText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0]?.transcript ?? '';
      if (result.isFinal) {
        finalText += transcript;
      } else {
        interim += transcript;
      }
    }

    if (this.state === 'idle') {
      if (finalText && matchesPhrase(finalText, WAKE_PHRASES)) {
        void this.startDictation();
      }
      return;
    }

    if (this.state === 'dictating') {
      if (finalText && matchesPhrase(finalText, STOP_PHRASES)) {
        void this.endDictation();
        return;
      }

      const dictationText = stripCommands(finalText || interim);
      if (dictationText) {
        this.resetSilenceTimer();
        if (finalText) {
          const clean = stripCommands(finalText);
          if (clean) {
            this.sessionText += (this.sessionText ? ' ' : '') + clean;
            void this.journal.appendToToday(clean);
          }
        }
        this.updateLiveText(this.sessionText, interim ? stripCommands(interim) : '');
      }
    }
  }

  private async startDictation(): Promise<void> {
    this.state = 'dictating';
    this.sessionText = '';
    this.tabBar.switchTo('journal');
    this.showOverlay('dictating');
    this.resetSilenceTimer();
    this.updateStatus('Dictée en cours — dites « Merlin termine » pour arrêter');
  }

  private async endDictation(): Promise<void> {
    if (this.state !== 'dictating') return;
    this.state = 'idle';
    this.clearSilenceTimer();
    await this.journal.flushToday();

    const hasApiKey = !!getStoredMerlinApiKey();
    if (this.sessionText.trim() && hasApiKey) {
      this.showStructurePrompt();
    } else {
      this.showOverlay('idle');
      this.updateStatus('Session terminée');
    }
  }

  private showStructurePrompt(): void {
    if (!this.overlay) this.showOverlay('idle');

    const existing = this.overlay?.querySelector('.merlin__structure');
    existing?.remove();

    const prompt = document.createElement('div');
    prompt.className = 'merlin__structure';
    prompt.innerHTML = `
      <p class="merlin__structure-text">Structurer cette dictée avec Merlin ?</p>
      <div class="merlin__structure-actions">
        <button type="button" class="btn btn--ghost merlin__structure-skip">Non</button>
        <button type="button" class="btn btn--primary merlin__structure-go">Structurer</button>
      </div>
    `;

    prompt.querySelector('.merlin__structure-skip')!.addEventListener('click', () => {
      prompt.remove();
      this.showOverlay('idle');
    });

    prompt.querySelector('.merlin__structure-go')!.addEventListener('click', () => {
      void this.runStructure(prompt);
    });

    this.overlay?.appendChild(prompt);
  }

  private async runStructure(promptEl: HTMLElement): Promise<void> {
    const goBtn = promptEl.querySelector('.merlin__structure-go') as HTMLButtonElement;
    goBtn.disabled = true;
    goBtn.textContent = 'Structuration…';

    const result = await structureJournalText(this.sessionText);
    promptEl.remove();

    if (result.ok && result.text) {
      const confirmed = confirm(
        'Remplacer le texte dicté par la version structurée ?\n\n' +
          result.text.slice(0, 300) +
          (result.text.length > 300 ? '…' : ''),
      );
      if (confirmed) {
        this.journal.replaceTodayChunk(this.sessionText, result.text);
        await this.journal.flushToday();
      }
    } else if (!result.ok) {
      alert(result.error ?? 'Erreur de structuration');
    }

    this.showOverlay('idle');
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceCountdown = SILENCE_TIMEOUT_MS / 1000;
    this.updateSilenceCountdown();

    this.silenceTimer = setInterval(() => {
      this.silenceCountdown -= 1;
      this.updateSilenceCountdown();
      if (this.silenceCountdown <= 0) {
        void this.endDictation();
      }
    }, 1000);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearInterval(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private updateSilenceCountdown(): void {
    const el = this.overlay?.querySelector('.merlin__silence');
    if (el && this.state === 'dictating') {
      el.textContent =
        this.silenceCountdown > 0
          ? `Arrêt auto dans ${this.silenceCountdown}s`
          : '';
    }
  }

  private showOverlay(mode: 'idle' | 'dictating'): void {
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'merlin';
      this.overlay.innerHTML = `
        <div class="merlin__panel">
          <div class="merlin__indicator" aria-hidden="true"></div>
          <div class="merlin__status"></div>
          <div class="merlin__live"></div>
          <div class="merlin__silence"></div>
          <button type="button" class="merlin__mic-btn" aria-label="Démarrer dictée">🎙</button>
          <button type="button" class="merlin__stop-btn" hidden aria-label="Arrêter dictée">Stop</button>
        </div>
      `;

      this.overlay.querySelector('.merlin__mic-btn')!.addEventListener('click', () => {
        void this.startDictation();
      });
      this.overlay.querySelector('.merlin__stop-btn')!.addEventListener('click', () => {
        void this.endDictation();
      });

      document.body.appendChild(this.overlay);
    }

    const indicator = this.overlay.querySelector('.merlin__indicator')!;
    const micBtn = this.overlay.querySelector('.merlin__mic-btn') as HTMLButtonElement;
    const stopBtn = this.overlay.querySelector('.merlin__stop-btn') as HTMLButtonElement;

    indicator.classList.toggle('merlin__indicator--active', mode === 'dictating');
    micBtn.hidden = mode === 'dictating';
    stopBtn.hidden = mode !== 'dictating';

    if (mode === 'idle') {
      this.updateStatus('Dites « Merlin journal » ou appuyez sur 🎙');
      this.updateLiveText('', '');
    }
  }

  private hideOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private updateStatus(text: string): void {
    const el = this.overlay?.querySelector('.merlin__status');
    if (el) el.textContent = text;
  }

  private updateLiveText(final: string, interim: string): void {
    const el = this.overlay?.querySelector('.merlin__live');
    if (!el) return;
    const display = final + (interim ? ` ${interim}` : '');
    el.textContent = display;
  }

  destroy(): void {
    this.stop();
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function matchesPhrase(text: string, phrases: string[]): boolean {
  const norm = normalize(text);
  return phrases.some((p) => norm.includes(normalize(p)));
}

function stripCommands(text: string): string {
  let result = text;
  for (const phrase of [...WAKE_PHRASES, ...STOP_PHRASES]) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(re, '');
  }
  return result.trim();
}
