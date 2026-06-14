import { getStoredMerlinApiKey, structureJournalText } from './merlin-ai';
import type { Journal } from './journal';
import type { TabBar } from './tabs';

const SILENCE_TIMEOUT_MS = 10000;
const RESTART_DELAY_MS = 500;
const MIN_CONFIDENCE = 0.35;

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
  private listeningActive = false;
  private wakeLock: WakeLockSentinel | null = null;
  private boundVisibilityHandler = (): void => {
    void this.onVisibilityChange();
  };

  constructor(options: MerlinOptions) {
    this.journal = options.journal;
    this.tabBar = options.tabBar;
  }

  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.prepare();
    } else {
      this.stop();
    }
  }

  /** Démarre l'écoute — à appeler depuis un clic utilisateur. */
  beginListening(): Promise<boolean> {
    return this.activateListening();
  }

  isSupported(): boolean {
    return getSpeechRecognition() !== null;
  }

  /** Affiche l'overlay ; l'écoute démarre au premier clic utilisateur (requis par le navigateur). */
  private prepare(): void {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      this.state = 'idle';
      this.showOverlay('idle');
      this.updateStatus('Reconnaissance vocale non supportée sur ce navigateur.');
      return;
    }

    this.state = 'idle';
    this.showOverlay('idle');
    this.updateStatus('Appuyez sur 🎙 pour activer l\'écoute');
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);
  }

  private async activateListening(): Promise<boolean> {
    if (this.listeningActive) return true;

    const Ctor = getSpeechRecognition();
    if (!Ctor) return false;

    const micOk = await this.flashMicrophonePermission();
    if (!micOk) {
      this.updateStatus('Autorisez le micro dans les réglages du navigateur.');
      return false;
    }

    if (!this.recognition) {
      this.recognition = new Ctor();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'fr-FR';
      this.recognition.onresult = (event) => this.handleResult(event);
      this.recognition.onerror = (event) => this.handleError(event);
      this.recognition.onend = () => this.handleEnd();
      this.recognition.onstart = () => {
        this.listeningActive = true;
        this.updateListeningState(true);
      };
    }

    const started = this.startListening();
    if (started) {
      this.updateStatus('Écoute active — dites « Merlin journal »');
    }
    return started;
  }

  /** Demande la permission sans garder le flux ouvert (évite les conflits avec SpeechRecognition). */
  private async flashMicrophonePermission(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      return true;
    } catch {
      return false;
    }
  }

  private startListening(): boolean {
    if (this.state === 'off' || !this.recognition) return false;
    try {
      this.recognition.start();
      return true;
    } catch {
      setTimeout(() => {
        if (this.state !== 'off' && this.recognition) {
          try {
            this.recognition.start();
          } catch {
            this.updateStatus('Impossible de démarrer le micro — réessayez.');
          }
        }
      }, RESTART_DELAY_MS);
      return false;
    }
  }

  private handleEnd(): void {
    this.listeningActive = false;
    this.updateListeningState(false);
    if (this.state === 'off') return;

    setTimeout(() => {
      if (this.state !== 'off' && this.recognition) {
        this.startListening();
      }
    }, RESTART_DELAY_MS);
  }

  private stop(): void {
    this.state = 'off';
    this.listeningActive = false;
    this.clearSilenceTimer();
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

    this.hideOverlay();
  }

  private handleError(event: SpeechRecognitionErrorEvent): void {
    if (event.error === 'no-speech') return;
    if (event.error === 'aborted') return;
    if (event.error === 'not-allowed') {
      this.listeningActive = false;
      this.updateStatus('Micro refusé — autorisez l\'accès au micro.');
      return;
    }
    this.updateStatus(`Erreur : ${event.error}`);
  }

  private async onVisibilityChange(): Promise<void> {
    if (document.visibilityState === 'visible' && this.state !== 'off' && this.listeningActive) {
      setTimeout(() => this.startListening(), RESTART_DELAY_MS);
      if (this.state === 'idle') {
        this.updateStatus('Écoute reprise — dites « Merlin journal »');
      }
    }
  }

  private handleResult(event: SpeechRecognitionEvent): void {
    const { full } = parseResults(event);

    if (!full) return;

    if (this.state === 'idle') {
      this.updateHeard(full);
      if (matchesWake(full)) {
        void this.startDictation();
      }
      return;
    }

    if (this.state === 'dictating') {
      if (matchesPhrase(getRecentFinalText(event), STOP_PHRASES)) {
        void this.endDictation();
        return;
      }

      this.processNewFinals(event);

      const display = stripCommands(parseResults(event).full) || this.sessionText;
      this.updateDictation(display);
    }
  }

  /**
   * Chrome envoie souvent des segments cumulatifs (« je », puis « je veux », puis « je veux faire »).
   * On n'ajoute que le delta par rapport à ce qui est déjà écrit.
   */
  private processNewFinals(event: SpeechRecognitionEvent): void {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result.isFinal) continue;

      const alt = result[0];
      const raw = alt?.transcript ?? '';
      const confidence = alt?.confidence ?? 1;
      if (!raw.trim()) continue;
      if (confidence > 0 && confidence < MIN_CONFIDENCE) continue;

      const chunk = stripCommands(raw.trim());
      if (!chunk) continue;

      const delta = extractTranscriptDelta(this.sessionText, chunk);
      if (delta) {
        this.commitSpeech(delta);
      }
    }
  }

  private commitSpeech(text: string): void {
    const cleaned = collapseStutter(text.trim());
    if (!cleaned) return;

    this.heardSpeechInSession = true;
    this.resetSilenceTimer();
    this.sessionText += (this.sessionText ? ' ' : '') + cleaned;
    void this.journal.appendToToday(cleaned);
  }

  private async startDictation(): Promise<void> {
    const ok = await this.activateListening();
    if (!ok) return;

    this.state = 'dictating';
    this.sessionText = '';
    this.heardSpeechInSession = false;
    this.clearSilenceTimer();
    this.tabBar.switchTo('journal');
    this.showOverlay('dictating');
    await this.requestWakeLock();
    this.updateStatus('Dictée en cours — parlez par phrases courtes, faites de courtes pauses');
    this.updateDictation('');
  }

  private async endDictation(): Promise<void> {
    if (this.state !== 'dictating') return;

    this.state = 'idle';
    this.heardSpeechInSession = false;
    this.clearSilenceTimer();
    await this.journal.flushToday();
    await this.releaseWakeLock();

    const hasApiKey = !!getStoredMerlinApiKey();
    if (this.sessionText.trim() && hasApiKey) {
      this.showStructurePrompt();
    } else {
      this.showOverlay('idle');
      this.updateStatus('Session terminée — dites « Merlin journal »');
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
      this.updateStatus('Dites « Merlin journal »');
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
    this.updateStatus('Dites « Merlin journal »');
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
      // optional
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
          <div class="merlin__heard"></div>
          <div class="merlin__live"></div>
          <div class="merlin__silence"></div>
          <p class="merlin__hint">L'app doit rester ouverte — pas d'écoute écran éteint.</p>
          <button type="button" class="merlin__mic-btn" aria-label="Activer et dicter">🎙</button>
          <button type="button" class="merlin__stop-btn" hidden aria-label="Arrêter dictée">Stop</button>
        </div>
      `;

      this.overlay.querySelector('.merlin__mic-btn')!.addEventListener('click', () => {
        void this.onMicPressed();
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
  }

  private async onMicPressed(): Promise<void> {
    const ok = await this.activateListening();
    if (!ok) return;
    if (this.state === 'idle') {
      this.updateStatus('Écoute active — dites « Merlin journal » ou parlez');
      await this.startDictation();
    }
  }

  private hideOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private updateListeningState(active: boolean): void {
    const indicator = this.overlay?.querySelector('.merlin__indicator');
    if (indicator) {
      indicator.classList.toggle('merlin__indicator--listening', active);
    }
  }

  private updateStatus(text: string): void {
    const el = this.overlay?.querySelector('.merlin__status');
    if (el) el.textContent = text;
  }

  private updateHeard(text: string): void {
    const el = this.overlay?.querySelector('.merlin__heard');
    if (el) el.textContent = text ? `Entendu : ${text}` : '';
  }

  private updateDictation(preview: string): void {
    const el = this.overlay?.querySelector('.merlin__live');
    if (!el) return;
    el.textContent = preview;
  }

  destroy(): void {
    this.stop();
  }
}

interface ParsedResults {
  full: string;
}

function parseResults(event: SpeechRecognitionEvent): ParsedResults {
  let fullFinal = '';
  let interim = '';

  for (let i = 0; i < event.results.length; i++) {
    const transcript = event.results[i][0]?.transcript ?? '';
    if (event.results[i].isFinal) {
      fullFinal += transcript;
    } else {
      interim = transcript;
    }
  }

  const full = (fullFinal + interim).trim();
  return { full };
}

function getRecentFinalText(event: SpeechRecognitionEvent): string {
  let text = '';
  for (let i = event.resultIndex; i < event.results.length; i++) {
    if (event.results[i].isFinal) {
      text += event.results[i][0]?.transcript ?? '';
    }
  }
  return text.trim();
}

/**
 * Retourne uniquement les mots nouveaux dans `incoming` par rapport à `existing`.
 * Gère les segments cumulatifs de Chrome.
 */
function extractTranscriptDelta(existing: string, incoming: string): string {
  const prev = existing.trim();
  const cur = incoming.trim();
  if (!cur) return '';
  if (!prev) return collapseStutter(cur);

  const prevWords = prev.split(/\s+/).filter(Boolean);
  const curWords = cur.split(/\s+/).filter(Boolean);

  let shared = 0;
  const maxShared = Math.min(prevWords.length, curWords.length);
  while (shared < maxShared) {
    if (normalize(prevWords[shared]) !== normalize(curWords[shared])) break;
    shared++;
  }

  if (curWords.length <= shared) return '';

  return collapseStutter(curWords.slice(shared).join(' '));
}

/** Réduit les répétitions consécutives : « le le le » → « le » */
function collapseStutter(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    const prev = out[out.length - 1];
    if (!prev || normalize(prev) !== normalize(word)) {
      out.push(word);
    }
  }
  return out.join(' ');
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[,.!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesWake(text: string): boolean {
  const norm = normalize(text);
  if (norm.includes('merlin journal')) return true;
  if (norm.includes('merlin le journal')) return true;
  if (norm.includes('merlin du journal')) return true;

  const merlinIdx = norm.indexOf('merlin');
  const journalIdx = norm.indexOf('journal');
  if (merlinIdx >= 0 && journalIdx > merlinIdx && journalIdx - merlinIdx < 25) {
    return true;
  }
  return false;
}

function matchesPhrase(text: string, phrases: string[]): boolean {
  const norm = normalize(text);
  return phrases.some((p) => norm.includes(normalize(p)));
}

function stripCommands(text: string): string {
  let result = text;
  const allPhrases = [
    'merlin journal',
    'merlin le journal',
    ...STOP_PHRASES,
  ];
  for (const phrase of allPhrases) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(re, '');
  }
  return result.trim();
}
