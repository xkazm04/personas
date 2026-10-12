/**
 * rosterDecisions — the Decision Center roster's items, as orb decisions.
 *
 * The orb used to keep its own FIFO of approvals, blocking incidents and
 * pending reviews, fetched on every pump. Those three kinds now come from the
 * ONE roster (`useDecisionRoster`) in the roster's order (`compareDecision`),
 * and every verdict the orb takes on them is the roster's `decide` — the same
 * `rowWrites` doors the hub and the deck write through, each of which REJECTS
 * on a failed write. So a pick on the orb and a pick in the hub can never mean
 * two different writes, and a failed write keeps the bubble up with its error
 * instead of reading as resolved (`runDecisionOption`'s failure path).
 *
 * Ids are the roster's ids (`approval:<id>`, `review:<id>`, `incident:<id>`),
 * which for approvals and reviews are exactly the ids the orb always used — so
 * the skip/snooze ledger (`decisionDeferral`) keeps every entry it had.
 *
 * Which items the orb may surface ({@link isOrbEligible}):
 *  - every companion approval and every pending review — as before;
 *  - an incident only while it is blocking (critical/high, decision tier 1)
 *    AND still `open` — the set the backend's `incident_blocker` nudge covered
 *    (`incident_triggers.rs`: status open, severity high|critical). An
 *    acknowledged incident has been seen by a person; it is the hub's, not the
 *    orb's.
 *
 * React-free; the translation tree is read through `getActiveTranslations`.
 */
import { DEFAULT_TRIAGE_COPY } from '@/features/agents/quick-answer/triage/triageAdapters';
import type { DecisionItem } from '@/features/decision-center/model/decisionModel';
import { decisionTier } from '@/features/decision-center/model/decisionOrder';
import type { RosterDecision } from '@/features/decision-center/roster/decisionDispatch';
import { setPendingIncidentDeepLink } from '@/features/overview/sub_incidents/libs/incidentDeepLink';
import { getActiveTranslations } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { storeBus } from '@/lib/storeBus';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';

import { deferDecision } from './decisionDeferral';
import { sweepIncidentReminders } from './incidentReminderSweep';
import type { DecisionOption, DecisionSource, PendingDecision } from './types';

/** A verdict through the roster. Rejects when the write failed. */
export type RosterDecide = (decision: RosterDecision) => Promise<void>;

/** The pending-decision sources that are roster items (and nothing else). */
export const ROSTER_DECISION_SOURCES: ReadonlySet<DecisionSource> = new Set<DecisionSource>([
  'approval',
  'human_review',
  'incident',
]);

/** Suggested actions offered as chips — capped so the numbered row stays legible. */
const MAX_REVIEW_ACTIONS = 4;

/** True when the orb may surface this roster item hands-free. */
export function isOrbEligible(item: DecisionItem): boolean {
  switch (item.kind) {
    case 'approval':
    case 'review':
      return true;
    case 'incident':
      return decisionTier(item) === 1 && item.payload?.seenStatus === 'open';
    default:
      return false;
  }
}

/**
 * The item's body, or '' when it is the adapters' "no description" filler —
 * a prompt reading "Title — No description was provided." says less than the
 * title alone.
 */
function meaningfulBody(item: DecisionItem): string {
  const body = item.body.trim();
  const filler = getActiveTranslations().monitor.triage_no_description;
  if (!body || body === filler || body === DEFAULT_TRIAGE_COPY.noDescription) return '';
  return body;
}

function factValue(item: DecisionItem, id: string): string | null {
  return item.facts.find((f) => f.id === id)?.value ?? null;
}

function approvalDecision(item: DecisionItem, decide: RosterDecide): PendingDecision {
  const c = getActiveTranslations().athena;
  // The roster titles an approval with `actionLabel(action)` — the label the
  // orb always led with — and keeps the rationale as the body.
  const label = item.title;
  const rationale = meaningfulBody(item);
  const options: DecisionOption[] = [
    { key: 'approve', label: c.decision_approve, run: () => decide({ item, verdict: 'accept' }) },
    {
      key: 'reject',
      label: c.decision_reject,
      danger: true,
      run: () => decide({ item, verdict: 'reject' }),
    },
  ];
  return {
    id: item.id,
    prompt: rationale ? `${label}: ${rationale}` : label,
    options,
    recommendation:
      item.payload?.risk === 'low' ? c.decision_recommend_approve : c.decision_recommend_review,
    detail: rationale || undefined,
    source: 'approval',
    sourceRef: item.sourceId,
    // `params` stays a JSON STRING: `PendingApprovalBar` parses it a second
    // time to find a browser approval's tab. The roster carries the params as
    // pretty-printed JSON (`evidence`), which parses to the same value.
    payload: JSON.stringify({
      action: item.payload?.action ?? '',
      params: item.evidence ?? '{}',
      created_at: item.createdAt,
    }),
  };
}

