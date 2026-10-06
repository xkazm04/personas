// The matrix's benched LOOKS: the small number of places where a look needs a
// different type token or a different DRAW, and nothing else. Everything that
// can be said in CSS is said in matrixSkins.css, scoped from
// `.atlas-portfolio[data-skin]` so the legend and the readout re-cut their
// marks with the figure instead of drifting from it.
//
// `baseline` reproduces the shipped strings exactly, so the default renders
// byte-for-byte what it rendered before this seam existed.
import type { ReactNode } from 'react';
import { UnitStrip } from '@/features/shared/components/kit';
import { ATLAS_WORDS as W } from '../../atlasWords';
import type { AtlasSkin } from '../../atlasFigure';
import './matrixSkins.css';

export interface MatrixSkin {
  /** The dimension column head's type token. */
  dim: string;
  /** The token the two score column heads wear. */
  scoreHead: string;
  /** The token the three numeric body columns wear. */
  num: string;
  /** How a column draws the number of projects below readiness in it. */
  countDraw: (below: number, total: number) => ReactNode;
}

const words = (below: number) => (
  <span className="atlas-matrix__dim-count typo-caption">{W.below(below)}</span>
);

export const MATRIX_SKINS: Record<AtlasSkin, MatrixSkin> = {
  // Shipped. Do not "improve" in place: it is the control the other three are
  // read against, and the owner's default until he picks.
  baseline: {
    dim: 'typo-label',
    scoreHead: 'typo-label k-quiet',
    num: 'typo-caption tabular-nums',
    countDraw: words,
  },

  // PLATE - the grid is DRAWN: a hairline per column, one unbroken header
  // rule, and the crosshair split into three registers the eye can name.
  plate: {
    dim: 'typo-label',
    // Un-muted: these two are the headline scores, and the baseline read them
    // as less important than a dimension name by muting only them.
    scoreHead: 'typo-label',
    // typo-data is the numbers token; the baseline wore the prose token and
    // hand-patched half of typo-data back on with `tabular-nums`.
    num: 'typo-data',
    countDraw: words,
  },

  // GAZETTE - no fill anywhere: a 40px reading line, a tracked eyebrow over
  // each column, and rhythm plus rule carrying every separation.
  gazette: {
    dim: 'typo-eyebrow',
    scoreHead: 'typo-eyebrow',
    num: 'typo-data',
    countDraw: (below) => <span className="atlas-matrix__dim-count typo-caption">{below || ''}</span>,
  },

  // CHART - the cell is a plot area: every column carries a baseline tick the
  // mark sits on, and the head's count becomes the countable bar it already
  // was in prose.
  chart: {
    dim: 'typo-label',
    scoreHead: 'typo-label',
    num: 'typo-data',
    countDraw: (below, total) => (
      <UnitStrip
        size="s"
        rows={2}
        label={W.below(below)}
        segments={[
          { n: below, tone: 'error', glyph: 'solid' },
          { n: Math.max(0, total - below), tone: 'neutral', glyph: 'empty' },
        ]}
      />
    ),
  },
};

export const SKIN_OPTIONS: ReadonlyArray<{ v: AtlasSkin; label: string }> = [
  { v: 'baseline', label: 'Baseline' },
  { v: 'plate', label: 'Plate' },
  { v: 'gazette', label: 'Gazette' },
  { v: 'chart', label: 'Chart' },
];
