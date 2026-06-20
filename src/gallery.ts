import { createThoughtsIcon } from './icons';
import { MindMap } from './mindmap';

export type GalleryView = 'home' | 'thoughts';

export interface GalleryOptions {
  container: HTMLElement;
}

export class Gallery {
  private container: HTMLElement;
  private homeView: HTMLElement;
  private appView: HTMLElement;
  private appContent: HTMLElement;
  private viewTitle: HTMLElement;
  private currentView: GalleryView = 'home';
  private mindMap: MindMap | null = null;

  constructor(options: GalleryOptions) {
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

    const thoughtsCard = this.createAppCard({
      label: 'Pensées',
      description: 'Carte de vos idées récurrentes',
      onOpen: () => this.openView('thoughts'),
    });
    grid.appendChild(thoughtsCard);

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

    this.appContent = document.createElement('div');
    this.appContent.className = 'gallery__content';

    header.appendChild(backBtn);
    header.appendChild(this.viewTitle);
    this.appView.appendChild(header);
    this.appView.appendChild(this.appContent);

    this.container.appendChild(this.homeView);
    this.container.appendChild(this.appView);
  }

  async init(): Promise<void> {
    this.mindMap = new MindMap({ container: this.appContent });
    await this.mindMap.init();
  }

  onTabActive(): void {
    if (this.currentView === 'thoughts') {
      void this.mindMap?.refresh();
    }
  }

  openThoughts(): void {
    this.openView('thoughts');
  }

  resetAiAnalysis(): Promise<void> {
    return this.mindMap?.resetAiAnalysis() ?? Promise.resolve();
  }

  private createAppCard(options: {
    label: string;
    description: string;
    onOpen: () => void;
  }): HTMLButtonElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gallery__card';

    const iconWrap = document.createElement('span');
    iconWrap.className = 'gallery__card-icon';
    iconWrap.appendChild(createThoughtsIcon());

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

    if (view === 'thoughts') {
      this.viewTitle.textContent = 'Pensées';
      void this.mindMap?.refresh();
    }
  }
}
