// Dimension glyph for SVG canvas cells. Precedence: the identified tool's
// official brand mark (Supabase, Sentry… — the same simple-icons set the
// Passport wall renders) always wins; otherwise the dimension's lucide outline
// from the registry. Absent cells stay generic + muted (no tool to brand).
import { dimBrand } from './dimMeta';
import { DIM_REGISTRY } from './dimRegistry';
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
  const entry = DIM_REGISTRY[node.key];
  const brand = node.status !== 'absent' ? dimBrand(node) : null;
  if (brand) {
    return (
      <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" fill={brand.icon.color ?? 'currentColor'} style={{ color }} aria-hidden>
        <path d={brand.icon.path} />
      </svg>
    );
  }
  const Icon = entry?.icon;
  if (!Icon) return null;
  return <Icon x={x} y={y} width={size} height={size} strokeWidth={strokeWidth} style={{ color }} />;
}
