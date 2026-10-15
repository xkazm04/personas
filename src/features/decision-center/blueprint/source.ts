// The blueprint's data seam (spark one-control, Stage 2 contract). The drawing
// (WP4a/WP4b) reads a product through `BlueprintData` and writes only through
// `BlueprintActions`; it never calls IPC itself. WP3 supplies the live
// implementation over WP2's `lens_scan_*` doors (`src/api/lensScan.ts`); the
// drawing's tests and its fixture mode supply a static one.
//
// Every write answers with lens-scan's own JSON (store.mjs / drive.mjs), passed
// through verbatim: the drawing shows `skipped[]` and its reasons as the store
// gave them, and never decides on its own whether a transition is allowed.

import type { CommitDiff, ScanSnapshot, TriageResult } from '@/lib/lensScan/wire';

/** One product: a `dev_projects` row whose root holds `.ai/lens-scan/scan.db`. */
export interface BlueprintProduct {
  projectId: string;
  name: string;
  /** The repo root, as `dev_projects.root_path`. */
  root: string;
}

/** Everything the drawing reads for one product. */
export interface BlueprintData {
  product: BlueprintProduct;
  /** `app-structure.json`, parsed; the drawing narrows it with bp's `loadStructure`. */
  structure: unknown;
  /** `events.jsonl`, raw text (empty when the file is absent). */
  events: string;
  /** The store, as bp's wire: column names, NULL columns omitted. */
  scan: ScanSnapshot;
  /** `PRAGMA user_version` of the store when it was read (1, 2 or 3 today). */
  storeVersion: number;
}

/** What store.mjs `decide` answers. */
export interface DecideResult {
  decision: 'approved' | 'declined';
  by: string;
  decided: string[];
  /** Items left as they were (`not-found` for a missing id). */
  skipped: { id: string; status: string; reason?: string }[];
}

export type DecideDecision = 'approve' | 'decline';
export type TriageDecisionInput = 'accept' | 'rework' | 'descope' | 'reopen';

/** A run Personas starts for a product; it enters the fleet as origin `lens_scan`. */
export type StartAction = 'execute' | 'measure' | 'propagate';

export interface StartRequest {
  action: StartAction;
  lens: string;
  /** `execute`: the approved items to build (never `--approve-proposed`). */
  ids?: string[];
  /** `measure`: the features to cover; absent = every gap of the lens. */
  features?: string[];
  /** `propagate`: the standard to spread. */
  standard?: string;
}

/** What starting a run answers: the fleet session that carries it. */
export interface StartResult {
  sessionId: string;
  state: 'running' | 'queued';
  /** The exact command line started, for the dock console. */
  command: string;
}

/** Every write and every side read the drawing may make. */
export interface BlueprintActions {
  decide(ids: string[], decision: DecideDecision, note?: string): Promise<DecideResult>;
  triage(ids: string[], decision: TriageDecisionInput, note?: string): Promise<TriageResult>;
  start(request: StartRequest): Promise<StartResult>;
  /** One item commit, as bp's commits route returns it. */
  commitDiff(sha: string): Promise<CommitDiff>;
  /** A displayable URL for a `shots` row's `path` (an object URL over the bytes; the caller revokes it). */
  shotUrl(path: string): Promise<string>;
  /** Re-read the product after a write or an outside change. */
  refresh(): Promise<BlueprintData>;
}
