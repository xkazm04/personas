// The benched CONCEPTS of the portfolio figure, for the owner to compare
// (/prototype round 4, 2026-10-06).
//
// These are not looks of one drawing - the round that tried that was thrown
// out. Each is a different answer to "what is a portfolio of 102 projects
// across N dimensions", with its own container, its own information
// architecture and its own bet about what the operator needs first. What they
// share is `AtlasFigureProps`: the same projects, the same dimensions, the
// same six states, the same two doors and the same roving coordinate, so the
// comparison is between the ideas and not between their data.
//
// `matrix` is the shipped baseline and the default, so nothing changes for a
// user until he picks. The bench is gated on a named module constant, never on
// a brace at a render site.
import type { ReactElement } from 'react';
import type { AtlasFigureProps } from '../atlasFigure';
import { MatrixFigure } from './matrix/MatrixFigure';
import { StampSheetFigure } from './stampsheet/StampSheetFigure';
import { CoreSampleFigure } from './coresample/CoreSampleFigure';

export type AtlasConcept = 'matrix' | 'stampsheet' | 'coresample';

export const CONCEPT_FIGURES: Record<AtlasConcept, (p: AtlasFigureProps) => ReactElement> = {
  matrix: MatrixFigure,
  stampsheet: StampSheetFigure,
  coresample: CoreSampleFigure,
};

/** Named for the concept, never for a finish. */
export const CONCEPT_OPTIONS: ReadonlyArray<{ v: AtlasConcept; label: string }> = [
  { v: 'matrix', label: 'Matrix' },
  { v: 'stampsheet', label: 'Stamp sheet' },
  { v: 'coresample', label: 'Core sample' },
];
