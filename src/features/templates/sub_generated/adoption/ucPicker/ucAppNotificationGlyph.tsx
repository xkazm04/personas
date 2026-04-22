// Custom SVG glyph for the built-in "App notification" destination.
// A centered phone silhouette with an amber notification disc in the
// upper-right, an in-screen notification card, and two sonar arcs in
// the upper-left. Designed in 48×48 viewBox for visual richness.
//
// Theming:
//   • main strokes use `currentColor` → inherits the tile's active /
//     inactive color in both light and dark themes
//   • amber accent uses `var(--color-status-warning)` so it stays vivid
//     across themes without light/dark duplicates

import type { SVGProps } from 'react';

interface GlyphProps extends SVGProps<SVGSVGElement> {
  className?: string;
}

export function AppNotificationGlyph({ className = '', ...rest }: GlyphProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} {...rest}>
      {/* Soft halo behind the phone */}
      <ellipse cx="24" cy="26" rx="15" ry="18" fill="currentColor" opacity={0.05} />

      {/* Phone body — outer */}
      <rect
        x="12"
        y="6"
        width="24"
        height="38"
        rx="5"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
      />
      {/* Phone body — inner bezel */}
      <rect
        x="14"
        y="9.5"
        width="20"
        height="31"
        rx="2.5"
        stroke="currentColor"
        strokeWidth={0.75}
        opacity={0.35}
      />

      {/* Speaker slit */}
      <line
        x1="21"
        y1="7.6"
        x2="27"
        y2="7.6"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        opacity={0.65}
      />

      {/* Home indicator pill */}
      <line
        x1="22"
        y1="42"
        x2="26"
        y2="42"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.65}
      />

      {/* In-screen notification card */}
      <rect
        x="16.5"
        y="15"
        width="15"
        height="7"
        rx="1.3"
        fill="currentColor"
        fillOpacity={0.08}
        stroke="currentColor"
        strokeWidth={0.8}
        strokeLinejoin="round"
        opacity={0.75}
      />
      <line
        x1="18.5"
        y1="17.2"
        x2="26"
        y2="17.2"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinecap="round"
        opacity={0.8}
      />
      <line
        x1="18.5"
        y1="19.5"
        x2="23"
        y2="19.5"
        stroke="currentColor"
        strokeWidth={0.9}
        strokeLinecap="round"
        opacity={0.55}
      />

      {/* Sonar rings — emanating from upper-left corner */}
      <path
        d="M 4 10 A 3 3 0 0 1 10 4"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinecap="round"
        opacity={0.3}
        fill="none"
      />
      <path
        d="M 2 13 A 6 6 0 0 1 13 2"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinecap="round"
        opacity={0.2}
        fill="none"
      />

      {/* Notification badge — outer glow + core disc with depth highlight */}
      <circle cx="38" cy="10" r="9" fill="var(--color-status-warning)" fillOpacity={0.1} />
      <circle
        cx="38"
        cy="10"
        r="6"
        fill="var(--color-status-warning)"
        stroke="var(--color-background)"
        strokeWidth={1.75}
      />
      <circle cx="36" cy="8" r="1.2" fill="var(--color-background)" opacity={0.55} />

      {/* Pulse dots above the badge */}
      <circle cx="44" cy="4" r="1" fill="var(--color-status-warning)" opacity={0.7} />
      <circle cx="46" cy="7" r="0.75" fill="var(--color-status-warning)" opacity={0.5} />
    </svg>
  );
}
