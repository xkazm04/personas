# Moonshots — Factory & Projects

## 1. The Overnight Portfolio Operator — close the full autonomy loop across every project

- **Tier**: 1 (10x category-defining)
- **Category**: automation
- **Impact**: A solo builder goes to sleep and wakes to a portfolio where every off-track KPI, failing ship criterion, and un-adopted workspace practice across all 15+ repos was measured, worked, re-measured, and summarized in one morning briefing — the Factory stops being a cockpit you fly and becomes an operator you supervise.
- **Feasibility**: medium (every segment of the loop already exists in isolation; the moonshot is the connective tissue, governor, and closure)
- **Time-horizon**: months
- **Why it's a moonshot**: This is explicitly a "finish and amplify" moonshot — the steering circle is 80% built but never runs as one circle. `kpi_derivation.rs` already turns an off-track KPI into a headless-Claude-decided goal; `goal_advance.rs` already turns a goal into a running team assignment; `autopilot.ts` already defines a `full` mode; the ship tab already dispatches criterion-specific Fleet briefs; the workspace knowledge center already maintains a `to_process` adoption queue "an executor drains" — but no executor exists, results never flow back into measurements automatically, and nothing coordinates these loops *across* projects under a spend/safety budget. Wiring them into one governed nightly cycle changes what Personas *is*: from a dashboard about your projects to the entity that runs them. That is the 10x leverage multiplier the owner's whole multi-repo workflow (pumper, lighttrack, gwn, brainiac…) is starving for.
- **What exists today**:
  - KPI → goal derivation with off-track math, freshness gates, cooldowns: `src-tauri/src/engine/kpi_derivation.rs`
  - Goal → running team assignment (hybrid to-do/LLM decomposition, double-spawn guard): `src-tauri/src/engine/goal_advance.rs`
  - Per-project autopilot switch off/measure/suggest/full: `src/api/devTools/autopilot.ts`, `src-tauri/src/engine/autopilot.rs`
  - KPI evaluator + connector binding: `src-tauri/src/engine/kpi_eval.rs`, `kpi_binding.rs`
  - Ship criterion → Fleet dispatch briefs (consent-gated): `src/features/teams/sub_factory/l2/ship/ShipDispatch.tsx`
  - Workspace practice ladder with actionable `to_process` adoption cells: `src/api/devTools/workspaces.ts`, `src-tauri/src/db/repos/dev_workspaces.rs`
  - Hourly per-project pulse consolidator + push accelerator: `src-tauri/src/engine/project_tracking/` (mod.rs, consolidator.rs, push.rs)
  - Portfolio-at-a-glance canvas ready to host the briefing: `src/features/teams/sub_mastermind/lib/deriveScene.ts`, `DataHealthBar.tsx`
