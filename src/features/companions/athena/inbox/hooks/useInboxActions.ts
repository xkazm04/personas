/**
 * useInboxActions — centralized per-kind action dispatcher for inbox renderers
 * (Cockpit DecisionsPanel, inline DecisionsCard, overview triage).
 *
 * Given the currently-selected `UnifiedInboxItem`, returns a stable three-slot
 * action descriptor (`primary` / `secondary` / `tertiary`) whose `run()` hooks
 * call the correct `useOverviewStore` action under the hood. Detail components
 * render buttons from these descriptors rather than calling store actions
 * directly — action logic stays in one place.
 *
 * Per-kind mapping:
 *   - approval: Approve / Defer / Reject
 *   - health:   Resolve / Dismiss
 *   - message:  Mark as read
 *   - output:   Mark as read
 *
 * Approve / Reject / Resolve / Mark-as-read are backend transitions. Defer and
 * Dismiss have no backend counterpart (no "deferred" review status, and
 * healing issues accept only open | auto_fix_pending | resolved), so they run
 * through the inbox-local snooze registry in `../snooze`: the item leaves this
 * inbox, the record itself is untouched. They are still real state changes -
 * they were empty lambdas, which made both buttons false affordances.
 */
import { useMemo } from 'react';

import { useOverviewStore } from '@/stores/overviewStore';

import { deferInboxItem, dismissInboxItem } from '../snooze';
import type { UnifiedInboxItem } from '../types';
import type { Tone } from '../_shared/inboxTone';

export type ActionTone = Tone | null;

export type InboxActionLabelKey =
  | 'action_approve'
  | 'action_reject'
  | 'action_defer'
  | 'action_resolve'
  | 'action_dismiss'
  | 'action_mark_read';

export interface InboxActionDescriptor {
  labelKey: InboxActionLabelKey;
  tone: ActionTone;
  run: (notes?: string) => Promise<void>;
}

export interface InboxActions {
  primary: InboxActionDescriptor | null;
  secondary: InboxActionDescriptor | null;
  tertiary: InboxActionDescriptor | null;
}

const EMPTY_ACTIONS: InboxActions = { primary: null, secondary: null, tertiary: null };

export function useInboxActions(item: UnifiedInboxItem | null): InboxActions {
  const updateManualReview = useOverviewStore((s) => s.updateManualReview);
  const markReportAsRead = useOverviewStore((s) => s.markReportAsRead);
  const resolveHealingIssue = useOverviewStore((s) => s.resolveHealingIssue);

  return useMemo<InboxActions>(() => {
    if (!item) return EMPTY_ACTIONS;

    switch (item.kind) {
      case 'approval':
        return {
          primary: {
            labelKey: 'action_approve',
            tone: 'amber',
            run: async (notes) => {
              await updateManualReview(item.source, {
                status: 'approved',
                reviewer_notes: notes && notes.length > 0 ? notes : undefined,
              });
            },
          },
          secondary: {
            labelKey: 'action_defer',
            tone: null,
            // Inbox-local by design: there is no backend "deferred" review
            // status, so Defer hides the item from this inbox for an hour and
            // lets it come back. See ../snooze.
            run: async () => {
              deferInboxItem(item.id);
            },
          },
          tertiary: {
            labelKey: 'action_reject',
            tone: 'rose',
            run: async (notes) => {
              await updateManualReview(item.source, {
                status: 'rejected',
                reviewer_notes: notes && notes.length > 0 ? notes : undefined,
              });
            },
          },
        };

      case 'health':
        return {
          primary: {
            labelKey: 'action_resolve',
            tone: 'emerald',
            run: async () => {
              await resolveHealingIssue(item.source, item.personaId);
            },
          },
          secondary: null,
          tertiary: {
            labelKey: 'action_dismiss',
            tone: null,
            // `persona_healing_issues` has no `dismissed` status - Resolve is
            // the only terminal transition. Dismiss therefore takes the issue
            // out of the inbox without claiming it was fixed; it stays open in
            // the Health surface.
            run: async () => {
              dismissInboxItem(item.id);
            },
          },
        };

      case 'message':
        return {
          primary: {
            labelKey: 'action_mark_read',
            tone: 'violet',
            run: async () => {
              await markReportAsRead(item.source);
            },
          },
          secondary: null,
          tertiary: null,
        };

      case 'output':
        return {
          primary: {
            labelKey: 'action_mark_read',
            tone: 'emerald',
            run: async () => {
              await markReportAsRead(item.source);
            },
          },
          secondary: null,
          tertiary: null,
        };
    }
  }, [item, updateManualReview, markReportAsRead, resolveHealingIssue]);
}
