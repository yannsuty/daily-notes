/** Outils autorisés dans les routines personnalisées (save_custom_tool). */
export const PRIMITIVE_TOOL_NAMES = [
  'read_journal',
  'search_journal',
  'summarize_period',
  'create_list',
  'add_list_item',
  'toggle_list_item',
  'show_lists',
  'create_reminder',
  'list_reminders',
  'complete_reminder',
  'trigger_context',
  'delete_list',
  'web_search',
  'fetch_page',
  'create_space',
  'update_space',
  'show_space',
  'list_spaces',
  'inspect_github_repo',
] as const;

export type PrimitiveToolName = (typeof PRIMITIVE_TOOL_NAMES)[number];

export const PRIMITIVE_TOOLS = new Set<string>(PRIMITIVE_TOOL_NAMES);

export const WEB_TOOL_NAMES = new Set(['web_search', 'fetch_page']);

export const MAX_CUSTOM_ROUTINE_STEPS = 5;

export function isPrimitiveTool(name: string): boolean {
  return PRIMITIVE_TOOLS.has(name);
}

export function isWebTool(name: string): boolean {
  return WEB_TOOL_NAMES.has(name);
}
