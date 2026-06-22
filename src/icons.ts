const SVG_NS = 'http://www.w3.org/2000/svg';

export type TabIconId = 'merlin' | 'journal' | 'gallery';

const TAB_ICON_PATHS: Record<TabIconId, string> = {
  merlin: `
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
    <path d="M5 19l1-3 3-1-3-1-1-3-1 3-3 1 3 1 1 3z" />
    <path d="M19 17l.75-2.25L22 14l-2.25-.75L19 11l-.75 2.25L16 14l2.25.75L19 17z" />
  `,
  journal: `
    <path d="M2 6h2" />
    <path d="M2 10h2" />
    <path d="M2 14h2" />
    <path d="M2 18h2" />
    <path d="M6 4v16a2 2 0 0 0 2 2h12V2H8a2 2 0 0 0-2 2z" />
    <path d="M10 8h8" />
    <path d="M10 12h8" />
    <path d="M10 16h6" />
  `,
  gallery: `
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  `,
};

export const TAB_LABELS: Record<TabIconId, string> = {
  merlin: 'Merlin',
  journal: 'Journal',
  gallery: 'Galerie',
};

function createSvgIcon(className: string, paths: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add(className);
  svg.innerHTML = paths.trim();
  return svg;
}

export function createTabIcon(id: TabIconId): SVGSVGElement {
  return createSvgIcon('tabs__icon', TAB_ICON_PATHS[id]);
}

export function createThoughtsIcon(): SVGSVGElement {
  return createSvgIcon(
    'gallery__card-icon-svg',
    `
    <circle cx="12" cy="5" r="2" />
    <circle cx="5" cy="17" r="2" />
    <circle cx="19" cy="17" r="2" />
    <path d="M12 7v4" />
    <path d="M8.5 14.5 10 12" />
    <path d="M15.5 14.5 14 12" />
  `,
  );
}

export function createListesIcon(): SVGSVGElement {
  return createSvgIcon(
    'gallery__card-icon-svg',
    `
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
    <path d="M3.5 6l1 1 1.5-1.5" />
    <path d="M3.5 12l1 1 1.5-1.5" />
    <path d="M3.5 18l1 1 1.5-1.5" />
  `,
  );
}

export function createSettingsIcon(): SVGSVGElement {
  return createSvgIcon(
    'gallery__card-icon-svg',
    `
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
  );
}
