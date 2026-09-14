import { FolderGit2, Maximize2, Plus } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';

import type { NoteSaveState } from '../../notepadStore';
import { NOTE_LIFECYCLE, noteStatusMeta } from '../../noteStatusMeta';
import { SaveDot } from '../../parts/SaveDot';
import { OVERVIEW_COPY } from '../prototypeCopy';

/** The project a note belongs to — its name, never a raw id. */
export function ProjectLabel({
  projectId,
  projects,
  className = '',
}: {
  projectId: string | null;
  projects: readonly DevProject[];
  className?: string;
}) {
  const { t } = useTranslation();
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined;
  return (
    <span className={`flex items-center gap-1.5 min-w-0 typo-caption ${project ? 'text-foreground/75' : 'text-foreground/50'} ${className}`}>
      <FolderGit2 className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
      <span className="truncate">{project?.name ?? t.notepad.project_none}</span>
    </span>
  );
}

/** Last touched · save state · open. The open control surfaces on card hover. */
export function NoteCardFooter({
  note,
  saveState,
  onOpen,
}: {
  note: DevNote;
  saveState: NoteSaveState;
  onOpen: () => void;
}) {
  return (
    <footer className="flex items-center gap-2 typo-caption text-foreground/55">
      <RelativeTime timestamp={note.updatedAt} />
      <SaveDot state={saveState} />
      <Tooltip content={OVERVIEW_COPY.open}>
        <button
          type="button"
          onClick={onOpen}
          aria-label={OVERVIEW_COPY.open}
          data-testid={`notepad-card-open-${note.id}`}
          className="ml-auto w-7 h-7 rounded-input flex items-center justify-center text-foreground/60 hover:text-foreground hover:bg-secondary/50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-ring"
        >
          <Maximize2 className="w-3.5 h-3.5" aria-hidden />
        </button>
      </Tooltip>
    </footer>
  );
}

/** Four ticks, lit up to where the note is in `draft → completed`. */
export function LifecycleTicks({ note }: { note: DevNote }) {
  const meta = noteStatusMeta(note.status);
  const reached = NOTE_LIFECYCLE.indexOf(note.status);
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {NOTE_LIFECYCLE.map((step, i) => (
        <span key={step} className={`h-1 w-5 rounded-full ${i <= reached ? meta.tone.fill : 'bg-secondary/50'}`} />
      ))}
    </span>
  );
}

/** The trailing "new note" tile. Cap-aware: it explains itself when full. */
export function NewNoteCard({
  atCap,
  count,
  onCreate,
  className = '',
}: {
  atCap: boolean;
  count: number;
  onCreate: () => void;
  className?: string;
}) {
  const { t, tx } = useTranslation();
  const button = (
    <button
      type="button"
      onClick={onCreate}
      disabled={atCap}
      data-testid="notepad-overview-new"
      className={`w-full flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-primary/20 text-foreground/60 hover:text-foreground hover:border-primary/40 hover:bg-secondary/15 disabled:is-disabled transition-colors focus-ring ${className}`}
    >
      <Plus className="w-5 h-5" aria-hidden />
      <span className="typo-caption">{t.notepad.new_note}</span>
    </button>
  );
  if (!atCap) return button;
  return (
    <Tooltip content={tx(t.notepad.cap_reached, { count })} triggerFocusable triggerClassName="flex">
      <span className="pointer-events-none flex w-full">{button}</span>
    </Tooltip>
  );
}

/** Ghost grid under the overview's chrome while the first fetch is in flight. */
export function OverviewGhost() {
  return (
    <div className="grid grid-cols-4 gap-4" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-56 rounded-card bg-secondary/20" />
      ))}
    </div>
  );
}
