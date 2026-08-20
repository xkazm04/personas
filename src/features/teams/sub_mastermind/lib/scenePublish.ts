// Publishing the canvas scene for Athena (WP3, 2026-08-04).
//
// WP2 gave Athena a read of the Mastermind canvas, but she reads a SNAPSHOT —
// the scene itself is derived entirely here on the frontend (fifteen dimension
// `derive()` closures over an App Readiness Passport, plus five independently
// fetched data families whose per-family load STATUS is part of the picture).
// Nothing in SQLite can reproduce that, and a Rust re-derive could never report
// which family failed to load in the client. So the canvas publishes what it
// derived into `mastermind.scene.v1` and every companion surface reads it.
//
// The contract is documented on `canvas::CanvasScene` in
// `src-tauri/src/companion/canvas.rs`; the field names below match it exactly
// (camelCase, every field optional except `slug`, unknown fields ignored).
//
// Three rules this module exists to keep:
//   1. **Never publish the demo scene.** The six `demo-*` islands appear when
//      no passports exist. They have no repo, no passport and no data, so a
//      published demo scene would let Athena describe six projects that are
//      not there. Publishing nothing is correct — WP2 already says "the canvas
//      has not been opened yet" honestly.
//   2. **Debounce and dedupe.** The scene re-derives on every data-family
//      arrival, every fleet tick and every drag commit. Writes are coalesced
//      over the same 500ms window the layout store uses, and an unchanged
//      snapshot is not written at all (`publishedAt` is deliberately stamped at
//      WRITE time so it can't defeat the comparison).
//   3. **Best effort.** A failed publish never breaks the canvas; it only
//      clears the dedupe memo so the next derive retries.
import { setAppSetting } from '@/api/system/settings';
import { silentCatch } from '@/lib/silentCatch';

import type { KpiRollup } from './dimRegistry';
import type { FamilyStatus } from './sceneStore';
import type { Island, Scene } from './types';

/** DB settings key — `MASTERMIND_SCENE` in `src-tauri/db/src/settings_keys.rs`. */
export const SCENE_KEY = 'mastermind.scene.v1';

/** Snapshot document version. `load_scene` ignores anything else. */
export const SCENE_DOC_VERSION = 1;

/** Same window the layout store coalesces its write-through over. */
export const PUBLISH_DEBOUNCE_MS = 500;

/** One dimension cell as Rust reads it (`canvas::CanvasDim`). */
export interface ScenePayloadDim {
  key: string;
  label: string;
  status: string;
  detail: string | null;
}

/** Ship-milestone chip (`canvas::CanvasShip`). */
export interface ScenePayloadShip {
  next: string | null;
  shipped: number;
  total: number;
  late: boolean;
}

/** One island (`canvas::CanvasProject`). */
export interface ScenePayloadProject {
  slug: string;
  name: string;
  state: string;
  attention: boolean;
  blockers: number;
  fleet: number;
  personasRunning: number;
  monitorErrors: number | null;
  ideasDays: number | null;
  goalsOngoing: number | null;
  kpiTotal: number | null;
  kpiOff: number | null;
  ship: ScenePayloadShip | null;
  dims: ScenePayloadDim[];
}

/** The published document (`canvas::CanvasScene`), minus `publishedAt`, which
 *  is stamped when the write actually happens. */
export interface ScenePayload {
  version: number;
  demo: boolean;
  families: Record<string, FamilyStatus>;
  projects: ScenePayloadProject[];
}

export interface ScenePublishInput {
  scene: Scene;
  /** Per-family fetch status — the one thing Rust cannot re-derive. */
  families: Record<string, FamilyStatus>;
  kpiByProject?: Map<string, KpiRollup>;
}

/** Whole days since the last idea scan, read off the cell that already
 *  computed it (`days` is the registry's own number, not a re-derive). */
const dimDays = (island: Island, key: string): number | null => {
  const node = island.nodes.find((n) => n.key === key);
  return typeof node?.days === 'number' ? node.days : null;
};

function toProject(island: Island, kpi: KpiRollup | undefined): ScenePayloadProject {
  return {
    slug: island.slug,
    name: island.name,
    state: island.state,
    attention: island.attention,
    blockers: island.blockers,
    // Counts, not lists: the digest reports "2 live sessions", never names.
    fleet: island.fleet.length,
    personasRunning: island.personasRunning.length,
    monitorErrors: island.monitorErrors,
    ideasDays: dimDays(island, 'ideas'),
    goalsOngoing: dimDays(island, 'goals'),
    kpiTotal: kpi ? kpi.total : null,
    kpiOff: kpi ? kpi.off : null,
    // Projected FIELD BY FIELD, not spread. `IslandShip` grew target/forecast
    // dates for the canvas status bar; this payload is deserialized by the Rust
    // canvas reader (what `describe_canvas_project` answers from), so its shape
    // is a cross-language contract and must change only deliberately.
    ship: island.ship
      ? {
        next: island.ship.next,
        shipped: island.ship.shipped,
        total: island.ship.total,
        late: island.ship.late,
      }
      : null,
    dims: island.nodes.map((n) => ({
      key: n.key,
      label: n.label,
      status: n.status,
      detail: n.detail,
    })),
  };
}

/** Build the snapshot body. Pure — no IPC, no timers; the tests assert this
 *  against the shape documented on `CanvasScene`. */
export function buildScenePayload({ scene, families, kpiByProject }: ScenePublishInput): ScenePayload {
  return {
    version: SCENE_DOC_VERSION,
    demo: scene.demo,
    families: { ...families },
    projects: scene.islands.map((i) => toProject(i, kpiByProject?.get(i.slug))),
  };
}

// --- debounce + dedupe --------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
/** Serialized body of the last snapshot we queued. `null` = nothing published
 *  yet (or the last write failed, so the next derive must retry). */
let lastBody: string | null = null;
let pending: ScenePayload | null = null;

async function writeNow(payload: ScenePayload): Promise<void> {
  // `publishedAt` is stamped HERE, not in the payload builder: a timestamp
  // inside the compared body would make every snapshot look different and
  // defeat the dedupe entirely.
  const doc = JSON.stringify({ ...payload, publishedAt: new Date().toISOString() });
  try {
    await setAppSetting(SCENE_KEY, doc);
  } catch (e) {
    // Best effort: forget the memo so the next derive republishes.
    lastBody = null;
    silentCatch('mastermind scene publish')(e);
  }
}

/**
 * Queue a scene snapshot for publication. Idempotent by content: an unchanged
 * scene schedules nothing at all, so the steady state costs zero IPC.
 */
export function publishCanvasScene(input: ScenePublishInput): void {
  // Rule 1 — the demo scene is not a scene.
  if (input.scene.demo) return;
  const payload = buildScenePayload(input);
  const body = JSON.stringify(payload);
  if (body === lastBody) return;
  lastBody = body;
  pending = payload;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const next = pending;
    pending = null;
    if (next) void writeNow(next);
  }, PUBLISH_DEBOUNCE_MS);
}

/** Test-only reset of the module singletons (mirrors the layout store). */
export function __resetScenePublisherForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  lastBody = null;
  pending = null;
}
