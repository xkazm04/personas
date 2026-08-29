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
export type TriageKind =
  | 'review'
  | 'idea'
  | 'practice'
  | 'question'
  | 'policy'
  | 'evolution'
  | 'goal';

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
 * The ONE fact that changes what the decision MEANS, promoted out of the ledger.
 *
 * The ledger is a list of equals — twelve grey rows, each as loud as the next.
 * That is the right shape for facts a reviewer weighs, and the wrong shape for a
 * fact that reframes the whole card: a persona review carrying an
 * `assignment_id` is BLOCKING A HELD TEAM STEP, and approving it resumes real
 * work that is currently stopped. Sorting that in beside "Severity: medium" is
 * how a reviewer skips it.
 *
 * At most one per card, deliberately. A surface with three alerts has none.
 */
export interface TriageAlert {
  id: string;
  /** Short headline, pre-translated. */
  label: string;
  /** One line of consequence — what deciding this actually does. */
  detail?: string;
  tone: TriageTone;
  icon?: LucideIcon;
}

/**
 * Somewhere to go and LOOK, which is not a decision.
 *
 * Distinct from a {@link TriageBranch} on purpose: a branch RESOLVES the item
 * (dispatch a suggested action, build it now, deprecate it) and is routed
 * through `triageDispatch`. A link resolves nothing — it opens the execution
 * that raised a review so the reviewer can read the run before ruling on it,
 * and the card is still sitting there when they come back. Routing one through
 * the verdict dispatcher would resolve a row nobody decided.
 */
export interface TriageLink {
  id: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
}

/**
 * One digit-picked answer to "why?".
 *
 * `label` and `value` are deliberately different things. The label is
 * pre-translated for the reviewer; the value is what gets WRITTEN, and it stays
 * canonical English on purpose — a rejected idea's reason becomes a `constraint`
 * memory the backend feeds back to the scanners, and adoption cells carry it as
 * "backlog rejected: …". Persisting a locale-shaped sentence into a store that
 * an English-prompted model reads back is how a Korean reviewer's "범위 밖"
 * silently stops teaching anything.
 */
export interface TriageReasonOption {
  id: string;
  /** Pre-translated, shown on the digit key. */
  label: string;
  /** What is written. Machine-durable, never localised. */
  value: string;
}

/**
 * What an item can record about WHY, and for which act.
 *
 * Every rejection in this app already had a column waiting for it
 * (`DevIdea.rejection_reason`, `PersonaManualReview.reviewer_notes`) and a whole
 * loop behind it — the backend turns a rejected idea's reason into a
 * `constraint` memory so future scans stop re-raising it. Nothing ever wrote
 * one, because no UI ever asked.
 *
 * `on` names the act being qualified: `'reject'`, or a branch id (the practice
 * `deprecate` branch qualifies with a SUCCESSOR rather than a reason, which is
 * why this is a prompt shape rather than a fixed reject-reason list).
 *
 * The contract the deck upholds: a prompt must be answerable with ONE keystroke
 * and skippable with ONE keystroke. A triage surface that makes you justify
 * yourself is a triage surface where everything gets approved instead.
 */
export interface TriageReasonPrompt {
  on: string;
  /** Heading, pre-translated. */
  title: string;
  /** Digit-picked options, in order — mapped to `1..9`. */
  options: TriageReasonOption[];
  /** Label of the one-keystroke escape. */
  skipLabel: string;
  /** Whether free text is accepted alongside the presets. */
  freeText: boolean;
  placeholder?: string;
}

/**
 * One thing a card asks for. Several of these can sit on one card.
 *
 * `deferred` marks a field that genuinely can't be answered inline — a
 * connector picker or a file attach — so the surface offers the deep-link
 * branch instead of an input it can't honour.
 */
export interface TriageQuestionField {
  /** The key the answer is filed under. This is the WRITE key, not a label. */
  key: string;
  /** The question itself, pre-translated by whoever raised it. */
  prompt: string;
  kind: 'choice' | 'text';
  options?: string[];
  /** Model-suggested answers, offered as one-tap chips above a text field. */
  suggestions?: string[];
  placeholder?: string;
  deferred?: boolean;
}

/**
 * Items that collect answers rather than a verdict (build questions).
 *
 * Plural on purpose. A halted build session usually has SEVERAL questions
 * outstanding, and the backend resumes the CLI once per
 * `answer_build_question` call — so one card per question meant resuming the
 * same session three times for three answers, defeating the batching contract
 * that `lib/build/answerPayload` exists to uphold. One card carries the whole
 * session, and accepting it is one batched write.
 */
