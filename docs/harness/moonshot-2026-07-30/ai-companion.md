# Moonshots — AI Companion

## 1. Brain-as-a-Primitive: every persona gets Athena's memory architecture

- **Tier**: 1 (10x category-defining)
- **Category**: platform
- **Impact**: Turns Personas from a stateless agent runner into the only desktop platform where every agent genuinely *learns* — episodic/semantic/procedural memory, provenance-cited facts, and consolidation become a reusable substrate any persona (and any fleet worker) mounts, compounding value with every execution.
- **Feasibility**: medium
- **Time-horizon**: quarters
- **Why it's a moonshot**: The single most sophisticated subsystem in the entire app — the five-tier brain (episodic append-only markdown, semantic facts with an anti-hallucination provenance contract, procedural rules, goals/backlog, doctrine) plus hybrid vec0+FTS retrieval and human-reviewed consolidation — is hardcoded to exactly one consumer: Athena (`DEFAULT_SESSION_ID = "default"` in `session.rs`, single `~/.personas/companion-brain/` root in `disk.rs`). Meanwhile the product's core objects, personas, are amnesiac: they re-run from a static system prompt every execution. Generalizing the brain into a multi-tenant primitive ("mount a brain" on any persona, project, or team) is the difference between shipping one smart companion and shipping a memory platform. No competitor in the desktop-agent space has provenance-gated, human-curated long-term memory as an attachable primitive; this is the durable data-moat.
- **What exists today**:
  - The full brain stack: `src-tauri/src/companion/brain/{episodic,semantic,procedural,goals,backlog,retrieval,consolidation,embeddings,graph,identity,doctrine}.rs` — all functionally complete but Athena-scoped.
  - Schema already brain-shaped, not Athena-shaped: `companion_node`, `companion_edge`, `companion_fact`, `companion_provenance`, `companion_embedding`, `companion_fts` (repo layer in `src-tauri/db/src/repos/twin.rs`).
  - Proof the need is real: two parallel bespoke memory stores were already invented because personas/projects couldn't mount the brain — `dev_memories` (`src-tauri/db/src/repos/dev_memories.rs`, whose own doc-comment describes the "learned at triage, forgotten at execution" failure) and `team_memories`. Both are flat key-value shadows of what the brain does properly.
  - Persona identity surface ready to display a mind: `src/features/agents/sub_glyph/personaCore/` (archetypes, mentality, traits) and the Glyph card (`src/features/agents/sub_glyph/GlyphFullLayout.tsx`) — a natural "what this persona has learned" face.
- **Path to implementation**:
  1. Add an `owner_id` column (default `'athena'`) to `companion_node`/`companion_fact`/`companion_embedding`/`companion_fts` and thread it through `brain/episodic.rs` + `brain/semantic.rs` write/read paths — a mechanical, backward-compatible refactor doable now.
  2. Parameterize `disk.rs` path resolution: `~/.personas/companion-brain/` stays Athena's; persona brains land at `~/.personas/brains/<persona_id>/` with the same episodes/facts markdown layout.
  3. Wire the cheapest high-value write: after each persona execution, append the run summary as an episode into that persona's brain (execution-runner already produces structured results), and fold `dev_memories`/`team_memories` writes into brain facts with provenance.
  4. Wire the read side: `brain/retrieval.rs::Recall` scoped by owner, injected into persona prompt assembly at execution time — persona now recalls its own past runs, user corrections, and standing constraints.
  5. Reuse `brain/consolidation.rs` per-owner on the existing background-job worker (`jobs/mod.rs`) so persona episodes distill into reviewed facts; surface each persona's fact/goal ledger in the Glyph.
  6. Deprecate `dev_memories`/`team_memories` as separate stores; they become views over brain facts.
- **Dependencies**: `companion/brain/*` (all tiers), `db/repos/twin.rs`, execution-runner result pipeline, `engine/embedder` (AllMiniLML6V2Q, already local), `jobs/` worker for per-owner consolidation, Glyph UI for the memory face.
- **Risks**: (1) Migration and multi-tenancy in the vec0/FTS indexes is fiddly — a scoping bug leaks one persona's memory into another's recall. (2) N brains × consolidation = N ephemeral CLI calls; needs the wake-window/budget discipline generalized or costs creep. (3) Memory can entrench bad behavior — the provenance + human-review contract must stay mandatory per-owner or quality degrades silently.
- **What changes if we ship it**: A persona run 50 times is meaningfully better than on run 1 — it cites what it learned and from which episode — and "agents with auditable long-term memory" becomes the product's headline category claim rather than an Athena-only demo.

## 2. Night Shift: Athena as an autonomous chief-of-staff who runs the fleet while you sleep

