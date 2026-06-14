export const STOP_PHRASES = [
  'merlin termine',
  'merlin stop',
  "merlin c'est tout",
  'merlin c est tout',
];

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[,.!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesWake(text: string): boolean {
  const norm = normalize(text);
  if (norm.includes('merlin journal')) return true;
  if (norm.includes('merlin le journal')) return true;
  if (norm.includes('merlin du journal')) return true;

  const merlinIdx = norm.indexOf('merlin');
  const journalIdx = norm.indexOf('journal');
  if (merlinIdx >= 0 && journalIdx > merlinIdx && journalIdx - merlinIdx < 25) {
    return true;
  }
  return false;
}

export function matchesPhrase(text: string, phrases: string[]): boolean {
  const norm = normalize(text);
  return phrases.some((p) => norm.includes(normalize(p)));
}

export function stripCommands(text: string): string {
  let result = text;
  const allPhrases = ['merlin journal', 'merlin le journal', ...STOP_PHRASES];
  for (const phrase of allPhrases) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(re, '');
  }
  return result.trim();
}

export function collapseStutter(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    const prev = out[out.length - 1];
    if (!prev || normalize(prev) !== normalize(word)) {
      out.push(word);
    }
  }
  return out.join(' ');
}

export function extractTranscriptDelta(existing: string, incoming: string): string {
  const prev = existing.trim();
  const cur = incoming.trim();
  if (!cur) return '';
  if (!prev) return collapseStutter(cur);

  const prevNorm = normalize(prev);
  const curNorm = normalize(cur);

  if (curNorm === prevNorm) return '';
  if (prevNorm.includes(curNorm)) return '';

  const prevWords = prevNorm.split(/\s+/).filter(Boolean);
  const curWords = curNorm.split(/\s+/).filter(Boolean);
  const origCurWords = cur.split(/\s+/).filter(Boolean);

  let shared = 0;
  while (shared < prevWords.length && shared < curWords.length) {
    if (prevWords[shared] !== curWords[shared]) break;
    shared++;
  }

  if (curWords.length > shared) {
    return collapseStutter(origCurWords.slice(shared).join(' '));
  }

  if (wordsAreSubsequence(curWords, prevWords)) return '';

  return '';
}

function wordsAreSubsequence(needle: string[], haystack: string[]): boolean {
  if (needle.length === 0) return true;
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++;
  }
  return j === needle.length;
}
