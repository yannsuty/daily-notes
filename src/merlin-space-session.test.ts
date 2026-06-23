import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getActiveSpaceId,
  onActiveSpaceChange,
  setActiveSpaceId,
} from './merlin-space-session';

describe('merlin-space-session', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persiste et lit l’id d’espace actif', () => {
    expect(getActiveSpaceId()).toBeNull();
    setActiveSpaceId('space-42');
    expect(getActiveSpaceId()).toBe('space-42');
  });

  it('efface le contexte actif', () => {
    setActiveSpaceId('space-42');
    setActiveSpaceId(null);
    expect(getActiveSpaceId()).toBeNull();
  });

  it('notifie les abonnés au changement', () => {
    const listener = vi.fn();
    const unsubscribe = onActiveSpaceChange(listener);

    setActiveSpaceId('a');
    setActiveSpaceId('b');
    setActiveSpaceId(null);

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenLastCalledWith(null);

    unsubscribe();
    setActiveSpaceId('c');
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
