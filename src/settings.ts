import {
  clearStoredPassphrase,
  getStoredPassphrase,
  storePassphrase,
} from './crypto';
import {
  getAiConfig,
  getDefaultModel,
  getStoredMerlinApiKey,
  storeAiConfig,
  storeMerlinApiKey,
  type AiProvider,
} from './merlin-ai';
import { getMeta, saveMeta } from './db';
import { startSyncLoop, syncNow } from './sync';
import type { AppMeta } from './types';
import { todayKey } from './types';

export interface SettingsCallbacks {
  onPassphraseSet: () => void;
  onSyncStatus: (status: string) => void;
  onMerlinChange: (enabled: boolean, fromUserGesture?: boolean) => void;
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
        <label class="modal__label" for="ai-provider">Fournisseur IA</label>
        <select id="ai-provider" class="modal__input">
          <option value="openrouter">OpenRouter (modèles gratuits)</option>
          <option value="openai">OpenAI</option>
          <option value="custom">API personnelle</option>
        </select>
        <label class="modal__label" for="merlin-api-key">Clé API <span id="ai-key-optional">(optionnel pour OpenRouter)</span></label>
        <input
          id="merlin-api-key"
          class="modal__input"
          type="password"
          autocomplete="off"
          placeholder="sk-or-… ou sk-…"
        />
        <label class="modal__label" for="ai-model">Modèle</label>
        <input
          id="ai-model"
          class="modal__input"
          type="text"
          autocomplete="off"
          placeholder="openrouter/free"
        />
        <div id="ai-custom-url-wrap" hidden>
          <label class="modal__label" for="ai-base-url">URL de l'API (compatible OpenAI)</label>
          <input
            id="ai-base-url"
            class="modal__input"
            type="url"
            autocomplete="off"
            placeholder="https://votre-serveur/v1/chat/completions"
          />
        </div>
        <p class="modal__desc modal__desc--small">
          Corrige les erreurs de dictée, structure vos notes (#tags, [[concepts]]) et alimente la carte mentale.
          OpenRouter : définissez <code>OPENROUTER_API_KEY</code> sur le serveur (Vercel ou fichier <code>.env</code> en local).
          Modèle recommandé : <code>openrouter/free</code> (choisit automatiquement un modèle gratuit disponible).
        </p>
        <button type="button" class="btn btn--ghost" id="save-merlin-key">Enregistrer config IA</button>
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
    const providerSelect = modal.querySelector<HTMLSelectElement>('#ai-provider')!;
    const modelInput = modal.querySelector<HTMLInputElement>('#ai-model')!;
    const baseUrlInput = modal.querySelector<HTMLInputElement>('#ai-base-url')!;
    const customUrlWrap = modal.querySelector<HTMLElement>('#ai-custom-url-wrap')!;
    const keyOptionalHint = modal.querySelector<HTMLElement>('#ai-key-optional')!;

    const aiConfig = getAiConfig();
    providerSelect.value = aiConfig.provider;
    modelInput.value = aiConfig.model;
    modelInput.placeholder = getDefaultModel(aiConfig.provider);
    if (aiConfig.baseUrl) baseUrlInput.value = aiConfig.baseUrl;

    const syncCustomUrlVisibility = (): void => {
      const provider = providerSelect.value;
      customUrlWrap.hidden = provider !== 'custom';
      keyOptionalHint.hidden = provider !== 'openrouter';
    };
    syncCustomUrlVisibility();

    providerSelect.addEventListener('change', () => {
      const provider = providerSelect.value as AiProvider;
      syncCustomUrlVisibility();
      if (!modelInput.dataset.userEdited) {
        modelInput.value = '';
        modelInput.placeholder = getDefaultModel(provider);
      }
    });

    modelInput.addEventListener('input', () => {
      modelInput.dataset.userEdited = '1';
    });

    if (meta.passphraseSet && getStoredPassphrase()) {
      input.placeholder = '•••••••• (déjà configurée)';
      statusEl.textContent = formatSyncStatus(meta);
    }

    if (meta.merlinApiKeySet && getStoredMerlinApiKey()) {
      apiKeyInput.placeholder = '•••••••• (déjà configurée)';
      merlinStatusEl.textContent = 'Clé API locale enregistrée sur cet appareil.';
    } else if (aiConfig.provider === 'openrouter') {
      merlinStatusEl.textContent = 'OpenRouter via OPENROUTER_API_KEY sur le serveur (ou clé locale optionnelle).';
    }

    merlinToggle.addEventListener('change', () => {
      const enabled = merlinToggle.checked;
      void saveMeta({ merlinEnabled: enabled }).then(() => {
        callbacks.onMerlinChange(enabled, true);
        if (enabled) {
          merlinStatusEl.textContent = 'Merlin activé — appuyez sur 🎙 pour lancer l\'écoute.';
        } else {
          merlinStatusEl.textContent = 'Merlin désactivé.';
        }
      });
    });

    modal.querySelector('#save-merlin-key')!.addEventListener('click', () => {
      const value = apiKeyInput.value.trim();
      const provider = providerSelect.value as AiProvider;
      const model = modelInput.value.trim() || getDefaultModel(provider);
      const baseUrl = baseUrlInput.value.trim();

      if (!value && !getStoredMerlinApiKey()) {
        if (provider !== 'openrouter') {
          merlinStatusEl.textContent = 'Entrez une clé API.';
          return;
        }
      }

      if (provider === 'custom' && !baseUrl) {
        merlinStatusEl.textContent = 'Entrez l\'URL de votre API.';
        return;
      }

      if (value) storeMerlinApiKey(value);
      storeAiConfig({ provider, model, baseUrl: provider === 'custom' ? baseUrl : '' });

      void saveMeta({ merlinApiKeySet: true }).then(() => {
        merlinStatusEl.textContent = value
          ? 'Configuration IA enregistrée (clé locale).'
          : 'Configuration IA enregistrée (OpenRouter via serveur).';
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
