import { describe, expect, it } from 'vitest';
import { detectSpaceKind, inferSpaceTitle } from './space-intent.js';

describe('detectSpaceKind', () => {
  it('détecte une comparaison de ventilateurs', () => {
    expect(detectSpaceKind('Compare des ventilateurs de plafond silencieux')).toBe('comparison');
  });

  it('détecte une recette', () => {
    expect(detectSpaceKind('Recette de crêpes pour 4')).toBe('recipe');
  });

  it('retourne null hors sujet', () => {
    expect(detectSpaceKind('Quel temps fait-il ?')).toBeNull();
  });
});

describe('inferSpaceTitle', () => {
  it('préfixe les titres courts', () => {
    expect(inferSpaceTitle('ventilateurs plafond', 'comparison')).toContain('Comparaison');
  });
});
