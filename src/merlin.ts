import { Capacitor } from '@capacitor/core';
import {
  correctDictationText,
  structureJournalText,
} from './merlin-ai';
import { handleUserMessage } from './merlin-agent';
import type { MerlinChat } from './merlin-chat';
import type { Journal } from './journal';
import { getMeta } from './db';
import {
  createMerlinSpeechEngine,
  type MerlinSpeechEngine,
} from './merlin-speech';
import {
  extractAssistantQuery,
  extractTranscriptDelta,
  collapseStutter,
  matchesPhrase,
  parseWakeIntent,
  STOP_PHRASES,
  stripCommands,
} from './merlin-text';
import { isMerlinSpeaking, speakMerlin, stopMerlinSpeech } from './merlin-tts';
import type { MerlinWakeType } from './merlin-background';
import type { TabBar } from './tabs';
import type { TabId } from './tabs';

const DICTATION_SILENCE_MS = 10000;
const CONVERSING_SILENCE_MS = 2500;
const WAKE_ACK = 'Oui ?';

export interface MerlinOptions {
  journal: Journal;
  tabBar: TabBar;
  merlinChat?: MerlinChat;
  onConversationUpdate?: () => void;
}

type MerlinState = 'off' | 'idle' | 'conversing' | 'dictating' | 'processing' | 'speaking';
type OverlayMode = 'idle' | 'conversing' | 'dictating' | 'processing' | 'speaking';

export class Merlin {
  private journal: Journal;
  private tabBar: TabBar;
  private merlinChat: MerlinChat | null;
  private onConversationUpdate?: () => void;
  private state: MerlinState = 'off';
  private engine: MerlinSpeechEngine | null = null;
  private engineReady: Promise<void> | null = null;
  private overlay: HTMLElement | null = null;
  private sessionText = '';
  private conversingText = '';
  private conversingHypothesis = '';
  private silenceTimer: ReturnType<typeof setInterval> | null = null;
  private silenceCountdown = 0;
  private heardSpeechInSession = false;
  private listeningActive = false;
  private sttPaused = false;
  private lastHypothesis = '';
  private wakeLock: WakeLockSentinel | null = null;
  private backgroundActive = false;
  private boundVisibilityHandler = (): void => {
    void this.onVisibilityChange();
  };

  constructor(options: MerlinOptions) {
    this.journal = options.journal;
    this.tabBar = options.tabBar;
    this.merlinChat = options.merlinChat ?? null;
    this.onConversationUpdate = options.onConversationUpdate;
  }

  setMerlinChat(chat: MerlinChat): void {
    this.merlinChat = chat;
  }

  setEnabled(enabled: boolean): void {
    if (enabled) {
      void this.prepare();
    } else {
      void this.stop();
    }
  }

  onTabChange(tab: TabId): void {
    if (this.state === 'off') return;

    if (tab === 'merlin') {
      void this.onMerlinTabSelected();
      return;
    }

    void this.onMerlinTabHidden();
  }

  private async onMerlinTabHidden(): Promise<void> {
    if (this.state === 'conversing') {
      await this.endConversing();
    } else if (this.state === 'speaking' || this.state === 'processing') {
      await this.interruptSpeech();
    }

    if (this.state === 'idle') {
      await this.pauseListening();
      this.hideOverlay();
    }
  }

  private async onMerlinTabSelected(): Promise<void> {
    if (Capacitor.isNativePlatform() && this.backgroundActive) {
      const { stopBackgroundListening } = await import('./merlin-background');
      await stopBackgroundListening();
      this.backgroundActive = false;
    }

    if (this.state === 'idle') {
      this.showOverlay('idle');
      const meta = await getMeta();
      if (meta.merlinContinuousListen !== false) {
        await this.activateListening();
      }
    }
  }

  beginListening(): Promise<boolean> {
    return this.activateListening();
  }

  beginConversing(): Promise<void> {
    return this.startConversing();
  }

  isSupported(): boolean {
    return true;
  }

