# Moonshots — Team Collaboration

## 1. The Self-Evolving Team: assignments that end in a retrospective and teams that rewire themselves
- **Tier**: 1 (10x category-defining)
- **Category**: intelligence
- **Impact**: Every team assignment makes the team measurably better at the next one — matching accuracy, topology, and roster quality compound automatically instead of staying flat.
- **Feasibility**: high
- **Time-horizon**: months
- **Why it's a moonshot**: Today the collaboration layer has every organ of a learning organism but no nervous system connecting them: the orchestrator records step outcomes and match confidence, deliberations can run autonomously to a budget, team memories persist across runs with per-run diffs, and an optimizer/topology-heuristic pair can analyze pipelines — yet none of these feed each other. The moonshot closes the loop: when an assignment terminates, the system *automatically* convenes a retrospective deliberation among the team, distills its resolution into structured team memories, adjusts each member's trust score from actual step outcomes vs. match confidence, and proposes (or, above a trust threshold, applies) topology rewires and roster changes. Teams stop being static org charts and become organisms that hire, fire, and reorganize themselves. No agent product on the market has teams whose *composition itself* is a learned artifact.
- **What exists today**:
  - `src-tauri/src/engine/team_assignment_orchestrator.rs` — full step lifecycle with per-step events, failure classification, and an explicit "Phase C will add the companion bridge" hook in `OrchestratorDeps`.
  - `src-tauri/src/engine/team_assignment_matching.rs` — three matching strategies that already produce `confidence` + `rationale` per step, and read `trust_score` (currently never updated from outcomes).
  - `src/features/teams/sub_deliberations/useTeamDeliberations.ts` + `src-tauri/src/commands/teams/deliberations.rs` — autonomous moderator with run-to-budget loop, tracks, escalations, cost budgets.
  - `src-tauri/src/commands/teams/team_memories.rs` + `src/features/teams/sub_teamMemory/libs/useRunDiffSummaries.ts` — per-run team memory with importance ratings and run-over-run diffing.
  - `src-tauri/engine/src/optimizer.rs` + `topology_heuristic.rs` — pipeline analysis that today only renders advice in `OptimizerPanel.tsx`.
  - `src/features/teams/sub_teamWorkspace/teamStudio/AssignmentReplay.tsx` — replay surface where the "what changed and why" story can be shown.
- **Path to implementation**:
  1. Post-assignment hook in `team_assignment_orchestrator.rs`: on terminal status, write a structured `assignment_outcome` record (per-step: matched persona, strategy, confidence, duration, result, review interventions) — the raw learning signal. Doable now; the event plumbing already exists.
  2. Trust-score feedback: a small updater that moves `trust_score` per persona from outcome vs. confidence (Brier-style), so `matching.rs` immediately gets sharper with zero new UI.
  3. Auto-retrospective: on completion, create a `team_deliberation` seeded with the outcome record and an agenda of failed/reviewed steps; run it to a small fixed budget via the existing moderator tick.
  4. Distillation: resolution turns write `team_memories` entries tagged `lesson` with importance, and matching's LLM prompt gains a "team lessons" section retrieved from those memories.
  5. Rewire proposals: feed outcome history into `optimizer.rs`; emit concrete `PersonaTeamConnection`/roster change proposals surfaced in Team Studio with one-click apply (reusing `team_handoff.rs` re-wiring, which is already idempotent).
  6. Autonomy dial: above N consecutive good retrospectives, let the team apply low-risk rewires itself, logged to the channel feed.
- **Dependencies**: deliberation moderator, team_memories repo, matching/embedding manager (`ml` feature), event registry; one Sonnet-class call per retrospective (budget-capped by existing deliberation cost budgets).
- **Risks**: (1) Retrospective LLM spend per assignment — must be budget-capped and skippable for trivial runs. (2) Trust-score feedback loops can death-spiral a persona off the roster from a few unlucky runs — needs decay/floor. (3) Auto-applied rewires touching `team_handoff` triggers could break live chains — proposals must dry-run through the existing debugger path first.
- **What changes if we ship it**: A team's 20th assignment is dramatically better than its 1st without the owner touching anything — and the Team Studio shows *why* (lessons, trust deltas, rewires) as a legible evolution history. Team quality becomes a compounding asset, not a configuration.

