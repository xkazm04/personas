// The instrument trace under a lamp's figure: thin bars in the verdict's ink,
// normalised to the series' own max. A drawn figure (doctrine 6c); its numbers
// are stated in the cell's figure and note, so the drawing is aria-hidden.

export function Trace({ values }: { values: number[] | null }) {
  if (!values || values.length === 0) return <div className="aw-trace aw-trace--none" aria-hidden="true" />;
  const max = Math.max(...values, 0.0001);
  const w = 100 / values.length;
  return (
    <svg className="aw-trace" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="100" y1="39.5" y2="39.5" className="aw-trace__base" vectorEffect="non-scaling-stroke" />
      {values.map((v, i) => {
        const h = Math.max((v / max) * 38, 1.2);
        return <rect key={i} x={i * w + w * 0.18} width={w * 0.64} y={39 - h} height={h} rx={0.6} className="aw-trace__bar" />;
      })}
    </svg>
  );
}
