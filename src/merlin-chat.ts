import {
  getActiveLists,
  getActiveSpaces,
  getMerlinConversation,
  getMerlinSpace,
  getPendingReminders,
  saveMerlinList,
  saveMerlinReminder,
} from './db';
import { SPACE_KIND_LABELS } from './merlin-space-format';
import {
  getActiveSpaceId,
  onActiveSpaceChange,
  setActiveSpaceId,
} from './merlin-space-session';
import { CONTEXT_CHIPS } from './merlin-intents';
import { getWelcomeMessage, createMessageId, handleUserMessage } from './merlin-agent';
import { stepLabelForUi } from './merlin-agent-client';
import { listPendingAgentJobs, appendPendingJobStep } from './merlin-agent-jobs';
import { abandonPendingAgentJobs, loadPendingJobProgress } from './merlin-agent-resume';
import { assessQueryDepth } from '../lib/merlin-agent';
import type { AgentStep } from '../lib/merlin-agent';
import { formatAgentReplyForUser } from '../lib/merlin-agent/parse';
import { getPaletteShortcuts, toggleShortcutPin } from './merlin-shortcuts';
import { renderMarkdownToHtml } from './markdown';
import { getMerlinTtsPrefs, speakMerlin } from './merlin-tts';
import type { MerlinMessage } from './types';

export interface MerlinChatOptions {
  container: HTMLElement;
  onConversationUpdate?: () => void;
  onVoiceRequest?: () => void;
}

export class MerlinChat {
  private container: HTMLElement;
  private onConversationUpdate?: () => void;
  private onVoiceRequest?: () => void;
  private messagesEl: HTMLElement | null = null;
  private actionsEl: HTMLElement | null = null;
  private paletteEl: HTMLElement | null = null;
  private bannerEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private voiceBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private traceEl: HTMLElement | null = null;
  private contextEl: HTMLElement | null = null;
  private backgroundEl: HTMLElement | null = null;
  private thinking = false;

  constructor(options: MerlinChatOptions) {
    this.container = options.container;
    this.onConversationUpdate = options.onConversationUpdate;
    this.onVoiceRequest = options.onVoiceRequest;
  }