## 2. Teams as an Addressable Workforce: dispatch a team assignment from anywhere (MCP, CLI, CI, other apps)
- **Tier**: 1 (10x category-defining)
- **Category**: platform
- **Impact**: Every team becomes a callable service — any Claude Code session, CI job, or external LLM host can hand a task to a Personas team and get streamed step progress and a reviewed result, turning one desktop app into the agent-workforce backend for the owner's entire fleet of projects.
- **Feasibility**: medium
- **Time-horizon**: months
- **Why it's a moonshot**: Personas already exposes *individual personas* via MCP (the External Protocol Integration journey), and the orchestrator is fully event-driven — Tauri commands return immediately and progress flows over `TEAM_ASSIGNMENT_PROGRESS`. But the highest-value unit — a whole team with matching, parallel steps, review gates, deliberations, and shared memory — is trapped behind the app's own UI. Exposing `run_team_assignment` as an external protocol surface changes what the product *is*: from "an app where I build agent teams" to "the place where my agent workforce lives, addressable from every terminal, repo, and pipeline I own." The owner runs a dozen active codebases; today each Vibeman/Claude session re-improvises orchestration. With this, a session says "dispatch this to the SDLC team" and gets back a reviewed, multi-agent result with full observability in the app. That's leverage multiplication across every project, and a genuine category: teams-as-a-service on your own machine.
- **What exists today**:
  - `src-tauri/src/engine/team_assignment_orchestrator.rs` — non-blocking `run_assignment` with single-flight guard, review gates, and progress events: exactly the shape an async external API needs.
  - `src/api/pipeline/assignments.ts` + `src/api/pipeline/teams.ts` — the full IPC contract (create assignment, steps, templates, step reviews) to mirror externally.
  - `src/api/pipeline/teamChannel.ts` — keyset-paginated unified feed of step events/messages/memories/deliberation turns: a ready-made polling/streaming surface for external clients.
  - The existing MCP server surface (mcp-protocol context) that already exposes persona tools to external LLM hosts — the transport and auth pattern to extend.
  - `src-tauri/engine/src/team_handoff.rs` + trigger system — external webhook triggers already exist for single personas; the same bus can carry team dispatch.
- **Path to implementation**:
  1. Define a `TeamDispatch` envelope (team slug, task description, input payload, budget, review policy: auto / hold-for-human) and add a `dispatch_team_assignment` command that composes steps via the existing template/LLM decomposition path — pure recombination of current commands, doable now.
  2. Expose it as an MCP tool per team (`team.<slug>.dispatch`, `team.<slug>.status`, `team.<slug>.result`) on the existing MCP endpoint, with the channel feed backing `status`.
  3. Add `review_policy: auto` so headless callers aren't stranded on `awaiting_review` — auto-resolve via the `llm_eval` matcher path, escalating to the human review modal only above a risk threshold (the review resolution helpers already exist).
  4. Ship a tiny `personas` CLI / stdin-MCP shim so any repo or CI job can `personas dispatch sdlc "fix issue #42"` against the running app.
  5. Feed dispatches into the Overview/incidents surface so external load is observable and budget-governed like internal runs.
  6. Later: fleet-aware routing — dispatches carry a project path, and team memories partition per project, making one team serve many repos with per-repo context.
- **Dependencies**: MCP server module, ipc_auth (`require_auth_sync` needs a token story for external callers), trigger/event bus, assignment templates; no new external services.
- **Risks**: (1) Security — an externally addressable workforce with connector credentials needs scoped tokens and per-team allowlists, not just local auth. (2) Headless review auto-resolution can silently ship bad step outcomes; the risk threshold must be conservative and every auto-resolution logged to the channel. (3) The desktop app becomes load-bearing infrastructure — needs the app (or a headless mode) running to serve dispatches.
- **What changes if we ship it**: The owner's teams stop being something you visit and become something you *call* — every project, script, and AI session in the fleet can hire a governed multi-agent team with one line, while all execution, cost, and review stays observable in one cockpit.
