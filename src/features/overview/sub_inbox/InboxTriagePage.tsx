/**
 * InboxTriagePage — Power-mode unified triage surface.
 *
 * Aggregates pending action items from four sources via `useUnifiedInbox`
 * (manual-review approvals, unread persona messages, output-like artifacts,
 * open healing issues), then partitions them into temporal swimlanes
 * (Today / This Week / Snoozed / Resolved). The user can:
 *
 *   - Triage with the keyboard: J/K to move, Enter to open, A approve,
 *     R reject/resolve, S snooze, X toggle selection, Esc clear selection
 *   - Take per-row actions via hover chips
 *   - Take bulk actions across selected rows via the floating toolbar
 *   - See the rule that surfaced each row via an info-icon tooltip
 *
 * Snooze is persisted in localStorage; resolve / approve / reject mutate the
 * underlying overview-store slices and refresh on success. Resolved is a
 * session-local recent-actions log so the user can scan what just got cleared.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useUnifiedInbox } from '@/features/simple-mode/hooks/useUnifiedInbox';
import type { UnifiedInboxItem } from '@/features/simple-mode/types';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { InboxRow } from './components/InboxRow';
import { SwimlaneFilters } from './components/SwimlaneFilters';
import { InboxBulkBar } from './components/InboxBulkBar';
import { useInboxActions } from './hooks/useInboxActions';
import { useInboxKeyboard } from './hooks/useInboxKeyboard';
import { useSnoozeMap } from './hooks/useSnoozeMap';
import { partitionSwimlanes, type SwimlaneId } from './libs/swimlane';

/** Cap on the resolved-history log; trimmed FIFO per render. */
const RESOLVED_LOG_CAP = 50;

export default function InboxTriagePage() {
  const { t } = useTranslation();
  const r = t.overview.inbox_triage;

  const items = useUnifiedInbox();
  const snoozeMap = useSnoozeMap();
  const actions = useInboxActions();

  const [activeLane, setActiveLane] = useState<SwimlaneId>('today');
  const [cursorIndex, setCursorIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Recently-resolved snapshot for the Resolved swimlane (session local).
   *  Populated only by in-page actions, since once an item leaves the inbox
   *  store the page can't reconstruct it from outside mutations. */
  const [resolvedLog, setResolvedLog] = useState<UnifiedInboxItem[]>([]);

  // Append a snapshot to the resolved log when an in-page action fires.
  const recordResolved = useCallback((item: UnifiedInboxItem) => {
    setResolvedLog((prev) => {
      const next = [item, ...prev.filter((p) => p.id !== item.id)];
      return next.slice(0, RESOLVED_LOG_CAP);
    });
  }, []);

  // Wrap actions so each in-page mutation also records into the resolved log.
  const wrappedActions = useMemo(() => ({
    ...actions,
    approve: async (item: UnifiedInboxItem) => {
      await actions.approve(item);
      recordResolved(item);
    },
    reject: async (item: UnifiedInboxItem) => {
      await actions.reject(item);
      recordResolved(item);
    },
    markRead: async (item: UnifiedInboxItem) => {
      await actions.markRead(item);
      recordResolved(item);
    },
    resolveHealth: async (item: UnifiedInboxItem) => {
      await actions.resolveHealth(item);
      recordResolved(item);
    },
    resolve: async (item: UnifiedInboxItem) => {
      await actions.resolve(item);
      recordResolved(item);
    },
  }), [actions, recordResolved]);

  const buckets = useMemo(() => {
    const partitioned = partitionSwimlanes(items, snoozeMap);
    return { ...partitioned, resolved: resolvedLog };
  }, [items, snoozeMap, resolvedLog]);

  const laneItems = buckets[activeLane];

  // Reset cursor when the active lane changes or the visible item set shrinks.
  useEffect(() => {
    setCursorIndex((prev) => {
      if (laneItems.length === 0) return 0;
      return Math.min(prev, laneItems.length - 1);
    });
  }, [activeLane, laneItems.length]);

  // Drop selected ids that are no longer in the visible lane (e.g. snoozed).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(laneItems.map((i) => i.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [laneItems]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleResolveAll = useCallback(() => {
    const targets = laneItems.filter((i) => selectedIds.has(i.id));
    for (const item of targets) {
      void wrappedActions.resolve(item);
    }
    clearSelection();
  }, [laneItems, selectedIds, wrappedActions, clearSelection]);

  const handleSnoozeAll = useCallback(() => {
    const targets = laneItems.filter((i) => selectedIds.has(i.id));
    for (const item of targets) wrappedActions.snooze(item);
    clearSelection();
  }, [laneItems, selectedIds, wrappedActions, clearSelection]);

  useInboxKeyboard({
    enabled: true,
    items: laneItems,
    cursorIndex,
    setCursorIndex,
    selectedIds,
    toggleSelected,
    clearSelection,
    actions: wrappedActions,
  });

  const focusedId = laneItems[cursorIndex]?.id ?? null;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Inbox className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title={r.title}
        subtitle={r.subtitle}
        actions={
          <span className="typo-caption text-foreground/55 italic">
            {r.keyboard_hint}
          </span>
        }
      />
      <ContentBody>
        <div className="px-4 py-3 border-b border-primary/10">
          <SwimlaneFilters active={activeLane} buckets={buckets} onChange={setActiveLane} />
        </div>

        <div className="relative flex-1 min-h-0 flex flex-col">
          {laneItems.length === 0 ? (
            <EmptyLane laneId={activeLane} />
          ) : (
            <ul className="flex-1 overflow-auto divide-y divide-primary/5">
              {laneItems.map((item) => (
                <li key={item.id}>
                  <InboxRow
                    item={item}
                    focused={item.id === focusedId}
                    selected={selectedIds.has(item.id)}
                    snoozedUntil={snoozeMap[item.id] ?? null}
                    onToggleSelect={toggleSelected}
                    onClick={(id) => {
                      const idx = laneItems.findIndex((it) => it.id === id);
                      if (idx >= 0) setCursorIndex(idx);
                    }}
                    actions={wrappedActions}
                  />
                </li>
              ))}
            </ul>
          )}

          <InboxBulkBar
            count={selectedIds.size}
            onResolveAll={handleResolveAll}
            onSnoozeAll={handleSnoozeAll}
            onClear={clearSelection}
          />
        </div>
      </ContentBody>
    </ContentBox>
  );
}

function EmptyLane({ laneId }: { laneId: SwimlaneId }) {
  const { t } = useTranslation();
  const r = t.overview.inbox_triage;
  const messages: Record<SwimlaneId, { title: string; description: string }> = {
    today: { title: r.empty_today_title, description: r.empty_today_description },
    week: { title: r.empty_week_title, description: r.empty_week_description },
    snoozed: { title: r.empty_snoozed_title, description: r.empty_snoozed_description },
    resolved: { title: r.empty_resolved_title, description: r.empty_resolved_description },
  };
  const msg = messages[laneId];
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-12 h-12 rounded-card bg-secondary/40 border border-primary/10 flex items-center justify-center mb-3">
        <Inbox className="w-5 h-5 text-foreground/70" />
      </div>
      <p className="typo-heading text-foreground">{msg.title}</p>
      <p className="typo-body text-foreground/60 mt-1 max-w-sm">{msg.description}</p>
    </div>
  );
}
