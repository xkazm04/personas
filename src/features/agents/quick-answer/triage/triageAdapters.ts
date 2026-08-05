/**
 * triageAdapters.ts — six source shapes in, one {@link TriageItem} out.
 *
 * Each adapter answers the same four questions about its domain, and nothing
 * else: what is the case being judged, what facts would a reviewer weigh, what
 * can be done to it beyond accept/reject/skip, and how urgent is it relative to
 * items from a completely different queue.
 *
 * That last one is the only genuinely hard part. A persona review, a backlog
 * idea and a harvested practice have no shared scale, so `weight` is an
 * explicit editorial judgement, documented per adapter below. It decides what a
 * reviewer sees first in a mixed queue, so it is stated in one place rather
 * than emerging accidentally from four sort orders.
 *
 * React-free and store-free: callers inject already-loaded rows and copy.
 */
import {
  Hammer,
  ExternalLink,
  Archive,
  Play,
  ArrowUpNarrowWide,
  Lock,
  Terminal,
  Users,
  Wrench,
  Briefcase,
  Brain,
  Tag as TagIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { parseSuggestedActions } from '@/lib/reviews/suggestedActions';
import type { ManualReviewItem } from '@/lib/types/types';
import type { BuildQuestion } from '@/lib/types/buildTypes';
import type { EvolutionPromotionProposal } from '@/lib/bindings/EvolutionPromotionProposal';
import type { PolicyProposal } from '@/lib/bindings/PolicyProposal';
import type { KnowledgeItemView } from '@/features/overview/sub_patterns/libraryModel';
import { toCanonicalIdeaCategory } from '@/features/plugins/dev-tools/constants/ideaCategories';
import {
  prettyEvidence,
  triageValueScore,
  type BacklogIdea,
} from '@/features/overview/sub_manual-review/components/backlog/backlogModel';

import type { AdoptReach } from './triageReach';
import type {
  TriageItem,
  TriageTag,
  TriageFact,
  TriageLink,
  TriageReasonPrompt,
  TriageTone,
  TriageQuestionField,
} from './triageTypes';

/**
 * Every user-facing string the adapters need, injected so the model stays
 * i18n-agnostic.
 *
 * `useTriageCopy` is the React binding that fills this from the translation
 * tree; {@link DEFAULT_TRIAGE_COPY} below is the English fallback for callers
 * outside a component (and the source of truth for the `en.json` wording).
 */
export interface TriageCopy {
  accept: string;
  reject: string;
  skip: string;
  adopt: string;
  approve: string;
  submit: string;
  defer: string;
  buildNow: string;
  buildNowHint: string;
  deprecate: string;
  deprecateHint: string;
  openBuilder: string;
  openBuilderHint: string;
  carryOutHint: string;
  severity: string;
  reviewType: string;
  persona: string;
  raised: string;
  project: string;
  category: string;
  origin: string;
  scanner: string;
  effort: string;
  impact: string;
  risk: string;
  value: string;
  topic: string;
  practiceKind: string;
  altitude: string;
  durability: string;
  confidence: string;
  evidenceSeen: string;
  workspace: string;
  answerPlaceholder: string;
  noDescription: string;
  cloud: string;
  local: string;
  /** Alert headline for a review that is holding a team step. */
  blocking: string;
  /** What approving that review actually does. */
  blockingDetail: string;
  /** Link out to the execution that raised a review. */
  viewRun: string;
  viewRunHint: string;
  /** The Strategist's explicit backlog rank. */
  priority: string;
  /** Rank display. Carries a `{rank}` placeholder. */
  priorityRank: string;
  /** Which stacks a practice can apply to. */
  appliesTo: string;
  /** Value of the above when the practice constrains nothing. */
  appliesToAny: string;
  /** How many member repos an adopt would touch. */
  adoptReach: string;
  /** Reach display. Carries `{applicable}` and `{total}` placeholders. */
  adoptReachValue: string;
  /* -- rejection reasons ---------------------------------------------------- */
  /** Heading of the reason strip. */
  reasonTitle: string;
  /** The one-keystroke escape. */
  reasonSkip: string;
  /** Free-text placeholder. */
  reasonPlaceholder: string;
  reasonNotNeeded: string;
  reasonWrongApproach: string;
  reasonAlreadyHandled: string;
  reasonNeedsInfo: string;
  reasonOutOfScope: string;
  reasonByDesign: string;
  reasonNotWorthIt: string;
  reasonAlreadyDone: string;
  /** Heading when the prompt is asking what REPLACES a deprecated practice. */
  supersededTitle: string;
  supersededSkip: string;
  /** Title for a session card carrying more than one question. Carries a
   *  `{count}` placeholder — the adapter substitutes, so this stays the one
   *  string in the contract that is a template rather than a label. */
  questionsPending: string;
  questionsFact: string;
  /* -- policy proposals (Self-Tuning Fabric) --------------------------------- */
  /** Verdict verbs. "Apply" and "Decline" are the Fabric's own words. */
  policyApply: string;
  policyDecline: string;
  /** Who raised it. */
  policySource: string;
  policyKindRouting: string;
  policyKindBudget: string;
  /** `{category}` `{to}`. */
  policyRoutingTitle: string;
  /** `{category}` `{from}` `{to}` `{saving}` `{pct}`. */
  policyRoutingBody: string;
  /** `{proposed}`. */
  policyBudgetIntroduceTitle: string;
  policyBudgetRaiseTitle: string;
  policyBudgetLowerTitle: string;
  /** `{observed}` `{rows}` `{current}`. */
  policyBudgetBody: string;
  fromModel: string;
  toModel: string;
  saving: string;
  /** `{amount}`. */
  savingValue: string;
  qualityDelta: string;
  /** The alert: this proposal buys its saving with quality. */
  policyQualityDrop: string;
  /** `{delta}` `{basis}`. */
  policyQualityDropDetail: string;
  qualityBasis: string;
  basisLab: string;
  basisSuccess: string;
  runs: string;
  /** `{incumbent}` `{challenger}`. */
  runsValue: string;
  ceiling: string;
  proposedCeiling: string;
  observedSpend: string;
  /** Value of `ceiling` when there is not one yet. */
  noCeiling: string;
  reasonQualityRisk: string;
  reasonSavingTooSmall: string;
  reasonThinEvidence: string;
  reasonKeepCurrent: string;
  /* -- evolution promotions (Darwin Mode) ------------------------------------ */
  promote: string;
  evolutionSource: string;
  /** `{persona}`. */
  evolutionTitle: string;
  evolutionMeasured: string;
  incumbentScore: string;
  winnerScore: string;
  gain: string;
  bar: string;
  /** `{value}` — a fitness delta rendered in points. */
  points: string;
  fitnessSource: string;
  /** The alert: this proposal is pinned to a persona snapshot. */
  evolutionLock: string;
  evolutionLockDetail: string;
  evolutionLockFact: string;
  reasonGainTooSmall: string;
  reasonPromptWorse: string;
  reasonFreshCycle: string;
}

/** Provisional English. Replaced wholesale by translated copy at consolidation. */
export const DEFAULT_TRIAGE_COPY: TriageCopy = {
  accept: 'Accept',
  reject: 'Reject',
  skip: 'Skip',
  adopt: 'Adopt',
  approve: 'Approve',
  submit: 'Submit',
  defer: 'Later',
  buildNow: 'Build now',
  buildNowHint: 'Accept and queue a task for it',
  deprecate: 'Deprecate',
  deprecateHint: 'Retire this practice without rejecting it',
  openBuilder: 'Open in builder',
  openBuilderHint: 'Needs the full picker — answer it in the persona builder',
  carryOutHint: 'Resolve the review and carry this out',
  severity: 'Severity',
  reviewType: 'Type',
  persona: 'Persona',
  raised: 'Raised',
  project: 'Project',
  category: 'Category',
  origin: 'Raised by',
  scanner: 'Idea Scanner',
  effort: 'Effort',
  impact: 'Impact',
  risk: 'Risk',
  value: 'Value',
  topic: 'Topic',
  practiceKind: 'Kind',
  altitude: 'Altitude',
  durability: 'Durability',
  confidence: 'Confidence',
  evidenceSeen: 'Seen in',
  workspace: 'Workspace',
  answerPlaceholder: 'Type your answer…',
  noDescription: 'No description was provided.',
  cloud: 'Cloud',
  local: 'Local',
  blocking: 'Blocking a team step',
  blockingDetail: 'A held step is waiting on this — approving it resumes the work.',
  viewRun: 'See the run',
  viewRunHint: 'Open the execution that raised this review',
  priority: 'Priority',
  priorityRank: '#{rank}',
  appliesTo: 'Applies to',
  appliesToAny: 'Any stack',
  adoptReach: 'Adopt reaches',
  adoptReachValue: '{applicable} of {total} repos',
  reasonTitle: 'Why?',
  reasonSkip: 'No reason',
  reasonPlaceholder: 'Or type your own…',
  reasonNotNeeded: 'Not needed',
  reasonWrongApproach: 'Wrong approach',
  reasonAlreadyHandled: 'Already handled',
  reasonNeedsInfo: 'Needs more information',
  reasonOutOfScope: 'Out of scope',
  reasonByDesign: 'Working as intended',
  reasonNotWorthIt: 'Not worth the effort',
  reasonAlreadyDone: 'Already done',
  supersededTitle: 'Replaced by',
  supersededSkip: 'No successor',
  questionsPending: '{count} questions before this build can continue',
  questionsFact: 'Questions',
  policyApply: 'Apply',
  policyDecline: 'Decline',
  policySource: 'Self-tuning',
  policyKindRouting: 'Routing',
  policyKindBudget: 'Budget',
  policyRoutingTitle: 'Route {category} work to {to}',
  policyRoutingBody:
    'Sending {category} runs to {to} instead of {from} projects a saving of {saving} a month — {pct} of what that work costs today.',
  policyBudgetIntroduceTitle: 'Introduce a monthly ceiling of {proposed}',
  policyBudgetRaiseTitle: 'Raise the monthly ceiling to {proposed}',
  policyBudgetLowerTitle: 'Lower the monthly ceiling to {proposed}',
  policyBudgetBody:
    'Spend is running at {observed} a month across {rows} charged runs, against a ceiling of {current}.',
  fromModel: 'Now',
  toModel: 'Proposed',
  saving: 'Saving',
  savingValue: '{amount}/mo',
  qualityDelta: 'Quality',
  policyQualityDrop: 'Cheaper, and measurably worse',
  policyQualityDropDetail:
    'The proposed model scores {delta} against the one in use, on {basis}. Applying this buys the saving with that quality.',
  qualityBasis: 'Measured on',
  basisLab: 'Lab scores',
  basisSuccess: 'Success rate',
  runs: 'Runs',
  runsValue: '{incumbent} vs {challenger}',
  ceiling: 'Ceiling now',
  proposedCeiling: 'Ceiling after',
  observedSpend: 'Spend',
  noCeiling: 'None',
  reasonQualityRisk: 'Quality risk',
  reasonSavingTooSmall: 'Saving too small',
  reasonThinEvidence: 'Not enough evidence',
  reasonKeepCurrent: 'Keep what we have',
  promote: 'Promote',
  evolutionSource: 'Evolution',
  evolutionTitle: 'Promote the evolved {persona}',
  evolutionMeasured: 'Measured',
  incumbentScore: 'Incumbent',
  winnerScore: 'Challenger',
  gain: 'Gain',
  bar: 'Bar',
  points: '{value} pts',
  fitnessSource: 'Fitness',
  evolutionLock: 'Pinned to an earlier persona',
  evolutionLockDetail:
    "Promoting installs the challenger's prompt on the live persona. If the persona has been edited since this cycle ran, the write fails closed and nothing changes.",
  evolutionLockFact: 'Pinned to',
  reasonGainTooSmall: 'Gain too small',
  reasonPromptWorse: 'Prompt reads worse',
  reasonFreshCycle: 'Run a fresh cycle',
};

/**
 * Substitute every `{name}` in a template.
 *
 * The copy contract carries templates rather than assembled sentences, because
 * word order is not universal — a locale that needs the model before the
 * category cannot be served by concatenating labels. Chained `.replace()` calls
 * were fine for the one-placeholder strings this file started with; the policy
 * claims carry five.
 */
function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (out, [key, value]) => out.split(`{${key}}`).join(String(value)),
    template,
  );
}

