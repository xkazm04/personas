import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePipelineStore } from '@/stores/pipelineStore';
import { channelKey, EMPTY_CHANNEL } from '@/stores/slices/pipeline/channelSlice';
import { useChannelSubscription } from '@/features/teams/sub_collab/useTeamChannel';
import { listTeamDeliberations } from '@/api/pipeline/teamDeliberations';
import {
  createTeamAssignment,
  decomposeTeamAssignmentGoal,
  startTeamAssignment,
} from '@/api/pipeline/assignments';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import type { TeamDeliberation } from '@/lib/bindings/TeamDeliberation';
import {
  buildConversation,
  nextPromptBatch,
  type AssignProposal,
  type ConversationRow,
  type QueuedPrompt,
} from './conversationModel';

/* ----------------------------------------------------------------------------
 * ONE TEAM'S CONVERSATION — data for both variants.
 *
 * Reads the shared channel cache (P0) at TWO keys: the blended conversation, and
 * the deliberation turns, which P1 made opt-in precisely so they'd stop leaking
 * into the chat. Merging them here is a deliberate act, not an accident — the
 * conversation WANTS the turns (D1: capability work and improvement dialog
 * interleave), it just wants them clustered into one card rather than sprayed
 * across the timeline as anonymous persona posts.
 * -------------------------------------------------------------------------- */

const DELIB_KINDS = ['deliberation'] as const;

