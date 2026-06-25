import { parseJsonFromAi } from '../../lib/merlin-agent/parse.js';
import { inferSpaceTitle } from '../../lib/merlin-agent/space-intent.js';
import { mergeSpaceData } from '../../lib/merlin-agent/space-merge.js';
import type { MerlinSpace, MerlinSpaceData, MerlinSpaceKind } from '../../lib/merlin-agent/types.js';
import { callMerlinLlm } from './llm.js';
import type { AgentClientConfig } from '../../lib/merlin-agent/types.js';

export interface ExtractedSpace {
  title: string;
  recap: string;
  data: MerlinSpaceData;
}

const EXTRACT_PROMPT = `Tu extrais les données structurées d'un échange Merlin pour créer un espace sauvegardé.
Réponds UNIQUEMENT en JSON valide :
{
  "title": "titre court",
  "recap": "récapitulatif de la demande utilisateur",
  "data": { ... }
}

Selon le type (kind) :
- comparison : data.columns (string[]), data.rows (string[][])
- recipe : data.servings?, data.ingredients [{text, quantity?, unit?}], data.steps [{order, text}]
- diy : data.intro, data.sections [{id, title, content}]
- plan : data.goal, data.milestones [{id, title, done}]

Utilise le contenu de la réponse assistant pour remplir data. Génère des id uniques (courts) pour sections/milestones/steps.`;

export async function extractSpaceData(
  kind: MerlinSpaceKind,
  userMessage: string,
  assistantReply: string,
  config: AgentClientConfig,
  referer?: string,
): Promise<ExtractedSpace | null> {
  const result = await callMerlinLlm(
    [
      { role: 'system', content: EXTRACT_PROMPT },
      {
        role: 'user',
        content: `kind: ${kind}

Demande utilisateur :
${userMessage}

Réponse assistant :
${assistantReply.slice(0, 6000)}`,
      },
    ],
    config,
    { temperature: 0.2, jsonMode: true, referer },
  );

  if (!result.ok || !result.text) return null;

  const parsed = parseJsonFromAi<{
    title?: string;
    recap?: string;
    data?: MerlinSpaceData;
  }>(result.text);

  if (!parsed?.data) return null;

  return {
    title: parsed.title?.trim() || inferSpaceTitle(userMessage, kind),
    recap: parsed.recap?.trim() || userMessage.trim().slice(0, 400),
    data: parsed.data,
  };
}

const UPDATE_EXTRACT_PROMPT = `Tu extrais UNIQUEMENT les nouvelles données à AJOUTER à un espace existant (pas tout l'espace).
Réponds UNIQUEMENT en JSON valide :
{
  "recap": "récapitulatif mis à jour (optionnel)",
  "data": { ... patch partiel ... }
}

Pour kind=comparison : data.rows = nouvelles lignes uniquement (produits à ajouter ou modifier), data.columns si nouvelles colonnes.
Pour recipe : data.ingredients et/ou data.steps nouveaux uniquement.
Pour diy/plan : sections ou milestones nouveaux uniquement.

N'inclus pas les lignes/produits déjà présents dans l'espace existant.`;

export async function extractSpaceUpdate(
  existing: MerlinSpace,
  userMessage: string,
  assistantReply: string,
  config: AgentClientConfig,
  referer?: string,
): Promise<ExtractedSpace | null> {
  const result = await callMerlinLlm(
    [
      { role: 'system', content: UPDATE_EXTRACT_PROMPT },
      {
        role: 'user',
        content: `kind: ${existing.kind}
Titre existant : ${existing.title}
Données existantes :
${JSON.stringify(existing.data).slice(0, 4000)}

Demande utilisateur :
${userMessage}

Réponse assistant :
${assistantReply.slice(0, 6000)}`,
      },
    ],
    config,
    { temperature: 0.2, jsonMode: true, referer },
  );

  if (!result.ok || !result.text) {
    const fallback = await extractSpaceData(existing.kind, userMessage, assistantReply, config, referer);
    if (!fallback?.data) return null;
    const merged = mergeSpaceData(existing.kind, existing.data, fallback.data, { append: true });
    if (JSON.stringify(merged) === JSON.stringify(existing.data)) return null;
    return {
      title: existing.title,
      recap: fallback.recap,
      data: fallback.data,
    };
  }

  const parsed = parseJsonFromAi<{
    recap?: string;
    data?: MerlinSpaceData;
  }>(result.text);

  if (!parsed?.data) return null;

  return {
    title: existing.title,
    recap: parsed.recap?.trim() || existing.recap,
    data: parsed.data,
  };
}
