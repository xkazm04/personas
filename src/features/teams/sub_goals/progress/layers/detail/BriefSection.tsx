/**
 * The milestone's brief - its `DevNote` - read in place, never copied.
 *
 * The pad's own pieces render it (`NoteHeader`, `NoteStatusTimeline`), the body
 * goes through the same deferred markdown renderer the pad uses, clamped: this
 * is a reading view, and full editing is one press away in the Notepad.
 *
 * No brief -> say so and offer "Start brief": a note titled after the
 * milestone, created in the project and linked to it through the store's own
 * doors (`createNote`, `linkMilestone`), which already report a failure through
 * `toastCatch` and return `null` - so a failed create stops before the link.
 */
import { FileText, NotebookPen, Plus } from 'lucide-react';

import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { DeferredMarkdown } from '@/features/shared/components/editors/DeferredMarkdown';
import { NoteHeader } from '@/features/notepad/parts/NoteHeader';
import { NoteStatusTimeline } from '@/features/notepad/parts/NoteStatusTimeline';
import { noteBodyEditable } from '@/features/notepad/noteStatusMeta';
import { atCap, createNote, linkMilestone, renameNote } from '@/features/notepad/notepadStore';
import { openNotepadThread } from '@/features/notepad/thread/threadDeepLink';
import { useNotepadNotes, useNotepadStatus, usePlanSummary } from '@/features/notepad/useNotepad';
import type { DevNote } from '@/lib/bindings/DevNote';

import { useProgressView } from '../../canvasHost';
import { Section } from '../../../goalDetail/parts';
import type { MilestoneCard } from '../layerModel';
import { Ghost } from './detailParts';

export function BriefSection({ card, projectId }: { card: MilestoneCard; projectId: string }) {
  const { dl } = useProgressView();
  const { loaded } = useNotepadStatus();
  // Subscribing re-renders on any note change, which keeps `atCap()` honest.
  useNotepadNotes();

  return (
    <Section icon={FileText} label={dl.layers_brief} flush>
      <div data-testid="layers-detail-brief">
        {!loaded && !card.brief ? (
          <Ghost rows={4} testId="layers-detail-brief-ghost" />
        ) : card.brief ? (
          <BriefNote note={card.brief} />
        ) : (
          <NoBrief card={card} projectId={projectId} />
        )}
      </div>
    </Section>
  );
}

function BriefNote({ note }: { note: DevNote }) {
  const { dl } = useProgressView();
  const plan = usePlanSummary(note.id);
  return (
    <div className="rounded-card border border-primary/10 bg-card/40 px-4 py-3.5 flex flex-col gap-3">
      <NoteHeader note={note} onRename={(title) => renameNote(note.id, title)} readOnly={!noteBodyEditable(note.status)} />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-5">
        <div className="relative max-h-60 overflow-hidden">
          {note.bodyMd.trim() && <DeferredMarkdown content={note.bodyMd} className="typo-body" />}
          {/* The clamp's edge: the body fades rather than cutting mid-line. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background/80 to-transparent" />
        </div>
        <NoteStatusTimeline note={note} plan={plan} />
      </div>
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={<NotebookPen className="w-3.5 h-3.5" />}
          // The pad's one outside door. It opens the note's editor with the
          // thread popover raised; a plain open-note door needs the host to
          // tell the two requests apart (see the WP1 report).
          onClick={() => openNotepadThread(note.id)}
          data-testid="layers-detail-open-notepad"
        >
          {dl.layers_open_in_notepad}
        </Button>
      </div>
    </div>
  );
}

function NoBrief({ card, projectId }: { card: MilestoneCard; projectId: string }) {
  const { dl } = useProgressView();
  const full = atCap();
  const start = async () => {
    const note = await createNote(card.lane.name, projectId);
    if (note) await linkMilestone(note.id, card.lane.id);
  };
  return (
    <div className="rounded-card border border-dashed border-primary/20 px-4 py-4 flex flex-wrap items-center justify-between gap-3">
      <p className="typo-body text-foreground">{dl.layers_no_brief}</p>
      <AsyncButton
        variant="accent"
        tone="highlight"
        size="sm"
        icon={<Plus className="w-3.5 h-3.5" />}
        disabled={full}
        disabledReason={dl.layers_start_brief_cap}
        onClick={start}
        data-testid="layers-detail-start-brief"
      >
        {dl.layers_start_brief}
      </AsyncButton>
    </div>
  );
}
