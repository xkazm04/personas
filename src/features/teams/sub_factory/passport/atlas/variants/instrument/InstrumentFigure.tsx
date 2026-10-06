// Passport Atlas — the portfolio matrix as an INSTRUMENT: one project per
// reading line, one dimension per column, and every value a READING on a
// scale. A six-state dot only says which state a cell is in; this figure also
// says how far up its ladder it got. Winner of the /prototype round of
// 2026-10-06 over the dot matrix it replaced (and a Dossier and a Specimen).
//
// - Identity: a tile with the repo's real favicon (AtlasFavicons, probed by
//   ProjectsLayer) or a monogram, tinted by the worst state, with the gap
//   count as a corner tab; then the discipline / blockers line and the name on
//   two lines (`nameParts` splits the importer's `Gig · discipline · brief`).
// - Scores: Auto and Prod as dials around their number.
// - Cells: a rung meter, one segment per rung of that dimension's own scale;
//   sets with no ladder print their count.
// - Motion: dials sweep and segments fill left to right, cascading down the
//   first screenful, once; a clicked cell answers with one ring pulse. A lens
//   change re-mounts the columns, so they fill again. Reduced motion: none.
//
// The key map is `useRovingFigure`, shared by any figure honouring the contract.
import { useState, type CSSProperties } from 'react';
import { Hint } from '@/features/shared/components/kit';
import { inkOf } from '../../atlasModel';
import { ATLAS_WORDS as W, INK_MARK, SHORT_LABEL } from '../../atlasWords';
import type { AtlasFigureProps } from '../../atlasFigure';
import { useRovingFigure } from '../useRovingFigure';
import { InstrumentIdentity } from './InstrumentIdentity';
import { inkTone, RungMeter, ScoreDial } from './InstrumentParts';
import { lineDelay, meterOf, setCount } from './instrumentModel';

export function InstrumentFigure({ projects, rows, names, at, onMove, onOpenCell, onOpenProject }: AtlasFigureProps) {
  const roving = useRovingFigure({ projects, dims: rows.length, at, onMove, onOpenCell, onOpenProject });
  const [ping, setPing] = useState<string | null>(null);

  return (
    <div
      ref={roving.ref}
      className="atlas-matrix"
      role="grid"
      aria-rowcount={projects.length + 1}
      aria-colcount={rows.length + 3}
      style={{ '--cols': rows.length } as CSSProperties}
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
      onBlur={roving.onBlur}
      data-testid="atlas-matrix"
    >
      <div className="atlas-matrix__head" role="row">
        <span role="columnheader" className="atlas-matrix__name-head typo-label">
          {W.repository} <span className="k-quiet k-regular">{projects.length}</span>
        </span>
        <span role="columnheader" className="atlas-matrix__score-head typo-label">{W.auto}</span>
        <span role="columnheader" className="atlas-matrix__score-head typo-label">{W.prod}</span>
        {rows.map((r, di) => (
          <span key={r.key} role="columnheader" className={`atlas-matrix__dim typo-label${di === at.di ? ' is-current' : ''}`}>
            <Hint content={r.info} placement="bottom">
              <span className="cursor-help">{SHORT_LABEL[r.key] ?? r.label}</span>
            </Hint>
            <span className="atlas-matrix__dim-count typo-caption k-quiet">{W.below(projects.filter((p) => inkOf(p, r) === 'bad').length)}</span>
          </span>
        ))}
      </div>

      {projects.map((p, pi) => {
        const selected = pi === at.pi;
        const unknown = !!p.repoUnreadable;
        return (
          <div
            key={p.identity.slug}
            role="row"
            className={`atlas-matrix__row${selected ? ' is-selected' : ''}`}
            style={{ '--d': `${lineDelay(pi)}s` } as CSSProperties}
            data-testid={`atlas-row-${p.identity.slug}`}
          >
            <InstrumentIdentity p={p} names={names} onOpen={onOpenProject} />
            <ScoreDial score={p.automationReadiness.score} label={W.auto} unknown={unknown} delay={lineDelay(pi)} />
            <ScoreDial score={p.productionReadiness.score} label={W.prod} unknown={unknown} delay={lineDelay(pi) + 0.08} />
            {rows.map((r, di) => {
              const ink = inkOf(p, r);
              const v = r.get(p);
              const key = `${pi}:${di}`;
              return (
                <span
                  key={r.key}
                  role="gridcell"
                  tabIndex={selected && di === at.di ? 0 : -1}
                  data-cell={key}
                  className={`atlas-matrix__cell${di === at.di ? ' is-column' : ''}${ping === key ? ' is-pinged' : ''}`}
                  style={inkTone(ink)}
                  aria-label={`${p.identity.name}, ${r.label}: ${INK_MARK[ink].label}`}
                  onClick={() => { setPing(key); onMove({ pi, di }); onOpenCell({ pi, di }); }}
                  onAnimationEnd={(e) => { if (e.target === e.currentTarget) setPing(null); }}
                  data-testid={`atlas-cell-${p.identity.slug}-${r.key}`}
                >
                  <RungMeter ink={ink} meter={meterOf(v)} count={ink === 'unknown' ? '?' : setCount(v)} />
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
