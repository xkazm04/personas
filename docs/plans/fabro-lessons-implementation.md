# Fabro-lessons implementation plan

Source: `/research` comparison of the cloned `fabro` repo vs personas (2026-06-16).
Scope: 10 accepted findings — **F2, F3, F4, F5, F7, F8, F10, F18, F20, F21**.

> **Explicit non-goal (user direction):** we are **NOT** adopting fabro's Graphviz/DAG
> workflow-graph engine (F6 edge-conditions/loops, F9 ACP backend). Team orchestration
> is heading in a different, more efficient direction. Therefore **F7 (quality-gate
> fix-loops) and F8 (deterministic verification) are designed against personas' existing
> per-execution model** (runner → quality_gate → healing re-entry), not as graph nodes.

All work happens in worktree `worktree-fabro-lessons` with `CARGO_TARGET_DIR=.personas-fabro-target`
(separate from the running dev build). Each finding = one or more atomic commits, validated
with `cargo check --features desktop` (+ `tsc`/`lint` when frontend is touched), `research:`-prefixed.

---

## Architecture anchors (personas)

- **Engine spawn / prompt funnel:** `engine/prompt.rs::build_cli_args` (~30 callers), `assemble_prompt`
  (autonomy directives bracket persona content — any prompt block lands BETWEEN them).
- **Runner:** `engine/runner/mod.rs::run_execution`; structured-event funnel = the `match &line_type`
  block (~line 1301). Two stream channels (legacy text + `EXECUTION_EVENT`).
- **Orchestration:** pipelines = `engine/pipeline_executor.rs::run_persona_node`; chains =
  `engine/chain.rs`; teams = `runner/team_context.rs` (alignment block baked per member).
- **Quality:** `engine/quality_gate.rs`, `engine/output_assertions.rs` (post-run, advisory).
- **Healing (re-entry machinery exists):** `engine/healing*.rs`, `engine/auto_rollback.rs`.
- **Model:** per-persona `model_profile` + `--effort`; tiering in `_recipe_seeds.json`.
- **Persona "make X configurable" rule:** use `parameters` JSON column (`PersonaParameter`), NOT new schema columns.
- **Health:** `commands/infrastructure/system/health.rs` (`SystemHealthReport`/`HealthCheckItem{id,label,status,detail,installable}`).
- **Dev-tools plugin:** `commands/infrastructure/dev_tools.rs` + `db/repos/dev_tools.rs` (sub_runner, sub_projects). Code-work isolation lives here, NOT core engine.
- **Lab/eval:** `db/repos/lab/{eval,ratings}.rs`; Director value-rollup.
- **i18n:** new user-facing strings → `src/i18n/locales/en.json` + `useTranslation()`; run split-locales after.
- **ts-rs:** add `#[ts(export)]`, run `cargo test export_bindings`, commit `src/lib/bindings/`.

---

## Phase order (isolation + dependency)

| Phase | Finding | Surface | Depends on |
|---|---|---|---|
| 1 | **F2** secret redaction at trace-write | backend only | — |
| 2 | **F3** context fidelity (upstream preamble) | backend | — |
| 3 | **F4** doctor: remediation + footgun checks | backend + small UI | — |
| 4 | **F10** model-routing cascade resolver | backend (+ settings UI) | — |
| 5 | **F8** deterministic verification command | backend | — |
| 6 | **F7** quality-gate fix-loop + failure-signature breaker | backend | F8 |
| 7 | **F5** git-checkpoint-per-stage (dev-tools) | backend (+ runner UI) | — |
| 8 | **F18** in-app storage df/prune | backend + UI | — |
| 9 | **F21** eval: attempted/resolved + cost-per-success | backend + UI | — |
| 10 | **F20** durable event log + seq + replay + Unknown variant | backend + frontend | — |

---

## F2 — Secret redaction at the trace-write boundary  🔴 security

**Gap (verified):** the runner persists raw agent output to SQLite + forwards to Sentry with no
redaction. "redact" appears in the codebase only as an unbuilt design in `runner/HOOKS_DESIGN.md`.

**Design:**
- New `src-tauri/src/engine/redact.rs`:
  - `redact_string(&str) -> Cow<str>` — union of (a) Shannon-entropy over `[A-Za-z0-9+/_=\-]{20,}`
    tokens (threshold ≈ 4.0 bits/byte) and (b) a curated high-confidence pattern set
    (`AKIA[0-9A-Z]{16}`, `sk-ant-[A-Za-z0-9_\-]+`, `sk-[A-Za-z0-9]{20,}`, `gh[pousr]_[A-Za-z0-9]{20,}`,
    `xox[baprs]-…`, `eyJ[A-Za-z0-9_\-]+\.[…]\.[…]` JWT, `-----BEGIN [A-Z ]*PRIVATE KEY-----…`,
    `Bearer\s+[A-Za-z0-9._\-]+`). Replaces matches with `‹redacted›`.
  - `redact_json_value(&mut serde_json::Value)` — recurse, redact string leaves, but SKIP keys in
    `{id, *_id, path, name, url-path}` and base64/image blobs (mirror fabro `jsonl.rs`).
  - `DisplaySafeUrl(Url)` newtype whose `Display`/`Debug` strip userinfo + sensitive query params.
