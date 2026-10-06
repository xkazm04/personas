// CONCEPT - STAMP SHEET. A portfolio is a sheet of stamps, and a project is
// one stamp you can recognise without reading it.
//
// The matrix's bet is that a project is a reading LINE and you find a problem
// by scanning a column. That bet breaks at this portfolio's real scale: 102
// projects at a 32px row band is 3,264px of scroll with no landmark in it, and
// 74 of the 102 names are a sentence the 248px name column cuts after about
// thirty characters. So the line is the wrong container.
//
// A stamp is not a smaller row. It is the project's own passport in
// miniature - the same mosaic, the same ink, the same order - so the whole
// portfolio fits one screen as 102 SHAPES, and you pick a project out by the
// shape of its gaps rather than by reading its name. The loupe above the sheet
// is the same component at `l`, which is the only thing the sheet gives up.
import { useMemo } from 'react';
import { ATLAS_WORDS as W } from '../../atlasWords';
import type { AtlasFigureProps } from '../../atlasFigure';
import { useRovingFigure } from '../useRovingFigure';
import { Stamp } from './Stamp';
import './stampsheet.css';

export function StampSheetFigure({ projects, rows, names, at, onMove, onOpenCell, onOpenProject }: AtlasFigureProps) {
  const roving = useRovingFigure({ projects, dims: rows.length, at, onMove, onOpenCell, onOpenProject });
  const current = projects[at.pi];
  const shared = useMemo(() => ({ rows, names, at, onMove, onOpenCell, onOpenProject }), [rows, names, at, onMove, onOpenCell, onOpenProject]);

  return (
    <div
      ref={roving.ref}
      className="atlas-sheet"
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
      onBlur={roving.onBlur}
      data-testid="atlas-stampsheet"
    >
      {current && (
        <div className="atlas-sheet__loupe">
          <Stamp pi={at.pi} p={current} size="l" {...shared} />
        </div>
      )}
      <div
        className="atlas-sheet__grid"
        role="grid"
        aria-label={W.sheet}
        aria-rowcount={projects.length}
        aria-colcount={rows.length}
      >
        {projects.map((p, pi) => <Stamp key={p.identity.slug} pi={pi} p={p} size="s" {...shared} />)}
      </div>
    </div>
  );
}
