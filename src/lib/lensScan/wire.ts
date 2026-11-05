// PORTED VERBATIM from bp packages/core/src/scan/types.ts @ 93f30b0 (first ported from bp src/lib/scan/types.ts @ 519c80f,
// spark one-control, Stage 2 contract; re-synced to store v5 by spark bp-sync).
// The lens-scan store wire: store column names, NULL columns omitted. Personas' lens_scan_* doors return exactly this shape.
// Re-sync by copying the file again and re-applying only the marked edits; never hand-drift it.
// EDIT (port, store v4): the v4 proposal columns (origin, external_ref, external_url, tier, risk_class, ranked_by,
// ranked_at), ProposalOrigin, RiskClass, Tier and the 'work-item' kind, copied from bp @ 51e193e. The Rust reader reads
// columns by presence, so a v4 row already carried these at runtime; this edit only types them
// (src-tauri/db/src/repos/dev/lens_scan_tests.rs holds it).
// EDIT (port, store v5): the 17 v5 proposal columns and Confidence, Band, MvpRule, FindingCategory, PredictedVerdict,
// copied from bp @ 93f30b0; score_parts, proof and mvp are typed as Personas' reader delivers them (marked below).
// Left out of bp @ 93f30b0 on purpose: trust_events / TrustEvent (Personas does not read the autonomy ledger), VetoBody,
// ScoreParts, Proof, ProofVerdict (no parsed JSON reaches here), MAX_TRIAGE / triageCapText (bp's triage route cap),
// Readiness.setup / LensSetupNeed (bp's lens-setup probe). bp's isEmptyScan reads an optional table; here every table
// is always present.
// Wire types for the lens-scan store: one SQLite file per product repo, `<root>/.ai/lens-scan/scan.db`,
// written by the /lens-scan skill and read (plus proposal decisions) by the blueprint's routes. The
// DDL is docs/standard/lens-scan-store.sql, name for name. Absent values are omitted, never null or 0:
// no measurement row means "unmeasured".
// EDIT (port): bp's @/lib/standard/types MetricMethod, inlined.
export type MetricMethod = 'static' | 'probe' | 'harness' | 'judgement';
// EDIT (port): bp's ./readiness Readiness, inlined at the end of this file.

export type RunPhase = 'measure' | 'propose' | 'execute' | 'propagate';
export type RunStatus = 'running' | 'done' | 'failed' | 'aborted';
export type ProposalKind = 'fix' | 'baseline-upgrade' | 'propagation' | 'work-item';
/** v4: where a backlog item came from. */
export type ProposalOrigin = 'scan' | 'ado' | 'sweep';
/** v4: what kind of harm the problem is. */
export type RiskClass = 'secret' | 'authz' | 'money' | 'data' | 'llm' | 'perf' | 'reliability' | 'ux' | 'debt';
/** v4: how bad the problem is: 0 stop-ship, 1 before production, 2 soon after, 3 backlog. */
export type Tier = 0 | 1 | 2 | 3;
/** v2 adds a person's triage of a built item (accepted, rework, descoped) and `released` (its release was tagged). */
export type ProposalStatus = 'proposed' | 'approved' | 'declined' | 'executing' | 'done' | 'failed' | 'accepted' | 'rework' | 'descoped' | 'released';
export type ProposalSize = 'XS' | 'S' | 'M' | 'L' | 'XL';
export type ActivityKind = 'reading' | 'measured' | 'proposed' | 'executing' | 'committed' | 'note' | 'error';
export type CoverageState = 'conformant' | 'deviation' | 'not-applicable' | 'unknown';
/** v2: a reading or a capture taken for one proposal, before or after its build. */
export type EvidencePhase = 'before' | 'after';
export type PackStatus = 'open' | 'triaged' | 'closed';
export type ReleaseStatus = 'draft' | 'building' | 'pr-open' | 'merged' | 'tagged' | 'failed';
/** A person's call on a built item (`POST /api/products/[slug]/triage`). `reopen` (v3) takes an accepted, rework or
 *  descoped item back to the status it had before (its `triaged_from`) while its release is still a draft: the undo. */
export type TriageDecision = 'accept' | 'rework' | 'descope' | 'reopen';

