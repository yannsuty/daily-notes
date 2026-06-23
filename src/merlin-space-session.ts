const ACTIVE_SPACE_KEY = 'merlin_active_space_id';

type Listener = (spaceId: string | null) => void;
const listeners = new Set<Listener>();

export function getActiveSpaceId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_SPACE_KEY);
  } catch {
    return null;
  }
}

export function setActiveSpaceId(spaceId: string | null): void {
  try {
    if (spaceId) {
      sessionStorage.setItem(ACTIVE_SPACE_KEY, spaceId);
    } else {
      sessionStorage.removeItem(ACTIVE_SPACE_KEY);
    }
  } catch {
    // ignore
  }
  for (const listener of listeners) {
    listener(spaceId);
  }
}

export function onActiveSpaceChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
