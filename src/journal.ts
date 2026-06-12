import { getDay, getDays, listDayKeysBefore, saveDay } from './db';
import type { AppMeta, ScrollAnchor } from './types';
import { addDays, formatDateLabel, todayKey } from './types';

const LAZY_LOAD_BATCH = 7;
const SAVE_DEBOUNCE_MS = 300;
const SCROLL_LOAD_THRESHOLD = 80;

type SaveHandler = (dateKey: string, content: string) => void;

interface JournalOptions {
  container: HTMLElement;
  meta: AppMeta;
  onSave?: SaveHandler;
  onScrollAnchorChange?: (anchor: ScrollAnchor) => void;
}

/** Ancre de scroll conservée pendant la session (pas au reload). */
let sessionScrollAnchor: ScrollAnchor | null = null;

export function resetSessionScroll(): void {
  sessionScrollAnchor = null;
}

export class Journal {
  private container: HTMLElement;
  private scrollEl: HTMLElement;
  private meta: AppMeta;
  private onSave?: SaveHandler;
  private onScrollAnchorChange?: (anchor: ScrollAnchor) => void;

  private loadedDates: string[] = [];
  private earliestLoaded: string;
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private loadingOlder = false;
  private initComplete = false;

  constructor(options: JournalOptions) {
    this.container = options.container;
    this.meta = options.meta;
    this.onSave = options.onSave;
    this.onScrollAnchorChange = options.onScrollAnchorChange;

    this.earliestLoaded = todayKey();

    this.container.innerHTML = '';
    this.container.className = 'journal';

    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'journal__scroll';
    this.container.appendChild(this.scrollEl);
  }

  async init(): Promise<void> {
    const today = todayKey();

    await this.appendDays([today]);
    this.resizeAllTextareas();
    this.setupScrollPersistence();
    this.setupOlderDaysLoader();

    await this.waitForLayout();
    this.resizeAllTextareas();

    const canRestoreSession =
      sessionScrollAnchor !== null && this.meta.lastVisitDate === today;

    if (canRestoreSession && sessionScrollAnchor) {
      await this.ensureDateLoaded(sessionScrollAnchor.date);
      this.resizeAllTextareas();
      await this.waitForLayout();
      this.scrollToDate(sessionScrollAnchor.date, sessionScrollAnchor.offsetPx);
    } else {
      this.scrollToDate(today, 0);
    }

    this.initComplete = true;

    const todayInput = this.scrollEl.querySelector<HTMLTextAreaElement>(
      `[data-date="${today}"] .day__input`,
    );
    todayInput?.focus({ preventScroll: true });
  }

  private async appendDays(dateKeys: string[]): Promise<void> {
    const entries = await getDays(dateKeys);
    const fragment = document.createDocumentFragment();

    for (const dateKey of dateKeys) {
      if (this.loadedDates.includes(dateKey)) continue;
      const entry = entries.get(dateKey);
      fragment.appendChild(this.createDaySection(dateKey, entry?.content ?? ''));
      this.loadedDates.push(dateKey);
    }

    this.scrollEl.appendChild(fragment);
  }

  private async prependDays(dateKeys: string[]): Promise<void> {
    if (dateKeys.length === 0) return;

    const scrollTopBefore = this.scrollEl.scrollTop;
    const scrollHeightBefore = this.scrollEl.scrollHeight;

    const entries = await getDays(dateKeys);
    const fragment = document.createDocumentFragment();

    for (const dateKey of dateKeys) {
      if (this.loadedDates.includes(dateKey)) continue;
      const entry = entries.get(dateKey);
      fragment.appendChild(this.createDaySection(dateKey, entry?.content ?? ''));
      this.loadedDates.unshift(dateKey);
    }

    if (!fragment.childNodes.length) return;

    const firstSection = this.scrollEl.firstElementChild;
    if (firstSection) {
      this.scrollEl.insertBefore(fragment, firstSection);
    } else {
      this.scrollEl.appendChild(fragment);
    }

    this.resizeAllTextareas();

    const scrollHeightAfter = this.scrollEl.scrollHeight;
    this.scrollEl.scrollTop = scrollTopBefore + (scrollHeightAfter - scrollHeightBefore);

    this.earliestLoaded = dateKeys[0];
  }

