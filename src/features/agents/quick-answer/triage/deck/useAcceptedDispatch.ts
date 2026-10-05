/**
 * useAcceptedDispatch — the OTHER half of a triage session, migrated out of the
 * Run Desk (`plugins/dev-tools/sub_runner/RunDeskControls.tsx`).
 *
 * The deck answers "should this be built?" and then drops the answer on the
 * floor. An accepted idea becomes a `dev_ideas` row with `status = 'accepted'`
 * and NOTHING ELSE HAPPENS — it becomes work only when somebody opens the Run
 * Desk, in another section, and presses "Batch from accepted". That gap is
 * exactly what `dev_tools_undispatched_ideas` exists to count: *an idea a human
 * said YES to that never became work*. A reviewer who has just said yes to
 * eleven things is the one person in the app who can close it, and until now
 * the surface they were standing on could not.
 *
 * So this hook is the Run Desk's dispatch machinery with the Run Desk removed:
 * the same two backend calls, the same three concurrency techniques, owned by
 * the deck's own rail.
 *
 * ## Lanes, and the three modes they replaced
 *
 * `dev_tools_dispatch_ideas` creates a `dev_tasks` row per idea and then hands
 * the batch to `dev_tools_start_batch`.
 *
 * **This surface used to offer three modes — `single` / `batch` / `parallel` —
 * and all three did the same thing.** The header here claimed `max_parallel`
 * was "the semaphore width, `unwrap_or(2)` when the caller says nothing";
 * measured 2026-10-05 against `task_executor.rs`, the command opened with
 * `let _ = max_parallel;` and spawned every task at once. The number the
 * stepper set reached nothing. (It was not unbounded — every task is admitted
 * through `queue::admit`, and the fleet's global `max_parallel_sessions`
 * promotes queued sessions as slots free. The batch's own width was the part
 * that did not exist.)
 *
 * `dev_tools_start_batch` now honours it as a LANE WIDTH: `n` strands, each
 * pulling its next task only once its current one has finished, with `lanes`
 * pinning specific tasks to specific strands. So one control replaces two —
 * the mode names are gone and the number IS the question:
 *
 *  • `lanes === 1` — strictly one at a time (the old `single`).
 *  • `lanes >= 2` — that many at a time, in strands (the old `parallel`).
 *  • Omitting the width entirely is still legal on the wire and still means
 *    the fan-out; this surface never does, because a reviewer who opened the
 *    dispatch modal has named a number.
 *
 * The width lives in the store as `maxParallelTasks`, read from the same place
 * the Run Desk's own stepper writes it, so the two surfaces cannot disagree.
 *
 * Deliberately NOT a fourth mode: auto-run. `dev_tools_start_auto_run` is
 * project-scoped and keeps pulling work until the queue drains — a durable
 * background scheduler, not a dispatch of the rows the reviewer selected. It
 * stays where it can be watched, with the banner that reports it.
 *
 * ## Why it reads its own list
 *
 * `undispatchedIdeas` is not "the accepted ideas" — it is accepted ideas with
 * `NOT EXISTS (SELECT 1 FROM dev_tasks WHERE source_idea_id = …)`. Filtering
 * the deck's own queue would be wrong twice over: the deck holds PENDING items
 * (an accepted one has left it), and it could not tell an idea already sent to
 * the runner from one still waiting. A row that disappears after dispatch is
 * the whole feedback loop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as devApi from '@/api/devTools/devTools';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';

/**
 * Bounds for the lane width.
 *
 * **The one TypeScript declaration of these two numbers.** They were declared
 * twice — here and, identically, in `sub_runner/RunDeskControls.tsx` — under a
 * comment saying this "mirrors the Run Desk's own clamp, which mirrors the
 * executor's": three copies of one number, none of which could tell you if
 * another had moved. The Run Desk imports these now, and the executor's own
 * ceiling is named: `MIN_BATCH_LANES` / `MAX_BATCH_LANES` in
 * `src-tauri/src/commands/infrastructure/task_executor.rs`, which clamps to
 * the same 1..=8 server-side. A value outside that range is not rejected
 * there, it is clamped, so these bounds are the UI telling the truth about
 * what the executor will actually do rather than a second rule.
 */
