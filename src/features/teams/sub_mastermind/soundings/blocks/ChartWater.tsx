// The sea itself: air above the waterline, the three water bands, the depth
// contours, the ripple, the seabed, and the depth legend down the left edge.
//
// A drawn FIGURE, not structure (doctrine 6c): the bands ARE the urgency scale,
// so a labelled list of the same numbers would lose the point. Free inside its
// frame; type and colour still tokenised.
import { wavePath } from '../soundingsGeometry';
import { useSoundingsModel } from '../context';

export function ChartWater() {
  const { geo, b1, b2, words } = useSoundingsModel();
  const { bandName, bandMean } = words;
  const { g } = geo;
  if (!g) return null;

  const legendRows = [Math.round(g.wl * 0.62), Math.round((g.wl + b1) / 2), Math.round((b1 + b2) / 2), Math.round((b2 + g.bed) / 2)];

  return (
    <>
      <div className="sd-air" data-water="" style={{ height: g.wl }} />
      <div className="sd-sea" data-water="" style={{ top: g.wl }} />
      <svg className="sd-contours" viewBox={`0 0 ${g.W} ${g.H}`} aria-hidden>
        <path d={wavePath(b1, g.W, 1.6, 0)} />
        <path d={wavePath(b2, g.W, 1.6, 1)} />
        <path className="sd-minor" d={wavePath(Math.round((g.wl + b1) / 2), g.W, 1.2, 1)} />
        <path className="sd-minor" d={wavePath(Math.round((b1 + b2) / 2), g.W, 1.2, 0)} />
        <path className="sd-minor" d={wavePath(Math.round((b2 + g.bed) / 2), g.W, 1.2, 1)} />
        <path className="sd-bedline" d={`M0 ${g.bed} L${g.W} ${g.bed}`} />
      </svg>
      <div className="sd-ripple" style={{ top: g.wl - 6 }} aria-hidden><i /><i /></div>
      <div className="sd-seabed" data-water="" style={{ height: g.H - g.bed }} />
      <div className="sd-legend" style={{ width: g.legend }} aria-hidden>
        {legendRows.map((y, k) => (
          <div key={k} className="sd-lg" style={{ top: y }}>
            <span className="sd-nm typo-label">{bandName[k]}</span>
            <span className="sd-mn">{bandMean[k]}</span>
          </div>
        ))}
        <span className="sd-snd sd-wlab" style={{ top: g.wl }}>6</span>
        <span className="sd-snd" style={{ top: b1 }}>2</span>
        <span className="sd-snd" style={{ top: b2 }}>1</span>
      </div>
    </>
  );
}