/* -------------------------------------------------------------------------- */
/* Weight — the one cross-domain scale                                        */
/* -------------------------------------------------------------------------- */

/** Severity → urgency. The only axis that outranks a blocked build. */
const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 120,
  high: 95,
  medium: 60,
  low: 35,
};

const SEVERITY_TONE: Record<string, TriageTone> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

/**
 * A blocked build session outranks everything except a high/critical review:
 * a persona is literally halted waiting for this answer, and every minute it
 * waits is a minute of work not happening.
 */
const QUESTION_WEIGHT = 90;

/**
 * How much a review that is HOLDING A TEAM STEP outranks the same review
 * standing alone.
 *
 * Enough to lift a `medium` blocker above an unblocked `high` (60 + 40 > 95 is
 * false — deliberately) but to put it clearly ahead of its own severity band. A
 * blocked step is work that has stopped; advisory reviews are work that has
 * finished and wants an opinion. Severity still wins outright, because a
 * critical incident nobody is waiting on is still a critical incident.
 */
const BLOCKING_WEIGHT_BOOST = 40;

/**
 * Policy proposals — below every idea that is actually worth doing, and far
 * below anything that has stopped.
 *
 * A routing proposal is an OPTIMISATION of work that is already succeeding: not
 * deciding it costs a little money per day and nothing else, and the evidence
 * snapshot behind it does not rot (it is persisted per proposal, so a week-old
 * proposal argues exactly as well as a fresh one). 40 lands it mid-idea band —
 * ahead of the stale low-value tail, behind a high-value quick win.
 *
 * A budget-ceiling proposal outranks it, because the thing it is reacting to is
 * money already leaving: `lower` means spend has outrun the ceiling and
 * `introduce` means there is no ceiling at all. Still below a blocked build (90)
 * — a persona halted mid-run is work not happening, which beats work happening
 * expensively.
 */
