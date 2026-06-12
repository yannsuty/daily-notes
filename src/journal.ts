import { getDay, getDays, listDayKeysBefore, saveDay } from './db';
import type { AppMeta, ScrollAnchor } from './types';
import { addDays, formatDateLabel, todayKey } from './types';

const INITIAL_DAYS = 1;
const PRELOAD_DAYS = 2;
const LAZY_LOAD_BATCH = 7;
const SAVE_DEBOUNCE_MS = 300;

type SaveHandler = (dateKey: string, content: string) => void;

interface JournalOptions {
  container: HTMLElement;
  meta: AppMeta;
  onSave?: SaveHandler;
  onScrollAnchorChange?: (anchor: ScrollAnchor) => void;
}

export class Journal {
  private container: HTMLElement;
  private scrollEl: HTMLElement;
  private topSentinel: HTMLElement;
  private meta: AppMeta;
  private onSave?: SaveHandler;
  private onScrollAnchorChange?: (anchor: ScrollAnchor) => void;

  private loadedDates: string[] = [];
  private earliestLoaded: string;
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private loadingOlder = false;
  private observer: IntersectionObserver | null = null;
  private initComplete = false;

  constructor(options: JournalOptions) {
    this.container = options.container;
    this.meta = options.meta;
    this.onSave = options.onSave;
    this.onScrollAnchorChange = options.onScrollAnchorChange;

    const today = todayKey();
    this.earliestLoaded = addDays(today, -(INITIAL_DAYS - 1));

    this.container.innerHTML = '';
    this.container.className = 'journal';

    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'journal__scroll';

    this.topSentinel = document.createElement('div');
    this.topSentinel.className = 'journal__sentinel';
    this.topSentinel.setAttribute('aria-hidden', 'true');

    this.scrollEl.appendChild(this.topSentinel);
    this.container.appendChild(this.scrollEl);
  }

  async init(): Promise<void> {
    const today = todayKey();
    const isNewDay = this.meta.lastVisitDate !== today;

    await this.appendDays([today]);
    this.setupScrollPersistence();

    await this.applyInitialScroll(isNewDay);

    if (PRELOAD_DAYS > 0) {
      const preload: string[] = [];
      for (let i = PRELOAD_DAYS; i >= 1; i--) {
        preload.push(addDays(today, -i));
      }
      const anchorDate = isNewDay ? today : this.meta.scrollAnchor.date;
      await this.prependDays(preload, anchorDate);
    }

    this.setupObserver();
    this.initComplete = true;
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

    this.scrollEl.insertBefore(fragment, this.topSentinel.nextSibling);
  }

  private async prependDays(
    dateKeys: string[],
    anchorDate?: string,
  ): Promise<void> {
    if (dateKeys.length === 0) return;

    const anchorSection = anchorDate
      ? this.scrollEl.querySelector<HTMLElement>(`[data-date="${anchorDate}"]`)
      : null;
    const scrollTopBefore = this.scrollEl.scrollTop;
    const anchorTopBefore = anchorSection?.offsetTop ?? null;

    const entries = await getDays(dateKeys);
    const fragment = document.createDocumentFragment();

    for (const dateKey of dateKeys) {
      if (this.loadedDates.includes(dateKey)) continue;
      const entry = entries.get(dateKey);
      fragment.appendChild(this.createDaySection(dateKey, entry?.content ?? ''));
      this.loadedDates.unshift(dateKey);
    }

    if (!fragment.childNodes.length) return;

    const prevScrollHeight = this.scrollEl.scrollHeight;
    const firstSection = this.topSentinel.nextElementSibling;
    if (firstSection) {
      this.scrollEl.insertBefore(fragment, firstSection);
    } else {
      this.scrollEl.appendChild(fragment);
    }

    if (anchorSection && anchorTopBefore !== null) {
      this.scrollEl.scrollTop =
        anchorSection.offsetTop - (anchorTopBefore - scrollTopBefore);
    } else {
      this.scrollEl.scrollTop += this.scrollEl.scrollHeight - prevScrollHeight;
    }

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
    textarea.rows = 1;
    textarea.setAttribute('aria-label', `Notes du ${formatDateLabel(dateKey)}`);

    this.autoResize(textarea);
    textarea.addEventListener('input', () => {
      this.autoResize(textarea);
      this.scheduleSave(dateKey, textarea.value);
    });

    section.appendChild(header);
    section.appendChild(textarea);
    return section;
  }

  private autoResize(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
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

  private setupObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !this.loadingOlder && this.initComplete) {
            void this.loadOlderDays();
          }
        }
      },
      { root: this.scrollEl, rootMargin: '200px 0px 0px 0px', threshold: 0 },
    );
    this.observer.observe(this.topSentinel);
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
    this.scrollEl.addEventListener('scroll', () => {
      if (this.scrollSaveTimer) clearTimeout(this.scrollSaveTimer);
      this.scrollSaveTimer = setTimeout(() => {
        const anchor = this.computeScrollAnchor();
        this.onScrollAnchorChange?.(anchor);
      }, 150);
    });
  }

  private computeScrollAnchor(): ScrollAnchor {
    const sections = this.scrollEl.querySelectorAll<HTMLElement>('.day');
    const scrollTop = this.scrollEl.scrollTop;

    for (const section of sections) {
      const top = section.offsetTop;
      const bottom = top + section.offsetHeight;
      if (scrollTop >= top - 4 && scrollTop < bottom) {
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

  private async applyInitialScroll(isNewDay: boolean): Promise<void> {
    const today = todayKey();

    await this.waitForLayout();

    if (isNewDay) {
      this.scrollToDate(today, 0);
    } else {
      const { date, offsetPx } = this.meta.scrollAnchor;
      if (!this.loadedDates.includes(date)) {
        await this.ensureDateLoaded(date);
      }
      this.scrollToDate(date, offsetPx);
    }

    const todaySection = this.scrollEl.querySelector<HTMLTextAreaElement>(
      `[data-date="${today}"] .day__input`,
    );
    todaySection?.focus({ preventScroll: true });
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

    while (this.earliestLoaded > dateKey) {
      await this.loadOlderDays();
    }

    if (!this.loadedDates.includes(dateKey)) {
      await this.appendDays([dateKey]);
    }
  }

  scrollToDate(dateKey: string, offsetPx: number): void {
    const section = this.scrollEl.querySelector<HTMLElement>(`[data-date="${dateKey}"]`);
    if (!section) return;

    const top =
      section.getBoundingClientRect().top -
      this.scrollEl.getBoundingClientRect().top +
      this.scrollEl.scrollTop;

    this.scrollEl.scrollTop = top + offsetPx;
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
    this.observer?.disconnect();
    for (const timer of this.saveTimers.values()) clearTimeout(timer);
    if (this.scrollSaveTimer) clearTimeout(this.scrollSaveTimer);
  }
}
