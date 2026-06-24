import { describe, expect, it } from 'vitest';
import {
  isPrimitiveTool,
  isWebTool,
  MAX_CUSTOM_ROUTINE_STEPS,
  PRIMITIVE_TOOL_NAMES,
} from './primitive-tools.js';

describe('primitive-tools', () => {
  it('inclut les outils web dans les primitives', () => {
    expect(PRIMITIVE_TOOL_NAMES).toContain('web_search');
    expect(PRIMITIVE_TOOL_NAMES).toContain('fetch_page');
    expect(isWebTool('web_search')).toBe(true);
    expect(isPrimitiveTool('web_search')).toBe(true);
    expect(isPrimitiveTool('save_custom_tool')).toBe(false);
  });

  it('limite les routines à 5 étapes', () => {
    expect(MAX_CUSTOM_ROUTINE_STEPS).toBe(5);
  });
});
