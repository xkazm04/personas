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
  type ClientAction,
  type PendingApproval,
  type ProactiveMessage,
} from '@/api/companion';
import {
  listManualReviews,
  updateManualReviewStatus,
  dispatchReviewAction,
} from '@/api/overview/reviews';
import { parseSuggestedActions } from '@/lib/reviews/suggestedActions';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { SidebarSection } from '@/lib/types/types';
import { useCompanionStore } from '../companionStore';
import { actionLabel } from '../athenaLabels';
import type { DecisionOption, PendingDecision } from './types';

/**
 * Athena hands-free decision queue (P3, slice 3).
 *
 * Aggregates the three live decision sources — pending approvals, blocking
 * incidents (proactive `incident_blocker` nudges), and pending human reviews —
 * into a single FIFO of {@link PendingDecision}s and feeds them one-at-a-time
 * into `companionStore.pendingDecision`, only when none is currently pending.
 *
 * The whole auto-surfacing path is gated behind the persisted
 * `companionHandsFreeDecisions` setting (default false). When off, the queue
 * does nothing — the bubble can still be driven manually (or by tests) via
 * `setPendingDecision`.
 *
 * Mount once via {@link DecisionDriver} (inside `AthenaGuideLayer`). It
 * subscribes to the `companion://approvals` + `companion://proactive` Tauri
 * events and re-pumps the queue whenever the gate flips on or a decision
 * resolves (clearing `pendingDecision`).
 */

const VALID_ROUTES: SidebarSection[] = [
  'home',
  'overview',
  'personas',
  'events',
  'credentials',
  'design-reviews',
  'plugins',
  'schedules',
  'settings',
];

/** Apply an approval's UI-only follow-up (currently just `navigate`). */
function applyClientAction(action: ClientAction) {
  if (action.type === 'navigate') {
    const route = action.route as SidebarSection;
    if (!VALID_ROUTES.includes(route)) return;
    useSystemStore.getState().setSidebarSection(route);
  }
  // Other ClientAction kinds (prefill / open_companion_tab) are not produced by
  // the approval paths the hands-free queue surfaces; leave them to the
  // in-chat ApprovalCard.
}

/**
 * Approvals with a low blast-radius are recommended for approval; everything
 * else nudges the user to look closer. Deliberately conservative — the
 * recommendation only shows when the user explicitly asks (picks `0`).
 */
const LOW_RISK_ACTIONS = new Set([
  'run_persona',
  'write_fact',
  'write_goal',
  'write_ritual',
  'write_backlog_item',
  'register_project',
  'compose_dashboard',
  'compose_cockpit',
]);

function approvalToDecision(approval: PendingApproval): PendingDecision {
  const t = getActiveTranslations();
  const c = t.plugins.companion;
  const label = actionLabel(t, approval.action);
  const prompt = approval.rationale ? `${label}: ${approval.rationale}` : label;

  const resolve = async (
    run: () => Promise<ApprovalOutcome>,
  ): Promise<void> => {
    try {
      const outcome = await run();
      useCompanionStore.getState().removeApproval(approval.id);
      if (outcome.clientAction) applyClientAction(outcome.clientAction);
    } catch (err) {
      silentCatch('companion/decision:approval')(err);
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

  const lowRisk = LOW_RISK_ACTIONS.has(approval.action);
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
  const c = t.plugins.companion;

  const options: DecisionOption[] = [
    {
      key: 'resolve',
      label: c.decision_resolve,
      run: () => {
        // Mirror ProactiveCard's incident_blocker engage path: take the user
        // to Overview → Incidents and deep-link the specific incident.
        useSystemStore.getState().setSidebarSection('overview');
        useOverviewStore.getState().setOverviewTab('incidents');
        if (message.triggerRef) {
          setPendingIncidentDeepLink(message.triggerRef);
          storeBus.emit('incidents:open-detail', { incidentId: message.triggerRef });
        }
        useCompanionStore.getState().removeProactive(message.id);
      },
    },
    {
      key: 'dismiss',
      label: c.decision_dismiss,
      danger: true,
      run: async () => {
        try {
          await companionDismissProactive(message.id);
          useCompanionStore.getState().removeProactive(message.id);
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
  const c = t.plugins.companion;
  const prompt = review.description
    ? `${review.title} — ${review.description}`
    : review.title;

  const resolve = async (status: 'approved' | 'rejected'): Promise<void> => {
    try {
      await updateManualReviewStatus(review.id, status);
    } catch (err) {
      silentCatch('companion/decision:review')(err);
    }
  };

  // Phase 5b — surface the suggested actions as dispatching options: picking one
  // resolves the review AND runs the persona to carry it out (shared action
  // model). Capped so the orb's numbered chips stay legible.
  const carryOut = async (action: string): Promise<void> => {
    try {
      await dispatchReviewAction(review.id, action);
    } catch (err) {
      silentCatch('companion/decision:review-action')(err);
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
 * Build the current FIFO of decisions across all three sources. Approvals
 * first (most actionable), then blocking incidents, then human reviews.
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
    const proactive = await companionListProactiveMessages(true);
    for (const m of proactive) {
      if (m.triggerKind === 'incident_blocker') queue.push(incidentToDecision(m));
    }
  } catch (err) {
    silentCatch('companion/decision:list-proactive')(err);
  }

  try {
    const reviews = await listManualReviews(undefined, 'pending');
    for (const r of reviews) queue.push(reviewToDecision(r));
  } catch (err) {
    silentCatch('companion/decision:list-reviews')(err);
  }

  return queue;
}

/**
 * Hook form — wires the queue. Returns a `pump` callback (also auto-pumped on
 * the gate flipping on, on approval/proactive events, and when `pendingDecision`
 * transitions back to null).
 */
/**
 * The orb decision queue is active when the user explicitly enabled hands-free
 * decisions OR when autonomous mode is on. In autonomous mode Athena is already
 * acting on the user's behalf, so the steps she is NOT confident enough to
 * auto-apply (e.g. a medium/low-confidence fleet next-instruction) must surface
 * as a consult on the orb rather than sitting invisibly in the approval list.
 */
function decisionsActive(): boolean {
  const s = useSystemStore.getState();
  return s.companionHandsFreeDecisions || s.companionAutonomousMode;
}

export function useDecisionQueue() {
  const enabled = useSystemStore(
    (s) => s.companionHandsFreeDecisions || s.companionAutonomousMode,
  );
  const pending = useCompanionStore((s) => s.pendingDecision);
  // Guard against overlapping pumps (each pump does 3 IPC round-trips).
  const pumping = useRef(false);

  const pump = useCallback(async () => {
    if (!decisionsActive()) return;
    // Only surface when the bubble is free.
    if (useCompanionStore.getState().pendingDecision) return;
    if (pumping.current) return;
    pumping.current = true;
    try {
      const queue = await buildQueue();
      const next = queue[0];
      // Re-check both gates after the awaits — the user may have flipped the
      // setting off or another path may have surfaced a decision meanwhile.
      if (
        next &&
        decisionsActive() &&
        !useCompanionStore.getState().pendingDecision
      ) {
        useCompanionStore.getState().setPendingDecision(next);
      }
    } finally {
      pumping.current = false;
    }
  }, []);

  // Pump on enable + whenever the bubble frees up (pending → null).
  useEffect(() => {
    if (enabled && !pending) void pump();
  }, [enabled, pending, pump]);

  // Re-pump when the backend mints approvals / delivers proactive nudges.
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, pump]);

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
