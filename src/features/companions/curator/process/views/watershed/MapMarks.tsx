import { useTranslation } from '@/i18n/useTranslation';
import { outcomeName } from '../../labels';
import type { MapIds } from './MapDefs';
import { f1 } from './noise';
import { share } from './words';
import type { Scene } from './useScene';

const CLS = { marsh: 'is-marsh', lake: 'is-lake', place: 'is-place', sub: 'is-sub', ghost: 'is-ghost' } as const;

/**
 * The map's writing: lake and marsh counts, place names, the waits written along the river and
 * the delta's "how the sessions ended" column. Positions come from the label allocator; size is
 * one CSS type step, so nothing here measures or re-lays out.
 */
export function MapLabels({ scene, ids, arriving }: { scene: Scene; ids: MapIds; arriving: boolean }) {
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const w = p.watershed;
  const { g, labels } = scene;
  const fs = g.fs;
  const lx = g.xM + 34 * g.U;
  const split = labels.deltaHead.length > 1;
  return (
    <g className={arriving ? 'ws-labels is-arriving' : 'ws-labels'} aria-hidden="true">
      {labels.texts.map((l) => (
        <text key={l.key} className={`ws-lbl ${CLS[l.cls]}`} x={f1(l.x)} y={f1(l.y)}>{l.text}</text>
      ))}
      {labels.waits.map((wt) => (
        <text key={wt.q} className="ws-lbl is-wait">
          <textPath href={`#${ids.wait(wt.q)}`} startOffset="50%" textAnchor="middle">{wt.text}</textPath>
        </text>
      ))}
      {labels.deltaHead.map((line, i) => (
        <text key={i} className={split ? 'ws-lbl is-head is-split' : 'ws-lbl is-head'} x={f1(lx)} y={f1(g.headY - (labels.deltaHead.length - 1 - i) * fs * 1.3)}>{line}</text>
      ))}
      {g.mouths.map((mo) => {
        const all = scene.outcomes[mo.o] ?? 0;
        const y = mo.ys - fs * 0.9;
        return (
          <g key={mo.o}>
            <text className={`ws-lbl is-mouth o-${all ? mo.o : 'none'}`} x={f1(lx)} y={f1(y)}>{outcomeName(p, mo.o)}</text>
            <text className="ws-lbl" x={f1(lx)} y={f1(y + fs * 1.45)}>
              {all ? (
                <>
                  <tspan className="is-n">{all}</tspan>
                  <tspan className="is-sub" dx="6">{`· ${share(all, g.n)}`}</tspan>
                </>
              ) : <tspan className="is-sub">{w.mouth_none}</tspan>}
            </text>
            {all > 0 && (
              <text className="ws-lbl is-sub" x={f1(lx)} y={f1(y + fs * 2.6)}>
                {mo.cnt ? tx(w.mouth_sea, { count: mo.cnt }) : w.mouth_upstream}
              </text>
            )}
            {!mo.cnt && <path d={`M${f1(g.xM)} ${f1(mo.ys)}h${f1(20 * g.U)}`} className="ws-mouth-stub" />}
          </g>
        );
      })}
    </g>
  );
}

/** Settlement rings on the river and the dotted leaders down to their plates. */
export function Settlements({ scene, ids }: { scene: Scene; ids: MapIds }) {
  const { g } = scene;
  return (
    <g aria-hidden="true">
      {g.x.map((x, q) => (
        <line key={q} className="ws-leader" data-q={q} x1={f1(x)} y1={f1(g.bot(x) + 4)} x2={f1(x)} y2={f1(g.plates[q]!.top - 2)} />
      ))}
      {g.x.map((x, q) => {
        const y = f1(g.yc(x));
        return (
          <g key={q} className="ws-st" data-q={q}>
            <circle cx={f1(x)} cy={y} r={f1(26 * g.U)} className="ws-settle-halo" filter={`url(#${ids.soft})`} />
            <circle cx={f1(x)} cy={y} r={f1(9 * g.U)} className={g.ranks[q] === 1 ? 'ws-settle-ring is-hot' : 'ws-settle-ring'} />
            <circle cx={f1(x)} cy={y} r={f1(3.4 * g.U)} className="ws-settle-dot" />
          </g>
        );
      })}
    </g>
  );
}
