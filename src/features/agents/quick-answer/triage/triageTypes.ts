/**
 * triageTypes.ts — the one shape every triage surface speaks.
 *
 * The app grew four separate "a human must decide this" queues, each with its
 * own vocabulary: persona manual reviews (approve/reject + carry out a
 * suggested action), backlog ideas (accept/reject/build-now), workspace
 * practices (adopt/reject/deprecate) and build questions (which aren't a
 * verdict at all — they collect an answer). Four data shapes, four UIs, four
 * keyboard schemes.
 *
 * This module is the reduction: ONE item type carrying content, metadata and
 * the actions that item happens to support, so a single surface can triage all
 * of them and the presentation layer never learns where a row came from.
 *
 * Three rules keep it honest:
 *  1. Nothing here imports app state, API or React — adapters inject.
 *  2. Labels arrive pre-translated. The model carries no i18n keys, so the same
 *     item can be rendered by surfaces that resolve copy differently.
 *  3. Every item supports the same three-verdict spine. Anything an item can do
 *     BEYOND that spine is a `branch` — never a fifth special case in the view.
 *
 * React-free and store-free on purpose.
 */
import type { LucideIcon } from 'lucide-react';

/** Which queue an item came from. Presentation uses it only for grouping and
 *  filtering — never to branch on how to render content. */
export type TriageKind = 'review' | 'idea' | 'practice' | 'question';

/**
 * The universal verdict spine. Every item supports all three, whatever it is:
 *  • accept — approve / accept / adopt / submit-answer
 *  • reject — reject / decline
 *  • skip   — leave pending, advance the queue (a local decision, never a write)
 *
 * `skip` is deliberately part of the spine rather than a branch: "I can't judge
 * this right now" is the most common honest answer in a long queue, and a
 * triage surface that forces a verdict trains people to accept by reflex.
 */
export type TriageVerdict = 'accept' | 'reject' | 'skip';

/** Semantic colour intent. Maps to the app's status tokens at render time —
 *  the model never names a palette class. */
export type TriageTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/**
 * One metadata row in the item's ledger.
 *
 * `score` is the interesting part: effort/impact/risk (1–10) and confidence
 * (0–1) are the facts reviewers actually weigh, and they read far better as a
 * meter than as a number. `invert` marks the scales where LOW is good (effort,
 * risk) so a variant can colour them without hardcoding which fact is which.
 */
export interface TriageFact {
  id: string;
  /** Pre-translated, short. Rendered as an uppercase-tracked label. */
  label: string;
  /** Pre-formatted display value. */
  value: string;
  tone?: TriageTone;
  score?: { value: number; max: number; invert?: boolean };
}

/** A chip: category, origin/sensor, severity, practice kind, verify verdict. */
export interface TriageTag {
  id: string;
  label: string;
  tone: TriageTone;
  icon?: LucideIcon;
}

/**
 * An item-specific action beyond the spine — "Carry out: rotate the key",
 * "Build now", "Deprecate", "Open in builder".
 *
 * Branches are the escape hatch that let one surface cover four domains
 * without special-casing any of them, and they are digit-hotkeyed `1..9` in
 * every variant, so a reviewer's fingers learn one pattern: arrows decide,
 * numbers branch.
 */
export interface TriageBranch {
  id: string;
  label: string;
  tone: TriageTone;
  /** One-line explanation of what firing this branch will actually do. */
  hint?: string;
  icon?: LucideIcon;
}

/**
 * Items that collect an answer rather than a verdict (build questions).
 * `deferred` marks the ones that genuinely can't be answered inline — a
 * connector picker or file attach — so the surface offers the deep-link branch
 * instead of an input it can't honour.
 */
export interface TriageInput {
  kind: 'choice' | 'text';
  options?: string[];
  /** Model-suggested answers, offered as one-tap chips above a text field. */
  suggestions?: string[];
  placeholder?: string;
  deferred?: boolean;
}

/** The unified triage item — what every variant renders. */
export interface TriageItem {
  /** Unique across sources: `${kind}:${sourceId}`. Queue keys use this. */
  id: string;
  /** The id the backend knows. Verdict dispatch uses this. */
  sourceId: string;
  kind: TriageKind;
  title: string;
  /** The long-form case being judged. Markdown. */
  body: string;
  /** Secondary prose — why it was raised. Markdown. */
  reasoning?: string;
  /** Pretty-printed JSON / code. Rendered monospace, never markdown. */
  evidence?: string | null;
  tags: TriageTag[];
  /** The metadata ledger, in reading order. */
  facts: TriageFact[];
  /** Who raised it — persona, project, workspace. */
  source: { label: string; sublabel?: string; color?: string | null };
  createdAt: string;
  /**
   * Queue weight, higher first. Blends urgency (severity, priority) with the
   * item's own value score so one mixed queue can order itself sensibly.
   */
  weight: number;
  branches: TriageBranch[];
  input?: TriageInput;
  /**
   * What the three spine verdicts are CALLED for this item — "Adopt" reads
   * wrong on a persona review and "Approve" reads wrong on a practice. The
   * verbs differ; the gesture doesn't.
   */
  verdictLabels: Record<TriageVerdict, string>;
  /**
   * Identifiers the verdict dispatcher needs that are NOT display facts —
   * project id, session id, persona id. Kept separate on purpose: reading a
   * machine id back out of a human-facing fact row is how a display change
   * silently breaks a write.
   */
  payload?: Record<string, string | null | undefined>;
}

/** What a variant hands back when the user decides. */
export interface TriageDecision {
  item: TriageItem;
  verdict: TriageVerdict;
  /** Set when a branch was fired instead of a plain verdict. */
  branchId?: string;
  /** Set for question items. */
  answer?: string;
  /** Optional free-text reason captured with a rejection. */
  reason?: string;
}

/** Per-kind queue tallies, for filter chips and progress. */
export type TriageCounts = Record<TriageKind, number> & { total: number };

export const TRIAGE_KINDS: readonly TriageKind[] = ['review', 'idea', 'practice', 'question'];

/** Empty tally — the shape every counter starts from. */
export function emptyCounts(): TriageCounts {
  return { review: 0, idea: 0, practice: 0, question: 0, total: 0 };
}

/** Tally a queue by kind. */
export function countByKind(items: readonly TriageItem[]): TriageCounts {
  const counts = emptyCounts();
  for (const item of items) {
    counts[item.kind] += 1;
    counts.total += 1;
  }
  return counts;
}

/**
 * Default queue order: weight first, then oldest-first inside a weight band.
 *
 * Oldest-first is deliberate — a triage queue sorted newest-first quietly
 * starves its own tail, and the items that rot at the bottom are exactly the
 * ones someone already declined to judge once.
 */
export function compareTriage(a: TriageItem, b: TriageItem): number {
  return b.weight - a.weight || a.createdAt.localeCompare(b.createdAt);
}
