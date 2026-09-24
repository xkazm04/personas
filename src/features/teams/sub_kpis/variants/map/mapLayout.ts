// The map's geometry — pure, so the thing hardest to eyeball can be tested.
//
// AREA IS WHAT YOU CLAIM. A territory's area is its KPI COUNT, never its
// health, so the biggest shape on screen is always the biggest promise. Inside
// a territory every KPI gets one plot, and the plot is lit only if the KPI has
// ever been read. That is the whole encoding: light is observation, and the
// dark is not empty space, it is 900 KPIs nobody has looked at.
import type { Estate, EstateGroup, EstateProject, KpiTally } from '../../estate/kpiEstate';
import { squarify, type Rect } from '../squarify';

/** Room for a project's name strip above its groups. */
const FRAME_HEADER = 22;
/** Room for a group's name inside its territory. */
const GROUP_HEADER = 18;
/** Below this a territory cannot hold a readable name, so it holds only plots. */
export const LABEL_MIN_W = 70;
export const LABEL_MIN_H = 34;
/** A territory smaller than this is unclickable, so the layout refuses to draw
 *  it and the caller says how many it left out rather than hiding the count. */
const MIN_CELL = 6;
/** The smallest share of the tiling any one project may be given.
 *
 *  Pure area would be the honest encoding, and on this estate it is not a
 *  usable one: 721 KPIs against 9 puts six of eleven projects under ten pixels
 *  and the map silently stops being a map. So a project below the floor is
 *  drawn AT the floor and the surface DECLARES it (`floored`), rather than
 *  dropping it or pretending the area is still proportional. Above the floor
 *  area is exactly the claim. */
const MIN_PROJECT_SHARE = 0.02;

export interface ProjectFrame {
  projectId: string;
  label: string;
  rect: Rect;
  tally: KpiTally;
  /** The rank the rail printed for this project, when it made the shortlist. */
  rank: number | null;
  /** The group read for this project failed: its KPIs are in one cell only
   *  because we could not see the groups. A failed read is not a grade, so
   *  the frame LABELS it rather than painting it. */
  groupsUnknown: boolean;
}

export interface GroupTerritory {
  key: string;
  projectId: string;
  groupId: string | null;
  label: string;
  projectLabel: string;
  color: string | null;
  rect: Rect;
  tally: KpiTally;
  group: EstateGroup;
  rank: number | null;
}

export interface MapLayout {
  frames: ProjectFrame[];
  territories: GroupTerritory[];
  /** Territories too small to draw at this size — named, never silently gone. */
  dropped: number;
  /** Projects drawn at the minimum share, whose area therefore UNDERSTATES how
   *  much smaller they are. The legend has to say this out loud. */
  floored: number;
}

function inset(rect: Rect, top: number, pad = 2): Rect {
  return {
    x: rect.x + pad,
    y: rect.y + top + pad,
    w: Math.max(0, rect.w - pad * 2),
    h: Math.max(0, rect.h - top - pad * 2),
  };
}

function groupsInto(
  project: EstateProject,
  rect: Rect,
  ranks: ReadonlyMap<string, number>,
  out: GroupTerritory[],
): number {
  let dropped = 0;
  const cells = squarify(
    project.groups.map((g) => ({ key: g.key, value: g.tally.total })),
    rect,
  );
  const byKey = new Map(project.groups.map((g) => [g.key, g] as const));
  for (const cell of cells) {
    const group = byKey.get(cell.key);
    if (!group) continue;
    if (cell.w < MIN_CELL || cell.h < MIN_CELL) {
      dropped += 1;
      continue;
    }
    out.push({
      key: group.key,
      projectId: group.projectId,
      groupId: group.groupId,
      label: group.label,
      projectLabel: project.label,
      color: group.color,
      rect: cell,
      tally: group.tally,
      group,
      rank: ranks.get(group.key) ?? null,
    });
  }
  return dropped;
}

/**
 * Tile `rect` with the estate. At portfolio altitude a project is a frame and
 * its context groups are the territories inside it; at project altitude the
 * project IS the frame and fills the box. Either way the plots inside a
 * territory are the same plots, so descending changes the scale and not the
 * vocabulary (contest pattern `one-grammar-recursively`).
 */
export function layoutMap(
  estate: Estate,
  project: EstateProject | null,
  rect: Rect,
  ranks: ReadonlyMap<string, number> = new Map(),
): MapLayout {
  const frames: ProjectFrame[] = [];
  const territories: GroupTerritory[] = [];
  let dropped = 0;

  if (project) {
    frames.push({
      projectId: project.projectId,
      label: project.label,
      rect,
      tally: project.tally,
      rank: null,
      groupsUnknown: project.groupsUnknown,
    });
    dropped += groupsInto(project, inset(rect, FRAME_HEADER), ranks, territories);
    return { frames, territories, dropped, floored: 0 };
  }

  const claimed = estate.projects.reduce((n, p) => n + p.tally.total, 0);
  const floorValue = claimed * MIN_PROJECT_SHARE;
  const floored = estate.projects.filter((p) => p.tally.total > 0 && p.tally.total < floorValue).length;
  const cells = squarify(
    estate.projects.map((p) => ({ key: p.projectId, value: Math.max(p.tally.total, floorValue) })),
    rect,
  );
  const byId = new Map(estate.projects.map((p) => [p.projectId, p] as const));
  for (const cell of cells) {
    const p = byId.get(cell.key);
    if (!p) continue;
    if (cell.w < MIN_CELL * 3 || cell.h < MIN_CELL * 3) {
      dropped += p.groups.length;
      continue;
    }
    frames.push({
      projectId: p.projectId,
      label: p.label,
      rect: cell,
      tally: p.tally,
      rank: ranks.get(p.projectId) ?? null,
      groupsUnknown: p.groupsUnknown,
    });
    dropped += groupsInto(p, inset(cell, FRAME_HEADER), ranks, territories);
  }
  return { frames, territories, dropped, floored };
}

/** Does this territory have room for its own name? */
export function fitsLabel(rect: Rect): boolean {
  return rect.w >= LABEL_MIN_W && rect.h >= LABEL_MIN_H;
}

/** The box left for plots once the group's name has taken its strip. */
export function plotArea(rect: Rect): Rect {
  return fitsLabel(rect) ? inset(rect, GROUP_HEADER, 3) : inset(rect, 0, 2);
}

/**
 * Columns for `n` plots in a `w × h` box, chosen so the plots come out as
 * close to square as the box allows. Never returns 0, so a one-KPI group still
 * draws its one plot.
 */
export function plotColumns(n: number, w: number, h: number): number {
  if (n <= 0 || w <= 0 || h <= 0) return 1;
  return Math.max(1, Math.min(n, Math.round(Math.sqrt((n * w) / h))));
}
