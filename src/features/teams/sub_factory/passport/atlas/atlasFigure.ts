// Passport Atlas — the contract every portfolio FIGURE honours.
//
// The portfolio's chrome (headline figures, lens / search / sort, legend,
// readout) is kit-governed structure and lives once, in AtlasPortfolioShell.
// What sits in the middle is a FIGURE: doctrine 6c lets it lay itself out
// freely, so a variant is composition and styling only and never a second copy
// of the data model. Every figure reads the same projects, the same lens rows
// and the same roving coordinate, and opens the same two doors.
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

/** The named directions the owner compares. `matrix` is the shipped baseline. */
export type AtlasFigureKind = 'matrix' | 'ledger' | 'dossier';
