import { useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';

import { NOTE_LIFECYCLE, noteStatusMeta } from '../noteStatusMeta';
import { LifecycleTicks, NewNoteCard, NoteCardFooter, ProjectLabel } from './parts/NoteCardBits';
import { NoteQuickWrite } from './parts/NoteQuickWrite';
import type { NoteOverviewProps } from './types';

/**
 * DIRECTION 2 — "Lifecycle board".
 *
 * The pad as a pipeline: notes are grouped by where they are in
 * `draft → published → in progress → completed`, one 4-column band per stage
 * with its count. A card wears its state as a solid rail down its left edge and
 * four ticks along the bottom, so position in the lifecycle is readable twice —
 * by which band a card is in, and by how far its ticks are lit.
 *
 * Writing is a deliberate act here: a short draft renders as formatted markdown
 * at rest and turns into a textarea on click. The bet: the overview is mostly
 * for seeing what has left and what came back, and the drafts band is where
 * you go to write.
 */
export default function NoteOverviewLifecycle({
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

  const bands = useMemo(() => {
    const known = new Set<NoteStatus>(NOTE_LIFECYCLE);
    const stages = NOTE_LIFECYCLE.map((status) => ({ status, notes: notes.filter((n) => n.status === status) }));
    // A status this build has never heard of still gets a band — hiding a note
    // because its token drifted would be losing it.
    const stray = notes.filter((n) => !known.has(n.status));
    return stray.length > 0 ? [...stages, { status: stray[0]!.status, notes: stray }] : stages;
  }, [notes]);

  let order = 0;
  return (
    <div className="flex flex-col gap-8">
      {bands
        .filter((band) => band.status === 'draft' || band.notes.length > 0)
        .map((band) => {
          const meta = noteStatusMeta(band.status);
          return (
            <section key={band.status} aria-label={meta.labelKey(t)} className="flex flex-col gap-3">
              <h3 className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${meta.tone.fill}`} aria-hidden />
                <span className="typo-heading text-foreground">{meta.labelKey(t)}</span>
                <span className="typo-data text-foreground/55">{band.notes.length}</span>
                <span className="flex-1 h-px bg-primary/10" aria-hidden />
              </h3>

              <div className="grid grid-cols-4 gap-3">
                {band.notes.map((note) => (
                  <RevealItem
                    key={note.id}
                    revealId={note.id}
                    order={order++}
                    {...enter}
                    data-testid={`notepad-card-${note.id}`}
                    className="group relative overflow-hidden min-h-44 flex flex-col gap-2 pl-5 pr-4 py-3.5 rounded-card border border-primary/10 bg-secondary/10 hover:border-primary/20 hover:bg-secondary/20 transition-colors"
                  >
                    <span className={`absolute inset-y-0 left-0 w-1 ${meta.tone.fill}`} aria-hidden />

                    <div className="flex items-center justify-between gap-2">
                      <ProjectLabel projectId={note.projectId} projects={projects} />
                      <LifecycleTicks note={note} />
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpen(note.id)}
                      className="text-left rounded-input focus-ring"
                    >
                      <span className="block typo-title-lg text-foreground truncate">{note.title}</span>
                    </button>

                    <NoteQuickWrite
                      note={note}
                      mode="click"
                      onPatch={(patch) => onPatch(note.id, patch)}
                      onOpen={() => onOpen(note.id)}
                      autoFocus={note.id === focusNoteId}
                    />

                    <NoteCardFooter note={note} saveState={saveStates[note.id] ?? 'clean'} onOpen={() => onOpen(note.id)} />
                  </RevealItem>
                ))}

                {band.status === 'draft' && (
                  <NewNoteCard atCap={atCap} count={notes.length} onCreate={() => onCreate()} className="min-h-44 h-full" />
                )}
              </div>
            </section>
          );
        })}
    </div>
  );
}