  private ensureEngine(): Promise<void> {
    if (this.engine) return Promise.resolve();
    if (this.engineReady) return this.engineReady;

    this.engineReady = createMerlinSpeechEngine({
      onStart: () => {
        if (this.sttPaused) return;
        this.listeningActive = true;
        this.updateListeningState(true);
        if (this.state === 'dictating') {
          this.lastHypothesis = '';
        }
      },
      onEnd: () => {
        if (this.sttPaused) return;
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
      this.setStatusHint('Reconnaissance vocale non supportée');
      return;
    }

    this.state = 'idle';
    this.showOverlay('idle');
    this.setStatusHint('Dites « Merlin » ou « Merlin journal »');
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);

    const meta = await getMeta();
    if (Capacitor.isNativePlatform()) {
      const { initMerlinBackground } = await import('./merlin-background');
      await initMerlinBackground({
        onWake: (type, query) => {
          void this.handleBackgroundWake(type, query);
        },
      });
    }

    if (meta.merlinContinuousListen !== false) {
      void this.activateListening();
    }
  }

  private async handleBackgroundWake(type: MerlinWakeType, query: string): Promise<void> {
    if (this.state === 'off') return;

    this.backgroundActive = false;
    await this.resumeListening();

    if (type === 'journal') {
      void this.startDictation();
      return;
    }

    void this.startConversing(query.trim() || undefined);
  }

  private async syncBackgroundListening(): Promise<void> {
    if (!Capacitor.isNativePlatform() || this.state === 'off') return;

    const meta = await getMeta();
    if (meta.merlinContinuousListen === false) return;

    const { startBackgroundListening, stopBackgroundListening } = await import(
      './merlin-background'
    );

    const shouldRunInBackground =
      document.visibilityState === 'hidden' && this.state === 'idle';

    if (shouldRunInBackground) {
      if (!this.backgroundActive) {
        await this.pauseListening();
        const started = await startBackgroundListening();
        this.backgroundActive = started;
      }
    } else if (this.backgroundActive) {
      await stopBackgroundListening();
      this.backgroundActive = false;
      if (!this.sttPaused) {
        await this.activateListening();
      }
    }
  }

  private async activateListening(): Promise<boolean> {
    await this.ensureEngine();
    if (!this.engine || this.sttPaused) return false;
    if (this.listeningActive) return true;

    const micOk = await this.engine.requestPermission();
    if (!micOk) {
      this.setStatusHint('Autorisez le micro dans les réglages');
      return false;
    }

    const started = await this.engine.start();
    if (started) {
      this.setStatusHint('À l\'écoute…');
      void this.syncBackgroundListening();
    } else {
      this.setStatusHint('Impossible de démarrer le micro');
    }
    return started;
  }

  private async pauseListening(): Promise<void> {
    this.sttPaused = true;
    if (this.engine) {
      await this.engine.stop();
    }
    this.listeningActive = false;
    this.updateListeningState(false);
  }

  private async resumeListening(): Promise<void> {
    this.sttPaused = false;
    if (this.state !== 'off') {
      await this.activateListening();
    }
  }

  private async stop(): Promise<void> {
    this.state = 'off';
    this.listeningActive = false;
    this.sttPaused = false;
    this.clearSilenceTimer();
    void stopMerlinSpeech();
    if (Capacitor.isNativePlatform()) {
      const { destroyMerlinBackground } = await import('./merlin-background');
      await destroyMerlinBackground();
      this.backgroundActive = false;
    }
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
      this.setStatusHint('Micro refusé');
      return;
    }
    if (code === 'restart-failed' || code === 'start-failed') {
      this.setStatusHint('Impossible de démarrer le micro');
      return;
    }
    this.setStatusHint(`Erreur : ${code}`);
  }

  private async onVisibilityChange(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await this.syncBackgroundListening();
      return;
    }

