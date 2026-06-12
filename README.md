# Daily Note

PWA de notes journalières — local-first, sync chiffrée entre appareils.

## Fonctionnalités

- Ouverture instantanée sur la note du jour
- Reprise du scroll là où vous en étiez (même journée)
- Scroll vers le haut pour consulter les jours précédents
- Stockage local IndexedDB (hors ligne)
- Sync optionnelle chiffrée via phrase secrète (AES-GCM + Vercel KV)

## Développement local

```bash
npm install
npm run dev
```

L'app est disponible sur `http://localhost:5173`.

> **Note :** la route `/api/sync` ne fonctionne qu'après déploiement sur Vercel avec un store KV lié. En local, la prise de notes fonctionne entièrement hors ligne.

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
   - Les variables `KV_REST_API_URL` et `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) sont injectées automatiquement

4. **Redéployer** après liaison du KV

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
- Vercel Serverless + KV
