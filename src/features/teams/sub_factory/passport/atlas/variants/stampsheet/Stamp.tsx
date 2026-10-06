// ONE object, drawn at two sizes. The sheet is 102 of these at `s`; the loupe
// above it is the current project as the SAME component at `l`. The vault's
// banked pattern is explicit that this is what works - "keep the metaphor
// visible as the same object at both sizes rather than a slim icon that opens
// an unrelated panel" - so the enlargement is the stamp itself, never a
// different drawing of the same project.
import { Button } from '@/features/shared/components/buttons';
import { Hint } from '@/features/shared/components/kit';
import { inkOf, type AtlasRow } from '../../atlasModel';
import { valueText } from '../../AtlasParts';
import { ATLAS_WORDS as W, INK_MARK, SHORT_LABEL } from '../../atlasWords';
import type { AppPassport } from '../../../passportModel';
import type { AtlasCoord, AtlasNames } from '../../atlasFigure';
import { ABSENT, measured, mosaicCols, splitLead } from './stampsheet.model';

export function Stamp({ pi, p, rows, names, at, size, onMove, onOpenCell, onOpenProject }: {
  pi: number;
  p: AppPassport;
  rows: AtlasRow[];
  names: AtlasNames;
  /** The roving coordinate, so the stamp knows which of its own cells is live. */
  at: AtlasCoord;
  size: 's' | 'l';
  onMove: (c: AtlasCoord) => void;
  onOpenCell: (c: AtlasCoord) => void;
  onOpenProject: (slug: string) => void;
}) {
  const nm = names.get(p.identity.slug);
  const { lead, title } = splitLead(nm?.name ?? p.identity.name);
  const { known, total } = measured(p, rows);
  const big = size === 'l';
  const live = at.pi === pi;

  return (
    <div
      className={`atlas-stamp${live && !big ? ' is-live' : ''}`}
      data-size={size}
      role={big ? undefined : 'row'}
      style={{ ['--mosaic' as string]: mosaicCols(rows.length) }}
      data-testid={big ? 'atlas-stamp-loupe' : `atlas-row-${p.identity.slug}`}
    >
      <span className="atlas-stamp__id" role={big ? undefined : 'rowheader'}>
        {lead && <span className="atlas-stamp__lead typo-eyebrow k-quiet">{lead}</span>}
        <Button
          variant="ghost"
          size="sm"
          className="atlas-stamp__name"
          onClick={() => onOpenProject(p.identity.slug)}
          data-testid={big ? 'atlas-loupe-open' : `atlas-open-${p.identity.slug}`}
        >
          <span className={big ? 'typo-title-lg' : 'typo-body'}>{title}</span>
          {nm?.qualifier && <span className="atlas-stamp__qualifier typo-caption">{nm.qualifier}</span>}
        </Button>
      </span>

      <div className="atlas-stamp__plate">
        <div className="atlas-stamp__mosaic">
          {rows.map((r, di) => {
            const ink = inkOf(p, r);
            const here = live && di === at.di;
            return (
              <span
                key={r.key}
                role={big ? undefined : 'gridcell'}
                tabIndex={big ? undefined : here ? 0 : -1}
                data-cell={big ? undefined : `${pi}:${di}`}
                data-ink={ink}
                className={`atlas-stamp__cell${here ? ' is-here' : ''}${di === at.di ? ' is-column' : ''}`}
                aria-label={big ? undefined : `${p.identity.name}, ${r.label}: ${INK_MARK[ink].label}`}
                onClick={() => { onMove({ pi, di }); onOpenCell({ pi, di }); }}
                data-testid={big ? undefined : `atlas-cell-${p.identity.slug}-${r.key}`}
              />
            );
          })}
        </div>
        {/* The denominator where the eye already is, on the figure itself. */}
        <span className="atlas-stamp__measured typo-caption tabular-nums">{big ? W.measuredLong(known, total) : W.measuredOf(known, total)}</span>
      </div>

      {/* The rail the sheet cannot carry: the names and values of what is
          actually known. The unmeasured remainder is stated as the
          denominator above and deliberately not listed. */}
      {big && (
        <ul className="atlas-stamp__rail">
          {rows.filter((r) => !ABSENT.has(inkOf(p, r))).map((r) => (
            <li key={r.key} className={`atlas-stamp__fact${r.key === rows[at.di]?.key ? ' is-here' : ''}`}>
              <span className="atlas-stamp__fact-k typo-label" data-ink={inkOf(p, r)}>
                <Hint content={r.info} placement="bottom">
                  <span>{SHORT_LABEL[r.key] ?? r.label}</span>
                </Hint>
              </span>
              <span className="atlas-stamp__fact-v typo-caption k-ellipsis">{valueText(r.get(p))}</span>
            </li>
          ))}
          {known === 0 && <li className="atlas-stamp__fact typo-caption k-quiet">{W.nothingMeasured}</li>}
        </ul>
      )}
    </div>
  );
}
