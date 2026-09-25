// The map: districts are the board's groups, parcels are their contexts,
// toned by the claim on each (`squareTone`), with each deed's rank printed on
// its primary parcel. Selecting or previewing a deed dims the rest of the
// ground and draws its survey line; a filter tag or a key swatch lights the
// parcels of that standing.
import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import { useElementSize } from '@/hooks/utility/interaction/useElementSize';

import type { GroupPlot } from '../featuresModel';
import type { CadRow, ParcelCat } from './cadastreModel';
import { computeLayout, makeMeasure, type District, type Layout, type Parcel } from './cadastreLayout';
import { MapLens } from './MapLens';
import { SurveyLines } from './SurveyLines';

export interface MapHover { kind: 'parcel' | 'district'; lay: Layout; p?: Parcel; d?: District; rect: DOMRect }

export interface CadastreMapProps {
  plots: GroupPlot[];
  cats: Map<string, ParcelCat>;
  ranked: CadRow[];
  claims: Map<string, CadRow[]>;
  active: CadRow | null;
  filterCat: ParcelCat | null;
  hlCat: ParcelCat | null;
  hotCtx: string | null;
  onHover: (h: MapHover | null) => void;
  onParcel: (p: Parcel, el: Element) => void;
  /** `l` toggles it; holding Alt shows it while held. Never over an open layer. */
  lens: boolean;
  label: string;
}

/** The platform mark: the parcel's own left edge, following its corner. */
function edgePath(s: number, r: number): string {
  const o = 0.9;
  return `M${r.toFixed(1)},${o} A${r},${r} 0 0 0 ${o},${r.toFixed(1)} V${(s - r).toFixed(1)} A${r},${r} 0 0 0 ${r.toFixed(1)},${(s - o).toFixed(1)}`;
}

