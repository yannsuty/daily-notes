import {
  clearStoredPassphrase,
  getStoredPassphrase,
  storePassphrase,
} from './crypto';
import { getMeta, saveMeta, clearMerlinConversation, clearMerlinFacts, getMerlinFacts } from './db';
import { startSyncLoop, syncNow } from './sync';
import type { AppMeta } from './types';
import { todayKey } from './types';

export interface SettingsCallbacks {
  onPassphraseSet: () => void;
  onSyncStatus: (status: string) => void;
  onMerlinChange: (enabled: boolean, fromUserGesture?: boolean) => void;
  onReanalyzeThoughts: () => Promise<void>;
  onMemoryCleared?: () => void;
}

export function createSettingsButton(callbacks: SettingsCallbacks): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'settings-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Réglages');
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;
  btn.addEventListener('click', () => openSettingsModal(callbacks));
  return btn;
}

function openSettingsModal(callbacks: SettingsCallbacks): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-labelledby', 'settings-title');

  void getMeta().then((meta) => {
    modal.innerHTML = `
      <h2 id="settings-title" class="modal__title">Réglages</h2>

      <section class="modal__section">
        <h3 class="modal__section-title">Mémoire de Merlin</h3>
        <p class="modal__desc">
          Faits mémorisés automatiquement ou sur demande. Synchronisés avec vos notes si la sync est active.
        </p>
        <div class="modal__memory-list" id="merlin-memory-list"></div>
        <p class="modal__status" id="memory-status"></p>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" id="clear-memory-facts">Effacer les faits</button>
          <button type="button" class="btn btn--ghost" id="clear-memory-chat">Effacer la conversation</button>
        </div>
      </section>

      <section class="modal__section">
        <h3 class="modal__section-title">Merlin vocal</h3>
        <label class="modal__toggle">
          <input type="checkbox" id="merlin-enabled" ${meta.merlinEnabled ? 'checked' : ''} />
          <span>Activer Merlin (écoute et micro)</span>
        </label>
        <label class="modal__toggle">
          <input type="checkbox" id="merlin-continuous" ${meta.merlinContinuousListen !== false ? 'checked' : ''} />
          <span>Écoute continue (wake word « Merlin »)</span>
        </label>
        <label class="modal__toggle">
          <input type="checkbox" id="merlin-tts" ${meta.merlinTtsEnabled !== false ? 'checked' : ''} />
          <span>Réponses vocales (synthèse)</span>
        </label>
        <label class="modal__label" for="merlin-tts-rate">Vitesse de la voix</label>
        <input
          id="merlin-tts-rate"
          class="modal__input"
          type="range"
          min="0.5"
          max="1.5"
          step="0.1"
          value="${meta.merlinTtsRate ?? 1}"
        />
        <p class="modal__desc">Dites « Merlin » pour discuter, « Merlin journal » pour dicter. Sur Android, l'écoute continue fonctionne en arrière-plan via une notification.</p>
        <p class="modal__status" id="merlin-status"></p>
      </section>

      <section class="modal__section">
        <h3 class="modal__section-title">Pensées</h3>
        <p class="modal__desc">
          Relance l'analyse IA de vos notes pour régénérer la carte des pensées.
        </p>
        <p class="modal__status" id="thoughts-status"></p>
        <button type="button" class="btn btn--sync" id="reanalyze-thoughts">Réanalyser les pensées</button>
      </section>

      <section class="modal__section">
        <h3 class="modal__section-title">Synchronisation</h3>
        <p class="modal__desc">
          Entrez la même phrase secrète sur tous vos appareils pour synchroniser vos notes.
          Vos données sont chiffrées avant d'être envoyées au serveur.
        </p>
        <label class="modal__label" for="passphrase">Phrase secrète</label>
        <input
          id="passphrase"
          class="modal__input"
          type="password"
          autocomplete="current-password"
          placeholder="Votre phrase secrète"
        />
        <p class="modal__status" id="sync-status"></p>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" id="clear-passphrase">Effacer</button>
          <button type="button" class="btn btn--primary" id="save-passphrase">Enregistrer</button>
        </div>
        <button type="button" class="btn btn--sync" id="sync-now">Synchroniser maintenant</button>
      </section>
    `;

    const statusEl = modal.querySelector<HTMLElement>('#sync-status')!;
    const input = modal.querySelector<HTMLInputElement>('#passphrase')!;
    const merlinStatusEl = modal.querySelector<HTMLElement>('#merlin-status')!;
    const merlinToggle = modal.querySelector<HTMLInputElement>('#merlin-enabled')!;
    const merlinContinuous = modal.querySelector<HTMLInputElement>('#merlin-continuous')!;
    const merlinTts = modal.querySelector<HTMLInputElement>('#merlin-tts')!;
    const merlinTtsRate = modal.querySelector<HTMLInputElement>('#merlin-tts-rate')!;
    const thoughtsStatusEl = modal.querySelector<HTMLElement>('#thoughts-status')!;
    const reanalyzeBtn = modal.querySelector<HTMLButtonElement>('#reanalyze-thoughts')!;
    const memoryListEl = modal.querySelector<HTMLElement>('#merlin-memory-list')!;
    const memoryStatusEl = modal.querySelector<HTMLElement>('#memory-status')!;

    void renderMemoryList(memoryListEl);

    modal.querySelector('#clear-memory-facts')!.addEventListener('click', () => {
      void clearMerlinFacts().then(async () => {
        memoryStatusEl.textContent = 'Faits mémorisés effacés.';
        await renderMemoryList(memoryListEl);
        callbacks.onMemoryCleared?.();
      });
    });

    modal.querySelector('#clear-memory-chat')!.addEventListener('click', () => {
      void clearMerlinConversation().then(() => {
        memoryStatusEl.textContent = 'Conversation effacée.';
        callbacks.onMemoryCleared?.();
      });
    });

    if (meta.passphraseSet && getStoredPassphrase()) {
      input.placeholder = '•••••••• (déjà configurée)';
      statusEl.textContent = formatSyncStatus(meta);
    }

    merlinToggle.addEventListener('change', () => {
      const enabled = merlinToggle.checked;
      void saveMeta({ merlinEnabled: enabled }).then(() => {
        callbacks.onMerlinChange(enabled, true);
        if (enabled) {
          merlinStatusEl.textContent = 'Merlin activé — dites « Merlin » ou appuyez sur 🎙.';
        } else {
          merlinStatusEl.textContent = 'Merlin désactivé.';
        }
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
      void callbacks.onReanalyzeThoughts().then(() => {
        thoughtsStatusEl.textContent = 'Analyse relancée. Consultez l\'onglet Pensées.';
        reanalyzeBtn.disabled = false;
      });
    });

    modal.querySelector('#save-passphrase')!.addEventListener('click', () => {
      const value = input.value.trim();
      if (value.length < 4) {
        statusEl.textContent = 'La phrase doit contenir au moins 4 caractères.';
        return;
      }
      storePassphrase(value);
      void saveMeta({ passphraseSet: true }).then(() => {
        statusEl.textContent = 'Phrase enregistrée. Synchronisation…';
        callbacks.onPassphraseSet();
        void syncNow().then((result) => {
          statusEl.textContent = result.ok
            ? 'Synchronisation réussie.'
            : `Erreur : ${result.error ?? 'inconnue'}`;
        });
      });
    });

    modal.querySelector('#clear-passphrase')!.addEventListener('click', () => {
      clearStoredPassphrase();
      void saveMeta({ passphraseSet: false, lastSyncAt: 0 }).then(() => {
        statusEl.textContent = 'Phrase effacée de cet appareil.';
        input.value = '';
        input.placeholder = 'Votre phrase secrète';
      });
    });

    modal.querySelector('#sync-now')!.addEventListener('click', () => {
      if (!getStoredPassphrase()) {
        statusEl.textContent = 'Configurez d\'abord une phrase secrète.';
        return;
      }
      statusEl.textContent = 'Synchronisation…';
      void syncNow().then((result) => {
        statusEl.textContent = result.ok
          ? 'Synchronisation réussie.'
          : `Erreur : ${result.error ?? 'inconnue'}`;
        if (result.ok) callbacks.onSyncStatus('synced');
      });
    });
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener(
    'keydown',
    function escHandler(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', escHandler);
      }
    },
  );
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
    container.innerHTML = '<p class="modal__desc">Aucun fait mémorisé pour l\'instant.</p>';
    return;
  }
  container.innerHTML = facts
    .map(
      (f) =>
        `<div class="modal__memory-item"><strong>${escapeHtml(f.key)}</strong> : ${escapeHtml(f.value)}</div>`,
    )
    .join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
