// ONE band: a distinct passport shape, drawn once at FULL size, stating how
// many projects it speaks for.
//
// This is the only one of the four figures that can afford comfortable marks
// and real labels, and the reason is arithmetic: it draws the shape once per
// cohort instead of once per project, so a 102-project portfolio costs a
// handful of strips rather than 1,428 cells. The denominator sits on the band
// where the eye already is - `41 of 102` - which is the banked pattern this
// concept is built out of.
import { ChipRow } from '@/features/shared/components/kit';
import { InkDot } from '../../AtlasParts';
import { INK_MARK, ATLAS_WORDS as W } from '../../atlasWords';
import type { AtlasRow } from '../../atlasModel';
import type { AtlasCoord } from '../../atlasFigure';
import type { AtlasNames } from '../../atlasFigure';
import { splitLead } from '../stampsheet/stampsheet.model';
import type { Cohort } from './cohorts.model';

export function CohortBand({ cohort, index, total, rows, names, at, live, onMove, onOpenCell, onOpenProject }: {
  cohort: Cohort;
  index: number;
  /** The whole portfolio, for the denominator. */
  total: number;
  rows: AtlasRow[];
  names: AtlasNames;
  at: AtlasCoord;
  /** True when the roving project is one of this band's members. */
  live: boolean;
  onMove: (c: AtlasCoord) => void;
  onOpenCell: (c: AtlasCoord) => void;
  onOpenProject: (slug: string) => void;
}) {
  const lead = cohort.members[0];
  if (!lead) return null;
  // On the open band the cells belong to the ROVING project, not to the band's
  // first member, so the testids and the doors address the right passport.
  const subject = (live ? cohort.members.find((m) => m.pi === at.pi)?.p : undefined) ?? lead.p;

  return (
    <div role="row" className={`atlas-shape${live ? ' is-live' : ''}`} data-testid={`atlas-shape-${index}`}>
      <span role="rowheader" className="atlas-shape__head">
        <span className="atlas-shape__count typo-title-lg tabular-nums">{W.depthOf(cohort.members.length, total)}</span>
        <span className="atlas-shape__known typo-caption tabular-nums">{W.measuredLong(cohort.known, rows.length)}</span>
      </span>

      {rows.map((r, di) => {
        const ink = cohort.inks[di] ?? 'unknown';
        const here = live && di === at.di;
        const pi = live ? at.pi : lead.pi;
        return (
          <span
            key={r.key}
            role="gridcell"
            tabIndex={here ? 0 : -1}
            data-cell={live ? `${at.pi}:${di}` : undefined}
            data-ink={ink}
            className={`atlas-shape__slot${here ? ' is-here' : ''}${di === at.di ? ' is-column' : ''}`}
            aria-label={`${W.depthOf(cohort.members.length, total)}, ${r.label}: ${INK_MARK[ink].label}`}
            onClick={() => { onMove({ pi, di }); if (live) onOpenCell({ pi, di }); }}
            data-testid={`atlas-cell-${subject.identity.slug}-${r.key}`}
          >
            <InkDot ink={ink} />
          </span>
        );
      })}

      {/* The members, only on the open band: levels, not one layer. Each chip
          is the same door the project's name has always been. */}
      {live && (
        <span role="gridcell" className="atlas-shape__members">
          <ChipRow
            label={W.members}
            emptyLabel={W.nothingMeasured}
            chips={cohort.members.map((m) => ({
              id: m.p.identity.slug,
              label: splitLead(names.get(m.p.identity.slug)?.name ?? m.p.identity.name).title,
              state: m.pi === at.pi ? 'selected' as const : undefined,
              onPress: () => onOpenProject(m.p.identity.slug),
            }))}
          />
        </span>
      )}
    </div>
  );
}
