// Shared vocabulary for the Registry heatmap's parts: track geometry, the one
// ink function, the one cell readout, and the grid's keyboard model.
//
// ## Geometry — one grid, rows as subgrids
//
// The heatmap is ONE CSS grid; every row (header, category band, skill row)
// is a `grid-cols-subgrid` item spanning it. That is what lets the label track
// be content-sized: all labels share one track, so `fit-content()` sizes it to
// the widest skill name in the matrix, capped at a ceiling where a name finally
// truncates (its tooltip still carries it). The fixed 150px it replaces cut
// most real names mid-word. A trailing `1fr` filler lets row hairlines run the
// full width of a wide host instead of stopping where the last column does.
//
// ## Keyboard — one tab stop
//
// An N×M field of buttons used to be N×M tab stops (golden path
// matrix-and-cell-grid §7-C). Every focusable target now carries its
// coordinate (`data-nav-r` / `data-nav-c`) and its identity (`data-nav`); only
// the active one is in the tab order and the arrows walk the rest. The active
// target is stored as an IDENTITY (`skill::column`), never as an index, so a
// filter that removes rows cannot leave focus pointing at a different cell.
import { useCallback, useState, type FocusEvent, type KeyboardEvent } from 'react';

import { interpolate, type Translations } from '@/i18n/useTranslation';

import type { CellStatus, RegistryCell } from './registryTypes';

export type DevToolsT = Translations['plugins']['dev_tools'];

/** Data-column width — narrow on purpose; names run vertically in the header. */
export const COL = '2.25rem';

/** Label track: content-sized, floored by the label cell's `min-w`, ceilinged here. */
export const templateFor = (columns: number) => `fit-content(20rem) repeat(${columns}, ${COL}) minmax(0, 1fr)`;

/** Row identity of the header row inside the keyboard model. */
export const HEAD_ROW = '__head';
/** Column identity of the label column inside the keyboard model. */
export const LABEL_COL = '__label';
export const navId = (row: string, col: string) => `${row}::${col}`;

/** Keyboard ring shared by every focusable target in the grid. */
export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-0';

/**
 * Ink contrast per theme family, set once on the heatmap root. A share that
 * reads on the dark canvas washes out on the light one (an 8% cell, a count
 * pill, a lens tile all but vanished), so the light family lifts every share
 * by a slope and a floor. Every `tint()` below reads these two variables.
 */
export const INK_VARS = "[--hm-ink-k:1] [--hm-ink-b:0%] [[data-theme^='light']_&]:[--hm-ink-k:1.1] [[data-theme^='light']_&]:[--hm-ink-b:9%]";

/**
 * Tint any CSS colour — a lens hex or a theme variable alike — at `alpha`
 * (0–1), lifted per theme family by INK_VARS. `color-mix` rather than
 * hex→rgba so the fallback can be `var(--primary)` and follow the active
 * theme instead of a hardcoded indigo.
 */
export function tint(color: string, alpha: number): string {
  const share = Math.round(alpha * 100);
  return `color-mix(in oklab, ${color} calc(${share}% * var(--hm-ink-k, 1) + var(--hm-ink-b, 0%)), transparent)`;
}

/** Cell ink: always visibly "installed" at 0%, saturating with coverage. */
export const cellAlpha = (pct: number) => 0.16 + (pct / 100) * 0.58;

/** The five legend stops, sampled from the same ramp the cells use. */
export const LEGEND_STOPS = [0, 25, 50, 75, 100] as const;

/**
 * THE cell readout — the tooltip and the `aria-label` are both built from
 * this, so the mouse and the screen reader are told the same thing
 * (golden path matrix-and-cell-grid §4 step 8).
 */
export function cellReadout(d: DevToolsT, a: {
  skill: string;
  column: string;
  status: CellStatus;
  projectMode: boolean;
  cell: RegistryCell;
  units: number;
}): { action: string; facts: string | null; label: string } {
  const vars = { skill: a.skill, project: a.column };
  const action = a.status === 'blocked' ? interpolate(d.skills_registry_running_cell, vars)
    : a.status === 'adopted' || a.projectMode ? interpolate(d.skills_registry_use_cell, vars)
      : interpolate(d.skills_registry_adopt_cell, vars);
  const facts = a.status === 'adopted'
    ? [
      a.units > 0 ? interpolate(d.skills_coverage_hint, { covered: a.cell.coveredUnits, total: a.units }) : null,
      interpolate(d.trace_cell_invokes, { count: a.cell.invokes30d }),
    ].filter(Boolean).join(' · ')
    : null;
  return { action, facts, label: facts ? `${action}. ${facts}` : action };
}

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

/**
 * Roving tab index over a 2-D target field. `rows` / `cols` are the bounds
 * (header row 0 and label column 0 included). A step that lands on a hole —
 * the empty corner, a busy cell — keeps walking in the same direction.
 * Home / End go to the row's ends; with Ctrl, to the grid's.
 */
export function useGridNav(rows: number, cols: number) {
  const [active, setActive] = useState<string | null>(null);

  const onFocus = useCallback((e: FocusEvent<HTMLElement>) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]')?.dataset.nav;
    if (id) setActive(id);
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (!NAV_KEYS.has(e.key)) return;
    const from = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]');
    if (!from) return;
    let r = Number(from.dataset.navR);
    let c = Number(from.dataset.navC);
    let dr = 0;
    let dc = 0;
    if (e.key === 'ArrowUp') dr = -1;
    else if (e.key === 'ArrowDown') dr = 1;
    else if (e.key === 'ArrowLeft') dc = -1;
    else if (e.key === 'ArrowRight') dc = 1;
    else if (e.key === 'Home') { if (e.ctrlKey) r = 0; c = -1; dc = 1; }
    else { if (e.ctrlKey) r = rows - 1; c = cols; dc = -1; }
    e.preventDefault();
    for (r += dr, c += dc; r >= 0 && r < rows && c >= 0 && c < cols; r += dr, c += dc) {
      const next = e.currentTarget.querySelector<HTMLElement>(`[data-nav-r="${r}"][data-nav-c="${c}"]:not(:disabled)`);
      // The header row is sticky and always in view; scrolling to its static
      // position would yank the matrix back to the top.
      if (next) { next.focus({ preventScroll: r === 0 }); return; }
    }
  }, [rows, cols]);

  return { active, onFocus, onKeyDown };
}
