# Resilience & Escalation Certification (§6) — design + build spec

The certification framework (`scripts/test/` + this dir) grades whether a team
works unattended for weeks. It currently covers cascade completion, work density,
handoff health, learning loop, grounding, and code-track build/lint/test +
delivered-increment + self-veto. It has **zero coverage** of the resilience
machinery shipped in P0–P2:

1. **Durable execution queue** survives an app restart (P1a `requeue_persisted_executions`).
2. **Load management / concurrency cap** — ≤N concurrent executions, none dropped (`engine/queue.rs` `ConcurrencyTracker`, default 4).
3. **Incident escalation + auto-continuation** — a persona `raise_incident` → `audit_incidents` row → resolve → the `IncidentContinuationSubscription` re-runs the blocked work exactly once (P2.2/P2.3a/P2.3b).
4. **Review/incident resolution events** — `incident_resolved`, `review_decision.*` fire and are delivered (P1b/P2.3a).

This spec adds **rubric §6 "Resilience & Escalation"** covering all four.

## THE INVARIANT (golden-diff safety — non-negotiable)

The evaluator is protected by a golden-diff: `scripts/test/evaluate.mjs --run <id> --no-build`
must produce **byte-for-byte identical** `scorecard.json`, `scorecard.md`, and stdout
on every EXISTING run bundle after this change. Goldens for 3 reference runs are at
`C:\Users\mkdol\eval-cert-goldens\` (ai_bookkeeper_amount_validation, ai_paralegal_citation_validator_adr, local_seo_parallel_utils).

To guarantee this, **all §6 logic is gated behind `seed.tracks.includes('resilience')`**:
- §6 is a **cap + reported facts only** — it is NEVER folded into `team_score` or the roll-up divisors (`rubric.mjs` `deterministicDivisor`/`judgedDivisor` are UNCHANGED). This mirrors how `delivered_increment`/`self_veto` work (caps, not score components).
- The `resilience` subtree is added to the scorecard object **only when `isResilienceTrack`** (conditional spread `...(isResilienceTrack ? { resilience } : {})`), so non-resilience scorecards are byte-identical.
- New caps' `when` conditions all start with `isResilienceTrack &&` → false on existing runs → `computeVerdict` output unchanged.
- The `scorecard.md` §6 section and the stdout ` resilience=…` segment are appended **only when `isResilienceTrack`**.
- `gather.mjs` writes a new `incidents.json`; `evaluate.mjs` reads it with `existsSync` guard defaulting to `[]` (older bundles lack it → no behavior change).

Existing seeds have no `resilience` track → every existing run is a strict no-op. **Verify with the golden-diff before committing each evaluate.mjs change.**

## C1 — offline measurement layer (no live app; oracles: node, golden-diff, test:cli, cargo)

### C1.0 — fix the seed-path skew (REQUIRED for the later live run)
`scripts/test/run.mjs:22` and `scripts/test/longitudinal.mjs:21` set `SEEDS_DIR = join('docs','test','seeds')` — but that dir **does not exist**; seeds live in `docs/tests/autonomy-eval/seeds` (plural). So `node run.mjs --seed X` currently throws ENOENT (the live driver is broken). Fix both constants to `join('docs','tests','autonomy-eval','seeds')`. (`docs/test/runs` singular is correct and stays — it's the git-ignored live-dump dir that evaluate/gather/run all share.)

### C1.1 — gather `audit_incidents` → `incidents.json`
In `scripts/test/gather.mjs` `gatherBundle()`, after the `events` query (~line 76), add (read-only, mirror the events query shape). audit_incidents columns (from `incremental.rs:2226-2242`): id, source_table, source_id, dedup_key, persona_id, persona_name, execution_id, severity, kind, title, detail, status, acknowledged_at, acknowledged_by, resolved_at, resolution_note, continued_at, created_at.

```js
// --- audit incidents (escalation + auto-continuation) ---
const execIds = executions.map((e) => e.id);
const execPh = execIds.length ? inClause(execIds.length) : "''";
const incidents = db
  .prepare(
    `SELECT id, source_table, source_id, persona_id, execution_id, severity, kind, title,
            status, acknowledged_at, resolved_at, resolution_note, continued_at, created_at
     FROM audit_incidents
     WHERE created_at >= ? AND (persona_id IN (${ph})${execIds.length ? ` OR source_id IN (${execPh})` : ''})
     ORDER BY created_at ASC`,
  )
  .all(sinceIso, ...personaIds, ...(execIds.length ? execIds : []));
