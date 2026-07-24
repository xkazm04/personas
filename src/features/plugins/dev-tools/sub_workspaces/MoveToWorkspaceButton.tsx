// Bulk "move selected projects into a workspace" — shared by both manager
// directions, dropped into the page's existing selection bar so assignment
// reuses the selection model already there rather than inventing drag-and-drop.
import { useEffect, useRef, useState } from 'react';
import { FolderInput } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { assignProject, type Workspace } from './workspaceStore';

export function MoveToWorkspaceButton({ workspaces, selectedIds, onMoved }: {
  workspaces: Workspace[];
  selectedIds: Set<string>;
  onMoved: () => void;
}) {
  const { t } = useTranslation();
  const dp = t.plugins.dev_projects;
  const COPY = {
    move: dp.workspace_move_to,
    none: dp.workspace_unassigned,
    heading: dp.workspace_move_heading,
  };
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const move = (workspaceId: string | null) => {
    for (const id of selectedIds) assignProject(id, workspaceId);
    setOpen(false);
    onMoved();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive typo-caption text-foreground/70 border border-primary/15 hover:bg-primary/5 hover:text-foreground transition-colors focus-ring"
        data-testid="workspace-move-selected"
      >
        <FolderInput className="w-3 h-3" aria-hidden />
        {COPY.move}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-40 w-[200px] py-1 rounded-card border border-primary/20 bg-secondary/95 backdrop-blur-sm shadow-elevation-4">
          <div className="px-3 py-1.5 border-b border-primary/10 bg-primary/5">
            <span className="typo-label text-foreground/90">{COPY.heading}</span>
          </div>
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => move(w.id)}
              className="w-full flex items-center gap-2 px-3 py-2 typo-body text-left text-foreground/70 hover:bg-secondary/40 hover:text-foreground transition-colors"
            >
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: w.color }} aria-hidden />
              <span className="truncate">{w.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => move(null)}
            className="w-full flex items-center gap-2 px-3 py-2 typo-body text-left text-foreground/70 hover:bg-secondary/40 hover:text-foreground transition-colors border-t border-primary/10"
          >
            <span className="w-2.5 h-2.5 rounded-sm border border-dashed border-foreground/30 flex-shrink-0" aria-hidden />
            {COPY.none}
          </button>
        </div>
      )}
    </div>
  );
}
