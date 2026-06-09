import { GLYPH_DIMENSIONS } from './types';
import type { GlyphDimension } from './types';
import { DIM_META } from './dimMeta';

const patternId = (dim: GlyphDimension, uid: string) => `sigil-pat-${dim}-${uid}`;

/** `fill` value pointing a petal at its dimension's texture pattern. */
export const petalPatternFill = (dim: GlyphDimension, uid: string) =>
  `url(#${patternId(dim, uid)})`;

/** One distinct, dim-tinted micro-texture per dimension index. A faint
 *  colour wash keeps residual hue; the lines/dots carry the shape so the
 *  petal is told apart without relying on colour. */
function texture(i: number, color: string) {
  switch (i) {
    case 0: // horizontal lines
      return <path d="M0 2.5 H5" stroke={color} strokeWidth={1.2} />;
    case 1: // vertical lines
      return <path d="M2.5 0 V5" stroke={color} strokeWidth={1.2} />;
    case 2: // forward diagonal
      return <path d="M0 5 L5 0" stroke={color} strokeWidth={1.2} />;
    case 3: // back diagonal
      return <path d="M0 0 L5 5" stroke={color} strokeWidth={1.2} />;
    case 4: // grid
      return <path d="M0 2.5 H5 M2.5 0 V5" stroke={color} strokeWidth={0.9} />;
    case 5: // cross-hatch
      return <path d="M0 5 L5 0 M0 0 L5 5" stroke={color} strokeWidth={0.9} />;
    case 6: // single dot
      return <circle cx={2.5} cy={2.5} r={1.1} fill={color} />;
    default: // twin dots
      return (
        <>
          <circle cx={1.3} cy={1.3} r={0.9} fill={color} />
          <circle cx={3.7} cy={3.7} r={0.9} fill={color} />
        </>
      );
  }
}

/**
 * SVG `<pattern>` defs — one dim-tinted texture per persona dimension.
 * Rendered into a sigil's own `<defs>` (so ids never collide across the
 * many sigils on a page, callers pass a per-instance `uid`) and referenced
 * via {@link petalPatternFill} when CVD-safe mode is on. Lets the eight
 * petals read by texture, not hue alone — WCAG 1.4.1 (use of colour).
 */
export function SigilPatternDefs({ uid }: { uid: string }) {
  return (
    <>
      {GLYPH_DIMENSIONS.map((dim, i) => {
        const color = DIM_META[dim].color;
        return (
          <pattern
            key={dim}
            id={patternId(dim, uid)}
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <rect width="5" height="5" fill={color} fillOpacity={0.22} />
            {texture(i, color)}
          </pattern>
        );
      })}
    </>
  );
}
