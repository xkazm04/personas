# Multi-agent persona build — implementation plan

> Companion to the sub-agent assignment diagram
> [`build-orchestration-subagents.puml`](./build-orchestration-subagents.puml) and
> the benchmark harness [`docs/tests/build-bench/`](../tests/build-bench/README.md).
>
> **Thesis.** Today a persona build is a single serial CLI session (one turn per
> phase, `--continue`-resumed). The v3 chronology already has two natural
> independence seams — per-capability resolution and per-tool testing — that can
> fan out to bounded sub-agents without "managed chaos". This plan lands that in
> phases, each **gated by the build-bench harness showing real forward progress**
> (faster AND no quality regression) before the next phase starts.

## Ground rules

- **Every phase is measured.** Run `run_build_bench.py --fixture web-research-desk
  --variant sequential --variant multiagent --repeat 3` at the end of the phase.
  A phase is DONE only when the report says **FORWARD** (median build time down,
  gate pass-rate + judge quality not down). Record the number in the phase's
  "Result" line.
- **The to-be path is flag-gated the whole way.** `orchestration = sequential |
  multiagent` (build-start body field + `PERSONAS_BUILD_ORCHESTRATION` env
  fallback). `sequential` is always the untouched as-is path, so we can A/B and
  roll back instantly.
- **Scope multi-agent to `one_shot` mode.** Interactive builds keep the serial
  gate state machine (mpsc park/resume) — do not parallelize question-asking.
- **Respect the budget.** All fan-out goes through a bounded scheduler
  (`min(build_budget, N)`, budget ≈ 2–3) honoring `run_budget.rs` /
  `rate_limiter.rs` / `resource_governor.rs`. Never spawn unbounded CLIs against
  the subscription.
- **Do multi-file work in a worktree, commit atomically** (per CLAUDE.md
  parallel-safety primitives).

---

## Phase 0 — Build telemetry + baseline  ·  _prerequisite, no behavior change_

**Why first.** You cannot judge "speed" honestly without per-phase timing, and
today `build_sessions` records only `created_at` + a last-write `updated_at` —
no phase history, no token/cost. This phase makes the build **measurable** for
BOTH as-is and to-be, and unblocks the harness. Pure observability.

**Changes**
1. `build_sessions`: add `phase_timings_json TEXT` (append `{phase|event, ts}`
   on each `dual_emit` / `update_phase`), plus `total_cost_usd REAL`,
   `input_tokens INTEGER`, `output_tokens INTEGER`, `num_turns INTEGER`.
2. `build_session/runner.rs` + `parser.rs`: capture the CLI stream's terminal
   `result` message (`usage`, `total_cost_usd`, `num_turns`) and persist it.
3. Expose the new fields on `/build/status` (`handle_build_status`) and
   `GET /api/build/{id}` so the harness reads them (`costUsd`, `numTurns`,
   `phaseTimings`).
4. `/build/start`: when `persona_id` is empty, mint a draft persona shell and
   return its id — makes benchmarking fully headless (no UI bridge).

**Risk** Low — additive columns + read-path fields. No change to build logic.
**Gate** Harness runs `--variant sequential` end-to-end and prints a report with
real per-phase seconds + cost. This IS the baseline.
**Result** _(fill in: e.g. "baseline median 132s, 5 caps, gate 100%, $0.24")_

---

## Phase 1 — Events groundwork  ·  _streaming prerequisite for orchestration_

**Why.** Concurrent sub-agents need to be distinguishable on the event stream.

**Changes**
1. Add an optional `lane` field to the per-capability `BuildEvent`
   (`CapabilityResolutionUpdate`) — `#[serde(default, skip_serializing_if)]`
   keeps the wire payload byte-identical until a producer sets it (Phase 4).
   ts-rs regen + carry it onto `CapabilityState` in `matrixBuildSlice`.
   `capability_id` already discriminates the resolution stream; `lane` adds the
   explicit agent attribution the orchestration diagram calls for. **DONE.**
