// ONE core: a dimension drawn as a continuous vertical cut through the whole
// portfolio, one lamina per project, with the depth it has actually been cut
// to stated at its own foot.
//
// Grid semantics are declared TRANSPOSED against the matrix's, because the
// drawing is: a core is a run of `projects.length` cells for one dimension, so
// it is the `row` and a project is the column. ARIA does not fix a row's
// orientation on screen, and the arrows still mean what they always meant -
// vertical moves a project, because within a core vertical IS the project
// axis.
import { Hint } from '@/features/shared/components/kit';
import { inkOf, type AtlasRow } from '../../atlasModel';
import { INK_MARK, SHORT_LABEL, ATLAS_WORDS as W } from '../../atlasWords';
import type { AppPassport } from '../../../passportModel';
import type { AtlasCoord } from '../../atlasFigure';
import type { CoreStats } from './coresample.model';

export function Core({ row, di, stats, projects, at, onMove, onOpenCell }: {
  row: AtlasRow;
  /** The index in the LENS, not in the drawing: the cores are re-ordered by
   *  depth and the roving coordinate must still address the right dimension. */
  di: number;
  stats: CoreStats;
  projects: AppPassport[];
  at: AtlasCoord;
  onMove: (c: AtlasCoord) => void;
  onOpenCell: (c: AtlasCoord) => void;
}) {
  const live = di === at.di;
  return (
    <div role="row" className={`atlas-core${live ? ' is-current' : ''}`} data-testid={`atlas-core-${row.key}`}>
      <span role="rowheader" className="atlas-core__head typo-label">
        <Hint content={row.info} placement="bottom">
          <span>{SHORT_LABEL[row.key] ?? row.label}</span>
        </Hint>
      </span>
      <span className="atlas-core__body">
        {projects.map((p, pi) => {
          const ink = inkOf(p, row);
          const here = pi === at.pi && live;
          return (
            <span
              key={p.identity.slug}
              role="gridcell"
              tabIndex={here ? 0 : -1}
              data-cell={`${pi}:${di}`}
              data-ink={ink}
              className={`atlas-core__lamina${pi === at.pi ? ' is-depth' : ''}${here ? ' is-here' : ''}`}
              aria-label={`${p.identity.name}, ${row.label}: ${INK_MARK[ink].label}`}
              onClick={() => { onMove({ pi, di }); onOpenCell({ pi, di }); }}
              data-testid={`atlas-cell-${p.identity.slug}-${row.key}`}
            />
          );
        })}
      </span>
      {/* The denominator at the foot of the core, where the eye already is. */}
      <span className="atlas-core__foot typo-caption tabular-nums">{W.measuredOf(stats.known, stats.total)}</span>
    </div>
  );
}