    if (
      document.visibilityState === 'visible' &&
      this.state !== 'off' &&
      !this.listeningActive &&
      !this.sttPaused &&
      this.engine
    ) {
      await this.engine.start();
    }
  }

  private handleTranscript(raw: string): void {
    if (this.state === 'speaking' || this.state === 'processing') {
      void this.interruptSpeech();
      return;
    }

    const full = raw.trim();
    if (!full) return;

    if (this.state === 'idle') {
      const intent = parseWakeIntent(full);
      if (intent === 'journal') {
        void this.startDictation();
        return;
      }
      if (intent === 'assistant' && this.tabBar.getActiveTab() === 'merlin') {
        const query = extractAssistantQuery(full);
        void this.startConversing(query || undefined);
      }
      return;
    }

    if (this.state === 'conversing') {
      if (matchesPhrase(full, STOP_PHRASES)) {
        void this.endConversing();
        return;
      }
      this.processConversingTranscript(full);
      return;
    }

    if (this.state === 'dictating') {
      const stripped = stripCommands(full);
      if (matchesPhrase(full, STOP_PHRASES)) {
        void this.endDictation();
        return;
      }
      if (!stripped) return;
      this.processDictationTranscript(stripped);
    }
  }

  private processDictationTranscript(hypothesis: string): void {
    if (!hypothesis) return;
    if (hypothesis === this.lastHypothesis) return;
    this.lastHypothesis = hypothesis;

    const delta = extractTranscriptDelta(this.sessionText, hypothesis);
    if (delta) {
      this.commitDictationSpeech(delta);
    }
  }

  private processConversingTranscript(hypothesis: string): void {
    if (!hypothesis) return;
    if (hypothesis === this.conversingHypothesis) return;
    this.conversingHypothesis = hypothesis;

    const query = extractAssistantQuery(hypothesis);
    if (!query) return;

    this.conversingText = query;
    this.heardSpeechInSession = true;
    this.resetSilenceTimer(CONVERSING_SILENCE_MS);
  }

  private commitDictationSpeech(text: string): void {
    const cleaned = collapseStutter(text.trim());
    if (!cleaned) return;

    this.heardSpeechInSession = true;
    this.resetSilenceTimer(DICTATION_SILENCE_MS);
    this.sessionText += (this.sessionText ? ' ' : '') + cleaned;
    void this.journal.appendToToday(cleaned);
  }

  private async startConversing(initialQuery?: string): Promise<void> {
    const ok = await this.activateListening();
    if (!ok) return;

    this.state = 'conversing';
    this.conversingText = initialQuery ?? '';
    this.conversingHypothesis = '';
    this.heardSpeechInSession = !!initialQuery?.trim();
    this.clearSilenceTimer();
    this.tabBar.switchTo('merlin');
    this.showOverlay('conversing');
    await this.requestWakeLock();

    if (initialQuery?.trim()) {
      this.resetSilenceTimer(CONVERSING_SILENCE_MS);
    } else {
      this.setStatusHint('Je vous écoute…');
      await this.pauseListening();
      await speakMerlin(WAKE_ACK);
      if (this.state === 'conversing') {
        await this.resumeListening();
      }
    }
  }

  private async submitConversing(): Promise<void> {
    const text = this.conversingText.trim();
    if (!text) {
      this.conversingHypothesis = '';
      this.setStatusHint('Je n\'ai rien entendu');
      return;
    }

    this.state = 'processing';
    this.clearSilenceTimer();
    this.showOverlay('processing');
    this.setStatusHint('Merlin réfléchit…');
    await this.pauseListening();

    const result = await handleUserMessage(text);

    if (!result.ok) {
      this.state = 'conversing';
      this.showOverlay('conversing');
      const err = result.error ?? 'Erreur';
      this.setStatusHint(err);
      await this.resumeListening();
      return;
    }

    await this.merlinChat?.refresh();
    this.onConversationUpdate?.();
    this.conversingText = '';
    this.conversingHypothesis = '';
    this.heardSpeechInSession = false;

    if (result.content) {
      await this.speakResponse(result.content);
    }

    this.state = 'conversing';
    this.showOverlay('conversing');
    this.setStatusHint('Je vous écoute…');
    await this.resumeListening();
  }

  private async speakResponse(text: string): Promise<void> {
    this.state = 'speaking';
    this.showOverlay('speaking');
    this.setStatusHint('Merlin parle…');
    await this.pauseListening();

    const spoke = await speakMerlin(text);
    if (!spoke && this.state === 'speaking') {
      this.setStatusHint('Réponse affichée (TTS indisponible)');
    }
  }

  private async interruptSpeech(): Promise<void> {
    if (!isMerlinSpeaking() && this.state !== 'speaking' && this.state !== 'processing') {
      return;
    }
    await stopMerlinSpeech();
    if (this.state === 'speaking' || this.state === 'processing') {
      this.state = 'conversing';
      this.showOverlay('conversing');
      this.setStatusHint('Interrompu — je vous écoute');
      await this.resumeListening();
    }
  }

  private async endConversing(): Promise<void> {
    this.state = 'idle';
    this.conversingText = '';
    this.conversingHypothesis = '';
    this.heardSpeechInSession = false;
    this.clearSilenceTimer();
    await stopMerlinSpeech();
    await this.releaseWakeLock();
    this.setStatusHint('Dites « Merlin » ou « Merlin journal »');

    if (this.tabBar.getActiveTab() === 'merlin') {
      this.showOverlay('idle');
      await this.resumeListening();
    } else {
      await this.pauseListening();
      this.hideOverlay();
    }
    await this.syncBackgroundListening();
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
      this.setStatusHint('Dites « Merlin » ou « Merlin journal »');
    }
    await this.syncBackgroundListening();
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
      this.setStatusHint('Dites « Merlin » ou « Merlin journal »');
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
    this.setStatusHint('Dites « Merlin » ou « Merlin journal »');
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
    this.setStatusHint('Dites « Merlin » ou « Merlin journal »');
  }

  private resetSilenceTimer(timeoutMs: number): void {
    if (!this.heardSpeechInSession) return;

    this.clearSilenceTimer();
    this.silenceCountdown = timeoutMs / 1000;

    this.silenceTimer = setInterval(() => {
      this.silenceCountdown -= 1;
      if (this.silenceCountdown <= 0) {
        if (this.state === 'dictating') {
          void this.endDictation();
        } else if (this.state === 'conversing') {
          void this.submitConversing();
        }
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

  private showOverlay(mode: OverlayMode): void {
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'merlin';
      this.overlay.innerHTML = `
        <div class="merlin__panel">
          <p class="merlin__status" aria-live="polite"></p>
          <div class="merlin__wave" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <button type="button" class="merlin__mic-btn" aria-label="Parler à Merlin">🎙</button>
          <button type="button" class="merlin__stop-btn" hidden aria-label="Arrêter">Stop</button>
          <button type="button" class="merlin__interrupt-btn" hidden aria-label="Interrompre">Interrompre</button>
        </div>
      `;

      this.overlay.querySelector('.merlin__mic-btn')!.addEventListener('click', () => {
        void this.onMicPressed();
      });
      this.overlay.querySelector('.merlin__stop-btn')!.addEventListener('click', () => {
        if (this.state === 'dictating') {
          void this.endDictation();
        } else if (this.state === 'conversing') {
          void this.endConversing();
        }
      });
      this.overlay.querySelector('.merlin__interrupt-btn')!.addEventListener('click', () => {
        void this.interruptSpeech();
      });

      document.body.appendChild(this.overlay);
    }

    const micBtn = this.overlay.querySelector('.merlin__mic-btn') as HTMLButtonElement;
    const stopBtn = this.overlay.querySelector('.merlin__stop-btn') as HTMLButtonElement;
    const interruptBtn = this.overlay.querySelector(
      '.merlin__interrupt-btn',
    ) as HTMLButtonElement;

    this.overlay.classList.remove(
      'merlin--dictating',
      'merlin--conversing',
      'merlin--processing',
      'merlin--speaking',
    );

    if (mode === 'dictating') this.overlay.classList.add('merlin--dictating');
    if (mode === 'conversing') this.overlay.classList.add('merlin--conversing');
    if (mode === 'processing') this.overlay.classList.add('merlin--processing');
    if (mode === 'speaking') this.overlay.classList.add('merlin--speaking');

    micBtn.hidden = mode !== 'idle';
    stopBtn.hidden = mode !== 'dictating' && mode !== 'conversing';
    interruptBtn.hidden = mode !== 'speaking' && mode !== 'processing';
  }

  private async onMicPressed(): Promise<void> {
    if (this.state === 'speaking' || this.state === 'processing') {
      await this.interruptSpeech();
      return;
    }
    if (this.state === 'conversing' || this.state === 'dictating') return;

    const ok = await this.activateListening();
    if (!ok) return;
    await this.startConversing();
  }

  private hideOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private updateListeningState(active: boolean): void {
    this.overlay?.classList.toggle('merlin--listening', active);
  }

  private setStatusHint(hint: string): void {
    const status = this.overlay?.querySelector<HTMLElement>('.merlin__status');
    if (status) status.textContent = hint;
    const btn = this.overlay?.querySelector<HTMLButtonElement>('.merlin__mic-btn');
    if (btn) btn.title = hint;
  }

  destroy(): void {
    void this.stop();
  }
}
