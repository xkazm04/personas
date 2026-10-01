import { forwardRef } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';

/**
 * The two profiles, left then right, facing each other across a gap: brow,
 * nose, lips and chin of one face mirrored by the other. Design A of the
 * twin-portable-blueprint icon round (operator pick, 2026-10-01): a twin is
 * one voice met by its counterpart, and the gap between the faces is where the
 * conversation happens, which is what `IconTwin`'s active state animates.
 */
export const TWIN_GLYPH_PATHS = [
  'M3.5 3.5C6.5 3.5 8.8 5.4 8.8 8.2L10.4 10.8L9 11.4C9.4 11.8 9.4 12.4 8.9 12.7C9.3 13.1 9.2 13.9 8.7 14.2C8.5 16.1 7.5 17 5.8 17V20.5',
  'M20.5 3.5C17.5 3.5 15.2 5.4 15.2 8.2L13.6 10.8L15 11.4C14.6 11.8 14.6 12.4 15.1 12.7C14.7 13.1 14.8 13.9 15.3 14.2C15.5 16.1 16.5 17 18.2 17V20.5',
] as const;

/**
 * Twin brand glyph.
 *
 * Lucide-shaped so it drops into every slot a lucide icon occupies (a
 * `LucideIcon`-typed sidebar row, `Button icon=`, a footer disc): 24x24
 * viewBox, `currentColor` stroke, round caps and joins, no fill, `aria-hidden`
 * by default. Rest props are FORWARDED, for the reason `FleetShipIcon` records:
 * a mark that swallows width/height/className renders screen-sized inside an
 * SVG context. `absoluteStrokeWidth` is accepted for type parity and ignored.
 */
export const TwinGlyph: LucideIcon = forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(function TwinGlyph(
  { size = 24, strokeWidth = 1.8, color = 'currentColor', absoluteStrokeWidth: _absolute, ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {TWIN_GLYPH_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
});

export default TwinGlyph;
