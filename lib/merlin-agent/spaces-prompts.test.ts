import { describe, expect, it } from 'vitest';
import type { AgentContext, MerlinSpace } from './types.js';
import { buildSystemPrompt, SPACE_GUIDANCE } from './prompts.js';

const recipeSpace: MerlinSpace = {
  id: 'recipe-1',
  kind: 'recipe',
  title: 'Tarte aux pommes',
  recap: 'Dessert classique',
  data: {
    ingredients: [{ id: 'i1', text: 'pommes' }],
    steps: [{ id: 's1', order: 1, text: 'Éplucher' }],
  },
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
};

function baseContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    days: {},
    facts: [],
    lists: [],
    reminders: [],
    customTools: [],
    spaces: [recipeSpace],
    conversationSummary: '',
    recentMessages: [],
    ...overrides,
  };
}

describe('buildSystemPrompt — espaces', () => {
  it('injecte le contexte actif et les outils espaces', () => {
    const prompt = buildSystemPrompt(
      baseContext({ activeSpace: recipeSpace }),
    );

    expect(prompt).toContain('Contexte actif');
    expect(prompt).toContain('[Recette] Tarte aux pommes');
    expect(prompt).toContain('id: recipe-1');
    expect(prompt).toContain('space_id="recipe-1"');
    expect(prompt).toContain('create_space');
    expect(prompt).toContain('inspect_github_repo');
    expect(prompt).toContain('"reply"');
    expect(prompt).toContain('app.tool');
    expect(prompt).toContain(SPACE_GUIDANCE.trim().slice(0, 30));
  });

  it('liste les espaces enregistrés sans contexte actif', () => {
    const prompt = buildSystemPrompt(baseContext());

    expect(prompt).not.toContain('Contexte actif');
    expect(prompt).toContain('Espaces enregistrés');
    expect(prompt).toContain('[recipe] Tarte aux pommes (id: recipe-1)');
  });
});
