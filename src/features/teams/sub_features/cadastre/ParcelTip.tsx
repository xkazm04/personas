// The tip over a parcel names its claim: the context, its district and
// standing, and the deeds that claim it (each one opens its layer). Over open
// ground it says nobody claims it and offers the unclaimed list. Over a
// district it counts the district's parcels by standing.
//
// It is an interactive surface (its rows are buttons), so it stays open while
// the pointer crosses into it; the element is always mounted and hidden when
// idle, which is how the winner's `#tip` sat in its page.
import { useLayoutEffect, useRef } from 'react';

import type { TDevTools } from '@/features/plugins/dev-tools/sub_context/contextLedgerShared';

import type { TFeatures } from '../featuresModel';
import { PARCEL_CATS, type CadRow, type ParcelCat } from './cadastreModel';
import type { MapHover } from './CadastreMap';
import { DeedGlyph } from './DeedGlyph';

export function catLabel(cat: ParcelCat, t: TFeatures): string {
  switch (cat) {
    case 'proven': return t.map_legend_settled;
    case 'gate': return t.cadastre_cat_gate;
    case 'trouble': return t.map_legend_trouble;
    case 'session': return t.map_legend_running;
    case 'staked': return t.cadastre_cat_staked;
    case 'platform': return t.map_legend_platform;
    case 'tests': return t.map_legend_tests;
    case 'open': return t.map_legend_unclaimed;
    default: return t.role_unknown;
  }
}

export interface ParcelTipProps {
  hover: MapHover | null;
  claims: Map<string, CadRow[]>;
  onOpen: (key: string) => void;
  onUnclaimed: () => void;
  onEnter: () => void;
  onLeave: () => void;
  t: TFeatures;
  tDev: TDevTools;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

function ParcelBody({ hover, claims, onOpen, onUnclaimed, t, tDev, tx }: ParcelTipProps) {
  const P = hover!.p!;
  const fs = [...(claims.get(P.id) ?? [])].sort((a, b) => a.rank - b.rank);
  return (
    <>
      <div className="th"><i className={`sw f-${P.cat}`} aria-hidden="true" /><span>{P.name}</span></div>
      <div className="tm">{P.groupName} · {catLabel(P.cat, t)}</div>
      <div className="tf">
        {fs.length ? (
          <>
            <span className="t-label">{tx(fs.length === 1 ? t.cadastre_tip_claimed_one : t.cadastre_tip_claimed_other, { count: fs.length })}</span>
            {fs.slice(0, 6).map((r) => (
              <button key={r.key} type="button" onClick={() => onOpen(r.key)} data-testid="cad-tip-claimant">
                <span className="rkk">{r.rank}</span>
                <DeedGlyph kind={r.row.kind} tDev={tDev} />
                <span>{r.row.feature.name}</span>
              </button>
            ))}
            {fs.length > 6 ? <span className="dim">{tx(t.cadastre_tip_more, { count: fs.length - 6 })}</span> : null}
          </>
        ) : (
          <>
            <span className="t-label">{t.cadastre_tip_nobody}</span>
            <button type="button" onClick={onUnclaimed}>
              <kbd className="kbd">u</kbd>
              <span>{t.cadastre_tip_all_unclaimed}</span>
            </button>
          </>
        )}
      </div>
    </>
  );
}

function DistrictBody({ hover, t, tx }: ParcelTipProps) {
  const D = hover!.d!;
  const n: Partial<Record<ParcelCat, number>> = {};
  for (const P of hover!.lay.parcels) if (P.d === D.i) n[P.cat] = (n[P.cat] ?? 0) + 1;
  return (
    <>
      <div className="th"><span>{D.name}</span></div>
      <div className="tm tm-flush">{tx(t.cadastre_tip_district, { count: D.n })}</div>
      <div className="tf">
        {PARCEL_CATS.filter((c) => n[c]).map((c) => (
          <span key={c} className="tcat"><i className={`sw f-${c}`} aria-hidden="true" /><b>{n[c]}</b>{catLabel(c, t)}</span>
        ))}
      </div>
    </>
  );
}

export function ParcelTip(props: ParcelTipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { hover } = props;

  useLayoutEffect(() => {
    const tip = ref.current;
    if (!tip || !hover) return;
    // The page root is a size container, and containment makes it the
    // containing block of a fixed element: place the tip in its coordinates
    // and keep it inside its box rather than the window's.
    const host = (tip.parentElement ?? document.body).getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const r = hover.rect;
    let x: number;
    let y: number;
    if (hover.kind === 'parcel') {
      x = r.right + 10;
      y = r.top - 6;
      if (x + tr.width > host.right - 8) x = r.left - tr.width - 10;
      if (y + tr.height > host.bottom - 8) y = host.bottom - tr.height - 8;
    } else {
      x = r.left + 8;
      y = r.top + 30;
      if (x + tr.width > host.right - 8) x = host.right - tr.width - 8;
      if (y + tr.height > host.bottom - 8) y = r.top - tr.height - 6;
    }
    tip.style.left = `${Math.max(8, x - host.left)}px`;
    tip.style.top = `${Math.max(8, y - host.top)}px`;
  }, [hover]);

  return (
    <div
      ref={ref}
      className="tip"
      data-role="cad-tip"
      data-testid="cad-tip"
      data-ctx={hover?.p?.id ?? ''}
      hidden={!hover}
      onMouseEnter={props.onEnter}
      onMouseLeave={props.onLeave}
    >
      {hover?.kind === 'parcel' ? <ParcelBody {...props} /> : hover?.kind === 'district' ? <DistrictBody {...props} /> : null}
    </div>
  );
}
