# Moonshots — Overview Observability

## 1. The Autonomous NOC — close the observe→decide→act loop so the fleet runs itself

- **Tier**: 1 (10x category-defining)
- **Category**: automation
- **Impact**: The Overview stops being 30+ dashboards the operator must read and becomes an autonomous operations agent that detects, root-causes, remediates, and verifies incidents end-to-end — the human only reviews the audit trail and the rare high-blast-radius consult.
- **Feasibility**: medium-high — every stage of the loop already exists as an island; the moonshot is wiring, policy, and one new orchestration layer, not new science.
- **Time-horizon**: months

- **Why it's a moonshot**: Today the observability layer is a magnificent read-only organ: alerts evaluate client-side every 60s and emit *toasts* (`useGlobalAlertEvaluator.ts` — they don't even fire when the app is closed); incidents sit in an inbox waiting for a human `acknowledge/resolve` click (`useIncidentActions.ts`); healing *analyzes* and records effectiveness but the loop back to action is manual. Meanwhile, three files away, Athena already has a production-hardened autonomous-action machine: `approval_autopilot.rs` has a curated auto-approve allowlist, boldness×class×confidence gating, `fleet_intervene` with a one-intervention-per-session structural cap, and `fleet_wake`/`fleet_resume` for session recovery. Nobody has connected the sensor organ to the motor organ. Doing so changes what Personas *is*: from "an app where you run agents and watch dashboards" to "a self-operating agent fleet with a human governance layer" — which is exactly the category (autonomous ops / agentic SRE) that doesn't exist yet as a desktop product. It also directly amplifies two of the 12 journeys: *Execution Observability* and *Self-Healing Recovery*, fusing them into one.

- **What exists today**:
  - Detection: `src/features/overview/sub_observability/libs/useGlobalAlertEvaluator.ts` (frontend-only alert loop), `src/api/overview/observability.ts` (`get_overview_bundle`, anomaly drilldown), `src-tauri/src/commands/communication/sla.rs` + `src/features/overview/sub_sla/` (SLA breach evaluation).
  - Incident lifecycle: `src/api/overview/incidents.ts` + `src/features/overview/sub_incidents/` (taxonomy, inbox, acknowledge/resolve/dismiss/reopen).
  - Diagnosis: `src-tauri/engine/src/dream_replay.rs` (token-free frame-by-frame state reconstruction), `src-tauri/src/engine/knowledge.rs` (failure-pattern knowledge graph), `run_healing_analysis` + retry chains + `get_healing_effectiveness` (`src/api/overview/healing.ts`).
  - Action + governance: `src-tauri/src/commands/companion/approvals/approval_autopilot.rs` (allowlist + confidence gates), `approval_exec_core/dev/fleet.rs` (specialist executors), `src-tauri/src/commands/fleet/` (dispatch, intervene, wake, resume).
  - Athena's self-audit: `src-tauri/src/commands/companion/observability.rs` (turn ledger, proactive economy, job health).

- **Path to implementation**:
  1. **Move alert evaluation server-side** (doable now): port `useGlobalAlertEvaluator`'s rule loop into a Rust background task next to the SLA evaluator so alerts fire even with the UI closed, and emit a `PersonaEvent` + notification instead of only a toast.
  2. **Alert/SLA-breach → incident auto-open**: a fired alert or SLA violation creates an `audit_incidents` row via the existing incident taxonomy, deduped by chain_id/persona — the inbox becomes the single queue of "things wrong".
  3. **Auto-diagnosis pass**: on incident open, run `run_healing_analysis` + a dream-replay frame scan + an `execution_knowledge` lookup (has this failure pattern been seen and what fixed it?) and attach a root-cause summary to the incident — the same shape `AthenaVerdictCard` already renders for backlog items.
  4. **Remediation as companion approvals**: the diagnosis emits a proposed action (`retry_execution`, `pause_schedule`, `rotate_credential_probe`, `fleet_intervene`, `apply_healing_action`, `adjust_alert_threshold`) as a pending approval; extend `AUTOAPPROVE_ALLOWLIST` with the reversible subset (retry, probe, un-pause) under the existing confidence gate.
  5. **Verify + learn**: after remediation, re-evaluate the triggering rule; success/failure lands in the healing-effectiveness ledger and upserts into `execution_knowledge`, so the NOC's auto-approve confidence is earned per failure-pattern, not global.
  6. **Ops narrative surface**: the incidents inbox grows a "handled autonomously" lane and the status page (`useStatusPageData.ts`) reports MTTR-with/without-human — the proof metric of the whole moonshot.

- **Dependencies**: companion approvals + autopilot (internal), healing engine + effectiveness ledger (internal), event-bus/notifications (internal), fleet commands (internal). No new external services; LLM calls only for the diagnosis summary step.

- **Risks**: (1) Remediation loops — an auto-retry that re-triggers the alert must be capped by the same operative-memory pattern as `fleet_intervene` (N actions per incident, then escalate to human). (2) Confidence miscalibration: auto-acting on a mis-diagnosed root cause is worse than a toast; start with the allowlist tiny and let the effectiveness ledger expand it. (3) Alert-rule quality becomes load-bearing — bad user-authored rules now cause actions, not just noise; needs a rule "dry-run" mode first.

