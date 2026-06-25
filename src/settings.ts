import {
  checkForAppUpdate,
  clearPendingDownload,
  downloadAndInstallUpdate,
  formatDownloadProgress,
  getInstalledAppInfo,
  getPendingDownloadState,
  installDownloadedUpdate,
  isNativeAndroid,
  offDownloadProgress,
  onDownloadProgress,
  resolveInstalledReleaseLabel,
} from './app-update';
import {
  clearStoredPassphrase,
  getStoredPassphrase,
  storePassphrase,
} from './crypto';
import { getMeta, saveMeta, clearMerlinConversation, clearMerlinFacts, getMerlinFacts, getMerlinLists, getMerlinReminders, getMerlinShortcuts, getMerlinCustomTools, deleteMerlinList, deleteMerlinReminder, deleteMerlinShortcut, deleteMerlinCustomTool, deleteMerlinEnvVar } from './db';
import {
  BUILTIN_MERLIN_ENV_FIELDS,
  getAllMerlinEnvMap,
  getCustomMerlinEnvEntries,
  setMerlinEnv,
} from './merlin-env';
import { startSyncLoop, syncNow } from './sync';
import type { AppMeta } from './types';
import { todayKey } from './types';
import { APP_VERSION } from './version';
import {
  buildAgentDevLogExport,
  copyAgentDevLogsToClipboard,
  isAgentDevLogEnabled,
  setAgentDevLogEnabled,
} from './agent-dev-log';

export interface SettingsCallbacks {
  onPassphraseSet: () => void;
  onSyncStatus: (status: string) => void;
  onMerlinChange: (enabled: boolean, fromUserGesture?: boolean) => void;
  onReanalyzeThoughts: () => Promise<void>;
  onMemoryCleared?: () => void;
}

export class SettingsPage {
  private container: HTMLElement;
  private callbacks: SettingsCallbacks;

