// Passport Atlas — the portfolio layer: the kit-governed chrome from
// AtlasPortfolioShell with ONE figure in the middle.
//
// The figure is chosen here and nowhere else. `AtlasFigureProps` is the whole
// contract between the model and a figure, so every direction reads the same
// projects, the same lens rows and the same roving coordinate: a variant is
// composition and styling, never a second data model.
//
// Three directions are on the bench for the owner to compare (/prototype,
// 2026-10-06): `matrix` is the shipped baseline and the default, so nothing
// changes for a user until he picks. The picker is dev-only; the gate is a
// named module constant, not a brace at the render site.
import { useState } from 'react';
import { Segmented } from '@/features/shared/components/kit';
import { MatrixFigure } from './variants/matrix/MatrixFigure';
import { LedgerFigure } from './variants/ledger/LedgerFigure';
import { DossierFigure } from './variants/dossier/DossierFigure';
import { AtlasPortfolioShell, type PortfolioView } from './AtlasPortfolioShell';
import type { AtlasCoord, AtlasFigureKind, AtlasFigureProps, AtlasNames } from './atlasFigure';
import { ATLAS_WORDS as W, FIGURES } from './atlasWords';
import type { AppPassport } from '../passportModel';
import type { AtlasRow } from './atlasModel';

export type { PortfolioView };

/** The bench is a development surface. Production always renders the baseline. */
const SHOW_FIGURE_BENCH = import.meta.env.DEV;

const FIGURE_KEYS: Record<AtlasFigureKind, string> = {
  matrix: W.keysPortfolio,
  ledger: W.keysLedger,
  dossier: W.keysDossier,
};

function Figure({ kind, ...props }: AtlasFigureProps & { kind: AtlasFigureKind }) {
  if (kind === 'ledger') return <LedgerFigure {...props} />;
  if (kind === 'dossier') return <DossierFigure {...props} />;
  return <MatrixFigure {...props} />;
}

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
  const [kind, setKind] = useState<AtlasFigureKind>('matrix');
  const shown = SHOW_FIGURE_BENCH ? kind : 'matrix';

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
      keys={FIGURE_KEYS[shown]}
      figure={<Figure kind={shown} {...figure} />}
      extraControls={SHOW_FIGURE_BENCH
        ? <Segmented label={W.figure} options={FIGURES} value={kind} onChange={setKind} />
        : undefined}
    />
  );
}
