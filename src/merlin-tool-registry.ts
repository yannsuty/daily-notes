import { getMerlinCustomTools } from './db';
import {
  MAX_CUSTOM_ROUTINE_STEPS,
} from '../lib/merlin-agent/primitive-tools';
import {
  buildRoutineParams,
  createRoutineContext,
  formatRoutineParamsHint,
  recordRoutineStepResult,
  resolveRoutineArgs,
  shouldRunRoutineStep,
} from '../lib/merlin-agent/routine';
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

export { parseRoutineInvocation } from '../lib/merlin-agent/routine';

export async function isCustomToolName(name: string): Promise<boolean> {
  const map = await getCustomToolMap();
  return map.has(name.toLowerCase());
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

  const routineContext = createRoutineContext(buildRoutineParams(tool.params, args));
  const results: string[] = [];
  let lastMutation: ToolResult['mutation'];
  let executed = 0;

  for (const step of tool.steps) {
    if (!shouldRunRoutineStep(step, routineContext)) {
      continue;
    }

    const stepArgs = resolveRoutineArgs(step.args ?? {}, routineContext);
    const { executeMerlinTool } = await import('./merlin-tools');
    const result = await executeMerlinTool(step.tool, stepArgs);
    recordRoutineStepResult(routineContext, step.tool, result.content, result.ok);
    if (!result.ok) return result;
    results.push(`[${step.tool}]\n${result.content}`);
    executed += 1;
    if (result.mutation) lastMutation = result.mutation;
  }

  if (executed === 0) {
    return { ok: false, content: `Routine « ${name} » : aucune étape exécutée (conditions non remplies).` };
  }

  tool.usageCount += 1;
  tool.updatedAt = Date.now();
  const { saveMerlinCustomTool } = await import('./db');
  await saveMerlinCustomTool(tool);

  return {
    ok: true,
    content: results.join('\n\n'),
    mutation: lastMutation,
  };
}

export async function getCustomToolsPromptBlock(): Promise<string> {
  const tools = await getMerlinCustomTools();
  if (tools.length === 0) return '';
  const lines = tools.map((t) => {
    const params = formatRoutineParamsHint(t.params).trim();
    return `- ${t.name}${params ? params : ''} — ${t.description}`;
  });
  return `\n\nRoutines personnalisées :\n${lines.join('\n')}`;
}
