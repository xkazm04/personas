// Factory "Improve" per-cell activity registry — tracks which readiness-matrix
// cells currently have a long-running golden-standard op (Claude deploy / context
// scan) in flight. Purpose-built and separate from the global activity dock
// (`processActivitySlice` in overviewStore): the dock answers "what background
// work exists app-wide", this answers "is THIS cell busy" + "is ANY factory op
// running" — the granularity the spinning gear and the Teams/Factory sidebar dots
// need. A cell is keyed `${slug}:${rowKey}`; the run is keyed by its task id /
// scan id so the global completion listener (eventBridge) can resolve it.
import { create } from 'zustand';

export type ImproveKind = 'deploy' | 'scan';

interface ImproveActivityState {
  /** cellKey (`${slug}:${rowKey}`) → the op currently running in that cell. */
  byCell: Record<string, { runId: string; kind: ImproveKind }>;
  /** runId → cellKey — reverse index so completion (which only knows the run id) resolves the cell. */
  byRun: Record<string, string>;
  /** Mark a cell busy when a deploy/scan dispatches. Replaces any prior op on the same cell. */
  start: (cellKey: string, runId: string, kind: ImproveKind) => void;
  /** Clear the cell whose op has this run id. No-op when the run isn't tracked. */
  endByRun: (runId: string) => void;
}

export const useImproveActivityStore = create<ImproveActivityState>((set) => ({
  byCell: {},
  byRun: {},
  start: (cellKey, runId, kind) =>
    set((s) => {
      const byRun = { ...s.byRun };
      const prev = s.byCell[cellKey];
      if (prev) delete byRun[prev.runId]; // drop the superseded run's reverse entry
      byRun[runId] = cellKey;
      return { byCell: { ...s.byCell, [cellKey]: { runId, kind } }, byRun };
    }),
  endByRun: (runId) =>
    set((s) => {
      const cellKey = s.byRun[runId];
      if (!cellKey) return s;
      const { [runId]: _r, ...byRun } = s.byRun;
      const { [cellKey]: _c, ...byCell } = s.byCell;
      return { byCell, byRun };
    }),
}));

/** True when any factory deploy/scan is in flight — drives the Teams + Factory sidebar dots. */
export const selectAnyImproveRunning = (s: ImproveActivityState): boolean =>
  Object.keys(s.byCell).length > 0;