- **Path to implementation**:
  1. Build the **workspace adoption executor** now: a scheduler tick that drains `to_process` cells by generating a practice-adoption brief (same pattern as `buildCriterionPrompt` in ShipDispatch.tsx) and dispatching it through the existing Fleet dev-runner machinery, marking the cell `dispatched`. This is pure recombination of shipped parts — doable this week.
  2. Add a **portfolio governor** in the engine: a nightly window (configurable) that walks all projects with autopilot `full`, runs `kpi_eval` first, then derivation → advance, then ship-criterion and adoption dispatches, under hard caps (max concurrent sessions, max LLM spend per night, per-project quota) with a kill switch.
  3. Close the loop: on assignment/session terminal state, trigger re-measurement of the linked KPI (extend the existing post-completion cooldown rule in `kpi_derivation.rs` from "wait" to "schedule re-eval") and push a pulse consolidation via the existing `push.rs` accelerator.
  4. Build the **Morning Briefing**: a generated per-night digest (what ran, what moved, what's blocked, what needs a human decision) surfaced as a Mastermind overlay and fed to the Athena companion via the pulse channel.
  5. Graduate `suggest` mode into a review inbox: overnight the governor stages everything it *would* do; one keystroke per item approves. This becomes the trust ramp toward `full`.
  6. Add per-loop provenance (which measurement caused which goal caused which session caused which diff) so every autonomous action is auditable from the KPI console.
- **Dependencies**: Fleet/Dev-runner session infra, headless Claude CLI (already used by derivation/pulse), team orchestration engine, local management API (:9420) for result write-back, LLM spend tracking (already surfaced in Mastermind sceneStore).
- **Risks**: (1) Unattended agents burning money or making low-quality commits overnight — mitigated by budgets, branch-only writes, and the suggest-mode trust ramp, but the failure mode is real. (2) Loop instability: a derived goal that "completes" without moving the needle can oscillate; the cooldown rules help but portfolio-scale needs backoff and a per-KPI attempt ceiling. (3) The governor becomes a second scheduler competing with existing triggers/scheduler subsystems — needs one shared session-slot arbiter or they will collide.
- **What changes if we ship it**: The owner's role inverts from dispatcher to reviewer — every morning starts with a briefing of work already done across the whole portfolio, and the Factory's KPI console becomes the steering wheel of an actually self-driving system rather than instrumentation on a manual one.

## 2. The Crew Foundry — every repo births and evolves its own bespoke agent team

- **Tier**: 2 (3-5x, with Tier-1 upside if compounding works)
- **Category**: intelligence
- **Impact**: Instead of generic Fleet dev-runners, each dev project gets a purpose-synthesized persona crew — grounded in that repo's context map, pulse, passport gaps, and KPI history — whose members' prompts and recipes compound with every assignment outcome, so project N's crew starts smarter than project 1's did.
- **Feasibility**: medium
- **Time-horizon**: quarters (first crew in weeks)
- **Why it's a moonshot**: The group contains two worlds that never touch: the Design & Build Studio (team synthesis, build sessions, template generation, presets) manufactures agent teams from *natural-language briefs*, while the Factory employs teams against goals but treats the workforce as given. The bridge is the bet: use the richest brief that exists — the project itself (pulse narrative + tensions, context map, passport dimension scores, KPI shortfalls, workspace practices) — as the synthesis input, and use assignment outcomes as the training signal. `goal_advance.rs` already proves teams of personas can do real repo work ("Dev Clone opens real PRs"); `team_synthesis.rs` already turns a 2000-char brief into a wired team; `template_feedback` and `recipe_suggestions` tables already exist to store outcome-derived improvements. Nobody in the agent-tooling category has "your repo's telemetry designs and continuously re-tunes its own agent staff" — that is a category-defining differentiator, and it makes Moonshot 1's workforce specialized instead of generic.
- **What exists today**:
  - Team synthesis from a text brief (Sonnet, selects templates + roles + connections): `src-tauri/src/commands/design/team_synthesis.rs`
  - Guided build sessions + simulation for persona assembly: `src-tauri/src/commands/design/build_sessions.rs`, `build_simulate.rs`; state machine in `src-tauri/core/src/models/build_session.rs`
  - Persona capability analysis + team presets: `src-tauri/src/commands/design/analysis.rs`, `team_presets.rs`
  - The project-as-brief raw material: pulse (`src-tauri/src/engine/project_tracking/pulse.rs`), passport readiness (`src/features/teams/sub_factory/passport/passportDerive.ts`), improve-plan findings (`src/features/teams/sub_factory/passport/improve/improvePlan.ts`), KPI state (`src/api/devTools/kpis.ts`)
  - Teams employed against project goals with signals flowing back: `src-tauri/src/engine/goal_advance.rs`, `dev_goal_signals`
  - Outcome-feedback storage waiting to be used: `src-tauri/core/src/models/template_feedback.rs`, `recipe_suggestion.rs`
- **Path to implementation**:
  1. Build a **project brief compiler** now: a pure function that renders pulse + context map + passport gaps + off-track KPIs into a synthesis brief, and feed it through the existing `synthesize_team` command behind a "Forge this project's crew" button on the Factory L2 Overview tab. Ships in days on current scaffold.
  2. Add project-scoped roles to the synthesis prompt (e.g. a Reliability persona anchored to the contexts with Sentry heat, a Docs persona anchored to the passport's weakest dimension) so the crew maps to the project's actual deficits, not generic dev roles.
  3. Wire the crew in as the default team for `advance_goal` on that project, replacing the generic team pick.
  4. Build the **retune loop**: after each completed assignment, a headless pass reviews the outcome (steps completed, review verdicts, goal re-measurement) and writes prompt/recipe deltas as `recipe_suggestions` / persona prompt proposals — human-approved at first, exactly like the workspace knowledge ladder (agents propose, humans adopt).
  5. Cross-pollinate: promote crew-member improvements that recur across projects into workspace-level team presets (`template_presets`), so every new repo onboarded gets the current best crew as its starting point.
  6. Surface crew fitness in the Factory: per-persona assignment success rate next to the KPI matrix, closing the visibility loop.
- **Dependencies**: team orchestration + assignment engine, headless Claude for synthesis/retune passes, credential vault for crew connector bindings, workspace knowledge ladder for the approval pattern.
- **Risks**: (1) Outcome attribution is noisy — a failed assignment may reflect a bad goal, not a bad persona, so naive retuning could degrade prompts; needs conservative, human-gated deltas initially. (2) Crew sprawl: 15 projects × 5 personas = 75 personas to govern; requires archival/dedup policy or it collapses under its own weight. (3) The synthesis quality ceiling — if project-grounded crews don't measurably beat a single generic dev-runner on assignment success, the whole bet reduces to theater; instrument step 6 first so this is falsifiable early.
- **What changes if we ship it**: The Studio stops being a place you visit to hand-craft personas and becomes the Factory's own HR department — repos staff themselves, and the workforce gets collectively smarter with every goal it works.
