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

/**
 * The figure's three columns: the row labels, the plot, and the scale (the
 * top of the time bars, the coverage thresholds). A plot column is never wider
 * than `HIST_COL_MAX_REM`, so a short history does not stretch into slabs.
 */
export const HIST_LABEL_COL = '6.5rem';
export const HIST_SCALE_COL = '3.5rem';
export const HIST_COL_MAX_REM = 7;

/** The plot's own column grid: one equal column per Measure, capped. */
export function plotStyle(n: number): CSSProperties {
  const cols = Math.max(1, n);
  return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxWidth: `${cols * HIST_COL_MAX_REM}rem` };
}

/** The figure's three columns, the plot no wider than its capped columns, so the scale hugs it. */
export function figureColumns(n: number): CSSProperties {
  return { gridTemplateColumns: `${HIST_LABEL_COL} minmax(0, ${Math.max(1, n) * HIST_COL_MAX_REM}rem) ${HIST_SCALE_COL}` };
}

/**
 * The frame body's height, every state: the "what changed" line (one row
 * line and its gap) over the figure (two verdict rows, the time row, the
 * coverage row, the axis, and the gaps between them). Kept in step with the
 * classes above.
 */
export const HIST_BODY_REM = 1.75 + 0.5 + (1.5 * 2 + 1.75 + 3.5 + 1.5 + 0.375 * 4);
