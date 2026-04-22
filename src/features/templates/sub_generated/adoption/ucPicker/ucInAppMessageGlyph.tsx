// Custom SVG glyph for the built-in "In-App Message" destination.
// Stacked chat composition: a primary bubble with avatar + message
// lines (anchors the left-top) and a smaller reply bubble with typing
// dots beneath (anchors the right-bottom). Cyan unread badge with a
// count indicator sits in the upper-right. Designed in 48×48 viewBox.
//
// Theming:
//   • main strokes use `currentColor` → inherits the tile's active /
//     inactive color in both light and dark themes
//   • unread accent uses `var(--color-primary)` so it stays vivid
//     across themes without light/dark duplicates

import type { SVGProps } from 'react';

interface GlyphProps extends SVGProps<SVGSVGElement> {
  className?: string;
}

export function InAppMessageGlyph({ className = '', ...rest }: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} {...rest}>
      {/* Background reply bubble (down-right) with typing dots */}
      <path
        d="M 18 28 L 40 28 Q 44 28 44 32 L 44 38 Q 44 42 40 42 L 30 42 L 26 46 L 27 42 L 18 42 Q 14 42 14 38 L 14 32 Q 14 28 18 28 Z"
        fill="currentColor"
        fillOpacity={0.04}
        stroke="currentColor"
        strokeWidth={1.1}
        strokeLinejoin="round"
        opacity={0.55}
      />
      <circle cx="23" cy="35" r="1.1" fill="currentColor" opacity={0.55} />
      <circle cx="27" cy="35" r="1.1" fill="currentColor" opacity={0.55} />
      <circle cx="31" cy="35" r="1.1" fill="currentColor" opacity={0.55} />

      {/* Primary message bubble — centered on x=24 */}
      <path
        d="M 10 6 L 38 6 Q 42 6 42 10 L 42 22 Q 42 26 38 26 L 20 26 L 12 32 L 14 26 L 10 26 Q 6 26 6 22 L 6 10 Q 6 6 10 6 Z"
        fill="currentColor"
        fillOpacity={0.08}
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
      />

      {/* Avatar + title line */}
      <circle cx="11.5" cy="11.5" r="2" fill="currentColor" opacity={0.4} />
      <line
        x1="15.5"
        y1="10"
        x2="28"
        y2="10"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        opacity={0.9}
      />
      <line
        x1="15.5"
        y1="13"
        x2="23"
        y2="13"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        opacity={0.55}
      />

      {/* Body message lines */}
      <line
        x1="10.5"
        y1="18"
        x2="36"
        y2="18"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        opacity={0.75}
      />
      <line
        x1="10.5"
        y1="21.5"
        x2="30"
        y2="21.5"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        opacity={0.5}
      />

      {/* Unread accent badge with "1" count */}
      <circle
        cx="42"
        cy="7"
        r="4.5"
        fill="var(--color-primary)"
        stroke="var(--color-background)"
        strokeWidth={1.5}
      />
      <text
        x="42"
        y="7"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--color-background)"
        style={{ fontSize: 5.5, fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}
      >
        1
      </text>
    </svg>
  );
}
