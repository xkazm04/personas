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
 * ## The three techniques, and what they actually do
 *
 * `dev_tools_dispatch_ideas` creates a `dev_tasks` row per idea and then hands
 * the batch to `dev_tools_start_batch`, whose `max_parallel` is the semaphore
 * width — `unwrap_or(2)` when the caller says nothing. The Run Desk exposed
 * that as three separate buttons; the three modes here are the same three
 * numbers, named rather than implied:
 *
 *  • `single`   — `maxParallel: 1`. Strictly one at a time, which is what the
 *                 Run Desk's per-row start meant: watch this one run.
 *  • `batch`    — `maxParallel: undefined` → the backend's default of 2. The
 *                 Run Desk's "Start batch" button, unchanged.
 *  • `parallel` — `maxParallel:` the stepper. The Run Desk's concurrency
 *                 stepper, which lived in the store as `maxParallelTasks` and
 *                 is read from the same place here so the two surfaces cannot
 *                 disagree about what "parallel" means.
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

/** How the selected rows are handed to the runner. See the header. */
export type DispatchMode = 'single' | 'batch' | 'parallel';

/** Bounds for the concurrency stepper — mirrors the Run Desk's own clamp,
 *  which mirrors the executor's. */
export const MIN_PARALLEL = 1;
export const MAX_PARALLEL = 8;

/** What one dispatch actually did. `skipped` is reported ALONGSIDE `dispatched`
 *  and never folded into it: a dispatch that half-worked must not read as one
 *  that worked (the same rule `DispatchPanel` upholds). */
export interface DispatchReport {
  mode: DispatchMode;
  dispatched: number;
  skipped: number;
  /** Resolved, translated message. Null on success. */
  error: string | null;
}

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
  mode: DispatchMode;
  setMode: (mode: DispatchMode) => void;
  /** The `parallel` mode's width. Shared with the Run Desk via the store. */
  maxParallel: number;
  setMaxParallel: (n: number) => void;
  /** In flight. The bar's button is an AsyncButton, so this is for the rows. */
  dispatching: boolean;
  /** The last dispatch's outcome, until the next one starts. */
  report: DispatchReport | null;
  dismissReport: () => void;
  /** Send the selection. Resolves when the batch has been accepted, not when
   *  the tasks have finished — starting them IS the deliverable. */
  dispatch: () => Promise<void>;
  reload: () => void;
}

export function useAcceptedDispatch({
  /** Resolves an error into a message the reviewer can read. Injected rather
   *  than imported so this module stays free of the translation proxy. */
  resolveErrorMessage,
}: {
  resolveErrorMessage: (err: unknown) => string;
}): AcceptedDispatch {
  const [rows, setRows] = useState<UndispatchedIdea[]>(() => warmRows ?? []);
  // A warm open is not loading: it has rows on its first frame, and reporting
  // `true` there is what produces a ghost over data already on screen.
  const [loading, setLoading] = useState(() => warmRows === null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [mode, setMode] = useState<DispatchMode>('batch');
  const [dispatching, setDispatching] = useState(false);
  const [report, setReport] = useState<DispatchReport | null>(null);

  // The concurrency width lives in the store, exactly where the Run Desk's
  // stepper put it. Two surfaces writing two different numbers under one name
  // is how "parallel" quietly comes to mean two things.
  const maxParallel = useSystemStore((s) => s.maxParallelTasks);
  const setMaxParallelRaw = useSystemStore((s) => s.setMaxParallelTasks);
  const setMaxParallel = useCallback(
    (n: number) => setMaxParallelRaw(Math.min(MAX_PARALLEL, Math.max(MIN_PARALLEL, n))),
    [setMaxParallelRaw],
  );

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
        // Prune the selection against what actually came back. A dispatched row
        // leaves this list, and a selection that outlives its row is how a
        // second press sends ids the reviewer can no longer see.
        setSelected((prev) => {
          if (prev.size === 0) return prev;
          const live = new Set(next.map((r) => r.id));
          const kept = new Set([...prev].filter((id) => live.has(id)));
          return kept.size === prev.size ? prev : kept;
        });
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
    try {
      const result = await devApi.dispatchIdeas(ids, 'runner', {
        // `undefined` is NOT "no limit" — it is the backend's own default of 2,
        // which is precisely what `batch` means. See the header.
        maxParallel:
          mode === 'single' ? 1 : mode === 'parallel' ? maxParallel : undefined,
      });
      setReport({
        mode,
        dispatched: result.dispatched.length,
        skipped: result.skipped.length,
        error: null,
      });
      setSelected(new Set<string>());
      load();
    } catch (err) {
      silentCatch('triage/useAcceptedDispatch:dispatch')(err);
      setReport({ mode, dispatched: 0, skipped: 0, error: resolveErrorMessage(err) });
    } finally {
      if (aliveRef.current) setDispatching(false);
    }
  }, [rows, selected, mode, maxParallel, load, resolveErrorMessage]);

  return useMemo(
    () => ({
      rows,
      loading,
      selected,
      toggle,
      toggleAll,
      mode,
      setMode,
      maxParallel,
      setMaxParallel,
      dispatching,
      report,
      dismissReport,
      dispatch,
      reload: load,
    }),
    [
      rows, loading, selected, toggle, toggleAll, mode, maxParallel, setMaxParallel,
      dispatching, report, dismissReport, dispatch, load,
    ],
  );
}
