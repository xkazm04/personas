// Variant A1 — "Rail": a navigator's master-detail. The workspace is a place
// you VISIT: a persistent left rail lists every workspace (identity dot,
// membership + library tallies), the right pane is the selected workspace's
// full record — identity header, membership editor, knowledge peek. Optimised
// for portfolios with several workspaces and frequent switching.
import { useState } from 'react';
import { Landmark, Trash2 } from 'lucide-react';

import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';

import {
  CreateWorkspaceInline,
  KnowledgePeek,
  MembershipPanel,
  useWorkspaceCenter,
} from './centerShared';
import { deleteWorkspace, recolorWorkspace, renameWorkspace, WORKSPACE_COLORS } from './workspaceStore';

export default function WorkspacesRail() {
  const center = useWorkspaceCenter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const selected =
    center.workspaces.find((w) => w.id === selectedId) ?? center.workspaces[0] ?? null;

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-64 shrink-0 border-r border-primary/10 flex flex-col">
        <div className="p-3 flex flex-col gap-1 overflow-y-auto flex-1">
          {center.workspaces.map((ws) => {
            const stats = center.stats[ws.id];
            const active = selected?.id === ws.id;
            return (
              <button
                key={ws.id}
                type="button"
                onClick={() => setSelectedId(ws.id)}
                className={`flex items-center gap-2.5 rounded-interactive px-2.5 py-2 text-left transition-colors ${
                  active ? 'bg-primary/10' : 'hover:bg-secondary/40'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: ws.color }} />
                <span className="min-w-0 flex-1">
                  <span className="typo-body text-foreground block truncate">{ws.name}</span>
                  <span className="typo-caption text-muted-foreground block">
                    {ws.projectIds.length} projects · {stats?.adopted ?? 0} adopted
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="p-3 border-t border-primary/10">
          <CreateWorkspaceInline />
        </div>
      </aside>

      <section className="flex-1 min-w-0 overflow-y-auto p-6">
        {!selected ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-14 h-14 rounded-xl border border-primary/15 bg-secondary/35 flex items-center justify-center">
              <Landmark className="w-6 h-6 text-primary/70" />
            </div>
            <p className="typo-body text-foreground max-w-sm">
              Create your first workspace to start grouping projects and growing a shared
              best-practice library.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 max-w-3xl">
            <header className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <input
                  key={selected.id}
                  defaultValue={selected.name}
                  onBlur={(e) => renameWorkspace(selected.id, e.target.value)}
                  className="typo-title-lg text-foreground bg-transparent border-b border-transparent focus:border-primary/30 focus:outline-none w-full"
                  aria-label="Workspace name"
                />
                <div className="mt-2 flex items-center gap-1.5">
                  {WORKSPACE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Set colour ${c}`}
                      onClick={() => recolorWorkspace(selected.id, c)}
                      className={`h-4 w-4 rounded-full transition-transform ${
                        selected.color === c ? 'ring-2 ring-foreground/60 ring-offset-1 ring-offset-background' : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDelete(selected.id)}
                aria-label="Delete workspace"
                className="shrink-0 rounded-interactive p-2 text-foreground/70 hover:text-status-error hover:bg-status-error/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </header>

            <div className="rounded-card border border-primary/10 p-4">
              <h2 className="typo-section-title text-foreground mb-3">Projects</h2>
              <MembershipPanel workspace={selected} projects={center.projects} />
            </div>

            <div className="rounded-card border border-primary/10 p-4">
              <h2 className="typo-section-title text-foreground mb-3">Knowledge library</h2>
              <KnowledgePeek items={center.knowledge[selected.id] ?? []} />
            </div>
          </div>
        )}
      </section>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this workspace?"
          body="Projects stay untouched — they just become unassigned. The workspace's knowledge library is removed."
          danger
          onConfirm={() => {
            deleteWorkspace(confirmDelete);
            setConfirmDelete(null);
            setSelectedId(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
