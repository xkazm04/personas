import type { DevNote } from '@/lib/bindings/DevNote';

/**
 * How much of a note a card shows — and the ceiling under which the card is
 * also where you WRITE it. Past it the card is a window onto a document that
 * lives in the editor, and typing into a window that shows a fraction of the
 * text would be editing blind.
 */
export const CARD_TEXT_LIMIT = 100;

/** A card may take keystrokes only for a short draft. Body edits are legal on a
 *  draft alone (the server refuses the rest), so the status half is the
 *  contract, not a style choice. */
export function canQuickWrite(note: DevNote): boolean {
  return note.status === 'draft' && note.bodyMd.length <= CARD_TEXT_LIMIT;
}

export interface CardExcerpt {
  text: string;
  /** The note holds more than a card can — measured on the stored markdown,
   *  the same length `canQuickWrite` measures, so the two never disagree. */
  truncated: boolean;
}

/** Plain-text excerpt for a card: markdown markers stripped so `## Goal` reads
 *  as `Goal`, whitespace collapsed, cut on a word boundary. */
export function cardExcerpt(bodyMd: string, limit = CARD_TEXT_LIMIT): CardExcerpt {
  const plain = bodyMd
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s\[[ xX]\]|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const truncated = bodyMd.length > limit;
  if (plain.length <= limit) return { text: plain, truncated };
  const cut = plain.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return { text: `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`, truncated };
}

/** A title for a note captured from a single line of text. */
export function titleFromText(text: string, fallback: string): string {
  const first = text
    .split('\n')
    .find((line) => line.trim())
    ?.replace(/^[#>*\-\s]+/, '')
    .trim();
  if (!first) return fallback;
  return first.length > 48 ? `${first.slice(0, 47).trimEnd()}…` : first;
}

/** Parse the sweeper's `result_json` for a human-readable summary. */
export function resultSummary(resultJson: string | null): string | null {
  if (!resultJson) return null;
  try {
    const parsed: unknown = JSON.parse(resultJson);
    // INVARIANT for the narrowing: this string is a run artifact written by a
    // skill on disk and passed through SQLite, so its real type is `unknown` —
    // the contract's shape is what we HOPE for, never what we assume.
    if (!parsed || typeof parsed !== 'object') return null;
    const summary = (parsed as { summary?: unknown }).summary;
    return typeof summary === 'string' ? summary : null;
  } catch {
    return null;
  }
}
