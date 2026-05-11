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
 */
import { useMemo } from 'react';

import { useOverviewStore } from '@/stores/overviewStore';

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
  const markMessageAsRead = useOverviewStore((s) => s.markMessageAsRead);
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
            run: async () => {},
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
            run: async () => {},
          },
        };

      case 'message':
        return {
          primary: {
            labelKey: 'action_mark_read',
            tone: 'violet',
            run: async () => {
              await markMessageAsRead(item.source);
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
              await markMessageAsRead(item.source);
            },
          },
          secondary: null,
          tertiary: null,
        };
    }
  }, [item, updateManualReview, markMessageAsRead, resolveHealingIssue]);
}
