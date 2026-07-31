# Batch 2 Design — "Safe Autonomy" (2026-07-30)

> Five moonshot v1 slices in parallel, landing as ONE coherent package: **"The fleet may act
> alone — because every act is planned, budgeted, attributed, audited, and reversible."**
> Branch: `vibeman/moonshot-batch2-2026-07-30` (off batch-1 tip). Baselines (batch-1 tip, all
> green): tsc 0 · cargo check --features desktop,ml clean · vitest 2967/2969 (sole fail =
> pre-existing master camelCase ratchet) · eslint clean.

## The package story

1. **Overnight Portfolio Engine** — the mechanical nightly tick: scan → triage → dispatch,
   spend-governed (the muscle).
2. **Night Shift (Athena)** — the supervisor: approves the night plan, answers stuck workers,
   reviews outcomes, briefs you in the morning (the judgment).
3. **Reversible Agent** — every row an agent writes is attributed, diffable, undoable (the
   safety floor that makes 1+2 tolerable).
4. **Zero-Plaintext Broker** — agents and external processes consume credentials as revocable
   handles through an audited proxy (the identity floor).
5. **Crew Foundry** — each repo gets a purpose-synthesized crew, so what the night dispatches
   is specialized, not generic (the staffing).

## The Engine/Athena boundary (both builders MUST respect this)

- **Overnight Engine** owns the *autopilot subscription tick*: per-project `full`-mode nightly
  runs of incremental scan → triage rules → dispatch of auto-accepted ideas to fleet sessions,
  hard budget pre-check, and the per-project morning digest **data** (notification). It is
  mechanical — no LLM planning, no guidance-answering. Zone: `src-tauri/engine/src/autopilot.rs`
  + `src-tauri/src/commands/infrastructure/**`.
- **Night Shift** owns *judgment*: the night-plan job (goals/backlog-driven, emitted as an
  approval card BEFORE the night), the unattended-guidance policy on MCP `request_guidance`,
  the post-session review station (ship-to-branch / park / retry classification), and the
  morning briefing narrative. Zone: `src-tauri/src/companion/**`.
- Neither modifies `src-tauri/src/commands/fleet/**` — fleet spawn/registry APIs are
  call-only for both. If an API is missing, note it in your reply; do not add it yourself.
- Unattended work NEVER touches a repo's default branch — branch-only writes, human merges.
  Destructive `request_approval` ALWAYS parks. These are package-level invariants.

## Shared contracts (ALL builders)

- Everything from BATCH-1-DESIGN.md still applies: blessed catalog only, `AthenaComposedBadge`
  (`src/features/shared/components/feedback/AthenaComposedBadge.tsx` — variants
  composed/diagnosed/handled) for AI provenance, one action grammar, honest empty/loading
  states, Athena first-person operational copy, i18n per surrounding convention.
- **The autonomy grammar** (new, batch-2): every autonomous act must be (a) *attributed* — who
  (persona/execution/consumer id) did it; (b) *audited* — a durable ledger row; (c) *bounded* —
  a hard pre-check (budget, allowlist, scope) refuses before acting, never apologizes after;
  (d) *reversible or parked* — undoable where possible, parked for a human where not.
- New Tauri commands use the `AppError` envelope (structural test enforces — batch-1 lesson);
  new exported ts-rs structs declare `#[serde(rename_all = "camelCase")]` (ratchet test).

## Slices, owners, file zones

Read your source report section FIRST (paths in `docs/harness/moonshot-2026-07-30/`).

### 1. Overnight Portfolio Engine v1 — `platform-infrastructure.md` #1 (steps 1-3, 6)
**Slice**: (a) move fleet-dispatch composition from frontend into Rust so a headless tick can
spawn fix sessions (kills the documented v1 limitation in `dev_tools_dispatch_ideas`);
(b) `Capability::ScanAndTriage` + `Capability::DispatchFixes` in `autopilot.rs`; nightly tick
per `full`-mode project: incremental scan → `dev_tools_run_triage_rules` → dispatch
auto-accepted ideas, capped by `fleetMaxLiveSessions`; (c) budget governor: pre-dispatch
projected-cost check against the monthly ceiling from `llm_spend` — refuse + degrade
`full`→`suggest`, never fail silently; (d) morning digest notification per project per night
(dispatched / passed / blocked / spend) via `notification_subscriptions`. Director gate +
KPI-loop are explicitly deferred (checkpoint-not-merge + branch-only writes are the v1 safety).
**Owns**: `src-tauri/engine/src/autopilot.rs`, `src-tauri/src/commands/infrastructure/**`,
autopilot settings UI touchpoint if needed (`src/features/settings/**` minimal). Fleet APIs
call-only.

