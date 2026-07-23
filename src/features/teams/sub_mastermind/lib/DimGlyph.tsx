// Dimension glyph for SVG canvas cells. Precedence: the identified tool's
// official brand mark (Supabase, Sentry… — the same simple-icons set the
// Passport wall renders) always wins; otherwise the active icon set decides
// between a drawn glyph set (forge/concept) and the lucide outline. Absent
// cells stay generic + muted (there is no tool to brand).
// A registry dimension missing from a drawn set falls through to its lucide
// icon — new dimensions never crash a glyph set that hasn't drawn them yet.
import { dimBrand } from './dimMeta';
import { DIM_REGISTRY } from './dimRegistry';
import { GLYPH_SETS, useIconSet } from './iconSet';
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
  const entry = DIM_REGISTRY[node.key];
  const brand = node.status !== 'absent' ? dimBrand(node) : null;
  if (brand) {
    return (
      <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" fill={brand.icon.color ?? 'currentColor'} style={{ color }} aria-hidden>
        <path d={brand.icon.path} />
      </svg>
    );
  }
  if (set !== 'line') {
    const glyph = GLYPH_SETS[set][node.key] as (() => React.ReactNode) | undefined;
    if (glyph) {
      return (
        <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ color }} aria-hidden>
          {glyph()}
        </svg>
      );
    }
  }
  const Icon = entry?.icon;
  if (!Icon) return null;
  return <Icon x={x} y={y} width={size} height={size} strokeWidth={strokeWidth} style={{ color }} />;
}
