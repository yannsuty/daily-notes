import {
  deleteMerlinSpace,
  getMerlinList,
  getMerlinSpace,
  getMerlinSpaces,
  saveMerlinList,
  saveMerlinSpace,
} from './db';
import { normalizeComparisonData } from '../lib/merlin-agent/space-merge';
import {
  getIgnoredComparisonRows,
  getVisibleComparisonRows,
  ignoreComparisonRow,
  restoreComparisonRow,
} from '../lib/merlin-agent/comparison-items';
import { SPACE_KIND_LABELS } from './merlin-space-format';
import { getActiveSpaceId, setActiveSpaceId } from './merlin-space-session';
import { renderMarkdownToHtml } from './markdown';
import { syncNow } from './sync';
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
  private comparisonItemIndex = 0;

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

  openSpace(spaceId: string, itemIndex = 0): void {
    this.viewingId = spaceId;
    this.comparisonItemIndex = itemIndex;
    void this.render();
  }

  private async render(): Promise<void> {
    if (!this.scrollEl || !this.detailEl) return;

    if (this.viewingId) {
      let space = await getMerlinSpace(this.viewingId);
      if (!space) {
        this.viewingId = null;
        return this.render();
      }
      if (space.kind === 'comparison') {
        const repaired = normalizeComparisonData(space.data);
        if (JSON.stringify(repaired) !== JSON.stringify(space.data)) {
          space = { ...space, data: repaired, updatedAt: Date.now() };
          await saveMerlinSpace(space);
        }
        const visibleCount = getVisibleComparisonRows(space.data).length;
        if (visibleCount > 0) {
          this.comparisonItemIndex = Math.min(
            Math.max(0, this.comparisonItemIndex),
            visibleCount - 1,
          );
        } else {
          this.comparisonItemIndex = 0;
        }
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
      parts.push(this.renderComparisonReader(space));
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

  private renderComparisonReader(space: MerlinSpace): string {
    const { columns = [] } = normalizeComparisonData(space.data);
    if (columns.length === 0) {
      return '<p class="espaces-page__empty-section">Tableau en cours de génération…</p>';
    }

    const visible = getVisibleComparisonRows(space.data);
    const ignored = getIgnoredComparisonRows(space.data);

    if (visible.length === 0 && ignored.length > 0) {
      return `
        <section class="espaces-page__section espaces-page__comparison">
          <p class="espaces-page__empty-section">Tous les articles ont été ignorés.</p>
          ${this.renderIgnoredRowsSection(ignored)}
          ${this.renderComparisonTable(space, { hideIgnored: true })}
        </section>
      `;
    }

    if (visible.length === 0) {
      return '<p class="espaces-page__empty-section">Aucun article à comparer.</p>';
    }

    const idx = Math.min(this.comparisonItemIndex, visible.length - 1);
    const entry = visible[idx];
    const nameCol = columns[0] ?? 'Article';
    const name = entry.row[0]?.trim() || `Article ${idx + 1}`;
    const details = columns
      .slice(1)
      .map((col, i) => {
        const value = entry.row[i + 1]?.trim();
        if (!value) return '';
        return `<div class="espaces-page__comparison-prop"><dt>${escapeHtml(col)}</dt><dd>${escapeHtml(value)}</dd></div>`;
      })
      .filter(Boolean)
      .join('');

    const nav = `
      <nav class="espaces-page__comparison-nav" aria-label="Navigation entre articles">
        <button type="button" class="btn btn--ghost btn--sm" data-action="prev-item" ${idx <= 0 ? 'disabled' : ''} aria-label="Article précédent">‹ Précédent</button>
        <span class="espaces-page__comparison-pager">${idx + 1} / ${visible.length}</span>
        <button type="button" class="btn btn--ghost btn--sm" data-action="next-item" ${idx >= visible.length - 1 ? 'disabled' : ''} aria-label="Article suivant">Suivant ›</button>
      </nav>
    `;

    return `
      <section class="espaces-page__section espaces-page__comparison">
        <div class="espaces-page__comparison-header">
          <h4>Articles comparés</h4>
          ${ignored.length > 0 ? `<span class="espaces-page__comparison-meta">${ignored.length} ignoré${ignored.length > 1 ? 's' : ''}</span>` : ''}
        </div>
        <article class="espaces-page__comparison-card" data-row-key="${escapeHtml(entry.key)}">
          <p class="espaces-page__comparison-label">${escapeHtml(nameCol)}</p>
          <h5 class="espaces-page__comparison-name">${escapeHtml(name)}</h5>
          ${details ? `<dl class="espaces-page__comparison-props">${details}</dl>` : ''}
        </article>
        ${nav}
        <div class="espaces-page__comparison-actions">
          <button type="button" class="btn btn--ghost btn--sm espaces-page__ignore-btn" data-action="ignore-item" data-row-key="${escapeHtml(entry.key)}">Ignorer cet article</button>
        </div>
        ${this.renderIgnoredRowsSection(ignored)}
        <details class="espaces-page__table-details">
          <summary>Tableau complet</summary>
          ${this.renderComparisonTable(space, { hideIgnored: true })}
        </details>
      </section>
    `;
  }

  private renderIgnoredRowsSection(
    ignored: ReturnType<typeof getIgnoredComparisonRows>,
  ): string {
    if (ignored.length === 0) return '';
    const items = ignored
      .map(
        (entry) =>
          `<li class="espaces-page__ignored-item">
            <span>${escapeHtml(entry.row[0] ?? 'Article')}</span>
            <button type="button" class="btn btn--ghost btn--sm" data-action="restore-item" data-row-key="${escapeHtml(entry.key)}">Rétablir</button>
          </li>`,
      )
      .join('');
    return `
      <details class="espaces-page__ignored-details">
        <summary>${ignored.length} article${ignored.length > 1 ? 's' : ''} ignoré${ignored.length > 1 ? 's' : ''}</summary>
        <ul class="espaces-page__ignored-list">${items}</ul>
      </details>
    `;
  }

  private renderComparisonTable(
    space: MerlinSpace,
    options?: { hideIgnored?: boolean },
  ): string {
    const { columns = [], rows = [] } = normalizeComparisonData(space.data);
    if (columns.length === 0) {
      return '<p class="espaces-page__empty-section">Tableau en cours de génération…</p>';
    }

    const ignoredKeys = options?.hideIgnored
      ? new Set((space.data.ignoredRows ?? []).map((k) => k.trim().toLowerCase()))
      : null;

    const visibleRows = ignoredKeys
      ? rows.filter((row) => {
          const key = (row[0] ?? '').trim().toLowerCase();
          return !key || !ignoredKeys.has(key);
        })
      : rows;

    const head = `<tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
    const body = visibleRows
      .map(
        (row) =>
          `<tr>${columns.map((_, i) => `<td>${escapeHtml(row[i] ?? '')}</td>`).join('')}</tr>`,
      )
      .join('');
    return `
      <div class="espaces-page__table-wrap">
        <table class="espaces-page__table">${head}${body}</table>
      </div>
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

    this.detailEl.querySelector('[data-action="prev-item"]')?.addEventListener('click', () => {
      if (this.comparisonItemIndex > 0) {
        this.comparisonItemIndex -= 1;
        void this.render();
      }
    });

    this.detailEl.querySelector('[data-action="next-item"]')?.addEventListener('click', () => {
      this.comparisonItemIndex += 1;
      void this.render();
    });

    this.detailEl.querySelector('[data-action="ignore-item"]')?.addEventListener('click', (e) => {
      const key = (e.currentTarget as HTMLElement).dataset.rowKey;
      if (key) void this.handleIgnoreRow(space.id, key);
    });

    this.detailEl.querySelectorAll('[data-action="restore-item"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        void this.handleRestoreRow(space.id, (btn as HTMLElement).dataset.rowKey!);
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

  private async handleIgnoreRow(spaceId: string, rowKey: string): Promise<void> {
    const space = await getMerlinSpace(spaceId);
    if (!space || space.kind !== 'comparison') return;

    const visibleBefore = getVisibleComparisonRows(space.data).length;
    const nextData = ignoreComparisonRow(space.data, rowKey);
    if (nextData === space.data) return;

    const visibleAfter = getVisibleComparisonRows(nextData).length;
    if (this.comparisonItemIndex >= visibleAfter && visibleAfter > 0) {
      this.comparisonItemIndex = visibleAfter - 1;
    }

    await saveMerlinSpace({ ...space, data: nextData, updatedAt: Date.now() });
    if (this.viewingId) await this.render();
    this.onUpdate?.();
    void syncNow();

    if (visibleBefore > 0 && visibleAfter === 0) {
      this.comparisonItemIndex = 0;
    }
  }

  private async handleRestoreRow(spaceId: string, rowKey: string): Promise<void> {
    const space = await getMerlinSpace(spaceId);
    if (!space || space.kind !== 'comparison') return;

    const nextData = restoreComparisonRow(space.data, rowKey);
    if (nextData === space.data) return;

    await saveMerlinSpace({ ...space, data: nextData, updatedAt: Date.now() });
    if (this.viewingId) await this.render();
    this.onUpdate?.();
    void syncNow();
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
    if (getActiveSpaceId() === spaceId) {
      setActiveSpaceId(null);
    }
    if (this.viewingId === spaceId) {
      this.viewingId = null;
    }
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
