import { memo } from 'react';
import type { MapIds } from './MapDefs';
import { f1, type Pt } from './noise';
import type { Scene } from './useScene';

/**
 * One session's voyage, drawn over the map at the third depth: its own lane down the river,
 * a dot per settlement it matched (hollow where it skipped one), an amber ring where it stumbled,
 * and the place it ended (marsh, lake or delta mouth). It wipes in left to right (a transform).
 */
export const Voyage = memo(function Voyage({ scene, ids, id, outcome }: { scene: Scene; ids: MapIds; id: string; outcome: string }) {
  const { g, fates } = scene;
  const lane = fates.lanes.get(id), fate = fates.fate.get(id), tr = fates.per.get(id);
  if (lane == null || !fate || !tr) return null;
  const xEnd = fate.type === 'sea' ? g.xB : g.dx[fate.q]!;
  let d = '';
  for (let x = g.xA; x <= xEnd; x += 4) d += (d ? 'L' : 'M') + f1(x) + ' ' + f1(g.laneY(lane, x));
  let cur: [Pt, Pt, Pt];
  if (fate.type === 'sea') {
    const mo = g.mouths.find((m) => m.o === fate.o)!;
    const fr = mo.cnt ? (lane - fates.seaStart[fate.o] + 0.5) / mo.cnt : 0.5;
    const c = (g.xM - g.xB) * 0.55, y0 = g.laneY(lane, g.xB), y1 = mo.ys - mo.w / 2 + fr * mo.w;
    cur = [[g.xB + c, y0], [g.xM - c, y1], [g.xM + 30 * g.U, y1]];
  } else {
    const b = g.blobs.find((bb) => bb.type === fate.type && bb.q === fate.q)!;
    const x0 = g.dx[fate.q]!, yl = g.laneY(lane, x0);
    cur = [[x0 + 0.18 * g.sp, yl], b.p2, [b.cx, b.cy]];
  }
  d += ' C' + cur.map((pt) => pt.map(f1).join(' ')).join(' ');
  const clip = `${ids.reveal}v`;
  return (
    <svg className="ws-map" width={g.W} height={g.H} viewBox={`0 0 ${g.W} ${g.H}`} aria-hidden="true" data-testid="watershed-voyage">
      <defs>
        <clipPath id={clip}>
          <rect className="ws-voyage-wipe" x={g.xA - 20} y={-g.H} width={g.W + 40} height={g.H * 3} style={{ transformOrigin: `${g.xA - 20}px 0px` }} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <path d={d} className="ws-voyage-line" />
        {g.x.slice(0, tr.reach).map((x, q) => {
          const y = f1(g.laneY(lane, x));
          return (
            <g key={q}>
              {tr.frictionAt.includes(q) && <circle cx={f1(x)} cy={y} r={f1(9 * g.U)} className="ws-voyage-fric" />}
              <circle cx={f1(x)} cy={y} r={f1(4 * g.U)} className={tr.matched[q] ? 'ws-voyage-dot' : 'ws-voyage-skip'} />
            </g>
          );
        })}
        <circle cx={f1(cur[2][0])} cy={f1(cur[2][1])} r={f1(6 * g.U)} className={`ws-voyage-end o-${outcome}`} filter={`url(#${ids.glow})`} />
      </g>
    </svg>
  );
});
