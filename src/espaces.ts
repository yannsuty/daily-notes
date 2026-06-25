import {
  deleteMerlinSpace,
  getMerlinList,
  getMerlinSpace,
  getMerlinSpaces,
  saveMerlinList,
  saveMerlinSpace,
} from './db';
import { normalizeComparisonData } from '../lib/merlin-agent/space-merge';
import { SPACE_KIND_LABELS } from './merlin-space-format';
import { setActiveSpaceId } from './merlin-space-session';
import { renderMarkdownToHtml } from './markdown';
import type { MerlinSpace, MerlinSpaceKind } from './types';

export interface EspacesPageOptions {
  embedded?: boolean;
  onUpdate?: () => void;
  onDiscuss?: (spaceId: string) => void;
}

const KIND_FILTERS: { value: MerlinSpaceKind | 'all'; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'comparison', label: 'Comparaisons' },
  { value: 'diy', label: 'DIY' },
  { value: 'plan', label: 'Plans' },
  { value: 'recipe', label: 'Recettes' },
];

export class EspacesPage {
  private container: HTMLElement;
  private scrollEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;
  private embedded: boolean;
  private onUpdate?: () => void;
  private onDiscuss?: (spaceId: string) => void;
  private filter: MerlinSpaceKind | 'all' = 'all';
  private viewingId: string | null = null;

  constructor(container: HTMLElement, options: EspacesPageOptions = {}) {
    this.container = container;
    this.embedded = options.embedded ?? false;
    this.onUpdate = options.onUpdate;
    this.onDiscuss = options.onDiscuss;
  }

