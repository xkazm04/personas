// Workspace Knowledge as a mode of the Approvals decision center.
//
// The library used to live only under Plugins → Dev Tools → Workspaces, which
// meant the third kind of "should this be accepted?" decision was two clicks
// and a mental context-switch away from the other two. The library itself is
// unchanged and still rendered from its own module — this is a host, not a
// fork. `useWorkspaceCenter` already owns loading (workspaces + their knowledge
// + projects), so hosting it elsewhere costs one hook call.
import { useEffect, useState } from 'react';
import { Library } from 'lucide-react';

import { IllustrationEmptyState } from '@/features/overview/shared/emptyStatePrototype';
import KnowledgeLibrary from '@/features/plugins/dev-tools/sub_workspaces/KnowledgeLibrary';
import type { WorkspaceCenter } from '@/features/plugins/dev-tools/sub_workspaces/centerShared';
import { useTranslation } from '@/i18n/useTranslation';

export function KnowledgeApprovalsPanel({ center }: { center: WorkspaceCenter }) {
  const { t } = useTranslation();
  const r = t.overview.review;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first workspace once they load; keep the user's pick after.
  useEffect(() => {
    if (selectedId === null && center.workspaces.length > 0) {
      setSelectedId(center.workspaces[0]!.id);
    }
  }, [center.workspaces, selectedId]);

  const workspace = center.workspaces.find((w) => w.id === selectedId) ?? center.workspaces[0];

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
        <KnowledgeLibrary
          workspace={workspace}
          rows={center.knowledge[workspace.id] ?? []}
          projectById={center.projectById}
          onChanged={center.refreshKnowledge}
        />
      </div>
    </div>
  );
}
