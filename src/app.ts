import { Gallery } from './gallery';
import { Journal, resetSessionScroll } from './journal';
import { Merlin } from './merlin';
import { MerlinChat } from './merlin-chat';
import { setDeferredReplyHandler } from './merlin-pending';
import { listPendingAgentJobs, registerAgentJobResume } from './merlin-agent-jobs';
import { resumePendingAgentJobs } from './merlin-agent-resume';
import { getMeta, saveMeta } from './db';
import {
  initSyncFromMeta,
  touchVisitMeta,
  type SettingsCallbacks,
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

  const galleryPanel = document.createElement('div');
  galleryPanel.id = 'tab-gallery';

  mainContainer.appendChild(merlinPanel);
  mainContainer.appendChild(journalPanel);
  mainContainer.appendChild(galleryPanel);

  header.appendChild(title);
  header.appendChild(syncIndicator);

  let journal: Journal | null = null;
  let gallery: Gallery | null = null;
  let merlin: Merlin | null = null;
  let merlinChat: MerlinChat | null = null;
  let tabBar: TabBar | null = null;

  const refreshListes = (): void => {
    void gallery?.refreshListes();
  };

  const settingsCallbacks: SettingsCallbacks = {
    onPassphraseSet: () => {
      void getMeta().then((updatedMeta) => {
        initSyncFromMeta(updatedMeta, () => {
          journal?.refreshAfterSync();
          void merlinChat?.refresh();
          refreshListes();
          updateSyncIndicator(syncIndicator);
        });
      });
    },
    onSyncStatus: () => {
      journal?.refreshAfterSync();
      void merlinChat?.refresh();
      refreshListes();
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
    onReanalyzeThoughts: () => gallery?.resetAiAnalysis() ?? Promise.resolve(),
    onMemoryCleared: () => {
      void merlinChat?.refresh();
      refreshListes();
    },
  };

  navHost.appendChild(tabsHost);

  root.appendChild(header);
  root.appendChild(mainContainer);
  root.appendChild(navHost);

  const meta = await getMeta();

  tabBar = new TabBar(tabsHost, {
    onChange: (tab) => {
      merlin?.onTabChange(tab);
      if (tab === 'gallery') {
        gallery?.onTabActive();
      }
      if (tab === 'merlin') {
        void merlinChat?.refresh();
      }
    },
  });

  merlinChat = new MerlinChat({
    container: merlinPanel,
    onConversationUpdate: () => {
      refreshListes();
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

  gallery = new Gallery({
    container: galleryPanel,
    settingsCallbacks,
    onListesUpdate: () => {
      void merlinChat?.refresh();
      void syncNow().then(() => updateSyncIndicator(syncIndicator));
    },
  });

  tabBar.registerPanel('merlin', merlinPanel);
  tabBar.registerPanel('journal', journalPanel);
  tabBar.registerPanel('gallery', galleryPanel);

  await merlinChat.init();
  await journal.init();
  await gallery.init();

  merlin = new Merlin({
    journal,
    tabBar,
    merlinChat,
    onConversationUpdate: () => {
      refreshListes();
      void syncNow().then(() => updateSyncIndicator(syncIndicator));
    },
  });

  setDeferredReplyHandler((info) => {
    void merlinChat?.refresh();
    refreshListes();
    void merlin?.onDeferredReply(info.reply);
    void syncNow().then(() => updateSyncIndicator(syncIndicator));
  });

  const resumeAgentJobs = (): void => {
    void resumePendingAgentJobs().then(async (completed) => {
      if (completed > 0) {
        await merlinChat?.refresh();
        await gallery?.refreshListes();
        merlinChat?.setBackgroundComplete();
        void syncNow().then(() => updateSyncIndicator(syncIndicator));
      }
    });
  };

  registerAgentJobResume(resumeAgentJobs);
  if (listPendingAgentJobs().length > 0) {
    void merlinChat?.refresh();
    resumeAgentJobs();
  }

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
      refreshListes();
      updateSyncIndicator(syncIndicator);
    });
    void syncNow().then(() => {
      journal?.refreshAfterSync();
      void merlinChat?.refresh();
      refreshListes();
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
