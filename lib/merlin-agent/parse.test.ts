import { describe, expect, it } from 'vitest';
import {
  formatAgentReplyForUser,
  parseAgentTurn,
  parseToolCall,
} from './parse.js';

describe('parseAgentTurn', () => {
  it('parse le format reply + app.tool', () => {
    const turn = parseAgentTurn(
      JSON.stringify({
        reply: 'Je crée la comparaison dans Galerie → Espaces.',
        app: {
          tool: {
            name: 'create_space',
            args: { kind: 'comparison', title: 'Ventilateurs' },
          },
        },
      }),
    );
    expect(turn.reply).toBe('Je crée la comparaison dans Galerie → Espaces.');
    expect(turn.toolCall?.name).toBe('create_space');
    expect(turn.toolCall?.args?.kind).toBe('comparison');
  });

  it('parse reply seul sans outil', () => {
    const turn = parseAgentTurn(JSON.stringify({ reply: 'Voici mon conseil.' }));
    expect(turn.reply).toBe('Voici mon conseil.');
    expect(turn.toolCall).toBeNull();
  });

  it('reste compatible avec l’ancien JSON outil seul', () => {
    const legacy = JSON.stringify({
      action: 'tool',
      name: 'web_search',
      args: { query: 'test' },
    });
    const turn = parseAgentTurn(legacy);
    expect(turn.toolCall?.name).toBe('web_search');
    expect(turn.reply).toBeNull();
    expect(parseToolCall(legacy)?.name).toBe('web_search');
  });

  it('accepte le texte libre', () => {
    const turn = parseAgentTurn('Bonjour, comment puis-je aider ?');
    expect(turn.reply).toBe('Bonjour, comment puis-je aider ?');
    expect(turn.isStructured).toBe(false);
  });
});

describe('formatAgentReplyForUser', () => {
  it('extrait reply du JSON structuré', () => {
    expect(
      formatAgentReplyForUser(
        JSON.stringify({ reply: 'Texte visible', app: { tool: { name: 'show_lists' } } }),
      ),
    ).toBe('Texte visible');
  });

  it('masque l’ancien JSON outil seul', () => {
    const raw = JSON.stringify({ action: 'tool', name: 'create_space', args: {} });
    expect(formatAgentReplyForUser(raw)).toBe('Je prépare l’espace dans Galerie…');
  });
});