- **Tier**: 1 (10x category-defining)
- **Category**: automation
- **Impact**: Converts the owner's ~15 managed repos from "one campaign per repo when I sit down and drive it" to a standing overnight operation — Athena plans from goals/backlogs, dispatches fleet workers, supervises via MCP checkpoints, gates merges behind her trust ledger, and delivers a spoken morning briefing — 10x throughput on the exact vibeman-campaign loop the owner runs by hand today.
- **Feasibility**: medium
- **Time-horizon**: months
- **Why it's a moonshot**: Every load-bearing part already exists in isolation — Athena can spawn fleet sessions, workers call back through her MCP server (`report_intent`, `checkpoint`, blocking `request_guidance`/`request_approval`), she has operative memory of live work, autonomous continuation chains (cap 20), wake windows, proactive rollups, and per-project `dev_memories`. What does NOT exist is the closed loop: nothing plans a night's work, nothing answers `request_guidance` when the human is asleep (blocking calls just hang), nothing reviews a finished session's diff and decides ship/park/retry, and autonomy is a hard-coded cap rather than earned trust. Closing that loop is the leap from "companion who watches you work" to "operator who works for you" — the category no desktop agent product occupies.
- **What exists today**:
  - Dispatch + supervision plumbing: `src-tauri/src/companion/orchestration/mcp/{mod,handlers,pending}.rs` (four MCP tools incl. blocking guidance/approval with oneshot resolution), `orchestration/operative_memory.rs` (live digest + `athena://orchestration/digest-changed`).
  - Autonomy scaffolding: `session.rs` (`TurnOrigin::{Autonomous,Proactive}`, `MAX_AUTONOMOUS_CHAIN=20`), `wake_window.rs` (windowed wake gate + `athena_wake_log` autonomy-impact ledger), `proactive/` (budget, quiet hours, `rollup.rs`, `execution_review.rs`, fleet/incident triggers, `schedule_proactive` future check-ins).
  - Planning inputs: `brain/goals.rs` + `brain/backlog.rs` (her commitments), `db/repos/dev_memories.rs` + `dev_run_checkpoints` (per-project constraints and mid-run state), `brain/fleet.rs` + `brain/fleet_patterns.rs` (execution-history pattern recognition), `brain/decisions.rs` + `profile_synthesis.rs` (how the user actually decides — the seed of delegated judgment).
  - Long-running job substrate: `jobs/mod.rs` worker (queued→running lifecycle, orphan recovery, system-episode completion reports).
  - Morning-delivery surface: `proactive/rollup.rs` digests + local TTS (`tts/kokoro.rs`) for a spoken briefing.
- **Path to implementation**:
  1. Ship a "night plan" job kind in `jobs/` (a match arm + sibling module, exactly the extension point `mod.rs` documents): at wake-window open, one CLI call reads goals + backlog + `dev_memories` + fleet patterns and emits a bounded plan (N sessions, per-repo scope, stop conditions) as an approval card the user confirms before bed. Doable now.
  2. Add an unattended-guidance policy to `mcp/pending.rs`: when no human resolves within T minutes during the night window, route `request_guidance` to an Athena turn (`TurnOrigin::Proactive`) that answers from `dev_memories` + `decisions.rs` precedent; `request_approval` for destructive ops always parks the session instead.
  3. Build the review station: on fleet-session exit, a job runs gates (tests/lint from the repo's known commands), diffs the branch, and classifies ship-to-branch / park-for-human / retry-with-feedback — findings land as episodes + one rollup card.
  4. Introduce a trust ledger over `athena_wake_log` + `decisions.rs`: autonomy scopes (may-answer-guidance, may-retry, may-push-branch) are unlocked per-project by her track record of human-agreed decisions, replacing the flat autonomous-chain cap.
  5. Morning briefing: extend `rollup.rs` into a night-shift report (dispatched/succeeded/parked/questions), synthesized to speech via Kokoro, delivered at wake time as the first proactive message.
  6. Later: multi-night campaigns — parked work re-planned the next night, closing the loop with `dev_run_checkpoints`.
- **Dependencies**: fleet spawn/registry (`commands/fleet/*`), MCP server + pending queue, `jobs/` worker, `wake_window.rs`, `proactive/*`, `dev_memories`/`dev_run_checkpoints`, local Claude CLI capacity/cost budget, git branch isolation per repo (workers must never touch default branches unattended).
- **Risks**: (1) Unattended wrong answers to `request_guidance` compound across a whole night — mitigations (branch-only writes, trust ledger, conservative park-by-default) must precede ambition. (2) Overnight token spend is real money; needs a hard per-night budget analogous to `proactive/budget.rs`. (3) Review-gate theater: if her ship/park classifier is unreliable, the user re-reviews everything and the leverage evaporates — the trust ledger must be measured against human agreement, not assumed.
- **What changes if we ship it**: The owner ends the day by approving a plan and starts the next one with a spoken briefing and a stack of green, gate-passed branches — Personas stops being a tool they operate and becomes an operation they direct.