  constructor(container: HTMLElement, callbacks: SettingsCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  async init(): Promise<void> {
    this.container.classList.add('settings-page');
    await this.render();
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    const meta = await getMeta();
    const envMap = await getAllMerlinEnvMap();
    const customEnv = await getCustomMerlinEnvEntries();

    const builtinFieldsHtml = BUILTIN_MERLIN_ENV_FIELDS.map((field) => {
      const value = envMap[field.key] ?? '';
      const inputType = field.secret ? 'password' : 'text';
      const inputTag = field.multiline
        ? `<textarea id="env-${field.key}" class="settings__input settings__input--area" rows="2" placeholder="${escapeHtml(field.placeholder)}">${escapeHtml(value)}</textarea>`
        : `<input id="env-${field.key}" class="settings__input" type="${inputType}" autocomplete="off" placeholder="${escapeHtml(field.placeholder)}" value="${escapeHtml(value)}" />`;
      return `
        <label class="settings__label" for="env-${field.key}">${escapeHtml(field.label)}</label>
        ${inputTag}
        ${field.hint ? `<p class="settings__desc settings__desc--tight">${escapeHtml(field.hint)}</p>` : ''}
      `;
    }).join('');

    const customEnvHtml =
      customEnv.length > 0
        ? customEnv
            .map(
              (e) =>
                `<div class="settings__memory-item settings__memory-item--row">
                  <span><code>${escapeHtml(e.key)}</code> = ${fieldPreview(e.value, e.key)}</span>
                  <button type="button" class="btn btn--ghost btn--sm" data-delete-env="${escapeHtml(e.key)}">Suppr.</button>
                </div>`,
            )
            .join('')
        : '<p class="settings__desc">Aucune variable personnalisée.</p>';

    const installedInfo = isNativeAndroid() ? await getInstalledAppInfo() : null;
    const versionLabel = installedInfo
      ? resolveInstalledReleaseLabel(installedInfo.versionCode, installedInfo.versionName)
      : `v${APP_VERSION}`;

    this.container.innerHTML = `
      <div class="settings-page__scroll">
        <header class="settings-page__header">
          <img class="settings-page__logo" src="icons/icon.svg" width="56" height="56" alt="" />
          <h2 class="settings-page__title">Réglages</h2>
        </header>

        <section class="settings__section">
          <h3 class="settings__section-title">Mémoire de Merlin</h3>
          <p class="settings__desc">
            Faits mémorisés automatiquement ou sur demande. Synchronisés avec vos notes si la sync est active.
          </p>
          <div class="settings__memory-list" id="merlin-memory-list"></div>
          <p class="settings__status" id="memory-status"></p>
          <div class="settings__actions">
            <button type="button" class="btn btn--ghost" id="clear-memory-facts">Effacer les faits</button>
            <button type="button" class="btn btn--ghost" id="clear-memory-chat">Effacer la conversation</button>
          </div>
        </section>

        <section class="settings__section">
          <h3 class="settings__section-title">Listes et rappels</h3>
          <p class="settings__desc">
            Gérez vos listes, rappels et routines Merlin. Dites « ajoute du lait à courses » ou « rappelle-moi à midi ».
            Sur le web, les rappels horaires ne notifient que si l'onglet est ouvert — utilisez l'app Android pour des alertes fiables.
          </p>
          <div class="settings__memory-list" id="merlin-actions-list"></div>
          <p class="settings__status" id="actions-status"></p>
        </section>

        <section class="settings__section">
          <h3 class="settings__section-title">Configuration IA</h3>
          <p class="settings__desc">
            Variables stockées localement et synchronisées (chiffrées) avec vos notes.
            Prioritaires sur la configuration serveur — utiles pour les futurs outils Merlin.
          </p>
          ${builtinFieldsHtml}
          <p class="settings__status" id="env-status"></p>
          <button type="button" class="btn btn--primary" id="save-merlin-env">Enregistrer la configuration IA</button>

          <h4 class="settings__subsection">Variables personnalisées</h4>
          <p class="settings__desc settings__desc--tight">
            Clé en MAJUSCULES_SNAKE (ex. <code>WEATHER_API_KEY</code>).
          </p>
          <div class="settings__env-add">
            <input id="custom-env-key" class="settings__input" type="text" placeholder="CLE_API" autocomplete="off" />
            <input id="custom-env-value" class="settings__input" type="text" placeholder="valeur" autocomplete="off" />
            <button type="button" class="btn btn--ghost" id="add-custom-env">Ajouter</button>
          </div>
          <div class="settings__memory-list" id="custom-env-list">${customEnvHtml}</div>
        </section>

        <section class="settings__section">
          <h3 class="settings__section-title">Merlin vocal</h3>
          <label class="settings__toggle">
            <input type="checkbox" id="merlin-enabled" ${meta.merlinEnabled ? 'checked' : ''} />
            <span>Activer Merlin (écoute et micro)</span>
          </label>
          <label class="settings__toggle">
            <input type="checkbox" id="merlin-continuous" ${meta.merlinContinuousListen !== false ? 'checked' : ''} />
            <span>Écoute continue (wake word « Merlin »)</span>
          </label>
          <label class="settings__toggle">
            <input type="checkbox" id="merlin-tts" ${meta.merlinTtsEnabled !== false ? 'checked' : ''} />
            <span>Réponses vocales (synthèse)</span>
          </label>
          <label class="settings__label" for="merlin-tts-rate">Vitesse de la voix</label>
          <input
            id="merlin-tts-rate"
            class="settings__input"
            type="range"
            min="0.5"
            max="1.5"
            step="0.1"
            value="${meta.merlinTtsRate ?? 1}"
          />
          <p class="settings__desc">Dites « Merlin » pour discuter, « Merlin journal » pour dicter. Sur Android, l'écoute continue fonctionne en arrière-plan via une notification.</p>
          <p class="settings__status" id="merlin-status"></p>
        </section>

        <section class="settings__section">
          <h3 class="settings__section-title">Pensées</h3>
          <p class="settings__desc">
            Relance l'analyse IA de vos notes pour régénérer la carte des pensées.
          </p>
          <p class="settings__status" id="thoughts-status"></p>
          <button type="button" class="btn btn--sync" id="reanalyze-thoughts">Réanalyser les pensées</button>
        </section>

        <section class="settings__section">
          <h3 class="settings__section-title">Synchronisation</h3>
          <p class="settings__desc">
            Entrez la même phrase secrète sur tous vos appareils pour synchroniser vos notes.
            Vos données sont chiffrées avant d'être envoyées au serveur.
          </p>
          <label class="settings__label" for="passphrase">Phrase secrète</label>
          <input
            id="passphrase"
            class="settings__input"
            type="password"
            autocomplete="current-password"
            placeholder="Votre phrase secrète"
          />
          <p class="settings__status" id="sync-status"></p>
          <div class="settings__actions">
            <button type="button" class="btn btn--ghost" id="clear-passphrase">Effacer</button>
            <button type="button" class="btn btn--primary" id="save-passphrase">Enregistrer</button>
          </div>
          <button type="button" class="btn btn--sync" id="sync-now">Synchroniser maintenant</button>
        </section>

        <section class="settings__section" id="app-update-section">
          <h3 class="settings__section-title">Mise à jour de l'app</h3>
          <p class="settings__desc">
            Version installée : <strong>${escapeHtml(versionLabel)}</strong>.
            ${
              isNativeAndroid()
                ? 'Les mises à jour sont téléchargées depuis GitHub Releases.'
                : 'Disponible uniquement dans l’app Android installée hors Play Store.'
            }
          </p>
          <p class="settings__status" id="app-update-status"></p>
          <div class="settings__actions">
            <button
              type="button"
              class="btn btn--primary"
              id="check-app-update"
              ${isNativeAndroid() ? '' : 'disabled'}
            >
              Vérifier et mettre à jour
            </button>
            <button
              type="button"
              class="btn btn--ghost"
              id="clear-app-download"
              ${isNativeAndroid() ? '' : 'disabled'}
            >
              Effacer le téléchargement
            </button>
          </div>
        </section>

        ${
          isAgentDevLogEnabled()
            ? `
        <section class="settings__section" id="agent-dev-log-section">
          <h3 class="settings__section-title">Logs agent (dev)</h3>
          <p class="settings__desc">
            Trace la reprise des jobs Merlin (client + serveur). Activé si <code>APP_ENV=dev</code> au build ou sur Vercel, sinon 7 appuis sur la version. Copiez après un échec pour le diagnostic.
          </p>
          <textarea
            id="agent-dev-log-preview"
            class="settings__input settings__input--area settings__input--mono"
            rows="8"
            readonly
            placeholder="Les logs apparaîtront ici…"
          ></textarea>
          <p class="settings__status" id="agent-dev-log-status"></p>
          <div class="settings__actions">
            <button type="button" class="btn btn--primary" id="copy-agent-dev-logs">Copier les logs</button>
            <button type="button" class="btn btn--ghost" id="refresh-agent-dev-logs">Rafraîchir</button>
            <button type="button" class="btn btn--ghost" id="disable-agent-dev-logs">Désactiver</button>
          </div>
        </section>
        `
            : ''
        }

      </div>

      <footer class="settings-page__footer" id="settings-version-footer">
        <span>Merlin ${escapeHtml(versionLabel)}</span>
        ${isAgentDevLogEnabled() ? '' : '<span class="settings__desc settings__desc--tight">Appui ×7 sur la version pour activer les logs agent (ou APP_ENV=dev au build)</span>'}
      </footer>
    `;

    this.bindEvents(meta);
  }

  private bindEvents(meta: AppMeta): void {
    const statusEl = this.container.querySelector<HTMLElement>('#sync-status')!;
    const input = this.container.querySelector<HTMLInputElement>('#passphrase')!;
    const merlinStatusEl = this.container.querySelector<HTMLElement>('#merlin-status')!;
    const merlinToggle = this.container.querySelector<HTMLInputElement>('#merlin-enabled')!;
    const merlinContinuous = this.container.querySelector<HTMLInputElement>('#merlin-continuous')!;
    const merlinTts = this.container.querySelector<HTMLInputElement>('#merlin-tts')!;
    const merlinTtsRate = this.container.querySelector<HTMLInputElement>('#merlin-tts-rate')!;
    const thoughtsStatusEl = this.container.querySelector<HTMLElement>('#thoughts-status')!;
    const reanalyzeBtn = this.container.querySelector<HTMLButtonElement>('#reanalyze-thoughts')!;
    const memoryListEl = this.container.querySelector<HTMLElement>('#merlin-memory-list')!;
    const memoryStatusEl = this.container.querySelector<HTMLElement>('#memory-status')!;
    const actionsListEl = this.container.querySelector<HTMLElement>('#merlin-actions-list')!;
    const actionsStatusEl = this.container.querySelector<HTMLElement>('#actions-status')!;
    const envStatusEl = this.container.querySelector<HTMLElement>('#env-status')!;
    const appUpdateStatusEl = this.container.querySelector<HTMLElement>('#app-update-status')!;
    const appUpdateBtn = this.container.querySelector<HTMLButtonElement>('#check-app-update')!;
    const clearAppDownloadBtn = this.container.querySelector<HTMLButtonElement>('#clear-app-download')!;
    const devLogStatusEl = this.container.querySelector<HTMLElement>('#agent-dev-log-status');
    const devLogPreviewEl = this.container.querySelector<HTMLTextAreaElement>('#agent-dev-log-preview');
    const copyDevLogsBtn = this.container.querySelector<HTMLButtonElement>('#copy-agent-dev-logs');
    const refreshDevLogsBtn = this.container.querySelector<HTMLButtonElement>('#refresh-agent-dev-logs');
    const disableDevLogsBtn = this.container.querySelector<HTMLButtonElement>('#disable-agent-dev-logs');
    const versionFooter = this.container.querySelector<HTMLElement>('#settings-version-footer');

    let versionTapCount = 0;
    let versionTapTimer: ReturnType<typeof setTimeout> | undefined;

    const refreshDevLogPreview = async (): Promise<void> => {
      if (!devLogPreviewEl || !devLogStatusEl) return;
      devLogStatusEl.textContent = 'Chargement des logs…';
      try {
        const text = await buildAgentDevLogExport();
        devLogPreviewEl.value = text;
        devLogStatusEl.textContent = `${text.split('\n').length} lignes`;
      } catch (err) {
        devLogStatusEl.textContent = err instanceof Error ? err.message : 'Erreur';
      }
    };

    versionFooter?.addEventListener('click', () => {
      if (isAgentDevLogEnabled()) return;
      versionTapCount += 1;
      if (versionTapTimer) clearTimeout(versionTapTimer);
      versionTapTimer = setTimeout(() => {
        versionTapCount = 0;
      }, 2500);
      if (versionTapCount >= 7) {
        versionTapCount = 0;
        setAgentDevLogEnabled(true);
        void this.render();
      }
    });

    copyDevLogsBtn?.addEventListener('click', () => {
      void (async () => {
        if (!devLogStatusEl) return;
        try {
          await copyAgentDevLogsToClipboard();
          devLogStatusEl.textContent = 'Logs copiés dans le presse-papiers.';
        } catch (err) {
          devLogStatusEl.textContent = err instanceof Error ? err.message : 'Copie impossible';
        }
      })();
    });

    refreshDevLogsBtn?.addEventListener('click', () => {
      void refreshDevLogPreview();
    });

    disableDevLogsBtn?.addEventListener('click', () => {
      setAgentDevLogEnabled(false);
      void this.render();
    });

    if (devLogPreviewEl) {
      void refreshDevLogPreview();
    }

    const showDownloadProgress = (percent?: number): void => {
      if (percent != null && percent > 0) {
        appUpdateStatusEl.textContent = `Téléchargement… ${percent} %`;
        return;
      }
      appUpdateStatusEl.textContent = 'Téléchargement…';
    };

    void renderMemoryList(memoryListEl);
    void renderActionsList(actionsListEl, actionsStatusEl);

    this.container.querySelector('#save-merlin-env')!.addEventListener('click', () => {
      void (async () => {
        for (const field of BUILTIN_MERLIN_ENV_FIELDS) {
          const el = this.container.querySelector<HTMLElement>(`#env-${field.key}`)!;
          const value =
            el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
              ? el.value
              : '';
          await setMerlinEnv(field.key, value);
        }
        envStatusEl.textContent = 'Configuration IA enregistrée.';
      })();
    });

    this.container.querySelector('#add-custom-env')!.addEventListener('click', () => {
      void (async () => {
        const keyEl = this.container.querySelector<HTMLInputElement>('#custom-env-key')!;
        const valEl = this.container.querySelector<HTMLInputElement>('#custom-env-value')!;
        const key = keyEl.value.trim().toUpperCase().replace(/\s+/g, '_');
        const value = valEl.value.trim();
        if (!key || !/^[A-Z][A-Z0-9_]*$/.test(key)) {
          envStatusEl.textContent = 'Clé invalide (MAJUSCULES_SNAKE uniquement).';
          return;
        }
        if (BUILTIN_MERLIN_ENV_FIELDS.some((f) => f.key === key)) {
          envStatusEl.textContent = 'Utilisez le champ dédié pour cette clé.';
          return;
        }
        await setMerlinEnv(key, value);
        keyEl.value = '';
        valEl.value = '';
        envStatusEl.textContent = `Variable ${key} enregistrée.`;
        await this.render();
      })();
    });

    this.container.querySelectorAll('[data-delete-env]').forEach((btn) => {
      btn.addEventListener('click', () => {
        void deleteMerlinEnvVar((btn as HTMLElement).dataset.deleteEnv!).then(async () => {
          envStatusEl.textContent = 'Variable supprimée.';
          await this.render();
        });
      });
    });

    this.container.querySelector('#clear-memory-facts')!.addEventListener('click', () => {
      void clearMerlinFacts().then(async () => {
        memoryStatusEl.textContent = 'Faits mémorisés effacés.';
        await renderMemoryList(memoryListEl);
        this.callbacks.onMemoryCleared?.();
      });
    });

    this.container.querySelector('#clear-memory-chat')!.addEventListener('click', () => {
      void clearMerlinConversation().then(() => {
        memoryStatusEl.textContent = 'Conversation effacée.';
        this.callbacks.onMemoryCleared?.();
      });
    });

    if (meta.passphraseSet && getStoredPassphrase()) {
      input.placeholder = '•••••••• (déjà configurée)';
      statusEl.textContent = formatSyncStatus(meta);
    }

    merlinToggle.addEventListener('change', () => {
      const enabled = merlinToggle.checked;
      void saveMeta({ merlinEnabled: enabled }).then(() => {
        this.callbacks.onMerlinChange(enabled, true);
        merlinStatusEl.textContent = enabled
          ? 'Merlin activé — dites « Merlin » ou appuyez sur 🎙.'
          : 'Merlin désactivé.';
      });
    });

    merlinContinuous.addEventListener('change', () => {
      void saveMeta({ merlinContinuousListen: merlinContinuous.checked }).then(() => {
        merlinStatusEl.textContent = merlinContinuous.checked
          ? 'Écoute continue activée.'
          : 'Écoute continue désactivée — utilisez le bouton 🎙.';
      });
    });

    merlinTts.addEventListener('change', () => {
      void saveMeta({ merlinTtsEnabled: merlinTts.checked });
    });

    merlinTtsRate.addEventListener('change', () => {
      void saveMeta({ merlinTtsRate: parseFloat(merlinTtsRate.value) });
    });

    reanalyzeBtn.addEventListener('click', () => {
      reanalyzeBtn.disabled = true;
      thoughtsStatusEl.textContent = 'Analyse en cours…';
      void this.callbacks.onReanalyzeThoughts().then(() => {
        thoughtsStatusEl.textContent = 'Analyse relancée. Ouvrez Galerie > Pensées.';
        reanalyzeBtn.disabled = false;
      });
    });

    this.container.querySelector('#save-passphrase')!.addEventListener('click', () => {
      const value = input.value.trim();
      if (value.length < 4) {
        statusEl.textContent = 'La phrase doit contenir au moins 4 caractères.';
        return;
      }
      storePassphrase(value);
      void saveMeta({ passphraseSet: true }).then(() => {
        statusEl.textContent = 'Phrase enregistrée. Synchronisation…';
        this.callbacks.onPassphraseSet();
        void syncNow().then((result) => {
          statusEl.textContent = result.ok
            ? 'Synchronisation réussie.'
            : `Erreur : ${result.error ?? 'inconnue'}`;
        });
      });
    });

    this.container.querySelector('#clear-passphrase')!.addEventListener('click', () => {
      clearStoredPassphrase();
      void saveMeta({ passphraseSet: false, lastSyncAt: 0 }).then(() => {
        statusEl.textContent = 'Phrase effacée de cet appareil.';
        input.value = '';
        input.placeholder = 'Votre phrase secrète';
      });
    });

    this.container.querySelector('#sync-now')!.addEventListener('click', () => {
      if (!getStoredPassphrase()) {
        statusEl.textContent = 'Configurez d\'abord une phrase secrète.';
        return;
      }
      statusEl.textContent = 'Synchronisation…';
      void syncNow().then((result) => {
        statusEl.textContent = result.ok
          ? 'Synchronisation réussie.'
          : `Erreur : ${result.error ?? 'inconnue'}`;
        if (result.ok) this.callbacks.onSyncStatus('synced');
      });
    });

    if (isNativeAndroid()) {
      void getPendingDownloadState().then((pending) => {
        if (pending) {
          appUpdateStatusEl.textContent = formatDownloadProgress(pending);
        }
      });
    }

    clearAppDownloadBtn.addEventListener('click', () => {
      void clearPendingDownload().then(() => {
        appUpdateStatusEl.textContent = 'Téléchargement effacé.';
      });
    });

    appUpdateBtn.addEventListener('click', () => {
      if (!isNativeAndroid()) {
        appUpdateStatusEl.textContent = 'Disponible uniquement sur l’app Android.';
        return;
      }

      appUpdateBtn.disabled = true;
      appUpdateStatusEl.textContent = 'Recherche d’une mise à jour…';

      void (async () => {
        try {
          const pending = await getPendingDownloadState();
          if (pending?.status === 'paused' && pending.url && pending.versionCode != null) {
            showDownloadProgress(pending.percent);
            await onDownloadProgress((event) => {
              showDownloadProgress(event.percent);
            });
            try {
              await downloadAndInstallUpdate(pending.url, pending.versionCode);
              appUpdateStatusEl.textContent = 'Installation — confirmez dans Android.';
            } finally {
              await offDownloadProgress();
            }
            return;
          }

          if (pending?.status === 'complete') {
            await installDownloadedUpdate();
            appUpdateStatusEl.textContent = 'Installation — confirmez dans Android.';
            return;
          }

          const update = await checkForAppUpdate({ forceRefresh: true });
          if (update.error) {
            appUpdateStatusEl.textContent = update.error;
            return;
          }

          const latestLabel =
            update.latestVersionCode != null
              ? `v${update.latestVersion} · build ${update.latestVersionCode}`
              : `v${update.latestVersion}`;

          if (!update.available || !update.apkUrl) {
            appUpdateStatusEl.textContent = `${update.currentReleaseLabel} — à jour (dernière release ${latestLabel}).`;
            return;
          }

          appUpdateStatusEl.textContent = `Mise à jour ${latestLabel} trouvée. Téléchargement…`;

          await onDownloadProgress((event) => {
            showDownloadProgress(event.percent);
          });

          try {
            await downloadAndInstallUpdate(update.apkUrl, update.latestVersionCode ?? 0);
            appUpdateStatusEl.textContent = `Installation de ${latestLabel} — confirmez dans Android.`;
          } finally {
            await offDownloadProgress();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Mise à jour impossible.';
          const pending = await getPendingDownloadState();
          appUpdateStatusEl.textContent = pending
            ? `${message} ${formatDownloadProgress(pending)}`
            : message;
        } finally {
          appUpdateBtn.disabled = false;
        }
      })();
    });
  }
}

function formatSyncStatus(meta: AppMeta): string {
  if (!meta.lastSyncAt) return 'Sync activée — pas encore synchronisé.';
  const date = new Date(meta.lastSyncAt).toLocaleString('fr-FR');
  return `Dernière sync : ${date}`;
}

export function initSyncFromMeta(
  meta: AppMeta,
  onSynced: () => void,
): void {
  if (!meta.passphraseSet || !getStoredPassphrase()) return;

  startSyncLoop((result) => {
    if (result.ok) onSynced();
  });
}

export async function touchVisitMeta(): Promise<AppMeta> {
  return saveMeta({ lastVisitDate: todayKey() });
}

async function renderMemoryList(container: HTMLElement): Promise<void> {
  const facts = await getMerlinFacts();
  if (facts.length === 0) {
    container.innerHTML = '<p class="settings__desc">Aucun fait mémorisé pour l\'instant.</p>';
    return;
  }
  container.innerHTML = facts
    .map(
      (f) =>
        `<div class="settings__memory-item"><strong>${escapeHtml(f.key)}</strong> : ${escapeHtml(f.value)}</div>`,
    )
    .join('');
}

async function renderActionsList(
  container: HTMLElement,
  statusEl: HTMLElement,
): Promise<void> {
  const [lists, reminders, shortcuts, customTools] = await Promise.all([
    getMerlinLists(),
    getMerlinReminders(),
    getMerlinShortcuts(),
    getMerlinCustomTools(),
  ]);

  const parts: string[] = [];

  if (lists.length > 0) {
    parts.push('<h4 class="settings__subsection">Listes</h4>');
    for (const list of lists) {
      const count = list.items.filter((i) => !i.done).length;
      parts.push(
        `<div class="settings__memory-item settings__memory-item--row">
          <span><strong>${escapeHtml(list.title)}</strong> (${count} restant${count !== 1 ? 's' : ''})</span>
          <button type="button" class="btn btn--ghost btn--sm" data-delete-list="${list.id}">Suppr.</button>
        </div>`,
      );
    }
  }

  const activeReminders = reminders.filter((r) => r.status === 'active');
  if (activeReminders.length > 0) {
    parts.push('<h4 class="settings__subsection">Rappels actifs</h4>');
    for (const r of activeReminders) {
      parts.push(
        `<div class="settings__memory-item settings__memory-item--row">
          <span>${escapeHtml(r.text)}</span>
          <button type="button" class="btn btn--ghost btn--sm" data-delete-reminder="${r.id}">Suppr.</button>
        </div>`,
      );
    }
  }

  if (shortcuts.length > 0) {
    parts.push('<h4 class="settings__subsection">Raccourcis</h4>');
    for (const s of shortcuts.slice(0, 8)) {
      parts.push(
        `<div class="settings__memory-item settings__memory-item--row">
          <span>${escapeHtml(s.label)} <em class="settings__hint">(${s.usageCount}×)</em></span>
          <button type="button" class="btn btn--ghost btn--sm" data-delete-shortcut="${s.id}">Suppr.</button>
        </div>`,
      );
    }
  }

  if (customTools.length > 0) {
    parts.push('<h4 class="settings__subsection">Routines</h4>');
    for (const t of customTools) {
      parts.push(
        `<div class="settings__memory-item settings__memory-item--row">
          <span><code>${escapeHtml(t.name)}</code> — ${escapeHtml(t.description)}</span>
          <button type="button" class="btn btn--ghost btn--sm" data-delete-tool="${t.id}">Suppr.</button>
        </div>`,
      );
    }
  }

  if (parts.length === 0) {
    container.innerHTML = '<p class="settings__desc">Aucune action enregistrée.</p>';
    return;
  }

  container.innerHTML = parts.join('');

  container.querySelectorAll('[data-delete-list]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void deleteMerlinList((btn as HTMLElement).dataset.deleteList!).then(async () => {
        statusEl.textContent = 'Liste supprimée.';
        await renderActionsList(container, statusEl);
      });
    });
  });

  container.querySelectorAll('[data-delete-reminder]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void deleteMerlinReminder((btn as HTMLElement).dataset.deleteReminder!).then(async () => {
        const { rescheduleMerlinReminders } = await import('./merlin-scheduler');
        void rescheduleMerlinReminders();
        statusEl.textContent = 'Rappel supprimé.';
        await renderActionsList(container, statusEl);
      });
    });
  });

  container.querySelectorAll('[data-delete-shortcut]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void deleteMerlinShortcut((btn as HTMLElement).dataset.deleteShortcut!).then(async () => {
        statusEl.textContent = 'Raccourci supprimé.';
        await renderActionsList(container, statusEl);
      });
    });
  });

  container.querySelectorAll('[data-delete-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void deleteMerlinCustomTool((btn as HTMLElement).dataset.deleteTool!).then(async () => {
        const { invalidateCustomToolCache } = await import('./merlin-tool-registry');
        invalidateCustomToolCache();
        statusEl.textContent = 'Routine supprimée.';
        await renderActionsList(container, statusEl);
      });
    });
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fieldPreview(value: string, key: string): string {
  if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key)) {
    return value ? '••••••••' : '(vide)';
  }
  const short = value.length > 48 ? `${value.slice(0, 45)}…` : value;
  return escapeHtml(short || '(vide)');
}
