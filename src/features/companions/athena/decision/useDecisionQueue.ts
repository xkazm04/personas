import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { silentCatch } from '@/lib/silentCatch';
import { getActiveTranslations } from '@/i18n/useTranslation';
import {
  COMPANION_PROACTIVE_EVENT,
  companionDismissProactive,
  companionListProactiveMessages,
  type ProactiveMessage,
} from '@/api/companion';
import { listClaudeAccounts } from '@/api/fleet/claudeAccounts';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { markReportRead } from '@/api/overview/reports';
import { companionEngageProactive } from '@/api/companion';
import type { DecisionChip, DecisionItem } from '@/features/decision-center/model/decisionModel';
import { useDecisionCounts } from '@/features/decision-center/roster/useDecisionCounts';
import { compareDecision, decisionTier } from '@/features/decision-center/model/decisionOrder';
import { useDecisionRoster } from '@/features/decision-center/useDecisionRoster';
import { useAthenaStore } from '../athenaStore';
import { applyClientAction } from '../applyClientAction';
import { isDecisionDeferred } from './decisionDeferral';
import { orbLoad } from './orbLoad';
import { needsYouAccounts, reloginToDecision } from './reloginDecision';
import {
  ROSTER_DECISION_SOURCES,
  isOrbEligible,
  rosterItemToDecision,
  type RosterDecide,
} from './rosterDecisions';
import type { DecisionOption, PendingDecision } from './types';

/**
 * Athena hands-free decision queue (P3, slice 3).
 *
 * Feeds ONE decision at a time into `athenaStore.pendingDecision`, only when
 * none is currently pending, from two kinds of source:
 *
 *  - **The Decision Center roster** (`useDecisionRoster`) — companion
 *    approvals, blocking incidents and pending human reviews, in the roster's
 *    order and decided through the roster's `decide` (see `./rosterDecisions`).
 *    The orb no longer keeps its own fetch of those three: one roster, every
 *    reader, so the orb, the hub and the title-bar badge cannot disagree about
 *    what is waiting.
 *  - **Orb-only nudges** the roster does not carry — a revoked credential, a
 *    Claude plan whose re-login needs the operator, and a message Athena's
 *    triage flagged for a personal read. Read on each pump, as before.
 *
 * The auto-surfacing path is UNCONDITIONAL — Athena's orb is one of only two
 * communication dimensions (orb for quick info/decision, chat for the full
 * story), so a pending decision must always reach one of them. The hands-free /
 * autonomous settings govern how far she may act WITHOUT asking, not whether
 * she may ask.
 *
 * Mount once via {@link DecisionDriver} (inside `AthenaGuideLayer`). It
 * re-pumps whenever a decision resolves (clearing `pendingDecision`), whenever
 * the roster's eligible items change (the roster itself re-reads on the
 * `companion://approvals` event, its own poll and its other push events), and
 * on the `companion://proactive` + re-login events for the orb-only nudges.
 */

/** What the queue builder needs from the roster. */
export interface OrbRosterView {
  items: readonly DecisionItem[];
  decide: RosterDecide;
}

/** What the queue hook needs: the builder's view plus the roster's load state. */
export interface OrbRoster extends OrbRosterView {
  errors: { gates?: string; incidents?: string };
  loading: boolean;
}

/**
 * The roster while the orb loads no items (the counts say nothing it could
 * surface is waiting). Nothing to decide, so a decide here is a bug, not a no-op.
 */
const IDLE_ROSTER: OrbRoster = {
  items: [],
  decide: async () => {
    throw new Error('The orb has no roster items loaded');
  },
  errors: {},
  loading: false,
};

/**
 * A `message_attention` proactive (C1) — a message Athena's triage flagged as
 * needing the user's personal read. The orb hands it over as a decision: open
 * it, mark it read, or dismiss the nudge (the message stays unread).
 */
