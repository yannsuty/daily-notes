type ViewportListener = () => void;

let cleanup: (() => void) | null = null;
const listeners = new Set<ViewportListener>();

export function initVisualViewport(): void {
  if (cleanup) return;

  const vv = window.visualViewport;
  if (!vv) {
    document.documentElement.style.setProperty('--visual-viewport-height', '100dvh');
    updateShellLayoutVars();
    return;
  }

  const update = (): void => {
    const height = vv.height;
    const offsetTop = vv.offsetTop;
    const keyboardInset = Math.max(0, window.innerHeight - height - offsetTop);

    document.documentElement.style.setProperty('--visual-viewport-height', `${height}px`);
    document.documentElement.style.setProperty('--visual-viewport-offset-top', `${offsetTop}px`);
    document.documentElement.style.setProperty('--keyboard-inset', `${keyboardInset}px`);
    document.documentElement.classList.toggle('keyboard-open', keyboardInset > 48);
    updateShellLayoutVars();

    for (const fn of listeners) fn();
  };

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  window.addEventListener('orientationchange', update);
  update();

  cleanup = () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
    window.removeEventListener('orientationchange', update);
    document.documentElement.classList.remove('keyboard-open');
    cleanup = null;
  };
}

export function onViewportChange(listener: ViewportListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mesure la barre d'onglets pour éviter un décalage sous le composer Merlin. */
export function updateShellLayoutVars(): void {
  const tabsHost = document.querySelector<HTMLElement>('.app__nav');
  if (tabsHost) {
    document.documentElement.style.setProperty(
      '--tabs-height',
      `${tabsHost.getBoundingClientRect().height}px`,
    );
  }
}
