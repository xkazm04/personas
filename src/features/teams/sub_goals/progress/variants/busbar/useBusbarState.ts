/**
 * Busbar's working state: which sheet is open, where the cursor sits, which
 * goals are marked, which key mode is armed - and the one thing the prototype
 * faked that is real here, the undo.
 *
 * The winner kept every edit in a local history ("edits are local"). In the
 * app a bind is a real write through `milestoneOps`, so an undo has to be a
 * real write too, and it is offered ONLY where the seam has an exact inverse:
 * putting a goal's former membership rows back (bucket, rationale, rating).
 * When a former row sat on a cut or shipped milestone, re-inserting it would
 * stamp it as scope creep, so that change is applied and reported as not
 * undoable instead of pretending.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { isAwaitingAcceptance } from '../../../goalStatus';
import { useProgressView } from '../../canvasHost';
import { isRestorable } from '../../milestoneOps';
import type { BindingSnapshot } from '../../useProgressCanvas';
import type { BusProject } from './busbarModel';

export type BusMode = 'normal' | 'move' | 'jump';
export type BusFlash = 'bind' | 'unbind';

interface UndoEntry {
  snapshots: BindingSnapshot[];
  text: string;
}

/** How long a freshly wired card keeps its draw-in class. */
const FLASH_MS = 900;

export function useBusbarState(projects: readonly BusProject[]) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { canvas, openGoal, model } = useProgressView();
  const acceptGoal = useSystemStore((s) => s.acceptGoal);

  const [pid, setPid] = useState<string | null>(null);
  const [cursorRaw, setCursor] = useState<string | null>(null);
  const [marks, setMarks] = useState<ReadonlySet<string>>(() => new Set());
  const [mode, setMode] = useState<BusMode>('normal');
  const [undoStack, setUndo] = useState<UndoEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState<ReadonlyMap<string, BusFlash>>(() => new Map());
  const flashTimer = useRef<number | null>(null);
  /** Bumped by every cursor move a person asked for; the cursor card follows
   *  it with focus. Zero on mount, so opening the view never steals focus. */
  const [navTick, setNavTick] = useState(0);
  const nav = useCallback(() => setNavTick((n) => n + 1), []);

  const project = projects.find((p) => p.row.projectId === pid) ?? projects[0] ?? null;
  const cursor =
    project && cursorRaw && project.order.includes(cursorRaw) ? cursorRaw : (project?.order[0] ?? null);
  const targets = useMemo(
    () => (marks.size ? project?.order.filter((id) => marks.has(id)) ?? [] : cursor ? [cursor] : []),
    [marks, project, cursor],
  );

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  const focusProject = useCallback((projectId: string, goalId?: string) => {
    setPid(projectId);
    setCursor(goalId ?? null);
    setMarks(new Set());
    setMode('normal');
    setNavTick((n) => n + 1);
  }, []);

  const stepProject = useCallback(
    (delta: number) => {
      if (!project) return;
      const i = projects.indexOf(project) + delta;
      const next = projects[i];
      if (next) focusProject(next.row.projectId);
    },
    [project, projects, focusProject],
  );

  const stepCursor = useCallback(
    (delta: number | 'first' | 'last') => {
      const order = project?.order ?? [];
      if (order.length === 0) return;
      const i = cursor ? order.indexOf(cursor) : 0;
      const next =
        delta === 'first' ? 0 : delta === 'last' ? order.length - 1 : Math.min(order.length - 1, Math.max(0, i + delta));
      setCursor(order[next] ?? null);
      nav();
    },
    [project, cursor, nav],
  );

  const toggleMark = useCallback(() => {
    if (!cursor) return;
    setMarks((prev) => {
      const next = new Set(prev);
      if (next.has(cursor)) next.delete(cursor);
      else next.add(cursor);
      return next;
    });
  }, [cursor]);

  const laneStatus = useCallback(
    (milestoneId: string) => {
      for (const lanes of canvas.lanesByProject?.values() ?? []) {
        const lane = lanes.find((l) => l.id === milestoneId);
        if (lane) return lane.status;
      }
      return 'planned';
    },
    [canvas.lanesByProject],
  );

  /** The one write: wire `ids` to a milestone (`null` = the open bus). */
  const wire = useCallback(
    async (ids: readonly string[], milestoneId: string | null, railNumber: number) => {
      if (ids.length === 0) return;
      const snapshots = ids.map((goalId) => ({ goalId, bindings: canvas.bindingsOf(goalId) }));
      const undoable = snapshots.every((s) => s.bindings.every((b) => isRestorable(laneStatus(b.milestoneId))));
      const text = milestoneId
        ? tx(dl.busbar_did_bind, { count: ids.length, index: railNumber })
        : tx(dl.busbar_did_unbind, { count: ids.length });
      setMode('normal');
      const ok = await canvas.bindGoals(ids, milestoneId);
      if (!ok) return;
      setMarks(new Set());
      if (undoable) setUndo((prev) => [...prev, { snapshots, text }]);
      setNotice(undoable ? text : tx(dl.busbar_not_undoable, { text }));
      setFlash(new Map(ids.map((id) => [id, milestoneId ? 'bind' : 'unbind'] as const)));
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(new Map()), FLASH_MS);
    },
    [canvas, laneStatus, tx, dl],
  );

  /** Bind to rail N of the focused sheet (1-based); 0 unbinds. */
  const wireToRail = useCallback(
    (n: number) => {
      if (!project) return;
      if (n === 0) {
        void wire(targets, null, 0);
        return;
      }
      const band = project.bands.find((b) => b.number === n && b.lane);
      if (band?.lane) void wire(targets, band.lane.id, n);
    },
    [project, targets, wire],
  );

  const undo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last || canvas.busy) return;
    const ok = await canvas.restoreBindings(last.snapshots);
    if (!ok) return;
    setUndo((prev) => prev.slice(0, -1));
    setNotice(tx(dl.busbar_did_undo, { text: last.text }));
  }, [undoStack, canvas, tx, dl]);

  const accept = useCallback(() => {
    const goal = model.allGoals?.find((g) => g.id === cursor);
    if (!goal || !isAwaitingAcceptance(goal.status)) {
      setNotice(dl.busbar_nothing_to_accept);
      return;
    }
    void acceptGoal(goal.id)
      .then(() => {
        setNotice(tx(dl.busbar_accepted, { title: goal.title }));
        model.refresh();
      })
      .catch(toastCatch('GoalsProgress.busbarAccept'));
  }, [model, cursor, acceptGoal, tx, dl]);

  return {
    project,
    cursor,
    marks,
    mode,
    targets,
    notice,
    flash,
    undoDepth: undoStack.length,
    setMode,
    setCursor,
    focusProject,
    stepProject,
    stepCursor,
    toggleMark,
    navTick,
    clearMarks: useCallback(() => setMarks(new Set()), []),
    markAll: useCallback((ids: readonly string[]) => setMarks(new Set(ids)), []),
    wire,
    wireToRail,
    undo,
    accept,
    openCursor: useCallback(() => {
      if (cursor) openGoal(cursor);
    }, [cursor, openGoal]),
  };
}

export type BusbarState = ReturnType<typeof useBusbarState>;
