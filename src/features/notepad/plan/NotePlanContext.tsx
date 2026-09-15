// The one place the plan is fetched, and the reason it is a context at all.
//
// The pad's editor puts the BODY inside the tab strip's panel slot and the
// DISPATCH BAR after it — two sibling positions in `NotepadOverlayHost`'s JSX,
// not a parent and a child. Both halves need the same milestone: the pane
// renders the cut, the bar gates Ship on the verdict derived from it. Fetching
// it twice would mean two `useProjectPlan` calls, two L2 reads and two roadmaps
// that can disagree for a frame.
//
// So the provider wraps the whole editor region and is MOUNTED CONDITIONALLY —
// only for a note that is actually on the plan rail. That is a conditional
// component, never a conditional hook: a brainstorm note never renders this
// subtree, so a pad full of brainstorm notes pays no milestone IPC at all.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { renameSession } from '@/api/fleet/fleet';
import { recordNoteRunStart } from '@/api/notepad';
import { useAskAthena } from '@/features/plugins/companion/useAskAthena';
import type { DevProject } from '@/lib/bindings/DevProject';
import { shipVerdict, type CritState, type ShipMilestoneVM } from '@/lib/milestone/shipModel';
import { silentCatch } from '@/lib/silentCatch';

import { noteDispatchKey, noteSessionLabel } from '../notepadActions';
import { buildShipDecomposePrompt } from './shipAthena';
import { ShipCertifyModal } from './ShipCertifyModal';
import { useShipMilestoneRun } from './ShipMilestoneRun';
import { useProjectPlan, type ShipData } from './useProjectPlan';

export interface NotePlanValue {
  ship: ShipData;
  /** The milestone this note is the brief of. `null` while the roadmap loads,
   *  and also when the link points at a milestone that no longer exists — the
   *  surfaces render that as "gone", never as an empty milestone. */
  vm: ShipMilestoneVM | null;
  /** True only when there is nothing to paint yet (loading doctrine law 1: a
   *  refetch never blanks a surface that already has rows). */
  loading: boolean;
  /** `shipVerdict` over the milestone's criteria; `setup` while there is no vm,
   *  which is the state that gates Ship shut rather than open. */
  verdict: CritState;
  /** Unmet exit criteria, and how many there are in total — the badge the
   *  control bar has carried since 2026-08-20 (`ShipControlBar:157-163`). */
  unmet: number;
  totalCriteria: number;
  /** Spawn `/ship-milestone` into the project root and record the run. */
  execute: () => Promise<void>;
  executing: boolean;
  /** Ask Athena to decompose the NOTE's brief into goals for this milestone. */
  decompose: () => void;
  /** Open the certify dialog — cut while planned, ship once active. */
  openCertify: () => void;
  /** False once the milestone has shipped: a shipped plan is a record. */
  editable: boolean;
}

const Ctx = createContext<NotePlanValue | null>(null);

/** The plan for the note on screen, or `null` outside a `NotePlanProvider` —
 *  which is every brainstorm note, and is a legitimate answer, not an error. */
export function useNotePlan(): NotePlanValue | null {
  return useContext(Ctx);
}

export function NotePlanProvider({
  noteId,
  milestoneId,
  project,
  children,
}: {
  noteId: string;
  milestoneId: string;
  /** Resolved project row. The pane needs `root_path` to dispatch and the id to
   *  fetch; a linked note without one cannot exist (the link requires a
   *  project), so this is not optional here. */
  project: DevProject;
  children: ReactNode;
}) {
  const askAthena = useAskAthena();
  const ship = useProjectPlan(project.id);
  const [certifying, setCertifying] = useState(false);

  const vm = useMemo(
    () => ship.roadmap.find((m) => m.id === milestoneId) ?? null,
    [ship.roadmap, milestoneId],
  );

  // The two things the run owes the NOTE, both after the spawn has already
  // succeeded. Neither can un-start the session, so both are best-effort and
  // reported quietly: a run that is live in a terminal the operator can see is
  // not a failure because the pad could not write its own bookkeeping row.
  const onSpawned = useCallback(
    async (sessionId: string) => {
      // The label is what makes the fleet grid say WHICH note is running, and
      // it is the prefix `noteIdForSessionName` matches on.
      await renameSession(sessionId, noteSessionLabel(noteId)).catch(
        silentCatch('notepad label ship run session'),
      );
      await recordNoteRunStart(noteId, 'ship_milestone', noteDispatchKey(noteId), sessionId).catch(
        silentCatch('notepad record ship run'),
      );
    },
    [noteId],
  );

  const runner = useShipMilestoneRun(milestoneId, project.root_path, onSpawned);

  const decompose = useCallback(() => {
    if (!vm) return;
    askAthena('Notepad', buildShipDecomposePrompt(vm, project, noteId));
  }, [askAthena, vm, project, noteId]);

  const value = useMemo<NotePlanValue>(() => {
    const criteria = vm?.criteria ?? [];
    return {
      ship,
      vm,
      // Ghost only while nothing has painted — `ship.loading` alone would blank
      // a plan that is already on screen every time a background agent writes.
      loading: ship.loading && ship.roadmap.length === 0,
      verdict: vm ? shipVerdict(criteria) : 'setup',
      unmet: criteria.filter((c) => c.state !== 'go').length,
      totalCriteria: criteria.length,
      execute: runner.run,
      executing: runner.spawning,
      decompose,
      openCertify: () => setCertifying(true),
      editable: vm ? vm.status !== 'shipped' : false,
    };
  }, [ship, vm, runner.run, runner.spawning, decompose]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {certifying && vm && (
        <ShipCertifyModal
          vm={vm}
          // The SAME door the Ship tab uses. The note follows because the Rust
          // mirror moves a linked note when its milestone's status moves — the
          // pad never writes the note's status for a certification, which is
          // what keeps one transition from having two authors.
          onCertify={() => ship.setStatus(vm.id, vm.status === 'planned' ? 'active' : 'shipped')}
          onClose={() => setCertifying(false)}
        />
      )}
    </Ctx.Provider>
  );
}
