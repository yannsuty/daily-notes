import {
  clearStoredPassphrase,
  getStoredPassphrase,
  storePassphrase,
} from './crypto';
import {
  getStoredMerlinApiKey,
  storeMerlinApiKey,
} from './merlin-ai';
import { getMeta, saveMeta } from './db';
import { startSyncLoop, syncNow } from './sync';
import type { AppMeta } from './types';
import { todayKey } from './types';

export interface SettingsCallbacks {
  onPassphraseSet: () => void;
  onSyncStatus: (status: string) => void;
  onMerlinChange: (enabled: boolean) => void;
}

export function createSettingsButton(callbacks: SettingsCallbacks): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'settings-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Réglages');
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
  btn.addEventListener('click', () => openSettingsModal(callbacks));
  return btn;
}

function openSettingsModal(callbacks: SettingsCallbacks): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-labelledby', 'settings-title');

  void getMeta().then((meta) => {
    modal.innerHTML = `
      <h2 id="settings-title" class="modal__title">Réglages</h2>

      <section class="modal__section">
        <h3 class="modal__section-title">Merlin</h3>
        <label class="modal__toggle">
          <input type="checkbox" id="merlin-enabled" ${meta.merlinEnabled ? 'checked' : ''} />
          <span>Activer Merlin</span>
        </label>
        <p class="modal__desc">
          Dictée vocale pour votre journal. Dites <strong>« Merlin journal »</strong> pour commencer
          (l'app doit rester ouverte au premier plan — pas d'écoute écran éteint).
          Pour terminer : <strong>« Merlin termine »</strong>, <strong>« Merlin stop »</strong>,
          le bouton Stop, ou 8 secondes de silence après votre dernier mot.
        </p>
        <label class="modal__label" for="merlin-api-key">Clé API OpenAI (optionnel)</label>
        <input
          id="merlin-api-key"
          class="modal__input"
          type="password"
          autocomplete="off"
          placeholder="sk-…"
        />
        <p class="modal__desc modal__desc--small">
          Permet de structurer automatiquement vos dictées (#tags, [[concepts]], sections).
        </p>
        <button type="button" class="btn btn--ghost" id="save-merlin-key">Enregistrer clé API</button>
        <p class="modal__status" id="merlin-status"></p>
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
    const apiKeyInput = modal.querySelector<HTMLInputElement>('#merlin-api-key')!;

    if (meta.passphraseSet && getStoredPassphrase()) {
      input.placeholder = '•••••••• (déjà configurée)';
      statusEl.textContent = formatSyncStatus(meta);
    }

    if (meta.merlinApiKeySet && getStoredMerlinApiKey()) {
      apiKeyInput.placeholder = '•••••••• (déjà configurée)';
      merlinStatusEl.textContent = 'Clé API enregistrée sur cet appareil.';
    }

    merlinToggle.addEventListener('change', () => {
      const enabled = merlinToggle.checked;
      void saveMeta({ merlinEnabled: enabled }).then(() => {
        callbacks.onMerlinChange(enabled);
        merlinStatusEl.textContent = enabled
          ? 'Merlin activé.'
          : 'Merlin désactivé.';
      });
    });

    modal.querySelector('#save-merlin-key')!.addEventListener('click', () => {
      const value = apiKeyInput.value.trim();
      if (!value) {
        merlinStatusEl.textContent = 'Entrez une clé API.';
        return;
      }
      storeMerlinApiKey(value);
      void saveMeta({ merlinApiKeySet: true }).then(() => {
        merlinStatusEl.textContent = 'Clé API enregistrée.';
        apiKeyInput.value = '';
        apiKeyInput.placeholder = '•••••••• (déjà configurée)';
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
