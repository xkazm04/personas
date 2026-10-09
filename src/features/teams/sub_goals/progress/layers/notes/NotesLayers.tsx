/**
 * LAYERED PROTOTYPE - NOTES. Derived from Cards, with layers 1 and 2 ported
 * from the Notepad instead of re-drawn, so nothing the Notepad already does is
 * lost on the way in:
 *
 *   L0  the filmstrip, exactly as Cards opens on it.
 *   L1  the Notepad's QuestRoom for the project - the same `NoteDeskCard`s with
 *       their rail, menu, thread bubble and presence - extended with milestone
 *       bands: each cut's brief card beside its goals.
 *   L2  the Notepad's editor for the opened note (`NoteEditorPane`): NotePlanPane
 *       for a milestone's brief, the workbench for a brainstorm note.
 *
 * Transition - Cards' split: the portfolio squeezes into the left rail while a
 * project is open. Escape: the room closes itself (its own key, one rung above
 * the desk's); in the editor, `useLayerNav` steps back to the room. The nav's
 * milestone slot carries the OPEN NOTE's id here - layer 2 is a note.
 */
import { useMemo, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import type { DevNote } from '@/lib/bindings/DevNote';
import { QuestRoom } from '@/features/notepad/overview/questlog/QuestRoom';
import { deleteNote, patchNote } from '@/features/notepad/notepadStore';

import { ChronologyHeader } from '../../ChronologyHeader';
import { useProgressView } from '../../canvasHost';
import { FilmstripCanvas } from '../../variants/FilmstripCanvas';
import { ProjectRail } from '../cards/ProjectRail';
import { useLayerNav, useProjectLayer } from '../useLayers';
import { useMilestoneGroups } from './MilestoneBands';
import { NoteEditorPane } from './NoteEditorPane';
import { useRoomData } from './useRoomData';

export function NotesLayers({ leftWidth }: { leftWidth: number }) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { model } = useProgressView();
  const nav = useLayerNav();
  const layer = useProjectLayer(nav.projectId);
  const room = useRoomData();
  // The pad can open over this view; while it is up the room's keys are its.
  const padOpen = useSystemStore((s) => s.notepadOpen);
  const groups = useMilestoneGroups(layer);
  const [selected, setSelected] = useState<string | null>(null);
  const [certifyId, setCertifyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DevNote | null>(null);

  const projectIds = useMemo(() => model.rows.map((r) => r.projectId), [model.rows]);
  const projectName = model.rows.find((r) => r.projectId === nav.projectId)?.name ?? '';
  const openNote = nav.milestoneId ? room.notes.find((n) => n.id === nav.milestoneId) ?? null : null;

  const stepProject = (delta: 1 | -1) => {
    if (!nav.projectId || projectIds.length === 0) return;
    const i = projectIds.indexOf(nav.projectId);
    nav.openProject(projectIds[(i + delta + projectIds.length) % projectIds.length]!);
  };

  if (nav.projectId === null) {
    return (
      <div data-testid="layers-notes" data-depth={0}>
        <ChronologyHeader
          leftWidth={leftWidth}
          label={tx(dl.progress_summary, { projects: model.rows.length, goals: model.shownGoals })}
        />
        <FilmstripCanvas leftWidth={leftWidth} onOpenProject={nav.openProject} />
      </div>
    );
  }

  return (
    <div data-testid="layers-notes" data-depth={nav.depth} className="flex min-h-[32rem]">
      <ProjectRail openId={nav.projectId} onOpen={nav.openProject} onHome={nav.home} />
      <section className="flex-1 min-w-0 py-4 pr-4 flex flex-col">
        {openNote ? (
          <NoteEditorPane
            key={openNote.id}
            note={openNote}
            project={room.projects.find((p) => p.id === openNote.projectId) ?? null}
            backLabel={tx(dl.layers_milestones_of, { project: projectName })}
            onBack={nav.back}
            certifyOnOpen={certifyId === openNote.id}
            onCertifyConsumed={() => setCertifyId(null)}
          />
        ) : (
          <QuestRoom
            zone={room.zoneFor(nav.projectId, projectName)}
            projects={room.projects}
            saveStates={room.saveStates}
            signals={room.signals}
            summaries={room.summaries}
            working={room.working}
            selectedGoalId={selected}
            onSelectGoal={setSelected}
            onStepProject={stepProject}
            onClose={nav.home}
            onOpen={nav.openMilestone}
            onPatch={patchNote}
            onDelete={setPendingDelete}
            onCertify={(id) => {
              setCertifyId(id);
              nav.openMilestone(id);
            }}
            milestoneGroups={groups}
            keyboardEnabled={!padOpen}
          />
        )}
      </section>

      {pendingDelete && (
        <ConfirmDialog
            danger
            title={t.notepad.delete_permanently_confirm_title}
            body={tx(t.notepad.delete_permanently_confirm_body, { title: pendingDelete.title })}
            confirmLabel={t.notepad.delete_permanently}
            onConfirm={async () => {
              await deleteNote(pendingDelete.id);
              setPendingDelete(null);
            }}
            onCancel={() => setPendingDelete(null)}
          />
      )}
    </div>
  );
}
