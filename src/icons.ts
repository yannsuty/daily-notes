const SVG_NS = 'http://www.w3.org/2000/svg';

export type TabIconId = 'merlin' | 'journal' | 'gallery' | 'settings';

const TAB_ICON_PATHS: Record<TabIconId, string> = {
  merlin: `
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
    <path d="M5 19l1-3 3-1-3-1-1-3-1 3-3 1 3 1 1 3z" />
    <path d="M19 17l.75-2.25L22 14l-2.25-.75L19 11l-.75 2.25L16 14l2.25.75L19 17z" />
  `,
  journal: `
    <path d="M6 4h9a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2V6a2 2 0 0 1 2-2z" />
    <path d="M6 8h11" />
    <path d="M6 12h11" />
    <path d="M6 16h7" />
  `,
  gallery: `
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  `,
  settings: `
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m4.93 19.07 1.41-1.41" />
    <path d="m17.66 6.34 1.41-1.41" />
  `,
};

export const TAB_LABELS: Record<TabIconId, string> = {
  merlin: 'Merlin',
  journal: 'Journal',
  gallery: 'Galerie',
  settings: 'Réglages',
};

export function createTabIcon(id: TabIconId): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('tabs__icon');
  svg.innerHTML = TAB_ICON_PATHS[id].trim();
  return svg;
}

export function createThoughtsIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('gallery__card-icon-svg');
  svg.innerHTML = `
    <circle cx="12" cy="5" r="2" />
    <circle cx="5" cy="17" r="2" />
    <circle cx="19" cy="17" r="2" />
    <path d="M12 7v4" />
    <path d="M8.5 14.5 10 12" />
    <path d="M15.5 14.5 14 12" />
  `.trim();
  return svg;
}
