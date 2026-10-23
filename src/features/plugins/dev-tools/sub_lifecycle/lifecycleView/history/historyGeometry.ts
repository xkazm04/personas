// The history figure's geometry, by NAME, shared by the figure, its ghost,
// its empty and failed states and Layer 2's strip, so all of them are the
// same height and a state swap moves nothing below the frame.
//
// Rows are fixed heights in rem (they scale with the text-scale setting, as
// the type does); the drawing inside each row is in percent of its row, so
// nothing is measured in script.
import type { CSSProperties } from 'react';

export const HIST_ROW = {
  /** One step's verdict cells. */
  verdict: 'h-6',
  /** The Measure's total time, as a bar. */
  duration: 'h-7',
  /** Tests coverage as a line, with its two thresholds. */
  coverage: 'h-14',
  /** Under the columns: the oldest and newest Measure, or the viewed one. */
  axis: 'h-6',
} as const;

/** The gap between rows, in every column of the figure (labels, plot, scale). */
export const HIST_ROW_GAP = 'gap-1.5';

/** A plot column is never wider than this, so a short history does not stretch into slabs. */
export const HIST_COL_MAX_REM = 7;

/** The plot's own column grid: one equal column per Measure, capped. */
export function plotStyle(n: number): CSSProperties {
  const cols = Math.max(1, n);
  return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxWidth: `${cols * HIST_COL_MAX_REM}rem` };
}