export const MIN_PARALLEL = 1;
export const MAX_PARALLEL = 8;

/**
 * Which lane an idea is pinned to, by idea id. Absent means unpinned, which
 * is legal and common: the executor drops every unpinned task into one shared
 * pool that each strand pulls from when its own column empties, so an
 * unpinned idea runs on whichever lane frees up first.
 */
export type LaneAssignments = ReadonlyMap<string, number>;

/**
 * What the last act on the selection actually did.
 *
 * A UNION, not one struct with a flag, because the two acts report different
 * quantities and a shared field would have to be named for one of them: a
 * delete has no `mode` and a dispatch has nothing that was "already gone". The
 * discriminant is what lets the bar render each honestly.
 *
 * In both branches the partial outcome is reported ALONGSIDE the successful
 * one and never folded into it — `skipped` beside `dispatched`, `requested`
 * beside `removed`. A half-worked act must not read as one that worked.
 */
export type AcceptedReport =
  | {
      kind: 'dispatch';
      /** The lane width the batch was sent down. */
      lanes: number;
      dispatched: number;
      skipped: number;
      /** Resolved, translated message. Null on success. */
      error: string | null;
    }
  | {
      kind: 'delete';
      /** Rows the backend actually deleted. */
      removed: number;
      /** Rows we asked it to delete. Greater than `removed` when something else
       *  got there first — the list is cross-project and this app runs several
       *  sessions against one database. */
      requested: number;
      error: string | null;
    };

/**
 * Module-scoped warm cache — the deck is an overlay that fully UNMOUNTS every
 * time it closes (`docs/design/overview-loading.md` law 4, and the same posture
 * `useUnifiedTriage` already takes for its four sources). Without this, closing
 * the deck to go look at something and reopening it re-ghosts a list the app
 * read seconds ago.
 *
 * Un-keyed on purpose: this hook always asks the one cross-project question.
 */
let warmRows: UndispatchedIdea[] | null = null;

export interface AcceptedDispatch {
  /** Accepted, never dispatched. Oldest first — the backend's order. */
  rows: UndispatchedIdea[];
  loading: boolean;
  /** Ids ticked for dispatch. Pruned whenever a row leaves the list. */
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  /** Select every row, or clear when everything is already selected. */
  toggleAll: () => void;
  /** How many strands the batch runs down. Shared with the Run Desk via the
   *  store, clamped to MIN_PARALLEL..MAX_PARALLEL. */
  lanes: number;
  setLanes: (n: number) => void;
  /** Idea id → lane index. Pruned whenever a row leaves the list or the lane
   *  count shrinks past it. */
  assignments: LaneAssignments;
  /** Pin an idea to a lane, or `null` to unpin it. */
  assign: (id: string, lane: number | null) => void;
  /** In flight. The bar's button is an AsyncButton, so this is for the rows. */
  dispatching: boolean;
  /** A delete is in flight. Separate from `dispatching` on purpose: they are
   *  opposite acts and a single flag would let one disable the other's control
   *  with the wrong reason. */
  removing: boolean;
  /** The last act's outcome, until the next one starts. */
  report: AcceptedReport | null;
  dismissReport: () => void;
  /** Send the selection. Resolves when the batch has been accepted, not when
   *  the tasks have finished — starting them IS the deliverable. */
  dispatch: () => Promise<void>;
  /**
   * Delete the selection from the backlog. IRREVERSIBLE and not a verdict: it
   * drops the `dev_ideas` rows outright, so the record that they were ever
   * accepted goes with them. That is deliberate — this is the "I was wrong to
   * say yes to these" exit, and leaving them as `accepted` with no task is
   * exactly the limbo this tab exists to drain. Nothing is cancelled, because
   * by construction every row here has no task behind it.
   *
   * The caller is responsible for confirming first; the hook does not ask.
   */
  remove: () => Promise<void>;
  reload: () => void;
}

