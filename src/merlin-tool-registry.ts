import { getMerlinCustomTools } from './db';
import {
  isPrimitiveTool,
  MAX_CUSTOM_ROUTINE_STEPS,
} from '../lib/merlin-agent/primitive-tools';
import type { ToolResult } from './merlin-tools';

const MAX_CUSTOM_STEPS = MAX_CUSTOM_ROUTINE_STEPS;

let customToolsCache: Map<string, string> | null = null;
let customToolsCacheAt = 0;
const CACHE_TTL_MS = 5000;

async function getCustomToolMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (customToolsCache && now - customToolsCacheAt < CACHE_TTL_MS) {
    return customToolsCache;
  }
  const tools = await getMerlinCustomTools();
  customToolsCache = new Map(tools.map((t) => [t.name.toLowerCase(), t.id]));
  customToolsCacheAt = now;
  return customToolsCache;
}

export function invalidateCustomToolCache(): void {
  customToolsCache = null;
}

export async function isCustomToolName(name: string): Promise<boolean> {
  const map = await getCustomToolMap();
  return map.has(name.toLowerCase());
}

function resolveArgs(
  template: Record<string, string>,
  params: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(template)) {
    resolved[key] = value.replace(/\{\{(\w+)\}\}/g, (_, param) => params[param] ?? '');
  }
  return resolved;
}

export async function executeCustomTool(
  name: string,
  args: Record<string, string>,
): Promise<ToolResult> {
  const tools = await getMerlinCustomTools();
  const tool = tools.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (!tool) {
    return { ok: false, content: `Routine « ${name} » introuvable.` };
  }

  if (tool.steps.length > MAX_CUSTOM_STEPS) {
    return { ok: false, content: 'Routine trop longue.' };
  }

  const results: string[] = [];
  let lastMutation: ToolResult['mutation'];

  for (const step of tool.steps) {
    if (!isPrimitiveTool(step.tool) || step.tool === 'save_custom_tool') {
      return { ok: false, content: `Étape interdite : ${step.tool}` };
    }
    const stepArgs = resolveArgs(step.args, args);
    const { executeMerlinTool } = await import('./merlin-tools');
    const result = await executeMerlinTool(step.tool, stepArgs);
    if (!result.ok) return result;
    results.push(result.content);
    if (result.mutation) lastMutation = result.mutation;
  }

  tool.usageCount += 1;
  tool.updatedAt = Date.now();
  const { saveMerlinCustomTool } = await import('./db');
  await saveMerlinCustomTool(tool);

  return {
    ok: true,
    content: results.join('\n'),
    mutation: lastMutation,
  };
}

export async function getCustomToolsPromptBlock(): Promise<string> {
  const tools = await getMerlinCustomTools();
  if (tools.length === 0) return '';
  const lines = tools.map((t) => {
    const params = t.params?.length
      ? ` (${t.params.map((p) => p.name).join(', ')})`
      : '';
    return `- ${t.name}${params} — ${t.description}`;
  });
  return `\n\nRoutines personnalisées :\n${lines.join('\n')}`;
}
