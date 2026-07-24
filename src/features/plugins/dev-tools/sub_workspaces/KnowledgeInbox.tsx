// Library variant B3 — "Inbox": governance-first. The monthly influx bars
// make the growth curve visible; the review queue (proposed + observed,
// newest first, month-grouped, virtualized) leads with adopt/reject actions
// inline; the adopted corpus condenses into a count line + collapsible
// stream. The mental model: the librarian's desk — what arrived, what needs
// a decision, what's canon.
import { useMemo, useState } from 'react';
import { Check, ChevronRight, X } from 'lucide-react';

import { decideWorkspaceKnowledge } from '@/api/devTools/workspaces';
import { GroupedVirtualList } from '@/features/shared/components/display/GroupedVirtualList';
import type { DevProject } from '@/lib/bindings/DevProject';
import { toastCatch } from '@/lib/silentCatch';

import { InfluxBars, ITEM_ROW_SIZE, ItemRow } from './LibraryBits';
import {
  monthKey,
  monthLabel,
  monthlyInflux,
  type KnowledgeItemView,
} from './libraryModel';

export default function KnowledgeInbox({
  items,
  projectById,
  workspaceId,
  onDecided,
}: {
  items: KnowledgeItemView[];
  projectById: Map<string, DevProject>;
  workspaceId: string;
  onDecided: () => void;
}) {
  // Local verdicts let demo rows react instantly (and real rows respond
  // optimistically while the backend refresh is in flight).
  const [verdicts, setVerdicts] = useState<Record<string, 'adopted' | 'rejected'>>({});
  const [showAdopted, setShowAdopted] = useState(false);

  const effective = useMemo(
    () =>
      items.map((i) => (verdicts[i.id] ? { ...i, status: verdicts[i.id]! } : i)),
    [items, verdicts],
  );

  const queue = useMemo(
    () =>
      effective
        .filter((i) => i.status === 'proposed' || i.status === 'observed')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [effective],
  );
  const adopted = useMemo(
    () =>
      effective
        .filter((i) => i.status === 'adopted')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [effective],
  );
  const influx = useMemo(() => monthlyInflux(effective), [effective]);

  const decide = (item: KnowledgeItemView, decision: 'adopt' | 'reject') => {
    setVerdicts((prev) => ({ ...prev, [item.id]: decision === 'adopt' ? 'adopted' : 'rejected' }));
    if (!item.mock) {
      decideWorkspaceKnowledge(item.id, decision)
        .then(onDecided)
        .catch(toastCatch('workspaces:inboxDecide'));
    }
  };

  const monthGroup = (item: KnowledgeItemView) => {
    const key = monthKey(item.createdAt);
    return { key, label: monthLabel(key) };
  };

  return (
    <div className="flex flex-col min-h-0 h-full gap-3">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="typo-data-lg text-foreground">{queue.length}</div>
          <div className="typo-caption text-muted-foreground">awaiting review</div>
        </div>
        <InfluxBars influx={influx} />
      </div>

      <GroupedVirtualList
        items={queue}
        groupOf={monthGroup}
        getItemKey={(item) => item.id}
        renderItem={(item) => (
          <ItemRow
            item={item}
            projectById={projectById}
            actions={
              <span className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  aria-label="Adopt"
                  onClick={() => decide(item, 'adopt')}
                  className="rounded-interactive p-1 text-status-success hover:bg-status-success/10 transition-colors"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Reject"
                  onClick={() => decide(item, 'reject')}
                  className="rounded-interactive p-1 text-status-error hover:bg-status-error/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </span>
            }
          />
        )}
        estimateItemSize={ITEM_ROW_SIZE}
        className="flex-1 min-h-0 rounded-card border border-primary/10"
        scrollRestoreKey={`ws-inbox-${workspaceId}`}
      />

      <div className="rounded-card border border-primary/10">
        <button
          type="button"
          onClick={() => setShowAdopted((v) => !v)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/30 transition-colors"
        >
          <ChevronRight
            className={`w-4 h-4 text-foreground/70 transition-transform ${showAdopted ? 'rotate-90' : ''}`}
          />
          <span className="typo-body text-foreground">Adopted canon</span>
          <span className="typo-caption text-muted-foreground">{adopted.length} practices</span>
        </button>
        {showAdopted && (
          <GroupedVirtualList
            items={adopted}
            groupOf={monthGroup}
            getItemKey={(item) => item.id}
            renderItem={(item) => <ItemRow item={item} projectById={projectById} />}
            estimateItemSize={ITEM_ROW_SIZE}
            className="h-64 border-t border-primary/10"
            scrollRestoreKey={`ws-inbox-adopted-${workspaceId}`}
          />
        )}
      </div>
    </div>
  );
}
