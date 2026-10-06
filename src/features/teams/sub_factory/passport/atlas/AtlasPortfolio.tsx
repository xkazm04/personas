// Passport Atlas — the portfolio layer: the kit-governed chrome from
// AtlasPortfolioShell with ONE figure in the middle.
//
// `AtlasFigureProps` is the whole contract between the model and the figure,
// so the drawing never carries a second copy of the data model — and so a
// benched concept is a drawing and nothing else.
//
// The picker is dev-only and its gate is a named module constant, not a brace
// at the render site. The default is the shipped matrix, so nothing changes
// for a user until the owner picks.
import { useState } from 'react';
import { Segmented } from '@/features/shared/components/kit';
import { AtlasPortfolioShell, type PortfolioView } from './AtlasPortfolioShell';
import type { AtlasCoord, AtlasFigureProps, AtlasNames } from './atlasFigure';
import { CONCEPT_FIGURES, CONCEPT_OPTIONS, type AtlasConcept } from './variants/concepts';
import { ATLAS_WORDS as W } from './atlasWords';
import type { AppPassport } from '../passportModel';
import type { AtlasRow } from './atlasModel';

export type { PortfolioView };

/** The bench is a development surface. Production always renders the matrix. */
const SHOW_CONCEPT_BENCH = import.meta.env.DEV;

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
  const [concept, setConcept] = useState<AtlasConcept>('matrix');
  const Figure = CONCEPT_FIGURES[SHOW_CONCEPT_BENCH ? concept : 'matrix'];

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
      figure={<Figure {...figure} />}
      extraControls={SHOW_CONCEPT_BENCH
        ? <Segmented label={W.figure} options={CONCEPT_OPTIONS} value={concept} onChange={setConcept} />
        : undefined}
    />
  );
}