```
Then `write('incidents.json', incidents);` at the write block (~line 141) and add `incidents: incidents.length` to `summary.counts` (~line 159). (audit_incidents lives in MAIN_DB, already open as `db` — add BEFORE `db.close()` at line 83.)

### C1.2 — pure scorer `scripts/test/lib/eval/resilience.mjs` (NEW)
Mirror `lib/eval/grounding.mjs` (pure, exported, unit-tested). Export `resilienceFacts(incidents, executions, events)`:

```js
// Resilience & Escalation scorer (rubric §6). Pure — unit-tested in tests/cli/resilience.test.mjs.
// Reads the bundle's incidents.json + executions.json + events.json (no DB, no app).
// Asserts the OBSERVABLE DB signals of the P2 incident escalation + auto-continuation loop.

/** Incidents a persona escalated via raise_incident (source_table='persona_blocker'). */
export function resilienceFacts(incidents = [], executions = [], events = []) {
  const blockerIncidents = incidents.filter((i) => i.source_table === 'persona_blocker');
  const raised = blockerIncidents.length;
  const resolved = blockerIncidents.filter((i) => i.status === 'resolved').length;
  // Auto-continuation stamps continued_at exactly once (claim_continuation).
  const continued = blockerIncidents.filter((i) => i.continued_at).length;

  // A resolved blocker incident's source_id IS the blocked execution id. The
  // auto-continuation creates a NEW execution via create_retry → that row's
  // retry_of_execution_id === the blocked exec id and it should reach completed.
  const blockedExecIds = new Set(
    blockerIncidents.filter((i) => i.status === 'resolved').map((i) => i.source_id),
  );
  const continuationExecs = executions.filter((e) => blockedExecIds.has(e.retry_of_execution_id));
  const continuationExecsCompleted = continuationExecs.filter((e) => e.status === 'completed').length;

  // §6.4 — the bus signal that drives event-orchestrated continuation.
  const incidentResolvedEvents = events.filter(
    (e) => e.event_type === 'incident_resolved' && e.status === 'delivered',
  ).length;
  const reviewDecisionEvents = events.filter(
    (e) => typeof e.event_type === 'string' && e.event_type.startsWith('review_decision.') && e.status === 'delivered',
  ).length;

  // Escalation CLOSED when every raised blocker was resolved AND auto-continued
  // AND its continuation execution completed. This is the core "the team
  // recovered from a real blocker without a human babysitting it" assertion.
  const escalationClosed =
    raised > 0 &&
    resolved === raised &&
    continued === raised &&
    continuationExecsCompleted >= resolved;

  // 0–100 recovery score (reported only; NOT folded into team_score).
  const recoveryScore = raised === 0 ? null : Math.round(
    ((resolved / raised) * 0.34 + (continued / raised) * 0.33 +
     (resolved ? Math.min(continuationExecsCompleted / resolved, 1) : 0) * 0.33) * 100,
  );

  return {
    raised, resolved, continued,
    continuationExecsCompleted,
    incidentResolvedEvents, reviewDecisionEvents,
    escalationClosed, recoveryScore,
  };
}
```

### C1.3 — wire into `scripts/test/evaluate.mjs` (gated; golden-safe)
- Import: `import { resilienceFacts } from './lib/eval/resilience.mjs';`
- Read incidents (after the other readJson, ~line 98): `const incidents = existsSync(join(dir, 'incidents.json')) ? readJson(join(dir, 'incidents.json')) : [];`
- Track flag near `isCodeTrack` (~line 132): `const isResilienceTrack = Array.isArray(run.seed?.tracks) && run.seed.tracks.includes('resilience');`
- Compute (after self_veto, ~line 216): `const resilience = isResilienceTrack ? resilienceFacts(incidents, executions, events) : null;`
- Add caps to the `computeVerdict([...])` list (~line 219-232) — **all gated on isResilienceTrack so non-resilience runs are unaffected**:
  ```js
  // §6.1 Escalation must close: a resilience-track run that raised a blocker
  // incident but did NOT auto-resolve+continue+complete it → NOT-READY (the
  // team can't recover from a blocker unattended — the whole point).
  { when: isResilienceTrack && !!resilience && resilience.raised > 0 && !resilience.escalationClosed, to: 'NOT-READY' },
  // §6.2 A resilience-track run that raised NO incident at all isn't exercising
  // the path the seed is meant to test → PROMISING (inconclusive, not a pass).
  { when: isResilienceTrack && !!resilience && resilience.raised === 0, to: 'PROMISING' },
  ```
- Add to scorecard via conditional spread so non-resilience JSON is byte-identical. Insert into the scorecard object literal:
  ```js
  ...(isResilienceTrack ? { resilience } : {}),
  ```
- `scorecard.md`: append a "## Resilience & Escalation (§6)" section **inside `if (isResilienceTrack)`** only.
- stdout console.log: append `${isResilienceTrack ? ` resilience[raised=${resilience.raised},closed=${resilience.escalationClosed},recovery=${resilience.recoveryScore}]` : ''}` to the existing line.

### C1.4 — `scripts/test/lib/schema.mjs`
Add to the `Scorecard` typedef (line ~39): `@property {Object|null} [resilience]`. In `validateScorecard` (after the self_veto/code_track optional checks, ~line 80): `if (sc.resilience != null && typeof sc.resilience !== 'object') errs.push('resilience must be object|null');`. (Additive optional — existing bundles lacking it still validate.)

### C1.5 — `tests/cli/resilience.test.mjs` (NEW; mirror verdict.test.mjs / grounding.test.mjs)
node:test + node:assert. Unit-test `resilienceFacts` against synthetic fixtures:
- happy path: 1 blocker incident resolved+continued, a retry exec (retry_of_execution_id=blocked id) completed, an incident_resolved delivered event → `escalationClosed===true`, recoveryScore 100.
- raised-but-not-resolved → escalationClosed false.
- resolved-but-continued_at null (auto-continuation didn't fire) → escalationClosed false.
- continued but the retry exec failed → escalationClosed false.
- raised===0 → recoveryScore null, escalationClosed false.
- review_decision.* delivered events counted.
Also assert (regression guard for the INVARIANT): construct a NON-resilience-like input and confirm the function is pure / side-effect-free (it returns facts only).

### C1.6 — Rust reader `src-tauri/src/commands/eval_runs.rs`
Add to `struct Scorecard` (after `delivered_increment`, ~line 71), mirroring the existing optional subtrees EXACTLY:
```rust
    #[serde(default)]
    resilience: Option<serde_json::Value>,