function messageAttentionToDecision(message: ProactiveMessage): PendingDecision {
  const t = getActiveTranslations();
  const c = t.athena;

  const engage = async (): Promise<void> => {
    try {
      await companionEngageProactive(message.id);
      useAthenaStore.getState().removeProactive(message.id);
    } catch (err) {
      silentCatch('companion/decision:message-engage')(err);
    }
  };

  const options: DecisionOption[] = [
    {
      key: 'open',
      label: c.decision_open,
      run: async () => {
        useSystemStore.getState().setSidebarSection('overview');
        useOverviewStore.getState().setOverviewTab('messages');
        await engage();
      },
    },
    {
      key: 'mark_read',
      label: c.decision_mark_read,
      run: async () => {
        // triggerRef is the underlying message id.
        if (message.triggerRef) {
          try {
            await markReportRead(message.triggerRef);
          } catch (err) {
            silentCatch('companion/decision:message-mark-read')(err);
          }
        }
        await engage();
      },
    },
    {
      key: 'dismiss',
      label: c.decision_dismiss,
      danger: true,
      run: async () => {
        try {
          await companionDismissProactive(message.id);
          useAthenaStore.getState().removeProactive(message.id);
        } catch (err) {
          silentCatch('companion/decision:message-dismiss')(err);
        }
      },
    },
  ];

  return {
    id: `message:${message.id}`,
    prompt: message.message,
    options,
    recommendation: c.decision_recommend_read,
    source: 'message_attention',
    sourceRef: message.id,
    navigateRoute: 'overview',
    payload: JSON.stringify({
      trigger_kind: message.triggerKind,
      trigger_ref: message.triggerRef,
      message: message.message,
      created_at: message.createdAt,
    }),
  };
}

/**
 * A `credential_reauth` proactive — an OAuth grant the app found revoked or
 * expired. The only person who can fix it is the operator, in their own
 * browser, so the orb's job is to get them there with the reconnect already
 * armed rather than to do anything itself.
 *
 * "Reconnect now" lands on exactly the screen state
 * `ClientAction::ReconnectCredential` produces — same two flags, same route —
 * because "show me this credential and start the re-auth" has one right answer
 * and both doors owe it.
 */
function credentialReauthToDecision(message: ProactiveMessage): PendingDecision {
  const t = getActiveTranslations();
  const c = t.athena;

  const engage = async (): Promise<void> => {
    try {
      await companionEngageProactive(message.id);
      useAthenaStore.getState().removeProactive(message.id);
    } catch (err) {
      silentCatch('companion/decision:credential-engage')(err);
      // Propagate: without this the bubble clears on a failed engage and the
      // next pump re-surfaces the same nudge.
      throw err;
    }
  };

  const options: DecisionOption[] = [
    {
      key: 'reconnect',
      label: c.decision_reconnect_now,
      run: async () => {
        // triggerRef is the credential id (see credential_triggers.rs).
        if (message.triggerRef) {
          applyClientAction({
            type: 'reconnect_credential',
            credentialId: message.triggerRef,
          });
        }
        await engage();
      },
    },
    {
      key: 'later',
      label: c.decision_later,
      run: async () => {
        try {
          await companionDismissProactive(message.id);
          useAthenaStore.getState().removeProactive(message.id);
        } catch (err) {
          silentCatch('companion/decision:credential-dismiss')(err);
        }
      },
    },
  ];

  return {
    id: `credential:${message.id}`,
    prompt: message.message,
    options,
    recommendation: c.decision_recommend_reconnect,
    source: 'credential_reauth',
    sourceRef: message.id,
    navigateRoute: 'credentials',
    payload: JSON.stringify({
      trigger_kind: message.triggerKind,
      trigger_ref: message.triggerRef,
      message: message.message,
      created_at: message.createdAt,
    }),
  };
}

/**
 * Build the current queue across all sources.
 *
 * Order: the roster's BLOCKING items first (decision tier 1 — companion
 * approvals, critical/high open incidents, reviews holding a team step) in the
 * roster's own order; then a revoked credential and a Claude plan waiting on a
 * re-login (everything bound to them is failing right now); then the rest of
 * the roster's eligible items (other reviews), still in roster order; then
 * attention messages. Tier 1 replaces the old fixed "approvals, then
 * incidents" — the roster's ordering law, not a second one.
 *
 * Anything the operator skipped or snoozed is filtered out at the end (see
 * `./decisionDeferral`): the ledger is consulted HERE, once, rather than at the
 * two call sites, so "what the orb may show" has one definition.
 */
