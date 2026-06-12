import { Journal } from './journal';
import { getMeta, saveMeta } from './db';
import {
  createSettingsButton,
  initSyncFromMeta,
  touchVisitMeta,
} from './settings';
import { syncNow } from './sync';
import { getStoredPassphrase } from './crypto';
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

  const journalContainer = document.createElement('main');
  journalContainer.className = 'app__main';

  header.appendChild(title);
  header.appendChild(syncIndicator);

  let journal: Journal | null = null;

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
  });
  header.appendChild(settingsBtn);

  root.appendChild(header);
  root.appendChild(journalContainer);

  const meta = await getMeta();

  journal = new Journal({
    container: journalContainer,
    meta,
    onScrollAnchorChange: (anchor) => {
      void saveMeta({ scrollAnchor: anchor });
    },
  });

  await journal.init();

  const today = todayKey();
  if (meta.lastVisitDate !== today) {
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
