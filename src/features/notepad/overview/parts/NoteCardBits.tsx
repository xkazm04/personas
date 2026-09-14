import { FolderGit2, Maximize2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';

import type { NoteSaveState } from '../../notepadStore';
import { CARD_TEXT_LIMIT, visibleLength } from '../../noteText';
import { SaveDot } from '../../parts/SaveDot';

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

/**
 * The card's ONE metadata row: last touched · save state · characters used ·
 * open. The count shows only on a draft — the one state whose text can still
 * change — counts VISIBLE characters (markers are formatting, not text), and
 * turns amber past the card limit, which is also the reason such a card shows
 * a faded rendering instead of an editable one.
 */
export function NoteCardFooter({
  note,
  saveState,
  onOpen,
}: {
  note: DevNote;
  saveState: NoteSaveState;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const length = visibleLength(note.bodyMd);
  return (
    <footer className="flex items-center gap-2 typo-caption text-foreground/60">
      <RelativeTime timestamp={note.updatedAt} format="elapsed" />
      <SaveDot state={saveState} />
      {note.status === 'draft' && (
        <>
          <span aria-hidden>·</span>
          <span
            className={`tabular-nums ${length > CARD_TEXT_LIMIT ? 'text-status-warning' : ''}`}
            data-testid={`notepad-card-count-${note.id}`}
          >
            {length}/{CARD_TEXT_LIMIT}
          </span>
        </>
      )}
      <Tooltip content={t.notepad.overview_open}>
        <button
          type="button"
          onClick={onOpen}
          aria-label={t.notepad.overview_open}
          data-testid={`notepad-card-open-${note.id}`}
          className="ml-auto w-7 h-7 rounded-input flex items-center justify-center text-foreground/60 hover:text-foreground hover:bg-secondary/50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-ring"
        >
          <Maximize2 className="w-3.5 h-3.5" aria-hidden />
        </button>
      </Tooltip>
    </footer>
  );
}

/** Ghost grid under the overview's chrome while the first fetch is in flight. */
export function OverviewGhost() {
  return (
    <div className="grid grid-cols-4 gap-4" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-52 rounded-card bg-secondary/20" />
      ))}
    </div>
  );
}
