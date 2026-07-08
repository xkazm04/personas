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

## Phase 3 — Fan-out #2: parallel tool tests  ·  _first real parallelism_

**Why.** Tool tests are independent by construction and run late (one-shot
`run_tool_tests`), so this is the cheapest, safest win and a clean measurement of
the scheduler under load.

**Changes**
1. In one-shot post-draft, dispatch each tool/connector test as its own bounded
   sub-agent through the scheduler instead of the current sequential loop.
2. Each test gets its own session dir; results reaped into the same aggregate
   report shape (`last_test_report`).

**Risk** Medium (concurrent CLIs; rate limits). **Gate** Harness: `multiagent`
build time **down** vs baseline (the tool-test phase shrinks), gate pass-rate +
Airtable/Notion tool-test outcomes **unchanged**. FORWARD required.
**Result** _(fill in)_

---

## Phase 4 — Fan-out #1: parallel per-capability resolution  ·  _the big lift_

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

**Risk** High (the `--continue` model doesn't survive fan-out; context must be
passed in; barrier reconciliation must catch conflicts). **Gate** Harness:
substantial time drop on the resolution phase, `capabilities_count` == 5, gate
pass-rate + judge quality **not down**. FORWARD required. If quality regresses,
the barrier's reconciliation or the per-agent prompt grounding is the suspect —
fix before proceeding, do not ship a faster-but-worse build.
**Result** _(fill in)_

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

```
Phase 0 (telemetry+baseline) ─┬─> Phase 1 (events) ─> Phase 2 (scaffold) ─> Phase 3 (tool-test fan-out) ─> Phase 4 (capability fan-out)
                              └─> Phase 5 (scripted connector calls)  [independent track]
```

Phase 0 gates everything (nothing is measurable without it). Phases 1→4 are the
orchestration spine, each FORWARD-gated by build-bench. Phase 5 can run in
parallel and is itself measured by the connector tool-test outcome + cost.
