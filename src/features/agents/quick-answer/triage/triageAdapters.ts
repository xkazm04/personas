/**
 * triageAdapters.ts — four source shapes in, one {@link TriageItem} out.
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
import { Hammer, ExternalLink, Archive, Play, ArrowUpNarrowWide, Terminal, Users } from 'lucide-react';

import { parseSuggestedActions } from '@/lib/reviews/suggestedActions';
import type { ManualReviewItem } from '@/lib/types/types';
import type { BuildQuestion } from '@/lib/types/buildTypes';
import type { KnowledgeItemView } from '@/features/overview/sub_patterns/libraryModel';
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
};

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

type PresetSet = typeof REVIEW_REJECT_PRESETS | typeof IDEA_REJECT_PRESETS;

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
  tags.push({ id: 'category', label: idea.category, tone: 'accent' });
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
