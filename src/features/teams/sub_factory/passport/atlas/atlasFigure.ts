// Passport Atlas — the contract the portfolio FIGURE honours.
//
// The portfolio's chrome (headline figures, lens / search / sort, legend,
// readout) is kit-governed structure and lives once, in AtlasPortfolioShell.
// What sits in the middle is a FIGURE: doctrine 6c lets it lay itself out
// freely, so its styling is free while the data model stays here. The figure
// reads the projects, the lens rows and the roving coordinate, and opens the
// same two doors.
import type { AppPassport } from '../passportModel';
import type { AtlasRow } from './atlasModel';

export interface AtlasCoord { pi: number; di: number }

/** A project's display name, qualified by its folder when the name repeats. */
export type AtlasNames = Map<string, { name: string; qualifier: string | null }>;

export interface AtlasFigureProps {
  /** The projects the current search and sort left, in reading order. */
  projects: AppPassport[];
  /** The dimensions the current lens shows, in reading order. */
  rows: AtlasRow[];
  names: AtlasNames;
  /** The roving coordinate: which project line, which dimension. */
  at: AtlasCoord;
  onMove: (c: AtlasCoord) => void;
  /** Opens the cell drawer over the unchanged portfolio. */
  onOpenCell: (c: AtlasCoord) => void;
  /** Opens that project's passport (the project layer). */
  onOpenProject: (slug: string) => void;
}

/** The benched LOOKS of the one matrix figure. `baseline` is what ships.
 *
 * Every look draws the SAME figure: the same grid, projects as reading lines,
 * dimensions as columns, a mark per cell, one roving coordinate and one
 * keyboard model. What differs is execution - rule and band treatment, the
 * type token each slot wears, the rhythm, and how the six marks are cut. The
 * semantics (`role="grid"`, the aria counts, the roving `tabIndex`, every
 * `data-testid`) live once in `MatrixFigure` and cannot vary.
 */
export type AtlasSkin = 'baseline' | 'plate' | 'gazette' | 'chart';
