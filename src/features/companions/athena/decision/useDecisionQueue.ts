import { useCallback, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { storeBus } from '@/lib/storeBus';
import { silentCatch } from '@/lib/silentCatch';
import { getActiveTranslations } from '@/i18n/useTranslation';
import { setPendingIncidentDeepLink } from '@/features/overview/sub_incidents/libs/incidentDeepLink';
import {
  COMPANION_APPROVALS_EVENT,
  COMPANION_PROACTIVE_EVENT,
  companionApproveAction,
  companionDismissProactive,
  companionListPendingApprovals,
  companionListProactiveMessages,
  companionRejectAction,
  type ApprovalOutcome,
  type PendingApproval,
  type ProactiveMessage,
} from '@/api/companion';
import { listManualReviewsPage } from '@/api/overview/reviews';
import { resolveReviewRow, dispatchReviewRowAction } from '@/lib/decisions/rowWrites';
import { markReportRead } from '@/api/overview/reports';
import { companionEngageProactive } from '@/api/companion';
import { parseSuggestedActions } from '@/lib/reviews/suggestedActions';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import { useAthenaStore } from '../athenaStore';
import { actionLabel } from '../athenaLabels';
import { applyClientAction } from '../applyClientAction';
import { actionRisk } from './actionRisk';
import { isDecisionDeferred } from './decisionDeferral';
import type { DecisionOption, PendingDecision } from './types';

/**
 * Athena hands-free decision queue (P3, slice 3).
 *
 * Aggregates the three live decision sources — pending approvals, blocking
 * incidents (proactive `incident_blocker` nudges), and pending human reviews —
 * into a single FIFO of {@link PendingDecision}s and feeds them one-at-a-time
 * into `athenaStore.pendingDecision`, only when none is currently pending.
 *
 * The auto-surfacing path is UNCONDITIONAL — Athena's orb is one of only two
 * communication dimensions (orb for quick info/decision, chat for the full
 * story), so a pending decision must always reach one of them. The hands-free /
 * autonomous settings govern how far she may act WITHOUT asking, not whether
 * she may ask.
 *
 * Mount once via {@link DecisionDriver} (inside `AthenaGuideLayer`). It
 * subscribes to the `companion://approvals` + `companion://proactive` Tauri
 * events and re-pumps the queue whenever a decision resolves (clearing
 * `pendingDecision`).
 */

/**
 * Apply an approval's UI-only follow-up.
 *
 * This used to be a local copy that handled `navigate` and silently dropped
 * everything else, on the premise that no other kind reached the hands-free
 * queue. That premise expired the moment an approval the orb surfaces carried
 * one: `reconnect_credential` executes, reports success, and — under the old
 * copy — nothing moves on screen, which is indistinguishable from a broken
 * reconnect. The card path and the orb path resolve the SAME approvals, so they
 * owe the same screen state; the shared handler in `applyClientAction.ts` is
 * that one implementation.
 *
 * `navigate` behaviour is unchanged: the shared handler's `VALID_ROUTES` is the
 * same nine-route list `athenaRoutes.ATHENA_NAV_ROUTES` carried, and an
 * unknown route is still dropped rather than thrown at the sidebar.
 */

/**
 * Approvals with a low blast-radius are recommended for approval; everything
 * else nudges the user to look closer. Deliberately conservative — the
 * recommendation only shows when the user explicitly asks (picks `0`).
 *
 * The classification moved to `./actionRisk`, where a test reads the backend's
 * own `ALLOWED_ACTIONS` catalog and fails on drift. The eight-name Set that
 * used to sit here was an unchecked copy of a 56-entry vocabulary, so every
 * action added after it was written shipped as "look closer" by default -
 * including `write_procedural`, the twin of the `write_fact` it did carry.
 */

function approvalToDecision(approval: PendingApproval): PendingDecision {
  const t = getActiveTranslations();
  const c = t.athena;
  const label = actionLabel(t, approval.action);
  const prompt = approval.rationale ? `${label}: ${approval.rationale}` : label;

  const resolve = async (
    run: () => Promise<ApprovalOutcome>,
  ): Promise<void> => {
    try {
      const outcome = await run();
      useAthenaStore.getState().removeApproval(approval.id);
      if (outcome.clientAction) applyClientAction(outcome.clientAction);
    } catch (err) {
      silentCatch('companion/decision:approval')(err);
      // Propagate so runDecisionOption's failure path fires: keep the decision
      // pending + surface a retry toast. Swallowing here records a false
      // "resolved" and clears the bubble for an action that never landed.
      throw err;
    }
  };

  const options: DecisionOption[] = [
    {
      key: 'approve',
      label: c.decision_approve,
      run: () => resolve(() => companionApproveAction(approval.id)),
    },
    {
      key: 'reject',
      label: c.decision_reject,
      danger: true,
      run: () => resolve(() => companionRejectAction(approval.id)),
    },
  ];

  const lowRisk = actionRisk(approval.action) === 'low';
  return {
    id: `approval:${approval.id}`,
    prompt,
    options,
    recommendation: lowRisk
      ? c.decision_recommend_approve
      : c.decision_recommend_review,
    detail: approval.rationale || undefined,
    source: 'approval',
    sourceRef: approval.id,
    payload: JSON.stringify({
      action: approval.action,
      params: approval.paramsJson,
      created_at: approval.createdAt,
    }),
  };
}

function incidentToDecision(message: ProactiveMessage): PendingDecision {
  const t = getActiveTranslations();
  const c = t.athena;

  const options: DecisionOption[] = [
    {
      key: 'resolve',
      label: c.decision_resolve,
      run: async () => {
        // Mirror ProactiveCard's incident_blocker engage path: take the user
        // to Overview → Incidents and deep-link the specific incident.
        useSystemStore.getState().setSidebarSection('overview');
        useOverviewStore.getState().setOverviewTab('incidents');
        if (message.triggerRef) {
          setPendingIncidentDeepLink(message.triggerRef);
          storeBus.emit('incidents:open-detail', { incidentId: message.triggerRef });
        }
        // Persist the engage server-side (mirrors messageAttentionToDecision's
        // `engage`) — without this the proactive row stays `pending` and
        // `pump()`'s next `buildQueue()` re-fetches it, re-surfacing the same
        // decision on the orb right after the user just acted on it.
        try {
          await companionEngageProactive(message.id);
          useAthenaStore.getState().removeProactive(message.id);
        } catch (err) {
          silentCatch('companion/decision:incident-resolve')(err);
          // Propagate so runDecisionOption keeps the decision pending + toasts
          // on failure instead of falsely clearing it as resolved.
          throw err;
        }
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
          silentCatch('companion/decision:incident-dismiss')(err);
        }
      },
    },
  ];

  return {
    id: `incident:${message.id}`,
    prompt: message.message,
    options,
    recommendation: c.decision_recommend_resolve,
    source: 'incident',
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

function reviewToDecision(review: PersonaManualReview): PendingDecision {
  const t = getActiveTranslations();
  const c = t.athena;
  const prompt = review.description
    ? `${review.title} — ${review.description}`
    : review.title;

  const resolve = async (status: 'approved' | 'rejected'): Promise<void> => {
    try {
      await resolveReviewRow(review, status);
    } catch (err) {
      silentCatch('companion/decision:review')(err);
      // Propagate so runDecisionOption keeps the review pending + toasts on
      // failure instead of falsely clearing it as resolved.
      throw err;
    }
  };

  // Phase 5b — surface the suggested actions as dispatching options: picking one
  // resolves the review AND runs the persona to carry it out (shared action
  // model). Capped so the orb's numbered chips stay legible.
  const carryOut = async (action: string): Promise<void> => {
    try {
      await dispatchReviewRowAction(review, action);
    } catch (err) {
      silentCatch('companion/decision:review-action')(err);
      // Propagate so runDecisionOption keeps the review pending + toasts on
      // failure instead of falsely clearing it as resolved.
      throw err;
    }
  };
  const actionOptions: DecisionOption[] = parseSuggestedActions(review.suggested_actions)
    .slice(0, 4)
    .map((action, i) => ({ key: `action-${i}`, label: action, run: () => carryOut(action) }));

  const options: DecisionOption[] = [
    ...actionOptions,
    {
      key: 'approve',
      label: c.decision_approve,
      run: () => resolve('approved'),
    },
    {
      key: 'reject',
      label: c.decision_reject,
      danger: true,
      run: () => resolve('rejected'),
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
    id: `review:${review.id}`,
    prompt,
    options,
    recommendation: c.decision_recommend_review_open,
    source: 'human_review',
    sourceRef: review.id,
    navigateRoute: 'overview',
    payload: JSON.stringify({
      title: review.title,
      description: review.description,
      severity: review.severity,
      suggested_actions: review.suggested_actions,
      context_data: review.context_data,
      persona_id: review.persona_id,
      created_at: review.created_at,
    }),
  };
}

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
 * Build the current FIFO of decisions across all four sources. Approvals first
 * (most actionable), then blocking incidents, then human reviews, then
 * attention messages.
 *
 * Anything the operator skipped or snoozed is filtered out at the end (see
 * `./decisionDeferral`): the ledger is consulted HERE, once, rather than at the
 * two call sites, so "what the orb may show" has one definition.
 */
async function buildQueue(): Promise<PendingDecision[]> {
  const queue: PendingDecision[] = [];

  try {
    const approvals = await companionListPendingApprovals();
    for (const a of approvals) queue.push(approvalToDecision(a));
  } catch (err) {
    silentCatch('companion/decision:list-approvals')(err);
  }

  try {
    const proactive = await companionListProactiveMessages(true, 20);
    for (const m of proactive) {
      if (m.triggerKind === 'incident_blocker') queue.push(incidentToDecision(m));
    }
    // A revoked credential sorts with the blockers: everything bound to it is
    // failing right now, and the fix is one click away from here.
    for (const m of proactive) {
      if (m.triggerKind === 'credential_reauth') queue.push(credentialReauthToDecision(m));
    }
    // Attention messages sort after incidents (less urgent than a blocker).
    for (const m of proactive) {
      if (m.triggerKind === 'message_attention') queue.push(messageAttentionToDecision(m));
    }
  } catch (err) {
    silentCatch('companion/decision:list-proactive')(err);
  }

  try {
    // Cap 100 — the orb keeps queue[0] only; the triage deck already pages
    // this same working set. An unbounded pending dump was the always-on cost.
    const page = await listManualReviewsPage({ status: 'pending', limit: 100 });
    for (const r of page.rows) queue.push(reviewToDecision(r));
  } catch (err) {
    silentCatch('companion/decision:list-reviews')(err);
  }

  return queue.filter((d) => !isDecisionDeferred(d.id));
}

/**
 * Test seam: the queue builder, without the hook around it.
 *
 * Exported rather than re-implemented in the test so what a test exercises is
 * the real option list the orb renders — including which `applyClientAction`
 * an approved decision reaches. A test that rebuilt the options would have
 * kept passing through the very bug this seam exists to cover (the orb's
 * private navigate-only dispatcher).
 */
export const buildDecisionQueueForTest = buildQueue;

/**
 * Hook form — wires the queue. Returns a `pump` callback (also auto-pumped on
 * the gate flipping on, on approval/proactive events, and when `pendingDecision`
 * transitions back to null).
 */
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
 */
export function useDecisionQueue() {
  const pending = useAthenaStore((s) => s.pendingDecision);
  // Guard against overlapping pumps (each pump does 3 IPC round-trips).
  const pumping = useRef(false);

  const pump = useCallback(async () => {
    // Only surface when the bubble is free.
    if (useAthenaStore.getState().pendingDecision) return;
    if (pumping.current) return;
    pumping.current = true;
    try {
      const queue = await buildQueue();
      const next = queue[0];
      // Depth is recorded even when nothing is surfaced, so the bubble can say
      // how much is behind the question it is asking.
      useAthenaStore.getState().setDecisionQueueDepth(queue.length);
      // Re-check after the awaits — another path may have surfaced a decision.
      if (next && !useAthenaStore.getState().pendingDecision) {
        useAthenaStore.getState().setPendingDecision(next);
      }
    } finally {
      pumping.current = false;
    }
  }, []);

  // Pump on mount + whenever the bubble frees up (pending → null).
  useEffect(() => {
    if (!pending) void pump();
  }, [pending, pump]);

  // Re-pump when the backend mints approvals / delivers proactive nudges.
  useEffect(() => {
    const unlistenApprovals = listen(COMPANION_APPROVALS_EVENT, () => {
      void pump();
    });
    const unlistenProactive = listen(COMPANION_PROACTIVE_EVENT, () => {
      void pump();
    });
    return () => {
      unlistenApprovals
        .then((f) => f())
        .catch(silentCatch('companion/decision:unlisten'));
      unlistenProactive
        .then((f) => f())
        .catch(silentCatch('companion/decision:unlisten'));
    };
  }, [pump]);

  return { pump };
}

/**
 * Headless driver — mount once (in `AthenaGuideLayer`) to run the decision
 * queue for the whole app. Renders nothing.
 */
export function DecisionDriver() {
  useDecisionQueue();
  return null;
}