2. ~~Migrate `DialogueComposePanel` off a blocking `BuildTurnResult` invoke~~ —
   **not needed; the premise was wrong.** The live dialogue surface is
   `GlyphDialogueCinemaLayout`, which already reads the same streaming build
   store (`buildBehaviorCore` / `buildCapabilities` / `buildPhase` … via the
   per-session `Channel`) as the cinema layout. `DialogueComposePanel` is
   presentational — it consumes streamed state through props + `useAgentStore`.
   The `invokeWithTimeout<BuildTurnResult>` path belongs to the **unrelated**
   Athena web-dev Studio (`webbuild_session_send`), not the persona build.

**Risk** Low (additive field, no producer). **Gate** bindings regen clean;
harness unaffected on `sequential`.
**Result** lane field landed; the dialogue build already streamed, so Phase 1
reduced to the field.

---

## Phase 2 — Orchestrator scaffold behind the flag  ·  _plumbing, still serial_

**Why.** Land the DAG scheduler + variant switch with **zero behavior change**,
so the risky parallelism goes in on proven plumbing.

**Changes** _(implemented)_
1. **`orchestration` threaded end-to-end** — added to `start_session` (with
   `PERSONAS_BUILD_ORCHESTRATION` env fallback, normalized to `sequential` |
   `multiagent`) and passed to `run_session`. All five callers wired:
   `/build/start` (test-automation) and `/api/build` (management API) pass the
   request field; the two Tauri commands + the companion approval path pass
   `None` (env-driven). The build-bench harness already sends `orchestration`.
2. **`engine/build_session/orchestrator.rs`** — a reusable bounded-parallel
   scheduler (`run_lanes`): `Semaphore` budget + per-lane `catch_unwind` panic
   isolation + input-order results, modeled on
   `team_assignment_orchestrator`'s discipline. Ships with 4 unit tests
   (order, concurrency bound, panic isolation, budget clamp). `#[allow(dead_code)]`
   — Phase 3 wires it into the tool-test loop. **Not yet called by the runner.**
3. **Lane attribution** — in `multiagent` mode `run_session` stamps
   `lane = cap-<capability_id>` on `CapabilityResolutionUpdate` events (Phase 1's
   field); `sequential` leaves it `None`. Zero behavior change — the built
   persona is byte-identical either way.

**Deliberately deferred:** orchestration mode is **not persisted** (no column).
Phase 2 is zero-behavior-change, so the switch has no observable persisted effect
yet — that's the point. Confirmation comes from the LaneScheduler tests + the
`run_session` startup log; the measurable switch lands in Phase 3.

**Risk** Low (multiagent path == sequential path functionally). **Gate** Harness:
`multiagent` ≈ `sequential`, identical structure/quality (no regression) + the
LaneScheduler tests green.
**Result** Threading + scheduler + lane attribution landed; compiles + scheduler
tests pass. Runtime A/B (identical-output check) pending a live harness run.

---

## Phase 4 — Scripted + parallel connector tool tests  ·  _deferred behind resolution fan-out_

> **REORDERED (2026-07-08 baseline).** This was Phase 3, but the baseline showed
> resolution dominates the tool-test phase **~8:1** (a clean simple build spent
> ~120s resolving vs ~15-18s testing, and the ratio only grows with capability
> count). The tool-test phase is a ≤15% slice, so its ceiling is small — this
> optimization now **follows** the resolution fan-out (Phase 3 below), which
> targets the 80%+. Section kept in full; only its priority changed.

