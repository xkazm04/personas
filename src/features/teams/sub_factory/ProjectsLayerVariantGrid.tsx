// /prototype ProjectsLayer (2026-10-06) - the matrix STRUCTURE the three
// variants share, hoisted so a tweak to the grid is made once: one project per
// line, one dimension per column, the roving coordinate and its key map
// (`useRovingFigure`, the same one the baseline matrix uses), and the ARIA grid.
//
// A variant supplies only what it DRAWS: the identity of a line, its score
// cells, the mark inside a dimension cell, and its column heads' extra line.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Hint } from '@/features/shared/components/kit';
import type { AppPassport } from './passport/passportModel';
import { inkOf, type AtlasInk, type AtlasRow } from './passport/atlas/atlasModel';
import type { AtlasFigureProps } from './passport/atlas/atlasFigure';
import { ATLAS_WORDS as W, INK_MARK, SHORT_LABEL } from './passport/atlas/atlasWords';
import { useRovingFigure } from './passport/atlas/variants/useRovingFigure';
import { lineDelay } from './projectsLayerVariantKit';
import './projectsLayerVariants.css';

export interface LineCtx { p: AppPassport; pi: number; selected: boolean }

export function VariantGrid({ fig, variant, testId, scoreHeads, identity, scores, cell, dimFoot, cellStep = 0 }: {
  fig: AtlasFigureProps;
  /** `plv1` | `plv2` | `plv3`: the stylesheet scope. */
  variant: string;
  testId: string;
  scoreHeads: string[];
  identity: (ctx: LineCtx) => ReactNode;
  /** One gridcell per score head, in order. */
  scores: (ctx: LineCtx) => ReactNode;
  cell: (ctx: LineCtx & { r: AtlasRow; di: number; ink: AtlasInk; here: boolean }) => ReactNode;
  /** The second line under a column's name. Defaults to "n below". */
  dimFoot?: (r: AtlasRow, below: number) => ReactNode;
  /** Extra entrance delay per column (seconds): a diagonal wave when > 0. */
  cellStep?: number;
}) {
  const { projects, rows, at, onMove, onOpenCell, onOpenProject } = fig;
  const roving = useRovingFigure({ projects, dims: rows.length, at, onMove, onOpenCell, onOpenProject });
  const [ping, setPing] = useState<string | null>(null);

  return (
    <div
      ref={roving.ref}
      className={`plv ${variant}`}
      role="grid"
      aria-rowcount={projects.length + 1}
      aria-colcount={rows.length + 1 + scoreHeads.length}
      style={{ '--cols': rows.length } as CSSProperties}
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
      onBlur={roving.onBlur}
      data-testid={testId}
    >
      <div className="plv__head" role="row">
        <span role="columnheader" className="plv__namehead typo-label">
          {W.repository} <span className="k-quiet k-regular">{projects.length}</span>
        </span>
        {scoreHeads.map((h) => <span key={h} role="columnheader" className="plv__scorehead typo-label">{h}</span>)}
        {rows.map((r, di) => {
          const below = projects.filter((p) => inkOf(p, r) === 'bad').length;
          return (
            <span key={r.key} role="columnheader" className={`plv__dimhead typo-label${di === at.di ? ' is-current' : ''}`}>
              <Hint content={r.info} placement="bottom">
                <span className="cursor-help">{SHORT_LABEL[r.key] ?? r.label}</span>
              </Hint>
              {dimFoot ? dimFoot(r, below) : <span className="typo-caption k-quiet">{W.below(below)}</span>}
            </span>
          );
        })}
      </div>

      {projects.map((p, pi) => {
        const ctx: LineCtx = { p, pi, selected: pi === at.pi };
        return (
          <div
            key={p.identity.slug}
            role="row"
            className={`plv__row${ctx.selected ? ' is-selected' : ''}`}
            style={{ '--d': `${lineDelay(pi)}s` } as CSSProperties}
            data-testid={`atlas-row-${p.identity.slug}`}
          >
            {identity(ctx)}
            {scores(ctx)}
            {rows.map((r, di) => {
              const ink = inkOf(p, r);
              const here = ctx.selected && di === at.di;
              const key = `${pi}:${di}`;
              return (
                <span
                  key={r.key}
                  role="gridcell"
                  tabIndex={here ? 0 : -1}
                  data-cell={key}
                  className={`plv__cell ${variant}-cell${di === at.di ? ' is-column' : ''}${ping === key ? ' is-pinged' : ''}`}
                  style={{ '--tone': `var(--status-${INK_MARK[ink].tone})`, ...(cellStep ? { '--d': `${lineDelay(pi) + di * cellStep}s` } : null) } as CSSProperties}
                  aria-label={`${p.identity.name}, ${r.label}: ${INK_MARK[ink].label}`}
                  onClick={() => { setPing(key); onMove({ pi, di }); onOpenCell({ pi, di }); }}
                  onAnimationEnd={(e) => { if (e.target === e.currentTarget) setPing(null); }}
                  data-testid={`atlas-cell-${p.identity.slug}-${r.key}`}
                >
                  {cell({ ...ctx, r, di, ink, here })}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** The `--tone` a state paints with: its kit tone's status token. */
export const inkTone = (ink: AtlasInk): CSSProperties => ({ '--tone': `var(--status-${INK_MARK[ink].tone})` } as CSSProperties);
