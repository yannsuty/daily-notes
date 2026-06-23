import { parseJsonFromAi } from '../../lib/merlin-agent/parse.js';
import { inferSpaceTitle } from '../../lib/merlin-agent/space-intent.js';
import type { MerlinSpaceData, MerlinSpaceKind } from '../../lib/merlin-agent/types.js';
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
