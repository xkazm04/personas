// Dimension glyph for SVG canvas cells: the identified tool's official brand
// mark (Supabase, Sentry, GitHub Actions… — same simple-icons set the Passport
// wall renders) when the detail names one, else the generic lucide icon.
// Absent cells always stay generic + muted.
import { dimBrand, DIM_ICON } from './dimMeta';
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
  const brand = node.status !== 'absent' ? dimBrand(node) : null;
  if (brand) {
    return (
      <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" fill={brand.icon.color ?? 'currentColor'} style={{ color }} aria-hidden>
        <path d={brand.icon.path} />
      </svg>
    );
  }
  const Icon = DIM_ICON[node.key];
  return <Icon x={x} y={y} width={size} height={size} strokeWidth={strokeWidth} style={{ color }} />;
}
