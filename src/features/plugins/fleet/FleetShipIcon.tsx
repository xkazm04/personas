interface FleetShipIconProps {
  className?: string;
  /** Stroke weight in viewBox units. Lucide's default is 2; 1.8 keeps the
   *  two-hull composition open at 20px instead of blobbing shut. */
  strokeWidth?: number;
}

/**
 * Fleet mark — a flagship with an escort sailing behind it.
 *
 * Purpose-drawn (via `/leonardo`) to replace the generic `LayoutGrid` icon on
 * the footer: a *grid* says "tiles", a *fleet of ships* says "many sessions
 * under one command", which is what the surface actually is.
 *
 * Lucide-compatible so it drops into any slot a lucide icon occupies:
 * 24×24 viewBox, `currentColor` stroke, round caps/joins, no fills. Geometry
 * is tuned for a 20px footer render — hull interiors and both sail triangles
 * stay open at that size (verified by rasterising 20/24/32/64px), which is why
 * the hulls are straight-edged trapezoids rather than curved.
 */
export function FleetShipIcon({ className, strokeWidth = 1.8 }: FleetShipIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Flagship — hull, then mast + sail leech (the hull's deck closes the sail). */}
      <path d="M2 16.4h12.8l-2.2 3.6H4.2z" />
      <path d="M5.6 16.4V4.6L10.7 16.4" />
      {/* Escort, riding higher and smaller so it reads as "behind". */}
      <path d="M14.2 11h7.8l-2 3.2h-3.8z" />
      <path d="M16.8 11V4l3.5 7" />
    </svg>
  );
}
