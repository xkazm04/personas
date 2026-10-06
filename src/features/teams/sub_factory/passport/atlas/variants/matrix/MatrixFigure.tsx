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
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { Hint } from '@/features/shared/components/kit';
import { countInk, inkOf } from '../../atlasModel';
import { InkDot } from '../../AtlasParts';
import { ATLAS_WORDS as W, INK_MARK, SHORT_LABEL } from '../../atlasWords';
import type { AtlasFigureProps } from '../../atlasFigure';

export function MatrixFigure({ projects, rows, names, at, onMove, onOpenCell, onOpenProject }: AtlasFigureProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const focusWithin = useRef(false);

  // Keep DOM focus on the roving cell while the grid owns focus.
  useEffect(() => {
    if (!focusWithin.current) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${at.pi}:${at.di}"]`)?.focus();
  }, [at]);

  const onKey = (e: KeyboardEvent) => {
    const last = { pi: projects.length - 1, di: rows.length - 1 };
    const move = (pi: number, di: number) => { e.preventDefault(); onMove({ pi: Math.max(0, Math.min(last.pi, pi)), di: Math.max(0, Math.min(last.di, di)) }); };
    switch (e.key) {
      case 'ArrowDown': return move(at.pi + 1, at.di);
      case 'ArrowUp': return move(at.pi - 1, at.di);
      case 'ArrowRight': return move(at.pi, at.di + 1);
      case 'ArrowLeft': return move(at.pi, at.di - 1);
      case 'Home': return move(at.pi, 0);
      case 'End': return move(at.pi, last.di);
      case 'Enter': case ' ': e.preventDefault(); return onOpenCell(at);
      case 'p': case 'P': { const p = projects[at.pi]; if (p) { e.preventDefault(); onOpenProject(p.identity.slug); } return; }
    }
  };

  return (
    <div
      ref={gridRef}
      className="atlas-matrix"
      role="grid"
      aria-rowcount={projects.length + 1}
      aria-colcount={rows.length + 3}
      style={{ ['--cols' as string]: rows.length }}
      onKeyDown={onKey}
      onFocus={() => { focusWithin.current = true; }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) focusWithin.current = false; }}
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
