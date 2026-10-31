// Lens-scan doors (spark one-control, Stage 2, WP2): the typed client of
// `src-tauri/src/commands/infrastructure/lens_scan/`.
//
// Personas reads each product's lens-scan store in place and writes ONLY
// through lens-scan's own scripts (`store.mjs`, `drive.mjs`): these wrappers
// forward intent, and the store's answer (`skipped[]` and its reasons
// included) comes back verbatim. Nothing here decides whether a transition is
// allowed; the blueprint shows what the store said.

import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { LensScanCommitDiff } from '@/lib/bindings/LensScanCommitDiff';
import type { LensScanDecideDecision } from '@/lib/bindings/LensScanDecideDecision';
import type { LensScanDecideResult } from '@/lib/bindings/LensScanDecideResult';
import type { LensScanIdentity } from '@/lib/bindings/LensScanIdentity';
import type { LensScanProduct } from '@/lib/bindings/LensScanProduct';
import type { LensScanRows } from '@/lib/bindings/LensScanRows';
import type { LensScanSnapshot } from '@/lib/bindings/LensScanSnapshot';
import type { LensScanStartRequest } from '@/lib/bindings/LensScanStartRequest';
import type { LensScanStartResult } from '@/lib/bindings/LensScanStartResult';
import type { LensScanTriageDecision } from '@/lib/bindings/LensScanTriageDecision';
import type { LensScanTriageResult } from '@/lib/bindings/LensScanTriageResult';
import type { CommitDiff, ScanSnapshot, TriageResult } from '@/lib/lensScan/wire';
import type {
  BlueprintData,
  DecideResult as SeamDecideResult,
} from '@/features/decision-center/blueprint/source';

export type {
  LensScanDecideDecision,
  LensScanIdentity,
  LensScanProduct,
  LensScanStartRequest,
  LensScanStartResult,
  LensScanTriageDecision,
};

/** `node store.mjs` is bounded at 30 s on the Rust side; leave room for the spawn. */
const STORE_WRITE_TIMEOUT_MS = 45_000;
/** A snapshot is ~2 MB of JSON for a busy store; reading it is a few hundred ms. */
const SNAPSHOT_TIMEOUT_MS = 30_000;
/** `git show` x3 on a large commit. */
const COMMIT_TIMEOUT_MS = 30_000;

/** `BlueprintData` minus `product` (`features/decision-center/blueprint/source.ts`). */
export interface LensScanSnapshotData {
  /** `app-structure.json`, parsed; `null` while the product has no map yet. */
  structure: unknown;
  /** `events.jsonl`, raw text (`""` when absent). */
  events: string;
  /** The store, as bp's wire: column names, NULL columns omitted, JSON columns parsed. */
  scan: ScanSnapshot;
  /** `PRAGMA user_version` of the store when it was read (1, 2 or 3 today). */
  storeVersion: number;
}

/** What store.mjs `decide` answers (`DecideResult` in `blueprint/source.ts`). */
export interface DecideResult {
  decision: 'approved' | 'declined';
  by: string;
  decided: string[];
  /** Items left as they were (`not-found` for a missing id). */
  skipped: { id: string; status: string; reason?: string }[];
}

/**
 * The snapshot rows are the one place the IPC payload is deliberately loose:
 * the store schema belongs to lens-scan and moved twice in one day, so Rust
 * carries each row as a JSON map keyed by the store's own column names.
 *
 * INVARIANT that makes this cast safe: the Rust reader (`db/src/repos/dev/
 * lens_scan.rs`) is a 1:1 port of bp's `store.server.ts`, the source of
 * `wire.ts`. It keys every row by the column names the store reports, omits
 * NULL columns, parses `runs.lenses` to a string array and `runs.scope` /
 * `shots.report` to objects, and returns all eight tables (a missing table is
 * `[]`). `ScanSnapshot` is exactly that shape, so the map type and the wire
 * type describe the same value; the cast only restores the names.
 */