export interface Run {
  id: string;
  started_at: string;
  updated_at: string;
  ended_at?: string;
  phase: RunPhase;
  status: RunStatus;
  /** Lens ids the run covers. */
  lenses: string[];
  /** What the run was pointed at, e.g. `{ group: "Agent Platform" }`. */
  scope?: Record<string, unknown>;
  skill_version?: string;
  model?: string;
  note?: string;
}

/** Append-only: one row per reading. `metric` is the lens field key. */
export interface Measurement {
  id: number;
  run_id: string;
  feature: string;
  lens: string;
  metric: string;
  value: number;
  unit?: string;
  method?: MetricMethod;
  evidence?: string;
  measured_at: string;
  /** v2: the proposal this reading is before/after evidence for (with `phase`). An `after` reading was taken on the
   *  pack branch, so it never counts as the feature's current state (src/lib/scan/derive.ts isCurrent). */
  proposal_id?: string;
  phase?: EvidencePhase;
  /** v2: the commit the reading was taken on. */
  commit_sha?: string;
}

/**
 * A backlog item. `standard` is `<subject>/<technique>` (registry), `house:<subject>/<technique>`, or
 * `none`. A propagation item has `parent_id` = the baseline upgrade that spawned it.
 */
export interface Proposal {
  id: string;
  run_id: string;
  feature: string;
  lens: string;
  metric?: string;
  title: string;
  /** Markdown: Summary / Description / Flow / Expected impact / Evaluation. */
  body?: string;
  standard: string;
  expected_delta?: number;
  size?: ProposalSize;
  /** 1-10. */
  risk?: number;
  kind: ProposalKind;
  parent_id?: string;
  status: ProposalStatus;
  decided_by?: string;
  decided_at?: string;
  decision_note?: string;
  after_value?: number;
  result_sha?: string;
  created_at: string;
  updated_at: string;
  /** v2: the pack that built it. */
  pack_id?: string;
  /** v2: the item's own squashed commit on its pack branch. */
  commit_sha?: string;
  /** v2: the previous attempt, when this row is a rework rebuild. */
  attempt_of?: string;
  /** v2: the release it ships in. */
  release_id?: string;
  triage_note?: string;
  /** v3: the status the item had before its latest triage, so `reopen` can put it back. */
  triaged_from?: ProposalStatus;
  /** `<kind>:<name>`, e.g. `user:octocat`. */
  triaged_by?: string;
  triaged_at?: string;
  /** v4: omitted = 'scan'; only an imported item carries it. */
  origin?: ProposalOrigin;
  /** v4: '<origin>:<id>' in the source system, e.g. 'ado:1234'. */
  external_ref?: string;
  external_url?: string;
  /** v4: severity; omitted = untriaged. Not the same as risk (the risk of the change). */
  tier?: Tier;
  risk_class?: RiskClass;
  ranked_by?: string;
  ranked_at?: string;
  // v5: scan-finding/1 (docs/standard/lens-scan-store.sql, the contract's "Fields every finding carries"). The skill stores
  // them; the blueprint reads them and never recomputes `score`. A v4 store has none of these keys.
  /** v5: 1-10, the severity of a defect or the value of an opportunity. */
  impact?: number;
  /** v5: the one-line reason for `impact`. */
  impact_why?: string;
  confidence?: Confidence;
  /** v5: 1-10 build effort. */
  effort?: number;
  /** v5: scan-score/1, one decimal, stored by the skill. Omitted = unscored (impact or effort unknown): never 0. */
  score?: number;
  // EDIT (port, store v5): bp types score_parts as ScoreParts and proof as Proof because bp's reader parses them
  // (store.server.ts JSON_COLS); Personas' Rust reader (src-tauri/db/src/repos/dev/lens_scan.rs json_shape) parses only
  // runs.lenses / runs.scope / shots.report, so these two arrive as the column's raw JSON TEXT.
  /** v5: the score's breakdown as stored JSON text ({impact, confidence_w, effort_div, risk_factor, formula}). */
  score_parts?: string;
  /** v5: 'ranked' (the store's NOT NULL default, which Personas' reader does not drop) or 'reserve' (verified and
   *  scored, over the run's cap). */
  band?: Band;
  // EDIT (port, store v5): bp's wire is `mvp?: true` (its reader drops the 0 default and reads 1 as true, BOOL_COLS);
  // Personas' reader passes the INTEGER through, so a v5 row always carries 0 or 1.
  /** v5: 1 on the top finding of its lens in its run, else 0. */
  mvp?: 0 | 1;
  mvp_rule?: MvpRule;
  /** v5: why the MVP is not the top score (with mvp_rule 'override'). */
  mvp_why?: string;
  category?: FindingCategory;
  /** v5: the model's verdict, recorded before any person decided (shadow mode). */
  predicted_verdict?: PredictedVerdict;
  predicted_why?: string;
  /** v5: `<skill>@<version>:<model>`. */
  predicted_by?: string;
  predicted_at?: string;
  /** v5: set when a machine decided under L1 (`decided_by` 'machine:lens-scan'): a person may veto it until then. */
  veto_until?: string;
  /** v5: a built change's proof as stored JSON text ({metric, method, unit, before, after, verdict, control, base_sha,
   *  head_sha}); see score_parts for why it is a string here. */
  proof?: string;
}

