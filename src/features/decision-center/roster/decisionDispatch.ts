/**
 * decisionDispatch — one decision in, one backend write out, for every kind
 * the roster deals.
 *
 * The six triage kinds are not re-routed here: they delegate to the deck's own
 * `routeDecision`, so a verdict on an idea writes through exactly one router
 * whichever surface it was taken on. The five new kinds route to their doors in
 * `lib/decisions/rowWrites` (or, for chat, to the slice's seen watermark).
 *
 * Same contract as `triageDispatch`, and for the same reason:
 *
 *   **Every decision either DEFERS, or WRITES, or THROWS. Never nothing.**
 *
 * The roster removes an item optimistically, so a branch that matched nothing
 * would read as a landed verdict while the backend still holds the row.
 *
 * React-free and store-free: every write arrives in {@link DecisionPorts}.
 */
import {
  isDeferral,
  routeDecision,
  type TriagePorts,
} from '@/features/agents/quick-answer/triage/triageDispatch';
import type {
  TriageDecision,
  TriageItem,
  TriageKind,
} from '@/features/agents/quick-answer/triage/triageTypes';
import type { IncidentAct } from '@/lib/decisions/rowWrites';

import type { DecisionItem, DecisionKind } from '../model/decisionModel';
import { COUNCIL_MIN_REASON } from './decisionCopy';

/** A decision on any roster item — the roster's `decide` argument. */
export type RosterDecision = Omit<TriageDecision, 'item'> & { item: DecisionItem };

/** Every write a decision can reach, injected. */
export interface DecisionPorts {
  /** The deck's bundle — reached only through `routeDecision`. */
  triage: TriagePorts;
  resolveIncident: (id: string, act: IncidentAct, note?: string) => Promise<void>;
  markReportRead: (id: string) => Promise<void>;
  decideCouncil: (
    subjectId: string,
    runId: string,
    verdict: 'approved' | 'rejected',
    sawDigest: string,
    reason?: string,
  ) => Promise<unknown>;
  decideApproval: (id: string, approve: boolean, reason?: string) => Promise<unknown>;
  /** Advance a thread's seen watermark. `channelKey` is `team:<id>` | `persona:<id>`. */
  markThreadSeen: (channelKey: string) => Promise<void>;
  /** Deep-link to a persona's chat. Absent when the host has no route. */
  openChat?: (personaId: string) => void;
}

const TRIAGE_KINDS: ReadonlySet<DecisionKind> = new Set<TriageKind>([
  'review',
  'idea',
  'question',
  'policy',
  'evolution',
  'goal',
]);

/** True for the six kinds the triage deck already routes. */
export function isTriageKind(kind: DecisionKind): kind is TriageKind {
  return TRIAGE_KINDS.has(kind);
}

/**
 * Narrow a decision on a triage kind back to the deck's own shape.
 *
 * No assertion: once `kind` is narrowed, the item IS structurally a
 * `TriageItem` — the kind is the whole difference (`DecisionItem` is
 * `TriageItem` with a wider `kind` plus optional fields the deck ignores).
 */
function asTriageDecision(decision: RosterDecision): TriageDecision | null {
  const { item } = decision;
  if (!isTriageKind(item.kind)) return null;
  const narrowed: TriageItem = { ...item, kind: item.kind };
  return { ...decision, item: narrowed };
}

/**
 * True when this decision writes nothing and the item must STAY — a skip, or
 * any of the deck's own deferrals (see `triageDispatch#isDeferral`).
 */
export function isRosterDeferral(decision: RosterDecision): boolean {
  const triage = asTriageDecision(decision);
  if (triage) return isDeferral(triage);
  return decision.verdict === 'skip' && !decision.branchId;
}

/** Incident branches that move the row WITHOUT closing it. */
const NON_TERMINAL_INCIDENT_ACTS: ReadonlySet<string> = new Set(['acknowledge', 'start']);

/**
 * True when a landed decision takes the item OUT of the queue.
 *
 * Acknowledging an incident or starting work on it is a real write, but the
 * incident is still open and still counted — removing it optimistically would
 * show it leave and come back on the next read. Those acts update the item in
 * place (by re-reading its source) instead.
 */
export function leavesQueue(decision: RosterDecision): boolean {
  const { item, branchId } = decision;
  return !(item.kind === 'incident' && branchId && NON_TERMINAL_INCIDENT_ACTS.has(branchId));
}

function requirePayload(item: DecisionItem, key: string, what: string): string {
  const value = item.payload?.[key];
  if (!value) throw new Error(`This ${item.kind} cannot be decided: ${what} is missing`);
  return value;
}

/**
 * Perform the write behind a decision. Callers MUST have already excluded
 * deferrals via {@link isRosterDeferral}. Throws when it cannot be honoured.
 */
export async function routeDecisionItem(
  decision: RosterDecision,
  ports: DecisionPorts,
): Promise<void> {
  const triage = asTriageDecision(decision);
  if (triage) {
    await routeDecision(triage, ports.triage);
    return;
  }

  const { item, verdict, branchId, reason } = decision;
  switch (item.kind) {
    case 'incident': {
      if (branchId) {
        if (!NON_TERMINAL_INCIDENT_ACTS.has(branchId)) {
          throw new Error(`Unknown incident act: ${branchId}`);
        }
        await ports.resolveIncident(item.sourceId, branchId as IncidentAct);
        return;
      }
      await ports.resolveIncident(item.sourceId, verdict === 'accept' ? 'resolve' : 'dismiss', reason);
      return;
    }

    case 'report': {
      if (branchId && branchId !== 'chat') throw new Error(`Unknown report act: ${branchId}`);
      if (branchId === 'chat') {
        // Following up IS reading it. The route is checked before the write,
        // so a host with no chat route fails without retiring the report.
        const personaId = requirePayload(item, 'personaId', 'the persona');
        if (!ports.openChat) throw new Error('No chat route available for this report');
        await ports.markReportRead(item.sourceId);
        ports.openChat(personaId);
        return;
      }
      await ports.markReportRead(item.sourceId);
      return;
    }

    case 'council': {
      if (branchId) throw new Error(`Unknown council act: ${branchId}`);
      const runId = requirePayload(item, 'runId', 'the run');
      const sawDigest = requirePayload(item, 'sawDigest', 'the round on screen');
      // Worded as the backend's own refusal so it reads as the same conflict:
      // a superseded round can never be decided, whoever asks.
      if (item.payload?.isLatest === 'false') {
        throw new Error('The council moved since you looked');
      }
      if (verdict === 'accept') {
        await ports.decideCouncil(item.sourceId, runId, 'approved', sawDigest);
        return;
      }
      const written = (reason ?? '').trim();
      if (written.length < COUNCIL_MIN_REASON) {
        throw new Error(`A council rejection needs at least ${COUNCIL_MIN_REASON} characters of reason`);
      }
      await ports.decideCouncil(item.sourceId, runId, 'rejected', sawDigest, written);
      return;
    }

    case 'approval': {
      if (branchId) throw new Error(`Unknown approval act: ${branchId}`);
      await ports.decideApproval(item.sourceId, verdict === 'accept', reason);
      return;
    }

    case 'message': {
      if (branchId) throw new Error(`Unknown message act: ${branchId}`);
      await ports.markThreadSeen(requirePayload(item, 'channelKey', 'the thread'));
      return;
    }

    default:
      throw new Error(`No route for a ${item.kind} decision`);
  }
}
