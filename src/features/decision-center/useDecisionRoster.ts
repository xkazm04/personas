/**
 * useDecisionRoster — the ONE source of decision items and counts.
 *
 * Every reader (the CommandBar strip, the title-bar badge, Athena's orb queue,
 * the Home decisions widget, sidebar badges) reads this; none keeps its own
 * aggregation.
 *
 * Contract:
 *  - `counts` arrive from one backend round-trip (`dev_tools_pending_counts`)
 *    plus the client-derived chat count. A source that failed sets
 *    `failed: true` on its chip; a count is 0 only when its source answered.
 *  - `items` load lazily: only chips named in `load` are fetched (the peek list
 *    asks for its chip; "Triage all" asks for every chip).
 *  - Items are in `compareDecision` order.
 *
 * Where each chip's items come from:
 *  - gates / proposals / backlog — the triage deck's own sources, through
 *    `useUnifiedTriage` with `enabled` gating its four owned fetches, read as
 *    `sources` (BEFORE the deck's session filters). Nothing is fetched twice and
 *    no adapter is forked; verdicts route through the deck's own port bundle.
 *    Gates adds Athena's companion approvals.
 *  - incidents / reports / council — `useDecisionSources`, one existing API
 *    wrapper each, fetched only while the chip is asked for.
 *  - chat — derived from the channel slices (`useChatThreads`).
 *
 * `decide` resolves optimistically: the item leaves `items` the moment the
 * write is issued (an identity set, never an index) and comes back if the write
 * fails — then the rejection is rethrown for the caller to toast. A LOST
 * compare-and-swap is not a failed write: the row is decided, just not by this
 * person, so the item stays gone, the sources re-read, and the conflict is
 * still rethrown (`isDecisionConflict` tells the caller which toast to raise).
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { TriageDecision } from '@/features/agents/quick-answer/triage/triageTypes';
import {
  useUnifiedTriage,
  type TriageSource,
} from '@/features/agents/quick-answer/triage/useUnifiedTriage';
import { applyClientAction } from '@/features/companions/athena/applyClientAction';
import { useAthenaStore } from '@/features/companions/athena/athenaStore';
import { actionRisk } from '@/features/companions/athena/decision/actionRisk';
import {
  ApprovalActionFailedError,
  decideCompanionApprovalRow,
  decideCouncilRow,
  isDecisionConflict,
  markReportReadRow,
  resolveIncidentRow,
} from '@/lib/decisions/rowWrites';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';

import {
  DECISION_CHIPS,
  chipOf,
  type ChipCount,
  type DecisionChip,
  type DecisionItem,
  type HubChip,
} from './model/decisionModel';
import { compareDecision } from './model/decisionOrder';
import { buildChipCounts, decisionTotal } from './roster/chipCounts';
import {
  approvalToDecision,
  councilToDecision,
  incidentToDecision,
  reportToDecision,
} from './roster/decisionAdapters';
import {
  isRosterDeferral,
  leavesQueue,
  routeDecisionItem,
  type DecisionPorts,
} from './roster/decisionDispatch';
import {
  getPendingCountsStatus,
  refreshDecisionCounts,
  subscribePendingCountsStatus,
} from './roster/pendingCountsSource';
import { useChatThreads } from './roster/useChatThreads';
import { useDecisionCopy } from './roster/useDecisionCopy';
import { useDecisionSources } from './roster/useDecisionSources';
import { ALL_TARGETS, useRosterRefresh, type RefreshTarget } from './roster/useRosterRefresh';

/** Navigation the roster cannot do itself — the host owns its routes. */
export interface DecisionRosterHosts {
  onOpenBuilder?: (personaId: string) => void;
  onOpenRun?: (executionId: string) => void;
  onOpenGoalBoard?: (projectId: string) => void;
  /** A report's "follow up in chat" branch. */
  onOpenChat?: (personaId: string) => void;
}

export interface DecisionRosterOptions {
  /** Chips whose items should be loaded. Counts are always loaded. */
  load?: readonly DecisionChip[] | 'all';
  enabled?: boolean;
  /**
   * Deep-link routes for the branches that navigate instead of writing. Without
   * one, that branch rejects rather than resolving the item for free. Pass a
   * memoised object.
   */
  hosts?: DecisionRosterHosts;
}

export interface DecisionRoster {
  counts: Record<HubChip, ChipCount>;
  /** Sum of the seven decision chips (excludes `ready`). */
  total: number;
  /** Loaded items, ordered by `compareDecision`. */
  items: DecisionItem[];
  byChip: Partial<Record<DecisionChip, DecisionItem[]>>;
  /** Per-chip load error message, when a chip's items failed to load. */
  errors: Partial<Record<HubChip, string>>;
  loading: boolean;
  /**
   * Write a verdict. Optimistically removes the item; REJECTS on a failed
   * write after restoring it (the caller toasts).
   */
  decide: (decision: Omit<TriageDecision, 'item'> & { item: DecisionItem }) => Promise<void>;
  refresh: () => void;
}

