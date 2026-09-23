// One deed in the register: rank, state glyph, name, and the overall in its
// standing's ink. 32px tall (owner: "reduce a bit row spacing in left
// sidebar"), 14px type, the span column only while sorting by span so a full
// feature name fits a 312px register.
//
// A null overall is a hatched bar and says "not measured"; a feature no council
// ever judged prints a calm dash. Neither is ever a zero.
import { memo } from 'react';

import type { TDevTools } from '@/features/plugins/dev-tools/sub_context/contextLedgerShared';
import { formatNumeric } from '@/lib/utils/formatters';

import type { TFeatures } from '../featuresModel';
import { standingOf, type CadRow } from './cadastreModel';
import { DeedGlyph } from './DeedGlyph';

export function rowDomId(key: string): string {
  return `cad-r-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

const SPAN_ICON = (
  <svg viewBox="0 0 11 11" aria-hidden="true">
    <rect x=".5" y=".5" width="4" height="4" rx="1" fill="currentColor" />
    <rect x="6.5" y=".5" width="4" height="4" rx="1" fill="currentColor" opacity=".6" />
    <rect x=".5" y="6.5" width="4" height="4" rx="1" fill="currentColor" opacity=".6" />
    <rect x="6.5" y="6.5" width="4" height="4" rx="1" fill="none" stroke="currentColor" />
  </svg>
);

export interface RegisterRowProps {
  r: CadRow;
  focused: boolean;
  claimsHot: boolean;
  withSpan: boolean;
  onOpen: (key: string, el: HTMLElement) => void;
  onPreview: (key: string) => void;
  t: TFeatures;
  tDev: TDevTools;
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

function Score({ r, t, language }: { r: CadRow; t: TFeatures; language: string }) {
  const council = r.row.feature.council;
  if (!council) {
    return <span className="sc none" data-role="cad-row-score" aria-label={t.move_never}>-</span>;
  }
  if (council.overall == null) {
    return (
      <span className="sc" data-role="cad-row-score" aria-label={t.not_measured}>
        <i className="nullbar" />
      </span>
    );
  }
  const st = standingOf(r.row.move);
  const ink = st === 'staked' || st === 'session' ? '' : st;
  return (
    <span className={`sc ${ink}`} data-role="cad-row-score">
      {formatNumeric(council.overall, 'plain', { language, precision: 2 })}
    </span>
  );
}

export const RegisterRow = memo(function RegisterRow({ r, focused, claimsHot, withSpan, onOpen, onPreview, t, tDev, tx, language }: RegisterRowProps) {
  const { feature } = r.row;
  const cls = ['row', `st-${r.row.kind ?? 'none'}`];
  if (withSpan) cls.push('w-span');
  if (focused) cls.push('is-focus');
  if (claimsHot) cls.push('claims-hot');

  return (
    <div
      id={rowDomId(r.key)}
      className={cls.join(' ')}
      role="option"
      aria-selected={focused}
      data-role="cad-row"
      data-key={r.key}
      data-testid="cad-row"
      onClick={(e) => onOpen(r.key, e.currentTarget)}
      onMouseEnter={() => onPreview(r.key)}
    >
      <span className="rk">{r.rank}</span>
      <DeedGlyph kind={r.row.kind} tDev={tDev} />
      <span className="nm">
        <span className="nt">{feature.name}</span>
        {r.dup != null ? <i className="dup">{tx(t.cadastre_copy, { n: r.dup })}</i> : null}
      </span>
      {withSpan ? (
        <span className="sp" aria-label={tx(t.cadastre_parcels, { count: feature.contextIds.length })}>
          {SPAN_ICON}
          {feature.contextIds.length}
        </span>
      ) : null}
      <Score r={r} t={t} language={language} />
    </div>
  );
});
