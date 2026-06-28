# Merlin

Assistant personnel local-first — journal, chat avec Merlin, sync chiffrée entre appareils.

## Fonctionnalités

- Ouverture instantanée sur la note du jour
- Reprise du scroll là où vous en étiez (même journée)
- Scroll vers le haut pour consulter les jours précédents
- Stockage local IndexedDB (hors ligne)
- Sync optionnelle chiffrée via phrase secrète (AES-GCM + Upstash Redis)

## Développement local

```bash
npm install
npm run dev
```

L'app est disponible sur `http://localhost:5173`.

> **Note :** la route `/api/sync` ne fonctionne qu'après déploiement sur Vercel avec Upstash Redis lié. En local, la prise de notes fonctionne entièrement hors ligne.

## Workflow Git

| Branche | Rôle |
|---------|------|
| **feature / fix** | Travail du jour (`cursor/…`, etc.) |
| **`develop`** | Intégration — cible des PR de fonctionnalités et correctifs |
| **`main`** | Production — versions prêtes à publier |
| **tag `vX.Y.Z`** | Release Android (CI) ; toujours sur `main` |

### Contribuer

1. Créer une branche depuis `develop`.
2. Ouvrir une **PR vers `develop`** (pas vers `main`).
3. Merger après revue et CI verte (`npm test`, e2e Playwright).

### Publier une version

1. Valider l’API sur le déploiement Vercel de `develop` (preview / staging).
2. Ouvrir une PR **`develop` → `main`**.
3. Dans cette PR : incrémenter `versionCode` / `versionName` (`android/app/build.gradle`) et `version` (`package.json`) — format semver **x.y.z** (voir `.cursor/rules/release-deploy.mdc`).
4. Merger dans `main`, puis taguer sur `main` :

```bash
git checkout main
git pull
git tag v3.8.1
git push origin v3.8.1
```

Le workflow `.github/workflows/android-release.yml` build l’APK signé et crée la GitHub Release.

> Ne pas taguer depuis `develop` ni pousser des features directement sur `main`.

## Déploiement sur Vercel

| Branche Vercel | Usage |
|----------------|-------|
| **`main`** | Production (URL publique de l’API) |
| **`develop`** | Staging — valider sync, agent Merlin, etc. avant release |

