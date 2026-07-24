// FOOTER SWITCHER — DIRECTION B: "Command sheet".
//
// The opposite mental model to Breadcrumb: no two-step navigation and no pane
// to aim at. One tall, search-first sheet lists EVERY project grouped under
// its workspace heading, so you type three characters and hit the thing —
// switching workspace and project in a single action, because picking a
// project adopts its workspace. Workspace headings are themselves clickable
// when you want to scope without picking a project.
//
// Scales where a two-pane picker starts to hurt: 40 projects across 6
// workspaces is one filtered list, not six clicks of exploration.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronUp, FolderGit2, Layers, Plus, Search, X } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';

import { createWorkspace, unassignedProjects, type Workspace } from './workspaceStore';
import { useWorkspaceSwitch } from './useWorkspaceSwitch';

const COPY = {
  all: 'All projects',
  placeholder: 'Search projects and workspaces…',
  none: 'No active project',
  unassigned: 'Unassigned',
  newWorkspace: 'New workspace',
  pick: 'Pick project',
  noMatch: 'Nothing matches',
  scopeHint: 'scope',
};

export function SwitcherCommandSheet() {
  const {
    projects, workspaces, activeId, activeProjectId, activeProject,
    activeWorkspace, projectWorkspace, setActiveProject, switchWorkspace,
  } = useWorkspaceSwitch();
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const q = query.trim().toLowerCase();
  const match = (s: string) => s.toLowerCase().includes(q);

  /** Sections: one per workspace (that has matches) + an Unassigned bucket. */
  const sections = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p]));
    const out: Array<{ ws: Workspace | null; items: typeof projects }> = [];
    for (const w of workspaces) {
      const items = w.projectIds
        .map((id) => byId.get(id))
        .filter((p): p is (typeof projects)[number] => Boolean(p))
        .filter((p) => !q || match(p.name) || match(w.name) || match(p.root_path ?? ''));
      if (items.length > 0) out.push({ ws: w, items });
    }
    const loose = unassignedProjects(projects, workspaces)
      .filter((p) => !q || match(p.name) || match(p.root_path ?? ''));
    if (loose.length > 0) out.push({ ws: null, items: loose });
    return out;
  }, [projects, workspaces, q]);

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const dotColor = projectWorkspace?.color ?? activeWorkspace?.color ?? 'var(--muted-foreground)';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="footer-workspace-sheet"
        className={`flex items-center gap-1.5 h-7 px-2 rounded-lg max-w-[200px] transition-colors ${
          activeProject ? 'text-indigo-300/90 hover:bg-indigo-500/10' : 'text-foreground hover:bg-secondary/50'
        }`}
        title={activeProject?.root_path ?? COPY.pick}
      >
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-inset ring-black/20" style={{ background: dotColor }} aria-hidden />
        <span className="text-[11px] font-medium truncate min-w-0">{activeProject?.name ?? COPY.pick}</span>
        <ChevronUp className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>

      {open && (
        <div className="animate-fade-slide-in absolute bottom-full right-0 mb-2 w-[420px] rounded-xl border border-primary/15 bg-background shadow-elevation-3 z-50 overflow-hidden">
          {/* search — the whole point of this direction */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
            <Search className="w-3.5 h-3.5 text-foreground/45 flex-shrink-0" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
              placeholder={COPY.placeholder}
              className="flex-1 bg-transparent outline-none typo-caption text-foreground placeholder:text-foreground/35"
              data-testid="footer-workspace-search"
            />
            <span className="typo-caption text-foreground/35 tabular-nums">{total}</span>
          </div>

          {/* scope row: All projects + clear active */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-primary/10">
            <button
              onClick={() => switchWorkspace(null)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive typo-caption transition-colors ${
                activeId === null ? 'bg-primary/15 text-foreground' : 'text-foreground/60 hover:bg-secondary/40 hover:text-foreground'
              }`}
            >
              <Layers className="w-3 h-3" aria-hidden />
              {COPY.all}
            </button>
            <button
              onClick={() => { void setActiveProject(null); setOpen(false); }}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive typo-caption text-foreground/60 hover:bg-secondary/40 hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" aria-hidden />
              {COPY.none}
            </button>
            <button
              onClick={() => createWorkspace('New workspace')}
              className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive typo-caption text-primary hover:bg-primary/10 transition-colors"
              data-testid="footer-sheet-new-workspace"
            >
              <Plus className="w-3 h-3" aria-hidden />
              {COPY.newWorkspace}
            </button>
          </div>

          <div className="max-h-[340px] overflow-y-auto py-1">
            {sections.length === 0 ? (
              <p className="px-3 py-6 typo-caption text-foreground/45 text-center">{COPY.noMatch}</p>
            ) : sections.map(({ ws, items }) => (
              <div key={ws?.id ?? '__unassigned'}>
                {/* clickable heading — scope without choosing a project */}
                <button
                  onClick={() => ws && switchWorkspace(ws.id)}
                  disabled={!ws}
                  className={`group/head w-full flex items-center gap-2 px-3 py-1.5 sticky top-0 bg-background/95 backdrop-blur-sm transition-colors ${
                    ws ? 'hover:bg-secondary/40' : 'cursor-default'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ background: ws?.color ?? 'var(--muted-foreground)' }}
                    aria-hidden
                  />
                  <span className={`typo-label ${activeId === ws?.id ? 'text-foreground' : 'text-foreground/60'}`}>
                    {ws?.name ?? COPY.unassigned}
                  </span>
                  <span className="typo-caption text-foreground/35 tabular-nums">{items.length}</span>
                  {ws && (
                    <span className="ml-auto typo-caption text-primary opacity-0 group-hover/head:opacity-100 transition-opacity">
                      {COPY.scopeHint}
                    </span>
                  )}
                  {activeId === ws?.id && ws && <Check className="w-3 h-3 text-foreground/70 flex-shrink-0" />}
                </button>
                {items.map((p) => {
                  const isActive = p.id === activeProjectId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        // picking a project ADOPTS its workspace — one action
                        if (ws && activeId !== ws.id) switchWorkspace(ws.id);
                        void setActiveProject(p.id);
                        setOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-left transition-colors ${
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
