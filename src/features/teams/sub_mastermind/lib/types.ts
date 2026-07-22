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

/** Canvas interaction mode: view = pan/zoom only; edit = islands are draggable. */
export type CanvasMode = 'view' | 'edit';

/** Common contract every canvas variant implements (prototype scaffold). */
export interface VariantProps {
  scene: Scene;
  mode: CanvasMode;
  /** Live drag update — island world position while dragging. */
  onIslandMove: (slug: string, x: number, y: number) => void;
  /** Drag finished — persist the position. */
  onIslandCommit: (slug: string, x: number, y: number) => void;
}

export type ZoomMode = 'far' | 'mid' | 'near';

export const zoomMode = (z: number): ZoomMode => (z < 0.34 ? 'far' : z < 0.72 ? 'mid' : 'near');

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
