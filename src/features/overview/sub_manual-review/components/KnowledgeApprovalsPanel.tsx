// Workspace Knowledge as a mode of the Approvals decision center.
//
// This is a DECISION QUEUE, not a library. It used to embed the whole
// `KnowledgeLibrary` — which dragged its own header, the WorkspacePulse digest
// and the Create / Extract / Project-to-repos actions into a surface whose only
// job is "adopt or reject?". Two stacked headers and four non-decision buttons
// later, the Approvals shell no longer read as a queue. So the panel now binds
// the thin `KnowledgeTree` directly, filtered to the pending statuses
// (observed + proposed — the same set the tab badge counts), and links out to
// the full library rather than reproducing it.
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Library, Sparkles } from 'lucide-react';

import { IllustrationEmptyState } from '@/features/overview/shared/emptyStatePrototype';
import type { WorkspaceCenter } from '@/features/plugins/dev-tools/sub_workspaces/centerShared';
import KnowledgeTree from '@/features/overview/sub_patterns/KnowledgeTree';
import {
  nextQueueIndex,
  viewFromRow,
  type KnowledgeItemView,
} from '@/features/overview/sub_patterns/libraryModel';
import { PracticeDetailModal } from '@/features/overview/sub_patterns/PracticeDetailModal';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

export function KnowledgeApprovalsPanel({ center }: { center: WorkspaceCenter }) {
  const { t } = useTranslation();
  const r = t.overview.review;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Snapshotted review queue — see KnowledgeLibrary: recomputing from the live
  // rows would re-sort under the cursor the moment a decision lands, and "next"
  // would stop meaning next.
  const [queue, setQueue] = useState<string[]>([]);
  const [queueIdx, setQueueIdx] = useState(0);

  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setPluginTab = useSystemStore((s) => s.setPluginTab);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);

  // Default to the first workspace once they load; keep the user's pick after.
  useEffect(() => {
    if (selectedId === null && center.workspaces.length > 0) {
      setSelectedId(center.workspaces[0]!.id);
    }
  }, [center.workspaces, selectedId]);

  const workspace = center.workspaces.find((w) => w.id === selectedId) ?? center.workspaces[0];
  const workspaceId = workspace?.id;

  const rows = useMemo(
    () => (workspaceId ? center.knowledge[workspaceId] ?? [] : []),
    [center.knowledge, workspaceId],
  );

  // Decisions only: adopted / deprecated / rejected practices are library
  // content, and the library lives one link away.
  const pending = useMemo(
    () =>
      rows
        .map(viewFromRow)
        .filter((i) => i.status === 'observed' || i.status === 'proposed'),
    [rows],
  );

  const closeDetail = () => { setQueue([]); setQueueIdx(0); };

  const openDetail = (item: KnowledgeItemView, ordered: readonly KnowledgeItemView[]) => {
    const ids = ordered.map((i) => i.id);
    const at = ids.indexOf(item.id);
    setQueue(ids.length > 0 ? ids : [item.id]);
    setQueueIdx(Math.max(0, at));
  };

  const stepDetail = (delta: -1 | 1) => {
    const next = nextQueueIndex(queue, queueIdx, delta, (id) => rows.some((row) => row.id === id));
    if (next === null) closeDetail();
    else setQueueIdx(next);
  };

  const detailRow = queue.length > 0
    ? rows.find((row) => row.id === queue[queueIdx]) ?? null
    : null;

  const openLibrary = () => {
    setSidebarSection('plugins');
    setPluginTab('dev-tools');
    setDevToolsTab('workspaces');
  };

  if (!workspace) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <IllustrationEmptyState
          motif="approval"
          content={{
            icon: Library,
            title: r.knowledge_empty_title,
            subtitle: r.knowledge_empty_subtitle,
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 p-4">
      {/* Workspace picker only when there is a choice to make — a single
          workspace needs no chrome explaining that it is the only one. */}
      {center.workspaces.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {center.workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setSelectedId(w.id)}
              aria-current={w.id === workspace.id ? 'true' : undefined}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption border transition-colors ${
                w.id === workspace.id
                  ? 'border-primary/30 bg-primary/10 text-foreground'
                  : 'border-primary/10 text-muted-foreground hover:bg-secondary/40'
              }`}
            >
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: w.color }} aria-hidden />
              {w.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0">
        {pending.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <IllustrationEmptyState
              motif="approval"
              content={{
                icon: Sparkles,
                title: r.knowledge_clear_title,
                subtitle: r.knowledge_clear_subtitle,
              }}
            />
          </div>
        ) : (
          <KnowledgeTree
            items={pending}
            projectById={center.projectById}
            onRowClick={openDetail}
          />
        )}
      </div>

      {/* One quiet line out. The library is a different job (browse, extract,
          distribute) and belongs to its own surface. */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openLibrary}
          className="inline-flex items-center gap-1 typo-caption text-muted-foreground hover:text-foreground transition-colors"
        >
          {r.knowledge_full_library_link}
          <ArrowRight className="w-3 h-3" aria-hidden />
        </button>
      </div>

      {detailRow && (
        <PracticeDetailModal
          practice={detailRow}
          projectById={center.projectById}
          onClose={closeDetail}
          onChanged={center.refreshKnowledge}
          nav={
            queue.length > 1
              ? { index: queueIdx, total: queue.length, onStep: stepDetail }
              : undefined
          }
        />
      )}
    </div>
  );
}
