import { describe, expect, it } from 'vitest';
import {
  detectSpaceKind,
  detectSpaceUpdateIntent,
  inferSpaceTitle,
  isComparisonImageOverrideRequest,
  isComparisonRepairRequest,
  isExplicitNewSpaceIntent,
  isInformationalSpaceQuestion,
  shouldUpdateActiveSpace,
} from './space-intent.js';

describe('isComparisonRepairRequest', () => {
  it('détecte une demande de correction de tableau', () => {
    expect(
      isComparisonRepairRequest(
        'Le tableau de comparaison est cassé, du 7 au 13 les données sont décalés',
      ),
    ).toBe(true);
    expect(isComparisonRepairRequest('Tu peux le corriger ?')).toBe(true);
    expect(isComparisonRepairRequest('Compare des ventilateurs silencieux')).toBe(false);
  });
});

describe('detectSpaceKind', () => {
  it('détecte une comparaison de ventilateurs', () => {
    expect(detectSpaceKind('Compare des ventilateurs de plafond silencieux')).toBe('comparison');
    expect(detectSpaceKind('Je veux bien que tu compares avec d\'autres ventilateurs')).toBe(
      'comparison',
    );
  });

  it('détecte une recette', () => {
    expect(detectSpaceKind('Recette de crêpes pour 4')).toBe('recipe');
  });

  it('retourne null hors sujet', () => {
    expect(detectSpaceKind('Quel temps fait-il ?')).toBeNull();
  });
});

describe('isInformationalSpaceQuestion', () => {
  it('détecte une question sans demande de tableau', () => {
    expect(isInformationalSpaceQuestion('Quel ventilateur de plafond pour 20 m² ?')).toBe(true);
    expect(isInformationalSpaceQuestion('Parle-moi des ventilateurs de plafond')).toBe(true);
    expect(isInformationalSpaceQuestion('Compare des ventilateurs silencieux')).toBe(false);
  });
});

describe('inferSpaceTitle', () => {
  it('préfixe les titres courts', () => {
    expect(inferSpaceTitle('ventilateurs plafond', 'comparison')).toContain('Comparaison');
  });
});

describe('isComparisonImageOverrideRequest', () => {
  it('détecte une demande explicite de rafraîchir les images', () => {
    expect(isComparisonImageOverrideRequest('Rafraîchis les photos de chaque modèle')).toBe(true);
    expect(isComparisonImageOverrideRequest('Cherche de nouvelles images pour la comparaison')).toBe(
      true,
    );
  });

  it('ne déclenche pas sur une simple création de comparaison', () => {
    expect(isComparisonImageOverrideRequest('Compare des ventilateurs de plafond')).toBe(false);
    expect(isComparisonImageOverrideRequest('Ajoute le modèle X à la comparaison')).toBe(false);
  });
});

describe('detectSpaceUpdateIntent', () => {
  it('détecte une mise à jour de comparaison existante', () => {
    expect(detectSpaceUpdateIntent('Ajoute le modèle X à la comparaison')).toBe(true);
    expect(detectSpaceUpdateIntent('Rajoute ce ventilateur dans le tableau')).toBe(true);
    expect(detectSpaceUpdateIntent('Compare trois modèles de ventilateurs')).toBe(false);
  });
});

describe('shouldUpdateActiveSpace', () => {
  it('préfère update quand un espace actif correspond', () => {
    expect(shouldUpdateActiveSpace('Ajoute le modèle B', 'comparison')).toBe(true);
    expect(shouldUpdateActiveSpace('Crée une nouvelle comparaison', 'comparison')).toBe(false);
    expect(shouldUpdateActiveSpace('Compare aussi le modèle C', 'comparison')).toBe(true);
    expect(shouldUpdateActiveSpace('Quel modèle pour une chambre de 20 m² ?', 'comparison')).toBe(
      false,
    );
    expect(
      shouldUpdateActiveSpace(
        'Je veux bien que tu compares avec d\'autres ventilateur de plafond',
        'comparison',
      ),
    ).toBe(true);
  });

  it('ne déclenche pas la mise à jour tableau pour un override images seul', () => {
    expect(detectSpaceUpdateIntent('Rafraîchis les photos de chaque modèle')).toBe(false);
    expect(shouldUpdateActiveSpace('Rafraîchis les photos de chaque modèle', 'comparison')).toBe(
      false,
    );
  });

  it('ne confond pas comparaison initiale et mise à jour', () => {
    expect(detectSpaceKind('Ajoute le modèle X à la comparaison')).toBe('comparison');
    expect(shouldUpdateActiveSpace('Ajoute le modèle X à la comparaison', 'comparison')).toBe(true);
    expect(isExplicitNewSpaceIntent('Crée une nouvelle comparaison')).toBe(true);
  });
});
