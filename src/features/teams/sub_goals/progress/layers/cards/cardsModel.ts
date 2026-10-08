/**
 * Pure shaping for the CARDS prototype: what a brief card and a sticky note
 * show, decided without the DOM so the rules are testable.
 */
import { markdownToPlainText } from '@/features/notepad/cardMarkdown';

/** How much of a brief a milestone card quotes. */
export const BRIEF_EXCERPT_CHARS = 140;
/** How many goal lines a card lists before it says "+N". */
export const CARD_GOAL_LINES = 4;

/**
 * A note's body as one reading line: markdown markers stripped, whitespace
 * collapsed, cut on a word boundary near `max` with an ellipsis. `null` when
 * the body holds no words - an empty brief is said as such, never as "".
 */
export function briefExcerpt(bodyMd: string, max = BRIEF_EXCERPT_CHARS): string | null {
  const text = markdownToPlainText(bodyMd).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  // Only back off to a word boundary when it does not eat most of the line.
  const head = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s.,;:-]+$/, '')}…`;
}

/** The first `max` items and how many were left out. */
export function headAndRest<T>(items: readonly T[], max = CARD_GOAL_LINES): { head: T[]; rest: number } {
  return { head: items.slice(0, max), rest: Math.max(0, items.length - max) };
}

/**
 * The perimeter stroke for a progress value, in `pathLength=100` units.
 * `null` progress has no fill at all (the card draws a dashed, unfilled
 * outline); 0 draws nothing rather than a round-cap dot.
 */
export function perimeterDash(progress: number | null): string | null {
  if (progress === null) return null;
  const p = Math.max(0, Math.min(100, progress));
  // The gap is a whole perimeter, so the pattern never repeats a second dash.
  return `${p} 100`;
}
