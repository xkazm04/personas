// CONCEPT - COHORTS. A portfolio of 102 projects is not 102 answers.
//
// Group the projects by the passport they actually HAVE and the portfolio
// collapses to the handful of distinct shapes it really is, each one stating
// how many projects it speaks for. The grouping is an exact signature over
// every cell of the lens - not a bucketing, not a clustering heuristic - so
// two projects share a band only when every dimension agrees, which is what
// makes it safe to draw the shape once instead of once per member.
//
// What that buys is the thing none of the other three figures can have: the
// marks are full size, the dimension names are written once in a rail above
// them at full type size, and the whole portfolio is a short page. And it
// scales the right way round - more projects do not make more bands, they make
// the existing bands speak for more.
//
// The practical consequence is the one the operator cares about: you do not
// fix a project here, you fix a shape, and the band tells you how many
// projects that one fix reaches.
import { useMemo } from 'react';
import { Hint } from '@/features/shared/components/kit';
import { SHORT_LABEL, ATLAS_WORDS as W } from '../../atlasWords';
import type { AtlasFigureProps } from '../../atlasFigure';
import { useRovingFigure } from '../useRovingFigure';
import { bandOf, groupCohorts } from './cohorts.model';
import { CohortBand } from './CohortBand';
import './cohorts.css';

export function CohortsFigure({ projects, rows, names, at, onMove, onOpenCell, onOpenProject }: AtlasFigureProps) {
  const roving = useRovingFigure({ projects, dims: rows.length, at, onMove, onOpenCell, onOpenProject });
  const cohorts = useMemo(() => groupCohorts(projects, rows), [projects, rows]);
  const open = bandOf(cohorts, at.pi);

  return (
    <div
      ref={roving.ref}
      className="atlas-shapes"
      style={{ ['--cols' as string]: rows.length }}
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
      onBlur={roving.onBlur}
      data-testid="atlas-cohorts"
    >
      <div
        className="atlas-shapes__grid"
        role="grid"
        aria-label={W.shapes}
        aria-rowcount={cohorts.length + 1}
        aria-colcount={rows.length + 1}
      >
        {/* The dimension names, once for every band: the label rail the other
            figures have to pay for per project or give up entirely. */}
        <div role="row" className="atlas-shapes__rail">
          <span role="columnheader" className="atlas-shapes__rail-head typo-eyebrow k-quiet">
            {W.shapesOf(cohorts.length, projects.length)}
          </span>
          {rows.map((r, di) => (
            <span
              key={r.key}
              role="columnheader"
              className={`atlas-shapes__dim typo-label${di === at.di ? ' is-current' : ''}`}
            >
              <Hint content={r.info} placement="bottom">
                <span>{SHORT_LABEL[r.key] ?? r.label}</span>
              </Hint>
            </span>
          ))}
        </div>

        {cohorts.map((c, i) => (
          <CohortBand
            key={c.id}
            cohort={c}
            index={i}
            total={projects.length}
            rows={rows}
            names={names}
            at={at}
            live={i === open}
            onMove={onMove}
            onOpenCell={onOpenCell}
            onOpenProject={onOpenProject}
          />
        ))}
      </div>
    </div>
  );
}
