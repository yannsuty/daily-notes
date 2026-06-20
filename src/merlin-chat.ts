import {
  getActiveLists,
  getMerlinConversation,
  getPendingReminders,
  saveMerlinList,
  saveMerlinReminder,
} from './db';
import { CONTEXT_CHIPS, likelyFastPath } from './merlin-intents';
import { createMessageId, getWelcomeMessage, handleUserMessage } from './merlin-agent';
import { getPaletteShortcuts, toggleShortcutPin } from './merlin-shortcuts';
import { getMerlinTtsPrefs, speakMerlin } from './merlin-tts';
import {
  cancelPendingAutomation,
  confirmPendingAutomation,
  getPendingAutomation,
} from './merlin-pending-action';
import { appendMerlinMessage } from './db';
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
  private confirmEl: HTMLElement | null = null;
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
      <div class="merlin-chat__banner" hidden role="status"></div>
      <details class="merlin-chat__actions-panel" open>
        <summary class="merlin-chat__actions-title">Mes actions</summary>
        <div class="merlin-chat__actions-body"></div>
      </details>
      <div class="merlin-chat__messages" role="log" aria-live="polite" aria-label="Conversation avec Merlin"></div>
      <div class="merlin-chat__palette" role="toolbar" aria-label="Actions rapides"></div>
      <div class="merlin-chat__status" aria-live="polite"></div>
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
    this.actionsEl = this.container.querySelector('.merlin-chat__actions-body');
    this.messagesEl = this.container.querySelector('.merlin-chat__messages');
    this.paletteEl = this.container.querySelector('.merlin-chat__palette');
    this.inputEl = this.container.querySelector('.merlin-chat__input');
    this.sendBtn = this.container.querySelector('.merlin-chat__send');
    this.voiceBtn = this.container.querySelector('.merlin-chat__voice');
    this.statusEl = this.container.querySelector('.merlin-chat__status');

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
  }

  async refresh(): Promise<void> {
    await this.renderAll();
  }

  private async renderAll(): Promise<void> {
    await Promise.all([this.renderMessages(), this.renderActionsPanel(), this.renderPalette()]);
  }

  private async renderActionsPanel(): Promise<void> {
    if (!this.actionsEl) return;

    const [lists, reminders] = await Promise.all([getActiveLists(), getPendingReminders()]);
    const parts: string[] = [];

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
        '<p class="merlin-actions__empty">Aucune liste ni rappel actif. Dites par ex. « ajoute du lait à courses » ou « rappelle-moi à midi ».</p>';
    } else {
      this.actionsEl.innerHTML = parts.join('');
    }

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
    this.renderConfirmPanel();
  }

  private appendBubble(role: MerlinMessage['role'] | 'assistant', content: string, id: string): void {
    if (!this.messagesEl) return;

    const bubble = document.createElement('div');
    bubble.className = `merlin-chat__bubble merlin-chat__bubble--${role}`;
    bubble.dataset.messageId = id;

    const label = document.createElement('span');
    label.className = 'merlin-chat__label';
    label.textContent = role === 'user' ? 'Vous' : 'Merlin';

    const text = document.createElement('div');
    text.className = 'merlin-chat__text';
    text.textContent = content;

    bubble.appendChild(label);
    bubble.appendChild(text);
    this.messagesEl.appendChild(bubble);
  }

  private renderConfirmPanel(): void {
    this.confirmEl?.remove();
    this.confirmEl = null;

    const pending = getPendingAutomation();
    if (!pending || !this.messagesEl) return;

    const panel = document.createElement('div');
    panel.className = 'merlin-chat__confirm';
    panel.dataset.pendingId = pending.id;
    panel.innerHTML = `
      <p class="merlin-chat__confirm-label">Action en attente de confirmation</p>
      <h4 class="merlin-chat__confirm-title">${escapeHtml(pending.summary.title)}</h4>
      <p class="merlin-chat__confirm-detail">${escapeHtml(pending.summary.detail)}</p>
      <p class="merlin-chat__confirm-hint">Dites « oui » ou « non », ou utilisez les boutons.</p>
      <div class="merlin-chat__confirm-actions">
        <button type="button" class="btn btn--ghost merlin-chat__confirm-cancel">Annuler</button>
        <button type="button" class="btn btn--primary merlin-chat__confirm-ok">Confirmer</button>
      </div>
    `;

    panel.querySelector('.merlin-chat__confirm-ok')!.addEventListener('click', () => {
      void this.handleConfirmPending();
    });
    panel.querySelector('.merlin-chat__confirm-cancel')!.addEventListener('click', () => {
      void this.handleCancelPending();
    });

    this.messagesEl.appendChild(panel);
    this.confirmEl = panel;
    this.scrollToBottom();
  }

  private async handleConfirmPending(): Promise<void> {
    if (this.thinking || !getPendingAutomation()) return;

    this.setThinking(true, 'Merlin exécute…');
    const result = await confirmPendingAutomation();
    await appendMerlinMessage({
      id: createMessageId(),
      role: 'assistant',
      content: result.content,
      createdAt: Date.now(),
    });
    this.setThinking(false);
    await this.renderAll();
    this.onConversationUpdate?.();

    const prefs = await getMerlinTtsPrefs();
    if (prefs.enabled) {
      await speakMerlin(result.content);
    }
  }

  private async handleCancelPending(): Promise<void> {
    if (this.thinking || !getPendingAutomation()) return;

    const reply = cancelPendingAutomation();
    await appendMerlinMessage({
      id: createMessageId(),
      role: 'assistant',
      content: reply,
      createdAt: Date.now(),
    });
    await this.renderAll();
    this.onConversationUpdate?.();

    const prefs = await getMerlinTtsPrefs();
    if (prefs.enabled) {
      await speakMerlin(reply);
    }
  }

  private setThinking(active: boolean, message = ''): void {
    this.thinking = active;
    if (this.sendBtn) this.sendBtn.disabled = active;
    if (this.voiceBtn) this.voiceBtn.disabled = active;
    if (this.inputEl) this.inputEl.disabled = active;
    if (this.statusEl) {
      this.statusEl.textContent = message;
      this.statusEl.hidden = !message;
    }
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

    this.appendBubble('user', trimmed, `pending-${Date.now()}`);
    this.scrollToBottom();
    this.setThinking(true, likelyFastPath(trimmed) ? 'Merlin agit…' : 'Merlin réfléchit…');

    const result = await handleUserMessage(trimmed);

    this.setThinking(false);

    if (!result.ok) {
      const errMsg = result.error ?? 'Erreur inconnue';
      const offline = !navigator.onLine;
      this.setAiBanner(!!result.aiUnavailable);
      this.showError(
        offline
          ? 'Hors ligne — connectez-vous pour discuter avec Merlin.'
          : errMsg,
      );
      await this.renderMessages();
      return;
    }

    this.setAiBanner(false);
    await this.renderAll();
    this.onConversationUpdate?.();

    if (result.content) {
      const prefs = await getMerlinTtsPrefs();
      if (prefs.enabled) {
        this.setThinking(true, 'Merlin parle…');
        await speakMerlin(result.content);
        this.setThinking(false);
      }
    }

    if (result.pendingAutomation) {
      this.renderConfirmPanel();
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
