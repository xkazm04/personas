// The lens (`l`, or hold Alt): a 2.5x loupe that follows the pointer over the
// map with every parcel's name written in and the survey line of the deed in
// view, so the map needs no zoom level. Pointer-transparent; hidden whenever
// the pointer leaves the map or a deed's layer is open.
import type { CadRow } from './cadastreModel';
import { fit, surveyOrder, wrapWords, type Layout, type Measure } from './cadastreLayout';

const Z = 2.5;
const D = 180;

export interface MapLensProps {
  on: boolean;
  /** Pointer in the page root's own coordinates, plus the map box origin in them. */
  pointer: { x: number; y: number; boxX: number; boxY: number } | null;
  lay: Layout | null;
  active: CadRow | null;
  openGround: boolean;
  measure: Measure;
}

export function MapLens({ on, pointer, lay, active, openGround, measure }: MapLensProps) {
  const show = on && pointer != null && lay != null;
  const mx = show ? pointer.x - pointer.boxX : 0;
  const my = show ? pointer.y - pointer.boxY : 0;
  const half = D / 2 / Z;
  const X = (x: number) => (x - mx) * Z + D / 2;
  const Y = (y: number) => (y - my) * Z + D / 2;
  const slice = active ? new Set(active.row.feature.contextIds) : null;
  const order = show && active ? surveyOrder(active.row.feature.contextIds, active.row.feature.primaryContextId, lay) : [];

  return (
    <div
      className="lens"
      data-role="cad-lens"
      data-testid="cad-lens"
      hidden={!show}
      style={show ? { left: pointer.x - 92, top: pointer.y - 92 } : undefined}
    >
      {show ? (
        <svg viewBox="0 0 180 180" aria-hidden="true">
          {lay.districts
            .filter((d) => !(d.x > mx + half || d.x + d.w < mx - half || d.y > my + half || d.y + d.h < my - half))
            .map((d) => (
              <g key={d.id}>
                <rect className="ldr" x={X(d.x)} y={Y(d.y)} width={d.w * Z} height={d.h * Z} rx="16" />
                {Y(d.y) + 22 > 0 && Y(d.y) < D ? <text className="ldn" x={X(d.x) + 10} y={Y(d.y) + 20}>{fit(d.name, Math.max(40, d.w * Z - 20), 700, measure)}</text> : null}
              </g>
            ))}
          {lay.parcels
            .filter((P) => !(P.x > mx + half || P.x + P.s < mx - half || P.y > my + half || P.y + P.s < my - half))
            .map((P) => {
              const x0 = X(P.x);
              const y0 = Y(P.y);
              const s = P.s * Z;
              const tx = Math.max(x0 + 7, 16);
              const ty = Math.max(y0 + 18, 30);
              const avail = Math.min(x0 + s, 170) - tx - 4;
              const faded = (slice && !slice.has(P.id)) || (openGround && !slice && P.cat !== 'open');
              const lines = avail < 24 ? [] : wrapWords(P.name, avail, 600, measure).slice(0, Math.max(1, Math.floor((Math.min(y0 + s, 172) - ty + 12) / 16)));
              return (
                <g key={P.id} className={`pc c-${P.cat}`} opacity={faded ? 0.35 : undefined}>
                  <rect className="pf" x={x0} y={y0} width={s} height={s} rx="6" />
                  {lines.map((l, i) => <text key={i} className="ln" x={tx} y={ty + i * 16}>{fit(l, avail, 600, measure)}</text>)}
                </g>
              );
            })}
          {order.length > 1 ? (
            <>
              <path className="sv-halo lens-halo" d={`M${order.map((p) => `${X(p.cx).toFixed(1)} ${Y(p.cy).toFixed(1)}`).join(' L')}`} />
              <path className="sv-line still lens-line" data-role="cad-lens-survey" d={`M${order.map((p) => `${X(p.cx).toFixed(1)} ${Y(p.cy).toFixed(1)}`).join(' L')}`} />
              {order.map((p) => <circle key={p.id} className="sv-dot" cx={X(p.cx).toFixed(1)} cy={Y(p.cy).toFixed(1)} r="4.5" />)}
            </>
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}
