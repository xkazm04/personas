/**
 * Athena hands-free decision layer (P3, slice 7) — spoken-number parsing.
 *
 * When a {@link import('./types').PendingDecision} is active, a spoken turn may
 * be the user *answering* it ("one", "3", "explain") rather than a fresh chat
 * message. This pure helper maps a final STT transcript to a decision answer so
 * `useHoldToTalk` can resolve the decision instead of firing a chat turn.
 *
 * Deliberately conservative — it only recognises a bare digit / number word /
 * "zero" / "explain". Anything else (a real sentence, an out-of-range number)
 * returns `null` so the transcript falls through to the normal chat pipeline.
 */

/** Result of parsing a spoken decision answer. */
export type SpokenDecision =
  /** Pick option `index` (0-based) — i.e. the spoken "1" maps to index 0. */
  | { kind: 'option'; index: number }
  /** The `0` / "explain" affordance: explain + recommend (don't resolve). */
  | { kind: 'explain' };

/** Spoken number words → 1-based choice number (0 = explain). */
const WORD_TO_NUMBER: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

/**
 * Parse a final STT transcript into a decision answer, or `null` if it isn't
 * one (so the caller fires a normal chat turn instead).
 *
 * @param transcript the raw final transcript from STT.
 * @param optionCount how many numbered options the pending decision has (1..9).
 * @returns `{ kind: 'option', index }` for a valid 1..optionCount choice,
 *   `{ kind: 'explain' }` for "0" / "zero" / "explain", or `null` otherwise.
 */
export function parseSpokenDecision(
  transcript: string,
  optionCount: number,
): SpokenDecision | null {
  // Normalise: lowercase, drop surrounding punctuation/whitespace. STT often
  // appends a trailing period ("one.") — strip non-alphanumerics from the ends.
  const word = transcript
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (!word) return null;

  // "explain" is an explicit alias for the 0 affordance.
  if (word === 'explain') return { kind: 'explain' };

  let n: number | null = null;
  if (/^\d+$/.test(word)) {
    n = Number(word);
  } else if (word in WORD_TO_NUMBER) {
    n = WORD_TO_NUMBER[word]!;
  }
  if (n === null) return null;

  // 0 → explain; 1..optionCount → option index; anything else is out of range.
  if (n === 0) return { kind: 'explain' };
  if (n >= 1 && n <= optionCount) return { kind: 'option', index: n - 1 };
  return null;
}
