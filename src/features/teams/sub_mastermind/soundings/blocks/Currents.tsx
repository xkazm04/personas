// Relations as currents along the seabed, and their labels. Two regions rather
// than one component because the arcs sit UNDER the buoys and the labels sit
// over everything, and DOM order is what decides that.
import { anchorX, currentArc } from '../soundingsGeometry';
import { useSoundingsModel } from '../context';

export function CurrentArcs() {
  const { edges, indexOf, n, act, geo, nav } = useSoundingsModel();
  const { level, cur } = nav;
  const { g } = geo;
  if (!g) return null;
  return (
    <svg className="sd-currents" viewBox={`0 0 ${g.W} ${g.H}`} aria-hidden>
      {edges.map((e) => {
        const a = indexOf.get(e.from)!;
        const b = indexOf.get(e.to)!;
        const arc = currentArc(anchorX(g, a, b, level, cur ?? 0, n), anchorX(g, b, a, level, cur ?? 0, n), g);
        const on = a === act || b === act;
        const cls = [e.kind === 'similarity' ? 'sd-sim' : '', on ? 'sd-on' : level === 0 ? 'sd-dim' : 'sd-gone'].filter(Boolean).join(' ');
        return <path key={`${e.from}-${e.to}-${e.kind}`} className={cls} d={arc.d} />;
      })}
    </svg>
  );
}

export function CurrentLabels() {
  const { edges, indexOf, n, act, geo, nav } = useSoundingsModel();
  const { level, cur, hover } = nav;
  const { g } = geo;
  if (!g) return null;
  return (
    <div className="sd-curlabels" aria-hidden>
      {edges.map((e) => {
        if (!e.label) return null;
        const a = indexOf.get(e.from)!;
        const b = indexOf.get(e.to)!;
        const arc = currentArc(anchorX(g, a, b, level, cur ?? 0, n), anchorX(g, b, a, level, cur ?? 0, n), g);
        const on = (a === act || b === act) && (level === 0 || hover === a || hover === b);
        return <span key={`${e.from}-${e.to}-${e.kind}`} className={on ? 'sd-clab sd-on' : 'sd-clab'} style={{ left: arc.labelX, top: arc.labelY }}>{e.label}</span>;
      })}
    </div>
  );
}
