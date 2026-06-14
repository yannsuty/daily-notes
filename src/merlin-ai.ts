import {
  chatCompletion,
  clearStoredAiApiKey,
  getAiConfig,
  getDefaultModel,
  getStoredAiApiKey,
  isAiConfigured,
  parseJsonFromAi,
  storeAiApiKey,
  storeAiConfig,
  type AiConfig,
  type AiProvider,
} from './ai-provider';
import type { ThoughtGraph, ThoughtLink, ThoughtNode } from './parse-thoughts';
import { addDays } from './types';

export {
  clearStoredAiApiKey,
  getAiConfig,
  getDefaultModel,
  getStoredAiApiKey,
  isAiConfigured,
  storeAiApiKey,
  storeAiConfig,
  type AiConfig,
  type AiProvider,
};

/** @deprecated use getStoredAiApiKey */
export function storeMerlinApiKey(key: string): void {
  storeAiApiKey(key);
}

/** @deprecated use getStoredAiApiKey */
export function getStoredMerlinApiKey(): string | null {
  return getStoredAiApiKey();
}

/** @deprecated use clearStoredAiApiKey */
export function clearStoredMerlinApiKey(): void {
  clearStoredAiApiKey();
}

export interface StructureResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface ThoughtsResult {
  ok: boolean;
  graph?: ThoughtGraph;
  error?: string;
}

const THOUGHTS_CACHE_PREFIX = 'daily-note-ai-thoughts:';

interface AiThoughtItem {
  label: string;
  weight?: number;
  recent?: boolean;
  related?: string[];
}

interface AiThoughtsPayload {
  concepts?: AiThoughtItem[];
  themes?: AiThoughtItem[];
  tags?: AiThoughtItem[];
}

export async function correctDictationText(
  rawText: string,
  priorContext?: string,
): Promise<StructureResult> {
  if (!rawText.trim()) {
    return { ok: false, error: 'Aucun texte à corriger.' };
  }

  const contextHint = priorContext?.trim()
    ? `\nContexte déjà dicté plus tôt dans la session :\n${priorContext.slice(-600)}`
    : '';

  return chatCompletion(
    [
      {
        role: 'system',
        content: `Tu corriges une dictée vocale en français.
Règles strictes :
- Corrige les homophones et erreurs typiques de reconnaissance vocale (ex. « sa »/« ça », « a »/« à », « et est », noms propres mal entendus)
- Ajoute la ponctuation et les majuscules appropriées
- Ne reformule pas, n'ajoute aucune information, ne résume pas
- Conserve l'ordre des idées et le ton personnel
- Réponds uniquement avec le texte corrigé, sans commentaire`,
      },
      {
        role: 'user',
        content: `${contextHint}\n\nTexte à corriger :\n${rawText}`,
      },
    ],
    { temperature: 0.2 },
  );
}

export async function structureJournalText(rawText: string): Promise<StructureResult> {
  if (!rawText.trim()) {
    return { ok: false, error: 'Aucun texte à structurer.' };
  }

  return chatCompletion(
    [
      {
        role: 'system',
        content: `Tu structures des notes de journal quotidien en français.
Règles :
- Conserve le sens et les faits du texte original
- Corrige les erreurs évidentes de dictée vocale si présentes
- Organise en sections avec ## Titre si pertinent
- Utilise des puces - pour les listes
- Ajoute des #tags pertinents (2 à 5 max)
- Utilise [[concept]] pour les idées ou projets importants
- Réponds uniquement avec le texte structuré, sans commentaire`,
      },
      {
        role: 'user',
        content: rawText,
      },
    ],
    { temperature: 0.4 },
  );
}

