/**
 * useInboxActions — bridges inbox-row affordances to the underlying
 * Overview-store mutators (approve / reject / mark-read / resolve), the
 * snooze localStorage, and overview-tab navigation for "Open".
 *
 * All handlers are stable across renders (`useCallback`) so row-level
 * memoization in `<InboxRow>` doesn't break.
 */
import { useCallback } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import type { UnifiedInboxItem } from '@/features/simple-mode/types';
import { snoozeItem, unsnoozeItem } from '../libs/snoozeStore';

/** Default snooze duration when the user hits "S" without a duration picker. */
const DEFAULT_SNOOZE_MINUTES = 60;

export function useInboxActions() {
  const updateManualReview = useOverviewStore((s) => s.updateManualReview);
  const markMessageAsRead = useOverviewStore((s) => s.markMessageAsRead);
  const resolveHealingIssue = useOverviewStore((s) => s.resolveHealingIssue);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);

  const approve = useCallback(
    async (item: UnifiedInboxItem) => {
      if (item.kind !== 'approval') return;
      await updateManualReview(item.source, { status: 'approved' });
    },
    [updateManualReview],
  );

  const reject = useCallback(
    async (item: UnifiedInboxItem) => {
      if (item.kind !== 'approval') return;
      await updateManualReview(item.source, { status: 'rejected' });
    },
    [updateManualReview],
  );

  const markRead = useCallback(
    async (item: UnifiedInboxItem) => {
      if (item.kind !== 'message' && item.kind !== 'output') return;
      await markMessageAsRead(item.source);
    },
    [markMessageAsRead],
  );

  const resolveHealth = useCallback(
    async (item: UnifiedInboxItem) => {
      if (item.kind !== 'health') return;
      await resolveHealingIssue(item.source, item.personaId);
    },
    [resolveHealingIssue],
  );

  /** Take whatever the canonical "Resolve / dismiss" action is for this kind. */
  const resolve = useCallback(
    async (item: UnifiedInboxItem) => {
      switch (item.kind) {
        case 'approval':
          return approve(item);
        case 'message':
        case 'output':
          return markRead(item);
        case 'health':
          return resolveHealth(item);
      }
    },
    [approve, markRead, resolveHealth],
  );

  const snooze = useCallback((item: UnifiedInboxItem, minutes: number = DEFAULT_SNOOZE_MINUTES) => {
    snoozeItem(item.id, minutes);
  }, []);

  const unsnooze = useCallback((item: UnifiedInboxItem) => {
    unsnoozeItem(item.id);
  }, []);

  const open = useCallback(
    (item: UnifiedInboxItem) => {
      switch (item.kind) {
        case 'approval':
          setOverviewTab('manual-review');
          return;
        case 'message':
        case 'output':
          setOverviewTab('messages');
          return;
        case 'health':
          setOverviewTab('health');
          return;
      }
    },
    [setOverviewTab],
  );

  return { approve, reject, markRead, resolveHealth, resolve, snooze, unsnooze, open };
}

export type InboxActions = ReturnType<typeof useInboxActions>;
