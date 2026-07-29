/* ----------------------------------------------------------------------------
 * MAP GLYPHS — the Constellation's SVG vocabulary: flat-top hexagons for
 * satellite nodes, hand-rolled role glyphs (worker bolt / reviewer eye /
 * router fork), and the core reactor (concentric rings + rotating orbital
 * dots + glow). Pure presentational SVG fragments — no store, no IPC.
 * -------------------------------------------------------------------------- */

/** Flat-top hexagon path centered at origin. */
export function hexPath(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

/** Roles that have a drawn mark; anything else falls back to initials. */
export function hasRoleGlyph(role: string): boolean {
  return role === 'worker' || role === 'reviewer' || role === 'router' || role === 'orchestrator';
}

/** Role glyph drawn inside a satellite hex. Falls back to null (caller then
 *  renders initials) for roles without a mark. Stroke/fill inherit color. */
export function RoleGlyph({ role }: { role: string }) {
  switch (role) {
    case 'worker':
      // Lightning bolt — the producer mark.
      return <path d="M1.5,-8 L-4,1 L-0.8,1 L-1.5,8 L4,-1 L0.8,-1 Z" fill="currentColor" stroke="none" />;
    case 'reviewer':
      // Eye — the critic mark.
      return (
        <g fill="none" stroke="currentColor" strokeWidth={1.3}>
          <path d="M-6,0 Q0,-5.5 6,0 Q0,5.5 -6,0 Z" />
          <circle r={1.8} fill="currentColor" stroke="none" />
        </g>
      );
    case 'router':
      // Fork — one line in, two routes out.
      return (
        <g fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
          <path d="M-6,0 H-0.5" />
          <path d="M-0.5,0 L5,-4 M-0.5,0 L5,4" />
          <circle cx={5.7} cy={-4.4} r={1.1} fill="currentColor" stroke="none" />
          <circle cx={5.7} cy={4.4} r={1.1} fill="currentColor" stroke="none" />
        </g>
      );
    case 'orchestrator':
      // Crosshair ring — normally the core, but a second orchestrator can
      // land on the ring and should still carry its mark.
      return (
        <g fill="none" stroke="currentColor" strokeWidth={1.3}>
          <circle r={4.5} />
          <path d="M0,-7 V-4.5 M0,7 V4.5 M-7,0 H-4.5 M7,0 H4.5" />
        </g>
      );
    default:
      return null;
  }
}

const ORBIT_DOTS = [0, 72, 144, 216, 288];

/**
 * The core reactor: rotating dashed orbit with 5 dots, two inner rings, a
 * glowing heart. `working` recolors the heart + dots to the active tone in
 * one prop. The rotating group carries the boundary circle so its bbox stays
 * symmetric and fill-box rotation stays centered.
 */
export function CoreReactor({
  r, color, working, spin,
}: {
  r: number;
  color: string;
  working: boolean;
  spin: boolean;
}) {
  const tone = working ? 'var(--status-warning)' : color;
  return (
    <g>
      <g className={spin ? 'animate-map-spin' : undefined}>
        <circle r={r + 9} fill="none" stroke={tone} strokeOpacity={0.35} strokeDasharray="3 7" />
        {ORBIT_DOTS.map((deg) => (
          <circle
            key={deg}
            cx={Math.cos((deg * Math.PI) / 180) * (r + 9)}
            cy={Math.sin((deg * Math.PI) / 180) * (r + 9)}
            r={1.8}
            fill={tone}
            fillOpacity={0.8}
          />
        ))}
      </g>
      <circle r={r * 0.74} fill="none" stroke={tone} strokeOpacity={0.3} />
      <circle r={r * 0.52} fill="none" stroke={tone} strokeOpacity={0.4} strokeDasharray="4 6" />
      <circle r={r} fill={color} fillOpacity={0.14} stroke={tone} strokeOpacity={0.85} strokeWidth={1.5} filter="url(#map-glow)" />
      <g style={{ color: tone }} opacity={0.95}>
        <g transform="scale(1.35)">
          <RoleGlyph role="orchestrator" />
        </g>
      </g>
    </g>
  );
}
