export type ComparisonImageVariant = 'hero' | 'thumb';

export function isSafeImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderComparisonImageFigure(
  url: string | undefined,
  alt: string,
  variant: ComparisonImageVariant = 'hero',
): string {
  const isThumb = variant === 'thumb';
  const figureClass = isThumb
    ? 'espaces-page__comparison-figure espaces-page__comparison-figure--thumb'
    : 'espaces-page__comparison-figure';

  if (!url || !isSafeImageUrl(url)) {
    if (isThumb) {
      return `<span class="espaces-page__comparison-placeholder espaces-page__comparison-placeholder--thumb" aria-hidden="true"></span>`;
    }
    return `<figure class="${figureClass} espaces-page__comparison-figure--empty" aria-label="Aucune image disponible"><span class="espaces-page__comparison-placeholder">Aucune image</span></figure>`;
  }

  const imgClass = isThumb
    ? 'espaces-page__comparison-image espaces-page__comparison-image--thumb'
    : 'espaces-page__comparison-image';

  return `<figure class="${figureClass}"><img class="${imgClass}" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer" decoding="async" data-comparison-image /></figure>`;
}