export interface TriageInput {
  /** Every field this card collects, in ask order. Never empty. */
  fields: TriageQuestionField[];
  /** True when NOT ONE field can be answered inline — the card can only
   *  deep-link. A card with a mix is answerable; see `QuestionPanel`. */
  deferred: boolean;
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
  /** The one fact that reframes the decision, if this item has one. */
  alert?: TriageAlert;
  /** The metadata ledger, in reading order. */
  facts: TriageFact[];
  /** Read-only places to go and look. Never a verdict — see {@link TriageLink}. */
  links?: TriageLink[];
  /** Who raised it — persona, project, workspace. */
  source: { label: string; sublabel?: string; color?: string | null };
  createdAt: string;
  /**
   * Queue weight, higher first. Blends urgency (severity, priority) with the
   * item's own value score so one mixed queue can order itself sensibly.
   */
  weight: number;
  branches: TriageBranch[];
  /**
   * What this item can record about WHY, per act. At most one prompt per act;
   * an act with no prompt is decided outright, exactly as before.
   */
  reasonPrompts?: TriageReasonPrompt[];
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
  /** Set for question items: every field the reviewer filled in, by field key.
   *  Submitted as ONE batch — see `TriageInput`. */
  answers?: Record<string, string>;
  /** Optional free-text reason captured with a rejection. */
  reason?: string;
}

/**
 * The prompt qualifying one act on one item, if it has one.
 *
 * `act` is `'reject'` or a branch id — the same vocabulary the dispatcher routes
 * on, so the deck asks the model rather than re-deriving which kinds can record
 * a reason.
 */
export function reasonPromptFor(
  item: TriageItem,
  act: string,
): TriageReasonPrompt | undefined {
  return item.reasonPrompts?.find((p) => p.on === act);
}

/** Per-kind queue tallies, for filter chips and progress. */
export type TriageCounts = Record<TriageKind, number> & { total: number };

/**
 * Chip order, and the order every exhaustive loop walks.
 *
 * Roughly descending by how loudly the kind interrupts: the four original
 * queues first (they carry the volume), then the two proposal queues the
 * Self-Tuning Fabric and Darwin Mode file — rarer, heavier, and read last — and
 * `goal` last of all. A goal reaches this queue because a team FINISHED
 * something and the outcome needs signing off: real work waiting on a human,
 * but the only kind here where nothing is broken, blocked or expiring while it
 * waits. It interrupts least, so it is read last.
 */
export const TRIAGE_KINDS: readonly TriageKind[] = [
  'review',
  'idea',
  'practice',
  'question',
  'policy',
  'evolution',
  'goal',
];

/** Empty tally — the shape every counter starts from. */
export function emptyCounts(): TriageCounts {
  return {
    review: 0,
    idea: 0,
    practice: 0,
    question: 0,
    policy: 0,
    evolution: 0,
    goal: 0,
    total: 0,
  };
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
 * The default order, over the two fields it actually reads.
 *
 * Split out from {@link compareTriage} so the queue can hoist those two fields
 * out of the comparator instead of dereferencing an item inside every one of
 * the O(n log n) comparisons. There is still exactly ONE ordering law; this is
 * the law, and `compareTriage` is the convenience wrapper over it.
 *
 * `createdAt` is compared with `<`/`>` rather than `localeCompare`. These are
 * RFC3339 strings — fixed-width ASCII digits and separators, in which codepoint
 * order and collation order are the same sequence — and `localeCompare` is an
 * ICU call that was being made twice per comparison on a list the deck re-sorts
 * on every 30-second poll.
 */
export function compareOrder(
  aWeight: number,
  aCreatedAt: string,
  bWeight: number,
  bCreatedAt: string,
  aId: string,
  bId: string,
): number {
  if (bWeight !== aWeight) return bWeight - aWeight;
  if (aCreatedAt < bCreatedAt) return -1;
  if (aCreatedAt > bCreatedAt) return 1;
  // Identity tiebreak: the order has to be TOTAL. Two items raised in the same
  // second with the same weight are a real case (one poll, one producer, one
  // batch), and without this the pair's relative position is whatever order
  // the backend happened to return — a 30s poll replaces the array wholesale,
  // so the two cards can trade places under the reviewer between refreshes.
  // The ids are opaque and stable, so this is arbitrary but never varies.
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

/**
 * Default queue order: weight first, then oldest-first inside a weight band.
 *
 * Oldest-first is deliberate — a triage queue sorted newest-first quietly
 * starves its own tail, and the items that rot at the bottom are exactly the
 * ones someone already declined to judge once.
 */
export function compareTriage(a: TriageItem, b: TriageItem): number {
  return compareOrder(a.weight, a.createdAt, b.weight, b.createdAt, a.id, b.id);
}
