import { getStoredMerlinApiKey, structureJournalText } from './merlin-ai';
import type { Journal } from './journal';
import type { TabBar } from './tabs';

const SILENCE_TIMEOUT_MS = 10000;
const RESTART_DELAY_MS = 500;

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
  private lastHypothesis = '';
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
      this.setMicHint('Reconnaissance vocale non supportée');
      return;
    }

    this.state = 'idle';
    this.showOverlay('idle');
    this.setMicHint('Appuyez pour activer Merlin');
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);
  }

  private async activateListening(): Promise<boolean> {
    if (this.listeningActive) return true;

    const Ctor = getSpeechRecognition();
    if (!Ctor) return false;

    const micOk = await this.flashMicrophonePermission();
    if (!micOk) {
      this.setMicHint('Autorisez le micro dans les réglages');
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
        if (this.state === 'dictating') {
          this.lastHypothesis = '';
        }
      };
    }

    const started = this.startListening();
    if (started) {
      this.setMicHint('Dites « Merlin journal »');
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
            this.setMicHint('Impossible de démarrer le micro');
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
      this.setMicHint('Micro refusé');
      return;
    }
    this.setMicHint(`Erreur : ${event.error}`);
  }

  private async onVisibilityChange(): Promise<void> {
    if (document.visibilityState === 'visible' && this.state !== 'off' && this.listeningActive) {
      setTimeout(() => this.startListening(), RESTART_DELAY_MS);
    }
  }

  private handleResult(event: SpeechRecognitionEvent): void {
    const { full } = parseResults(event);

    if (!full) return;

    if (this.state === 'idle') {
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
    }
  }

  /**
   * Une seule écriture par événement, basée sur l'hypothèse la plus complète.
   * Gère les segments cumulatifs et les redémarrages après pause.
   */
  private processNewFinals(event: SpeechRecognitionEvent): void {
    const hypothesis = getRecognitionHypothesis(event);
    if (!hypothesis) return;
    if (hypothesis === this.lastHypothesis) return;
    this.lastHypothesis = hypothesis;

    const delta = extractTranscriptDelta(this.sessionText, hypothesis);
    if (delta) {
      this.commitSpeech(delta);
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
    this.lastHypothesis = '';
    this.heardSpeechInSession = false;
    this.clearSilenceTimer();
    this.tabBar.switchTo('journal');
    this.showOverlay('dictating');
    await this.requestWakeLock();
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
    /* indicateur visuel retiré — la vague suffit */
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
          <div class="merlin__wave" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <button type="button" class="merlin__mic-btn" aria-label="Activer Merlin">🎙</button>
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

    const micBtn = this.overlay.querySelector('.merlin__mic-btn') as HTMLButtonElement;
    const stopBtn = this.overlay.querySelector('.merlin__stop-btn') as HTMLButtonElement;

    this.overlay.classList.toggle('merlin--dictating', mode === 'dictating');
    micBtn.hidden = mode === 'dictating';
    stopBtn.hidden = mode !== 'dictating';
  }

  private async onMicPressed(): Promise<void> {
    const ok = await this.activateListening();
    if (!ok) return;
    if (this.state === 'idle') {
      await this.startDictation();
    }
  }

  private hideOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private updateListeningState(active: boolean): void {
    this.overlay?.classList.toggle('merlin--listening', active);
  }

  private setMicHint(hint: string): void {
    const btn = this.overlay?.querySelector<HTMLButtonElement>('.merlin__mic-btn');
    if (btn) btn.title = hint;
  }

  destroy(): void {
    this.stop();
  }
}

interface ParsedResults {
  full: string;
}

function parseResults(event: SpeechRecognitionEvent): ParsedResults {
  const full = getRecognitionHypothesis(event);
  return { full };
}

/** Hypothèse la plus complète : interim (souvent cumulatif) ou dernier final le plus long. */
function getRecognitionHypothesis(event: SpeechRecognitionEvent): string {
  let longestFinal = '';
  let interim = '';

  for (let i = 0; i < event.results.length; i++) {
    const raw = event.results[i][0]?.transcript ?? '';
    const cleaned = stripCommands(raw.trim());
    if (!cleaned) continue;

    if (event.results[i].isFinal) {
      if (cleaned.length > longestFinal.length) longestFinal = cleaned;
    } else {
      interim = cleaned;
    }
  }

  if (interim.length >= longestFinal.length) return interim;
  return longestFinal || interim;
}

function getRecentFinalText(event: SpeechRecognitionEvent): string {
  return getRecognitionHypothesis(event);
}

/**
 * Retourne uniquement les mots nouveaux dans `incoming` par rapport à `existing`.
 * Gère les segments cumulatifs et les reprises après pause (mots isolés déjà présents).
 */
function extractTranscriptDelta(existing: string, incoming: string): string {
  const prev = existing.trim();
  const cur = incoming.trim();
  if (!cur) return '';
  if (!prev) return collapseStutter(cur);

  const prevNorm = normalize(prev);
  const curNorm = normalize(cur);

  if (curNorm === prevNorm) return '';
  if (prevNorm.includes(curNorm)) return '';

  const prevWords = prevNorm.split(/\s+/).filter(Boolean);
  const curWords = curNorm.split(/\s+/).filter(Boolean);
  const origCurWords = cur.split(/\s+/).filter(Boolean);

  let shared = 0;
  while (shared < prevWords.length && shared < curWords.length) {
    if (prevWords[shared] !== curWords[shared]) break;
    shared++;
  }

  if (curWords.length > shared) {
    return collapseStutter(origCurWords.slice(shared).join(' '));
  }

  if (wordsAreSubsequence(curWords, prevWords)) return '';

  return '';
}

function wordsAreSubsequence(needle: string[], haystack: string[]): boolean {
  if (needle.length === 0) return true;
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++;
  }
  return j === needle.length;
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
