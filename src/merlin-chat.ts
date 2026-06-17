import { getMerlinConversation } from './db';
import { getWelcomeMessage, handleUserMessage } from './merlin-agent';
import type { MerlinMessage } from './types';

export interface MerlinChatOptions {
  container: HTMLElement;
  onConversationUpdate?: () => void;
}

export class MerlinChat {
  private container: HTMLElement;
  private onConversationUpdate?: () => void;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private thinking = false;

  constructor(options: MerlinChatOptions) {
    this.container = options.container;
    this.onConversationUpdate = options.onConversationUpdate;
  }

  async init(): Promise<void> {
    this.container.className = 'merlin-chat';
    this.container.innerHTML = `
      <div class="merlin-chat__messages" role="log" aria-live="polite" aria-label="Conversation avec Merlin"></div>
      <div class="merlin-chat__status" aria-live="polite"></div>
      <form class="merlin-chat__composer">
        <textarea
          class="merlin-chat__input"
          rows="1"
          placeholder="Écrivez à Merlin…"
          aria-label="Message à Merlin"
        ></textarea>
        <button type="submit" class="merlin-chat__send" aria-label="Envoyer">➤</button>
      </form>
    `;

    this.messagesEl = this.container.querySelector('.merlin-chat__messages');
    this.inputEl = this.container.querySelector('.merlin-chat__input');
    this.sendBtn = this.container.querySelector('.merlin-chat__send');
    this.statusEl = this.container.querySelector('.merlin-chat__status');

    const form = this.container.querySelector('.merlin-chat__composer') as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.send();
    });

    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });

    await this.renderMessages();
  }

  async refresh(): Promise<void> {
    await this.renderMessages();
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

  private setThinking(active: boolean, message = ''): void {
    this.thinking = active;
    if (this.sendBtn) this.sendBtn.disabled = active;
    if (this.inputEl) this.inputEl.disabled = active;
    if (this.statusEl) {
      this.statusEl.textContent = message;
      this.statusEl.hidden = !message;
    }
  }

  private async send(): Promise<void> {
    if (this.thinking || !this.inputEl) return;

    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = '';
    this.appendBubble('user', text, `pending-${Date.now()}`);
    this.scrollToBottom();
    this.setThinking(true, 'Merlin réfléchit…');

    const result = await handleUserMessage(text);

    this.setThinking(false);

    if (!result.ok) {
      const errMsg = result.error ?? 'Erreur inconnue';
      const offline = !navigator.onLine;
      this.showError(
        offline
          ? 'Hors ligne — connectez-vous pour discuter avec Merlin.'
          : errMsg,
      );
      await this.renderMessages();
      return;
    }

    await this.renderMessages();
    this.onConversationUpdate?.();
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