async function buildQueue(roster: OrbRosterView): Promise<PendingDecision[]> {
  const eligible = roster.items.filter(isOrbEligible).sort(compareDecision);
  const asDecisions = (items: DecisionItem[]): PendingDecision[] =>
    items.flatMap((item) => {
      const d = rosterItemToDecision(item, roster.decide);
      return d ? [d] : [];
    });
  const blocking = asDecisions(eligible.filter((i) => decisionTier(i) === 1));
  const rest = asDecisions(eligible.filter((i) => decisionTier(i) !== 1));

  const queue: PendingDecision[] = [...blocking];
  const attention: PendingDecision[] = [];

  try {
    const proactive = await companionListProactiveMessages(true, 20);
    // A revoked credential sorts with the blockers: everything bound to it is
    // failing right now, and the fix is one click away from here.
    for (const m of proactive) {
      if (m.triggerKind === 'credential_reauth') queue.push(credentialReauthToDecision(m));
    }
    // Attention messages sort last (less urgent than any decision).
    for (const m of proactive) {
      if (m.triggerKind === 'message_attention') attention.push(messageAttentionToDecision(m));
    }
    // `incident_blocker` nudges are NOT read here any more: the incidents they
    // point at are roster items above, decided through the incident door.
  } catch (err) {
    silentCatch('companion/decision:list-proactive')(err);
  }

  try {
    // A Claude plan whose re-login needs the operator: ONE quick decision on
    // the orb, never a toast (see ./reloginDecision).
    const snapshot = await listClaudeAccounts();
    for (const a of needsYouAccounts(snapshot?.accounts ?? [])) queue.push(reloginToDecision(a));
  } catch (err) {
    silentCatch('companion/decision:list-relogin')(err);
  }

  queue.push(...rest, ...attention);
  return queue.filter((d) => !isDecisionDeferred(d.id));
}

/**
 * Test seam: the queue builder, without the hook around it.
 *
 * Exported rather than re-implemented in the test so what a test exercises is
 * the real option list the orb renders — including which write an approved
 * decision reaches. A test that rebuilt the options would have kept passing
 * through the very bug this seam exists to cover (the orb's private
 * navigate-only dispatcher).
 */
export const buildDecisionQueueForTest = buildQueue;

/** True when the roster's view of a pending roster decision says it is gone. */
function rosterLostIt(
  pending: PendingDecision,
  items: readonly DecisionItem[],
  failed: boolean,
): boolean {
  if (!ROSTER_DECISION_SOURCES.has(pending.source)) return false;
  // A chip that failed to load cannot prove anything left it.
  if (failed) return false;
  return !items.some((i) => i.id === pending.id);
}

/**
 * The decision queue is ALWAYS active.
 *
 * It used to be gated behind `athenaHandsFreeDecisions || athenaAutonomousMode`.
 * That gate was survivable only while a third notification dimension (footer
 * popover / toasts) carried Athena's messages; with that dimension deleted, the
 * orb IS the quick-decision surface and the chat IS the full one — a gated queue
 * would make pending approvals, incidents, and human reviews invisible outside
 * their own pages. So the orb now always carries decisions; the settings only
 * govern how far Athena may act WITHOUT asking, not whether she may ask.
 *
 * Returns a `pump` callback (also auto-pumped as described above). `roster` is
 * the Decision Center roster restricted to the chips the orb loads (see
 * {@link DecisionDriver}), or {@link IDLE_ROSTER} while it loads none.
 */
