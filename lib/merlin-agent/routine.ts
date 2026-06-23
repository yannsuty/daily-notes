import { addDays, todayKey } from './dates.js';
import { isPrimitiveTool, MAX_CUSTOM_ROUTINE_STEPS } from './primitive-tools.js';
import type { MerlinCustomToolParam, MerlinToolStep, RoutineCondition } from './types.js';

export interface RoutineStepResult {
  tool: string;
  content: string;
  ok: boolean;
  url?: string;
}

export interface RoutineExecutionContext {
  params: Record<string, string>;
  steps: RoutineStepResult[];
  today: string;
}

export type { RoutineCondition };

export interface ParsedRoutineStep extends MerlinToolStep {
  when?: RoutineCondition;
  unless?: RoutineCondition;
}

export interface ParseRoutineStepsResult {
  ok: true;
  steps: ParsedRoutineStep[];
}

export interface ParseRoutineStepsError {
  ok: false;
  error: string;
}

const TEMPLATE_PATTERN = /\{\{([^}]+)\}\}/g;

export function extractFirstUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)\]>]+/i);
  return match?.[0]?.replace(/[.,;:!?)]+$/, '');
}

export function resolveRoutineTemplate(
  template: string,
  context: RoutineExecutionContext,
): string {
  return template.replace(TEMPLATE_PATTERN, (_, rawExpr: string) => {
    const expr = rawExpr.trim();
    const [head, defaultValue] = expr.split('|').map((part: string) => part.trim());
    const value = resolveRoutineExpression(head, context);
    if (value) return value;
    return defaultValue ?? '';
  });
}

function resolveRoutineExpression(expr: string, context: RoutineExecutionContext): string {
  if (expr === 'today') return context.today;
  if (expr === 'yesterday') return addDays(context.today, -1);
  if (expr === 'now') return new Date().toISOString();
  if (expr === 'prev' || expr === 'prev.content') {
    const last = context.steps.at(-1);
    return last?.content ?? '';
  }
  if (expr === 'prev.url') {
    const last = context.steps.at(-1);
    return last?.url ?? extractFirstUrl(last?.content ?? '') ?? '';
  }

  const stepMatch = expr.match(/^steps\.(\d+)\.(content|url)$/);
  if (stepMatch) {
    const index = Number.parseInt(stepMatch[1], 10);
    const step = context.steps[index];
    if (!step) return '';
    if (stepMatch[2] === 'url') {
      return step.url ?? extractFirstUrl(step.content) ?? '';
    }
    return step.content;
  }

  if (context.params[expr] !== undefined) {
    return context.params[expr];
  }

  return '';
}

export function resolveRoutineArgs(
  template: Record<string, string>,
  context: RoutineExecutionContext,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(template)) {
    resolved[key] = resolveRoutineTemplate(value, context);
  }
  return resolved;
}

function resolveConditionValue(value: string, context: RoutineExecutionContext): string {
  if (value.includes('{{')) {
    return resolveRoutineTemplate(value, context);
  }
  if (context.params[value] !== undefined) {
    return context.params[value];
  }
  return value;
}

export function evaluateRoutineCondition(
  condition: RoutineCondition,
  context: RoutineExecutionContext,
): boolean {
  if ('empty' in condition) {
    return !resolveConditionValue(condition.empty, context).trim();
  }
  if ('exists' in condition) {
    return !!resolveConditionValue(condition.exists, context).trim();
  }
  if ('eq' in condition) {
    const [left, right] = condition.eq;
    return resolveConditionValue(left, context) === resolveConditionValue(right, context);
  }
  if ('neq' in condition) {
    const [left, right] = condition.neq;
    return resolveConditionValue(left, context) !== resolveConditionValue(right, context);
  }
  if ('contains' in condition) {
    const [haystack, needle] = condition.contains;
    return resolveConditionValue(haystack, context)
      .toLowerCase()
      .includes(resolveConditionValue(needle, context).toLowerCase());
  }
  if ('and' in condition) {
    return condition.and.every((child) => evaluateRoutineCondition(child, context));
  }
  if ('or' in condition) {
    return condition.or.some((child) => evaluateRoutineCondition(child, context));
  }
  if ('not' in condition) {
    return !evaluateRoutineCondition(condition.not, context);
  }
  return false;
}

export function shouldRunRoutineStep(
  step: ParsedRoutineStep,
  context: RoutineExecutionContext,
): boolean {
  if (step.when && !evaluateRoutineCondition(step.when, context)) {
    return false;
  }
  if (step.unless && evaluateRoutineCondition(step.unless, context)) {
    return false;
  }
  return true;
}

function isRoutineCondition(value: unknown): value is RoutineCondition {
  if (!value || typeof value !== 'object') return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  const key = keys[0];
  const payload = (value as Record<string, unknown>)[key];

  if (key === 'empty' || key === 'exists') return typeof payload === 'string';
  if (key === 'eq' || key === 'neq' || key === 'contains') {
    return Array.isArray(payload) && payload.length === 2 && payload.every((v) => typeof v === 'string');
  }
  if (key === 'and' || key === 'or') {
    return Array.isArray(payload) && payload.every((child) => isRoutineCondition(child));
  }
  if (key === 'not') return isRoutineCondition(payload);
  return false;
}