export function CadastreMap(p: CadastreMapProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useElementSize(boxRef);
  const [family, setFamily] = useState('');
  const measure = useMemo(() => makeMeasure(family || 'sans-serif'), [family]);
  const lay = useMemo(
    () => (width > 0 && height > 0 ? computeLayout(p.plots, p.cats, width, height, measure, { labels: true }) : null),
    [p.plots, p.cats, width, height, measure],
  );
  // The labels are measured in the font the page actually renders.
  useLayoutEffect(() => {
    if (svgRef.current) setFamily(getComputedStyle(svgRef.current).fontFamily);
  }, []);
  /* Holding Alt shows the lens while held: read off the pointer's own event
     (altKey), so no key listener competes with the app's keyboard provider. */
  const [alt, setAlt] = useState(false);
  const [ptr, setPtr] = useState<{ x: number; y: number; boxX: number; boxY: number } | null>(null);
  const lensOn = p.lens || alt;

  const f = p.active;
  const slice = f ? new Set(f.row.feature.contextIds) : null;
  const dim = !!(f || p.filterCat || p.hlCat);
  const touched = new Set<number>();
  const prim = new Map<number, CadRow>();
  if (lay) {
    for (const r of p.ranked) {
      const P = r.row.feature.primaryContextId ? lay.byId.get(r.row.feature.primaryContextId) : undefined;
      if (P && (!prim.has(P.i) || prim.get(P.i)!.rank > r.rank)) prim.set(P.i, r);
    }
    for (const P of lay.parcels) if (slice?.has(P.id) || p.hotCtx === P.id) touched.add(P.d);
  }

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!lay) return;
    if (e.altKey !== alt) setAlt(e.altKey);
    if (p.lens || e.altKey) {
      // Fixed inside the page root, which is a size container: its own box is the frame.
      const host = e.currentTarget.closest('.cad')?.getBoundingClientRect();
      const box = boxRef.current?.getBoundingClientRect();
      if (host && box) setPtr({ x: e.clientX - host.left, y: e.clientY - host.top, boxX: box.left - host.left, boxY: box.top - host.top });
      p.onHover(null);
      return;
    }
    const t = e.target as Element;
    const pc = t.closest('[data-p]');
    if (pc) { p.onHover({ kind: 'parcel', lay, p: lay.parcels[Number(pc.getAttribute('data-p'))], rect: pc.getBoundingClientRect() }); return; }
    const dg = t.closest('[data-d]');
    if (dg) { p.onHover({ kind: 'district', lay, d: lay.districts[Number(dg.getAttribute('data-d'))], rect: dg.getBoundingClientRect() }); return; }
    p.onHover(null);
  };

  return (
    <div ref={boxRef} className="mapbox">
      <svg
        ref={svgRef}
        className={`map${dim ? ' dim' : ''}`}
        data-role="cad-map"
        role="img"
        aria-label={p.label}
        onMouseMove={onMove}
        onMouseLeave={() => { setPtr(null); setAlt(false); p.onHover(null); }}
        onClick={(e) => {
          const pc = (e.target as Element).closest('[data-p]');
          if (pc && lay) p.onParcel(lay.parcels[Number(pc.getAttribute('data-p'))]!, pc);
        }}
      >
        {lay ? (
          <>
            <g>
              {lay.districts.map((d) => (
                <g key={d.id} className={`dist${touched.has(d.i) ? ' touch' : ''}`} data-d={d.i} data-role="cad-district">
                  <rect className="dr" x={d.x} y={d.y} width={d.w} height={d.h} rx="9" />
                  {d.lines.map((ln, k) => (
                    <text key={k} className="dn" x={d.x + 9} y={d.y + 18.5 + k * 16} data-role={k === 0 ? 'cad-district-title' : undefined}>{ln}</text>
                  ))}
                  {d.count ? <text className="dc" x={d.x + d.w - 9} y={d.y + 18.5} textAnchor="end" data-role="cad-district-count">{d.n}</text> : null}
                </g>
              ))}
            </g>
            <g>
              {lay.parcels.map((P) => {
                const n = p.claims.get(P.id)?.length ?? 0;
                const inS = !!slice?.has(P.id);
                const keep = inS || (!f && p.hlCat === P.cat) || (!f && !p.hlCat && p.filterCat === P.cat) || p.hotCtx === P.id;
                const cls = ['pc', `c-${P.cat}`];
                if (keep) cls.push('keep');
                if (inS) cls.push('in');
                if (f && P.id === f.row.feature.primaryContextId) cls.push('prim');
                if (p.hotCtx === P.id) cls.push('hot');
                const s = P.s;
                const r = Math.min(4, s / 5);
                return (
                  <g key={P.id} className={cls.join(' ')} data-p={P.i} data-ctx={P.id} data-role="cad-parcel" data-tone={P.cat} transform={`translate(${P.x.toFixed(1)} ${P.y.toFixed(1)})`}>
                    <rect className="pf" data-role="cad-parcel-fill" width={s.toFixed(1)} height={s.toFixed(1)} rx={r.toFixed(1)} />
                    {P.cat === 'platform' && s >= 7 ? <path className="pedge" d={edgePath(s, Math.max(r, 2))} /> : null}
                    {n > 1 && s >= 40 ? (
                      <g className="mc">
                        <rect x={s - (n > 9 ? 26 : 18) - 3} y={s - 21} width={n > 9 ? 26 : 18} height="18" rx="4" />
                        <text x={s - 3 - (n > 9 ? 13 : 9)} y={s - 7.5} textAnchor="middle">{n}</text>
                      </g>
                    ) : n > 1 && s >= 12 ? <circle className="mcd" cx={s - 4.5} cy={s - 4.5} r="2.4" /> : null}
                  </g>
                );
              })}
            </g>
            {f ? (
              <SurveyLines contextIds={f.row.feature.contextIds} primaryId={f.row.feature.primaryContextId} lay={lay} caption={`${f.rank}  ${f.row.feature.name}`} measure={measure} drawKey={f.key} />
            ) : null}
            <g>
              {[...prim.entries()].map(([i, r]) => {
                const P = lay.parcels[i]!;
                if (P.s < 22) return null;
                const w = Math.max(18, measure(String(r.rank), 700) + 8);
                return (
                  <g key={r.key} className={`rb${f && f.key === r.key ? ' on' : ''}`} transform={`translate(${(P.x + 2).toFixed(1)} ${(P.y + 2).toFixed(1)})`}>
                    <rect width={w.toFixed(1)} height="18" rx="4" />
                    <text x={(w / 2).toFixed(1)} y="13.5" textAnchor="middle">{r.rank}</text>
                  </g>
                );
              })}
            </g>
          </>
        ) : null}
      </svg>
      <MapLens on={lensOn} pointer={ptr} lay={lay} active={f} openGround={p.filterCat === 'open'} measure={measure} />
    </div>
  );
}
