/**
 * Sleeping mark — a crescent moon with three rising Z's.
 *
 * Purpose-drawn in the same spirit as `FleetShipIcon`: lucide's stock `Moon`
 * says "night" or "dark theme", which on a development canvas is the wrong
 * reading entirely. Moon + Zzz is the one composition that says *dormant* with
 * no label, which is what the far-zoom island needs — at that band there is no
 * room for a caption, so the mark has to carry the whole meaning.
 *
 * Lucide-compatible so it drops into any slot a lucide icon occupies: 24×24
 * viewBox, `currentColor` stroke, round caps/joins, no fills. It also accepts
 * raw SVG props (`x` / `y` / `width` / `height`), which is how the Mastermind
 * canvas places lucide glyphs inside its own world-space `<svg>`.
 *
 * Geometry notes: the crescent is built the way lucide builds its moon — one
 * large-arc sweep for the outer edge, a shallower-radius arc back for the
 * inner one — so it closes cleanly at any size. The Z's ascend to the upper
 * right and shrink as they go, and each is a three-segment polyline rather
 * than a glyph, so the mark never depends on a font being loaded.
 */
export function SleepingMark({ strokeWidth = 1.8, ...props }: React.SVGProps<SVGSVGElement> & {
  /** Stroke weight in viewBox units. Lucide's default is 2; 1.8 keeps the
   *  crescent's inner edge open when the mark is rendered small. */
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {/* Crescent, seated lower-left so the Z's have the upper-right corner. */}
      <path d="M9.4 6.6a5.4 5.4 0 1 0 5.4 5.4 4.1 4.1 0 0 1-5.4-5.4z" />
      {/* Three Z's rising away from the sleeper, each smaller than the last. */}
      <path d="M13.6 9.2h3.6l-3.6 4.2h3.6" />
      <path d="M17.6 4.8h3.2l-3.2 3.6h3.2" />
      <path d="M21.2 1.2h2.6l-2.6 2.8h2.6" />
    </svg>
  );
}