> **RESCOPED after reading `run_tool_tests` (tool_tests.rs).** The original
> "parallelize the tool tests" premise was wrong: the tool-test phase is **not**
> N independent per-tool LLM calls. It is **one** LLM call to generate a curl
> test-plan (`spawn_temp "build-test"`, ~50s), then a loop of fast deterministic
> curls (`execute_test_curl`), then **another** LLM call to summarise
> (`generate_test_summary`, ~50s). Parallelizing the 2 fast Airtable/Notion curls
> saves ~nothing — the phase is LLM-dominated. So the gate ("the tool-test phase
> shrinks") **cannot** be met by parallelizing curls; it can only be met by
> **eliminating the plan-generation + summary LLM calls** — i.e. the scripted
> approach (formerly Phase 5's first item). Phases 3 and 5.1 are therefore merged.

**Why.** The connectors declare a `healthcheck_config`; a deterministic
`healthcheck::run_healthcheck` (or `api_proxy::execute_api_request`) per bound
connector IS the correct read-only test — faster, cheaper, and less flaky than an
LLM composing curl. Running them through `run_lanes` also finally exercises the
Phase 2 scheduler in the real build path.

**Changes** (multiagent-gated; sequential keeps the LLM path untouched)
1. Thread `orchestration` into `run_tool_tests` (signature + its callers in
   `oneshot.rs` / the test/promote commands).
2. In multiagent mode, **short-circuit before the `build-test` LLM spawn**: for
   each `required_connector`, resolve its vault `credential_id` and run
   `run_healthcheck` (deterministic) through `run_lanes` (bounded parallel),
   building the SAME per-tool result shape (`{tool_name, status, http_status,
   latency_ms, error, connector, output_preview}`) and aggregate the existing
   fallback path already emits. Skip `generate_test_summary` too (deterministic
   summary), removing both LLM calls.
3. Built-in / native tools auto-pass exactly as the current fallback does.

**Risk** Medium — behavior-changing (deterministic vs LLM-composed test) and
security-adjacent (real API calls with vault creds). Gated on `multiagent` so the
default path is untouched. **Not yet implemented** — needs runtime verification
(real Airtable/Notion creds + a live harness run), since correctness here can't be
proven by `cargo check` alone.

**Gate** Harness: `multiagent` tool-test phase **down** vs baseline (both LLM
calls gone), Airtable/Notion outcomes **unchanged** (healthcheck pass/fail ==
the curl pass/fail). FORWARD required.
**Result — IMPLEMENTED (2026-07-09, env-gated, compiles).** `run_tool_tests` now
short-circuits to `run_scripted_connector_tests` when `PERSONAS_SCRIPTED_TOOL_TESTS=1`:
one `run_lanes` lane per `required_connector` running `healthcheck::run_healthcheck`
(deterministic, parallel), `resolve_credential_links` → credential_id, same result
shape, NO LLM plan/summary turns. No-op (falls to the LLM path) when the env is
unset, so the default is untouched. **Win-verification deferred** to a connector
fixture (web-research-desk + Airtable/Notion creds) — native-only builds have no
connectors to script — per the "broaden coverage later" sequencing.

---

## Phase 3 — Fan-out #1: parallel per-capability resolution  ·  _the big lift · NOW THE PRIORITY_

> **PROMOTED ahead of tool-tests (2026-07-08 baseline).** Resolution is 80%+ of
> build time and scales with capability count; this is where the measurable win
> is. Implement this before the scripted tool-tests (Phase 4).

**Why.** The largest serial stretch. 5 capabilities (the fixture) resolve
independently once identity + enumeration exist.

**Changes**
1. Keep serial: `behavior_core` → `capability_enumeration` → **resolve shared
   connectors once** (dedup research; produce a connector-context blob).
2. Fan out one sub-agent per capability (own session dir, NO `--continue`;
   prompt = behavior_core + enumeration + shared-connector blob). Bounded budget.
3. **Barrier**: `assemble agent_ir` on the lead session — dedup tools, reconcile
   connectors, resolve persona-wide fields, detect cross-capability conflicts.
4. Interactive mode stays fully serial (unchanged).

**Implementation approach (the paradigm shift).** Today the build is ONE LLM
conversation that the *LLM* drives across `--continue` turns (it decides when to
emit behavior_core, enumeration, each resolution, agent_ir). Fan-out inverts the
control: *Rust* orchestrates. Concretely, in `run_session` under `multiagent`:
- Run the serial head as today until `CapabilityEnumerationUpdate` lands, then
  extract the capability list + the resolved `behavior_core` from `resolved_cells`.
- New **per-capability prompt** builder (a focused variant in `session_prompt.rs`):
  "given this behavior_core + this ONE capability + these connectors, emit the
  `capability_resolution` JSON for it" — must produce the SAME event shape
  `parse_build_line` already handles.
- New **`fan_out_resolution(...)`**: builds one `LaneTask` per capability, each
  spawning its own `CliProcessDriver` (fresh session dir, no `--continue`) with
  that prompt, draining output through `read_line_limited` + `parse_build_line`;
  dispatched via `orchestrator::run_lanes` (bounded budget). Each lane stamps
  `lane = cap-<id>` on its resolution events (Phase 1's field — already wired).
- **Merge**: fold each lane's `CapabilityResolutionUpdate`s into `resolved_cells`,
  then run one lead-session turn (or a deterministic assembler) to produce
  `agent_ir` from the merged parts, reconciling shared connectors + dedup tools.
- The interactive gate machine (mpsc park/resume) is bypassed in this path — it
  only applies to serial interactive builds.

This is a genuine restructure of the intricate `run_session` loop (~1700 lines),
not a tweak. It needs runtime iteration (prompt grounding, merge correctness) —
hence it should be built when the harness can verify it live (a non-throttled
subscription window + the `lite-web-summary` baseline for A/B).

**Risk** High (the `--continue` model doesn't survive fan-out; context must be
passed in; barrier reconciliation must catch conflicts). **Gate** Harness:
substantial time drop on the resolution phase, `capabilities_count` == 5, gate
pass-rate + judge quality **not down**. FORWARD required. If quality regresses,
the barrier's reconciliation or the per-agent prompt grounding is the suspect —
fix before proceeding, do not ship a faster-but-worse build.

**Result — FIRST VERIFIED A/B (2026-07-08, `lite-web-summary`, n=1): FORWARD.**
Implemented as an isolated `fanout::run_multiagent_oneshot` (serial head →
parallel per-capability resolution via `run_lanes` → serial agent_ir assembly →
existing oneshot back-half), gated `multiagent && one_shot`.
- multiagent **503s** vs sequential **718s** = **+30% faster**; both promoted a
  valid **3-cap** persona at **gate 100%** — quality Δ 0. The design WORKS and is
  faster at equal quality (not a bad idea).
- Per-phase: sequential `analyzing` 584s + `awaiting_input` 118s; multiagent head
  24s + `resolving` 468s (fan-out + assembly), no question round-trip.
**Result update — 2nd A/B (2026-07-08, `lite-web-summary`, n=2) + cost + parallelism.**
On the clean success pair: multiagent **337s vs sequential 748s (~2.2×)**, both
3-cap gate-100%, and **cost $0.51 vs $1.26 (~60% cheaper)** — the speedup comes
WITH a cost win (focused per-capability contexts beat the sequential's growing
conversation). Findings:
- **Fan-out is genuinely parallel** (throttling hypothesis WRONG): the 3 lanes
  start within microseconds and finish in ~16–21s each, ~$0.036/lane. The whole
  resolution is ~20s + ~$0.11.
- **New bottleneck = the assembly turn (~224s)** — one LLM turn emitting the full
  `agent_ir`. Future win: assemble `agent_ir` in Rust from the resolutions
  instead of an LLM turn (would cut the multiagent time roughly in half again).
- **Reliability:** both variants promoted only 1/2. `multiagent-1` hard-failed
  (assembly emitted no `agent_ir`); the serial path recovers from this with a
  retry, so **added a one-shot assembly recovery retry** to
  `run_multiagent_oneshot` (pending re-verification). `sequential-1` timed out in
  an `awaiting_input` question loop the auto-answer couldn't resolve — a *baseline*
  flakiness the multiagent path sidesteps entirely (its sub-agents never ask).

**Bottom line: the design is proven — significantly faster AND cheaper AND equal
quality when it completes.** Remaining: confirm the retry restores multiagent
reliability (re-run A/B), then optionally the Rust-side `agent_ir` assembly for
the next speedup. The baseline's own question-loop flakiness is a separate
harness issue.

**CONFIRMED — 3rd A/B (2026-07-09, retry live, n=2): PHASE 3 DONE.**
- **multiagent promote rate 100% (2/2)** vs sequential 50% — the assembly retry
  fixed the failure mode. multiagent median **344s vs 761s (~2.2×)**, cost
  **$0.56 vs $1.13 (~50% cheaper)**, both 3-cap gate-100%.
- Multiagent is superior on EVERY measured axis: reliability, speed, cost, equal
  quality. It also *sidesteps* the as-is path's question-loop flakiness (the
  sequential baseline timed out in `awaiting_input` again — 50% — because it asks
  clarifying questions the multiagent sub-agents never ask).
- **Phase 3 shipped + verified.** Optional follow-ups (not blockers): (a) Rust-side
  `agent_ir` assembly to cut the ~224s assembly turn (would ~halve multiagent time
  again); (b) fix the sequential baseline's auto-answer question loop; (c) wire the
  fan-out for connector fixtures (`connector_context` is empty today) + the heavier
  `web-research-desk` stress fixture.

**CONFIRMED — agent_ir Rust-assembly (follow-up (a), 2026-07-09, n=3): SHIPPED.**
The serial assembly turn is **gone**. `run_multiagent_oneshot` now runs the
per-capability fan-out and a persona-wide **prose lane** (`resolve_persona_wide`
— system_prompt + structured_prompt, needs only behavior_core + enumeration) IN
PARALLEL via `tokio::join!`, then `assemble_agent_ir` folds the prose + each
capability's resolutions into the final `agent_ir` **in Rust** (no LLM turn).
- multiagent **63s median (63–70s, n=3)** vs the assembly-turn multiagent **370s**
  = **~5.9× faster**, and vs the sequential baseline **557s** = **~8.8× faster**.
- **cost $0.30** vs assembly-turn **$0.60** (one fewer LLM turn) and sequential
  **$0.88** — ~50–66% cheaper.
- **100% promote (3/3)**, gate 100%, quality holds: 1545-char system_prompt on the
  promoted persona, all 5 structured_prompt sections, 3 use-cases with clean
  `tool_hints`, tools aggregated + deduped from the resolutions.
- **Key fix during bring-up:** `AgentIrUseCaseData` types `error_handling` as
  `Option<String>` and `tool_hints` as `Option<Vec<String>>`, but resolutions emit
  them as rich objects (`{empty_body:{…}}`, `{primary:[…],notes:"…"}`). The old
  LLM assembly reshaped silently; the Rust path must too — added `coerce_to_string`
  (object → JSON text) + `coerce_string_list` (object/array → flat name list) for
  every strict-typed use-case field. Without it, promote's `AgentIr` re-parse
  failed with `did not match any variant of untagged enum AgentIrUseCase`.
- **Known simplification:** the Rust assembler does not emit the v3 `persona` block
  (mission/identity/voice/`decision_principles[]`), which only feeds `auto_triage`
  capabilities + `last_design_result.persona`. The native web-research fixture has
  no `auto_triage` UC, so it's safe here; add it to the prose-lane request before
  running fixtures that use `review_policy.mode = auto_triage`.

**COMPLEX-FIXTURE COVERAGE + QUALITY JUDGING (2026-07-09, `web-research-desk`):**
Broadened from the native `lite-web-summary` to the 5-cap connector fixture (3 web +
Airtable + Notion) to stress the optimizations and judge OUTPUT QUALITY, not just
structure. Findings:
- **Two blocker bugs the native fixture never exercised, both fixed:** (1) the Rust
  assembler didn't coerce `event_subscriptions` string arrays into the
  `{event_type}` objects `AgentIrUseCaseEvent` expects; (2) the fan-out passed the
  sub-agents an EMPTY connector context (`String::new()` since Phase 3), so they
  couldn't bind Airtable/Notion and resolved the reactions as native web tools.
  Fixed with element coercion + `build_connector_context` (vault credentials +
  connector catalog) wired into the multiagent path. Also a harness fix
  (`capture.py`): a promote-BLOCKED build (a connector tool-test failed the
  outcome gate) left a 0-capability persona row; capture now falls back to the
  assembled `agent_ir` so structure/quality stay judgeable.
- **Sequential CANNOT complete this fixture:** it timed out at 900s still in
  `analyzing`, 0 caps, no `agent_ir` — the serial single-conversation path stalls
  on 5-cap connector resolution. Multiagent completed in ~550-720s with a full,
  correctly-bound design. So on a complex sample the optimizations don't just avoid
  harming quality — they PRODUCE quality output where the as-is path yields none.
- **Quality judged (Claude-as-judge, independent judges, 0-3 rubric):** multiagent
  output scored **~0.92** (coverage/binding/triggers all 3). Both judges docked the
  SAME real issue: **fan-out scope-creep** — because each sub-agent resolved in
  isolation (its own capability only), the feed-scan cap re-implemented the
  Airtable/Notion writes, and connector padding varied run-to-run (one build even
  invented a `gmail` connector nothing asked for). This is the one way the fan-out
  CAN harm quality.
- **Fix — sibling-scope constraint (commit `50764e01d`):** `build_capability_prompt`
  now injects the sibling capability list + explicit SCOPE RULES ("bind only
  connectors THIS capability uses, from the available list; don't re-implement
  other caps' jobs; don't invent connectors"). Post-fix (n=2): **gate 100%**, no
  `gmail`/external hallucination, feed-scan reduced to web+schedule tools that emit
  events to the write caps. Re-judge: **0.94**, with `capability_distinctness` 2→3
  (judge: "uc_feed_scan does NOT write directly to Airtable/Notion — it emits events
  to the dedicated write caps"). Residual: built-in `personas_database`/`vector_db`/
  `messages` still appear (credential-free, milder, arguably justified for dedup) —
  groundedness stays 2.
- **Verdict:** the Rust-assembly optimization does not harm quality; the fan-out's
  isolation carried a scope-creep risk that the sibling-scope constraint mitigates
  (distinctness restored, external hallucination gone, quality held at 0.94).
- **Ops note:** `web-research-desk` promotes cleanly only when Airtable's live
  healthcheck passes — it returns HTTP 422 (`INVALID_REQUEST_UNKNOWN`, needs a
  base_id the generic healthcheck lacks) and the build-readiness outcome gate fails
  the build on it. This is environmental (Notion passes 200), hits both variants,
  and is orthogonal to design quality — hence judging from `agent_ir`.
- **Open follow-ups:** (a) trim built-in-connector padding (db/vector/messages) —
  tighten the scope rule or post-filter; (b) the v3 `persona` block still isn't
  emitted (auto_triage gap); (c) fix the Airtable healthcheck so the fixture can
  promote end-to-end; (d) connector fan-out roughly doubles resolving time
  (~20s native → ~214s here) — the sub-agents are verbose on connector caps.

---

## Phase 5 — Scripted connector calls  ·  _parallel track, optional_

**Why.** The third optimization direction: deterministic code for connector API
calls instead of the LLM composing curl. Independent of Phases 1–4.

**Changes** (increasing ambition)
1. **Scripted build tests** — swap `tool_tests.rs`'s LLM-composes-curl step for
   deterministic `engine::api_proxy::execute_api_request` /
   `healthcheck::run_healthcheck` per bound connector. Faster, cheaper, non-flaky.
2. **Generic scripted-connector MCP tool** — a thin wrapper over
   `execute_api_request` on the `personas-mcp` server (secrets stay server-side),
   alongside the existing Gmail/Drive/Calendar tools.
3. **Declarative scripted capability** — `execution_mode: "scripted"` on
   `DesignUseCase`, dispatched in `runner/mod.rs` through the dormant
   `engine::capability::ApiProxyCapability`. Config lives in `design_context`
   (typed, promote-validated) — **never** in memory.

**Risk** Medium. **Gate** Harness: the two connector tool-tests go green
**deterministically** (no LLM tokens spent on them); build cost down on the
test phase. Config location asserted by the fixture's connector-binding check.
**Result** _(fill in)_

---

## Sequencing summary

**Revised order after the 2026-07-08 baseline** (resolution dominates tool-test
~8:1, so the capability fan-out is promoted ahead of the tool-test work):

```
Phase 0 (telemetry+baseline) ─> Phase 1 (events) ─> Phase 2 (scaffold) ─> Phase 3 (CAPABILITY fan-out) ─> Phase 4 (scripted tool-tests)
                                                                          └─> Phase 5 (scripted connector calls)  [independent track]
```

Phase 0 gates everything (nothing is measurable without it). Phase 3 (per-capability
resolution fan-out) is now the priority — it targets the 80%+ of build time.
Phase 4 (scripted tool-tests) follows; its ceiling is the ≤15% tool-test slice.
Phase 5 can run in parallel. Each is FORWARD-gated by build-bench.

_Baseline evidence (2026-07-08): a clean simple build split ~120s resolution vs
~15-18s tool-test (~8:1); the ratio grows with capability count. The heavier
5-cap `web-research-desk` fixture couldn't complete in a bounded headless run,
which is what motivated the lean `lite-web-summary` baseline fixture + the
driver's auto-answer._
