import { createListesIcon, createSettingsIcon, createThoughtsIcon } from './icons';
import { ListesPage } from './listes';
import { MindMap } from './mindmap';
import { SettingsPage, type SettingsCallbacks } from './settings';

export type GalleryView = 'home' | 'thoughts' | 'listes' | 'settings';

export interface GalleryOptions {
  container: HTMLElement;
  settingsCallbacks: SettingsCallbacks;
  onListesUpdate?: () => void;
}

export class Gallery {
  private container: HTMLElement;
  private homeView: HTMLElement;
  private appView: HTMLElement;
  private thoughtsPanel: HTMLElement;
  private listesPanel: HTMLElement;
  private settingsPanel: HTMLElement;
  private viewTitle: HTMLElement;
  private currentView: GalleryView = 'home';
  private mindMap: MindMap | null = null;
  private listesPage: ListesPage | null = null;
  private settingsPage: SettingsPage | null = null;
  private settingsCallbacks: SettingsCallbacks;
  private onListesUpdate?: () => void;

  constructor(options: GalleryOptions) {
    this.settingsCallbacks = options.settingsCallbacks;
    this.onListesUpdate = options.onListesUpdate;
    this.container = options.container;
    this.container.innerHTML = '';
    this.container.classList.add('gallery', 'tab-panel');

    this.homeView = document.createElement('div');
    this.homeView.className = 'gallery__home';

    const title = document.createElement('h2');
    title.className = 'gallery__title';
    title.textContent = 'Galerie';

    const grid = document.createElement('div');
    grid.className = 'gallery__grid';

    grid.appendChild(
      this.createAppCard({
        label: 'Listes',
        description: 'Courses, tâches et listes Merlin',
        icon: createListesIcon(),
        onOpen: () => this.openView('listes'),
      }),
    );
    grid.appendChild(
      this.createAppCard({
        label: 'Pensées',
        description: 'Carte de vos idées récurrentes',
        icon: createThoughtsIcon(),
        onOpen: () => this.openView('thoughts'),
      }),
    );
    grid.appendChild(
      this.createAppCard({
        label: 'Réglages',
        description: 'Sync, Merlin, mémoire et mise à jour',
        icon: createSettingsIcon(),
        onOpen: () => this.openView('settings'),
      }),
    );

    this.homeView.appendChild(title);
    this.homeView.appendChild(grid);

    this.appView = document.createElement('div');
    this.appView.className = 'gallery__view';
    this.appView.hidden = true;

    const header = document.createElement('header');
    header.className = 'gallery__header';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn btn--ghost gallery__back';
    backBtn.setAttribute('aria-label', 'Retour à la galerie');
    backBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span>Galerie</span>
    `;
    backBtn.addEventListener('click', () => this.openView('home'));

    this.viewTitle = document.createElement('h2');
    this.viewTitle.className = 'gallery__view-title';

    this.thoughtsPanel = document.createElement('div');
    this.thoughtsPanel.className = 'gallery__app-panel';
    this.thoughtsPanel.hidden = true;

    this.listesPanel = document.createElement('div');
    this.listesPanel.className = 'gallery__app-panel';
    this.listesPanel.hidden = true;

    this.settingsPanel = document.createElement('div');
    this.settingsPanel.className = 'gallery__app-panel';
    this.settingsPanel.hidden = true;

    header.appendChild(backBtn);
    header.appendChild(this.viewTitle);
    this.appView.appendChild(header);
    this.appView.appendChild(this.thoughtsPanel);
    this.appView.appendChild(this.listesPanel);
    this.appView.appendChild(this.settingsPanel);

    this.container.appendChild(this.homeView);
    this.container.appendChild(this.appView);
  }

  async init(): Promise<void> {
    this.mindMap = new MindMap({ container: this.thoughtsPanel, embedded: true });
    this.listesPage = new ListesPage(this.listesPanel, {
      embedded: true,
      onUpdate: () => this.onListesUpdate?.(),
    });
    this.settingsPage = new SettingsPage(this.settingsPanel, this.settingsCallbacks);
    await this.mindMap.init();
    await this.listesPage.init();
    await this.settingsPage.init();
  }

  onTabActive(): void {
    if (this.currentView === 'thoughts') {
      void this.mindMap?.refresh();
    }
    if (this.currentView === 'listes') {
      void this.listesPage?.refresh();
    }
    if (this.currentView === 'settings') {
      void this.settingsPage?.refresh();
    }
  }

  refreshListes(): Promise<void> {
    return this.listesPage?.refresh() ?? Promise.resolve();
  }

  openThoughts(): void {
    this.openView('thoughts');
  }

  openListes(): void {
    this.openView('listes');
  }

  openSettings(): void {
    this.openView('settings');
  }

  resetAiAnalysis(): Promise<void> {
    return this.mindMap?.resetAiAnalysis() ?? Promise.resolve();
  }

  private createAppCard(options: {
    label: string;
    description: string;
    icon: SVGSVGElement;
    onOpen: () => void;
  }): HTMLButtonElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gallery__card';

    const iconWrap = document.createElement('span');
    iconWrap.className = 'gallery__card-icon';
    iconWrap.appendChild(options.icon);

    const label = document.createElement('span');
    label.className = 'gallery__card-label';
    label.textContent = options.label;

    const description = document.createElement('span');
    description.className = 'gallery__card-desc';
    description.textContent = options.description;

    card.appendChild(iconWrap);
    card.appendChild(label);
    card.appendChild(description);
    card.addEventListener('click', options.onOpen);

    return card;
  }

  private openView(view: GalleryView): void {
    this.currentView = view;
    const showingApp = view !== 'home';

    this.homeView.hidden = showingApp;
    this.appView.hidden = !showingApp;
    this.thoughtsPanel.hidden = view !== 'thoughts';
    this.listesPanel.hidden = view !== 'listes';
    this.settingsPanel.hidden = view !== 'settings';

    if (view === 'thoughts') {
      this.viewTitle.textContent = 'Pensées';
      void this.mindMap?.refresh();
    }
    if (view === 'listes') {
      this.viewTitle.textContent = 'Listes';
      void this.listesPage?.refresh();
    }
    if (view === 'settings') {
      this.viewTitle.textContent = 'Réglages';
      void this.settingsPage?.refresh();
    }
  }
}
