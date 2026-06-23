import { describe, expect, it } from 'vitest';
import {
  appendSourcesCitation,
  clampWebResultCount,
  formatWebSearchResults,
  htmlToPlainText,
  isPublicHttpUrl,
  mergeWebSources,
} from './web.js';

describe('isPublicHttpUrl', () => {
  it('accepte les URLs https publiques', () => {
    expect(isPublicHttpUrl('https://example.com/page')).toBe(true);
  });

  it('refuse localhost et IP privées', () => {
    expect(isPublicHttpUrl('http://localhost/test')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1/test')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.1/')).toBe(false);
    expect(isPublicHttpUrl('http://10.0.0.5/')).toBe(false);
  });

  it('refuse les schémas non http(s)', () => {
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('ftp://example.com')).toBe(false);
  });
});

describe('formatWebSearchResults', () => {
  it('formate les résultats', () => {
    const text = formatWebSearchResults('météo Paris', [
      { title: 'Météo', url: 'https://ex.com', snippet: 'Ensoleillé' },
    ]);
    expect(text).toContain('météo Paris');
    expect(text).toContain('https://ex.com');
    expect(text).toContain('Ensoleillé');
  });
});

describe('clampWebResultCount', () => {
  it('borne entre 1 et 8', () => {
    expect(clampWebResultCount('0')).toBe(1);
    expect(clampWebResultCount('99')).toBe(8);
    expect(clampWebResultCount(undefined, 5)).toBe(5);
  });
});

describe('htmlToPlainText', () => {
  it('retire les balises et scripts', () => {
    const html = '<html><head><style>body{}</style></head><body><h1>Titre</h1><p>Texte &amp; suite</p><script>alert(1)</script></body></html>';
    const text = htmlToPlainText(html);
    expect(text).toContain('Titre');
    expect(text).toContain('Texte & suite');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('<p>');
  });
});

describe('mergeWebSources', () => {
  it('déduplique par URL', () => {
    const merged = mergeWebSources(
      [{ url: 'https://a.com', kind: 'search' }],
      [
        { url: 'https://a.com', kind: 'page' },
        { url: 'https://b.com', title: 'B', kind: 'search' },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged[1]?.url).toBe('https://b.com');
  });
});

describe('appendSourcesCitation', () => {
  it('ajoute un bloc Sources', () => {
    const reply = appendSourcesCitation('Voici la réponse.', [
      { title: 'Exemple', url: 'https://ex.com', kind: 'search' },
    ]);
    expect(reply).toContain('**Sources**');
    expect(reply).toContain('[Exemple](https://ex.com)');
  });

  it('ne duplique pas si Sources déjà présent', () => {
    const reply = appendSourcesCitation('Texte\n\n**Sources**\n1. déjà là', [
      { url: 'https://ex.com', kind: 'search' },
    ]);
    expect(reply).toBe('Texte\n\n**Sources**\n1. déjà là');
  });
});
