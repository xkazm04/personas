// Bulk "move selected projects into a workspace" — shared by both manager
// directions, dropped into the page's existing selection bar so assignment
// reuses the selection model already there rather than inventing drag-and-drop.
import { useEffect, useRef, useState } from 'react';
import { FolderInput } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { assignProject, type Workspace } from './workspaceStore';
import Button from '@/features/shared/components/buttons/Button';
import { PressSurface } from '@/features/shared/components/buttons';

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
      <Button variant="secondary" size="sm"
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid="workspace-move-selected"
      >
        <FolderInput className="w-3 h-3" aria-hidden />
        {COPY.move}
      </Button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-40 w-[200px] py-1 rounded-card border border-hair bg-surface-1 backdrop-blur-sm shadow-elevation-4">
          <div className="px-3 py-1.5 border-b border-hair bg-surface-1">
            <span className="typo-label text-ink-2">{COPY.heading}</span>
          </div>
          {workspaces.map((w) => (
            <PressSurface
              key={w.id}
              onPress={() => move(w.id)}
              className="w-full flex items-center gap-2 px-3 py-2 typo-body text-ink-2 hover:text-foreground"
            >
              <span className="w-2.5 h-2.5 rounded-interactive flex-shrink-0" style={{ background: w.color }} aria-hidden />
              <span className="truncate">{w.name}</span>
            </PressSurface>
          ))}
          <PressSurface
            onPress={() => move(null)}
            className="w-full flex items-center gap-2 px-3 py-2 typo-body text-ink-2 hover:text-foreground border-t border-hair"
          >
            <span className="w-2.5 h-2.5 rounded-interactive border border-dashed border-foreground/30 flex-shrink-0" aria-hidden />
            {COPY.none}
          </PressSurface>
        </div>
      )}
    </div>
  );
}
