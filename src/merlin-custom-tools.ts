import { saveMerlinCustomTool } from './db';
import { invalidateCustomToolCache } from './merlin-tool-registry';
import { createEntityId, type ToolResult } from './merlin-tools';
import { isPrimitiveTool, MAX_CUSTOM_ROUTINE_STEPS } from '../lib/merlin-agent/primitive-tools';
import type { MerlinCustomTool, MerlinToolStep } from './types';

export async function saveCustomToolFromArgs(
  args: Record<string, string>,
): Promise<ToolResult> {
  const name = args.name?.trim().toLowerCase().replace(/\s+/g, '_');
  const description = args.description?.trim() ?? '';
  const stepsRaw = args.steps_json ?? args.steps ?? '[]';

  if (!name) return { ok: false, content: 'Nom de routine requis.' };

  let steps: MerlinToolStep[];
  try {
    steps = JSON.parse(stepsRaw) as MerlinToolStep[];
    if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_CUSTOM_ROUTINE_STEPS) {
      return { ok: false, content: 'Steps invalides.' };
    }
    for (const step of steps) {
      if (!isPrimitiveTool(step.tool) || step.tool === 'save_custom_tool') {
        return { ok: false, content: `Étape interdite : ${step.tool}` };
      }
    }
  } catch {
    return { ok: false, content: 'JSON steps invalide.' };
  }

  const now = Date.now();
  const tool: MerlinCustomTool = {
    id: createEntityId(),
    name,
    description: description || name,
    steps,
    source: 'user',
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await saveMerlinCustomTool(tool);
  invalidateCustomToolCache();

  return {
    ok: true,
    content: `Routine « ${name} » sauvegardée (${steps.length} étape(s)).`,
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
