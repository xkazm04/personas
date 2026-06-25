// Design D — the deliberations data hook (D6). Lists a team's deliberations,
// loads the selected one's detail + agenda + turns, and exposes create / approve
// / dismiss. Polls the selected deliberation while it's active, since the
// autonomous moderator tick mutates it server-side.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toastCatch } from '@/lib/silentCatch';
import {
  advanceTeamDeliberation,
  approveDeliberationAction,
  approveDeliberationProposal,
  createTeamDeliberation,
  dismissDeliberationProposal,
  getTeamDeliberation,
  listDeliberationAgenda,
  listDeliberationTurns,
  listTeamDeliberations,
  resolveDeliberationEscalation,
  skipDeliberationAction,
} from '@/api/pipeline/teamDeliberations';
import type { TeamDeliberation } from '@/lib/bindings/TeamDeliberation';
import type { DeliberationAgendaItem } from '@/lib/bindings/DeliberationAgendaItem';
import type { TeamChannelMessage } from '@/lib/bindings/TeamChannelMessage';

const ACTIVE_STATUSES = new Set([
  'open',
  'converging',
  'escalated',
  'paused',
  'awaiting_action',
]);
/** Statuses the "Run to budget" loop keeps auto-advancing through. Anything
 *  else (awaiting_action / escalated / resolved / aborted / paused) stops it. */
const AUTO_ADVANCE_STATUSES = new Set(['open', 'converging']);
const POLL_MS = 6000;

export function useTeamDeliberations(teamId: string) {
  const [list, setList] = useState<TeamDeliberation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamDeliberation | null>(null);
  const [agenda, setAgenda] = useState<DeliberationAgendaItem[]>([]);
  const [turns, setTurns] = useState<TeamChannelMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const refreshList = useCallback(async () => {
    try {
      setList(await listTeamDeliberations(teamId));
    } catch (e) {
      toastCatch('useTeamDeliberations.refreshList')(e);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  const refreshDetail = useCallback(async (id: string) => {
    try {
      const [d, a, t] = await Promise.all([
        getTeamDeliberation(id),
        listDeliberationAgenda(id),
        listDeliberationTurns(id),
      ]);
      setDetail(d);
      setAgenda(a);
      setTurns(t);
    } catch (e) {
      toastCatch('useTeamDeliberations.refreshDetail')(e);
    }
  }, []);

  useEffect(() => {
    runningRef.current = false;
    setRunning(false);
    setSelectedId(null);
    setDetail(null);
    void refreshList();
  }, [teamId, refreshList]);

  useEffect(() => {
    if (selectedId) {
      void refreshDetail(selectedId);
    } else {
      setDetail(null);
      setAgenda([]);
      setTurns([]);
    }
  }, [selectedId, refreshDetail]);

  // Poll the selected deliberation while it's active (the moderator tick mutates
  // it). Stops once it's terminal (resolved/aborted).
  useEffect(() => {
    if (!selectedId || !detail || !ACTIVE_STATUSES.has(detail.status)) return;
    const iv = setInterval(() => {
      void refreshDetail(selectedId);
      void refreshList();
    }, POLL_MS);
    return () => clearInterval(iv);
  }, [selectedId, detail, refreshDetail, refreshList]);

  const create = useCallback(
    async (topic: string, goal?: string, costBudgetUsd?: number) => {
      setBusy(true);
      try {
        const d = await createTeamDeliberation(teamId, topic, goal, costBudgetUsd);
        await refreshList();
        setSelectedId(d.id);
        return d;
      } catch (e) {
        toastCatch('useTeamDeliberations.create')(e);
      } finally {
        setBusy(false);
      }
    },
    [teamId, refreshList],
  );

  const advance = useCallback(
    async (id: string) => {
      setAdvancing(true);
      try {
        await advanceTeamDeliberation(id);
        await refreshDetail(id);
        await refreshList();
      } finally {
        setAdvancing(false);
      }
    },
    [refreshDetail, refreshList],
  );

  // Auto-advance round after round until the deliberation leaves the
  // auto-advanceable set: budget spent (paused), action gate (awaiting_action),
  // escalation, or resolution. The user can Stop at any round boundary.
  const runToBudget = useCallback(
    async (id: string) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      try {
        while (runningRef.current) {
          const d = await advanceTeamDeliberation(id);
          await refreshDetail(id);
          await refreshList();
          if (!AUTO_ADVANCE_STATUSES.has(d.status)) break;
        }
      } catch (e) {
        toastCatch('useTeamDeliberations.runToBudget')(e);
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [refreshDetail, refreshList],
  );

  const stopRun = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
  }, []);

  // Gated capability action — approve (runs it, posts output, resumes) or skip.
  const approveAction = useCallback(
    async (id: string) => {
      setActionBusy(true);
      try {
        await approveDeliberationAction(id);
        await refreshDetail(id);
        await refreshList();
      } catch (e) {
        toastCatch('useTeamDeliberations.approveAction')(e);
      } finally {
        setActionBusy(false);
      }
    },
    [refreshDetail, refreshList],
  );

  const skipAction = useCallback(
    async (id: string) => {
      setActionBusy(true);
      try {
        await skipDeliberationAction(id);
        await refreshDetail(id);
        await refreshList();
      } catch (e) {
        toastCatch('useTeamDeliberations.skipAction')(e);
      } finally {
        setActionBusy(false);
      }
    },
    [refreshDetail, refreshList],
  );

  // Escalation ("your decision needed") — resume with a steer, wrap up into a
  // proposal, or abort.
  const resolveEscalation = useCallback(
    async (id: string, decision: 'resume' | 'resolve' | 'abort', comment?: string) => {
      setDecisionBusy(true);
      try {
        await resolveDeliberationEscalation(id, decision, comment);
        await refreshDetail(id);
        await refreshList();
      } catch (e) {
        toastCatch('useTeamDeliberations.resolveEscalation')(e);
      } finally {
        setDecisionBusy(false);
      }
    },
    [refreshDetail, refreshList],
  );

  const approve = useCallback(
    async (id: string) => {
      await approveDeliberationProposal(id);
      await refreshDetail(id);
      await refreshList();
    },
    [refreshDetail, refreshList],
  );

  const dismiss = useCallback(
    async (id: string) => {
      await dismissDeliberationProposal(id);
      await refreshDetail(id);
      await refreshList();
    },
    [refreshDetail, refreshList],
  );

  return {
    list,
    selectedId,
    setSelectedId,
    detail,
    agenda,
    turns,
    loading,
    busy,
    advancing,
    actionBusy,
    decisionBusy,
    running,
    create,
    advance,
    runToBudget,
    stopRun,
    approveAction,
    skipAction,
    resolveEscalation,
    approve,
    dismiss,
    refreshList,
  };
}
