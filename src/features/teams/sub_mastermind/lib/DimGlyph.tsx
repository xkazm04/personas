// Dimension glyph for SVG canvas cells. Precedence: the identified tool's
// official brand mark (Supabase, Sentry… — the same simple-icons set the
// Passport wall renders) always wins; otherwise the active icon set decides
// between the Forge solid glyph and the lucide outline. Absent cells stay
// generic + muted (there is no tool to brand).
import { dimBrand, DIM_ICON } from './dimMeta';
import { FORGE_GLYPH } from './dimGlyphsForge';
import { useIconSet } from './iconSet';
import type { DimNode } from './types';

export function DimGlyph({ node, x, y, size, color, strokeWidth = 1.6 }: {
  node: DimNode;
  x: number;
  y: number;
  size: number;
  /** Ink for the generic icon / currentColor brands (near-black marks). */
  color: string;
  strokeWidth?: number;
}) {
  const set = useIconSet();
  const brand = node.status !== 'absent' ? dimBrand(node) : null;
  if (brand) {
    return (
      <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" fill={brand.icon.color ?? 'currentColor'} style={{ color }} aria-hidden>
        <path d={brand.icon.path} />
      </svg>
    );
  }
  if (set === 'forge') {
    return (
      <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ color }} aria-hidden>
        {FORGE_GLYPH[node.key]()}
      </svg>
    );
  }
  const Icon = DIM_ICON[node.key];
  return <Icon x={x} y={y} width={size} height={size} strokeWidth={strokeWidth} style={{ color }} />;
}
