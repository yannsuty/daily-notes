import { saveMerlinCustomTool } from './db';
import { invalidateCustomToolCache } from './merlin-tool-registry';
import { createEntityId, type ToolResult } from './merlin-tools';
import {
  formatRoutineParamsHint,
  parseRoutineParams,
  parseRoutineSteps,
} from '../lib/merlin-agent/routine';
import type { MerlinCustomTool } from './types';

export async function saveCustomToolFromArgs(
  args: Record<string, string>,
): Promise<ToolResult> {
  const name = args.name?.trim().toLowerCase().replace(/\s+/g, '_');
  const description = args.description?.trim() ?? '';
  const stepsRaw = args.steps_json ?? args.steps ?? '[]';
  const paramsRaw = args.params_json ?? args.params ?? '';

  if (!name) return { ok: false, content: 'Nom de routine requis.' };

  const parsedSteps = parseRoutineSteps(stepsRaw);
  if (!parsedSteps.ok) return { ok: false, content: parsedSteps.error };

  const parsedParams = parseRoutineParams(paramsRaw);
  if (!Array.isArray(parsedParams)) {
    return { ok: false, content: parsedParams.error };
  }

  const steps = parsedSteps.steps;

  const now = Date.now();
  const tool: MerlinCustomTool = {
    id: createEntityId(),
    name,
    description: description || name,
    steps,
    params: parsedParams.length > 0 ? parsedParams : undefined,
    source: 'user',
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await saveMerlinCustomTool(tool);
  invalidateCustomToolCache();

  return {
    ok: true,
    content: `Routine « ${name} » sauvegardée (${steps.length} étape(s)${formatRoutineParamsHint(parsedParams)}).`,
    mutation: 'list_updated',
  };
}

export async function tryExtractCustomTool(
  toolName: string,
  args: Record<string, string>,
): Promise<void> {
  const { getMerlinCustomTools, saveMerlinCustomTool: save } = await import('./db');
  const tools = await getMerlinCustomTools();
  const existing = tools.find((t) => t.name === toolName);
  if (existing) {
    existing.usageCount += 1;
    existing.updatedAt = Date.now();
    await save(existing);
    return;
  }

  if (tools.filter((t) => t.source === 'auto').length >= 10) return;

  const now = Date.now();
  const tool: MerlinCustomTool = {
    id: createEntityId(),
    name: toolName,
    description: `Routine auto : ${toolName}`,
    steps: [{ tool: toolName, args }],
    source: 'auto',
    usageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  await save(tool);
  invalidateCustomToolCache();
}
