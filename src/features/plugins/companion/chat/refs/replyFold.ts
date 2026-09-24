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
/** A markdown table row (header, divider or body). */
const TABLE_RE = /^\s*\|/;
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
  cut = dropDanglingIntro(lines, keepTablesWhole(lines, cut));
  if (cut < 0) return null;
  const head = text.slice(0, cut).trimEnd();
  const rest = text.slice(cut).trim();
  if (!head || !rest) return null;
  return { head, rest };
}

/**
 * A cut must never land inside a markdown table: the head would render a table
 * of just its header row (or header and divider) above "Read the rest". Such a
 * cut moves back to just before the table, so the whole table folds away; a
 * table that opens the reply means there is nothing sensible to fold (-1).
 * Counting is untouched, so the fold still trips on exactly the replies the
 * bench calls too long.
 */
function keepTablesWhole(lines: Line[], cut: number): number {
  const at = lines.findIndex((l) => cut >= l.start && cut <= l.end);
  if (at < 0 || !TABLE_RE.test(lines[at]!.masked)) return cut;
  const next = lines[at + 1];
  if (!next || !TABLE_RE.test(next.masked)) return cut; // the cut closes the table
  let first = at;
  while (first > 0 && TABLE_RE.test(lines[first - 1]!.masked)) first--;
  return first > 0 ? lines[first - 1]!.end : -1;
}

/**
 * A head that ends on a line introducing what follows ("Two options:") reads
 * as a sentence cut in half above "Read the rest". Such a line folds away with
 * what it introduces; if it is the only line, there is nothing to fold (-1).
 */
function dropDanglingIntro(lines: Line[], cut: number): number {
  if (cut < 0) return cut;
  const at = lines.findIndex((l) => cut >= l.start && cut <= l.end);
  if (at < 0) return cut;
  const line = lines[at]!;
  if (cut !== line.end || !/:\s*$/.test(line.masked)) return cut;
  let prev = at - 1;
  while (prev >= 0 && !lines[prev]!.masked.trim()) prev--;
  return prev >= 0 ? lines[prev]!.end : -1;
}
