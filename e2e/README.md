# Tests e2e Playwright (Merlin web)

Les tests dans `e2e/` couvrent des **parcours utilisateur** dans le navigateur (Vite dev sur le port 5173).

## Lancer localement

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

Interface interactive :

```bash
npm run test:e2e:ui
```

## Scénarios

| Fichier | Contenu |
|---------|---------|
| `smoke.spec.ts` | Chargement, navigation onglets |
| `fast-path.spec.ts` | Listes et contexte sans API agent |
| `spaces.spec.ts` | Création, extension, conseil, changement de sujet, quitter contexte |
| `agent.spec.ts` | Trace agent, retry après erreur |

Les scénarios **Espaces** et **agent** mockent `POST /api/merlin-agent` — pas de clé OpenRouter requise en CI.

## Hors périmètre web

- Jobs agent en arrière-plan Android (natif uniquement) — tests unitaires + `MerlinAgentJobService`
- Speech / notifications Capacitor
- Sync chiffrée Vercel

Le scénario **verrouillage téléphone + reprise job** n'est pas simulable en Playwright web.
