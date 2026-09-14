import { useTranslation } from '@/i18n/useTranslation';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';

import { noteStatusMeta } from '../noteStatusMeta';
import { NewNoteCard, NoteCardFooter, ProjectLabel } from './parts/NoteCardBits';
import { NoteQuickWrite } from './parts/NoteQuickWrite';
import type { NoteOverviewProps } from './types';

/**
 * DIRECTION 1 — "Index cards".
 *
 * The pad as a desk of index cards: one flat, even 4-column grid in the order
 * the notes were made, every card the same height. State lives in the card's
 * WHOLE outline, so a glance across the grid reads colour-first. A short draft
 * is writable at rest — the card IS the note, and its four-button formatting
 * strip surfaces only while the caret is inside.
 *
 * The bet: most notes start as a line or two, and the fastest pad is one where
 * jotting never costs a click.
 */
export default function NoteOverviewIndexCards({
  notes,
  projects,
  saveStates,
  atCap,
  focusNoteId,
  onOpen,
  onPatch,
  onCreate,
}: NoteOverviewProps) {
  const { t } = useTranslation();
  const enter = useRevealTracker();

  return (
    <div className="grid grid-cols-4 gap-4">
      {notes.map((note, index) => {
        const meta = noteStatusMeta(note.status);
        return (
          <RevealItem
            key={note.id}
            revealId={note.id}
            order={index}
            {...enter}
            data-testid={`notepad-card-${note.id}`}
            className={`group h-56 flex flex-col gap-2.5 p-4 rounded-card border ${meta.tone.border} bg-secondary/10 hover:bg-secondary/20 hover:shadow-elevation-1 focus-within:shadow-elevation-1 transition-[background-color,box-shadow]`}
          >
            <header className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => onOpen(note.id)}
                className="flex-1 min-w-0 text-left rounded-input focus-ring"
              >
                <span className="block typo-title-lg text-foreground truncate">{note.title}</span>
              </button>
              <meta.Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${meta.tone.text}`} role="img" aria-label={meta.labelKey(t)} />
            </header>

            <ProjectLabel projectId={note.projectId} projects={projects} />

            <NoteQuickWrite
              note={note}
              onPatch={(patch) => onPatch(note.id, patch)}
              onOpen={() => onOpen(note.id)}
              autoFocus={note.id === focusNoteId}
            />

            <NoteCardFooter note={note} saveState={saveStates[note.id] ?? 'clean'} onOpen={() => onOpen(note.id)} />
          </RevealItem>
        );
      })}

      <NewNoteCard atCap={atCap} count={notes.length} onCreate={() => onCreate()} className="h-56" />
    </div>
  );
}
