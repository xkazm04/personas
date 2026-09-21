// UNIVERSAL WORKSPACE / PROJECT SELECTOR.
//
// Extracted from the footer's "Breadcrumb" switcher so every surface that
// scopes by workspace + project (the footer, every dev-tools / teams page
// header) drives the SAME global selection with the same control. The trigger
// reads as a path — `◆ Workspace / Project` — and opens a two-pane popover:
// workspaces on the left with live project counts, that workspace's projects
// on the right, both sorted by name. Picking a workspace never leaves you
// stranded — `useWorkspaceSwitch` re-points the active project into the new scope.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, FolderGit2, Layers, Plus, X } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import type { DevProject } from '@/lib/bindings/DevProject';

import { createWorkspace, setActiveWorkspace } from './workspaceStore';
import { useWorkspaceSwitch } from './useWorkspaceSwitch';

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

interface WorkspaceProjectSelectorProps {
  /** Which way the popover opens. The footer opens up; page headers open down. */
  placement?: 'up' | 'down';
  /** `footer` is the compact 28px chrome trigger; `header` matches page-header controls. */
  variant?: 'footer' | 'header';
  /** Offer "No active project" (a workspace- or app-wide scope). Default true. */
  allowNone?: boolean;
  testId?: string;
  /** Test id of the "New workspace" action (the onboarding tour anchors on the footer's). */
  newWorkspaceTestId?: string;
  /**
   * CONTROLLED MODE — a LOCAL project filter instead of the app-wide active
   * project. Pass both `value` and `onChange`: the pick is reported, never
   * written to the global selection, so a view (the Monitor Stream) can open
   * unfiltered no matter which project is active elsewhere. The workspace pane
   * still scopes the list, but picking a workspace no longer re-points the
   * global project.
   */
  value?: string | null;
  onChange?: (projectId: string | null) => void;
  /** Label of the "none" option and of the trigger while nothing is picked. */
  noneLabel?: string;
  /** Narrow the project list (e.g. only projects that have a team channel). */
  projectFilter?: (project: DevProject) => boolean;
  /** Popover anchoring. `center` for a trigger centered in its bar. */
  align?: 'right' | 'center';
}

