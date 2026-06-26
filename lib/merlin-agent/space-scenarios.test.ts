import { describe, expect, it } from 'vitest';
import {
  detectSpaceKind,
  isExplicitNewSpaceIntent,
  shouldExtendActiveSpace,
  shouldUpdateActiveSpace,
} from './space-intent.js';

type Scenario = {
  label: string;
  message: string;
  activeKind: 'comparison' | 'recipe' | 'diy' | 'plan';
  expectUpdate: boolean;
  expectExtend: boolean;
  expectKind: ReturnType<typeof detectSpaceKind>;
};

const scenarios: Scenario[] = [
  {
    label: 'création — comparaison initiale',
    message: 'Compare trois ventilateurs de plafond silencieux',
    activeKind: 'comparison',
    expectUpdate: true,
    expectExtend: true,
    expectKind: 'comparison',
  },
  {
    label: 'extension — compares avec d’autres ventilateurs',
    message: 'Je veux bien que tu compares avec d’autres ventilateurs de plafond',
    activeKind: 'comparison',
    expectUpdate: true,
    expectExtend: true,
    expectKind: 'comparison',
  },
  {
    label: 'extension — ajout explicite au tableau',
    message: 'Ajoute le modèle X200 à la comparaison',
    activeKind: 'comparison',
    expectUpdate: true,
    expectExtend: true,
    expectKind: 'comparison',
  },
  {
    label: 'conseil — pas de mise à jour automatique',
    message: 'Quel modèle pour une chambre de 20 m² ?',
    activeKind: 'comparison',
    expectUpdate: false,
    expectExtend: false,
    expectKind: null,
  },
  {
    label: 'changement de sujet — recette alors qu’une comparaison est active',
    message: 'Recette de crêpes pour 4 personnes',
    activeKind: 'comparison',
    expectUpdate: false,
    expectExtend: false,
    expectKind: 'recipe',
  },
  {
    label: 'nouvel espace explicite — ignore l’actif',
    message: 'Crée une nouvelle comparaison de purificateurs',
    activeKind: 'comparison',
    expectUpdate: false,
    expectExtend: false,
    expectKind: 'comparison',
  },
  {
    label: 'suivi même kind — enrichit la recette active',
    message: 'Ajoute du sucre vanillé dans les ingrédients',
    activeKind: 'recipe',
    expectUpdate: true,
    expectExtend: true,
    expectKind: 'recipe',
  },
  {
    label: 'hors sujet — pas d’espace',
    message: 'Quel temps fait-il demain à Lyon ?',
    activeKind: 'comparison',
    expectUpdate: false,
    expectExtend: false,
    expectKind: null,
  },
  {
    label: 'extension — élargir le comparatif',
    message: 'Élargis la comparaison avec d’autres modèles silencieux',
    activeKind: 'comparison',
    expectUpdate: true,
    expectExtend: true,
    expectKind: 'comparison',
  },
  {
    label: 'images — enrichir la comparaison active',
    message: 'Cherche des images pour chaque modèle',
    activeKind: 'comparison',
    expectUpdate: true,
    expectExtend: true,
    expectKind: null,
  },
  {
    label: 'plan DIY — nouveau projet sans rupture',
    message: 'Plan pour refaire la salle de bain',
    activeKind: 'comparison',
    expectUpdate: false,
    expectExtend: false,
    expectKind: 'plan',
  },
];

describe('scénarios espaces — matrice intent', () => {
  it.each(scenarios)('$label', ({ message, activeKind, expectUpdate, expectExtend, expectKind }) => {
    expect(detectSpaceKind(message)).toBe(expectKind);
    expect(shouldUpdateActiveSpace(message, activeKind)).toBe(expectUpdate);
    expect(shouldExtendActiveSpace(message, activeKind)).toBe(expectExtend);
  });
});

describe('scénarios espaces — création vs reprise', () => {
  it('une comparaison sans espace actif est une création (kind détecté)', () => {
    const message = 'Compare des ventilateurs de plafond';
    expect(detectSpaceKind(message)).toBe('comparison');
    expect(isExplicitNewSpaceIntent(message)).toBe(false);
  });

  it('une reprise d’extension ne demande pas un nouvel espace explicite', () => {
    const message = 'Compare aussi le modèle SilentAir 300';
    expect(isExplicitNewSpaceIntent(message)).toBe(false);
    expect(shouldUpdateActiveSpace(message, 'comparison')).toBe(true);
  });

  it('un changement de kind bloque l’extension de l’espace actif', () => {
    const message = 'Recette de tarte aux pommes';
    expect(shouldExtendActiveSpace(message, 'comparison')).toBe(false);
    expect(shouldUpdateActiveSpace(message, 'comparison')).toBe(false);
  });
});