  async init(): Promise<void> {
    this.container.innerHTML = '';
    this.container.classList.add('espaces-page');
    if (!this.embedded) {
      this.container.classList.add('tab-panel');
    }

    const header = document.createElement('header');
    header.className = 'espaces-page__header';
    header.innerHTML = `
      <h2 class="espaces-page__title">Espaces</h2>
      <p class="espaces-page__subtitle">Comparaisons, projets, plans et recettes sauvegardés par Merlin</p>
    `;

    const filters = document.createElement('div');
    filters.className = 'espaces-page__filters';
    filters.setAttribute('role', 'tablist');
    for (const f of KIND_FILTERS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'espaces-page__filter';
      btn.dataset.filter = f.value;
      btn.textContent = f.label;
      if (f.value === this.filter) btn.classList.add('espaces-page__filter--active');
      btn.addEventListener('click', () => {
        this.filter = f.value;
        this.viewingId = null;
        void this.render();
      });
      filters.appendChild(btn);
    }

    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'espaces-page__scroll';

    this.detailEl = document.createElement('div');
    this.detailEl.className = 'espaces-page__detail';
    this.detailEl.hidden = true;

    this.container.appendChild(header);
    this.container.appendChild(filters);
    this.container.appendChild(this.scrollEl);
    this.container.appendChild(this.detailEl);

    await this.render();
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  openSpace(spaceId: string): void {
    this.viewingId = spaceId;
    void this.render();
  }

  private async render(): Promise<void> {
    if (!this.scrollEl || !this.detailEl) return;

    if (this.viewingId) {
      const space = await getMerlinSpace(this.viewingId);
      if (!space) {
        this.viewingId = null;
        return this.render();
      }
      this.scrollEl.hidden = true;
      this.detailEl.hidden = false;
      this.detailEl.innerHTML = await this.renderDetail(space);
      this.bindDetailEvents(space);
      return;
    }

    this.scrollEl.hidden = false;
    this.detailEl.hidden = true;

    let spaces = await getMerlinSpaces();
    spaces = spaces
      .filter((s) => s.status === 'active')
      .sort((a, b) => b.updatedAt - a.updatedAt);

    if (this.filter !== 'all') {
      spaces = spaces.filter((s) => s.kind === this.filter);
    }

    if (spaces.length === 0) {
      this.scrollEl.innerHTML = `
        <p class="espaces-page__empty">
          Aucun espace pour le moment.<br>
          Demandez à Merlin : « compare ces produits », « planifie un projet DIY », « fais-moi une recette de… » ou « aide-moi à planifier ce code ».
        </p>
      `;
      return;
    }

    this.scrollEl.innerHTML = spaces.map((s) => this.renderCard(s)).join('');

    this.scrollEl.querySelectorAll('[data-action="open-space"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.viewingId = (btn as HTMLElement).dataset.spaceId!;
        void this.render();
      });
    });

    this.scrollEl.querySelectorAll('[data-action="discuss-space"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.spaceId!;
        setActiveSpaceId(id);
        this.onDiscuss?.(id);
      });
    });

    this.scrollEl.querySelectorAll('[data-action="delete-space"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.handleDelete((btn as HTMLElement).dataset.spaceId!);
      });
    });
  }

  private renderCard(space: MerlinSpace): string {
    const date = new Date(space.updatedAt).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
    });
    return `
      <article class="espaces-page__card" data-space-id="${space.id}">
        <button type="button" class="espaces-page__card-main" data-action="open-space" data-space-id="${space.id}">
          <span class="espaces-page__badge espaces-page__badge--${space.kind}">${escapeHtml(SPACE_KIND_LABELS[space.kind])}</span>
          <h3 class="espaces-page__card-title">${escapeHtml(space.title)}</h3>
          <p class="espaces-page__card-recap">${escapeHtml(space.recap.slice(0, 140))}${space.recap.length > 140 ? '…' : ''}</p>
          <span class="espaces-page__card-meta">${date}</span>
        </button>
        <div class="espaces-page__card-actions">
          <button type="button" class="btn btn--ghost btn--sm" data-action="discuss-space" data-space-id="${space.id}">Discuter</button>
          <button type="button" class="btn btn--ghost btn--sm espaces-page__delete" data-action="delete-space" data-space-id="${space.id}" aria-label="Supprimer">✕</button>
        </div>
      </article>
    `;
  }

  private async renderDetail(space: MerlinSpace): Promise<string> {
    const parts: string[] = [
      `<header class="espaces-page__detail-header">
        <button type="button" class="btn btn--ghost espaces-page__back" data-action="back-list">← Liste</button>
        <span class="espaces-page__badge espaces-page__badge--${space.kind}">${escapeHtml(SPACE_KIND_LABELS[space.kind])}</span>
        <h3 class="espaces-page__detail-title">${escapeHtml(space.title)}</h3>
        <div class="espaces-page__detail-actions">
          <button type="button" class="btn btn--primary btn--sm" data-action="discuss-space" data-space-id="${space.id}">Discuter avec Merlin</button>
        </div>
      </header>`,
      `<section class="espaces-page__recap">
        <h4>Récapitulatif</h4>
        <div class="espaces-page__markdown">${renderMarkdownToHtml(space.recap)}</div>
      </section>`,
    ];

    if (space.kind === 'comparison') {
      parts.push(this.renderComparisonTable(space));
    }
    if (space.kind === 'diy') {
      parts.push(await this.renderDiyDetail(space));
    }
    if (space.kind === 'plan') {
      parts.push(this.renderPlanDetail(space));
    }
    if (space.kind === 'recipe') {
      parts.push(this.renderRecipeDetail(space));
    }

    return parts.join('');
  }

  private renderComparisonTable(space: MerlinSpace): string {
    const { columns = [], rows = [] } = normalizeComparisonData(space.data);
    if (columns.length === 0) {
      return '<p class="espaces-page__empty-section">Tableau en cours de génération…</p>';
    }
    const head = `<tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
    const body = rows
      .map(
        (row) =>
          `<tr>${columns.map((_, i) => `<td>${escapeHtml(row[i] ?? '')}</td>`).join('')}</tr>`,
      )
      .join('');
    return `
      <section class="espaces-page__section">
        <h4>Tableau comparatif</h4>
        <div class="espaces-page__table-wrap">
          <table class="espaces-page__table">${head}${body}</table>
        </div>
      </section>
    `;
  }

  private async renderDiyDetail(space: MerlinSpace): Promise<string> {
    const parts: string[] = [];
    if (space.data.intro) {
      parts.push(`
        <section class="espaces-page__section">
          <h4>Introduction</h4>
          <div class="espaces-page__markdown">${renderMarkdownToHtml(space.data.intro)}</div>
        </section>
      `);
    }
    for (const section of space.data.sections ?? []) {
      parts.push(`
        <section class="espaces-page__section">
          <h4>${escapeHtml(section.title)}</h4>
          <div class="espaces-page__markdown">${renderMarkdownToHtml(section.content)}</div>
        </section>
      `);
    }
    if (space.data.listId) {
      const list = await getMerlinList(space.data.listId);
      if (list) {
        const items = list.items
          .map(
            (item) =>
              `<li><button type="button" class="espaces-page__todo-item" data-action="toggle-todo" data-list-id="${list.id}" data-item-id="${item.id}">${item.done ? '✓' : '○'} ${escapeHtml(item.text)}</button></li>`,
          )
          .join('');
        parts.push(`
          <section class="espaces-page__section">
            <h4>À faire</h4>
            <ul class="espaces-page__todo">${items}</ul>
          </section>
        `);
      }
    }
    return parts.join('');
  }

  private renderPlanDetail(space: MerlinSpace): string {
    const parts: string[] = [];
    if (space.data.goal) {
      parts.push(`
        <section class="espaces-page__section">
          <h4>Objectif</h4>
          <div class="espaces-page__markdown">${renderMarkdownToHtml(space.data.goal)}</div>
        </section>
      `);
    }
    if (space.data.github) {
      const { owner, repo } = space.data.github;
      parts.push(`
        <section class="espaces-page__section">
          <h4>Dépôt GitHub</h4>
          <p><a href="https://github.com/${escapeHtml(owner)}/${escapeHtml(repo)}" target="_blank" rel="noopener">${escapeHtml(owner)}/${escapeHtml(repo)}</a></p>
        </section>
      `);
    }
    const milestones = space.data.milestones ?? [];
    if (milestones.length > 0) {
      const items = milestones
        .map(
          (m) =>
            `<li><button type="button" class="espaces-page__milestone" data-action="toggle-milestone" data-milestone-id="${m.id}">${m.done ? '✓' : '○'} ${escapeHtml(m.title)}</button></li>`,
        )
        .join('');
      parts.push(`
        <section class="espaces-page__section">
          <h4>Jalons</h4>
          <ul class="espaces-page__milestones">${items}</ul>
        </section>
      `);
    }
    return parts.join('');
  }

  private renderRecipeDetail(space: MerlinSpace): string {
    const parts: string[] = [];
    if (space.data.servings) {
      parts.push(`<p class="espaces-page__servings">${space.data.servings} portion(s)</p>`);
    }
    const ingredients = space.data.ingredients ?? [];
    if (ingredients.length > 0) {
      parts.push(`
        <section class="espaces-page__section">
          <h4>Ingrédients</h4>
          <ul class="espaces-page__ingredients">
            ${ingredients
              .map((ing) => {
                const qty = [ing.quantity, ing.unit].filter(Boolean).join(' ');
                return `<li>${qty ? `<strong>${escapeHtml(qty)}</strong> ` : ''}${escapeHtml(ing.text)}</li>`;
              })
              .join('')}
          </ul>
        </section>
      `);
    }
    const steps = [...(space.data.steps ?? [])].sort((a, b) => a.order - b.order);
    if (steps.length > 0) {
      parts.push(`
        <section class="espaces-page__section">
          <h4>Étapes</h4>
          <ol class="espaces-page__steps">
            ${steps.map((s) => `<li>${escapeHtml(s.text)}</li>`).join('')}
          </ol>
        </section>
      `);
    }
    return parts.join('');
  }

  private bindDetailEvents(space: MerlinSpace): void {
    if (!this.detailEl) return;

    this.detailEl.querySelector('[data-action="back-list"]')?.addEventListener('click', () => {
      this.viewingId = null;
      void this.render();
    });

    this.detailEl.querySelector('[data-action="discuss-space"]')?.addEventListener('click', () => {
      setActiveSpaceId(space.id);
      this.onDiscuss?.(space.id);
    });

    this.detailEl.querySelectorAll('[data-action="toggle-todo"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        void this.handleToggleTodo(
          (btn as HTMLElement).dataset.listId!,
          (btn as HTMLElement).dataset.itemId!,
        );
      });
    });

    this.detailEl.querySelectorAll('[data-action="toggle-milestone"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        void this.handleToggleMilestone(space.id, (btn as HTMLElement).dataset.milestoneId!);
      });
    });
  }

  private async handleToggleTodo(listId: string, itemId: string): Promise<void> {
    const list = await getMerlinList(listId);
    if (!list) return;
    const item = list.items.find((i) => i.id === itemId);
    if (!item) return;
    item.done = !item.done;
    item.updatedAt = Date.now();
    list.updatedAt = Date.now();
    await saveMerlinList(list);
    if (this.viewingId) await this.render();
    this.onUpdate?.();
  }

  private async handleToggleMilestone(spaceId: string, milestoneId: string): Promise<void> {
    const space = await getMerlinSpace(spaceId);
    if (!space?.data.milestones) return;
    const milestone = space.data.milestones.find((m) => m.id === milestoneId);
    if (!milestone) return;
    milestone.done = !milestone.done;
    await saveMerlinSpace(space);
    if (this.viewingId) await this.render();
    this.onUpdate?.();
  }

  private async handleDelete(spaceId: string): Promise<void> {
    if (!confirm('Supprimer cet espace ?')) return;
    await deleteMerlinSpace(spaceId);
    this.onUpdate?.();
    await this.render();
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
