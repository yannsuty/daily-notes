import { describe, expect, it } from 'vitest';
import {
  isConcreteListItem,
  shouldDeferListAddToAgent,
  tryParseAddListIntent,
} from './list-fast-path.js';

describe('isConcreteListItem', () => {
  it('accepte un article explicite', () => {
    expect(isConcreteListItem('du lait')).toBe(true);
    expect(isConcreteListItem('un casque Bluetooth')).toBe(true);
  });

  it('refuse les pronoms et références vagues', () => {
    expect(isConcreteListItem('ça')).toBe(false);
    expect(isConcreteListItem('cela')).toBe(false);
    expect(isConcreteListItem('qq chose')).toBe(false);
  });
});

describe('shouldDeferListAddToAgent', () => {
  it('reporte les consignes méta à l’agent', () => {
    expect(
      shouldDeferListAddToAgent(
        'Ajoute ça à une liste wishlist, et dorénavant si je te parle de qq chose que je veux acheter ajoute aussi stp',
      ),
    ).toBe(true);
  });

  it('laisse passer un ajout simple', () => {
    expect(shouldDeferListAddToAgent('ajoute du lait à courses')).toBe(false);
  });
});

describe('tryParseAddListIntent', () => {
  it('parse un ajout explicite', () => {
    expect(tryParseAddListIntent('ajoute du lait à courses')).toEqual({
      item: 'du lait',
      list: 'courses',
    });
  });

  it('refuse « ajoute ça à wishlist »', () => {
    expect(tryParseAddListIntent('ajoute ça à wishlist')).toBeNull();
  });

  it('refuse une phrase mixte rappel + consigne', () => {
    expect(
      tryParseAddListIntent(
        'Ajoute ça à une liste wishlist, et dorénavant si je te parle de qq chose que je veux acheter ajoute aussi stp',
      ),
    ).toBeNull();
  });

  it('normalise « à une liste wishlist »', () => {
    expect(tryParseAddListIntent('ajoute des écouteurs à une liste wishlist')).toEqual({
      item: 'des écouteurs',
      list: 'wishlist',
    });
  });
});