const POLICY_ROUTING_WEIGHT = 40;
const POLICY_BUDGET_WEIGHT = 52;

/**
 * Evolution promotions — the heaviest non-incident row in the deck.
 *
 * Two arguments put it here, and only the second is about urgency:
 *
 *  1. **Blast radius.** Approving installs a new system prompt on a LIVE
 *     persona and writes `persona_change_log` rows. Nothing else this deck
 *     collects changes how an agent behaves on its next run.
 *  2. **It is the one row that EXPIRES.** Every other card argues as well
 *     tomorrow as today. A promotion is pinned to the persona's `updated_at`
 *     when the cycle started, so any edit to that persona — by a human, by
 *     Athena — makes the approval fail closed forever. Deferring it is not free:
 *     it is the only way to lose the decision by doing nothing.
 *
 * `EVOLUTION_BASE` sits just under a blocked build session (90), so a halted
 * persona still gets read first, and the margin the challenger cleared its
 * threshold by lifts it from there: a variant that scraped past the bar is not
 * the same call as one that beat it outright. `MAX` caps the lift below a
 * `critical` review (120), because a promotion is never an incident.
 */
const EVOLUTION_BASE = 78;
const EVOLUTION_MARGIN_MAX = 25;

/* -------------------------------------------------------------------------- */
/* Rejection reasons — the presets                                             */
/* -------------------------------------------------------------------------- */

/**
 * The written values are canonical ENGLISH and live in code, not in `en.json`.
 *
 * They are data, not copy: a rejected idea's reason becomes a `constraint`
 * memory the scanners read back, and a rejected practice-materialised idea
 * writes it into the adoption matrix as `backlog rejected: <reason>`. Both are
 * consumed by English-prompted models and by future sessions, so the persisted
 * string must not drift with the reviewer's locale — the same split the app
 * already makes for backend status tokens. The reviewer sees `copy.*`.
 *
 * Two sets, because the two loops learn different things: a rejected REVIEW is
 * feedback to a persona about a judgement it asked for, while a rejected IDEA is
 * a standing constraint that stops a scanner re-raising the same finding.
 */
const REVIEW_REJECT_PRESETS = [
  { id: 'not_needed', value: 'Not needed', copy: (c: TriageCopy) => c.reasonNotNeeded },
  { id: 'wrong_approach', value: 'Wrong approach', copy: (c: TriageCopy) => c.reasonWrongApproach },
  { id: 'already_handled', value: 'Already handled', copy: (c: TriageCopy) => c.reasonAlreadyHandled },
  { id: 'needs_info', value: 'Needs more information', copy: (c: TriageCopy) => c.reasonNeedsInfo },
] as const;

const IDEA_REJECT_PRESETS = [
  { id: 'out_of_scope', value: 'Out of scope', copy: (c: TriageCopy) => c.reasonOutOfScope },
  { id: 'by_design', value: 'Working as intended', copy: (c: TriageCopy) => c.reasonByDesign },
  { id: 'not_worth_it', value: 'Not worth the effort', copy: (c: TriageCopy) => c.reasonNotWorthIt },
  { id: 'already_done', value: 'Already done', copy: (c: TriageCopy) => c.reasonAlreadyDone },
] as const;

/**
 * A declined policy proposal writes its reason into `policy_proposals.decline_reason`,
 * which the settings history renders verbatim. The four presets are the four
 * things the generator can actually be wrong about — a quality claim it
 * over-trusted, a saving too small to be worth a routing change, an evidence
 * window too thin, and "the current setup is deliberate".
 */
const POLICY_DECLINE_PRESETS = [
  { id: 'quality_risk', value: 'Quality risk', copy: (c: TriageCopy) => c.reasonQualityRisk },
  { id: 'saving_too_small', value: 'Saving too small', copy: (c: TriageCopy) => c.reasonSavingTooSmall },
  { id: 'thin_evidence', value: 'Not enough evidence', copy: (c: TriageCopy) => c.reasonThinEvidence },
  { id: 'keep_current', value: 'Keep the current setup', copy: (c: TriageCopy) => c.reasonKeepCurrent },
] as const;

