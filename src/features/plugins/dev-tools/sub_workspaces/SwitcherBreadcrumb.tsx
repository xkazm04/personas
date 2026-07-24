// FOOTER SWITCHER — DIRECTION A: "Breadcrumb".
//
// ONE control, not two: the footer's right cluster already sits ~190px from an
// absolutely-centred radio/section-nav, so a second pill would collide on a
// narrow window. The trigger reads as a path — `◆ Workspace / Project` — so
// the hierarchy is legible before anything opens, and the workspace swatch
// carries identity at a glance.
//
// Open state is a WIDE TWO-PANE popover (the "expanded size" ask): workspaces
// on the left with live project counts, that workspace's projects on the
// right. Picking a workspace never leaves you stranded — the shared hook
// re-points the active project into the new scope.
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronUp, FolderGit2, Layers, Plus, X } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';

import { createWorkspace } from './workspaceStore';
import { useWorkspaceSwitch } from './useWorkspaceSwitch';

const COPY = {
  allWorkspaces: 'All projects',
  workspaces: 'Workspaces',
  projectsIn: 'Projects',
  none: 'No active project',
  newWorkspace: 'New workspace',
  pick: 'Pick project',
  manage: 'Manage projects',
  empty: 'No projects in this workspace',
};

export function SwitcherBreadcrumb() {
  const {
    scoped, workspaces, activeId, activeProjectId, activeProject,
    activeWorkspace, setActiveProject, switchWorkspace,
  } = useWorkspaceSwitch();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const wsLabel = activeWorkspace?.name ?? COPY.allWorkspaces;
  const wsColor = activeWorkspace?.color ?? 'var(--muted-foreground)';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="footer-workspace-breadcrumb"
        className="flex items-center gap-1.5 h-7 px-2 rounded-lg max-w-[260px] text-foreground hover:bg-secondary/50 transition-colors"
        title={activeProject?.root_path ?? wsLabel}
      >
        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: wsColor }} aria-hidden />
        <span className="text-[11px] font-medium truncate min-w-0 max-w-[90px]">{wsLabel}</span>
        <span className="text-foreground/40 flex-shrink-0" aria-hidden>/</span>
        <span className={`text-[11px] font-medium truncate min-w-0 ${activeProject ? 'text-indigo-300/90' : 'text-foreground/60'}`}>
          {activeProject?.name ?? COPY.pick}
        </span>
        <ChevronUp className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>

      {open && (
        <div className="animate-fade-slide-in absolute bottom-full right-0 mb-2 w-[520px] rounded-xl border border-primary/15 bg-background shadow-elevation-3 z-50 overflow-hidden">
          <div className="grid grid-cols-[196px_1fr]">
            {/* LEFT — workspaces */}
            <div className="border-r border-primary/10 bg-secondary/20">
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-primary/10">
                <Layers className="w-3.5 h-3.5 text-foreground/60" aria-hidden />
                <span className="typo-label text-foreground/90">{COPY.workspaces}</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto py-1">
                <button
                  onClick={() => switchWorkspace(null)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 typo-caption text-left transition-colors ${
                    activeId === null ? 'bg-primary/10 text-foreground' : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground'
                  }`}
                >
                  <span className="w-2 h-2 rounded-sm bg-muted-foreground/50 flex-shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{COPY.allWorkspaces}</span>
                  {activeId === null && <Check className="w-3 h-3 flex-shrink-0" />}
                </button>
                {workspaces.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => switchWorkspace(w.id)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 typo-caption text-left transition-colors ${
                      activeId === w.id ? 'bg-primary/10 text-foreground' : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: w.color }} aria-hidden />
                    <span className="flex-1 truncate">{w.name}</span>
                    <span className="text-foreground/40 tabular-nums text-[10px]">{w.projectIds.length}</span>
                    {activeId === w.id && <Check className="w-3 h-3 flex-shrink-0" />}
                  </button>
                ))}
              </div>
              <button
                onClick={() => createWorkspace('New workspace')}
                className="w-full flex items-center gap-1.5 px-3 py-2 border-t border-primary/10 typo-caption text-primary hover:bg-primary/5 transition-colors"
                data-testid="footer-workspace-new"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden />
                {COPY.newWorkspace}
              </button>
            </div>

            {/* RIGHT — projects in the active workspace */}
            <div>
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-primary/10">
                <FolderGit2 className="w-3.5 h-3.5 text-foreground/60" aria-hidden />
                <span className="typo-label text-foreground/90">{COPY.projectsIn}</span>
                <span className="ml-auto typo-caption text-foreground/45 tabular-nums">{scoped.length}</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto py-1">
                <button
                  onClick={() => { void setActiveProject(null); setOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 typo-caption text-left transition-colors ${
                    activeProjectId === null ? 'bg-indigo-500/10 text-indigo-300' : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground'
                  }`}
                >
                  <X className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{COPY.none}</span>
                </button>
                {scoped.length === 0 ? (
                  <p className="px-3 py-4 typo-caption text-foreground/45">{COPY.empty}</p>
                ) : scoped.map((p) => {
                  const isActive = p.id === activeProjectId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => { void setActiveProject(p.id); setOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                        isActive ? 'bg-indigo-500/10 text-indigo-300' : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground'
                      }`}
                    >
                      <FolderGit2 className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
                      <span className="flex-1 min-w-0">
                        <span className="block typo-caption font-medium truncate">{p.name}</span>
                        {p.root_path && <span className="block text-[10px] text-foreground/45 truncate">{p.root_path}</span>}
                      </span>
                      {isActive && <Check className="w-3 h-3 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => { setSidebarSection('teams'); setOpen(false); }}
                className="w-full px-3 py-2 border-t border-primary/10 typo-caption text-foreground/60 hover:bg-secondary/40 hover:text-foreground transition-colors"
              >
                {COPY.manage}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
