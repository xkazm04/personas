// CONCEPT - CORE SAMPLE. A portfolio is a cut, and the thing you read first is
// its grain.
//
// The matrix and the stamp sheet both bet that the PROJECT is what you reach
// for first. At 102 projects that bet is wrong in the operator's own words:
// the question he opens this surface with is not "what does project 57 look
// like", it is "how far has the fleet got, and on what". So the dimension is
// the object here, and it is not a column of cells - it is one continuous
// core, 102 laminae deep, with no row chrome, no stripes, no name column and
// no scroll, because 102 laminae at 3px is a 306px figure whatever the
// portfolio grows to.
//
// Two things follow from compressing it. Each core states the depth it has
// actually been cut to at its own foot, and the uncut remainder is drawn as
// rock rather than as ninety-three empty dots - so a core's inked fraction IS
// its denominator and the number beneath only confirms it. And the cores are
// ordered deepest-first, which turns the lens into the portfolio's frontier as
// a single silhouette.
//
// A project has not been dropped: it is a DEPTH. The cursor's lamina blooms
// open across every core at once and the axis prints its name at exactly that
// depth, so one project still reads as a complete slice.
import { useMemo } from 'react';
import { ATLAS_WORDS as W } from '../../atlasWords';
import type { AtlasFigureProps } from '../../atlasFigure';
import { useRovingFigure } from '../useRovingFigure';
import { byDepth } from './coresample.model';
import { Core } from './Core';
import { DepthAxis } from './DepthAxis';
import './coresample.css';

export function CoreSampleFigure({ projects, rows, names, at, onMove, onOpenCell, onOpenProject }: AtlasFigureProps) {
  const roving = useRovingFigure({ projects, dims: rows.length, at, onMove, onOpenCell, onOpenProject });
  const cores = useMemo(() => byDepth(projects, rows), [projects, rows]);

  return (
    <div
      ref={roving.ref}
      className="atlas-cut"
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
      onBlur={roving.onBlur}
      data-testid="atlas-coresample"
    >
      <DepthAxis projects={projects} names={names} pi={at.pi} onOpenProject={onOpenProject} />
      <div
        className="atlas-cut__plot"
        role="grid"
        aria-label={W.cut}
        aria-rowcount={rows.length}
        aria-colcount={projects.length}
      >
        {cores.map((c) => (
          <Core
            key={c.row.key}
            row={c.row}
            di={c.di}
            stats={c.stats}
            projects={projects}
            at={at}
            onMove={onMove}
            onOpenCell={onOpenCell}
          />
        ))}
      </div>
    </div>
  );
}