- **What changes if we ship it**: The owner stops babysitting dashboards across 15+ projects; the fleet detects, fixes, and documents its own failures overnight and presents a morning digest of "what I handled, what needs you". Personas becomes the first desktop product where autonomous agents are also autonomously *operated*.

## 2. The Flight Simulator — counterfactual replay that turns every incident into an executable regression test

- **Tier**: 1 (10x category-defining)
- **Category**: intelligence / trust
- **Impact**: Any past run becomes forkable — restore the exact git checkpoint at any dream-frame, mutate one variable (prompt, model, context, tool policy), re-execute only from that point, and diff outcomes — converting the incident archive from a graveyard into a growing corpus of replayable simulations that certifies every persona change before it ships.
- **Feasibility**: medium — the two hard primitives (deterministic frame reconstruction, per-stage git checkpoints) already exist and were designed for exactly this; the missing piece is the fork-execute-diff harness.
- **Time-horizon**: months–quarters

- **Why it's a moonshot**: `git_checkpoint.rs` literally names the destination in its doc comment — fabro's "rollback and fork-a-new-attempt-from-here" — but only the checkpoint half was ported; nothing forks. `dream_replay.rs` reconstructs complete state (active spans, cumulative cost, error, metadata) at every span boundary but is strictly read-only. Marrying them creates something no agent platform has: **counterfactual debugging of real production failures at near-zero cost** — replay frames 0..N for free from the trace, restore the workspace to the frame-N checkpoint, then spend tokens only on the divergent tail. That converts the deepest pain of agent ops ("it failed, I tweaked the prompt, I *hope* it's fixed") into an empirical discipline: a fix isn't done until the original failing trace, re-run under the change, passes. And because every certified incident stays in the corpus, persona edits get validated against the persona's *own crash history* — a data moat that compounds with every failure and is unique to each operator's fleet.

- **What exists today**:
  - `src-tauri/engine/src/dream_replay.rs` — `build_dream_replay()` producing `DreamFrame`s with full state, error, and metadata per span boundary.
  - `src-tauri/engine/src/git_checkpoint.rs` — `checkpoint_stage()` commits per stage on `personas/run/<run_id>` with run-id/stage trailers; branch machinery for forks is already there.
  - `src-tauri/engine/src/context_fidelity.rs` — graded upstream-context injection, the natural knob for "replay with degraded/altered context".
  - `src/features/overview/ExecutionDetailModal/` (`provenance.ts`, `outputParser.ts`) — lineage resolution (persona, template, chain) and structured output diffing raw material.
  - `src/features/overview/sub_observability/components/SystemTraceViewer.tsx` — the span-tree UI where the "fork from this frame" affordance belongs.
  - A/B prompt test results already flow through `get_overview_bundle` (`src/api/overview/observability.ts`) — the comparison-rendering pattern to reuse.
  - `src/features/agents/sub_health/` assertions (`run_health_check`) — the pass/fail oracle for certification.

- **Path to implementation**:
  1. **Fork primitive** (doable now): add `fork_from_checkpoint(run_id, stage)` to `git_checkpoint.rs` — `git checkout -B personas/run/<new_id> <stage_sha>` — plus a SQLite row linking child run → parent run + frame index.
  2. **Replay-execute hybrid in the engine**: a run mode that hydrates state from `DreamFrame[0..N]` (conversation so far, tool results from stored span metadata, cumulative budget) and hands control to the live executor from frame N with an override set {model, prompt delta, context-fidelity grade, injected memory}.
  3. **Diff report**: reuse `outputParser.ts` sections + span-tree comparison to render original-vs-fork: outcome, cost delta, token delta, assertion results, first divergent span.
  4. **UI**: "Fork from here" button on `SystemTraceViewer` frames and on `IncidentDetailModal` (the incident's failing frame is pre-selected).
  5. **Certification corpus**: a resolved incident can be "pinned as simulation"; persona save/deploy optionally re-runs pinned simulations (assertion oracle from `run_health_check`) and blocks/warns on regression — wired into the health tab score.
  6. **Compound with Moonshot 1**: the Autonomous NOC proves its own remediations in the simulator before proposing them — the two moonshots interlock without depending on each other.

- **Dependencies**: execution-core engine (run-mode change — the one invasive piece), git binary in agent workspaces (already required), trace storage completeness (`is_incomplete` traces limit fork points), health assertions for oracles. No external services.

- **Risks**: (1) Determinism boundary — tool calls against live external systems can't be replayed faithfully; needs a record/stub policy per tool (replay stored result vs. re-execute) and honest "divergence possible" labeling. (2) Checkpoint coverage — only dev-tools-plugin runs get git checkpoints today; pure-API runs need a lighter state snapshot (conversation + memory), or the feature ships dev-runs-first. (3) Corpus rot — old simulations referencing deleted personas/credentials need a validity sweep or they become noise.

- **What changes if we ship it**: "Did my fix work?" becomes a button, not a vigil. Every incident permanently raises the floor: personas are continuously regression-tested against their own real-world failure history, and prompt/model changes ship with empirical proof instead of hope.