/**
 * A rejected promotion writes `decision_note`, which is the only feedback a
 * Darwin cycle ever gets from a human. "Run a fresh cycle" is the one that
 * matters most: it distinguishes "this challenger is wrong" from "this
 * challenger is stale", and those call for opposite next actions.
 */
const EVOLUTION_REJECT_PRESETS = [
  { id: 'gain_too_small', value: 'Gain too small', copy: (c: TriageCopy) => c.reasonGainTooSmall },
  { id: 'prompt_worse', value: 'Prompt reads worse', copy: (c: TriageCopy) => c.reasonPromptWorse },
  { id: 'fresh_cycle', value: 'Run a fresh cycle', copy: (c: TriageCopy) => c.reasonFreshCycle },
] as const;

type PresetSet =
  | typeof REVIEW_REJECT_PRESETS
  | typeof IDEA_REJECT_PRESETS
  | typeof POLICY_DECLINE_PRESETS
  | typeof EVOLUTION_REJECT_PRESETS;

/** A reject prompt over one preset set. Free text is always also accepted. */
function rejectPrompt(presets: PresetSet, copy: TriageCopy): TriageReasonPrompt {
  return {
    on: 'reject',
    title: copy.reasonTitle,
    options: presets.map((p) => ({ id: p.id, label: p.copy(copy), value: p.value })),
    skipLabel: copy.reasonSkip,
    freeText: true,
    placeholder: copy.reasonPlaceholder,
  };
}

/* -------------------------------------------------------------------------- */
/* Reviews                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A review row as the deck needs it: the shared {@link ManualReviewItem} plus
 * the three columns `PersonaManualReview` carries that no shaper in the app used
 * to forward. They are optional so every existing caller still type-checks —
 * only the Monitor's shaper populates them today.
 */
export interface TriageReviewRow extends ManualReviewItem {
  /** Resume-loop link: set when a team step is HELD on this review. */
  assignment_id?: string | null;
  step_id?: string | null;
  /** Capability attribution, inherited from the originating execution. */
  use_case_id?: string | null;
}

/**
 * The case, with the headline removed from it.
 *
 * Every shaper in this repo builds `content` as `title + '\n' + description`,
 * so a card that renders the title as its `<h2>` AND the body as markdown
 * printed the same sentence twice — once large, once as the opening line. The
 * adapter strips it rather than the shaper alone, because three shapers feed
 * this model and only one of them is in this subsystem's reach.
 */
export function bodyWithoutTitle(
  content: string | null | undefined,
  title: string,
): string {
  const text = (content ?? '').trim();
  const head = (title ?? '').trim();
  if (!text || !head) return text;
  if (text === head) return '';
  return text.startsWith(`${head}\n`) ? text.slice(head.length).trimStart() : text;
}

