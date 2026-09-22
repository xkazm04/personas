/**
 * Author colouring for `DocumentSurface`, in one place.
 *
 * Every surface that shows a two-author document has to answer "whose hand is
 * this?" in colour, and answering it inline at each call site is how a rail, a
 * tab strip and a section header end up disagreeing. These are semantic status
 * tokens rather than `brand-*`, which is unreliable under Tailwind v4 (see
 * Design.md §3 and the repo's Tailwind brand-token note).
 */
import type { DocumentAuthor } from './documentModel';

export interface AuthorTone {
  /** Text colour for the author's name, tab label and section kicker. */
  text: string;
  /** The section's leading edge and the rail band's fill. */
  edge: string;
  /** A resting rail band / closed row background. */
  wash: string;
  /** Border for a pending marker or an open band. */
  ring: string;
}

export const AUTHOR_TONE: Record<DocumentAuthor, AuthorTone> = {
  you: {
    text: 'text-primary',
    edge: 'bg-primary',
    wash: 'bg-primary/10',
    ring: 'border-primary/40',
  },
  agent: {
    text: 'text-status-info',
    edge: 'bg-status-info',
    wash: 'bg-status-info/10',
    ring: 'border-status-info/40',
  },
  neither: {
    text: 'text-foreground',
    edge: 'bg-status-neutral',
    wash: 'bg-secondary/40',
    ring: 'border-primary/20',
  },
};

/**
 * The reading measure.
 *
 * `ch`, not `rem` or `px`: the app re-maps every `typo-*` size under
 * `[data-text-scale]` and switches font stacks under `[data-lang]`, so a fixed
 * width would be the right measure at exactly one setting. A character-based
 * measure holds roughly 70 characters per line at every scale, which is what
 * the owner chose this design for.
 */
export const DOCUMENT_MEASURE = 'max-w-[70ch]';
