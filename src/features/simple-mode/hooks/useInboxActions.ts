/**
 * useInboxActions — centralized per-kind action dispatcher for the Simple-mode
 * Inbox variant (Phase 09).
 *
 * Given the currently-selected `UnifiedInboxItem`, returns a stable three-slot
 * action descriptor (`primary` / `secondary` / `tertiary`) whose `run()` hooks
 * call the correct `useOverviewStore` action under the hood. Detail components
 * render buttons from these descriptors rather than calling store actions
 * directly — action logic stays in one place and the variant's bottom action
 * zone can render the same three buttons regardless of selected kind.
 *
 * Per-kind mapping:
 *   - approval: Approve / Defer / Reject (all amber/rose-toned; notes passed through).
 *   - health:   Resolve (emerald) / Dismiss (no-op in v1).
 *   - message:  Mark as read (violet).
 *   - output:   Mark as read (emerald; no-op in v1 — output items are not emitted yet).
 *
 * API signatures verified against the live store slices (2026-04-21):
 *   - `updateManualReview(id, { status, reviewer_notes })`  — overviewSlice.ts
 *   - `markMessageAsRead(id)`                                — messageSlice.ts  ← PLAN said `markMessageRead` (store actually names it `markMessageAsRead`)
 *   - `resolveHealingIssue(id, personaId?)`                  — healingSlice.ts
 *
 * Deviation note (Rule 1/3): the PLAN referenced `markMessageRead` but the
 * store action is `markMessageAsRead`. Adjusted inline without inventing a
 * new method; documented here so future readers aren't mystified.
 *
 * The hook is a pure dispatcher — no unit tests required (integration is
 * covered by Phase 14 QA). Keep `useMemo` dependencies in sync when adding
 * new action slots.
 */
import { useMemo } from 'react';

import { useOverviewStore } from '@/stores/overviewStore';

import type { UnifiedInboxItem } from '../types';

/** Tones are constrained to the Phase 11 closed palette. `null` = no accent. */
export type ActionTone = 'amber' | 'violet' | 'emerald' | 'rose' | 'gold' | null;

/** i18n key type — narrow to the Inbox subsection so consumers get autocomplete. */
export type InboxActionLabelKey =
  | 'action_approve'
  | 'action_reject'
  | 'action_defer'
  | 'action_resolve'
  | 'action_dismiss'
  | 'action_mark_read';

/** One action button descriptor. `run()` is always async so the variant can
 *  show a "Working…" state around `await` calls. */
export interface InboxActionDescriptor {
  labelKey: InboxActionLabelKey;
  tone: ActionTone;
  run: (notes?: string) => Promise<void>;
}

/** Shape returned by the hook. All three slots are optional — the variant
 *  should render only the ones that are non-null. */
export interface InboxActions {
  primary: InboxActionDescriptor | null;
  secondary: InboxActionDescriptor | null;
  tertiary: InboxActionDescriptor | null;
}

const EMPTY_ACTIONS: InboxActions = { primary: null, secondary: null, tertiary: null };

/**
 * Build the action triple for the given selected item. Returns an empty
 * triple when no item is selected (e.g. empty inbox).
 *
 * Memoized on (item, store-actions) so the variant's keyboard-nav effect can
 * depend on `actions` without re-binding the listener on every render.
 */
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
            // v1: visually dismiss — no persisted state change. A future phase
            // may introduce a "deferred" filter bucket.
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
        // Output items are reserved (see types.ts); the hook still returns a
        // usable action so future emission lands cleanly.
        return {
          primary: {
            labelKey: 'action_mark_read',
            tone: 'emerald',
            run: async () => {},
          },
          secondary: null,
          tertiary: null,
        };
    }
  }, [item, updateManualReview, markMessageAsRead, resolveHealingIssue]);
}
