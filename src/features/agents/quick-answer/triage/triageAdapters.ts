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
import { Hammer, ExternalLink, Archive, Play } from 'lucide-react';

import { parseSuggestedActions } from '@/lib/reviews/suggestedActions';
import type { ManualReviewItem } from '@/lib/types/types';
import type { BuildQuestion } from '@/lib/types/buildTypes';
import type { KnowledgeItemView } from '@/features/overview/sub_patterns/libraryModel';
import {
  prettyEvidence,
  triageValueScore,
  type BacklogIdea,
} from '@/features/overview/sub_manual-review/components/backlog/backlogModel';

import type {
  TriageItem,
  TriageTag,
  TriageFact,
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

/* -------------------------------------------------------------------------- */
/* Reviews                                                                     */
/* -------------------------------------------------------------------------- */

export function reviewToTriage(review: ManualReviewItem, copy: TriageCopy): TriageItem {
  const severity = (review.severity || 'medium').toLowerCase();
  const actions = parseSuggestedActions(review.suggested_actions);

  const tags: TriageTag[] = [
    { id: 'severity', label: severity, tone: SEVERITY_TONE[severity] ?? 'neutral' },
  ];
  if (review.review_type) {
    tags.push({ id: 'type', label: review.review_type.replace(/_/g, ' '), tone: 'neutral' });
  }
  if (review.source === 'cloud') {
    tags.push({ id: 'source', label: copy.cloud, tone: 'accent' });
  }

  const facts: TriageFact[] = [
    { id: 'severity', label: copy.severity, value: severity, tone: SEVERITY_TONE[severity] ?? 'neutral' },
    { id: 'type', label: copy.reviewType, value: review.review_type?.replace(/_/g, ' ') || '—' },
    { id: 'persona', label: copy.persona, value: review.persona_name || '—' },
    { id: 'raised', label: copy.raised, value: review.created_at },
  ];

  return {
    id: `review:${review.id}`,
    sourceId: review.id,
    kind: 'review',
    title: review.title,
    body: review.content || copy.noDescription,
    evidence: review.context_data,
    tags,
    facts,
    source: {
      label: review.persona_name || copy.persona,
      sublabel: review.source === 'cloud' ? copy.cloud : copy.local,
      color: review.persona_color ?? null,
    },
    createdAt: review.created_at,
    weight: SEVERITY_WEIGHT[severity] ?? 50,
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
    verdictLabels: { accept: copy.approve, reject: copy.reject, skip: copy.skip },
  };
}

/* -------------------------------------------------------------------------- */
/* Backlog ideas                                                               */
/* -------------------------------------------------------------------------- */

export function ideaToTriage(idea: BacklogIdea, copy: TriageCopy): TriageItem {
  const value = triageValueScore(idea);

  const tags: TriageTag[] = [{ id: 'category', label: idea.category, tone: 'accent' }];
  if (idea.origin) tags.push({ id: 'origin', label: idea.origin.replace(/_/g, ' '), tone: 'warning' });
  if (idea.verifyState) tags.push({ id: 'verify', label: idea.verifyState, tone: 'neutral' });

  const facts: TriageFact[] = [
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
  ];

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
    verdictLabels: { accept: copy.accept, reject: copy.reject, skip: copy.skip },
    payload: { projectId: idea.projectId },
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
    // No payload: `decideWorkspaceKnowledge` needs only the practice id, which
    // is already `sourceId`.
    verdictLabels: { accept: copy.adopt, reject: copy.reject, skip: copy.skip },
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
