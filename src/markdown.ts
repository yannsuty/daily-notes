import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

const MARKDOWN_ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'code',
  'pre',
  'blockquote',
  'hr',
];

export function renderMarkdownToHtml(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '';

  const raw = marked.parse(trimmed, { async: false });
  return DOMPurify.sanitize(raw, { ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS });
}

/** Retire la syntaxe markdown pour la synthèse vocale. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .trim();
}
