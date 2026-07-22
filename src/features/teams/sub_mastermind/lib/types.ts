// Mastermind canvas — shared scene model. One Island per project (core +
// orbiting dimension nodes), edges where projects are integrated. Derived from
// App Readiness Passports (teams/sub_factory/passport) and the cross-project
// relation map. Pure view model — no store or IPC access here.

export type IslandState = 'healthy' | 'building' | 'warning' | 'critical';

export type DimStatus = 'absent' | 'solid' | 'partial' | 'risk';

export type DimKey = 'db' | 'monitoring' | 'ci' | 'tests' | 'security' | 'hosting' | 'auth' | 'agents';

export interface DimNode {
  key: DimKey;
  label: string;
  status: DimStatus;
  /** Concrete tool/engine naming (Postgres, Sentry, GitHub Actions…) — the passport deliberately names tools. */
  detail: string | null;
  /** Ordinal progress within the dimension's scale; 0/0 for boolean dimensions. */
  reached: number;
  steps: number;
}

export interface Island {
  slug: string;
  name: string;
  purpose: string;
  /** World coordinates of the island centre. */
  x: number;
  y: number;
  state: IslandState;
  autoScore: number;
  prodScore: number;
  lifecycle: string;
  automationLabel: string;
  blockers: number;
  nodes: DimNode[];
}

export interface IslandEdge {
  from: string;
  to: string;
  kind: 'relation' | 'similarity';
  /** 0..1 — explicit relations are 1, similarity edges carry the similarity. */
  strength: number;
  label: string | null;
}

export interface Scene {
  islands: Island[];
  edges: IslandEdge[];
  /** True when rendering the built-in demo scene (no scanned projects yet). */
  demo: boolean;
}

export interface Camera {
  x: number;
  y: number;
  z: number;
}

/** Canvas interaction mode: view = pan/zoom only; edit = islands are
 *  draggable; group = drag draws a labelled organizational rectangle. */
export type CanvasMode = 'view' | 'edit' | 'group';

/** Common contract every canvas variant implements (prototype scaffold). */
export interface VariantProps {
  scene: Scene;
  mode: CanvasMode;
  /** Live drag update — island world position while dragging. */
  onIslandMove: (slug: string, x: number, y: number) => void;
  /** Drag finished — persist the position. */
  onIslandCommit: (slug: string, x: number, y: number) => void;
}

// Zoom bands — the single source of truth for level-of-detail. Round-3 split:
// the old NEAR secretly contained two levels (labels vs details); `close` makes
// that explicit so each band can be tuned independently from user feedback.
export type ZoomBand = 'far' | 'mid' | 'near' | 'close';

export const ZOOM_THRESHOLDS = { mid: 0.34, near: 0.72, close: 1.05 } as const;

export function zoomBand(z: number): ZoomBand {
  if (z < ZOOM_THRESHOLDS.mid) return 'far';
  if (z < ZOOM_THRESHOLDS.near) return 'mid';
  if (z < ZOOM_THRESHOLDS.close) return 'near';
  return 'close';
}

const BAND_ORDER: Record<ZoomBand, number> = { far: 0, mid: 1, near: 2, close: 3 };

/** True when `band` is at least as zoomed-in as `min` (far < mid < near < close). */
export const bandGte = (band: ZoomBand, min: ZoomBand): boolean => BAND_ORDER[band] >= BAND_ORDER[min];

/** User-drawn organizational rectangle on the canvas (world coordinates). */
export interface GroupRect {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** World-space bounding box of the scene, padded so fit() leaves shoreline room. */
export function sceneBounds(islands: Island[], pad = 300): { minX: number; minY: number; maxX: number; maxY: number } {
  if (islands.length === 0) return { minX: -600, minY: -400, maxX: 600, maxY: 400 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of islands) {
    minX = Math.min(minX, i.x); minY = Math.min(minY, i.y);
    maxX = Math.max(maxX, i.x); maxY = Math.max(maxY, i.y);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}
