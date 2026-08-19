// Column Board layout — orthogonal, guaranteed readable. One column per
// category (compass order), fixed-height pills stacked with a constant gap, so
// vertical overlap is structurally impossible; labels live INSIDE the pills,
// so label collision is structurally impossible. The layout is a function of
// the focused subject: focusing inserts that subject's technique sub-pills
// beneath its pill (accordion) and the column reflows downward.
//
// Returns the SAME `{keystonePos, subjectPos}` contract as
// `computeHierarchyLayout` (plus pill/technique rects for the renderer), so
// the host's fly-to / search / goSubject machinery works unchanged.
import {
  techniqueKey,
  type HierarchyLayout,
  type HierarchyRenderModel,
  type SubjectNode,
} from './hierarchyGraphModel';

export const BOARD_COL_W = 260;
export const BOARD_COL_GAP = 28;
export const BOARD_PILL_W = 236;
export const BOARD_PILL_H = 34;
export const BOARD_PILL_GAP = 8;
export const BOARD_TECH_W = 220;
export const BOARD_TECH_H = 26;
export const BOARD_TECH_GAP = 4;
export const BOARD_TECH_INDENT = 16;
/** Column header block (keystone) height above the first pill. */
export const BOARD_HEADER_H = 64;

export interface BoardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardPill extends BoardRect {
  ring: string;
}

export interface BoardTechRow extends BoardRect {
  /** `ownerSubject/techniqueSlug@owner|local` — unique per entry. */
  key: string;
  /** Index into the focused SubjectNode's `techniques` array. */
  index: number;
}

export interface BoardLayout extends HierarchyLayout {
  /** Keyed by subject slug — pill rects in world coords (top-left origin). */
  pills: Map<string, BoardPill>;
  /** Technique sub-pill rects for the focused subject (empty otherwise). */
  techniqueRows: BoardTechRow[];
  /** Total board extent (world units) — the board centers on (0,0). */
  width: number;
  height: number;
  /** Camera zoom that fits the whole board when this variant activates. */
  suggestedK: number;
}

/** Suggested home zoom for a board of `columnCount` columns (~0.5 for 8). */
export function boardHomeK(columnCount: number): number {
  const n = Math.max(columnCount, 1);
  const width = n * BOARD_COL_W + (n - 1) * BOARD_COL_GAP;
  return Math.min(0.9, Math.max(0.3, 1150 / width));
}

/** Heavier subjects (more techniques) sort to the top of the column. */
function byWeightDesc(a: SubjectNode, b: SubjectNode): number {
  return b.techniques.length - a.techniques.length || a.subject.title.localeCompare(b.subject.title);
}

export function computeBoardLayout(
  model: HierarchyRenderModel,
  focusSubject: string | null,
): BoardLayout {
  const rings = model.rings;
  const n = Math.max(rings.length, 1);
  const width = n * BOARD_COL_W + (n - 1) * BOARD_COL_GAP;
  const left = -width / 2;

  const keystonePos = new Map<string, { x: number; y: number; angle: number }>();
  const subjectPos = new Map<string, { x: number; y: number; ring: string }>();
  const pills = new Map<string, BoardPill>();
  const techniqueRows: BoardTechRow[] = [];

  // First pass with column tops at y = 0; the whole board shifts up by half
  // the tallest UNFOCUSED column afterwards so it centers on (0,0). Centering
  // deliberately ignores the accordion insertion: expanding a subject pushes
  // ONLY the pills beneath it downward — it never re-centers the world.
  const baseMax =
    BOARD_HEADER_H +
    Math.max(0, ...rings.map((r) => r.subjects.length)) * (BOARD_PILL_H + BOARD_PILL_GAP);
  let maxBottom = BOARD_HEADER_H;
  const columns = rings.map((ring, i) => {
    const colLeft = left + i * (BOARD_COL_W + BOARD_COL_GAP);
    const pillX = colLeft + (BOARD_COL_W - BOARD_PILL_W) / 2;
    const sorted = [...ring.subjects].sort(byWeightDesc);
    let cy = BOARD_HEADER_H;
    const rows = sorted.map((node) => {
      const rect: BoardPill = { x: pillX, y: cy, w: BOARD_PILL_W, h: BOARD_PILL_H, ring: ring.key };
      cy += BOARD_PILL_H;
      const techs: BoardTechRow[] = [];
      if (focusSubject === node.subject.slug) {
        node.techniques.forEach((entry, index) => {
          cy += BOARD_TECH_GAP;
          techs.push({
            key: `${techniqueKey(entry.tech)}@${entry.owner ?? 'local'}`,
            index,
            x: pillX + BOARD_TECH_INDENT,
            y: cy,
            w: BOARD_TECH_W,
            h: BOARD_TECH_H,
          });
          cy += BOARD_TECH_H;
        });
      }
      cy += BOARD_PILL_GAP;
      return { node, rect, techs };
    });
    maxBottom = Math.max(maxBottom, cy);
    return { ring, colLeft, rows };
  });

  const dy = -baseMax / 2;
  for (const col of columns) {
    keystonePos.set(col.ring.key, {
      x: col.colLeft + BOARD_COL_W / 2,
      y: dy + BOARD_HEADER_H / 2 - 6,
      angle: 0,
    });
    for (const row of col.rows) {
      const rect = { ...row.rect, y: row.rect.y + dy };
      pills.set(row.node.subject.slug, rect);
      subjectPos.set(row.node.subject.slug, {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h / 2,
        ring: col.ring.key,
      });
      for (const tech of row.techs) techniqueRows.push({ ...tech, y: tech.y + dy });
    }
  }

  return {
    keystonePos,
    subjectPos,
    pills,
    techniqueRows,
    width,
    height: maxBottom,
    suggestedK: boardHomeK(n),
  };
}