export function useConversation(teamId: string | null) {
  const ids = useMemo(() => (teamId ? [teamId] : []), [teamId]);
  useChannelSubscription(ids);
  useChannelSubscription(ids, [...DELIB_KINDS]);

  const loadOlderChannel = usePipelineStore((s) => s.loadOlderChannel);
  const sendChannelDirective = usePipelineStore((s) => s.sendChannelDirective);
  const markChannelSeen = usePipelineStore((s) => s.markChannelSeen);
  const refreshChannel = usePipelineStore((s) => s.refreshChannel);

  const [deliberations, setDeliberations] = useState<TeamDeliberation[]>([]);
  const [proposals, setProposals] = useState<AssignProposal[]>([]);
  // The composer's outbox. Prompts land here the instant Enter is pressed and
  // drain one post at a time, so the composer never has to be disabled.
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  // The row the page-flip should pose against — the newest thing the operator
  // themselves put in the conversation.
  const [pinKey, setPinKey] = useState<string | null>(null);

  // C2: subscribe to this team's two cache entries only — a whole-map selector
  // made every OTHER team's poll re-render the open conversation. The state
  // object keeps identity on a quiet refresh (C1), so these selectors bail.
  const talk =
    usePipelineStore((s) => (teamId ? s.channels[channelKey(teamId)] : undefined)) ?? EMPTY_CHANNEL;
  const turns =
    usePipelineStore((s) => (teamId ? s.channels[channelKey(teamId, [...DELIB_KINDS])] : undefined)) ??
    EMPTY_CHANNEL;

  // The deliberation OBJECTS (topic, status, round, cost) — the turns alone
  // don't carry them.
  useEffect(() => {
    if (!teamId) {
      setDeliberations([]);
      return;
    }
    let cancelled = false;
    listTeamDeliberations(teamId)
      .then((d) => {
        if (!cancelled) setDeliberations(d);
      })
      .catch(silentCatch('conversation:deliberations'));
    return () => {
      cancelled = true;
    };
  }, [teamId, turns.items.length]);

  const delibIndex = useMemo(() => {
    const m = new Map<string, TeamDeliberation>();
    for (const d of deliberations) m.set(d.id, d);
    return m;
  }, [deliberations]);

  const rows: ConversationRow[] = useMemo(() => {
    const merged = [...talk.items, ...turns.items].sort(
      (a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id),
    );
    const base = buildConversation(merged);
    // Pending proposals are local-only until Confirm creates the assignment, so
    // they append at the end rather than living in the channel.
    for (const p of proposals) {
      base.push({ kind: 'proposal', key: `prop:${p.goal}`, at: new Date().toISOString(), proposal: p });
    }
    // Queued prompts are the newest thing in the conversation by definition —
    // they have not been sent yet — so they sit at the very bottom, after the
    // proposals, in the order they were typed.
    for (const p of queue) {
      base.push({ kind: 'queued', key: `queued:${p.id}`, at: p.at, prompt: p });
    }
    return base;
  }, [talk.items, turns.items, proposals, queue]);

  const loadOlder = useCallback(() => {
    if (teamId) void loadOlderChannel(channelKey(teamId));
  }, [teamId, loadOlderChannel]);

  const addProposal = useCallback((p: AssignProposal) => setProposals((ps) => [...ps, p]), []);

  /* ── THE OUTBOX ──────────────────────────────────────────────────────────
   * Enqueue always accepts; a drain effect posts one batch at a time.
   *
   * Implemented here rather than layered on `useAthenaChatQueue`
   * (`plugins/companion/chat/athenaChatQueue.ts`), which is the only other
   * non-blocking composer in the app: that hook reads and writes
   * `useCompanionStore` directly — the queue lives in Athena's own store, keyed
   * by her conversation ids — so reusing it would mean a channel importing the
   * companion's state, which is the feature-to-feature edge the catalog exists
   * to prevent. What carries over is the SHAPE (accept always, drain on the
   * in-flight edge, FIFO), not the code.
   * ------------------------------------------------------------------------ */

  /** Accept a prompt. Returns the row key so the caller can pose against it. */
  const enqueue = useCallback((text: string, goal: boolean): string | null => {
    const body = text.trim();
    if (!body) return null;
    const id = `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setQueue((q) => [...q, { id, text: body, goal, phase: 'queued', at: new Date().toISOString() }]);
    const key = `queued:${id}`;
    setPinKey(key);
    return key;
  }, []);

  /** A failed row is the operator's to retry or to drop; nothing retries itself
   *  behind them, because a directive posted twice is not a recoverable error. */
  const retryPrompt = useCallback(
    (id: string) =>
      setQueue((q) => q.map((p) => (p.id === id ? { ...p, phase: 'queued' as const } : p))),
    [],
  );
  const dropPrompt = useCallback((id: string) => setQueue((q) => q.filter((p) => p.id !== id)), []);

  // Switching projects abandons the outbox: a directive is addressed to ONE
  // team, and draining it into whichever channel is open next would post it to
  // the wrong one.
  useEffect(() => {
    setQueue([]);
    setPinKey(null);
  }, [teamId]);

  // One batch in flight at a time. The ref is not redundant with the `sending`
  // phase: StrictMode re-invokes this effect before the phase write has been
  // committed, and a directive posted twice is not something a refetch undoes.
  const draining = useRef<string | null>(null);
  useEffect(() => {
    if (!teamId) return;
    const batch = nextPromptBatch(queue);
    if (!batch) return;
    const token = batch.ids.join(',');
    if (draining.current === token) return;
    draining.current = token;

    const ids = new Set(batch.ids);
    setQueue((q) => q.map((p) => (ids.has(p.id) ? { ...p, phase: 'sending' as const } : p)));

    const settle = (ok: boolean) => {
      draining.current = null;
      setQueue((q) =>
        ok
          ? q.filter((p) => !ids.has(p.id))
          : q.map((p) => (ids.has(p.id) ? { ...p, phase: 'failed' as const } : p)),
      );
    };

    const run = batch.goal
      ? decomposeTeamAssignmentGoal(teamId, batch.body).then((steps) => {
          addProposal({
            goal: batch.body,
            steps: steps.map((s) => ({
              title: s.title,
              description: s.description,
              suggestedPersonaId: s.suggestedPersonaId ?? null,
            })),
            status: 'pending',
          });
        })
      : sendChannelDirective(teamId, batch.body);

    run.then(
      () => settle(true),
      (e: unknown) => {
        settle(false);
        // The row carries the failure; the toast carries the reason. Both,
        // because a marked row with no explanation is only half an answer.
        toastCatch(batch.goal ? 'conversation:decompose' : 'conversation:send')(e);
      },
    );
  }, [queue, teamId, sendChannelDirective, addProposal]);

  const dropProposal = useCallback(
    (goal: string) => setProposals((ps) => ps.filter((p) => p.goal !== goal)),
    [],
  );

  /** Confirm → the proposal becomes a real, running assignment. */
  const confirmProposal = useCallback(
    async (p: AssignProposal) => {
      if (!teamId) return;
      setProposals((ps) => ps.map((x) => (x.goal === p.goal ? { ...x, status: 'launching' } : x)));
      try {
        const created = await createTeamAssignment({
          teamId,
          title: p.goal.slice(0, 60),
          goal: p.goal,
          matchStrategy: 'llm_eval',
          maxParallelSteps: 16,
          source: 'team_ui',
          companionOpId: null,
          goalId: null,
          steps: p.steps.map((s) => ({
            title: s.title,
            description: s.description,
            // Personas are re-resolved at run time — the preview's suggestion is
            // a routing hint, not a binding (this mirrors the old console).
            assignedPersonaId: null,
            assignedUseCaseId: null,
            dependsOnIndices: null,
          })),
        });
        if (created) {
          await startTeamAssignment(created.id);
          // The assignment now speaks for itself in the channel.
          setProposals((ps) => ps.filter((x) => x.goal !== p.goal));
          void refreshChannel(channelKey(teamId));
        }
      } catch (e) {
        toastCatch('conversation:confirm')(e);
        setProposals((ps) => ps.map((x) => (x.goal === p.goal ? { ...x, status: 'pending' } : x)));
      }
    },
    [teamId, refreshChannel],
  );

  const markSeen = useCallback(() => {
    if (teamId) markChannelSeen(teamId);
  }, [teamId, markChannelSeen]);

  // Memoized so consumers can use the object itself as a dependency —
  // ConversationBriefing's renderRow previously re-minted every render because
  // this literal was fresh each time, which re-rendered every visible row.
  return useMemo(
    () => ({
      rows,
      delibIndex,
      loaded: talk.loaded,
      posting: talk.posting,
      hasMore: !talk.exhausted,
      loadOlder,
      enqueue,
      retryPrompt,
      dropPrompt,
      pinKey,
      markSeen,
      addProposal,
      dropProposal,
      confirmProposal,
    }),
    [
      rows, delibIndex, talk.loaded, talk.posting, talk.exhausted, pinKey,
      loadOlder, enqueue, retryPrompt, dropPrompt, markSeen, addProposal,
      dropProposal, confirmProposal,
    ],
  );
}
