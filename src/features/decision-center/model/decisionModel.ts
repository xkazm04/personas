/**
 * decisionModel — the Decision Center's one item contract.
 *
 * The Decision Center fuses every "a human should look at this" source into one
 * roster: the six queues the triage deck already speaks (`TriageKind`) plus the
 * five that never reached it — incidents, unread reports, council subjects,
 * chat threads awaiting a reply, and Athena's companion approvals.
 *
 * `DecisionItem` is a `TriageItem` with a wider `kind` and two optional
 * payloads the new kinds need: a `document` (reports, council) and a `thread`
 * (chat). Everything else — facts, tags, alert, branches, reason prompts,
 * verdict labels, payload ids — is the triage model unchanged, so a triage
 * adapter's output IS a decision item and the deck's machinery carries over.
 *
 * The kind set is a SUPERSET of `TriageKind` on purpose rather than an edit to
 * it: the title-bar deck that owns `TriageKind` retires once the Decision
 * Center's modal lands, and teaching a retiring surface five new kinds would
 * be churn with no reader.
 *
 * Chip, tier and modal type are pure functions of the item, never stored
 * fields — one law each, so no adapter can disagree with the strip about where
 * its item belongs.
 *
 * React-free and store-free.
 */
import type {
  TriageItem,
  TriageKind,
  TriageTone,
} from '@/features/agents/quick-answer/triage/triageTypes';

/** Every kind the roster carries. */
export type DecisionKind =
  | TriageKind
  | 'incident'
  | 'report'
  | 'council'
  | 'message'
  | 'approval';

/** The seven decision chips on the CommandBar strip, in strip order. */
export type DecisionChip =
  | 'gates'
  | 'proposals'
  | 'backlog'
  | 'incidents'
  | 'council'
  | 'reports'
  | 'chat';

/** Chips plus the non-decision `ready` chip (accepted ideas awaiting dispatch). */
export type HubChip = DecisionChip | 'ready';

export const DECISION_CHIPS: readonly DecisionChip[] = [
  'gates',
  'proposals',
  'backlog',
  'incidents',
  'council',
  'reports',
  'chat',
];

/** The four shapes of the shared modal. */
export type DecisionModalType = 'backlog' | 'approval' | 'report' | 'chat';

/**
 * Queue tier — the first key of the cross-type order.
 *  1 blocking: holds real work (a review on a held team step, critical/high
 *    incidents, companion approvals).
 *  2 decide:   council, proposals, other reviews, backlog, questions.
 *  3 read/reply: chat awaiting you, reports.
 */
export type DecisionTier = 1 | 2 | 3;

/** A long-form document attached to a report or council item. */
export interface DecisionDocument {
  /** `html` is rendered sanitized in a script-free sandboxed frame. */
  format: 'markdown' | 'html';
  content: string;
  /** Optional media resolver key: council run dir, report id. Opaque. */
  mediaScope?: string | null;
}

export interface DecisionThreadMessage {
  id: string;
  author: 'user' | 'persona' | 'athena';
  /** Display name, pre-resolved. */
  name: string;
  /** Markdown. */
  body: string;
  /** RFC3339. */
  at: string;
}

/** A chat thread awaiting the user. Messages oldest-first, tail only. */
export interface DecisionThread {
  /** `team:<teamId>` | `persona:<personaId>` — the write target. */
  channelKey: string;
  messages: DecisionThreadMessage[];
  /** False when the channel cannot take a reply from here (deep-link only). */
  canReply: boolean;
}

export interface DecisionItem extends Omit<TriageItem, 'kind'> {
  kind: DecisionKind;
  document?: DecisionDocument;
  thread?: DecisionThread;
  /** Severity as the source states it, lowercased; drives tier 1 for incidents. */
  severity?: string | null;
}

/** One chip's count. `failed` = the source did not answer; never shown as 0. */
export interface ChipCount {
  n: number;
  lamp: TriageTone;
  failed: boolean;
}

const CHIP_OF: Record<DecisionKind, DecisionChip> = {
  review: 'gates',
  question: 'gates',
  approval: 'gates',
  policy: 'proposals',
  evolution: 'proposals',
  goal: 'proposals',
  idea: 'backlog',
  incident: 'incidents',
  council: 'council',
  report: 'reports',
  message: 'chat',
};

export function chipOf(kind: DecisionKind): DecisionChip {
  return CHIP_OF[kind];
}

const MODAL_OF: Record<DecisionKind, DecisionModalType> = {
  idea: 'backlog',
  review: 'approval',
  question: 'approval',
  approval: 'approval',
  policy: 'approval',
  evolution: 'approval',
  goal: 'approval',
  incident: 'approval',
  report: 'report',
  council: 'report',
  message: 'chat',
};

export function modalTypeOf(kind: DecisionKind): DecisionModalType {
  return MODAL_OF[kind];
}
