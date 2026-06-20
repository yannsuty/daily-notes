#!/usr/bin/env node
/**
 * Télécharge le modèle Porcupine FR (requis pour le wake word « Merlin »).
 * Le fichier .ppn personnalisé doit être généré sur https://console.picovoice.ai/
 * puis placé dans android/app/src/main/assets/wakeword/merlin_fr.ppn
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '../android/app/src/main/assets/wakeword');
const modelUrl =
  'https://raw.githubusercontent.com/Picovoice/porcupine/master/lib/common/porcupine_params_fr.pv';
const modelPath = path.join(assetsDir, 'porcupine_params_fr.pv');
const keywordPath = path.join(assetsDir, 'merlin_fr.ppn');

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(assetsDir, { recursive: true });

  if (!(await exists(modelPath))) {
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Échec téléchargement modèle FR: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(modelPath, buffer);
    console.log('Modèle Porcupine FR téléchargé.');
  } else {
    console.log('Modèle Porcupine FR déjà présent.');
  }

  if (!(await exists(keywordPath))) {
    console.warn(
      'Attention: merlin_fr.ppn manquant. Générez-le sur https://console.picovoice.ai/ ' +
        '(wake word « Merlin », langue Français, plateforme Android) puis placez-le dans:',
    );
    console.warn(`  ${keywordPath}`);
    console.warn("L'écoute arrière-plan utilisera le mode STT classique en attendant.");
  } else {
    console.log('Wake word merlin_fr.ppn présent.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
