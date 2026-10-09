/**
 * Layer 2 of the Notes variant: the Notepad's own editor, hosted outside the
 * pad. The same three pieces `NotepadOverlayHost` composes - the plan provider
 * (a linked note's milestone, read ONCE for body and bar), `NoteBody` (which IS
 * `NotePlanPane` for a plan note and the workbench for a brainstorm note) and
 * `NoteDispatchBar` - so every verb the pad has (decompose, certify, ship,
 * execute, Athena, suggestions, runs) comes along instead of being re-drawn.
 *
 * The plan provider mounts only here and only for a plan note: it is the
 * heaviest read the notepad makes.
 */
import { useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import NoteBody from '@/features/notepad/NoteBody';
import { NoteDispatchBar } from '@/features/notepad/parts/NoteDispatchBar';
import { NotePlanProvider, type PlanTab } from '@/features/notepad/plan/NotePlanContext';
import { NoteThreadButton } from '@/features/notepad/thread/NoteThreadButton';
import { noteActionsFor } from '@/features/notepad/notepadActions';
import { useNoteSuggestions } from '@/features/notepad/athena/noteSuggestions';
import { NOTE_PLAN_STATUSES, noteBodyEditable } from '@/features/notepad/noteStatusMeta';
import { patchNote, setProject } from '@/features/notepad/notepadStore';

interface NoteEditorPaneProps {
  note: DevNote;
  project: DevProject | null;
  backLabel: string;
  onBack: () => void;
  /** Open with the certify dialog requested (a card's cut / ship rail step). */
  certifyOnOpen: boolean;
  onCertifyConsumed: () => void;
}

export function NoteEditorPane({ note, project, backLabel, onBack, certifyOnOpen, onCertifyConsumed }: NoteEditorPaneProps) {
  const [tab, setTab] = useState<PlanTab>('plan');
  const [threadOpen, setThreadOpen] = useState(false);
  const suggestions = useNoteSuggestions(note.id);
  const actions = noteActionsFor(note, project);
  const isPlan = Boolean(project && note.milestoneId && NOTE_PLAN_STATUSES.includes(note.status));

  const withPlan = (children: ReactNode) =>
    isPlan && project && note.milestoneId ? (
      <NotePlanProvider
        noteId={note.id}
        milestoneId={note.milestoneId}
        project={project}
        tab={tab}
        onTabChange={setTab}
        certifyOnOpen={certifyOnOpen}
        onCertifyConsumed={onCertifyConsumed}
      >
        {children}
      </NotePlanProvider>
    ) : (
      children
    );

  return (
    <div className="flex flex-col h-[min(78vh,56rem)] min-h-[32rem]" data-testid="layers-notes-editor">
      <div className="shrink-0 flex items-center gap-3 px-1 pb-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack} data-testid="layers-notes-back">
          {backLabel}
        </Button>
        <span className="ml-auto" />
        <NoteThreadButton
          noteId={note.id}
          noteTitle={note.title}
          open={threadOpen}
          onOpenChange={setThreadOpen}
          testId="layers-notes-thread"
        />
      </div>
      <div className="flex-1 min-h-0 flex flex-col rounded-card border border-primary/10 bg-background/40 overflow-hidden">
        {withPlan(
          <>
            <NoteBody
              note={note}
              onPatch={(patch) => patchNote(note.id, patch)}
              readOnly={!noteBodyEditable(note.status)}
              project={project}
              suggestions={suggestions}
              actions={actions}
            />
            <NoteDispatchBar
              note={note}
              project={project}
              onSelectProject={(p) => setProject(note.id, p.id)}
              actions={actions}
              suggestionCount={suggestions.length}
            />
          </>,
        )}
      </div>
    </div>
  );
}
