import { Journal, resetSessionScroll } from './journal';
import { MindMap } from './mindmap';
import { Merlin } from './merlin';
import { getMeta, saveMeta } from './db';
import {
  createSettingsButton,
  initSyncFromMeta,
  touchVisitMeta,
} from './settings';
import { syncNow } from './sync';
import { getStoredPassphrase } from './crypto';
import { TabBar } from './tabs';
import { todayKey } from './types';

export async function initApp(root: HTMLElement): Promise<void> {
  root.className = 'app';

  const header = document.createElement('header');
  header.className = 'app__header';

  const title = document.createElement('span');
  title.className = 'app__title';
  title.textContent = 'Daily Note';

  const syncIndicator = document.createElement('span');
  syncIndicator.className = 'app__sync-status';
  syncIndicator.setAttribute('aria-live', 'polite');

  const tabsHost = document.createElement('div');
  tabsHost.className = 'app__tabs-host';

  const mainContainer = document.createElement('main');
  mainContainer.className = 'app__main';

  const journalPanel = document.createElement('div');
  journalPanel.id = 'tab-journal';

  const thoughtsPanel = document.createElement('div');
  thoughtsPanel.id = 'tab-thoughts';

  mainContainer.appendChild(journalPanel);
  mainContainer.appendChild(thoughtsPanel);

  header.appendChild(title);
  header.appendChild(syncIndicator);

  let journal: Journal | null = null;
  let mindMap: MindMap | null = null;
  let merlin: Merlin | null = null;
  let tabBar: TabBar | null = null;

  const settingsBtn = createSettingsButton({
    onPassphraseSet: () => {
      void getMeta().then((updatedMeta) => {
        initSyncFromMeta(updatedMeta, () => {
          journal?.refreshAfterSync();
          updateSyncIndicator(syncIndicator);
        });
      });
    },
    onSyncStatus: () => {
      journal?.refreshAfterSync();
      updateSyncIndicator(syncIndicator);
    },
    onMerlinChange: (enabled) => {
      merlin?.setEnabled(enabled);
    },
  });
  header.appendChild(settingsBtn);

  root.appendChild(header);
  root.appendChild(tabsHost);
  root.appendChild(mainContainer);

  const meta = await getMeta();

  tabBar = new TabBar(tabsHost, {
    onChange: (tab) => {
      if (tab === 'thoughts') {
        void mindMap?.refresh();
      }
    },
  });

  journal = new Journal({
    container: journalPanel,
    meta,
    onScrollAnchorChange: (anchor) => {
      void saveMeta({ scrollAnchor: anchor });
    },
  });

  mindMap = new MindMap({
    container: thoughtsPanel,
  });

  tabBar.registerPanel('journal', journalPanel);
  tabBar.registerPanel('thoughts', thoughtsPanel);

  await journal.init();
  await mindMap.init();

  merlin = new Merlin({ journal, tabBar });
  if (meta.merlinEnabled) {
    merlin.setEnabled(true);
  }

  const today = todayKey();
  if (meta.lastVisitDate !== today) {
    resetSessionScroll();
    await saveMeta({
      lastVisitDate: today,
      scrollAnchor: { date: today, offsetPx: 0 },
    });
  } else {
    await touchVisitMeta();
  }

  if (meta.passphraseSet && getStoredPassphrase()) {
    initSyncFromMeta(meta, () => {
      journal?.refreshAfterSync();
      updateSyncIndicator(syncIndicator);
    });
    void syncNow().then(() => {
      journal?.refreshAfterSync();
      updateSyncIndicator(syncIndicator);
    });
  }

  updateSyncIndicator(syncIndicator);
}

async function updateSyncIndicator(el: HTMLElement): Promise<void> {
  const meta = await getMeta();
  if (!meta.passphraseSet || !getStoredPassphrase()) {
    el.textContent = '';
    el.className = 'app__sync-status';
    return;
  }
  if (!navigator.onLine) {
    el.textContent = 'Hors ligne';
    el.className = 'app__sync-status app__sync-status--offline';
    return;
  }
  if (meta.lastSyncAt) {
    el.textContent = '';
    el.className = 'app__sync-status app__sync-status--ok';
    el.title = `Sync : ${new Date(meta.lastSyncAt).toLocaleString('fr-FR')}`;
  }
}