export function useDecisionQueue(roster: OrbRoster) {
  const pending = useAthenaStore((s) => s.pendingDecision);

  // The roster as of the last render, for the async pump and the decide
  // wrapper — neither should re-create (and re-fire) per roster identity.
  const rosterRef = useRef(roster);
  useEffect(() => {
    rosterRef.current = roster;
  }, [roster]);

  /** The roster item an orb pick is writing right now (its optimistic removal
   *  is not "decided elsewhere"). */
  const deciding = useRef<string | null>(null);
  const decide = useCallback<RosterDecide>(async (decision) => {
    deciding.current = decision.item.id;
    try {
      await rosterRef.current.decide(decision);
    } finally {
      deciding.current = null;
    }
  }, []);

  // Guard against overlapping pumps; a trigger that lands mid-pump re-runs it.
  const pumping = useRef(false);
  const again = useRef(false);

  const pump = useCallback(async () => {
    // Only surface when the bubble is free.
    if (useAthenaStore.getState().pendingDecision) return;
    if (pumping.current) {
      again.current = true;
      return;
    }
    pumping.current = true;
    try {
      do {
        again.current = false;
        const queue = await buildQueue({ items: rosterRef.current.items, decide });
        const next = queue[0];
        // Depth is recorded even when nothing is surfaced, so the bubble can say
        // how much is behind the question it is asking.
        useAthenaStore.getState().setDecisionQueueDepth(queue.length);
        // Re-check after the awaits — another path may have surfaced a decision.
        if (next && !useAthenaStore.getState().pendingDecision) {
          useAthenaStore.getState().setPendingDecision(next);
        }
      } while (again.current && !useAthenaStore.getState().pendingDecision);
    } finally {
      pumping.current = false;
    }
  }, [decide]);

  // The roster has answered at least once — before that an empty item list is
  // "not loaded", and pumping would surface an orb-only nudge ahead of an
  // approval that simply had not arrived yet.
  const [rosterReady, setRosterReady] = useState(false);
  useEffect(() => {
    if (!roster.loading) setRosterReady(true);
  }, [roster.loading]);

  // Re-pump only when the ELIGIBLE set actually moved, by value: the roster's
  // sources hand out a fresh array on every 30 s re-read.
  const eligibleKey = useMemo(
    () => roster.items.filter(isOrbEligible).map((i) => i.id).join('|'),
    [roster.items],
  );

  // Pump on readiness, whenever the bubble frees up (pending → null), and
  // whenever the roster's eligible items change.
  useEffect(() => {
    if (rosterReady && !pending) void pump();
  }, [rosterReady, pending, pump, eligibleKey]);

  // A roster decision on the bubble that was decided ELSEWHERE (the hub, the
  // deck, another window) leaves the roster on its next read; the bubble goes
  // with it instead of asking a question that already has an answer.
  const rosterFailed = Boolean(roster.errors.gates || roster.errors.incidents);
  useEffect(() => {
    if (!pending || !rosterReady || roster.loading) return;
    if (deciding.current === pending.id) return;
    if (rosterLostIt(pending, roster.items, rosterFailed)) {
      useAthenaStore.getState().clearPendingDecision();
    }
  }, [pending, rosterReady, roster.loading, roster.items, rosterFailed]);

  // Re-pump when the backend delivers proactive nudges, or a re-login moves.
  // (Approvals arrive through the roster, which re-reads on their event.)
  useEffect(() => {
    const unlistenProactive = listen(COMPANION_PROACTIVE_EVENT, () => {
      void pump();
    });
    // A re-login run moved (it may have stopped at "needs you"): look again.
    const unlistenRelogin = typedListen(EventName.FLEET_CLAUDE_RELOGIN_PROGRESS, () => {
      void pump();
    });
    return () => {
      unlistenRelogin
        .then((f) => f())
        .catch(silentCatch('companion/decision:unlisten'));
      unlistenProactive
        .then((f) => f())
        .catch(silentCatch('companion/decision:unlisten'));
    };
  }, [pump]);

  return { pump };
}

/** The queue over the roster's items for the chips the counts say are live. */
function LoadedQueue({ load }: { load: readonly DecisionChip[] }) {
  useDecisionQueue(useDecisionRoster({ load }));
  return null;
}

/** The queue with no roster items: orb-only nudges, and retiring a stale bubble. */
function IdleQueue() {
  useDecisionQueue(IDLE_ROSTER);
  return null;
}

/**
 * Headless driver — mount once (in `AthenaGuideLayer`) to run the decision
 * queue for the whole app. Renders nothing.
 *
 * The roster is mounted ONLY while the shared counts read says the orb has
 * something to surface (`./orbLoad`): with an empty queue the orb costs that
 * one read, which the title-bar badge polls anyway, and no item source, no
 * triage machinery and no review or incident list poll. The counts reader
 * below rides the same coordinator ticker and in-flight read as the badge's,
 * and re-reads on the roster's push events (a new approval moves the count,
 * the count mounts the roster, the roster deals it).
 */
export function DecisionDriver() {
  const counts = useDecisionCounts();
  const pendingCounts = useSystemStore((s) => s.pendingCounts);
  const load = orbLoad(pendingCounts, counts.counts.gates.failed);
  return load.length > 0 ? createElement(LoadedQueue, { load }) : createElement(IdleQueue);
}