export function reviewToTriage(review: TriageReviewRow, copy: TriageCopy): TriageItem {
  const severity = (review.severity || 'medium').toLowerCase();
  const actions = parseSuggestedActions(review.suggested_actions);
  // `assignment_id` / `step_id` mean a team step is HELD on this verdict.
  const blocking = !!(review.assignment_id || review.step_id);
  // Shapers that had nothing better to put here filled `review_type` with the
  // severity, so the card printed the same word under two labels. Only render a
  // type that is actually a type.
  const reviewType = (review.review_type ?? '').trim();
  const typeLabel =
    reviewType && reviewType.toLowerCase() !== severity ? reviewType.replace(/_/g, ' ') : '';

  const tags: TriageTag[] = [
    { id: 'severity', label: severity, tone: SEVERITY_TONE[severity] ?? 'neutral' },
  ];
  if (typeLabel) tags.push({ id: 'type', label: typeLabel, tone: 'neutral' });
  if (review.source === 'cloud') {
    tags.push({ id: 'source', label: copy.cloud, tone: 'accent' });
  }

  const facts: TriageFact[] = [
    { id: 'severity', label: copy.severity, value: severity, tone: SEVERITY_TONE[severity] ?? 'neutral' },
  ];
  if (typeLabel) facts.push({ id: 'type', label: copy.reviewType, value: typeLabel });
  facts.push(
    { id: 'persona', label: copy.persona, value: review.persona_name || '—' },
    { id: 'raised', label: copy.raised, value: review.created_at },
  );

  // Reading the run is not deciding it — see `TriageLink`.
  const links: TriageLink[] = review.execution_id
    ? [{ id: 'run', label: copy.viewRun, hint: copy.viewRunHint, icon: Terminal }]
    : [];

  return {
    id: `review:${review.id}`,
    sourceId: review.id,
    kind: 'review',
    title: review.title,
    body: bodyWithoutTitle(review.content, review.title) || copy.noDescription,
    evidence: review.context_data,
    tags,
    alert: blocking
      ? {
          id: 'blocking',
          label: copy.blocking,
          detail: copy.blockingDetail,
          tone: 'danger',
          icon: Users,
        }
      : undefined,
    facts,
    links: links.length > 0 ? links : undefined,
    source: {
      label: review.persona_name || copy.persona,
      sublabel: review.source === 'cloud' ? copy.cloud : copy.local,
      color: review.persona_color ?? null,
    },
    createdAt: review.created_at,
    weight: (SEVERITY_WEIGHT[severity] ?? 50) + (blocking ? BLOCKING_WEIGHT_BOOST : 0),
    // Suggested actions are the review's real branches: choosing one resolves
    // the review AND dispatches a follow-up run, which is a materially
    // different act from a bare approval.
    branches: actions.map((action, i) => ({
      id: action,
      label: action,
      tone: 'accent' as const,
      hint: copy.carryOutHint,
      icon: i === 0 ? Play : undefined,
    })),
    // A rejected review writes `reviewer_notes` — the column has always been
    // there and the write path has always forwarded it; nothing ever asked.
    reasonPrompts: [rejectPrompt(REVIEW_REJECT_PRESETS, copy)],
    verdictLabels: { accept: copy.approve, reject: copy.reject, skip: copy.skip },
    // Machine ids the deck's links and any future follow-up need. Never read
    // back out of a fact row — see `TriageItem.payload`.
    payload: {
      executionId: review.execution_id || undefined,
      assignmentId: review.assignment_id ?? undefined,
      stepId: review.step_id ?? undefined,
      useCaseId: review.use_case_id ?? undefined,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Backlog ideas                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The canonical idea categories, as icons.
 *
 * The category earned a whole row in the card's fact ledger to repeat a word
 * that was already sitting in a chip two inches above it. As an icon on that
 * chip it costs nothing and reads faster, which is the row the description gets
 * back. Keyed on the CANONICAL vocabulary (`toCanonicalIdeaCategory` maps the
 * retired functionality/performance/ui/… tokens onto it), so a legacy row still
 * gets its icon instead of falling through to the generic tag.
 */
const CATEGORY_ICON: Record<string, LucideIcon> = {
  technical: Wrench,
  user: Users,
  business: Briefcase,
  mastermind: Brain,
};

export function ideaToTriage(idea: BacklogIdea, copy: TriageCopy): TriageItem {
  const value = triageValueScore(idea);

  // The Strategist's explicit rank. It has always weighted the queue order and
  // has never been SHOWN, so a reviewer had no way to know they were looking at
  // the thing the ranking job said to do next.
  const rank = idea.priority != null ? copy.priorityRank.replace('{rank}', String(idea.priority)) : null;

  const tags: TriageTag[] = [];
  if (rank) {
    tags.push({
      id: 'priority',
      label: rank,
      // Top three is "do this next"; anything further down is context, not a call
      // to action, and painting all of it red would make none of it mean anything.
      tone: idea.priority != null && idea.priority <= 3 ? 'danger' : 'accent',
      icon: ArrowUpNarrowWide,
    });
  }
  tags.push({
    id: 'category',
    label: idea.category,
    tone: 'accent',
    icon: CATEGORY_ICON[toCanonicalIdeaCategory(idea.category) ?? ''] ?? TagIcon,
  });
  if (idea.origin) tags.push({ id: 'origin', label: idea.origin.replace(/_/g, ' '), tone: 'warning' });
  if (idea.verifyState) tags.push({ id: 'verify', label: idea.verifyState, tone: 'neutral' });

  const facts: TriageFact[] = [];
  if (rank) facts.push({ id: 'priority', label: copy.priority, value: rank, tone: 'accent' });
  facts.push(
    { id: 'project', label: copy.project, value: idea.projectName || '—' },
    { id: 'category', label: copy.category, value: idea.category },
    {
      id: 'origin',
      label: copy.origin,
      value: idea.origin ? idea.origin.replace(/_/g, ' ') : copy.scanner,
    },
    { id: 'impact', label: copy.impact, value: String(idea.impact), score: { value: idea.impact, max: 10 } },
    {
      id: 'effort',
      label: copy.effort,
      value: String(idea.effort),
      score: { value: idea.effort, max: 10, invert: true },
    },
    {
      id: 'risk',
      label: copy.risk,
      value: String(idea.risk),
      score: { value: idea.risk, max: 10, invert: true },
    },
    { id: 'value', label: copy.value, value: String(value), tone: value > 0 ? 'success' : 'neutral' },
    { id: 'raised', label: copy.raised, value: idea.createdAt },
  );

  // Value score (roughly -18..+18) recentred onto a 12..48 band, then boosted
  // by the Strategist's explicit rank when it set one. An idea therefore never
  // outranks a real incident, but a high-value quick win beats a stale one.
  const priorityBoost = idea.priority != null ? Math.max(0, 20 - idea.priority) : 0;

  return {
    id: `idea:${idea.id}`,
    sourceId: idea.id,
    kind: 'idea',
    title: idea.title,
    body: idea.description || copy.noDescription,
    reasoning: idea.reasoning || undefined,
    evidence: prettyEvidence(idea.evidence),
    tags,
    facts,
    source: { label: idea.projectName || copy.project, sublabel: idea.scanType },
    createdAt: idea.createdAt,
    weight: 30 + value + priorityBoost,
    branches: [
      { id: 'build', label: copy.buildNow, tone: 'success', hint: copy.buildNowHint, icon: Hammer },
    ],
    // The highest-leverage reason in the app: the backend turns a rejected
    // idea's reason into a `constraint` memory, so a scan that would otherwise
    // re-raise this finding next week stops raising it at all.
    reasonPrompts: [rejectPrompt(IDEA_REJECT_PRESETS, copy)],
    verdictLabels: { accept: copy.accept, reject: copy.reject, skip: copy.skip },
    // `seenStatus` is what the CARD claims this row is. It rides to the backend
    // as the compare-and-swap expectation, so a verdict decided on a card that
    // someone else (or Athena, overnight) has already ruled on loses loudly
    // instead of overwriting them and firing a second decision-memory fan-out.
    payload: { projectId: idea.projectId, seenStatus: idea.status },
  };
}

/* -------------------------------------------------------------------------- */
/* Workspace practices                                                         */
/* -------------------------------------------------------------------------- */

export function practiceToTriage(
  practice: KnowledgeItemView,
  workspaceName: string,
  detailMd: string | null,
  copy: TriageCopy,
  /**
   * What an adopt would actually touch (see `triageReach`). Optional because
   * the workspace membership lives in app state and the model layer does not:
   * callers without it get a card that simply doesn't claim a blast radius,
   * rather than one that claims the wrong one.
   */
  reach?: AdoptReach,
  /**
   * Practices this one could be deprecated IN FAVOUR OF — `decide_knowledge`
   * takes a `superseded_by` id, and nothing has ever supplied one. Empty means
   * the deprecate branch stays a plain deprecate.
   */
  successors: readonly { id: string; title: string }[] = [],
): TriageItem {
  const tags: TriageTag[] = [
    { id: 'kind', label: practice.kind, tone: practice.kind === 'pitfall' ? 'warning' : 'accent' },
    { id: 'status', label: practice.status, tone: 'neutral' },
  ];
  if (practice.durability) tags.push({ id: 'durability', label: practice.durability, tone: 'neutral' });

  const facts: TriageFact[] = [
    { id: 'workspace', label: copy.workspace, value: workspaceName },
    { id: 'topic', label: copy.topic, value: practice.topic || '—' },
    { id: 'kind', label: copy.practiceKind, value: practice.kind },
  ];
  if (practice.abstraction) {
    facts.push({ id: 'altitude', label: copy.altitude, value: practice.abstraction });
  }
  if (practice.durability) {
    facts.push({ id: 'durability', label: copy.durability, value: practice.durability });
  }
  if (practice.confidence != null) {
    facts.push({
      id: 'confidence',
      label: copy.confidence,
      value: `${Math.round(practice.confidence * 100)}%`,
      score: { value: practice.confidence, max: 1 },
    });
  }
  if (practice.evidenceCount != null && practice.evidenceCount > 1) {
    facts.push({
      id: 'evidence',
      label: copy.evidenceSeen,
      value: `${practice.evidenceCount}×`,
      tone: 'success',
    });
  }
  // Applicability was parsed and thrown away (`libraryModel.viewFromRow`), yet
  // it is precisely what decides whether an adopt reaches a given repo.
  const appliesTo = [...practice.layers, ...practice.frameworks];
  facts.push({
    id: 'applies',
    label: copy.appliesTo,
    value: appliesTo.length > 0 ? appliesTo.join(', ') : copy.appliesToAny,
  });
  // Adopting is a fan-out, not a note to self: it seeds an adoption cell in
  // every applicable member repo. The card now says how many that is.
  if (reach) {
    facts.push({
      id: 'reach',
      label: copy.adoptReach,
      value: copy.adoptReachValue
        .replace('{applicable}', String(reach.applicable))
        .replace('{total}', String(reach.members)),
      tone: reach.applicable > 0 ? 'accent' : 'neutral',
    });
  }
  facts.push({ id: 'raised', label: copy.raised, value: practice.createdAt });

  // Confidence and corroboration are the whole case for a mined practice: one
  // repo saying something is an opinion, six repos saying it is a convention.
  const corroboration = Math.min((practice.evidenceCount ?? 1) - 1, 5) * 4;
  const weight = 25 + (practice.confidence ?? 0.5) * 30 + corroboration;

  return {
    id: `practice:${practice.id}`,
    sourceId: practice.id,
    kind: 'practice',
    title: practice.title,
    body: practice.statement || copy.noDescription,
    reasoning: detailMd || undefined,
    tags,
    facts,
    source: { label: workspaceName, sublabel: practice.topic || undefined },
    createdAt: practice.createdAt,
    weight,
    branches: [
      { id: 'deprecate', label: copy.deprecate, tone: 'neutral', hint: copy.deprecateHint, icon: Archive },
    ],
    // Practices have NO reject-reason column, so rejecting one asks nothing —
    // a prompt whose answer is thrown away is worse than no prompt. Deprecating
    // one, on the other hand, has always been able to record a successor.
    reasonPrompts:
      successors.length > 0
        ? [
            {
              on: 'deprecate',
              title: copy.supersededTitle,
              // The write is an id, not prose, so `value` is the successor's id
              // while the label is its human title.
              options: successors.map((s) => ({ id: s.id, label: s.title, value: s.id })),
              skipLabel: copy.supersededSkip,
              freeText: false,
            },
          ]
        : undefined,
    verdictLabels: { accept: copy.adopt, reject: copy.reject, skip: copy.skip },
    // See the idea adapter: the status the card claims becomes the write's
    // compare-and-swap expectation. It matters more here — a stale `adopt` fans
    // an adoption cell into every applicable member repo.
    payload: { seenStatus: practice.status },
  };
}

/* -------------------------------------------------------------------------- */
/* Build questions                                                             */
/* -------------------------------------------------------------------------- */

/** A question needing the full builder (connector picker / file attach). */
export function isDeferredQuestion(q: BuildQuestion): boolean {
  return !!(q.connectorCategory || q.acceptsReference || q.acceptsWebhookSource);
}

/** One halted build session and everything it is still waiting on. */
export interface QuestionSession {
  sessionId: string;
  personaId: string;
  personaName: string;
  personaColor: string | null;
  questions: BuildQuestion[];
}

/** One field per pending question, in ask order. */
function toField(question: BuildQuestion, copy: TriageCopy): TriageQuestionField {
  const deferred = isDeferredQuestion(question);
  return {
    key: question.cellKey,
    prompt: question.question,
    kind: !deferred && question.options && question.options.length > 0 ? 'choice' : 'text',
    options: deferred ? undefined : question.options ?? undefined,
    suggestions: deferred ? undefined : question.suggested,
    placeholder: copy.answerPlaceholder,
    deferred,
  };
}

/**
 * ONE card per build SESSION, carrying every question that session is still
 * waiting on.
 *
 * The granularity is the point. `answer_build_question` RESUMES the halted CLI,
 * so answering three questions as three cards resumed the same build three
 * times — three CLI turns, three chances to diverge, and the `_batch` payload
 * (`lib/build/answerPayload`) reduced to a one-line batch each time. The whole
 * reason that payload format exists is to resume once with everything.
 *
 * The id folds in the pending cell keys, not just the session: when a session's
 * pending set changes (some answered here, more raised by the CLI) that is a
 * genuinely different card, and it must not be mistaken for one the session
 * already resolved.
 *
 * Returns null for a session with nothing pending — never an empty card.
 */
export function questionGroupToTriage(
  session: QuestionSession,
  copy: TriageCopy,
): TriageItem | null {
  const questions = session.questions;
  const [first] = questions;
  if (!first) return null;

  const fields = questions.map((q) => toField(q, copy));
  // A card is deferred only when NOT ONE field can be answered here. A mixed
  // session is answerable: the reviewer fills what they can and the picker-only
  // ones stay pending, coming back as their own card on the next poll.
  const allDeferred = fields.every((f) => f.deferred);
  const anyDeferred = fields.some((f) => f.deferred);

  const keys = questions.map((q) => q.cellKey);
  const tags: TriageTag[] = questions.map((q) => ({
    id: `cell:${q.cellKey}`,
    label: q.cellKey.replace(/_/g, ' '),
    tone: q.connectorCategory ? 'warning' : 'accent',
  }));

  return {
    id: `question:${session.sessionId}:${[...keys].sort().join('|')}`,
    sourceId: session.sessionId,
    kind: 'question',
    // A build question IS its title. With several, the title is the ask itself
    // and the questions render as the card's fields.
    title:
      questions.length === 1
        ? first.question
        : copy.questionsPending.replace('{count}', String(questions.length)),
    body: '',
    tags,
    facts: [
      { id: 'persona', label: copy.persona, value: session.personaName },
      { id: 'questions', label: copy.questionsFact, value: String(questions.length) },
    ],
    source: { label: session.personaName, color: session.personaColor },
    createdAt: new Date(0).toISOString(),
    weight: QUESTION_WEIGHT,
    branches: anyDeferred
      ? [
          {
            id: 'builder',
            label: copy.openBuilder,
            tone: 'accent',
            hint: copy.openBuilderHint,
            icon: ExternalLink,
          },
        ]
      : [],
    input: { fields, deferred: allDeferred },
    verdictLabels: { accept: copy.submit, reject: copy.skip, skip: copy.defer },
    payload: { sessionId: session.sessionId, personaId: session.personaId },
  };
}

/* -------------------------------------------------------------------------- */
/* Policy proposals (Self-Tuning Fabric)                                       */
/* -------------------------------------------------------------------------- */

const usd = (v: number) => `$${v.toFixed(2)}`;
const signedPct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

/**
 * A tuning proposal as a triage card.
 *
 * The fit is close to exact: the Fabric is a two-verdict queue by design
 * ("review-each only — the ONLY policy writer is `policy_tuning_apply`"), and a
 * decline already had a reason column that the settings history renders
 * verbatim. So this adapter adds nothing to the domain; it only re-expresses a
 * queue that was already shaped like the spine.
 *
 * The one editorial call is the ALERT. A routing proposal's quality delta is
 * buried in the settings list as a caption under the claim, and it is the fact
 * that changes what applying MEANS: a proposal that is cheaper AND better is a
 * yes, and a proposal that is cheaper and worse is a trade the reviewer has to
 * actually make. Negative delta is promoted out of the ledger; positive stays a
 * fact, because a surface with an alert on every card has none.
 */
export function policyProposalToTriage(proposal: PolicyProposal, copy: TriageCopy): TriageItem {
  const routing = proposal.routing;
  const budget = proposal.budget;
  const isRouting = proposal.kind === 'routing_rule' && !!routing;
  const isBudget = proposal.kind === 'budget_ceiling' && !!budget;

  const tags: TriageTag[] = [
    {
      id: 'kind',
      label: isBudget ? copy.policyKindBudget : copy.policyKindRouting,
      tone: isBudget ? 'warning' : 'accent',
    },
  ];
  if (routing?.category) tags.push({ id: 'category', label: routing.category, tone: 'neutral' });

  const facts: TriageFact[] = [];
  let title = proposal.kind.replace(/_/g, ' ');
  let body = '';
  let alert: TriageItem['alert'];

  if (isRouting && routing) {
    const claim = routing.claim;
    const from = routing.fromModel ?? '—';
    const category = routing.category ?? '*';
    const basis = claim.qualityBasis === 'lab' ? copy.basisLab : copy.basisSuccess;

    title = fill(copy.policyRoutingTitle, { category, to: routing.toModel });
    body = fill(copy.policyRoutingBody, {
      category,
      from,
      to: routing.toModel,
      saving: usd(claim.projectedMonthlySavingUsd),
      pct: `${Math.round(claim.savingPct * 100)}%`,
    });

    facts.push({
      id: 'saving',
      label: copy.saving,
      value: fill(copy.savingValue, { amount: usd(claim.projectedMonthlySavingUsd) }),
      // The meter is the RELATIVE saving, not the dollars: "$4/mo" means nothing
      // without knowing whether that is 4% or 90% of the category's spend.
      score: { value: claim.savingPct, max: 1 },
    });
    facts.push(
      { id: 'from', label: copy.fromModel, value: from },
      { id: 'to', label: copy.toModel, value: routing.toModel },
      {
        id: 'quality',
        label: copy.qualityDelta,
        value: signedPct(claim.qualityDeltaPct),
        tone: claim.qualityDeltaPct < 0 ? 'danger' : claim.qualityDeltaPct > 0 ? 'success' : 'neutral',
      },
      { id: 'basis', label: copy.qualityBasis, value: basis },
      {
        id: 'runs',
        label: copy.runs,
        value: fill(copy.runsValue, {
          incumbent: claim.incumbentRuns,
          challenger: claim.challengerRuns,
        }),
      },
    );

    if (claim.qualityDeltaPct < 0) {
      alert = {
        id: 'quality',
        label: copy.policyQualityDrop,
        detail: fill(copy.policyQualityDropDetail, {
          delta: signedPct(claim.qualityDeltaPct),
          basis,
        }),
        tone: 'warning',
      };
    }
  } else if (isBudget && budget) {
    const ceiling = budget.currentCeilingUsd > 0 ? usd(budget.currentCeilingUsd) : copy.noCeiling;
    title = fill(
      budget.direction === 'introduce'
        ? copy.policyBudgetIntroduceTitle
        : budget.direction === 'raise'
          ? copy.policyBudgetRaiseTitle
          : copy.policyBudgetLowerTitle,
      { proposed: usd(budget.proposedCeilingUsd) },
    );
    body = fill(copy.policyBudgetBody, {
      observed: usd(budget.observedMonthlySpendUsd),
      rows: budget.spendRows,
      current: ceiling,
    });

    facts.push({
      id: 'spend',
      label: copy.observedSpend,
      value: usd(budget.observedMonthlySpendUsd),
      // Inverted on purpose: this meter reads "how much of the PROPOSED ceiling
      // today's spend already uses", and a bar that is nearly full is the bad
      // news. Without the flip a proposal that barely contains the spend would
      // paint green.
      score: {
        value: budget.observedMonthlySpendUsd,
        max: Math.max(budget.proposedCeilingUsd, budget.observedMonthlySpendUsd, 0.01),
        invert: true,
      },
    });
    facts.push(
      { id: 'ceiling', label: copy.ceiling, value: ceiling },
      { id: 'proposed', label: copy.proposedCeiling, value: usd(budget.proposedCeilingUsd) },
      { id: 'runs', label: copy.runs, value: String(budget.spendRows) },
    );
  }

  facts.push({ id: 'raised', label: copy.raised, value: proposal.createdAt });

  return {
    id: `policy:${proposal.id}`,
    sourceId: proposal.id,
    kind: 'policy',
    title,
    body: body || copy.noDescription,
    // The persisted snapshot slice IS the case. It is what the settings
    // section's evidence drawer shows, and the deck already has a monospace
    // block for exactly this.
    evidence: prettyEvidence(JSON.stringify(proposal.evidence)),
    tags,
    alert,
    facts,
    source: { label: copy.policySource, sublabel: proposal.evidenceSnapshotId },
    createdAt: proposal.createdAt,
    weight: isBudget ? POLICY_BUDGET_WEIGHT : POLICY_ROUTING_WEIGHT,
    // No branches: the Fabric offers exactly two acts, and inventing a third
    // here would need a second policy writer, which its contract forbids.
    branches: [],
    reasonPrompts: [rejectPrompt(POLICY_DECLINE_PRESETS, copy)],
    verdictLabels: { accept: copy.policyApply, reject: copy.policyDecline, skip: copy.skip },
    payload: { seenStatus: proposal.status, policyKind: proposal.kind },
  };
}

/* -------------------------------------------------------------------------- */
/* Evolution promotion proposals (Darwin Mode)                                 */
/* -------------------------------------------------------------------------- */

/**
 * A promotion proposal as a triage card.
 *
 * This is the richest facts payload in the app — four measured values on one
 * comparable scale — and it is the only decidable row carrying a real
 * optimistic-lock token. Both shape the card:
 *
 *  • **Four meters, two scales.** Incumbent and challenger are fitness scores in
 *    `0..1`, so they share the natural scale and read as a direct comparison.
 *    Gain and bar are DELTAS on that scale — tiny next to it (a 3-point gain is
 *    `0.03`) — so they get their own shared scale, sized to whichever is larger.
 *    Putting all four on `0..1` would have flattened the only two numbers the
 *    decision actually turns on into invisible slivers.
 *  • **The lock is the alert.** `baseUpdatedAt` is not a display fact; it is the
 *    reason this card can stop being decidable while the reviewer looks at it.
 *    Every other row in the deck can be decided late. This one can expire.
 */
export function evolutionProposalToTriage(
  proposal: EvolutionPromotionProposal,
  /**
   * Resolved persona name. Empty is tolerated and falls back to the id: the
   * roster is loaded by a different store on a different clock, and a card
   * titled "Promote the evolved " names nothing at all.
   */
  personaName: string,
  personaColor: string | null,
  copy: TriageCopy,
): TriageItem {
  const owner = personaName.trim() || proposal.personaId;
  const { incumbentScore, winnerScore, improvement, threshold } = proposal;
  // One scale for the two deltas, headroom so a winner that beat the bar
  // outright still has bar left to show for it.
  const deltaScale = Math.max(improvement, threshold, 0.01) * 1.25;
  const points = (v: number) =>
    fill(copy.points, { value: `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}` });

  const facts: TriageFact[] = [
    {
      id: 'incumbent',
      label: copy.incumbentScore,
      value: `${Math.round(incumbentScore * 100)}%`,
      score: { value: incumbentScore, max: 1 },
    },
    {
      id: 'winner',
      label: copy.winnerScore,
      value: `${Math.round(winnerScore * 100)}%`,
      score: { value: winnerScore, max: 1 },
    },
    {
      id: 'gain',
      label: copy.gain,
      value: points(improvement),
      score: { value: improvement, max: deltaScale },
    },
    {
      id: 'bar',
      label: copy.bar,
      value: points(threshold),
      // NOT inverted, and that is the judgement: a LOW bar is weak evidence, not
      // good news. A challenger that cleared a demanding threshold and one that
      // cleared a token threshold are different cases, and the meter says which
      // by painting a low bar amber.
      score: { value: threshold, max: deltaScale },
    },
    { id: 'fitness', label: copy.fitnessSource, value: proposal.fitnessSource },
    { id: 'lockedAt', label: copy.evolutionLockFact, value: proposal.baseUpdatedAt },
    { id: 'raised', label: copy.raised, value: proposal.createdAt },
  ];

  const margin = Math.min(
    EVOLUTION_MARGIN_MAX,
    Math.max(0, Math.round((improvement - threshold) * 100)),
  );

  return {
    id: `evolution:${proposal.id}`,
    sourceId: proposal.id,
    kind: 'evolution',
    title: fill(copy.evolutionTitle, { persona: owner }),
    // The reassembled prompt IS the case being judged — approving installs
    // exactly this text.
    body: proposal.newPrompt.trim() || copy.noDescription,
    evidence: prettyEvidence(proposal.evidenceJson),
    tags: [
      { id: 'measured', label: copy.evolutionMeasured, tone: 'success' },
      { id: 'fitness', label: proposal.fitnessSource, tone: 'neutral' },
    ],
    alert: {
      id: 'lock',
      label: copy.evolutionLock,
      detail: copy.evolutionLockDetail,
      tone: 'warning',
      icon: Lock,
    },
    facts,
    source: { label: owner, sublabel: copy.evolutionSource, color: personaColor },
    createdAt: proposal.createdAt,
    weight: EVOLUTION_BASE + margin,
    branches: [],
    // A rejected promotion writes `decision_note` — the only signal a Darwin
    // cycle ever gets back from a human.
    reasonPrompts: [rejectPrompt(EVOLUTION_REJECT_PRESETS, copy)],
    verdictLabels: { accept: copy.promote, reject: copy.reject, skip: copy.skip },
    // `baseUpdatedAt` rides as payload rather than as a write argument: the
    // command reads the token off the stored row, so the client cannot stale it.
    // See `decideEvolutionProposalRow`.
    payload: {
      seenStatus: proposal.status,
      personaId: proposal.personaId,
      cycleId: proposal.cycleId,
      baseUpdatedAt: proposal.baseUpdatedAt,
    },
  };
}
