import {
  correctDictationText,
  structureJournalText,
} from './merlin-ai';
import type { Journal } from './journal';
import {
  createMerlinSpeechEngine,
  type MerlinSpeechEngine,
} from './merlin-speech';
import {
  extractTranscriptDelta,
  collapseStutter,
  matchesPhrase,
  matchesWake,
  STOP_PHRASES,
  stripCommands,
} from './merlin-text';
import type { TabBar } from './tabs';

const SILENCE_TIMEOUT_MS = 10000;

export interface MerlinOptions {
  journal: Journal;
  tabBar: TabBar;
}

type MerlinState = 'off' | 'idle' | 'dictating';

export class Merlin {
  private journal: Journal;
  private tabBar: TabBar;
  private state: MerlinState = 'off';
  private engine: MerlinSpeechEngine | null = null;
  private engineReady: Promise<void> | null = null;
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
      void this.prepare();
    } else {
      void this.stop();
    }
  }

  beginListening(): Promise<boolean> {
    return this.activateListening();
  }

  isSupported(): boolean {
    return true;
  }

  private ensureEngine(): Promise<void> {
    if (this.engine) return Promise.resolve();
    if (this.engineReady) return this.engineReady;

    this.engineReady = createMerlinSpeechEngine({
      onStart: () => {
        this.listeningActive = true;
        this.updateListeningState(true);
        if (this.state === 'dictating') {
          this.lastHypothesis = '';
        }
      },
      onEnd: () => {
        this.listeningActive = false;
        this.updateListeningState(false);
      },
      onError: (code) => this.handleSpeechError(code),
      onTranscript: (text) => this.handleTranscript(text),
    }).then((engine) => {
      this.engine = engine;
    });

    return this.engineReady;
  }

  private async prepare(): Promise<void> {
    await this.ensureEngine();
    const supported = await this.engine!.isSupported();
    if (!supported) {
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
    await this.ensureEngine();
    if (!this.engine) return false;
    if (this.listeningActive) return true;

    const micOk = await this.engine.requestPermission();
    if (!micOk) {
      this.setMicHint('Autorisez le micro dans les réglages');
      return false;
    }

    const started = await this.engine.start();
    if (started) {
      this.setMicHint('Dites « Merlin journal »');
    } else {
      this.setMicHint('Impossible de démarrer le micro');
    }
    return started;
  }

  private async stop(): Promise<void> {
    this.state = 'off';
    this.listeningActive = false;
    this.clearSilenceTimer();
    void this.releaseWakeLock();
    document.removeEventListener('visibilitychange', this.boundVisibilityHandler);

    if (this.engine) {
      await this.engine.abort();
    }

    this.hideOverlay();
  }

  private handleSpeechError(code: string): void {
    if (code === 'not-allowed' || code === 'permission-denied') {
      this.listeningActive = false;
      this.setMicHint('Micro refusé');
      return;
    }
    if (code === 'restart-failed' || code === 'start-failed') {
      this.setMicHint('Impossible de démarrer le micro');
      return;
    }
    this.setMicHint(`Erreur : ${code}`);
  }

  private async onVisibilityChange(): Promise<void> {
    if (
      document.visibilityState === 'visible' &&
      this.state !== 'off' &&
      !this.listeningActive &&
      this.engine
    ) {
      await this.engine.start();
    }
  }

  private handleTranscript(raw: string): void {
    const full = stripCommands(raw.trim());
    if (!full) return;

    if (this.state === 'idle') {
      if (matchesWake(full)) {
        void this.startDictation();
      }
      return;
    }

    if (this.state === 'dictating') {
      if (matchesPhrase(full, STOP_PHRASES)) {
        void this.endDictation();
        return;
      }

      this.processTranscript(full);
    }
  }

  private processTranscript(hypothesis: string): void {
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

    if (this.sessionText.trim()) {
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
      <p class="merlin__structure-text">Améliorer cette dictée avec Merlin ?</p>
      <div class="merlin__structure-actions">
        <button type="button" class="btn btn--ghost merlin__structure-skip">Non</button>
        <button type="button" class="btn btn--ghost merlin__structure-correct">Corriger</button>
        <button type="button" class="btn btn--primary merlin__structure-go">Structurer</button>
      </div>
    `;

    prompt.querySelector('.merlin__structure-skip')!.addEventListener('click', () => {
      prompt.remove();
      this.showOverlay('idle');
    });

    prompt.querySelector('.merlin__structure-correct')!.addEventListener('click', () => {
      void this.runCorrection(prompt);
    });

    prompt.querySelector('.merlin__structure-go')!.addEventListener('click', () => {
      void this.runStructure(prompt);
    });

    this.overlay?.appendChild(prompt);
  }

  private async runCorrection(promptEl: HTMLElement): Promise<void> {
    const btn = promptEl.querySelector('.merlin__structure-correct') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Correction…';

    const result = await correctDictationText(this.sessionText);
    promptEl.remove();

    if (result.ok && result.text) {
      const confirmed = confirm(
        'Remplacer le texte dicté par la version corrigée ?\n\n' +
          result.text.slice(0, 300) +
          (result.text.length > 300 ? '…' : ''),
      );
      if (confirmed) {
        this.journal.replaceTodayChunk(this.sessionText, result.text);
        this.sessionText = result.text;
        await this.journal.flushToday();
      }
    } else if (!result.ok) {
      alert(result.error ?? 'Erreur de correction');
    }

    this.showOverlay('idle');
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

    this.silenceTimer = setInterval(() => {
      this.silenceCountdown -= 1;
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
    void this.stop();
  }
}
