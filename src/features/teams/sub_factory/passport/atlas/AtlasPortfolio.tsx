// Passport Atlas — the portfolio layer: the kit-governed chrome from
// AtlasPortfolioShell with the matrix figure in the middle.
//
// `AtlasFigureProps` is the whole contract between the model and the figure,
// so the drawing never carries a second copy of the data model.
//
// Four LOOKS of that one figure are on the bench for the owner to compare
// (/prototype, 2026-10-06). They are the same grid, the same projects-as-rows
// and dimensions-as-columns, the same marks and the same keyboard model: what
// differs is execution, which is what the round is for. `baseline` is what
// ships and the default, so nothing changes for a user until he picks. The
// picker is dev-only and the gate is a named module constant, not a brace at
// the render site.
import { useState } from 'react';
import { Segmented } from '@/features/shared/components/kit';
import { MatrixFigure } from './variants/matrix/MatrixFigure';
import { MATRIX_SKINS, SKIN_OPTIONS } from './variants/matrix/matrixSkins';
import { AtlasPortfolioShell, type PortfolioView } from './AtlasPortfolioShell';
import type { AtlasCoord, AtlasFigureProps, AtlasNames, AtlasSkin } from './atlasFigure';
import { ATLAS_WORDS as W } from './atlasWords';
import type { AppPassport } from '../passportModel';
import type { AtlasRow } from './atlasModel';

export type { PortfolioView };

/** The bench is a development surface. Production always renders the baseline. */
const SHOW_LOOK_BENCH = import.meta.env.DEV;

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
  // Session state, deliberately: a throwaway comparison toggle is not a
  // preference, so it is never written to Web Storage.
  const [look, setLook] = useState<AtlasSkin>('baseline');
  const skin = SHOW_LOOK_BENCH && look in MATRIX_SKINS ? look : 'baseline';

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
      // The baseline sets no attribute at all, so its selectors stay exactly
      // the ones that shipped.
      skin={skin === 'baseline' ? undefined : skin}
      figure={<MatrixFigure skin={skin} {...figure} />}
      extraControls={SHOW_LOOK_BENCH
        ? <Segmented label={W.look} options={SKIN_OPTIONS} value={look} onChange={setLook} />
        : undefined}
    />
  );
}
