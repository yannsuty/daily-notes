import { getStoredMerlinApiKey, structureJournalText } from './merlin-ai';
import type { Journal } from './journal';
import type { TabBar } from './tabs';

const SILENCE_TIMEOUT_MS = 8000;
const RESTART_DELAY_MS = 350;

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
  onstart: (() => void) | null;
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
  private heardSpeechInSession = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private micStream: MediaStream | null = null;
  private intentionalStop = false;
  private boundVisibilityHandler = (): void => {
    void this.onVisibilityChange();
  };

  constructor(options: MerlinOptions) {
    this.journal = options.journal;
    this.tabBar = options.tabBar;
  }

  setEnabled(enabled: boolean): void {
    if (enabled) {
      void this.start();
    } else {
      this.stop();
    }
  }

  isSupported(): boolean {
    return getSpeechRecognition() !== null;
  }

  private async start(): Promise<void> {
    this.state = 'idle';
    this.showOverlay('idle');

    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      this.updateStatus('Reconnaissance vocale non supportée sur ce navigateur.');
      return;
    }

    const micOk = await this.ensureMicrophone();
    if (!micOk) {
      this.updateStatus('Autorisez le micro pour utiliser Merlin.');
      return;
    }

    if (!this.recognition) {
      this.recognition = new Ctor();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'fr-FR';

      this.recognition.onresult = (event) => this.handleResult(event);
      this.recognition.onerror = (event) => this.handleError(event);
      this.recognition.onend = () => this.scheduleRestart();
      this.recognition.onstart = () => this.updateListeningState(true);
    }

    document.addEventListener('visibilitychange', this.boundVisibilityHandler);

    this.startListening();
  }

  private stop(): void {
    this.state = 'off';
    this.intentionalStop = true;
    this.clearSilenceTimer();
    this.clearRestartTimer();
    void this.releaseWakeLock();
    document.removeEventListener('visibilitychange', this.boundVisibilityHandler);

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

    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }

    this.hideOverlay();
  }

  private async ensureMicrophone(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) return true;
    try {
      if (this.micStream) return true;
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return true;
    } catch {
      return false;
    }
  }

  private startListening(): void {
    if (this.state === 'off' || !this.recognition) return;
    this.clearRestartTimer();
    try {
      this.recognition.start();
    } catch {
      this.scheduleRestart(RESTART_DELAY_MS);
    }
  }

  private scheduleRestart(delayMs = RESTART_DELAY_MS): void {
    if (this.state === 'off' || !this.recognition || this.intentionalStop) return;
    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.state === 'off' || !this.recognition) return;
      try {
        this.recognition.stop();
      } catch {
        // already stopped
      }
      setTimeout(() => this.startListening(), 100);
    }, delayMs);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private async restartSession(): Promise<void> {
    if (this.state === 'off' || !this.recognition) return;
    this.clearRestartTimer();
    this.intentionalStop = true;
    try {
      this.recognition.stop();
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
    this.intentionalStop = false;
    this.startListening();
  }

  private handleError(event: SpeechRecognitionErrorEvent): void {
    if (event.error === 'no-speech' || event.error === 'aborted') {
      this.scheduleRestart();
      return;
    }
    if (event.error === 'not-allowed') {
      this.updateStatus('Micro refusé — autorisez l\'accès dans les réglages du navigateur.');
      return;
    }
    this.updateStatus(`Erreur micro : ${event.error}`);
    this.scheduleRestart(800);
  }

  private async onVisibilityChange(): Promise<void> {
    if (document.visibilityState === 'visible' && this.state !== 'off') {
      await this.restartSession();
      if (this.state === 'idle') {
        this.updateStatus('Écoute reprise — dites « Merlin journal »');
      }
    }
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

    const spoken = (finalText + interim).trim();
    if (!spoken) return;

    if (this.state === 'idle') {
      if (matchesPhrase(spoken, WAKE_PHRASES)) {
        void this.startDictation();
      }
      return;
    }

    if (this.state === 'dictating') {
      if (finalText && matchesPhrase(finalText, STOP_PHRASES)) {
        void this.endDictation();
        return;
      }

      const liveInterim = stripCommands(interim);
      const liveFinal = stripCommands(finalText);

      if (liveInterim || liveFinal) {
        this.heardSpeechInSession = true;
        this.resetSilenceTimer();
      }

      if (liveFinal) {
        this.sessionText += (this.sessionText ? ' ' : '') + liveFinal;
        void this.journal.appendToToday(liveFinal);
      }

      this.updateLiveText(this.sessionText, liveInterim);
    }
  }

  private async startDictation(): Promise<void> {
    this.state = 'dictating';
    this.sessionText = '';
    this.heardSpeechInSession = false;
    this.clearSilenceTimer();
    this.tabBar.switchTo('journal');
    this.showOverlay('dictating');
    await this.requestWakeLock();
    await this.restartSession();
    this.updateStatus('Dictée en cours — parlez, puis « Merlin termine » pour arrêter');
  }

  private async endDictation(): Promise<void> {
    if (this.state !== 'dictating') return;
    this.state = 'idle';
    this.heardSpeechInSession = false;
    this.clearSilenceTimer();
    await this.journal.flushToday();
    await this.releaseWakeLock();
    await this.restartSession();

    const hasApiKey = !!getStoredMerlinApiKey();
    if (this.sessionText.trim() && hasApiKey) {
      this.showStructurePrompt();
    } else {
      this.showOverlay('idle');
      this.updateStatus('Session terminée — dites « Merlin journal » pour recommencer');
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
      this.updateStatus('Dites « Merlin journal » ou appuyez sur 🎙');
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
    this.updateStatus('Dites « Merlin journal » ou appuyez sur 🎙');
    await this.restartSession();
  }

  private resetSilenceTimer(): void {
    if (!this.heardSpeechInSession) return;

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
    this.updateSilenceCountdown();
  }

  private updateSilenceCountdown(): void {
    const el = this.overlay?.querySelector('.merlin__silence');
    if (!el || this.state !== 'dictating') {
      if (el) el.textContent = '';
      return;
    }
    if (!this.heardSpeechInSession) {
      el.textContent = 'Parlez…';
      return;
    }
    el.textContent =
      this.silenceCountdown > 0
        ? `Arrêt auto dans ${this.silenceCountdown}s`
        : '';
  }

  private async requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // ignore — optional
    }
  }

  private async releaseWakeLock(): Promise<void> {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
      } catch {
        // ignore
      }
      this.wakeLock = null;
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
          <p class="merlin__hint">L'app doit rester ouverte — écoute inactive si l'écran est éteint.</p>
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

  private updateListeningState(active: boolean): void {
    const indicator = this.overlay?.querySelector('.merlin__indicator');
    if (indicator && this.state === 'idle') {
      indicator.classList.toggle('merlin__indicator--listening', active);
    }
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