export function parseRoutineSteps(
  stepsRaw: string,
): ParseRoutineStepsResult | ParseRoutineStepsError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stepsRaw);
  } catch {
    return { ok: false, error: 'steps_json invalide.' };
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_CUSTOM_ROUTINE_STEPS) {
    return { ok: false, error: 'Routine vide ou trop longue.' };
  }

  const steps: ParsedRoutineStep[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Étape de routine invalide.' };
    }
    const step = entry as ParsedRoutineStep;
    if (!step.tool || typeof step.tool !== 'string') {
      return { ok: false, error: 'Chaque étape doit avoir un champ tool.' };
    }
    if (!isPrimitiveTool(step.tool) || step.tool === 'save_custom_tool') {
      return { ok: false, error: `Étape interdite : ${step.tool}` };
    }
    if (step.when && !isRoutineCondition(step.when)) {
      return { ok: false, error: `Condition when invalide pour ${step.tool}.` };
    }
    if (step.unless && !isRoutineCondition(step.unless)) {
      return { ok: false, error: `Condition unless invalide pour ${step.tool}.` };
    }
    steps.push({
      tool: step.tool,
      args: step.args ?? {},
      when: step.when,
      unless: step.unless,
    });
  }

  return { ok: true, steps };
}

export function parseRoutineParams(
  paramsRaw: string | undefined,
): MerlinCustomToolParam[] | ParseRoutineStepsError {
  if (!paramsRaw?.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(paramsRaw);
  } catch {
    return { ok: false, error: 'params_json invalide.' };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'params_json doit être un tableau.' };
  }

  const params: MerlinCustomToolParam[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Paramètre de routine invalide.' };
    }
    const param = entry as MerlinCustomToolParam;
    const name = param.name?.trim();
    if (!name || !/^\w+$/.test(name)) {
      return { ok: false, error: 'Nom de paramètre invalide (lettres, chiffres, _).' };
    }
    params.push({
      name,
      description: param.description?.trim() || name,
      required: param.required === true,
      default: param.default?.trim() || undefined,
    });
  }

  return params;
}

export function buildRoutineParams(
  paramDefs: MerlinCustomToolParam[] | undefined,
  invocationArgs: Record<string, string>,
): Record<string, string> {
  const params: Record<string, string> = { ...invocationArgs };

  for (const def of paramDefs ?? []) {
    if (params[def.name]?.trim()) continue;
    if (def.default) {
      params[def.name] = def.default;
      continue;
    }
    if (def.required) {
      params[def.name] = '';
    }
  }

  // Compatibilité : item → premier paramètre déclaré
  if (params.item?.trim() && paramDefs?.[0] && !params[paramDefs[0].name]?.trim()) {
    params[paramDefs[0].name] = params.item.trim();
  }

  return params;
}

export function parseRoutineInvocation(
  paramStr: string | undefined,
  paramDefs: MerlinCustomToolParam[] | undefined,
): Record<string, string> {
  const trimmed = paramStr?.trim();
  if (!trimmed) return {};

  if (trimmed.includes('=')) {
    const args: Record<string, string> = {};
    const pattern = /(\w+)=("([^"]*)"|'([^']*)'|[^\s]+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(trimmed)) !== null) {
      args[match[1]] = (match[3] ?? match[4] ?? match[2] ?? '').trim();
    }
    return buildRoutineParams(paramDefs, args);
  }

  const parts = trimmed.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
  const args: Record<string, string> = {};

  if (paramDefs?.length) {
    for (let i = 0; i < paramDefs.length; i += 1) {
      if (parts[i]) args[paramDefs[i].name] = parts[i];
    }
    if (parts.length > paramDefs.length) {
      args.item = parts.slice(paramDefs.length).join(' ');
    }
    return buildRoutineParams(paramDefs, args);
  }

  if (parts.length === 1) {
    return { item: parts[0] };
  }

  return { item: parts.join(' ') };
}

export function createRoutineContext(
  params: Record<string, string>,
  today = todayKey(),
): RoutineExecutionContext {
  return { params, steps: [], today };
}

export function recordRoutineStepResult(
  context: RoutineExecutionContext,
  tool: string,
  content: string,
  ok: boolean,
): RoutineStepResult {
  const result: RoutineStepResult = {
    tool,
    content,
    ok,
    url: extractFirstUrl(content),
  };
  context.steps.push(result);
  return result;
}

export function formatRoutineParamsHint(params: MerlinCustomToolParam[] | undefined): string {
  if (!params?.length) return '';
  const parts = params.map((param) => {
    const suffix = param.required ? '' : '?';
    return `${param.name}${suffix}`;
  });
  return ` (${parts.join(', ')})`;
}

export const ROUTINE_CONDITION_DOCS = `Conditions (optionnel, par étape) :
- when / unless : objet JSON, ex. {"exists":"ville"}, {"empty":"{{prev.url}}"}, {"eq":["{{ville}}","Paris"]},
  {"contains":["{{prev.content}}","pluie"]}, {"and":[...]}, {"or":[...]}, {"not":{...}}

Variables dans args :
- {{param}} ou {{param|défaut}} — paramètres de la routine
- {{today}}, {{yesterday}}, {{now}}
- {{prev}}, {{prev.content}}, {{prev.url}}
- {{steps.0.content}}, {{steps.0.url}} — résultat d'une étape précédente`;
