import type { MapIds } from './MapDefs';
import { blobPath, curve, reeds, ribbon } from './paths';
import { f1 } from './noise';
import type { Scene } from './useScene';

/**
 * The water, under the arrival clip: the sea, the distributaries peeling off into lakes (clean)
 * and marshes (failing), the river itself with its rapids, and the delta's mouths. Each station's
 * marks share a `ws-st` group with `data-q`, so focusing a station dims the rest without React.
 */
export function MapWater({ scene, ids }: { scene: Scene; ids: MapIds }) {
  const { g } = scene;
  const U = g.U;
  return (
    <g clipPath={`url(#${ids.reveal})`}>
      <g aria-hidden="true">
        <rect x={f1(g.xM - 10)} y={-g.H} width={f1(g.W * 2)} height={g.H * 3} fill={`url(#${ids.sea})`} />
        <path d={scene.sea.coast} className="ws-coast" />
        <path d={scene.sea.waves} className="ws-wave" />
      </g>
      <g>
        {g.blobs.map((b) => {
          const sd = b.q * 3.1 + (b.type === 'lake' ? 1 : 2);
          const worst = g.ranks[b.q] === 1;
          return (
            <g key={b.type + b.q} className="ws-st" data-q={b.q}>
              <path d={curve(b.p0, b.p1, b.p2, b.p3)} className={b.type === 'lake' ? 'ws-dist-clean' : 'ws-dist-fail'} strokeWidth={f1(b.w)} />
              {b.type === 'lake' ? (
                <>
                  <path d={blobPath(b.cx, b.cy, b.rx, b.ry, sd, 0.25)} className="ws-lake" />
                  <path d={blobPath(b.cx, b.cy, b.rx * 0.68, b.ry * 0.62, sd, 0.3)} className="ws-lake-ring" />
                  {b.r > 14 && <path d={blobPath(b.cx, b.cy, b.rx * 0.36, b.ry * 0.3, sd, 0.3)} className="ws-lake-ring" />}
                </>
              ) : (
                <>
                  {worst && <ellipse cx={f1(b.cx)} cy={f1(b.cy)} rx={f1(b.rx * 1.25)} ry={f1(b.ry * 1.25)} className="ws-marsh-glow" filter={`url(#${ids.soft})`} />}
                  <path d={blobPath(b.cx, b.cy, b.rx, b.ry, sd, 0.42)} className="ws-marsh-under" />
                  <path d={blobPath(b.cx, b.cy, b.rx, b.ry, sd, 0.42)} className={worst ? 'ws-marsh is-worst' : 'ws-marsh'} fill={`url(#${ids.hatch})`} />
                  <path d={reeds(b)} className="ws-reed" />
                </>
              )}
            </g>
          );
        })}
      </g>
      <g>
        <path d={scene.river.body} fill={`url(#${ids.river})`} />
        <path d={scene.river.top} className="ws-river-edge" />
        <path d={scene.river.bottom} className="ws-river-edge" />
        {scene.rapids.map((r) => (
          <g key={r.q} className="ws-st" data-q={r.q}>
            <path d={r.d} className="ws-rapid" strokeWidth={r.width} strokeOpacity={r.opacity} />
          </g>
        ))}
      </g>
      <g>
        {g.mouths.map((mo) => {
          if (!mo.cnt) return null;
          const rib = ribbon(g.xB, mo.ya, mo.yb, g.xM, mo.ys - mo.w / 2, mo.ys + mo.w / 2);
          const fan = 14 * U, x2 = g.xM + 26 * U;
          const fanD = `M${f1(g.xM)} ${f1(mo.ys - mo.w / 2)} L${f1(x2)} ${f1(mo.ys - mo.w / 2 - fan)} L${f1(x2)} ${f1(mo.ys + mo.w / 2 + fan)} L${f1(g.xM)} ${f1(mo.ys + mo.w / 2)}Z`;
          return (
            <g key={mo.o}>
              <path d={rib} className={`ws-rib o-${mo.o}`} />
              <path d={fanD} className={`ws-rib is-fan o-${mo.o}`} />
              {mo.o === 'interrupted' && <path d={rib} className="ws-rib-dash" />}
            </g>
          );
        })}
      </g>
    </g>
  );
}

/** The spring: where every session sets out, glowing at the river's head. */
export function Spring({ scene, ids }: { scene: Scene; ids: MapIds }) {
  const { g } = scene;
  const cy = f1(g.yc(g.xA));
  return (
    <g aria-hidden="true">
      <circle cx={f1(g.xA)} cy={cy} r={f1(g.srcW * 0.75)} fill={`url(#${ids.spring})`} />
      <circle cx={f1(g.xA)} cy={cy} r={f1(Math.max(5, g.srcW * 0.16))} className="ws-spring-core" filter={`url(#${ids.glow})`} />
    </g>
  );
}
