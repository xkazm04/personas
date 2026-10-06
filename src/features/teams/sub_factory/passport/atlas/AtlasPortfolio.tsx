// Passport Atlas — the portfolio layer: the kit-governed chrome from
// AtlasPortfolioShell with the matrix figure in the middle.
//
// `AtlasFigureProps` is the whole contract between the model and the figure,
// so the drawing never carries a second copy of the data model. The seam is
// worth keeping on its own terms: it is what lets the figure be tested and
// read without the shell, and it survived two prototype rounds that did not.
//
// The matrix is the only figure. Three benched concepts (a stamp sheet, a core
// sample, a cohort banding) were built here on 2026-10-06 and deleted the same
// day at the owner's instruction, along with the skin layer that preceded
// them. What stays from that work is the parts that stand without a bench:
// `useRovingFigure` (one keyboard model instead of a copy per drawing) and the
// figure contract itself.
import { AtlasPortfolioShell, type PortfolioView } from './AtlasPortfolioShell';
import type { AtlasCoord, AtlasFigureProps, AtlasNames } from './atlasFigure';
import { MatrixFigure } from './variants/matrix/MatrixFigure';
import type { AppPassport } from '../passportModel';
import type { AtlasRow } from './atlasModel';

export type { PortfolioView };

export function AtlasPortfolio({ all, projects, rows, sharedSetup, names, view, onView, onOpenCell, onOpenProject }: {
  all: AppPassport[];
  projects: AppPassport[];
  rows: AtlasRow[];
  sharedSetup: AtlasRow[];
  names: AtlasNames;
  view: PortfolioView;
  onView: (patch: Partial<PortfolioView>) => void;
  onOpenCell: (c: AtlasCoord) => void;
  onOpenProject: (slug: string) => void;
}) {
  const figure: AtlasFigureProps = {
    projects, rows, names, at: view.at,
    onMove: (at) => onView({ at }),
    onOpenCell, onOpenProject,
  };

  return (
    <AtlasPortfolioShell
      all={all}
      projects={projects}
      rows={rows}
      sharedSetup={sharedSetup}
      names={names}
      view={view}
      onView={onView}
      figure={<MatrixFigure {...figure} />}
    />
  );
}
