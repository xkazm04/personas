// The shared status / adherence visual language for every hierarchy sky
// (Nexus, Atlas, Board): status is the node RING language — dashed draft ·
// solid forged · double reconciled · thick transplant-tested — and adherence
// is the CoverageRing arc. Extracted verbatim from HierarchyNexus so all three
// renderers draw the same vocabulary from one file.

/** The status-ring language, drawn just outside a node body of radius `r`.
 *  draft = dashed muted · forged = solid · reconciled = double ring ·
 *  transplant-tested = emphasized (the FILL emphasis lives on the body). */
export function StatusRing({
  r,
  status,
  stroke,
  width = 1.5,
}: {
  r: number;
  status: string | null;
  stroke: string;
  width?: number;
}) {
  switch (status) {
    case 'forged':
      return <circle r={r} fill="none" stroke={stroke} strokeWidth={width} />;
    case 'reconciled':
      return (
        <>
          <circle r={r} fill="none" stroke={stroke} strokeWidth={width} />
          <circle r={r + 3} fill="none" stroke={stroke} strokeWidth={width * 0.66} strokeOpacity={0.8} />
        </>
      );
    case 'transplant-tested':
      return <circle r={r} fill="none" stroke={stroke} strokeWidth={width + 0.75} />;
    default:
      // draft (and unknown, honestly rendered as not-yet-forged).
      return (
        <circle
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={width * 0.85}
          strokeOpacity={0.65}
          strokeDasharray="4 3"
        />
      );
  }
}

/** Adherence arc on a subject node's border — a faint full track plus an arc
 *  from 12 o'clock, sized just outside the status ring (r + 5.5 clears the
 *  reconciled double ring at r + 3). `pct` is cleanContexts /
 *  applicableContexts. */
export function CoverageRing({
  r,
  pct,
  stroke,
  width = 2,
}: {
  r: number;
  pct: number;
  stroke: string;
  width?: number;
}) {
  const C = 2 * Math.PI * r;
  return (
    <g transform="rotate(-90)" pointerEvents="none">
      <circle r={r} fill="none" stroke={stroke} strokeOpacity={0.15} strokeWidth={width} />
      {pct > 0 && (
        <circle
          r={r}
          fill="none"
          stroke={stroke}
          strokeOpacity={0.9}
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={`${Math.max(pct, 0.02) * C} ${C}`}
        />
      )}
    </g>
  );
}

/** Body fill opacity per status — transplant-tested is the filled tier. */
export function statusFillOpacity(status: string | null): number {
  switch (status) {
    case 'forged':
      return 0.22;
    case 'reconciled':
      return 0.3;
    case 'transplant-tested':
      return 0.55;
    default:
      return 0.1;
  }
}