export async function extractThoughtsWithAI(
  days: Record<string, { content: string }>,
  today: string,
): Promise<ThoughtsResult> {
  const excerpt = prepareJournalExcerpt(days, today);
  if (!excerpt) {
    return { ok: false, error: 'Pas assez de contenu dans le journal.' };
  }

  const result = await chatCompletion(
    [
      {
        role: 'system',
        content: `Tu analyses un journal personnel en français pour en extraire les idées qui comptent vraiment.
Ignore le bruit (mots vides, formulations génériques, bigrams sans sens).
Identifie :
- concepts : projets, préoccupations, personnes, objectifs, idées concrètes (2 à 12 mots max par label)
- themes : grands fils de vie ou sujets récurrents
- tags : mots-clés courts (#style)

Pour chaque élément indique weight (1-5), recent (true si surtout dans les 7 derniers jours), related (labels d'autres éléments liés).

Réponds UNIQUEMENT en JSON valide :
{
  "concepts": [{"label": "...", "weight": 3, "recent": true, "related": ["..."]}],
  "themes": [{"label": "...", "weight": 2, "recent": false, "related": []}],
  "tags": [{"label": "...", "weight": 1, "recent": true, "related": []}]
}`,
      },
      {
        role: 'user',
        content: excerpt,
      },
    ],
    { temperature: 0.3, jsonMode: true },
  );

  if (!result.ok || !result.text) {
    return { ok: false, error: result.error ?? 'Analyse impossible.' };
  }

  const parsed = parseJsonFromAi<AiThoughtsPayload>(result.text);
  if (!parsed) {
    return { ok: false, error: 'Réponse IA illisible.' };
  }

  const graph = aiPayloadToGraph(parsed, today);
  if (graph.nodes.length === 0) {
    return { ok: false, error: 'Aucune idée extraite.' };
  }

  return { ok: true, graph };
}

export function getCachedAiThoughts(fingerprint: string): ThoughtGraph | null {
  try {
    const raw = localStorage.getItem(THOUGHTS_CACHE_PREFIX + fingerprint);
    if (!raw) return null;
    return JSON.parse(raw) as ThoughtGraph;
  } catch {
    return null;
  }
}

export function cacheAiThoughts(fingerprint: string, graph: ThoughtGraph): void {
  try {
    localStorage.setItem(THOUGHTS_CACHE_PREFIX + fingerprint, JSON.stringify(graph));
  } catch {
    // quota — ignore
  }
}

function prepareJournalExcerpt(
  days: Record<string, { content: string }>,
  today: string,
  maxDays = 21,
  maxCharsPerDay = 900,
): string {
  const cutoff = addDays(today, -maxDays);
  const dates = Object.keys(days)
    .filter((d) => d >= cutoff && d <= today && days[d].content.trim())
    .sort();

  if (dates.length === 0) return '';

  return dates
    .map((dateKey) => {
      const body = stripForExcerpt(days[dateKey].content).slice(0, maxCharsPerDay);
      return `## ${dateKey}\n${body}`;
    })
    .join('\n\n');
}

function stripForExcerpt(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/#([\p{L}\p{N}_-]+)/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function aiPayloadToGraph(payload: AiThoughtsPayload, today: string): ThoughtGraph {
  const nodes: ThoughtNode[] = [];
  const links: ThoughtLink[] = [];
  const idByLabel = new Map<string, string>();

  const addItems = (
    items: AiThoughtItem[] | undefined,
    type: ThoughtNode['type'],
    typeBoost: number,
  ): void => {
    for (const item of items ?? []) {
      const label = item.label?.trim();
      if (!label || label.length < 2) continue;

      const id = `${type}:${normalizeKey(label)}`;
      if (idByLabel.has(label.toLowerCase())) continue;
      idByLabel.set(label.toLowerCase(), id);

      const weight = Math.min(Math.max(item.weight ?? 2, 1), 5);
      nodes.push({
        id,
        label,
        type,
        count: weight,
        lastSeen: item.recent ? today : addDays(today, -14),
        recent: !!item.recent,
        score: weight * typeBoost * (item.recent ? 2.2 : 1),
      });
    }
  };

  addItems(payload.themes, 'theme', 1.8);
  addItems(payload.concepts, 'concept', 1.5);
  addItems(payload.tags, 'tag', 1.2);

  const allItems = [
    ...(payload.themes ?? []),
    ...(payload.concepts ?? []),
    ...(payload.tags ?? []),
  ];

  for (const item of allItems) {
    const sourceId = idByLabel.get(item.label?.trim().toLowerCase() ?? '');
    if (!sourceId) continue;

    for (const related of item.related ?? []) {
      const targetId = idByLabel.get(related.trim().toLowerCase());
      if (!targetId || targetId === sourceId) continue;
      const key = [sourceId, targetId].sort().join('|');
      if (links.some((l) => [l.source, l.target].sort().join('|') === key)) continue;
      links.push({ source: sourceId, target: targetId, weight: 2 });
    }
  }

  return { nodes, links };
}

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}