- **Wire at persistence, not emission** (the live terminal still shows the user their own output):
  redact `output_data` / trace text just before the executions repo insert/update
  (`db/repos/execution/executions.rs` + the runner persist site), and redact the string attached
  to Sentry in the spawn-failure / `tracing::error!` paths.
- Setting `REDACT_TRACES_ENABLED` (default `true`) in `db/settings_keys.rs`.
- Tests: entropy catches a 40-char token; AWS/anthropic/jwt patterns; `id`/`path` keys preserved;
  setting-off bypasses.

**Effort:** low–medium, self-contained. **Files:** `engine/redact.rs`(new), `engine/mod.rs`,
`db/repos/execution/executions.rs`, `engine/runner/mod.rs` (persist site), `db/settings_keys.rs`.

---

## F3 — Context fidelity (graded upstream preamble)

**Gap:** pipeline/chain spawns are context-blind — upstream node outputs exist (executions table)
but are discarded; only the team-alignment block is injected.

**Design:**
- New `src-tauri/src/engine/context_fidelity.rs`:
  - `enum ContextFidelity { Full, SummaryHigh, SummaryMedium, SummaryLow, Compact, Truncate }`
    (`FromStr`/`Display` via strum-style; default `Compact`).
  - `build_upstream_preamble(upstream: &[UpstreamOutput], fidelity) -> String` — **deterministic**
    (no extra LLM call): `Compact` = nested bullets, ≤25 lines; `SummaryHigh` = ≤50; `Truncate` =
    goal + ids only; `Full` = full prior text capped (precursor to F13 thread continuity).
    `UpstreamOutput { node_label, status, output_excerpt }`.
- **Inject** in `engine/pipeline_executor.rs::run_persona_node`: before spawning node N, gather
  completed upstream nodes' `output_data`, build the preamble, pass it into `assemble_prompt` as a
  new `## Upstream Context` block placed in the customSections region (BETWEEN the two autonomy
  directives — never after EXECUTE NOW). Same for `engine/chain.rs` hops.
- **Config:** `context_fidelity: Option<String>` on the pipeline-node / chain-hop config (default
  `compact`); teams unchanged (parallel → no upstream).
- Tests: preamble formatting + line caps per level; default compact.

**Effort:** medium, bolt-on to prompt assembly. **Files:** `engine/context_fidelity.rs`(new),
`engine/mod.rs`, `engine/pipeline_executor.rs`, `engine/prompt.rs::assemble_prompt`,
`engine/chain.rs`, node/assignment model + ts-rs.

---

## F4 — Doctor: remediation strings + footgun checks

**Gap:** `HealthCheckItem` has `{id,label,status,detail,installable}` — **no `remediation`**, and the
existing sections don't cover personas' documented footguns.

**Design:**
- Add `remediation: Option<String>` to `HealthCheckItem` (ts-rs).
- New checks (a "Environment" section), each with a remediation string:
  - **Keyring round-trip:** write→read→delete a probe entry; `None` on read ⇒ silent-mock backend
    (catches `feedback_keyring_backend_required`). Remediation: rebuild with `windows-native` feature.
  - **Claude CLI present + version + auth:** reuse `provider::check_cli_version` + PATH resolve.
  - **DB writable + migration version:** write probe to personas.db.
  - **Disk space for execution buffers** (APPDATA free space).
- Backfill `remediation` on existing failing checks.
- Frontend: render `remediation` in the health panel (find the `SystemHealthReport` consumer);
  follow the existing label convention (id vs i18n) — add i18n keys only if labels currently route
  through i18n.

**Effort:** low, additive. **Files:** `system/health.rs`, `system/binary_probe.rs` (reuse), ts-rs,
health UI panel (+ i18n if applicable).

---

## F10 — Model-routing cascade resolver (ensemble routing)

**Gap:** model selection is a flat per-persona `model_profile`; tiering is baked per-UC in
`_recipe_seeds.json`. No declarative "workers→haiku, reviewer→opus" cascade.

**Design (no CSS grammar — personas-native selectors):**
- New `src-tauri/src/engine/model_routing.rs`:
  - `struct ModelRoutingRule { match: RoutingMatch, model: String, effort: Option<String> }` where
    `RoutingMatch { persona_id?, role?, capability_tag? }`. Specificity: `persona_id`=3 >
    `role|capability_tag`=2 > universal=0.
  - `resolve_model(persona, rules, exec_override) -> (model_id, effort)` precedence:
    `exec_override(--model) > persona.model_profile (explicit) > highest-specificity rule > default`.
    Explicit per-persona `model_profile` always beats a rule (mirror fabro "explicit attr wins").
  - `validate_rules(rules, catalog) -> Vec<Diagnostic>` — unknown model/effort flagged at save time.
