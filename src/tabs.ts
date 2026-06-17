export type TabId = 'merlin' | 'journal' | 'thoughts';

const STORAGE_KEY = 'daily-note-active-tab';

export interface TabBarOptions {
  onChange: (tab: TabId) => void;
}

export class TabBar {
  private root: HTMLElement;
  private panels: Map<TabId, HTMLElement> = new Map();
  private buttons: Map<TabId, HTMLButtonElement> = new Map();
  private activeTab: TabId;
  private onChange: (tab: TabId) => void;

  constructor(container: HTMLElement, options: TabBarOptions) {
    this.onChange = options.onChange;
    this.activeTab = this.loadActiveTab();

    this.root = document.createElement('nav');
    this.root.className = 'tabs';
    this.root.setAttribute('role', 'tablist');
    this.root.setAttribute('aria-label', 'Navigation');

    const merlinBtn = this.createTabButton('merlin', 'Merlin');
    const journalBtn = this.createTabButton('journal', 'Journal');
    const thoughtsBtn = this.createTabButton('thoughts', 'Pensées');

    this.root.appendChild(merlinBtn);
    this.root.appendChild(journalBtn);
    this.root.appendChild(thoughtsBtn);
    container.appendChild(this.root);
  }

  registerPanel(tab: TabId, panel: HTMLElement): void {
    panel.dataset.tabPanel = tab;
    panel.classList.add('tab-panel');
    this.panels.set(tab, panel);
    this.updatePanelVisibility(tab);
  }

  getActiveTab(): TabId {
    return this.activeTab;
  }

  switchTo(tab: TabId): void {
    if (tab === this.activeTab) return;
    this.activeTab = tab;
    sessionStorage.setItem(STORAGE_KEY, tab);
    for (const id of this.panels.keys()) {
      this.updatePanelVisibility(id);
    }
    this.updateButtonStates();
    this.onChange(tab);
  }

  private createTabButton(tab: TabId, label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tabs__btn';
    btn.textContent = label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', tab === this.activeTab ? 'true' : 'false');
    btn.dataset.tab = tab;
    btn.addEventListener('click', () => this.switchTo(tab));
    this.buttons.set(tab, btn);
    if (tab === this.activeTab) {
      btn.classList.add('tabs__btn--active');
    }
    return btn;
  }

  private updatePanelVisibility(tab: TabId): void {
    const panel = this.panels.get(tab);
    if (!panel) return;
    const isActive = tab === this.activeTab;
    panel.hidden = !isActive;
    panel.classList.toggle('tab-panel--active', isActive);
  }

  private updateButtonStates(): void {
    for (const [tab, btn] of this.buttons) {
      const isActive = tab === this.activeTab;
      btn.classList.toggle('tabs__btn--active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
  }

  private loadActiveTab(): TabId {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === 'journal' || stored === 'thoughts' || stored === 'merlin') {
      return stored;
    }
    return 'merlin';
  }
}