1. **Importer le projet dans [Vercel](https://vercel.com)** (repo GitHub lié)
   - Framework Preset : **Vite**
   - Build Command : `npm run build`
   - Output Directory : `dist`
   - Branche de production : **`main`**

2. **Créer un store Redis (Upstash)**
   - Dashboard Vercel → votre projet → **Storage** / **Marketplace**
   - Ajouter une intégration **Upstash Redis** (successeur de Vercel KV)
   - Les variables `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` sont injectées automatiquement

3. **Redéployer** après liaison du store Redis

4. **Installer la PWA** sur mobile/desktop via « Ajouter à l'écran d'accueil »

## Synchronisation multi-appareils

1. Ouvrir les **Réglages** (icône en haut à droite)
2. Entrer la **même phrase secrète** sur chaque appareil
3. La sync se fait automatiquement (au lancement, toutes les 60 s, à la fermeture)

Les notes sont chiffrées côté client avant envoi. Le serveur ne voit que du contenu chiffré.

## Stack

- Vite + TypeScript (vanilla)
- IndexedDB (`idb`)
- vite-plugin-pwa
- Capacitor (app Android native)
- Vercel Serverless + Upstash Redis

## LLM (Megaserveur ou OpenRouter)

Le chat Merlin et l’agent passent par `/api/ai` (Vercel). Si **Megaserveur** est configuré, les requêtes vont vers votre stack Ollama (`/api/ai/chat/completions` sur le megaserveur). Sinon, fallback **OpenRouter**.

Variables Vercel (ou `.env.local` en dev) :

| Variable | Rôle |
|----------|------|
| `MEGASERVEUR_AI_BASE_URL` | Ex. `https://api.megaboost-studio.fr/api/ai` |
| `MEGASERVEUR_AI_API_KEY` | Même valeur que `AI_SERVICES_API_KEY` sur le megaserveur |
| `MEGASERVEUR_DEFAULT_MODEL` | Optionnel — défaut `tinyllama` |
| `OPENROUTER_API_KEY` | Fallback si Megaserveur non configuré |

Dans l’app : **Réglages → Modèle principal** = `tinyllama` (pas besoin de clé OpenRouter si Megaserveur est côté serveur).

Voir `.env.example`.

## App Android native (Obtainium)

L'app peut être installée comme APK native via [Obtainium](https://github.com/ImranR98/Obtainium), avec mises à jour automatiques depuis les GitHub Releases.

### Prérequis GitHub

Configurer dans le dépôt (**Settings → Secrets and variables → Actions**) :

| Nom | Type | Description |
|-----|------|-------------|
| `ANDROID_KEYSTORE_BASE64` | Secret | Keystore encodé en base64 |
| `ANDROID_KEYSTORE_PASSWORD` | Secret | Mot de passe du keystore |
| `ANDROID_KEY_ALIAS` | Secret | Alias de la clé (ex. `daily-note`) |
| `ANDROID_KEY_PASSWORD` | Secret | Mot de passe de la clé (souvent identique au keystore) |
| `VERCEL_URL` | Variable | URL Vercel (ex. `https://votre-app.vercel.app`) |
| `VITE_GITHUB_TOKEN` | Secret (optionnel) | Token GitHub lecture seule — augmente le quota API (60 → 5000 req/h) pour la MAJ in-app |

#### Token GitHub pour la MAJ in-app (optionnel)

La vérification des mises à jour dans l'app appelle l'API GitHub (`/releases/latest`). Sans token, la limite est de **60 requêtes/heure par IP** ; avec un token, **5000/heure**.

1. Ouvrir [GitHub → Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. **Fine-grained token** (recommandé) ou **classic token**
3. Accès **lecture seule** au dépôt `daily-notes` (Contents + Metadata)
4. Copier le token dans le secret GitHub Actions **`VITE_GITHUB_TOKEN`** (Settings → Secrets and variables → Actions)
5. Pour un build local Capacitor, ajouter dans `.env.production` :

```bash
VITE_GITHUB_TOKEN=ghp_xxxxxxxx
```

> Le téléchargement de `app-version.json` utilise le code natif Android (pas la WebView) et ne consomme pas ce quota API.

Générer le keystore (une seule fois, à conserver précieusement) :

```bash
keytool -genkey -v -keystore release.keystore -alias daily-note \
  -keyalg RSA -keysize 2048 -validity 10000
```

Encoder en base64 pour le secret GitHub :

```bash
# Linux / macOS
base64 -w 0 release.keystore

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore"))
```

Vérifier localement que l'alias et le mot de passe sont corrects :

```powershell
& "C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot\bin\keytool.exe" -list -keystore release.keystore -alias daily-note
```

> **Erreur CI « keystore password was incorrect »** : les secrets `ANDROID_KEYSTORE_PASSWORD` et `ANDROID_KEY_ALIAS` sont manquants ou incorrects. Vérifiez qu'ils correspondent exactement à ceux saisis lors de `keytool -genkey`. Si vous n'avez qu'un seul mot de passe, définissez au minimum `ANDROID_KEYSTORE_PASSWORD` (le mot de passe de la clé sera réutilisé automatiquement).

### Installer via Obtainium

1. Installer Obtainium (F-Droid ou [releases GitHub](https://github.com/ImranR98/Obtainium/releases))
2. **+** → source **GitHub**
3. URL du repo : `https://github.com/<votre-user>/daily-note`
4. Filtrer l'asset : `app-release.apk`
5. Activer la vérification des mises à jour
6. Installer

### Monitoring des crashs (Sentry)

Les erreurs Android et API Vercel peuvent remonter dans **le même projet Sentry** (même DSN).

| Source | Tag Sentry | Variable |
|--------|------------|----------|
| App Android | `component: android` | `VITE_SENTRY_DSN` (build APK) |
| API Vercel | `component: api` | `SENTRY_DSN` (env Vercel) |

1. Créer un projet Sentry (plateforme **Capacitor** ou **Node.js**)
2. Copier le DSN
3. **Android (CI)** : secret GitHub `VITE_SENTRY_DSN`
4. **Vercel** : variable d'environnement `SENTRY_DSN` (même valeur que le DSN)
5. En local Capacitor, `.env.production` :

```bash
VITE_SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
```

Sans DSN, Sentry reste désactivé — l'app et l'API fonctionnent normalement.

### Recherche web (Merlin)

Merlin peut interroger Internet via deux outils serveur :

- `web_search` — résultats Brave Search, avec **fallback Tavily** puis scraper personnalisé
- `fetch_page` — lecture textuelle d'une page publique

**Cache court** (15 min recherche, 20 min page) via Redis Upstash si disponible, sinon mémoire serveur.

Configurer **au moins une** des options suivantes :

| Variable / réglage | Rôle |
|--------------------|------|
| `BRAVE_SEARCH_API_KEY` | Fournisseur principal ([Brave](https://brave.com/search/api/), 2000 req/mois) |
| `TAVILY_API_KEY` | Fallback ([Tavily](https://tavily.com/), 1000 crédits/mois) |
| `WEB_SEARCH_SCRAPER_URL` | Votre scraper (POST JSON `{ query, max_results }` → `{ results: [{ title, url, snippet }] }`) |
| Réglages Merlin | Clés Brave / Tavily optionnelles côté client (sync chiffrée) |

Les **sources** sont citées automatiquement en fin de réponse Merlin.

Les **routines personnalisées** (`save_custom_tool`) supportent :

- **Paramètres** : `params_json` avec `name`, `description`, `required`, `default`
- **Variables** dans les args : `{{ville}}`, `{{ville|Paris}}`, `{{today}}`, `{{prev.url}}`, `{{steps.0.content}}`
- **Conditions** par étape : `when` / `unless` (JSON : `exists`, `empty`, `eq`, `contains`, `and`, `or`, `not`)
- **Invocation** : `/routine meteo ville=Lyon` ou `routine meteo Lyon`

> La recherche s'exécute côté serveur (clés jamais exposées dans l'APK). Sans aucune clé ni scraper, Merlin indique que la recherche web est indisponible.

Pour tester l'API après déploiement : provoquer une erreur 500 (ex. Redis non configuré) ou ajouter temporairement `throw new Error('Sentry test API')` dans une route — l'issue doit apparaître avec `runtime: vercel-node`.

Pour des stack traces lisibles en production, uploader les source maps :

```bash
npx @sentry/wizard@latest -i sourcemaps
```

### Build local (développement)

```bash
npm run cap:sync          # build web + sync vers android/
npx cap open android      # ouvre Android Studio
```

Pour un build Capacitor local, définir l'URL API :

```bash
# .env.production
VITE_API_BASE_URL=https://votre-app.vercel.app
```

