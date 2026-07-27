// MANAGER PAGE — DIRECTION B: "Workspace tabs".
//
// Horizontal strip above the table: workspaces read as the top-level filing of
// the page, the table keeps the full window width, and the active workspace
// gets an underline in its own colour so the page is visibly "inside" it.
//
// Directional opposite of the Rail — it trades always-visible counts for width
// (past ~8 workspaces the strip scrolls horizontally), and edit affordances
// hide behind the active tab's chevron rather than every row's hover.
import { useState, type ReactNode } from 'react';
import { ChevronDown, Layers, Plus } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { createWorkspace, unassignedProjects, type Workspace } from './workspaceStore';
import { WorkspaceEditMenu } from './WorkspaceEditMenu';

export function WorkspaceTabs({ projects, workspaces, activeId, onSelect, actions }: {
  projects: { id: string }[];
  workspaces: Workspace[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  /**
   * Page-level actions rendered at the right end of the strip. The manager page
   * used to stack its action row ABOVE this one; folding them together keeps the
   * strip's full-width rule as the single horizontal divider instead of two
   * competing rows of chrome.
   */
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const dp = t.plugins.dev_projects;
  const COPY = {
    all: dp.workspace_all_projects,
    unassigned: dp.workspace_unassigned,
    newWorkspace: dp.workspace_new,
    hint: dp.workspace_hint,
  };
  const [editing, setEditing] = useState<string | null>(null);
  const loose = unassignedProjects(projects, workspaces).length;

  return (
    <div className="relative" data-testid="workspace-tabs">
      {/* The border-b lives on this outer row so the rule spans the full width,
          including under `actions`. The TABS scroll horizontally past ~8
          workspaces; `actions` must not, so it is a shrink-0 sibling OUTSIDE
          the scroll container rather than a child of it. */}
      <div className="flex items-stretch border-b border-primary/10">
      <div className="flex items-stretch gap-0.5 overflow-x-auto flex-1 min-w-0">
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-current={activeId === null ? 'true' : undefined}
          className={`inline-flex items-center gap-1.5 px-3 py-2 typo-body whitespace-nowrap border-b-2 -mb-px transition-colors ${
            activeId === null
              ? 'border-primary text-foreground font-medium'
              : 'border-transparent text-foreground/60 hover:text-foreground hover:bg-secondary/30'
          }`}
          data-testid="workspace-tab-all"
        >
          <Layers className="w-3.5 h-3.5" aria-hidden />
          {COPY.all}
          <span className="typo-caption text-foreground/45 tabular-nums">{projects.length}</span>
        </button>

        {workspaces.map((w) => {
          const active = activeId === w.id;
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => (active ? setEditing(editing === w.id ? null : w.id) : onSelect(w.id))}
              aria-current={active ? 'true' : undefined}
              className={`inline-flex items-center gap-1.5 px-3 py-2 typo-body whitespace-nowrap border-b-2 -mb-px transition-colors ${
                active ? 'text-foreground font-medium' : 'border-transparent text-foreground/60 hover:text-foreground hover:bg-secondary/30'
              }`}
              style={active ? { borderBottomColor: w.color } : undefined}
              data-testid={`workspace-tab-${w.id}`}
            >
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: w.color }} aria-hidden />
              {w.name}
              <span className="typo-caption text-foreground/45 tabular-nums">{w.projectIds.length}</span>
              {active && <ChevronDown className="w-3 h-3 text-foreground/50" aria-hidden />}
            </button>
          );
        })}

        {loose > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-2 typo-caption text-foreground/45 whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-sm border border-dashed border-foreground/30" aria-hidden />
            {COPY.unassigned}
            <span className="tabular-nums">{loose}</span>
          </span>
        )}

        <button
          type="button"
          onClick={() => createWorkspace(COPY.newWorkspace)}
          aria-label={COPY.newWorkspace}
          title={COPY.newWorkspace}
          className="ml-auto inline-flex items-center gap-1 px-3 py-2 typo-caption text-primary hover:bg-primary/5 transition-colors whitespace-nowrap focus-ring"
          data-testid="workspace-tabs-new"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden />
          {COPY.newWorkspace}
        </button>
      </div>

        {actions && (
          // `self-center` so page buttons keep their own height instead of being
          // stretched by `items-stretch`; the divider separates workspace-scoped
          // controls from page-scoped ones.
          <div className="self-center flex items-center gap-2 shrink-0 pl-3 ml-2 border-l border-primary/10">
            {actions}
          </div>
        )}
      </div>

      {workspaces.length === 0 && (
        <p className="px-1 pt-2 typo-caption text-foreground/45">{COPY.hint}</p>
      )}

      {editing && (() => {
        const ws = workspaces.find((w) => w.id === editing);
        if (!ws) return null;
        return <WorkspaceEditMenu ws={ws} onClose={() => setEditing(null)} className="absolute top-full left-0 mt-1" />;
      })()}
    </div>
  );
}
