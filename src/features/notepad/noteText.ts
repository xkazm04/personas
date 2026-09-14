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