/** v5 (scan-finding/1). */
export type Confidence = 'low' | 'medium' | 'high';
export type Band = 'ranked' | 'reserve';
export type MvpRule = 'top-score' | 'override';
export type FindingCategory = 'technical' | 'product';
export type PredictedVerdict = 'accept' | 'reject' | 'defer';

export interface Activity {
  id: number;
  run_id: string;
  at: string;
  feature?: string;
  lens?: string;
  kind: ActivityKind;
  text: string;
}

export interface Shot {
  id: number;
  run_id: string;
  feature: string;
  /** Relative to the store directory: `shots/<run>/<feature>-<theme>-<size>.png`. */
  path: string;
  size?: string;
  theme?: string;
  harness_module?: string;
  captured_at: string;
  /** The harness report for this shot (console errors, unknown IPC, text checks). */
  report?: Record<string, unknown>;
  /** v2: the proposal this capture is before/after evidence for (with `phase`). */
  proposal_id?: string;
  phase?: EvidencePhase;
}

/** v2: one lens's built items on one branch, `pack/<short>-<n>`, cut from `base_ref` at `base_sha`. */
export interface Pack {
  /** `k-<short>-<n>`, e.g. `k-des-3`. */
  id: string;
  lens: string;
  /** Per-lens counter, 1-based. */
  n: number;
  branch: string;
  base_ref: string;
  base_sha: string;
  /** The execute run that built it. */
  run_id?: string;
  status: PackStatus;
  created_at: string;
  updated_at: string;
}