const TRIAGE_FAILURE_CHIP: Record<TriageSource, DecisionChip> = {
  reviews: 'gates',
  ideas: 'backlog',
  policy: 'proposals',
  evolution: 'proposals',
  goals: 'proposals',
};

const NO_HOSTS: DecisionRosterHosts = {};

function addError(errors: Partial<Record<HubChip, string>>, chip: HubChip, message: string): void {
  errors[chip] = errors[chip] ? `${errors[chip]}; ${message}` : message;
}

export function useDecisionRoster(options: DecisionRosterOptions = {}): DecisionRoster {
  const enabled = options.enabled ?? true;
  const hosts = options.hosts ?? NO_HOSTS;
  const loadKey = options.load === 'all' ? 'all' : (options.load ?? []).join(',');
  const want = useMemo<ReadonlySet<DecisionChip>>(
    () =>
      new Set(
        loadKey === 'all'
          ? DECISION_CHIPS
          : DECISION_CHIPS.filter((c) => loadKey.split(',').includes(c)),
      ),
    [loadKey],
  );
  const has = useCallback((chip: DecisionChip) => enabled && want.has(chip), [enabled, want]);
  const triageActive = has('gates') || has('proposals') || has('backlog');

  const copy = useDecisionCopy();
  const triageHosts = useMemo(
    () => ({
      onOpenBuilder: hosts.onOpenBuilder,
      onOpenRun: hosts.onOpenRun,
      onOpenGoalBoard: hosts.onOpenGoalBoard,
    }),
    [hosts.onOpenBuilder, hosts.onOpenRun, hosts.onOpenGoalBoard],
  );
  const triage = useUnifiedTriage(copy.triage, triageHosts, { enabled: triageActive });

  const [gens, setGens] = useState({ incidents: 0, reports: 0, council: 0, approvals: 0 });
  const sources = useDecisionSources(
    {
      incidents: has('incidents'),
      reports: has('reports'),
      council: has('council'),
      approvals: has('gates'),
    },
    gens,
  );
  const chat = useChatThreads(has('chat'), copy);

  /* -- counts ------------------------------------------------------------- */

  const pending = useSystemStore((s) => s.pendingCounts);
  const countsStatus = useSyncExternalStore(subscribePendingCountsStatus, getPendingCountsStatus);
  const undispatched = useSystemStore((s) => s.undispatchedIdeas);
  const refreshUndispatched = useSystemStore((s) => s.refreshUndispatchedIdeas);
  const [readySettled, setReadySettled] = useState(false);
  // The title-bar tray's own definition: a halted CLI's questions live in
  // `buildSessions` state and have no row anywhere to count.
  const questionCount = useAgentStore((s) => {
    let n = 0;
    for (const sess of Object.values(s.buildSessions)) {
      if (sess.phase === 'awaiting_input') n += sess.pendingQuestions.length;
    }
    return n;
  });

  const counts = useMemo(
    () =>
      buildChipCounts({
        pending,
        pendingFailed: countsStatus.failed,
        questions: questionCount,
        chat: { n: chat.count, failed: chat.failed },
        // The slice keeps `null` until a read lands and swallows failures, so
        // "settled and still null" is the only failure it lets anyone see.
        ready: { n: undispatched?.length ?? null, failed: readySettled && undispatched === null },
      }),
    [pending, countsStatus.failed, questionCount, chat.count, chat.failed, undispatched, readySettled],
  );

  /* -- refresh ------------------------------------------------------------ */

  const refreshCounts = useCallback(() => {
    void refreshDecisionCounts();
    void refreshUndispatched().finally(() => setReadySettled(true));
  }, [refreshUndispatched]);

  const { revalidate } = triage;
  const refreshItems = useCallback(
    (targets: ReadonlySet<RefreshTarget>) => {
      if (targets.has('triage') && triageActive) revalidate();
      setGens((g) => ({
        incidents: g.incidents + (targets.has('incidents') ? 1 : 0),
        reports: g.reports + (targets.has('reports') ? 1 : 0),
        council: g.council + (targets.has('council') ? 1 : 0),
        approvals: g.approvals + (targets.has('approvals') ? 1 : 0),
      }));
    },
    [triageActive, revalidate],
  );

  const itemsActive = want.size > 0 && enabled;
  useRosterRefresh({ enabled, itemsActive, onCounts: refreshCounts, onItems: refreshItems });

  const refresh = useCallback(() => {
    refreshCounts();
    refreshItems(new Set(ALL_TARGETS));
  }, [refreshCounts, refreshItems]);

  /* -- items -------------------------------------------------------------- */

  const personas = useAgentStore((s) => s.personas);
  const raw = useMemo<DecisionItem[]>(() => {
    const out: DecisionItem[] = [];
    if (triageActive) {
      for (const item of triage.sources) if (want.has(chipOf(item.kind))) out.push(item);
    }
    if (has('gates')) {
      for (const a of sources.approvals.rows) {
        out.push(approvalToDecision(a, actionRisk(a.action), copy));
      }
    }
    if (has('incidents')) for (const i of sources.incidents.rows) out.push(incidentToDecision(i, copy));
    if (has('reports')) {
      const byId = new Map(personas.map((p) => [p.id, p]));
      for (const r of sources.reports.rows) {
        const p = byId.get(r.persona_id);
        const author = p ? { name: p.name, color: p.color, icon: p.icon } : null;
        out.push(reportToDecision(r, author, copy));
      }
    }
    if (has('council')) {
      for (const row of sources.council.rows) out.push(councilToDecision(row.subject, row.detail, copy));
    }
    if (has('chat')) out.push(...chat.items);
    return out;
  }, [
    triageActive,
    triage.sources,
    want,
    has,
    sources.approvals.rows,
    sources.incidents.rows,
    sources.reports.rows,
    sources.council.rows,
    personas,
    chat.items,
    copy,
  ]);

  /** Ids decided optimistically and not yet gone from their source. */
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  // Forget ids their source no longer returns, so the set cannot grow forever
  // and a row re-raised later under the same id is dealt again.
  useEffect(() => {
    setRemoved((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(raw.map((i) => i.id));
      const next = new Set([...prev].filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [raw]);

  const items = useMemo(
    () => raw.filter((i) => !removed.has(i.id)).sort(compareDecision),
    [raw, removed],
  );

  const byChip = useMemo(() => {
    const out: Partial<Record<DecisionChip, DecisionItem[]>> = {};
    for (const chip of want) out[chip] = [];
    for (const item of items) out[chipOf(item.kind)]?.push(item);
    return out;
  }, [items, want]);

  const errors = useMemo(() => {
    const out: Partial<Record<HubChip, string>> = {};
    for (const f of triage.failures) {
      const chip = TRIAGE_FAILURE_CHIP[f.source];
      if (want.has(chip)) addError(out, chip, f.message);
    }
    if (has('gates') && sources.approvals.error) addError(out, 'gates', sources.approvals.error);
    if (has('incidents') && sources.incidents.error) addError(out, 'incidents', sources.incidents.error);
    if (has('reports') && sources.reports.error) addError(out, 'reports', sources.reports.error);
    if (has('council') && sources.council.error) addError(out, 'council', sources.council.error);
    if (has('chat') && chat.failed) addError(out, 'chat', 'chat threads could not be derived');
    return out;
  }, [
    triage.failures,
    want,
    has,
    sources.approvals.error,
    sources.incidents.error,
    sources.reports.error,
    sources.council.error,
    chat.failed,
  ]);

  const loading =
    (enabled && !countsStatus.settled && pending === null) ||
    (triageActive && triage.loading) ||
    sources.approvals.loading ||
    sources.incidents.loading ||
    sources.reports.loading ||
    sources.council.loading;

  /* -- decide ------------------------------------------------------------- */

  const fetchUnreadReportCount = useOverviewStore((s) => s.fetchUnreadReportCount);
  const ports = useMemo<DecisionPorts>(
    () => ({
      triage: triage.ports,
      resolveIncident: resolveIncidentRow,
      markReportRead: async (id) => {
        await markReportReadRow(id);
        // The overview's own unread badge, which nothing else would nudge.
        void fetchUnreadReportCount();
      },
      decideCouncil: (subjectId, runId, verdict, sawDigest, reason) =>
        decideCouncilRow(subjectId, runId, verdict, sawDigest, { reason }),
      decideApproval: async (id, approve, reason) => {
        try {
          const outcome = await decideCompanionApprovalRow(id, approve, reason);
          useAthenaStore.getState().removeApproval(id);
          if (outcome.clientAction) applyClientAction(outcome.clientAction);
        } catch (err) {
          // `approved_failed` is terminal: Athena's own list drops it too.
          if (err instanceof ApprovalActionFailedError) useAthenaStore.getState().removeApproval(id);
          throw err;
        }
      },
      markThreadSeen: chat.markSeen,
      openChat: hosts.onOpenChat,
    }),
    [triage.ports, fetchUnreadReportCount, chat.markSeen, hosts.onOpenChat],
  );

  const decide = useCallback(
    async (decision: Omit<TriageDecision, 'item'> & { item: DecisionItem }) => {
      if (isRosterDeferral(decision)) return;
      const { id } = decision.item;
      const leaves = leavesQueue(decision);
      if (leaves) setRemoved((prev) => new Set(prev).add(id));
      try {
        await routeDecisionItem(decision, ports);
        refreshCounts();
        // An act that moved the row without closing it is re-read in place.
        if (!leaves && decision.item.kind === 'incident') refreshItems(new Set(['incidents']));
      } catch (err) {
        const decidedElsewhere =
          isDecisionConflict(err) || err instanceof ApprovalActionFailedError;
        if (decidedElsewhere) {
          refresh();
        } else if (leaves) {
          setRemoved((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
        throw err;
      }
    },
    [ports, refreshCounts, refreshItems, refresh],
  );

  return useMemo(
    () => ({
      counts,
      total: decisionTotal(counts),
      items,
      byChip,
      errors,
      loading,
      decide,
      refresh,
    }),
    [counts, items, byChip, errors, loading, decide, refresh],
  );
}
