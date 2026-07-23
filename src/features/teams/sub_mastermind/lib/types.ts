// Mastermind canvas — shared scene model. One Island per project (core +
// orbiting dimension nodes), edges where projects are integrated. Derived from
// App Readiness Passports (teams/sub_factory/passport) and the cross-project
// relation map. Pure view model — no store or IPC access here.

export type IslandState = 'healthy' | 'building' | 'warning' | 'critical';

// `unknown` is distinct from `absent`: absent = "we looked, this wiring isn't
// there" (an honest zero); unknown = "the data family that feeds this cell
// failed to load, so we genuinely don't know" — never rendered as a fake
// absent/never-scanned. Its ink is a muted amber-grey (see DIM_INK).
export type DimStatus = 'absent' | 'solid' | 'partial' | 'risk' | 'alert' | 'unknown';

// DimKey is derived from the dimension registry (the single source of truth for
// the dimension system) so a new registry entry extends the key space with no
// edit here. Type-only import → no runtime cycle (dimRegistry imports DimStatus
// from this file, also type-only). Imported for local use AND re-exported.
import type { DimKey } from './dimRegistry';

export type { DimKey };

/** One open Fleet CLI session docked to a project island. Colour resolves from
 *  `state` (FleetSessionState) at render time via FLEET_INK. */
export interface FleetNode {
  id: string;
  label: string;
  state: string;
}

export interface DimNode {
  key: DimKey;
  label: string;
  status: DimStatus;
  /** Concrete tool/engine naming (Postgres, Sentry, GitHub Actions…) — the passport deliberately names tools. */
  detail: string | null;
  /** Ordinal progress within the dimension's scale; 0/0 for boolean dimensions. */
  reached: number;
  steps: number;
  /** Passport-wall row key this dimension maps to (page-decorated; null = no
   *  wall counterpart, e.g. auth/kpi). */
  rowKey?: string | null;
  /** Improve action available for this cell (page-decorated from the engine):
   *  standards = Tier-0 config popover, deploy = Claude deploy/connector/skills
   *  popover, ideas = the idea-scan dispatch popover, null = inert (no click,
   *  no hover affordance). */
  action?: 'standards' | 'deploy' | 'ideas' | null;
  /** Ideas dimension only: whole days since the last idea scan (null = never). */
  days?: number | null;
  /** An action we dispatched for this cell is still in flight (Ideas scan) —
   *  the cell pulses so the feedback lives where the click happened. */
  busy?: boolean;
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
  /** Open Fleet CLI sessions working in this project (page attaches them). */
  fleet: FleetNode[];
  /** Names of personas with an execution in progress for this project's team
   *  (page attaches them — same persona→team→project join the Monitor uses). */
  personasRunning: string[];
  /** Live "needs you" marker — true when a fleet session on this project is
   *  awaiting input or has gone stale (page attaches it from the resolved
   *  fleet). Rendered at every zoom band on the counter-scaled banner. */
  attention: boolean;
  /** Live unresolved-issue count from the bound monitoring credential, or null
   *  when no supported credential is bound (honestly unknown → readiness-only
   *  colour). Surfaced in the Monitoring cell detail. */
  monitorErrors: number | null;
  /** What drove `state`: static readiness scores, or a live monitoring signal
   *  (fresh errors / open issues). Named in the banner tooltip. */
  stateSource: 'readiness' | 'errors';
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

/** Canvas interaction mode (round 5 — Figma-like, edit-first):
 *  edit = default; pan on empty sea, move islands by their header, move/resize
 *  groups, open the project sidebar by header click.
 *  group = drag draws a labelled organizational rectangle.
 *  connect = click two projects to link them (styled, labelled lines). */
export type CanvasMode = 'edit' | 'group' | 'connect' | 'note';

export type NoteSize = 'sm' | 'md' | 'lg' | 'xl';

export type NoteFont = 'inter' | 'roboto' | 'caveat';

/** Free text note placed on the canvas (note tool). World coordinates. */
export interface CanvasNote {
  id: string;
  x: number;
  y: number;
  text: string;
  size: NoteSize;
  font: NoteFont;
}

/** Common contract every canvas variant implements (prototype scaffold). */
export interface VariantProps {
  scene: Scene;
  mode: CanvasMode;
  /** Live drag update — island world position while dragging. */
  onIslandMove: (slug: string, x: number, y: number) => void;
  /** Drag finished — persist the position. */
  onIslandCommit: (slug: string, x: number, y: number) => void;
  /** Fleet node clicked — open the CLI preview popover for this session. */
  onFleetOpen: (sessionId: string) => void;
  /** Project header clicked (not dragged) — open the project sidebar. */
  onProjectOpen: (slug: string) => void;
  /** Actionable dimension cell clicked — open its Improve popover at the
   *  cursor (same popovers the Passport wall uses). */
  onDimOpen: (slug: string, node: DimNode, e: React.MouseEvent) => void;
  /** In-progress-personas badge clicked — open the persona name list. */
  onPersonasOpen: (slug: string, e: React.MouseEvent) => void;
  /** Island context-menu "Open terminal" — spawn an interactive Fleet session
   *  in the project's root and open its preview. */
  onOpenTerminal: (slug: string) => void;
  /** Whether a given island can host a terminal (real project + root_path);
   *  false for demo islands and projects without a folder path. */
  canOpenTerminal: (slug: string) => boolean;
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

/** User-drawn connection between two projects (connect tool). */
export interface UserLink {
  id: string;
  from: string;
  to: string;
  label: string;
  dashed: boolean;
  /** CSS colour (theme token or literal) from the short palette. */
  color: string;
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
