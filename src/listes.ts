import {
  deleteMerlinList,
  getMerlinList,
  getMerlinLists,
  saveMerlinList,
} from './db';
import { createEntityId } from './merlin-tools';
import { syncNow } from './sync';
import type { MerlinList } from './types';

export interface ListesPageOptions {
  embedded?: boolean;
  onUpdate?: () => void;
}

export class ListesPage {
  private container: HTMLElement;
  private scrollEl: HTMLElement | null = null;
  private embedded: boolean;
  private onUpdate?: () => void;

  constructor(container: HTMLElement, options: ListesPageOptions = {}) {
    this.container = container;
    this.embedded = options.embedded ?? false;
    this.onUpdate = options.onUpdate;
  }

  async init(): Promise<void> {
    this.container.innerHTML = '';
    this.container.classList.add('listes-page');
    if (!this.embedded) {
      this.container.classList.add('tab-panel');
    }

    const header = document.createElement('header');
    header.className = 'listes-page__header';
    header.innerHTML = `
      <h2 class="listes-page__title">Listes</h2>
      <p class="listes-page__subtitle">Courses, tâches et listes créées par Merlin</p>
    `;

    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'listes-page__scroll';

    const createForm = document.createElement('form');
    createForm.className = 'listes-page__create';
    createForm.innerHTML = `
      <input type="text" class="listes-page__input" name="title" placeholder="Nouvelle liste…" autocomplete="off" />
      <button type="submit" class="btn btn--primary btn--sm">Créer</button>
    `;
    createForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = createForm.querySelector('input')!;
      const title = input.value.trim();
      if (!title) return;
      void this.handleCreateList(title).then(() => {
        input.value = '';
      });
    });

    this.container.appendChild(header);
    this.container.appendChild(this.scrollEl);
    this.container.insertBefore(createForm, this.scrollEl);

    await this.render();
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    if (!this.scrollEl) return;

    const lists = await getMerlinLists();
    lists.sort((a, b) => b.updatedAt - a.updatedAt);

    if (lists.length === 0) {
      this.scrollEl.innerHTML = `
        <p class="listes-page__empty">
          Aucune liste pour le moment.<br>
          Créez-en une ci-dessus ou dites à Merlin : « ajoute du lait à courses ».
        </p>
      `;
      return;
    }

    this.scrollEl.innerHTML = lists.map((list) => this.renderListCard(list)).join('');

    this.scrollEl.querySelectorAll('[data-action="toggle-item"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        void this.handleToggleItem(
          (btn as HTMLElement).dataset.listId!,
          (btn as HTMLElement).dataset.itemId!,
        );
      });
    });

    this.scrollEl.querySelectorAll('[data-action="delete-list"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        void this.handleDeleteList((btn as HTMLElement).dataset.listId!);
      });
    });

    this.scrollEl.querySelectorAll('.listes-page__add-form').forEach((form) => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const el = form as HTMLFormElement;
        const listId = el.dataset.listId!;
        const input = el.querySelector('input')!;
        const text = input.value.trim();
        if (!text) return;
        void this.handleAddItem(listId, text).then(() => {
          input.value = '';
        });
      });
    });
  }

  private renderListCard(list: MerlinList): string {
    const pending = list.items.filter((i) => !i.done);
    const done = list.items.filter((i) => i.done);
    const total = list.items.length;

    const renderItem = (item: MerlinList['items'][0], checked: boolean) =>
      `<li class="listes-page__item${checked ? ' listes-page__item--done' : ''}">
        <button
          type="button"
          class="listes-page__item-btn"
          data-action="toggle-item"
          data-list-id="${list.id}"
          data-item-id="${item.id}"
          aria-pressed="${checked ? 'true' : 'false'}"
        >
          <span class="listes-page__check" aria-hidden="true">${checked ? '✓' : '○'}</span>
          <span class="listes-page__item-text">${escapeHtml(item.text)}</span>
        </button>
      </li>`;

    const itemsHtml =
      total === 0
        ? '<p class="listes-page__no-items">Liste vide</p>'
        : `<ul class="listes-page__items">
            ${pending.map((item) => renderItem(item, false)).join('')}
            ${done.map((item) => renderItem(item, true)).join('')}
          </ul>`;

    return `
      <section class="listes-page__card" data-list-id="${list.id}">
        <div class="listes-page__card-header">
          <div>
            <h3 class="listes-page__card-title">${escapeHtml(list.title)}</h3>
            <p class="listes-page__card-meta">
              ${pending.length} restant${pending.length !== 1 ? 's' : ''}
              ${total > 0 ? ` · ${total} article${total !== 1 ? 's' : ''}` : ''}
            </p>
          </div>
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            data-action="delete-list"
            data-list-id="${list.id}"
            aria-label="Supprimer la liste ${escapeHtml(list.title)}"
          >Suppr.</button>
        </div>
        ${itemsHtml}
        <form class="listes-page__add-form" data-list-id="${list.id}">
          <input type="text" class="listes-page__input" placeholder="Ajouter un article…" autocomplete="off" />
          <button type="submit" class="btn btn--ghost btn--sm">Ajouter</button>
        </form>
      </section>
    `;
  }

  private async handleCreateList(title: string): Promise<void> {
    const lists = await getMerlinLists();
    const normalized = title.trim().toLowerCase();
    const existing = lists.find((l) => l.title.toLowerCase() === normalized);
    if (existing) {
      await this.render();
      return;
    }

    const now = Date.now();
    await saveMerlinList({
      id: createEntityId(),
      title: title.trim(),
      items: [],
      createdAt: now,
      updatedAt: now,
    });
    this.onUpdate?.();
    await this.render();
  }

  private async handleAddItem(listId: string, text: string): Promise<void> {
    const list = await getMerlinList(listId);
    if (!list) return;

    const now = Date.now();
    list.items.push({
      id: createEntityId(),
      text,
      done: false,
      createdAt: now,
      updatedAt: now,
    });
    await saveMerlinList(list);
    this.onUpdate?.();
    await this.render();
  }

  private async handleToggleItem(listId: string, itemId: string): Promise<void> {
    const list = await getMerlinList(listId);
    if (!list) return;
    const item = list.items.find((i) => i.id === itemId);
    if (!item) return;

    item.done = !item.done;
    item.updatedAt = Date.now();
    await saveMerlinList(list);
    this.onUpdate?.();
    await this.render();
  }

  private async handleDeleteList(listId: string): Promise<void> {
    const list = await getMerlinList(listId);
    if (!list) return;
    if (!confirm(`Supprimer la liste « ${list.title} » ?`)) return;

    await deleteMerlinList(listId);
    this.onUpdate?.();
    await this.render();
    void syncNow();
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
