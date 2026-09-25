/**
 * Same-length code masking for the layered-voice text passes.
 *
 * Every pass here (ref links, the id net, the sentence fold) has to skip code,
 * and two of them also have to CUT or REWRITE the original text at the
 * positions they find. Masking code with spaces of the same length (newlines
 * kept) lets a pass scan the masked copy and apply what it found to the
 * original at identical offsets.
 *
 * Mirrors `scripts/test/lib/reply-shape.mjs` (WP4): a fenced block is
 * ```…``` (lazy, may span lines); an inline span is `…` on one line.
 */

const FENCED_RE = /```[\s\S]*?```/g;
const INLINE_RE = /`[^`\n]*`/g;

function blank(match: string): string {
  return match.replace(/[^\n]/g, ' ');
}

/** Mask fenced code blocks only. */
export function maskFenced(text: string): string {
  return text.replace(FENCED_RE, blank);
}

/** Mask fenced blocks, then inline code spans. */
export function maskCode(text: string): string {
  return maskFenced(text).replace(INLINE_RE, blank);
}

/** `[start, end)` ranges of every inline code span outside fenced blocks. */
export function inlineCodeRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of maskFenced(text).matchAll(INLINE_RE)) {
    const start = m.index ?? 0;
    out.push([start, start + m[0].length]);
  }
  return out;
}

/** `[start, end)` ranges of every fenced block. */
export function fencedRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(FENCED_RE)) {
    const start = m.index ?? 0;
    out.push([start, start + m[0].length]);
  }
  return out;
}