  async init(): Promise<void> {
    this.container.innerHTML = '';
    this.container.classList.add('merlin-chat', 'tab-panel');
    this.container.innerHTML = `
      <div class="merlin-chat__context" hidden role="status"></div>
      <div class="merlin-chat__banner" hidden role="status"></div>
      <details class="merlin-chat__actions-panel" open>
        <summary class="merlin-chat__actions-title">Mes actions</summary>
        <div class="merlin-chat__actions-body"></div>
      </details>
      <div class="merlin-chat__messages" role="log" aria-live="polite" aria-label="Conversation avec Merlin"></div>
      <div class="merlin-chat__palette" role="toolbar" aria-label="Actions rapides"></div>
      <div class="merlin-chat__background" hidden role="status">
        <span class="merlin-chat__background-text">Merlin réfléchit en arrière-plan…</span>
        <button type="button" class="merlin-chat__background-dismiss">Ignorer</button>
      </div>
      <div class="merlin-chat__status" aria-live="polite"></div>
      <div class="merlin-chat__trace" hidden aria-live="polite"></div>
      <form class="merlin-chat__composer">
        <button type="button" class="merlin-chat__voice" aria-label="Parler à Merlin" title="Parler à Merlin">🎙</button>
        <textarea
          class="merlin-chat__input"
          rows="1"
          placeholder="Écrivez à Merlin…"
          aria-label="Message à Merlin"
        ></textarea>
        <button type="submit" class="merlin-chat__send" aria-label="Envoyer">➤</button>
      </form>
    `;

    this.bannerEl = this.container.querySelector('.merlin-chat__banner');
    this.contextEl = this.container.querySelector('.merlin-chat__context');
    this.actionsEl = this.container.querySelector('.merlin-chat__actions-body');
    this.messagesEl = this.container.querySelector('.merlin-chat__messages');
    this.paletteEl = this.container.querySelector('.merlin-chat__palette');
    this.inputEl = this.container.querySelector('.merlin-chat__input');
    this.sendBtn = this.container.querySelector('.merlin-chat__send');
    this.voiceBtn = this.container.querySelector('.merlin-chat__voice');
    this.statusEl = this.container.querySelector('.merlin-chat__status');
    this.backgroundEl = this.container.querySelector('.merlin-chat__background');
    this.traceEl = this.container.querySelector('.merlin-chat__trace');

    this.container.querySelector('.merlin-chat__background-dismiss')?.addEventListener('click', () => {
      void this.dismissBackgroundJob();
    });

    const form = this.container.querySelector('.merlin-chat__composer') as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.send();
    });

    this.voiceBtn?.addEventListener('click', () => {
      this.onVoiceRequest?.();
    });

    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });

    await this.renderAll();

    onActiveSpaceChange(() => {
      void this.renderContextBanner();
      void this.renderActionsPanel();
    });
  }

  async refresh(): Promise<void> {
    await this.renderAll();
    this.syncBackgroundStatus();
  }

  syncBackgroundStatus(): void {
    if (listPendingAgentJobs().length > 0) {
      this.setBackgroundPending();
      void this.loadBackgroundJobTrace();
    } else {
      this.setBackgroundComplete();
    }
  }

  async loadBackgroundJobTrace(): Promise<void> {
    const jobs = listPendingAgentJobs();
    if (jobs.length === 0) {
      this.clearAgentTrace();
      return;
    }

    const job = jobs[jobs.length - 1];
    await loadPendingJobProgress(job.jobId, {
      onStepsBatch: (steps) => this.renderAgentSteps(steps),
      onStep: (step) => this.renderAgentStep(step),
    });
  }

  private async dismissBackgroundJob(): Promise<void> {
    await abandonPendingAgentJobs();
    this.clearAgentTrace();
    this.setBackgroundComplete();
    await this.renderMessages();
    this.onConversationUpdate?.();
  }

  private async renderAll(): Promise<void> {
    await Promise.all([
      this.renderMessages(),
      this.renderActionsPanel(),
      this.renderPalette(),
      this.renderContextBanner(),
    ]);
  }

  private async renderContextBanner(): Promise<void> {
    if (!this.contextEl) return;

    const activeId = getActiveSpaceId();
    if (!activeId) {
      this.contextEl.hidden = true;
      this.contextEl.innerHTML = '';
      return;
    }

    const space = await getMerlinSpace(activeId);
    if (!space || space.status !== 'active') {
      setActiveSpaceId(null);
      this.contextEl.hidden = true;
      return;
    }

    this.contextEl.hidden = false;
    this.contextEl.innerHTML = `
      <span class="merlin-chat__context-label">Contexte :</span>
      <span class="merlin-chat__context-badge">${escapeHtml(SPACE_KIND_LABELS[space.kind])}</span>
      <span class="merlin-chat__context-title">${escapeHtml(space.title)}</span>
      <button type="button" class="merlin-chat__context-clear" data-action="clear-context" aria-label="Quitter le contexte">✕</button>
    `;

    this.contextEl.querySelector('[data-action="clear-context"]')?.addEventListener('click', () => {
      setActiveSpaceId(null);
      void this.renderContextBanner();
      void this.renderActionsPanel();
    });
  }

  private async renderActionsPanel(): Promise<void> {
    if (!this.actionsEl) return;

    const [lists, reminders, spaces] = await Promise.all([
      getActiveLists(),
      getPendingReminders(),
      getActiveSpaces(),
    ]);
    const parts: string[] = [];

    const activeSpaceId = getActiveSpaceId();
    const recentSpaces = spaces
      .filter((s) => s.id !== activeSpaceId)
      .slice(0, 4);

    if (recentSpaces.length > 0) {
      parts.push(`<div class="merlin-actions__group">
        <h4 class="merlin-actions__heading">Espaces récents</h4>
        <ul class="merlin-actions__list">
          ${recentSpaces
            .map(
              (s) =>
                `<li><button type="button" class="merlin-actions__item" data-action="focus-space" data-space-id="${s.id}">📁 ${escapeHtml(s.title)} <span class="merlin-actions__meta">${escapeHtml(SPACE_KIND_LABELS[s.kind])}</span></button></li>`,
            )
            .join('')}
        </ul>
      </div>`);
    }

    if (lists.length > 0) {
      for (const list of lists) {
        const pending = list.items.filter((i) => !i.done);
        if (pending.length === 0) continue;
        parts.push(`<div class="merlin-actions__group">
          <h4 class="merlin-actions__heading">${escapeHtml(list.title)}</h4>
          <ul class="merlin-actions__list">
            ${pending
              .map(
                (item) =>
                  `<li><button type="button" class="merlin-actions__item" data-action="toggle-item" data-list-id="${list.id}" data-item-id="${item.id}">○ ${escapeHtml(item.text)}</button></li>`,
              )
              .join('')}
          </ul>
        </div>`);
      }
    }

    const timeReminders = reminders.filter((r) => r.trigger.kind === 'time').slice(0, 5);
    const contextReminders = reminders.filter((r) => r.trigger.kind === 'context').slice(0, 5);

    if (timeReminders.length > 0) {
      parts.push(`<div class="merlin-actions__group">
        <h4 class="merlin-actions__heading">Rappels</h4>
        <ul class="merlin-actions__list">
          ${timeReminders
            .map((r) => {
              const when =
                r.trigger.kind === 'time'
                  ? r.trigger.timeOfDay ?? (r.trigger.at ? new Date(r.trigger.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '')
                  : '';
              return `<li><button type="button" class="merlin-actions__item" data-action="complete-reminder" data-reminder-id="${r.id}">⏰ ${escapeHtml(r.text)}${when ? ` <span class="merlin-actions__meta">${when}</span>` : ''}</button></li>`;
            })
            .join('')}
        </ul>
      </div>`);
    }

    if (contextReminders.length > 0) {
      parts.push(`<div class="merlin-actions__group">
        <h4 class="merlin-actions__heading">Rappels contextuels</h4>
        <ul class="merlin-actions__list">
          ${contextReminders
            .map(
              (r) =>
                `<li><span class="merlin-actions__item merlin-actions__item--static">📍 ${escapeHtml(r.text)} <span class="merlin-actions__meta">${r.trigger.kind === 'context' ? r.trigger.tags.join(', ') : ''}</span></span></li>`,
            )
            .join('')}
        </ul>
      </div>`);
    }

    if (parts.length === 0) {
      this.actionsEl.innerHTML =
        '<p class="merlin-actions__empty">Aucune liste ni espace actif. Dites par ex. « compare ces produits » ou « ajoute du lait à courses ».</p>';
    } else {
      this.actionsEl.innerHTML = parts.join('');
    }

    this.actionsEl.querySelectorAll('[data-action="focus-space"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setActiveSpaceId((btn as HTMLElement).dataset.spaceId!);
        void this.renderContextBanner();
        void this.renderActionsPanel();
      });
    });

    this.actionsEl.querySelectorAll('[data-action="toggle-item"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        void this.handleToggleItem(
          (btn as HTMLElement).dataset.listId!,
          (btn as HTMLElement).dataset.itemId!,
        );
      });
    });

    this.actionsEl.querySelectorAll('[data-action="complete-reminder"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        void this.handleCompleteReminder((btn as HTMLElement).dataset.reminderId!);
      });
    });
  }

  private async handleToggleItem(listId: string, itemId: string): Promise<void> {
    const { getMerlinList } = await import('./db');
    const list = await getMerlinList(listId);
    if (!list) return;
    const item = list.items.find((i) => i.id === itemId);
    if (!item) return;
    item.done = !item.done;
    item.updatedAt = Date.now();
    await saveMerlinList(list);
    await this.renderActionsPanel();
    this.onConversationUpdate?.();
  }

  private async handleCompleteReminder(reminderId: string): Promise<void> {
    const { getMerlinReminder } = await import('./db');
    const reminder = await getMerlinReminder(reminderId);
    if (!reminder) return;
    reminder.status = 'done';
    reminder.updatedAt = Date.now();
    await saveMerlinReminder(reminder);
    const { rescheduleMerlinReminders } = await import('./merlin-scheduler');
    void rescheduleMerlinReminders();
    await this.renderActionsPanel();
    this.onConversationUpdate?.();
  }

  private async renderPalette(): Promise<void> {
    if (!this.paletteEl) return;
    this.paletteEl.innerHTML = '';

    for (const chip of CONTEXT_CHIPS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'merlin-chat__chip merlin-chat__chip--context';
      btn.textContent = chip.label;
      btn.addEventListener('click', () => {
        void this.submitMessage(`je suis ${chip.tags === 'travail' ? 'au travail' : chip.tags === 'maison' ? 'à la maison' : 'aux courses'}`);
      });
      this.paletteEl.appendChild(btn);
    }

    const shortcuts = await getPaletteShortcuts(5);
    for (const shortcut of shortcuts) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'merlin-chat__chip';
      btn.textContent = shortcut.pinned ? `📌 ${shortcut.label}` : shortcut.label;
      btn.title = `${shortcut.prompt}${shortcut.pinned ? ' (épinglé)' : ' — appui long pour épingler'}`;
      btn.addEventListener('click', () => {
        void this.submitMessage(shortcut.prompt);
      });
      let pressTimer: ReturnType<typeof setTimeout> | null = null;
      btn.addEventListener('pointerdown', () => {
        pressTimer = setTimeout(() => {
          void toggleShortcutPin(shortcut.id).then(() => this.renderPalette());
        }, 600);
      });
      btn.addEventListener('pointerup', () => {
        if (pressTimer) clearTimeout(pressTimer);
      });
      btn.addEventListener('pointerleave', () => {
        if (pressTimer) clearTimeout(pressTimer);
      });
      this.paletteEl.appendChild(btn);
    }
  }

  private async renderMessages(): Promise<void> {
    if (!this.messagesEl) return;

    const conv = await getMerlinConversation();
    this.messagesEl.innerHTML = '';

    if (conv.messages.length === 0) {
      const welcome = await getWelcomeMessage();
      this.appendBubble('assistant', welcome, 'welcome');
    } else {
      for (const msg of conv.messages) {
        this.appendBubble(msg.role, msg.content, msg.id);
      }
    }

    this.scrollToBottom();
  }

  private appendBubble(role: MerlinMessage['role'] | 'assistant', content: string, id: string): void {
    if (!this.messagesEl) return;

    const bubble = document.createElement('div');
    bubble.className = `merlin-chat__bubble merlin-chat__bubble--${role}`;
    bubble.dataset.messageId = id;

    const text = document.createElement('div');
    text.className = 'merlin-chat__text';
    if (role === 'assistant') {
      const label = document.createElement('span');
      label.className = 'merlin-chat__label';
      label.textContent = 'Merlin';
      bubble.appendChild(label);

      text.classList.add('merlin-chat__text--markdown');
      text.innerHTML = renderMarkdownToHtml(formatAgentReplyForUser(content));
    } else {
      text.textContent = content;
    }

    bubble.appendChild(text);
    this.messagesEl.appendChild(bubble);
  }

  private setThinking(active: boolean, message = '', options?: { keepTrace?: boolean }): void {
    this.thinking = active;
    if (this.sendBtn) this.sendBtn.disabled = active;
    if (this.voiceBtn) this.voiceBtn.disabled = active;
    if (this.inputEl) this.inputEl.disabled = active;
    if (this.statusEl) {
      this.statusEl.textContent = message;
      this.statusEl.hidden = !message;
    }
    if (!active && this.traceEl && !options?.keepTrace) {
      this.clearAgentTrace();
    }
  }

  setBackgroundComplete(): void {
    this.setThinking(false, '', { keepTrace: true });
    this.clearAgentTrace();
    if (this.backgroundEl) this.backgroundEl.hidden = true;
  }

  setBackgroundPending(): void {
    if (this.backgroundEl) this.backgroundEl.hidden = false;
    // Ne pas bloquer la saisie : l'utilisateur peut continuer à utiliser Merlin.
  }

  renderAgentStep(step: AgentStep): void {
    if (!this.traceEl) return;
    this.traceEl.hidden = false;

    const item = document.createElement('div');
    item.className = `merlin-chat__trace-item merlin-chat__trace-item--${step.phase}`;
    item.textContent = stepLabelForUi(step);
    this.traceEl.appendChild(item);
    this.traceEl.scrollTop = this.traceEl.scrollHeight;

    if (this.statusEl) {
      this.statusEl.textContent = stepLabelForUi(step);
      this.statusEl.hidden = false;
    }
  }

  renderAgentSteps(steps: AgentStep[]): void {
    if (!this.traceEl) return;
    this.traceEl.innerHTML = '';
    if (steps.length === 0) {
      this.traceEl.hidden = true;
      return;
    }
    this.traceEl.hidden = false;
    for (const step of steps) {
      const item = document.createElement('div');
      item.className = `merlin-chat__trace-item merlin-chat__trace-item--${step.phase}`;
      item.textContent = stepLabelForUi(step);
      this.traceEl.appendChild(item);
    }
    this.traceEl.scrollTop = this.traceEl.scrollHeight;
    const latest = steps[steps.length - 1];
    if (this.statusEl && latest) {
      this.statusEl.textContent = stepLabelForUi(latest);
      this.statusEl.hidden = false;
    }
  }

  clearAgentTrace(): void {
    if (!this.traceEl) return;
    this.traceEl.hidden = true;
    this.traceEl.innerHTML = '';
  }

  private setAiBanner(show: boolean): void {
    if (!this.bannerEl) return;
    if (show) {
      this.bannerEl.textContent =
        'Merlin IA indisponible — vos listes et rappels fonctionnent toujours.';
      this.bannerEl.hidden = false;
    } else {
      this.bannerEl.hidden = true;
    }
  }

  private async send(): Promise<void> {
    if (this.thinking || !this.inputEl) return;

    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = '';
    await this.submitMessage(text);
  }

  async submitMessage(text: string): Promise<void> {
    if (this.thinking) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    const userMessageId = createMessageId();
    this.appendBubble('user', trimmed, userMessageId);
    this.scrollToBottom();
    const depth = assessQueryDepth(trimmed);
    this.setThinking(
      true,
      depth === 'deep' ? 'Merlin analyse en profondeur…' : 'Merlin réfléchit…',
    );

    let result: Awaited<ReturnType<typeof handleUserMessage>>;
    try {
      result = await handleUserMessage(trimmed, {
        userMessageId,
        onAgentStep: (step) => {
          this.renderAgentStep(step);
          const jobs = listPendingAgentJobs();
          const job = jobs[jobs.length - 1];
          if (job) appendPendingJobStep(job.jobId, step);
        },
      });
    } catch (err) {
      this.setThinking(false);
      const message = err instanceof Error ? err.message : 'Erreur inattendue';
      this.setAiBanner(true);
      await this.renderMessages();
      this.showError(message);
      return;
    }

    if (result.backgroundPending) {
      this.setThinking(false, '', { keepTrace: true });
    } else {
      this.setThinking(false);
    }

    if (!result.ok) {
      const errMsg = result.error ?? 'Erreur inconnue';
      const offline = !navigator.onLine;
      this.setAiBanner(!!result.aiUnavailable);
      await this.renderMessages();
      this.showError(
        offline
          ? 'Hors ligne — connectez-vous pour discuter avec Merlin.'
          : errMsg,
      );
      return;
    }

    if (result.backgroundPending) {
      this.setAiBanner(false);
      await this.renderAll();
      this.syncBackgroundStatus();
      return;
    }

    if (!result.content?.trim()) {
      this.setAiBanner(true);
      await this.renderMessages();
      this.showError('Merlin n\'a pas renvoyé de réponse. Réessayez ou vérifiez votre connexion.');
      return;
    }

    this.setAiBanner(false);
    await this.renderAll();
    this.onConversationUpdate?.();

    if (result.content) {
      const prefs = await getMerlinTtsPrefs();
      if (prefs.enabled) {
        this.setThinking(true, result.fastPath ? 'Merlin parle…' : 'Merlin parle…');
        await speakMerlin(result.content);
        this.setThinking(false);
      }
    }
  }

  private showError(message: string): void {
    if (!this.messagesEl) return;
    const el = document.createElement('div');
    el.className = 'merlin-chat__error';
    el.textContent = message;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    if (!this.messagesEl) return;
    requestAnimationFrame(() => {
      this.messagesEl!.scrollTop = this.messagesEl!.scrollHeight;
    });
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