  private createDaySection(dateKey: string, content: string): HTMLElement {
    const section = document.createElement('section');
    section.className = 'day';
    section.dataset.date = dateKey;

    const header = document.createElement('h2');
    header.className = 'day__header';
    header.textContent = formatDateLabel(dateKey);
    if (dateKey === todayKey()) {
      header.classList.add('day__header--today');
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'day__input';
    textarea.value = content;
    textarea.placeholder = 'Écrivez ici…';
    textarea.setAttribute('aria-label', `Notes du ${formatDateLabel(dateKey)}`);

    textarea.addEventListener('input', () => {
      this.autoResize(textarea);
      this.scheduleSave(dateKey, textarea.value);
    });

    section.appendChild(header);
    section.appendChild(textarea);
    return section;
  }

  private autoResize(textarea: HTMLTextAreaElement): void {
    textarea.style.height = '0';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  private resizeAllTextareas(): void {
    for (const textarea of this.scrollEl.querySelectorAll<HTMLTextAreaElement>('.day__input')) {
      this.autoResize(textarea);
    }
  }

  private scheduleSave(dateKey: string, content: string): void {
    const existing = this.saveTimers.get(dateKey);
    if (existing) clearTimeout(existing);

    this.saveTimers.set(
      dateKey,
      setTimeout(() => {
        void saveDay(dateKey, content).then(() => {
          this.onSave?.(dateKey, content);
        });
        this.saveTimers.delete(dateKey);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  private setupOlderDaysLoader(): void {
    const maybeLoadOlder = (): void => {
      if (!this.initComplete || this.loadingOlder) return;
      if (this.scrollEl.scrollTop < SCROLL_LOAD_THRESHOLD) {
        void this.loadOlderDays();
      }
    };

    this.scrollEl.addEventListener('scroll', maybeLoadOlder, { passive: true });

    this.scrollEl.addEventListener(
      'wheel',
      (e) => {
        if (e.deltaY < 0 && this.scrollEl.scrollTop < SCROLL_LOAD_THRESHOLD) {
          void this.loadOlderDays();
        }
      },
      { passive: true },
    );
  }

  private async loadOlderDays(): Promise<void> {
    if (this.loadingOlder) return;
    this.loadingOlder = true;

    try {
      const olderKeys = await listDayKeysBefore(this.earliestLoaded, LAZY_LOAD_BATCH);

      if (olderKeys.length > 0) {
        await this.prependDays(olderKeys);
      } else {
        const synthetic: string[] = [];
        for (let i = 1; i <= LAZY_LOAD_BATCH; i++) {
          synthetic.unshift(addDays(this.earliestLoaded, -i));
        }
        await this.prependDays(synthetic);
      }
    } finally {
      this.loadingOlder = false;
    }
  }

  private setupScrollPersistence(): void {
    const persist = (): void => {
      const anchor = this.computeScrollAnchor();
      sessionScrollAnchor = anchor;
      this.onScrollAnchorChange?.(anchor);
    };

    this.scrollEl.addEventListener('scroll', () => {
      if (this.scrollSaveTimer) clearTimeout(this.scrollSaveTimer);
      this.scrollSaveTimer = setTimeout(persist, 150);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        persist();
      }
    });
  }

  private computeScrollAnchor(): ScrollAnchor {
    const sections = this.scrollEl.querySelectorAll<HTMLElement>('.day');
    const scrollTop = this.scrollEl.scrollTop;
    const viewportTop = scrollTop + 1;

    for (const section of sections) {
      const top = section.offsetTop;
      const bottom = top + section.offsetHeight;
      if (viewportTop >= top && viewportTop < bottom) {
        return {
          date: section.dataset.date ?? todayKey(),
          offsetPx: scrollTop - top,
        };
      }
    }

    const last = sections[sections.length - 1];
    if (last) {
      return {
        date: last.dataset.date ?? todayKey(),
        offsetPx: scrollTop - last.offsetTop,
      };
    }

    return { date: todayKey(), offsetPx: 0 };
  }

  private waitForLayout(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  private async ensureDateLoaded(dateKey: string): Promise<void> {
    if (this.loadedDates.includes(dateKey)) return;

    const today = todayKey();
    if (dateKey > today) {
      await this.appendDays([dateKey]);
      return;
    }

    while (this.earliestLoaded > dateKey) {
      await this.loadOlderDays();
    }

    if (!this.loadedDates.includes(dateKey)) {
      const missing: string[] = [];
      let d = this.earliestLoaded;
      while (d > dateKey) {
        d = addDays(d, -1);
        missing.unshift(d);
      }
      if (missing.length) await this.prependDays(missing);
    }
  }

  scrollToDate(dateKey: string, offsetPx: number): void {
    const header = this.scrollEl.querySelector<HTMLElement>(
      `[data-date="${dateKey}"] .day__header`,
    );
    if (!header) return;

    const top =
      header.getBoundingClientRect().top -
      this.scrollEl.getBoundingClientRect().top +
      this.scrollEl.scrollTop;

    this.scrollEl.scrollTop = Math.max(0, top + offsetPx);
  }

  refreshAfterSync(): void {
    for (const section of this.scrollEl.querySelectorAll<HTMLElement>('.day')) {
      const dateKey = section.dataset.date;
      if (!dateKey) continue;
      void getDay(dateKey).then((entry) => {
        const textarea = section.querySelector<HTMLTextAreaElement>('.day__input');
        if (textarea && entry && textarea.value !== entry.content) {
          if (document.activeElement !== textarea) {
            textarea.value = entry.content;
            this.autoResize(textarea);
          }
        }
      });
    }
  }

  destroy(): void {
    for (const timer of this.saveTimers.values()) clearTimeout(timer);
    if (this.scrollSaveTimer) clearTimeout(this.scrollSaveTimer);
  }
}
