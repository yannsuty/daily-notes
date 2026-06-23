import {
  deleteMerlinEnvVar,
  getMerlinEnvVar,
  getMerlinEnvVars,
  setMerlinEnvVar,
} from './db';
import { OPENROUTER_FREE_ROUTER } from '../lib/openrouter-fallback';

/** Clés d'environnement Merlin (stockées en IndexedDB, sync chiffrée). */
export const MERLIN_ENV = {
  OPENROUTER_API_KEY: 'OPENROUTER_API_KEY',
  OPENROUTER_MODEL: 'OPENROUTER_MODEL',
  OPENROUTER_MODEL_CHAIN: 'OPENROUTER_MODEL_CHAIN',
  BRAVE_SEARCH_API_KEY: 'BRAVE_SEARCH_API_KEY',
  TAVILY_API_KEY: 'TAVILY_API_KEY',
} as const;

export type MerlinEnvKey = (typeof MERLIN_ENV)[keyof typeof MERLIN_ENV];

export interface MerlinEnvFieldDef {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  hint?: string;
  multiline?: boolean;
}

/** Variables prédéfinies — extensible via variables personnalisées en Réglages. */
export const BUILTIN_MERLIN_ENV_FIELDS: MerlinEnvFieldDef[] = [
  {
    key: MERLIN_ENV.OPENROUTER_API_KEY,
    label: 'Clé API OpenRouter',
    placeholder: 'sk-or-…',
    secret: true,
    hint: 'Optionnel si le serveur en fournit une. Permet d’utiliser votre propre quota.',
  },
  {
    key: MERLIN_ENV.OPENROUTER_MODEL,
    label: 'Modèle principal',
    placeholder: OPENROUTER_FREE_ROUTER,
    hint: 'Modèle utilisé par défaut pour Merlin.',
  },
  {
    key: MERLIN_ENV.OPENROUTER_MODEL_CHAIN,
    label: 'Chaîne de fallback (virgules)',
    placeholder: 'openrouter/free,google/gemma-2-9b-it:free',
    multiline: true,
    hint: 'Ordre de secours si le modèle principal échoue.',
  },
  {
    key: MERLIN_ENV.BRAVE_SEARCH_API_KEY,
    label: 'Clé API Brave Search',
    placeholder: 'BSA…',
    secret: true,
    hint: 'Optionnel. Recherche web principale (gratuit : 2000 req/mois).',
  },
  {
    key: MERLIN_ENV.TAVILY_API_KEY,
    label: 'Clé API Tavily',
    placeholder: 'tvly-…',
    secret: true,
    hint: 'Optionnel. Fallback si Brave échoue (gratuit : 1000 crédits/mois).',
  },
];

export interface AiClientConfig {
  apiKey?: string;
  model?: string;
  modelChain?: string;
  braveSearchApiKey?: string;
  tavilyApiKey?: string;
}

export async function getMerlinEnv(key: string): Promise<string | undefined> {
  const entry = await getMerlinEnvVar(key);
  const value = entry?.value.trim();
  return value || undefined;
}

export async function setMerlinEnv(key: string, value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    await deleteMerlinEnvVar(key);
    return;
  }
  await setMerlinEnvVar(key, trimmed);
}

export async function getAllMerlinEnvMap(): Promise<Record<string, string>> {
  const vars = await getMerlinEnvVars();
  const map: Record<string, string> = {};
  for (const v of vars) {
    if (v.value.trim()) map[v.key] = v.value.trim();
  }
  return map;
}

export async function getAiClientConfig(): Promise<AiClientConfig> {
  const [apiKey, model, modelChain, braveSearchApiKey, tavilyApiKey] = await Promise.all([
    getMerlinEnv(MERLIN_ENV.OPENROUTER_API_KEY),
    getMerlinEnv(MERLIN_ENV.OPENROUTER_MODEL),
    getMerlinEnv(MERLIN_ENV.OPENROUTER_MODEL_CHAIN),
    getMerlinEnv(MERLIN_ENV.BRAVE_SEARCH_API_KEY),
    getMerlinEnv(MERLIN_ENV.TAVILY_API_KEY),
  ]);
  return { apiKey, model, modelChain, braveSearchApiKey, tavilyApiKey };
}

/** Pour futurs outils / intégrations — lecture générique d'une variable Merlin. */
export async function getToolEnv(key: string): Promise<string | undefined> {
  return getMerlinEnv(key);
}

export function isBuiltinEnvKey(key: string): boolean {
  return BUILTIN_MERLIN_ENV_FIELDS.some((f) => f.key === key);
}

export async function getCustomMerlinEnvEntries(): Promise<
  { key: string; value: string }[]
> {
  const vars = await getMerlinEnvVars();
  return vars
    .filter((v) => !isBuiltinEnvKey(v.key) && v.value.trim())
    .map((v) => ({ key: v.key, value: v.value.trim() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