export function useAcceptedDispatch({
  /** Resolves an error into a message the reviewer can read. Injected rather
   *  than imported so this module stays free of the translation proxy. */
  resolveErrorMessage,
  /**
   * Narrow what this hook considers to BE the list — the Activity rail scopes
   * it to one project column.
   *
   * Applied at the source rather than by the caller filtering `rows` after the
   * fact, and that is the whole reason it lives here: `toggleAll`, `dispatch`
   * and `remove` all derive from `rows`, and the selection is pruned against
   * it. Filter downstream and select-all silently ticks rows nobody can see,
   * while the count beside it reports a different number from the list under
   * it. Filter here and every one of those follows for free.
   *
   * Must be referentially stable or the list re-derives every render.
   */
  visible,
}: {
  resolveErrorMessage: (err: unknown) => string;
  visible?: (row: UndispatchedIdea) => boolean;
}): AcceptedDispatch {
  const [allRows, setRows] = useState<UndispatchedIdea[]>(() => warmRows ?? []);
  const rows = useMemo(
    () => (visible ? allRows.filter(visible) : allRows),
    [allRows, visible],
  );
  // A warm open is not loading: it has rows on its first frame, and reporting
  // `true` there is what produces a ghost over data already on screen.
  const [loading, setLoading] = useState(() => warmRows === null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [assignments, setAssignments] = useState<LaneAssignments>(() => new Map<string, number>());
  const [dispatching, setDispatching] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [report, setReport] = useState<AcceptedReport | null>(null);

  // The concurrency width lives in the store, exactly where the Run Desk's
  // stepper put it. Two surfaces writing two different numbers under one name
  // is how "parallel" quietly comes to mean two things.
  const storedLanes = useSystemStore((s) => s.maxParallelTasks);
  const setLanesRaw = useSystemStore((s) => s.setMaxParallelTasks);
  // Clamp on the way OUT as well as in: the store is written by the Run Desk
  // too, and a value from an older build (or a hand-edited settings row) must
  // not render a lane column the executor will never fill.
  const lanes = Math.min(MAX_PARALLEL, Math.max(MIN_PARALLEL, storedLanes));
  const setLanes = useCallback(
    (n: number) => setLanesRaw(Math.min(MAX_PARALLEL, Math.max(MIN_PARALLEL, n))),
    [setLanesRaw],
  );

  const assign = useCallback((id: string, lane: number | null) => {
    setAssignments((prev) => {
      const next = new Map(prev);
      if (lane === null) next.delete(id);
      else next.set(id, lane);
      return next;
    });
  }, []);

  // Guards a setState after unmount — the deck can be closed mid-fetch, and
  // this hook's whole point is that it is mounted inside a dismissible overlay.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const load = useCallback(() => {
    devApi
      .undispatchedIdeas()
      .then((next) => {
        warmRows = next;
        if (!aliveRef.current) return;
        setRows(next);
        // The selection is pruned by the effect below rather than here. It
        // used to be pruned against `next`, which was correct for the one way
        // a row could leave the list (it got dispatched) and wrong for the
        // second way there is now (the caller narrowed `visible`). One prune,
        // against what is actually on screen, covers both.
      })
      .catch(silentCatch('triage/useAcceptedDispatch:load'))
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
  }, []);

  // Post-paint by construction (this is an effect), so the deck's cold first
  // deal commits before this IPC call is even made — the rail is deliberately
  // held out of that commit, and this must not put it back in.
  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Prune the selection against what is VISIBLE, not merely against what came
  // back from the backend. Narrowing the filter must drop the rows that left
  // the list with it, or the count keeps reporting ticks the reader can no
  // longer see or untick.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(rows.map((r) => r.id));
      const kept = new Set([...prev].filter((id) => live.has(id)));
      return kept.size === prev.size ? prev : kept;
    });
  }, [rows]);

  // The same prune for the lane pins, against BOTH ways a pin can go stale:
  // the row left the list, or the reviewer narrowed the lane count past the
  // column the pin names. A pin to a lane that no longer exists would be
  // silently wrapped by the executor (`column % width`), which is a worse
  // answer than dropping it where the reviewer can see it drop.
  useEffect(() => {
    setAssignments((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(rows.map((r) => r.id));
      const kept = new Map(
        [...prev].filter(([id, lane]) => live.has(id) && lane < lanes),
      );
      return kept.size === prev.size ? prev : kept;
    });
  }, [rows, lanes]);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === rows.length && rows.length > 0
        ? new Set<string>()
        : new Set(rows.map((r) => r.id)),
    );
  }, [rows]);

  const dismissReport = useCallback(() => setReport(null), []);

  const dispatch = useCallback(async () => {
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    setDispatching(true);
    setReport(null);
    // The columns, as the executor wants them: `columns[i]` is the ordered
    // list of ids strand `i` must run. Built from `ids` rather than from the
    // assignment map so the order inside a lane is the order the reviewer is
    // looking at, and so an assignment to a row that just left the list
    // cannot smuggle a dead id onto the wire.
    const columns: string[][] = Array.from({ length: lanes }, () => []);
    for (const id of ids) {
      const lane = assignments.get(id);
      if (lane === undefined) continue;
      // `noUncheckedIndexedAccess`: the bound above is what makes this safe,
      // and the compiler cannot see it, so the column is named once.
      const column = columns[lane];
      if (column) column.push(id);
    }
    try {
      const result = await devApi.dispatchIdeas(ids, 'runner', {
        maxParallel: lanes,
        lanes: columns,
      });
      setReport({
        kind: 'dispatch',
        lanes,
        dispatched: result.dispatched.length,
        skipped: result.skipped.length,
        error: null,
      });
      setSelected(new Set<string>());
      setAssignments(new Map<string, number>());
      load();
    } catch (err) {
      silentCatch('triage/useAcceptedDispatch:dispatch')(err);
      setReport({ kind: 'dispatch', lanes, dispatched: 0, skipped: 0, error: resolveErrorMessage(err) });
    } finally {
      if (aliveRef.current) setDispatching(false);
    }
  }, [rows, selected, lanes, assignments, load, resolveErrorMessage]);

  const remove = useCallback(async () => {
    // Read the ids off `rows` rather than off `selected` directly, exactly as
    // `dispatch` does: the selection is pruned against every reload, but only
    // rows still on screen may be acted on, and a stale id in a DELETE is not
    // a no-op the way a stale id in a dispatch is.
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    setRemoving(true);
    setReport(null);
    try {
      const removedCount = await devApi.bulkDeleteIdeas(ids);
      setReport({ kind: 'delete', removed: removedCount, requested: ids.length, error: null });
      setSelected(new Set<string>());
      load();
    } catch (err) {
      silentCatch('triage/useAcceptedDispatch:remove')(err);
      setReport({
        kind: 'delete',
        removed: 0,
        requested: ids.length,
        error: resolveErrorMessage(err),
      });
    } finally {
      if (aliveRef.current) setRemoving(false);
    }
  }, [rows, selected, load, resolveErrorMessage]);

  return useMemo(
    () => ({
      rows,
      loading,
      selected,
      toggle,
      toggleAll,
      lanes,
      setLanes,
      assignments,
      assign,
      dispatching,
      removing,
      report,
      dismissReport,
      dispatch,
      remove,
      reload: load,
    }),
    [
      rows, loading, selected, toggle, toggleAll, lanes, setLanes, assignments, assign,
      dispatching, removing, report, dismissReport, dispatch, remove, load,
    ],
  );
}
