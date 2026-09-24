/**
 * The safety-net fold: assistant prose longer than the reply register's cap
 * folds after N sentences behind "Read the rest".
 *
 * Sentence counting mirrors `countSentences` in
 * `scripts/test/lib/reply-shape.mjs` (WP4) exactly, so the fold trips on the
 * same replies the bench and the live stats call "too long": code is ignored,
 * prose lines split on `.`/`!`/`?` followed by whitespace or end of line, a
 * line with no terminator counts once, and a markdown list of at most three
 * consecutive items counts as ONE sentence (a longer list counts per item).
 */

import { maskCode } from './codeMask';

/** The base register (`LAYER_ONE_BASE_SENTENCES`) when no `default` row exists. */
export const BASE_REPLY_SENTENCES = 3;

const LIST_RE = /^\s*(?:[-*]\s+|\d+\.\s+)/;
const END_RE = /[.!?](?=\s|$)/g;

interface Line {
  start: number;
  end: number;
  masked: string;
}

function linesOf(text: string): Line[] {
  const masked = maskCode(text);
  const out: Line[] = [];
  let start = 0;
  for (const piece of masked.split('\n')) {
    out.push({ start, end: start + piece.length, masked: piece });
    start += piece.length + 1;
  }
  return out;
}

function lineSentences(masked: string): number {
  const ends = masked.match(END_RE);
  return ends ? ends.length : masked.trim() ? 1 : 0;
}

/** Sentence count of a reply's display text. */
export function countSentences(text: string): number {
  if (!maskCode(text).trim()) return 0;
  const lines = linesOf(text);
  let n = 0;
  let i = 0;
  while (i < lines.length) {
    if (LIST_RE.test(lines[i]!.masked)) {
      let items = 0;
      while (i < lines.length && LIST_RE.test(lines[i]!.masked)) {
        items++;
        i++;
      }
      n += items <= 3 ? 1 : items;
      continue;
    }
    n += lineSentences(lines[i]!.masked);
    i++;
  }
  return n;
}

/**
 * Split a reply after its `cap`-th sentence. Returns null when the reply is
 * within the cap (or the remainder would be empty): nothing to fold.
 */
export function foldAfterSentences(text: string, cap: number): { head: string; rest: string } | null {
  if (cap < 1 || countSentences(text) <= cap) return null;
  const lines = linesOf(text);
  let used = 0;
  let cut = -1;
  let i = 0;
  while (i < lines.length && cut < 0) {
    const line = lines[i]!;
    if (LIST_RE.test(line.masked)) {
      let j = i;
      while (j < lines.length && LIST_RE.test(lines[j]!.masked)) j++;
      const items = j - i;
      if (items <= 3) {
        used += 1;
        if (used >= cap) cut = lines[j - 1]!.end;
      } else if (used + items >= cap) {
        cut = lines[i + (cap - used) - 1]!.end;
      } else {
        used += items;
      }
      i = j;
      continue;
    }
    const s = lineSentences(line.masked);
    if (used + s < cap) {
      used += s;
    } else if (used + s === cap) {
      cut = line.end;
    } else {
      const ends = [...line.masked.matchAll(END_RE)];
      const nth = ends[cap - used - 1];
      cut = nth ? line.start + (nth.index ?? 0) + 1 : line.end;
    }
    i++;
  }
  if (cut < 0) return null;
  const head = text.slice(0, cut).trimEnd();
  const rest = text.slice(cut).trim();
  if (!head || !rest) return null;
  return { head, rest };
}
