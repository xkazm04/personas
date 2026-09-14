import { useMemo, useState } from 'react';
import { Check, ChevronDown, FolderGit2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { matchesQuery } from '@/lib/text/search';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { scopeProjects, useWorkspaces } from '@/features/plugins/dev-tools/sub_workspaces/workspaceStore';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';

import { ProjectLabel } from './NoteCardBits';

/** Past this many projects the popover grows a type-ahead filter. */
const SEARCH_AFTER = 6;
/** Matches the popover's `max-h-80`, so `flipMenu` reasons about its real height. */
const MENU_MAX_HEIGHT = 320;

interface Row {
  id: string | null;
  label: string;
  path?: string;
}

interface NoteProjectPickerProps {
  note: DevNote;
  /** Every dev-tools project — the label must resolve a name even when the
   *  active workspace scopes the note's own project out of the list. */
  projects: readonly DevProject[];
  onSelect: (projectId: string | null) => void;
}

/**
 * The card's project, as a switch. On a draft the label opens a popover of the
 * ACTIVE WORKSPACE's projects (all of them when no workspace is selected) plus
 * "No project"; anything past draft keeps a plain label, because a dispatched
 * note's project is where its run already went and the server refuses the edit.
 */
export function NoteProjectPicker({ note, projects, onSelect }: NoteProjectPickerProps) {
  const { t, tx } = useTranslation();
  const { workspaces, activeId } = useWorkspaces();
  const [query, setQuery] = useState('');

  const workspace = activeId ? workspaces.find((w) => w.id === activeId) ?? null : null;

  const scoped = useMemo(() => {
    const inScope = scopeProjects([...projects], workspaces, activeId);
    // The note's current project stays listed even when the workspace scopes
    // it out — otherwise the check mark saying where the note lives vanishes.
    const current = note.projectId ? projects.find((p) => p.id === note.projectId) : undefined;
    return current && !inScope.some((p) => p.id === current.id) ? [current, ...inScope] : inScope;
  }, [projects, workspaces, activeId, note.projectId]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = scoped
      .filter((p) => !q || matchesQuery(p.name, q))
      .map((p) => ({ id: p.id, label: p.name, path: p.root_path }));
    return q ? matches : [{ id: null, label: t.notepad.project_none }, ...matches];
  }, [scoped, query, t]);

  if (note.status !== 'draft') {
    return <ProjectLabel projectId={note.projectId} projects={projects} className="typo-label" />;
  }

  return (
    <Listbox
      portal
      flipMenu
      menuMaxHeight={MENU_MAX_HEIGHT}
      searchable={scoped.length > SEARCH_AFTER}
      searchPlaceholder={t.notepad.overview_project_search}
      renderSearchStatus={(count) => tx(t.notepad.overview_project_results, { count })}
      onSearchChange={setQuery}
      itemCount={rows.length}
      onSelectFocused={(index) => {
        const row = rows[index];
        if (row) onSelect(row.id);
      }}
      ariaLabel={t.notepad.overview_project_pick}
      className="min-w-0"
      menuClassName="animate-fade-slide-in min-w-64 max-h-80 overflow-y-auto py-1 rounded-card border border-primary/20 bg-background/95 backdrop-blur-md shadow-elevation-3"
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={() => {
            if (!isOpen) setQuery('');
            toggle();
          }}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={t.notepad.overview_project_pick}
          data-testid={`notepad-card-project-${note.id}`}
          className="min-w-0 max-w-full flex items-center gap-1 -mx-1 px-1 rounded-input hover:bg-secondary/40 focus-ring transition-colors"
        >
          <ProjectLabel projectId={note.projectId} projects={projects} className="typo-label" />
          <ChevronDown className={`w-3 h-3 flex-shrink-0 text-foreground/60 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <>
          {workspace && !query && (
            <div className="flex items-center gap-2 px-3 pt-1.5 pb-2 typo-caption text-foreground/70">
              {/* Workspace colour is user data, not a design token. */}
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: workspace.color }} aria-hidden />
              <span className="truncate">{tx(t.notepad.overview_project_scope, { workspace: workspace.name })}</span>
            </div>
          )}
          {rows.map((row, index) => {
            const selected = row.id === note.projectId;
            return (
              <button
                key={row.id ?? '__none'}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onSelect(row.id);
                  close();
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors focus-ring ${
                  index === focusIndex ? 'bg-primary/10' : 'hover:bg-secondary/50'
                }`}
              >
                <FolderGit2 className={`w-3.5 h-3.5 flex-shrink-0 ${row.id ? 'text-foreground opacity-70' : 'text-foreground opacity-40'}`} aria-hidden />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="typo-body text-foreground truncate">{row.label}</span>
                  {row.path && <span className="typo-caption text-foreground/60 truncate">{row.path}</span>}
                </span>
                {selected && <Check className="w-3.5 h-3.5 flex-shrink-0 text-primary" aria-hidden />}
              </button>
            );
          })}
          {scoped.length === 0 && (
            <p className="px-3 py-2 typo-caption text-foreground/70">{t.chrome.workspace_empty_in_workspace}</p>
          )}
        </>
      )}
    </Listbox>
  );
}
