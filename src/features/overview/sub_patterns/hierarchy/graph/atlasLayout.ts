// Sector Atlas layout — structured radial geometry where overlap is
// impossible BY CONSTRUCTION. Each category owns an EXCLUSIVE angular sector
// (width ∝ subject count, gutters between, a floor so slim sectors never get
// crowded out); subjects fill concentric arc BANDS inside their sector, and a
// band's capacity is derived from its real arc length at a minimum arc
// spacing — so density can never exceed the footprint.
//
// The collision guarantee (min pairwise center distance ≥ 56px globally):
// - within a band: consecutive spacing ≥ MIN_ARC_SPACING (74px of arc; the
//   chord at the innermost band is ≈ 73.6px)
// - across bands: the radial grid step is BAND_GAP (84px) and every sector
//   uses the same global R values, so different bands are ≥ 84px apart
// - across sectors at the same band: every multi-node band insets its edge
//   nodes MIN_ARC_SPACING/2 from the sector boundary, and MIN_SECTOR_ANGLE
//   guarantees a lone centered node ≥ 28px of arc (at the innermost band)
//   from both boundaries — so any cross-gutter pair is ≥ 56px + gutter apart.
//
// Returns the SAME `{keystonePos, subjectPos}` shape as
// `computeHierarchyLayout`, so the host's fly-to / search / goSubject
// machinery works unchanged, plus per-sector geometry for the wedge render.
import type { HierarchyLayout, HierarchyRenderModel, SubjectNode } from './hierarchyGraphModel';

export const ATLAS_KEYSTONE_R = 140;
export const ATLAS_FIRST_BAND_R = 240;
export const ATLAS_BAND_GAP = 84;
export const ATLAS_MIN_ARC_SPACING = 74;
/** ~4° gutters between sectors. */
export const ATLAS_SECTOR_GUTTER = (4 * Math.PI) / 180;
/** Inner radius of the faint sector wedge (just outside the keystones). */
export const ATLAS_WEDGE_INNER_R = 186;
/** Never spread sparse bands wider than this arc step (px). */
const MAX_ARC_STEP = 110;
/** The collision guarantee's pairwise floor (px). */
const COLLISION_DIST = 56;
/** Sector floor: a lone node at the sector mid keeps ≥ COLLISION_DIST/2 of
 *  arc from both boundaries at the INNERMOST band (outer bands only widen). */
const MIN_SECTOR_ANGLE = COLLISION_DIST / ATLAS_FIRST_BAND_R;

const TWO_PI = Math.PI * 2;

export interface AtlasSector {
  start: number;
  end: number;
  mid: number;
  /** Outermost occupied band radius + 40 (wedge outer edge). */
  outerR: number;
}

export interface AtlasLayout extends HierarchyLayout {
  /** Keyed by ring key — the exclusive angular sector each category owns. */
  sectors: Map<string, AtlasSector>;
}

/** Heavier subjects (more techniques) sit on the inner bands. */
function byWeightDesc(a: SubjectNode, b: SubjectNode): number {
  return b.techniques.length - a.techniques.length || a.subject.title.localeCompare(b.subject.title);
}

export function computeAtlasLayout(model: HierarchyRenderModel): AtlasLayout {
  const rings = model.rings;
  const n = Math.max(rings.length, 1);
  const keystonePos = new Map<string, { x: number; y: number; angle: number }>();
  const subjectPos = new Map<string, { x: number; y: number; ring: string }>();
  const sectors = new Map<string, AtlasSector>();

  const avail = TWO_PI - n * ATLAS_SECTOR_GUTTER;
  const weights = rings.map((r) => Math.max(r.subjects.length, 2));
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  // Floor every sector, then share the remainder ∝ weight. (With absurdly
  // many rings the floor itself can exceed the circle — degrade to equal
  // shares rather than overlap the sectors.)
  const spare = avail - n * MIN_SECTOR_ANGLE;
  const spans =
    spare > 0
      ? weights.map((w) => MIN_SECTOR_ANGLE + (spare * w) / weightSum)
      : weights.map(() => avail / n);

  // Compass sequence from 12 o'clock: the FIRST sector's mid-angle sits at
  // -π/2, matching the Nexus's keystone order.
  let cursor = -Math.PI / 2 - (spans[0] ?? 0) / 2;

  rings.forEach((ring, i) => {
    const span = spans[i] ?? MIN_SECTOR_ANGLE;
    const start = cursor;
    const end = cursor + span;
    const mid = start + span / 2;
    keystonePos.set(ring.key, {
      x: Math.cos(mid) * ATLAS_KEYSTONE_R,
      y: Math.sin(mid) * ATLAS_KEYSTONE_R,
      angle: mid,
    });

    const sorted = [...ring.subjects].sort(byWeightDesc);
    let placed = 0;
    let band = 0;
    let outer = ATLAS_FIRST_BAND_R;
    while (placed < sorted.length) {
      const R = ATLAS_FIRST_BAND_R + band * ATLAS_BAND_GAP;
      // Edge inset so cross-gutter neighbours keep the pairwise floor.
      const usable = span - ATLAS_MIN_ARC_SPACING / R;
      // Capacity from REAL arc length — density can never exceed footprint.
      const capacity = usable > 0 ? Math.floor((usable * R) / ATLAS_MIN_ARC_SPACING) + 1 : 1;
      const m = Math.min(capacity, sorted.length - placed);
      const step = m > 1 ? Math.min(usable / (m - 1), MAX_ARC_STEP / R) : 0;
      for (let j = 0; j < m; j += 1) {
        const a = mid + (j - (m - 1) / 2) * step;
        const node = sorted[placed + j];
        if (!node) continue;
        subjectPos.set(node.subject.slug, {
          x: Math.cos(a) * R,
          y: Math.sin(a) * R,
          ring: ring.key,
        });
      }
      outer = R;
      placed += m;
      band += 1;
    }

    sectors.set(ring.key, { start, end, mid, outerR: outer + 40 });
    cursor = end + ATLAS_SECTOR_GUTTER;
  });

  return { keystonePos, subjectPos, sectors };
}

/** Radial technique fan for a FOCUSED subject: rings of growing radius, arc
 *  spacing ≥ 38px per ring. Full 360° is safe because the Atlas hides every
 *  sibling subject during a drill. Positions are relative to the subject. */
export function atlasTechniqueFan(count: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let placed = 0;
  let ring = 0;
  while (placed < count) {
    const r = 64 + ring * 44;
    const capacity = Math.max(1, Math.floor((TWO_PI * r) / 38));
    const m = Math.min(capacity, count - placed);
    const step = TWO_PI / m;
    // De-align successive rings, and start at 12 o'clock like everything else.
    const offset = -Math.PI / 2 + ring * 0.35;
    for (let j = 0; j < m; j += 1) {
      const a = offset + j * step;
      out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    placed += m;
    ring += 1;
  }
  return out;
}