- Storage: `MODEL_ROUTING_RULES` settings JSON (project/team scope).
- Wire into model-profile resolution before `build_cli_args` (where `model_profile` → `ModelProfile`).
- Commands: `get_model_routing_rules` / `set_model_routing_rules` (validates on set).
- Tests: cascade precedence; explicit override wins; validation rejects bad model.

**Effort:** medium; serves `project_model_tiering_approach3`. **Files:** `engine/model_routing.rs`(new),
`db/settings_keys.rs`, model-profile resolution site, command + ts-rs, (settings UI deferred/minimal).

---

## F8 — Deterministic verification command (gate input for F7)

**Gap:** no "run tests/lint/typecheck, exit-code → gate signal that feeds a fix loop."

**Design:**
- New `src-tauri/src/engine/verification_command.rs`:
  `run_verification(dir, command, timeout) -> VerificationResult { passed, exit_code, output_tail }`.
  Shell out via tokio::process; exit 0 ⇒ pass; non-zero ⇒ fail; capture last 4 KB of combined
  stdout/stderr as `output_tail` (consumed by F7's fix prompt). Scrub spawn env defensively.
- Integrate as a new **gate kind** in `engine/quality_gate.rs` (alongside output assertions): a
  `command` gate runs a verification command post-run; its failure (with `output_tail`) becomes a
  structured gate failure.
- Config: verification command(s) as a persona `PersonaParameter` (`verification_command`) and/or a
  dev-tools task field.
- Tests: exit-code → pass/fail; output-tail truncation; timeout.

**Effort:** low–medium. **Files:** `engine/verification_command.rs`(new), `engine/quality_gate.rs`,
config plumbing.

---

## F7 — Quality-gate fix-loop + failure-signature circuit breaker

**Gap:** quality_gate/output_assertions are post-run advisory; no "quality failed → re-enter persona
with the failure as next instruction, bounded by visit count."

**Design (per-execution, NOT a graph):**
- New `src-tauri/src/engine/failure_signature.rs`:
  `normalize(reason) -> String` (digits/hex/uuids → placeholders); `FailureSignature{persona_id,
  category, normalized}`; a small recurrence tracker that aborts when a signature recurs ≥ limit
  (default 3) — prevents burning budget on a deterministic failure.
- New `src-tauri/src/engine/fix_loop.rs` (or extend the runner post-run path): after a run completes
  and quality_gate (incl. F8 command gates) evaluates, if FAILED **and** persona has fix-loop enabled
  and attempts remain: re-enter the SAME persona (resume session if available else fresh spawn) with a
  constructed fix prompt — "Your previous output failed: <structured failures>. Fix them." — bounded by
  `max_fix_attempts` (default 2) and the failure-signature breaker. Distinct from healing (errors):
  this triggers on QUALITY failure.
- Config (runtime-knob rule → `PersonaParameter`s): `fix_loop_enabled` (bool, default false),
  `max_fix_attempts` (number, default 2).
- `engine/quality_gate.rs` / `output_assertions.rs` expose **structured** failures for the fix prompt.
- Tests: signature normalization stability; loop respects max attempts; breaker aborts on repeat;
  no loop when disabled.

**Effort:** high (the substantial one). **Files:** `engine/failure_signature.rs`(new),
`engine/fix_loop.rs`(new), `engine/runner/mod.rs` (post-run hook), `engine/quality_gate.rs`,
`engine/output_assertions.rs`, persona-parameter reads.

---

## F5 — Git-checkpoint-per-stage (dev-tools plugin)

**Gap:** dev-tools runs agents in real git repos with zero checkpointing — no clean rewind.

**Design (run-branch half only; SQLite holds the stage→sha index, not a 2nd git branch):**
- New `src-tauri/src/engine/git_checkpoint.rs` (shell out to `git`, hardened
  `-c maintenance.auto=0 -c gc.auto=0 -c commit.gpgsign=false`):
  - `checkpoint_stage(repo_dir, run_id, stage, status) -> sha`: `git add -A` (respect .gitignore) →
    commit on branch `personas/run/<run_id>` → `rev-parse HEAD`.
  - `fork_from_checkpoint(repo_dir, sha, new_run_id)`: verify `git merge-base --is-ancestor sha ref`
    then `git checkout -B personas/run/<new_id> sha`.
  - `rollback_to(repo_dir, sha)`.
- DB: `dev_run_checkpoints(run_id, stage, sha, status, created_at)` (`migrations/incremental.rs`).
- Wire into the dev-tools task runner stages (`commands/infrastructure/dev_tools.rs` sub_runner).
- Commands: `dev_list_run_checkpoints`, `dev_fork_from_checkpoint`, `dev_rollback_to_checkpoint`.
- Frontend: Checkpoints list + rollback/fork in sub_runner task-output panel (can be a follow-up).
- **Doc-sync:** `docs/features/dev-tools.md`.

**Effort:** medium. **Files:** `engine/git_checkpoint.rs`(new), migration + model + repo,
`commands/infrastructure/dev_tools.rs`, `lib.rs`, ts-rs, (sub_runner UI), `docs/features/dev-tools.md`.

---

## F18 — In-app storage ops (df / prune)

**Gap:** executions/traces/buffers accumulate; only an out-of-app `clean:worktrees` script exists.

**Design:**
- New `commands/infrastructure/system/storage.rs`:
  - `storage_usage() -> StorageReport { categories: [{ id, label, bytes, reclaimable_bytes }] }`
    (executions rows, trace spans, buffers, vector KB, logs, orphaned worktrees).
  - `prune_storage(filter, dry_run) -> PruneResult { count, bytes_freed, items }` — **dry-run by
    default**; deletes only **terminal** executions older than an age floor (default 24h); requires
    `dry_run=false` to act. Reuse `state().is_terminal()`.
- Frontend: Storage panel (settings/overview) — usage bars + prune with dry-run preview + confirm.
- Safety contract = fabro's: dry-run default · age floor · terminal-only · explicit confirm.

**Effort:** medium. **Files:** `system/storage.rs`(new), `db/repos/execution/executions.rs`
(prunable query + delete), commands + ts-rs, storage UI + i18n.

---

## F21 — Eval: attempted-vs-resolved + cost-per-success + pinned reproducibility

**Gap:** lab/eval tracks win-rate/ratings but not attempted-vs-resolved, cost-per-success, or pinned
repro metadata.

**Design:**
- Extend the eval-run record (`db/repos/lab/{eval,ratings}.rs`): add `attempted` (produced output),
  `resolved` (passed gate/assertion), and `meta_json` (cli_version, model, effort, resource config).
- Derive `cost_per_success = total_cost / resolved_count` as a leaderboard axis.
- Surface cost-per-success + attempted/resolved in the lab/arena leaderboard UI.
- Serves model-tiering economics + Director value-rollup.

**Effort:** medium. **Files:** migration (add columns), lab eval model + repo, eval computation,
lab leaderboard UI + i18n, ts-rs.

---

## F20 — Durable event log + seq + replay + Unknown forward-compat variant

**Gap:** Tauri events are fire-and-forget; a missed event (reload/HMR) = a gap; the
`execute_persona_inner_nonblocking` footgun (output not ready on event).

**Design:**
- DB: `execution_event_log(execution_id, seq, event_json, created_at)` with `UNIQUE(execution_id,seq)`,
  monotonic `seq` per execution.
- Append every structured event at the runner's `match &line_type` funnel (`runner/mod.rs ~1301`);
  carry a per-execution seq counter in the execution context.
- Command `get_execution_events(execution_id, since_seq, limit)` for replay/paging.
- Add `Unknown` variant to `StructuredExecutionEvent` (Rust) + `terminalEvents.ts` + `eventRegistry.ts`
  (hand-maintained) + `useStructuredStream.ts` (ignore gracefully) → forward-compat so an older
  frontend doesn't crash on a newer event type.
- Frontend: treat live events as invalidation hints, read authoritative state via the log/query;
  replay-from-log on inspector mount (replay UI can be a follow-up; core = log + seq + Unknown).
- Tests: seq monotonic; replay ordering; Unknown deserializes.

**Effort:** high (heaviest infra). **Files:** migration + model + repo, `engine/runner/mod.rs`,
`engine/types.rs` (Unknown), `src/lib/types/terminalEvents.ts`, `src/lib/eventRegistry.ts`,
`hooks/execution/useStructuredStream.ts`, command + ts-rs.

---

## Cross-cutting

- **Atomic commits** per finding (split into sub-commits if a finding spans migration + wiring + UI).
- **Validate per commit:** `cargo check --features desktop` (Rust), `cargo test export_bindings` + commit
  `src/lib/bindings/` when types change, `tsc`/`lint` when `src/**` touched, split-locales after en.json edits.
- **i18n contract** for any `src/**/*.tsx`: keys in `en.json` + `useTranslation()`, no hardcoded JSX English.
- **Doc-sync:** F5 → `docs/features/dev-tools.md`; F4/F18/F20/F21 surface in overview/settings — update
  the matching `docs/features/*` in the same commit if user-visible.
- **No `git add -A`** — per-path staging only (master has the user's intermixed kpi/companion work).