function narrowScan(rows: LensScanRows): ScanSnapshot {
  return rows as unknown as ScanSnapshot;
}

/** Every enabled code project whose repo holds a lens-scan store. */
export const listLensScanProducts = () => invoke<LensScanProduct[]>('lens_scan_products');

/** One product's map, events log and store, as bp's wire. */
export async function getLensScanSnapshot(projectId: string): Promise<LensScanSnapshotData> {
  const snap = await invoke<LensScanSnapshot>(
    'lens_scan_snapshot',
    { projectId },
    { timeoutMs: SNAPSHOT_TIMEOUT_MS },
  );
  return {
    structure: snap.structure,
    events: snap.events,
    scan: narrowScan(snap.scan),
    storeVersion: snap.storeVersion,
  };
}

/** Approve or decline `proposed` items, through `store.mjs decide`. */
export async function decideLensScan(
  projectId: string,
  ids: string[],
  decision: LensScanDecideDecision,
  note?: string,
): Promise<DecideResult> {
  const out = await invoke<LensScanDecideResult>(
    'lens_scan_decide',
    { projectId, ids, decision, note },
    { timeoutMs: STORE_WRITE_TIMEOUT_MS },
  );
  // Invariant: store.mjs `decide` answers `approved` or `declined` (store.mjs
  // header: "-> decision approve|decline" is recorded as the status it set).
  return out as DecideResult;
}

/** Accept, rework, descope or reopen built items, through `store.mjs triage`. */
export async function triageLensScan(
  projectId: string,
  ids: string[],
  decision: LensScanTriageDecision,
  note?: string,
): Promise<TriageResult> {
  const out = await invoke<LensScanTriageResult>(
    'lens_scan_triage',
    { projectId, ids, decision, note },
    { timeoutMs: STORE_WRITE_TIMEOUT_MS },
  );
  // Invariant: store.mjs `triage` answers decision accepted | rework | descoped |
  // reopened (its TRIAGE table), the union `wire.ts TriageResult` names.
  return out as TriageResult;
}

/**
 * Start a build (`execute`) or a coverage run (`measure`) through lens-scan's
 * `drive.mjs`. Never approves. `propagate`, and `measure` with `features`,
 * reject with a `Validation` error until drive.mjs has those verbs.
 */
export const startLensScan = (projectId: string, request: LensScanStartRequest) =>
  invoke<LensScanStartResult>('lens_scan_start', { projectId, request });

/** Who signs a write: `user:<gh login>`, else `user:personas`. */
export const getLensScanIdentity = () => invoke<LensScanIdentity>('lens_scan_identity');

/** One item commit; `Forbidden` for a sha no proposal of the store carries. */
export async function getLensScanCommitDiff(projectId: string, sha: string): Promise<CommitDiff> {
  const out = await invoke<LensScanCommitDiff>(
    'lens_scan_commit_diff',
    { projectId, sha },
    { timeoutMs: COMMIT_TIMEOUT_MS },
  );
  return out;
}

/** The bytes of a screenshot or recording under the store's `shots/` directory. */
export const getLensScanShot = (projectId: string, path: string) =>
  invoke<ArrayBuffer>('lens_scan_shot', { projectId, path });

// Frozen-seam guard. It lives here, not in `__tests__`, because tsconfig excludes
// `src/**/__tests__/**`: an `expectTypeOf` there is a runtime no-op tsc never sees (it sat red
// on `products` unseen). Here a drift fails `tsc --noEmit`.
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
// `products` and `lastRunAt` are joined in by `readBlueprint` from the products store
// (`live/liveActions.ts`), not carried by the snapshot door, so they are outside this type.
export type _SnapshotMatchesSeam = Assert<
  Same<LensScanSnapshotData, Omit<BlueprintData, 'product' | 'products' | 'lastRunAt'>>
>;
export type _DecideMatchesSeam = Assert<Same<DecideResult, SeamDecideResult>>;
