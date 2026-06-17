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

## Déploiement sur Vercel

1. **Initialiser Git et pousser sur GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit — Daily Note PWA"
   git remote add origin <votre-repo>
   git push -u origin main
   ```

2. **Importer le projet dans [Vercel](https://vercel.com)**
   - Framework Preset : **Vite**
   - Build Command : `npm run build`
   - Output Directory : `dist`

3. **Créer un store Redis (Upstash)**
   - Dashboard Vercel → votre projet → **Storage** / **Marketplace**
   - Ajouter une intégration **Upstash Redis** (successeur de Vercel KV)
   - Les variables `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` sont injectées automatiquement

4. **Redéployer** après liaison du store Redis

5. **Installer la PWA** sur mobile/desktop via « Ajouter à l'écran d'accueil »

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

### Publier une version

```bash
# Incrémenter versionCode / versionName dans android/app/build.gradle
git tag v1.0.0
git push origin v1.0.0
```

Le workflow `.github/workflows/android-release.yml` build l'APK signé et crée la Release automatiquement.

### Installer via Obtainium

1. Installer Obtainium (F-Droid ou [releases GitHub](https://github.com/ImranR98/Obtainium/releases))
2. **+** → source **GitHub**
3. URL du repo : `https://github.com/<votre-user>/daily-note`
4. Filtrer l'asset : `app-release.apk`
5. Activer la vérification des mises à jour
6. Installer

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