function openIncident(item: DecisionItem): void {
  useSystemStore.getState().setSidebarSection('overview');
  useOverviewStore.getState().setOverviewTab('incidents');
  setPendingIncidentDeepLink(item.sourceId);
  storeBus.emit('incidents:open-detail', { incidentId: item.sourceId });
}

/**
 * A terminal incident verdict, then — once it has LANDED — the reminder sweep:
 * the last blocker settled retires Athena's `incident_blocker` reminders
 * (see `./incidentReminderSweep`). Fire-and-forget hygiene; a failed write
 * still rejects before the sweep is ever considered.
 */
async function settleIncident(
  item: DecisionItem,
  verdict: 'accept' | 'reject',
  decide: RosterDecide,
): Promise<void> {
  await decide({ item, verdict });
  void sweepIncidentReminders().catch(silentCatch('companion/decision:incident-reminder-sweep'));
}

function incidentDecision(item: DecisionItem, decide: RosterDecide): PendingDecision {
  const t = getActiveTranslations();
  const c = t.athena;
  const options: DecisionOption[] = [
    { key: 'resolve', label: c.decision_resolve, run: () => settleIncident(item, 'accept', decide) },
    {
      key: 'open',
      label: c.decision_open,
      // Reading is not deciding: the incident stays open and counted. Held
      // back for the snooze window so the queue moves past it while the
      // operator works it on its own page.
      run: () => {
        openIncident(item);
        deferDecision(item.id);
      },
    },
    {
      key: 'dismiss',
      label: item.verdictLabels.reject,
      danger: true,
      run: () => settleIncident(item, 'reject', decide),
    },
  ];
  return {
    id: item.id,
    prompt: item.title,
    options,
    recommendation: c.decision_recommend_resolve,
    detail: meaningfulBody(item) || undefined,
    source: 'incident',
    sourceRef: item.sourceId,
    navigateRoute: 'overview',
    payload: JSON.stringify({
      incident_id: item.sourceId,
      severity: item.severity ?? null,
      status: item.payload?.seenStatus ?? null,
      title: item.title,
      detail: item.evidence ?? meaningfulBody(item),
      created_at: item.createdAt,
    }),
  };
}

function reviewDecision(item: DecisionItem, decide: RosterDecide): PendingDecision {
  const c = getActiveTranslations().athena;
  const description = meaningfulBody(item);
  // Phase 5b — a suggested action resolves the review AND runs the persona to
  // carry it out. The roster's review branches ARE the suggested actions.
  const actionOptions: DecisionOption[] = item.branches
    .slice(0, MAX_REVIEW_ACTIONS)
    .map((branch, i) => ({
      key: `action-${i}`,
      label: branch.label,
      run: () => decide({ item, verdict: 'accept', branchId: branch.id }),
    }));
  const options: DecisionOption[] = [
    ...actionOptions,
    { key: 'approve', label: c.decision_approve, run: () => decide({ item, verdict: 'accept' }) },
    {
      key: 'reject',
      label: c.decision_reject,
      danger: true,
      run: () => decide({ item, verdict: 'reject' }),
    },
    {
      key: 'open',
      label: c.decision_open,
      run: () => {
        useSystemStore.getState().setSidebarSection('overview');
        useOverviewStore.getState().setOverviewTab('manual-review');
      },
    },
  ];
  return {
    id: item.id,
    prompt: description ? `${item.title} — ${description}` : item.title,
    options,
    recommendation: c.decision_recommend_review_open,
    source: 'human_review',
    sourceRef: item.sourceId,
    navigateRoute: 'overview',
    payload: JSON.stringify({
      title: item.title,
      description: description || null,
      severity: factValue(item, 'severity'),
      suggested_actions: JSON.stringify(item.branches.map((b) => b.label)),
      context_data: item.evidence ?? item.reasoning ?? null,
      persona_id: item.personaId ?? null,
      created_at: item.createdAt,
    }),
  };
}

/** One eligible roster item as the orb's numbered choice. */
export function rosterItemToDecision(item: DecisionItem, decide: RosterDecide): PendingDecision | null {
  if (!isOrbEligible(item)) return null;
  switch (item.kind) {
    case 'approval':
      return approvalDecision(item, decide);
    case 'incident':
      return incidentDecision(item, decide);
    case 'review':
      return reviewDecision(item, decide);
    default:
      return null;
  }
}