/** v2: accepted items cherry-picked onto `release/<version>`, a PR, then the tag `v<version>`. */
export interface Release {
  /** `rel-<version>`. */
  id: string;
  /** Semver without the v. */
  version: string;
  branch: string;
  base_sha?: string;
  status: ReleaseStatus;
  pr_url?: string;
  tag?: string;
  /** Markdown release notes. */
  notes?: string;
  error?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface Coverage {
  feature: string;
  standard: string;
  state: CoverageState;
  evidence?: string;
  judged_at: string;
  run_id?: string;
}

/** Everything the UI needs, on connect. `activity` is the latest 200 rows. */
export interface ScanSnapshot {
  runs: Run[];
  measurements: Measurement[];
  proposals: Proposal[];
  activity: Activity[];
  shots: Shot[];
  coverage: Coverage[];
  /** v2 (empty on a v1 store). */
  packs: Pack[];
  /** v2, oldest first (empty on a v1 store). */
  releases: Release[];
}
/** New or changed rows since the last delta; same keys as the snapshot. */
export type ScanDelta = ScanSnapshot;

/** The snapshot's tables. A Record over `keyof ScanSnapshot`, so a table added above fails to compile until it is listed here. */
const TABLE_SET: Record<keyof ScanSnapshot, true> = { runs: true, measurements: true, proposals: true, activity: true, shots: true, coverage: true, packs: true, releases: true };
export const SCAN_TABLES = Object.keys(TABLE_SET) as readonly (keyof ScanSnapshot)[];
/** Every table present and empty. */
export function emptyScan(): ScanSnapshot {
  const s = {} as Record<keyof ScanSnapshot, unknown[]>;
  for (const t of SCAN_TABLES) s[t] = [];
  return s as ScanSnapshot;
}
/** A wire snapshot with every table present (a store being created may send only some). */
export function fullScan(x: Partial<ScanSnapshot>): ScanSnapshot {
  const s = emptyScan() as Record<keyof ScanSnapshot, unknown[]>;
  for (const t of SCAN_TABLES) if (Array.isArray(x[t])) s[t] = x[t];
  return s as ScanSnapshot;
}
export const isEmptyScan = (s: ScanSnapshot): boolean => SCAN_TABLES.every((t) => s[t].length === 0);

/** One line of `bp.products.local.json` (gitignored). Kettle is built in and never listed. */
export interface ProductEntry {
  slug: string;
  name: string;
  /** Absolute path of the product repo. */
  root: string;
}
/** `GET /api/products`. */
export interface ProductInfo {
  slug: string;
  name: string;
  /** The repo root, resolved to an absolute path. */
  root: string;
  /** true = the repo has a lens-scan store. */
  live: boolean;
  /** What the repo has of the files a live product needs (src/lib/scan/readiness.ts). */
  readiness: Readiness;
}

export type Decision = 'approve' | 'decline';
/** `POST /api/products/[slug]/proposals/[id]` body. */
export interface DecisionBody {
  decision: Decision;
  note?: string;
}

/** `POST /api/products/[slug]/triage` body. */
export interface TriageBody {
  ids: string[];
  decision: TriageDecision;
  note?: string;
}
/** What store.mjs `triage` answers (and the triage route returns). */
export interface TriageResult {
  /** The status the items moved to; `reopened` when each went back to its own `triaged_from`. */
  decision: 'accepted' | 'rework' | 'descoped' | 'reopened';
  by: string;
  triaged: string[];
  /** Items left as they were: their status, and a reason (`note-required`, `in-release`) where the status alone does not say why. */
  skipped: { id: string; status: string; reason?: string }[];
  /** Packs that moved open -> triaged in the same transaction. */
  packs_triaged: string[];
  /** v3, reopen only: packs that moved triaged -> open because an item went back to waiting. */
  packs_reopened?: string[];
}
/** `POST /api/products/[slug]/releases` (201): the draft with its items, and what release-add left out. */
export interface ReleaseCreated {
  release: Release & { items: Proposal[] };
  added: string[];
  skipped: { id: string; status: string; reason?: string }[];
}
/** `GET /api/products/[slug]/commits/[sha]`: one item commit, for the ledger's compare panel. `patch` is cut at
 *  2000 lines (`truncated`); `lines` is the full count. */
export interface CommitDiff {
  sha: string;
  /** The full commit message, trailers included. */
  message: string;
  /** `git show --stat` as git prints it. */
  stat: string;
  files: { path: string; add: number; del: number }[];
  patch: string;
  lines: number;
  truncated: boolean;
}
/** `GET /api/products/[slug]/releases/suggest`. */
export interface VersionSuggestion {
  /** Semver without the v. */
  version: string;
  /** What it was derived from: the latest tag (`v1.4.0`), a manifest (`package.json`, `src-tauri/Cargo.toml`), or `none`. */
  from: string;
  reason: string;
}

/** The SSE event names of `GET /api/products/[slug]/stream`. */
export type StreamEvent = 'snapshot' | 'delta' | 'map' | 'ping' | 'error' | 'jobs';

// EDIT (port): from bp src/lib/scan/readiness.ts
export interface Readiness {
  /** The repo root exists and is a directory. */
  rootExists: boolean;
  /** `app-structure.json` exists and parses as a JSON object. */
  map: boolean;
  /** 3 = app-structure v3 (`$schema: app-structure/3` or `version: 3`), 2 = a v2 context map, null = none or unknown. */
  mapVersion: 2 | 3 | null;
  /** `events.jsonl` exists (the revisions strip; optional). */
  events: boolean;
  /** `scan.db` exists. */
  store: boolean;
  /** Features in the map. */
  features: number;
  /** Enabled lenses in the map. */
  lenses: number;
  /** Distinct (feature, lens, metric) readings in the store. */
  measuredFacets: number;
  /** Open proposals (status `proposed`) in the store; null without a readable store. */
  proposals: number | null;
  /** When the latest run ended (or last moved, while running); null without one. */
  lastRunAt: string | null;
  /** Why the map or the store could not be read, when one exists and could not. */
  error?: string;
}