export function WorkspaceProjectSelector({
  placement = 'down', variant = 'header', allowNone = true, testId, newWorkspaceTestId,
  value, onChange, noneLabel, projectFilter, align = 'right',
}: WorkspaceProjectSelectorProps) {
  const { t } = useTranslation();
  const c = t.chrome;
  const {
    projects, scoped, workspaces, activeId, activeProjectId: globalProjectId, activeProject: globalProject,
    activeWorkspace, setActiveProject: setGlobalProject, switchWorkspace: switchGlobalWorkspace,
  } = useWorkspaceSwitch();
  const controlled = onChange !== undefined;
  const activeProjectId = controlled ? (value ?? null) : globalProjectId;
  const activeProject = controlled ? (projects.find((p) => p.id === value) ?? null) : globalProject;
  const setActiveProject = (id: string | null) => (controlled ? onChange(id) : setGlobalProject(id));
  const switchWorkspace = controlled ? setActiveWorkspace : switchGlobalWorkspace;
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  const sortedWorkspaces = useMemo(() => [...workspaces].sort(byName), [workspaces]);
  const sortedProjects = useMemo(
    () => (projectFilter ? scoped.filter(projectFilter) : [...scoped]).sort(byName),
    [scoped, projectFilter],
  );

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

  const wsLabel = activeWorkspace?.name ?? c.workspace_all_projects;
  const wsColor = activeWorkspace?.color ?? 'var(--muted-foreground)';
  const header = variant === 'header';
  const row = 'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors';
  const idle = 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground';

  return (
    <div ref={ref} className="relative min-w-0">
      <Tooltip content={activeProject?.root_path ?? wsLabel}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-testid={testId}
          className={header
            ? 'flex items-center gap-2 h-9 px-3 rounded-interactive max-w-[320px] min-w-0 text-foreground bg-secondary/30 border border-primary/15 hover:bg-secondary/50 transition-colors'
            : 'flex items-center gap-1.5 h-7 px-2 rounded-lg max-w-[260px] text-foreground hover:bg-secondary/50 transition-colors'}
        >
          <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: wsColor }} aria-hidden />
          <span className={`${header ? 'typo-body max-w-[120px]' : 'text-[11px] font-medium max-w-[90px]'} truncate min-w-0`}>{wsLabel}</span>
          <span className="text-foreground/40 flex-shrink-0" aria-hidden>/</span>
          <span className={`${header ? 'typo-body' : 'text-[11px] font-medium'} truncate min-w-0 ${activeProject ? 'text-indigo-300/90' : 'text-foreground/60'}`}>
            {activeProject?.name ?? noneLabel ?? c.workspace_pick_project}
          </span>
          <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${(placement === 'up') !== open ? 'rotate-180' : ''}`} />
        </button>
      </Tooltip>

      {open && (
        <div className={`animate-fade-slide-in absolute ${align === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-0'} w-[520px] max-w-[90vw] rounded-xl border border-primary/15 bg-background shadow-elevation-3 z-50 overflow-hidden ${placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
          <div className="grid grid-cols-[196px_1fr]">
            {/* LEFT — workspaces */}
            <div className="border-r border-primary/10 bg-secondary/20">
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-primary/10">
                <Layers className="w-3.5 h-3.5 text-foreground/60" aria-hidden />
                <span className="typo-label text-foreground/90">{c.workspace_workspaces}</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto py-1">
                {[{ id: null, name: c.workspace_all_projects, color: null, count: null }, ...sortedWorkspaces.map((w) => ({ id: w.id, name: w.name, color: w.color, count: w.projectIds.length }))].map((w) => (
                  <button
                    type="button"
                    key={w.id ?? 'all'}
                    onClick={() => switchWorkspace(w.id)}
                    className={`${row} typo-caption ${activeId === w.id ? 'bg-primary/10 text-foreground' : idle}`}
                  >
                    <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${w.color ? '' : 'bg-muted-foreground/50'}`} style={w.color ? { background: w.color } : undefined} aria-hidden />
                    <span className="flex-1 truncate">{w.name}</span>
                    {w.count !== null && <span className="text-foreground/40 tabular-nums text-[10px]">{w.count}</span>}
                    {activeId === w.id && <Check className="w-3 h-3 flex-shrink-0" />}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => createWorkspace(c.workspace_new)}
                className="w-full flex items-center gap-1.5 px-3 py-2 border-t border-primary/10 typo-caption text-primary hover:bg-primary/5 transition-colors"
                data-testid={newWorkspaceTestId}
              >
                <Plus className="w-3.5 h-3.5" aria-hidden />
                {c.workspace_new}
              </button>
            </div>

            {/* RIGHT — projects in the active workspace */}
            <div>
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-primary/10">
                <FolderGit2 className="w-3.5 h-3.5 text-foreground/60" aria-hidden />
                <span className="typo-label text-foreground/90">{c.workspace_projects}</span>
                <span className="ml-auto typo-caption text-foreground/45 tabular-nums">{sortedProjects.length}</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto py-1">
                {allowNone && (
                  <button
                    type="button"
                    onClick={() => { void setActiveProject(null); setOpen(false); }}
                    className={`${row} typo-caption ${activeProjectId === null ? 'bg-indigo-500/10 text-indigo-300' : idle}`}
                  >
                    <X className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{noneLabel ?? c.workspace_no_active_project}</span>
                  </button>
                )}
                {sortedProjects.length === 0 ? (
                  <p className="px-3 py-4 typo-caption text-foreground/45">{c.workspace_empty_in_workspace}</p>
                ) : sortedProjects.map((p) => {
                  const isActive = p.id === activeProjectId;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => { void setActiveProject(p.id); setOpen(false); }}
                      className={`${row} ${isActive ? 'bg-indigo-500/10 text-indigo-300' : idle}`}
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
                type="button"
                onClick={() => { setSidebarSection('teams'); setOpen(false); }}
                className="w-full px-3 py-2 border-t border-primary/10 typo-caption text-foreground/60 hover:bg-secondary/40 hover:text-foreground transition-colors"
              >
                {c.workspace_manage_projects}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
