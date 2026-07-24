// MANAGER PAGE — DIRECTION A: "Workspace rail".
//
// A persistent left rail, the way a mail client or an IDE shows folders. The
// full set is visible at once with live counts, so "which workspace is this
// project in, and how are they balanced" is answered without opening anything
// — and the rail keeps its place while you work the table beside it.
//
// Scales down badly past ~12 workspaces (the rail scrolls independently) and
// costs ~200px of horizontal room the table would otherwise use. Directional
// opposite of Tabs.
import { useState } from 'react';
import { Layers, MoreHorizontal, Plus } from 'lucide-react';

import { createWorkspace, unassignedProjects, type Workspace } from './workspaceStore';
import { WorkspaceEditMenu } from './WorkspaceEditMenu';

const COPY = {
  title: 'Workspaces',
  all: 'All projects',
  unassigned: 'Unassigned',
  newWorkspace: 'New workspace',
  edit: 'Edit workspace',
  empty: 'No workspaces yet — group your projects to scope every module to one.',
};

export function WorkspaceRail({ projects, workspaces, activeId, onSelect }: {
  projects: { id: string }[];
  workspaces: Workspace[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const loose = unassignedProjects(projects, workspaces).length;

  const row = (
    key: string,
    active: boolean,
    color: string | null,
    label: string,
    count: number,
    onClick: () => void,
    ws?: Workspace,
  ) => (
    <div key={key} className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'true' : undefined}
        className={`group/row w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-body transition-colors ${
          active ? 'bg-primary/10 text-foreground font-medium' : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground'
        }`}
        data-testid={`workspace-rail-${key}`}
      >
        {color
          ? <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} aria-hidden />
          : <Layers className="w-3.5 h-3.5 flex-shrink-0 text-foreground/50" aria-hidden />}
        <span className="flex-1 truncate text-left">{label}</span>
        <span className="typo-caption text-foreground/45 tabular-nums">{count}</span>
        {ws && (
          <span
            role="button"
            tabIndex={0}
            aria-label={COPY.edit}
            onClick={(e) => { e.stopPropagation(); setEditing(editing === ws.id ? null : ws.id); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setEditing(ws.id); } }}
            className="p-0.5 rounded-interactive text-foreground/40 opacity-0 group-hover/row:opacity-100 hover:text-foreground hover:bg-primary/10 transition-all"
            data-testid={`workspace-rail-edit-${ws.id}`}
          >
            <MoreHorizontal className="w-3.5 h-3.5" aria-hidden />
          </span>
        )}
      </button>
      {ws && editing === ws.id && (
        <WorkspaceEditMenu ws={ws} onClose={() => setEditing(null)} className="absolute left-full top-0 ml-2" />
      )}
    </div>
  );

  return (
    <aside className="w-[212px] flex-shrink-0 rounded-card border border-primary/10 bg-secondary/20 flex flex-col self-start" data-testid="workspace-rail">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-primary/10 bg-primary/5 rounded-t-card">
        <span className="typo-label text-foreground/90">{COPY.title}</span>
        <span className="typo-caption text-foreground/50 tabular-nums">{workspaces.length}</span>
        <button
          type="button"
          onClick={() => createWorkspace('New workspace')}
          aria-label={COPY.newWorkspace}
          title={COPY.newWorkspace}
          className="ml-auto p-1 rounded-interactive text-primary hover:bg-primary/10 transition-colors focus-ring"
          data-testid="workspace-rail-new"
        >
          <Plus className="w-4 h-4" aria-hidden />
        </button>
      </div>

      <div className="p-1.5 space-y-0.5 max-h-[520px] overflow-y-auto">
        {row('all', activeId === null, null, COPY.all, projects.length, () => onSelect(null))}
        {workspaces.map((w) => row(
          w.id, activeId === w.id, w.color, w.name, w.projectIds.length, () => onSelect(w.id), w,
        ))}
        {workspaces.length === 0 && (
          <p className="px-3 py-4 typo-caption text-foreground/45">{COPY.empty}</p>
        )}
        {loose > 0 && workspaces.length > 0 && (
          <div className="pt-1 mt-1 border-t border-primary/10">
            <div className="flex items-center gap-2.5 px-3 py-2 typo-caption text-foreground/45">
              <span className="w-2.5 h-2.5 rounded-sm border border-dashed border-foreground/30 flex-shrink-0" aria-hidden />
              <span className="flex-1 truncate">{COPY.unassigned}</span>
              <span className="tabular-nums">{loose}</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