```
This is `#[ts(export)]` → after the edit run from repo root:
`cargo test --manifest-path src-tauri/Cargo.toml --features desktop --no-default-features export_bindings` (the feature-narrowed form — raw cargo hits the updater:default codegen error). Commit the regenerated `src/lib/bindings/Scorecard.ts`. cargo build must be EXIT 0.

### C1.7 — rubric doc `docs/tests/autonomy-eval/evaluation-rubric.md`
Add a "§6 Resilience & Escalation" section: the four capability areas, the deterministic signals each asserts, the two caps (§6.1 escalation-must-close → NOT-READY, §6.2 no-incident-raised → PROMISING), and that §6 only applies to seeds with the `resilience` track. Note recovery score is reported-not-scored.

### C1.8 — held-out resilience seed `docs/tests/autonomy-eval/seeds/sdlc2-ai-bookkeeper-resilience-1.json`
Mirror the cert seed schema. Fields: id `sdlc2/ai-bookkeeper-resilience-1`, team (the SDLC2 ai-bookkeeper team UUID — look it up via the harness/db), repo `ai-bookkeeper`, `tracks: ["code","resilience"]`, exercises_roles, `held_out: true`, goal (a task whose precondition is deliberately missing so a persona MUST raise_incident — e.g. "implement X that depends on a connector/credential/file that isn't present; if blocked, escalate"), repo_cmds {build,lint,test}, acceptance_hint (the incident must be raised, resolved, and auto-continued to completion). NOTE the goal must reliably induce a real blocker — phrase so the engineer hits a genuine missing precondition and escalates rather than inventing a workaround.

## C2 — live drivers (needs the app on :17320; verify the actual behaviors)
- **Chaos/restart driver** `scripts/test/chaos.mjs`: kick a team, wait until ≥1 execution is `queued`/`running`, kill the app process, restart it (the test-automation lite dev), then assert via SQLite that the previously-`queued` execution advanced (not silently `failed`) — proves P1a durable queue. Snapshot pre-restart queued ids → post-restart status.
- **Concurrent-load driver** `scripts/test/load.mjs`: fire N>cap goals concurrently at one persona, sample `persona_executions` for max concurrent `running` over time, assert ≤cap overlapping and zero dropped (all eventually terminal) — proves the ConcurrencyTracker cap.

## C3 — comprehensive certification run (needs app + $)
Drive the resilience seed(s) live through `run.mjs` → `evaluate.mjs` (+ judge) across the SDLC2 team(s), confirm §6 fires correctly on real incident bundles, and record verdicts toward the held-out streak. Update `project_team_autonomy_eval_framework` memory + the ledger with results.

## Verification gates (per phase)
- C1: golden-diff ZERO on the 3 reference runs (`evaluate.mjs --run <id> --no-build` vs `eval-cert-goldens/`); `npm run test:cli` green (was 51); the new resilience.test.mjs green; `npx tsc --noEmit` 0; cargo build EXIT 0 + Scorecard.ts binding regenerated + committed; schema-contract test green.
- C2/C3: live — the asserted DB signals observed.
