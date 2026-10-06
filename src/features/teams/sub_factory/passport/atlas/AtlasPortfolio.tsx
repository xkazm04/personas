// Passport Atlas — the portfolio layer: the kit-governed chrome from
// AtlasPortfolioShell with the matrix figure in the middle.
//
// `AtlasFigureProps` is the whole contract between the model and the figure,
// so the drawing never carries a second copy of the data model.
import { MatrixFigure } from './variants/matrix/MatrixFigure';
import { AtlasPortfolioShell, type PortfolioView } from './AtlasPortfolioShell';
import type { AtlasCoord, AtlasFigureProps, AtlasNames } from './atlasFigure';
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
