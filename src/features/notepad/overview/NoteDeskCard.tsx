import { useTranslation } from '@/i18n/useTranslation';
import { Badge } from '@/features/shared/components/display/Badge';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';

import type { NotePatch, NoteSaveState } from '../notepadStore';
import { noteStatusMeta } from '../noteStatusMeta';
import { resultSummary } from '../noteText';
import { NoteCardFooter, ProjectLabel } from './parts/NoteCardBits';
import { NoteQuickWrite } from './parts/NoteQuickWrite';

interface NoteDeskCardProps {
  note: DevNote;
  projects: readonly DevProject[];
  saveState: NoteSaveState;
  /** Position in the grid's entrance cascade. */
  order: number;
  reveal: { hasEntered: (id: string) => boolean; markEntered: (id: string) => void };
  autoFocus: boolean;
  onOpen: () => void;
  onPatch: (patch: NotePatch) => void;
}

/**
 * One note on the desk. Chrome is held to three thin rows — project + state,
 * title, and a single footer — so the card's height goes to the note itself.
 * State is carried twice: a colour edge along the top and the badge. A
 * completed note shows what came back from its run in place of its text.
 */
export function NoteDeskCard({
  note,
  projects,
  saveState,
  order,
  reveal,
  autoFocus,
  onOpen,
  onPatch,
}: NoteDeskCardProps) {
  const { t } = useTranslation();
  const meta = noteStatusMeta(note.status);
  const summary = note.status === 'completed' ? resultSummary(note.resultJson) : null;

  return (
    <RevealItem
      revealId={note.id}
      order={order}
      {...reveal}
      data-testid={`notepad-card-${note.id}`}
      className={`group relative overflow-hidden min-h-52 flex flex-col gap-2 px-4 pt-4 pb-2.5 rounded-card border ${meta.tone.border} ${meta.tone.wash} hover:shadow-elevation-2 transition-shadow`}
    >
      <span className={`absolute inset-x-0 top-0 h-0.5 ${meta.tone.fill}`} aria-hidden />

      <div className="flex items-center justify-between gap-2">
        <ProjectLabel projectId={note.projectId} projects={projects} className="typo-label" />
        <Badge variant={meta.badgeVariant} size="sm">
          <meta.Icon className="w-3 h-3" aria-hidden />
          {meta.labelKey(t)}
        </Badge>
      </div>

      <button type="button" onClick={onOpen} className="text-left rounded-input focus-ring">
        <span className="block typo-title-lg text-foreground line-clamp-2">{note.title}</span>
      </button>

      {summary ? (
        <button type="button" onClick={onOpen} className="flex-1 min-h-0 text-left rounded-input focus-ring">
          <span className={`block typo-label mb-1 ${meta.tone.text}`}>{t.notepad.result_title}</span>
          <span className="typo-body text-foreground/85 line-clamp-4">{summary}</span>
        </button>
      ) : (
        <NoteQuickWrite note={note} onPatch={onPatch} onOpen={onOpen} autoFocus={autoFocus} />
      )}

      <NoteCardFooter note={note} saveState={saveState} onOpen={onOpen} />
    </RevealItem>
  );
}
