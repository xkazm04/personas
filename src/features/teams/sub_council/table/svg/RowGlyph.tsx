// The queue row's glyph: exactly what the ROW knows, and nothing more.
//
// This exists because the mini rose was a lie. A queue row is drawn from the
// list projection, which carries the overall, the coverage and the floor-hit
// count but NO per-member scores - so a rose there drew all five wedges
// hatched, and hatched means "we looked and could not measure". It meant "we
// did not load it". That is precisely the conflation this whole feature was
// built to prevent, one layer in from where it was preventing it.
//
// So the row draws a single ring instead, in the rose's own visual family:
//
//   the disc's reach = `overall`          (a wedge's reach, taken all the way round)
//   the inner ring   = the threshold      (the same ring the rose draws)
//   the rim arc      = `coverage`         (how much of the rubric was measured)
//   a dashed empty disc = no overall at all, which is its own state
//
// It answers "how far did it get, against what bar, on how much evidence"
// and refuses to answer anything about the members, because the row has not
// read them.
const TAU = Math.PI * 2;

export function RowGlyph({
  overall,
  coverage,
  threshold,
  floorHit,
  size = 54,
  label,
}: {
  /** Null is NOT a zero: it draws the empty glyph. */
  overall: number | null;
  /** Share of the rubric's weight actually measured, 0..1. */
  coverage: number | null;
  threshold: number;
  /** A floor hit tints the reach, the way it tints a wedge in the rose. */
  floorHit: boolean;
  size?: number;
  label: string;
}) {
  const c = size / 2;
  const rim = c - 3;
  // The reach lives inside the rim so the coverage arc always has its own lane.
  const R = rim - 5;
  const reach = overall == null ? 0 : Math.max(3, overall * R);
  const cov = coverage == null ? 0 : Math.max(0, Math.min(1, coverage));
  const rimLength = TAU * rim;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="flex-none"
    >
      {/* the plate, as an ink wash so it reads on a dark field and a light one */}
      <circle cx={c} cy={c} r={R} fill="color-mix(in srgb, var(--foreground) 5%, transparent)" />

      {overall == null ? (
        <circle
          cx={c}
          cy={c}
          r={R * 0.62}
          fill="none"
          stroke="var(--muted-dark)"
          strokeWidth="1.6"
          strokeDasharray="2.5 3"
        />
      ) : (
        <circle
          cx={c}
          cy={c}
          r={reach}
          fill={floorHit ? 'var(--status-error)' : 'var(--primary)'}
          fillOpacity="0.82"
        />
      )}

      {/* the bar it is measured against, the same ring the rose draws */}
      <circle
        cx={c}
        cy={c}
        r={threshold * R}
        fill="none"
        stroke="var(--foreground)"
        strokeWidth="1.4"
      />

      {/* the rim: how much of the rubric was actually measured */}
      <circle
        cx={c}
        cy={c}
        r={rim}
        fill="none"
        stroke="color-mix(in srgb, var(--foreground) 14%, transparent)"
        strokeWidth="3"
      />
      {cov > 0 ? (
        <circle
          cx={c}
          cy={c}
          r={rim}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(rimLength * cov).toFixed(1)} ${rimLength.toFixed(1)}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
      ) : null}
    </svg>
  );
}

export default RowGlyph;
