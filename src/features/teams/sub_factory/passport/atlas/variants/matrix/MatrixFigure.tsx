// THESIS — the portfolio is ONE figure: a project is a reading line, a
// dimension is a column, a state is a mark, and the eye finds a cluster of bad
// marks without reading a word. The shipped baseline (contest winner,
// 2026-09-25) and the default.
//
// Passport Atlas — the portfolio matrix (the proposed kit part SpineMatrix):
// one project per reading line, one dimension per column, a state mark per
// cell. A roving coordinate moves with the arrows; a cell opens the drawer,
// a project's name opens its passport. Fixed row bands on the 8px grid, the
// spine glows on the selected line, headings stay horizontal.
//
// The key map is `useRovingFigure`, shared by every concept on the bench so
// the operator's keyboard does not depend on which drawing he is looking at.
// Everything else below - `role="grid"`, the aria counts, the bands, the spine
// and every `data-testid` - is this figure's own and is unchanged.
import { Button } from '@/features/shared/components/buttons';
import { Hint } from '@/features/shared/components/kit';
import { countInk, inkOf } from '../../atlasModel';
import { InkDot } from '../../AtlasParts';
import { ATLAS_WORDS as W, INK_MARK, SHORT_LABEL } from '../../atlasWords';
import type { AtlasFigureProps } from '../../atlasFigure';
import { useRovingFigure } from '../useRovingFigure';

export function MatrixFigure({ projects, rows, names, at, onMove, onOpenCell, onOpenProject }: AtlasFigureProps) {
  const roving = useRovingFigure({ projects, dims: rows.length, at, onMove, onOpenCell, onOpenProject });

  return (
    <div
      ref={roving.ref}
      className="atlas-matrix"
      role="grid"
      aria-rowcount={projects.length + 1}
      aria-colcount={rows.length + 3}
      style={{ ['--cols' as string]: rows.length }}
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
      onBlur={roving.onBlur}
      data-testid="atlas-matrix"
    >
      <div className="atlas-matrix__head" role="row">
        <span role="columnheader" className="atlas-matrix__name-head typo-label">
          {W.repository} <span className="k-quiet">{projects.length}</span>
          <span className="atlas-matrix__gaps-head k-quiet">{W.gaps}</span>
        </span>
        <span role="columnheader" className="atlas-matrix__score-head typo-label k-quiet">{W.auto}</span>
        <span role="columnheader" className="atlas-matrix__score-head typo-label k-quiet">{W.prod}</span>
        {rows.map((r, di) => (
          <span key={r.key} role="columnheader" className={`atlas-matrix__dim typo-label${di === at.di ? ' is-current' : ''}`}>
            <Hint content={r.info} placement="bottom">
              <span className="atlas-matrix__dim-label">{SHORT_LABEL[r.key] ?? r.label}</span>
            </Hint>
            <span className="atlas-matrix__dim-count typo-caption">{W.below(projects.filter((p) => inkOf(p, r) === 'bad').length)}</span>
          </span>
        ))}
      </div>

      {projects.map((p, pi) => {
        const nm = names.get(p.identity.slug);
        const worst = p.repoUnreadable ? 'unknown' : countInk(p, 'bad') ? 'bad' : countInk(p, 'warn') ? 'warn' : 'good';
        return (
          <div key={p.identity.slug} role="row" className={`atlas-matrix__row${pi === at.pi ? ' is-selected' : ''}`} data-testid={`atlas-row-${p.identity.slug}`}>
            <span role="rowheader" className="atlas-matrix__project">
              <InkDot ink={worst} />
              <Button variant="ghost" size="sm" className="atlas-matrix__name" onClick={() => onOpenProject(p.identity.slug)} data-testid={`atlas-open-${p.identity.slug}`}>
                <span className="k-ellipsis k-strong">{nm?.name ?? p.identity.name}</span>
                {nm?.qualifier && <span className="k-quiet k-regular">{nm.qualifier}</span>}
              </Button>
              <span className="atlas-matrix__gaps typo-caption tabular-nums">{p.repoUnreadable ? '?' : countInk(p, 'bad')}</span>
            </span>
            <span role="gridcell" className="atlas-matrix__score typo-caption tabular-nums">{p.repoUnreadable ? '-' : p.automationReadiness.score}</span>
            <span role="gridcell" className="atlas-matrix__score typo-caption tabular-nums">{p.repoUnreadable ? '-' : p.productionReadiness.score}</span>
            {rows.map((r, di) => {
              const ink = inkOf(p, r);
              const here = pi === at.pi && di === at.di;
              return (
                <span
                  key={r.key}
                  role="gridcell"
                  tabIndex={here ? 0 : -1}
                  data-cell={`${pi}:${di}`}
                  className={`atlas-matrix__cell${di === at.di ? ' is-column' : ''}`}
                  aria-label={`${p.identity.name}, ${r.label}: ${INK_MARK[ink].label}`}
                  onClick={() => { onMove({ pi, di }); onOpenCell({ pi, di }); }}
                  data-testid={`atlas-cell-${p.identity.slug}-${r.key}`}
                >
                  <InkDot ink={ink} />
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
