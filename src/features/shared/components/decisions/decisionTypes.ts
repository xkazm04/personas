// The shape every "should this be accepted?" surface normalizes onto.
//
// Personas has three decision streams — persona Manual Review, the Dev Tools
// backlog, and the Workspace Knowledge library — that were each written
// independently and ended up with three row layouts, three accept/reject
// controls and three sets of colour choices for the same human act. The intent
// is identical in all three, so the presentation should be too.
//
// This module is deliberately domain-free: no store, no api, no bindings. Each
// feature writes a small adapter from its own row type to `DecisionRecord`, and
// the shared components render it. Labels are passed in so the primitives never
// carry English.

/** A small labelled number/short-value shown in a row's meta line
 *  (effort/impact/risk, confidence, evidence count …). */
export interface DecisionFact {
  label: string;
  value: string | number;
  /** Optional tooltip for abbreviated labels like "E" / "I" / "R". */
  title?: string;
}

/** One reviewable item, whatever stream it came from. */
export interface DecisionRecord {
  id: string;
  title: string;
  /** One-line supporting text under the title. */
  summary?: string | null;
  /** Category / topic / severity chip text. */
  category?: string | null;
  /** Tailwind classes for the category chip (bg + text). Domain themes supply
   *  these — e.g. the taxonomy-area palette, or a severity palette. */
  categoryClass?: string;
  /** `border-l-*` accent for the row's left rail. */
  accentClass?: string;
  /** Where it came from — project, persona, or workspace. */
  source?: string | null;
  facts?: DecisionFact[];
  /** ISO timestamp; rendered as relative time when present. */
  timestamp?: string | null;
}

/** How an action reads, not what it does — keeps colour consistent across the
 *  three streams instead of each picking its own emerald/red/primary. */
export type DecisionTone = 'accept' | 'reject' | 'neutral';

export interface DecisionAction {
  id: string;
  label: string;
  tone: DecisionTone;
  onClick: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Shows a spinner on this specific action while a verdict is in flight. */
  loading?: boolean;
  /** Tooltip / aria-label when the label is hidden at narrow widths. */
  title?: string;
}