### 2. Night Shift v1 — `ai-companion.md` #2 (steps 1-3, 5)
**Slice**: (a) "night plan" job kind in `jobs/` (the documented extension point): at
wake-window open, one CLI call reads goals + backlog + `dev_memories` + fleet patterns → a
bounded plan (N sessions, per-repo scope, stop conditions) emitted as an approval card the
user confirms before bed — no plan runs unapproved; (b) unattended-guidance policy in
`mcp/pending.rs`: unresolved `request_guidance` after T minutes during the night window routes
to an Athena `TurnOrigin::Proactive` turn answering from `dev_memories` + decisions precedent;
`request_approval` for destructive ops ALWAYS parks; every unattended answer logged as an
episode + decision; (c) review station: on fleet-session exit, a job runs the repo's known
gates, diffs the branch, classifies ship-to-branch / park-for-human / retry-with-feedback —
findings land as episodes + one rollup card; (d) morning briefing: extend `proactive/rollup.rs`
into a night-shift report (dispatched/succeeded/parked/questions) delivered as the first
proactive message at wake (TTS optional — only if everything else is done). Trust ledger +
multi-night campaigns deferred.
**Owns**: `src-tauri/src/companion/**` (jobs, proactive, orchestration/mcp, wake_window,
session), related frontend companion surfaces if minimal. Fleet APIs call-only.

### 3. Reversible Agent v1 — `database-infrastructure.md` #1 (steps 1-5)
**Slice**: (a) `change_journal` table (incremental migration) + a durable second CDC consumer
persisting every `CdcEvent` (table allowlist; journal writes excluded from CDC — no recursion);
(b) execution attribution: task-local write-attribution context set by the execution runner
around each agent run (the `CdcHooks` injection point), stamping journal rows with
`execution_id`; (c) before-images via rusqlite `preupdate_hook` (feature flag — note the
Cargo.toml change as a shared append) serializing old row values for UPDATE/DELETE; encrypted
payload tables store ciphertext, never plaintext; (d) "Execution Data Diff" panel in the
execution detail view — the exact rows a run created/modified/deleted rendered as diffs;
(e) `undo_execution(execution_id)`: reverse-replay in ONE transaction with conflict detection
(row modified since → flag and park, never clobber), surfaced as a consent-gated action on
the diff panel. Point-in-time scrubber deferred.
**Owns**: `src-tauri/db/src/**` (cdc, migrations, new journal repo), engine attribution hook,
`src/features/overview/ExecutionDetailModal/**` additions, `src/api/overview/**` additions.

### 4. Zero-Plaintext Broker v1 — `security-credentials.md` #1 (steps 1-2, 4, 5-min)
**Slice**: (a) `/api/proxy/{credential_ref}` on `management_api.rs` forwarding into
`api_proxy.rs`'s existing engine, enforcing caller-key scopes ∩ the credential's
`scoped_resources` — external processes use credentials without ever seeing them; (b)
per-consumer identities: extend `external_api_keys` scopes with credential grants
(`cred:<connector>:use`) + a mint command returning a short-lived derived handle (never the
secret), exposed via the existing MCP gateway verb surface; (c) every proxied call lands in
the audit log AND creates/refreshes a live `credential_dependents` edge so the blast-radius
graph reflects reality; (d) minimal "Broker" surface in the vault UI: per-consumer activity
list + kill-switch per consumer (revoke key). Foraging quarantine + P2P deferred. Bearer/API-key
connectors only (document the SigV4/websocket exclusion honestly in UI copy).
**Owns**: `src-tauri/src/engine/{management_api.rs, api_proxy.rs}`,
`src-tauri/core/src/models/external_api_key.rs`, `src-tauri/src/commands/credentials/**`,
audit/dependents repos, new vault Broker tab under `src/features/vault/**`.

### 5. Crew Foundry v1 — `factory-projects.md` #2 (steps 1-3, 6-min)
**Slice**: (a) project **brief compiler** — pure function rendering pulse + context map +
passport gaps + off-track KPIs into a synthesis brief; (b) "Forge this project's crew" button
on the Factory L2 Overview tab feeding the existing `synthesize_team`; (c) project-scoped
roles in the synthesis prompt (e.g. Reliability persona anchored to contexts with incident
heat, Docs persona on the weakest passport dimension) — the crew maps to the project's actual
deficits; (d) wire the forged crew as the default team for `advance_goal` on that project;
(e) crew-fitness visibility stub: per-persona assignment success rate surfaced in the Factory
(instrument NOW so the compounding bet is falsifiable). Retune loop + preset promotion
deferred.
**Owns**: `src-tauri/src/commands/design/team_synthesis.rs` (additive),
`src-tauri/src/engine/goal_advance.rs` (light), `src/features/teams/sub_factory/**`,
`src/api/devTools/**` additions.

## Coordination rules (identical to batch 1 — hard)

Same working tree, strict zones, new-files-preferred. Shared files ONLY as one-line/append
edits (lib.rs invoke_handler + setup, mod.rs registrations, `incremental.rs` migrations —
pick the next free id, renumber on collision; `Cargo.toml` dep/feature lines; en.json append
+ regen). NO cargo (orchestrator runs the single authoritative
`cargo check --features desktop,ml` after harvest). NO git. `npx tsc --noEmit` allowed; full
`npm run check` is not. Focused unit tests where surrounding code has them (journal replay,
scope intersection, plan bounding, brief compiler are all pure-logic test targets — cover
them). Reply format: <150 words — zone, shipped vs spec, files, shared-file edits (exact),
migrations, what's NOT done and why, registration lines to verify.

## Acceptance bar

Slice complete; autonomy grammar holds (attributed/audited/bounded/reversible-or-parked);
Engine/Athena boundary respected; no default-branch writes anywhere; no zone violations; tsc
clean; cargo clean at harvest; vitest no regressions vs 2967/2969; envelope + camelCase
conventions on all new Rust.
