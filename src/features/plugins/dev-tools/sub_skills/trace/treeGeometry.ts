// Pure SVG geometry for the skill tree — no React. Variants restyle; this
// stays frozen so every /prototype fork shares one deterministic layout.
import type { TreeBranch } from './traceTypes';

export const TREE_W = 800;
export const TREE_H = 520;
export const CORE_X = 400;
export const CORE_Y = 320;
/** Radial distance from the core rim to a project node. */
const BRANCH_LEN = 200;
/** Branches fan across the upper arc, degrees (SVG angles, -90 = straight up). */
const ARC_START = -200;
const ARC_END = 20;

export interface Point {
  x: number;
  y: number;
}

export interface BranchGeometry {
  angleDeg: number;
  /** Cubic bezier `d` from the core rim to the node. */
  path: string;
  strokeWidth: number;
  node: Point;
  /** Points along the branch for lesson sprouts (max 3). */
  lessonPoints: Point[];
  /** The bezier control points, exposed for tests. */
  controls: [Point, Point, Point, Point];
}

function polar(angleDeg: number, radius: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CORE_X + radius * Math.cos(rad), y: CORE_Y + radius * Math.sin(rad) };
}

/** Point on a cubic bezier at parameter t. */
export function pointOnCubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Angle slots across the arc, ordered so the HEAVIEST branch sits most
 *  vertical (center of the arc) and lighter ones alternate outward. Input is
 *  assumed weight-desc (the model sorts). */
export function angleSlots(count: number): number[] {
  if (count === 0) return [];
  const mid = (ARC_START + ARC_END) / 2;
  if (count === 1) return [mid];
  const step = (ARC_END - ARC_START) / (count + 1);
  // Even slot positions across the arc…
  const positions = Array.from({ length: count }, (_, i) => ARC_START + step * (i + 1));
  // …assigned center-out: index 0 gets the slot nearest mid, 1 the next, etc.
  const byCloseness = [...positions].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  return byCloseness;
}

/** Lay out branches (weight-desc order preserved from the model). */
export function layoutTree(branches: TreeBranch[], coreRadius = 34): BranchGeometry[] {
  const angles = angleSlots(branches.length);
  return branches.map((b, i) => {
    const angle = angles[i] ?? -90;
    const start = polar(angle, coreRadius);
    const end = polar(angle, coreRadius + BRANCH_LEN);
    // Control points at 35% / 70% of the radial line with a slight tangential
    // bow (alternating side by index) so sibling curves don't overlap.
    const bow = 14 * (i % 2 === 0 ? 1 : -1);
    const tangent = angle + 90;
    const c1r = polar(angle, coreRadius + BRANCH_LEN * 0.35);
    const c2r = polar(angle, coreRadius + BRANCH_LEN * 0.7);
    const bowVec = {
      x: Math.cos((tangent * Math.PI) / 180) * bow,
      y: Math.sin((tangent * Math.PI) / 180) * bow,
    };
    const c1 = { x: c1r.x + bowVec.x, y: c1r.y + bowVec.y };
    const c2 = { x: c2r.x + bowVec.x * 0.5, y: c2r.y + bowVec.y * 0.5 };

    const lessonTs = [0.55, 0.68, 0.81].slice(0, Math.min(3, b.lessons.length));
    return {
      angleDeg: angle,
      path: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
      strokeWidth: 2 + 9 * Math.sqrt(Math.max(0, Math.min(1, b.weight))),
      node: end,
      lessonPoints: lessonTs.map((t) => pointOnCubic(start, c1, c2, end, t)),
      controls: [start, c1, c2, end],
    };
  });
}
