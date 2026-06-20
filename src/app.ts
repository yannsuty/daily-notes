import { Journal, resetSessionScroll } from './journal';
import { MindMap } from './mindmap';
import { Merlin } from './merlin';
import { MerlinChat } from './merlin-chat';
import { setDeferredReplyHandler } from './merlin-pending';
import { getMeta, saveMeta } from './db';
import {
  SettingsPage,
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
  title.textContent = 'Merlin';

  const syncIndicator = document.createElement('span');
  syncIndicator.className = 'app__sync-status';
  syncIndicator.setAttribute('aria-live', 'polite');

  const navHost = document.createElement('div');
  navHost.className = 'app__nav';

  const tabsHost = document.createElement('div');
  tabsHost.className = 'app__tabs-host';

  const mainContainer = document.createElement('main');
  mainContainer.className = 'app__main';

  const merlinPanel = document.createElement('div');
  merlinPanel.id = 'tab-merlin';

  const journalPanel = document.createElement('div');
  journalPanel.id = 'tab-journal';

  const thoughtsPanel = document.createElement('div');
  thoughtsPanel.id = 'tab-thoughts';

  const settingsPanel = document.createElement('div');
  settingsPanel.id = 'tab-settings';

  mainContainer.appendChild(merlinPanel);
  mainContainer.appendChild(journalPanel);
  mainContainer.appendChild(thoughtsPanel);
  mainContainer.appendChild(settingsPanel);

  header.appendChild(title);
  header.appendChild(syncIndicator);

  let journal: Journal | null = null;
  let mindMap: MindMap | null = null;
  let merlin: Merlin | null = null;
  let merlinChat: MerlinChat | null = null;
  let settingsPage: SettingsPage | null = null;
  let tabBar: TabBar | null = null;

  const settingsCallbacks = {
    onPassphraseSet: () => {
      void getMeta().then((updatedMeta) => {
        initSyncFromMeta(updatedMeta, () => {
          journal?.refreshAfterSync();
          void merlinChat?.refresh();
          updateSyncIndicator(syncIndicator);
        });
      });
    },
    onSyncStatus: () => {
      journal?.refreshAfterSync();
      void merlinChat?.refresh();
      updateSyncIndicator(syncIndicator);
    },
    onMerlinChange: (enabled: boolean, fromUserGesture?: boolean) => {
      merlin?.setEnabled(enabled);
      if (enabled) {
        void import('./merlin-scheduler').then(({ initMerlinScheduler }) => initMerlinScheduler());
      }
      if (enabled && fromUserGesture) {
        void merlin?.beginListening().then((ok) => {
          if (ok) {
            // status updated inside merlin
          }
        });
      }
    },
    onReanalyzeThoughts: () => mindMap?.resetAiAnalysis() ?? Promise.resolve(),
    onMemoryCleared: () => void merlinChat?.refresh(),
  };

  navHost.appendChild(tabsHost);

  root.appendChild(header);
  root.appendChild(mainContainer);
  root.appendChild(navHost);

  const meta = await getMeta();

  tabBar = new TabBar(tabsHost, {
    onChange: (tab) => {
      merlin?.onTabChange(tab);
      if (tab === 'thoughts') {
        void mindMap?.refresh();
      }
      if (tab === 'merlin') {
        void merlinChat?.refresh();
      }
      if (tab === 'settings') {
        void settingsPage?.refresh();
      }
    },
  });

  merlinChat = new MerlinChat({
    container: merlinPanel,
    onConversationUpdate: () => {
      void syncNow().then(() => updateSyncIndicator(syncIndicator));
    },
    onVoiceRequest: () => {
      void merlin?.beginConversing();
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

  settingsPage = new SettingsPage(settingsPanel, settingsCallbacks);

  tabBar.registerPanel('merlin', merlinPanel);
  tabBar.registerPanel('journal', journalPanel);
  tabBar.registerPanel('thoughts', thoughtsPanel);
  tabBar.registerPanel('settings', settingsPanel);

  await merlinChat.init();
  await journal.init();
  await mindMap.init();
  await settingsPage.init();

  merlin = new Merlin({
    journal,
    tabBar,
    merlinChat,
    onConversationUpdate: () => {
      void syncNow().then(() => updateSyncIndicator(syncIndicator));
    },
  });

  setDeferredReplyHandler((info) => {
    void merlinChat?.refresh();
    void merlin?.onDeferredReply(info.reply);
    void syncNow().then(() => updateSyncIndicator(syncIndicator));
  });

  if (meta.merlinEnabled) {
    merlin.setEnabled(true);
    void import('./merlin-scheduler').then(({ initMerlinScheduler }) => initMerlinScheduler());
  }

  tabBar.syncPanels();
  merlin?.onTabChange(tabBar.getActiveTab());

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
      void merlinChat?.refresh();
      updateSyncIndicator(syncIndicator);
    });
    void syncNow().then(() => {
      journal?.refreshAfterSync();
      void merlinChat?.refresh();
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
