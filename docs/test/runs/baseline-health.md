# Baseline Health Report — the 7 SDLC teams (as-adopted)

_Generated 2026-06-02T07:22:58.432Z by `scripts/test/health-lint.mjs` (read-only). See [run-protocol §9](../run-protocol.md) and [rubric §4](../evaluation-rubric.md)._

This is the honest starting line: **the structural state of the teams before any run or score.** A `CANNOT-CASCADE` verdict means the team's autonomous handoff chain is broken — running it would stall after the entry member, so it must be fixed (React phase / a product fix) before its output is worth grading.

## Summary

| Team | Members | Verdict | Blockers | Execs ever | Repo |
|---|---|---|---|---|---|
| SDLC — Medical Bill Negotiator | 8 | **STRUCTURALLY-SOUND** | 0 | 41 | Medical Bill Negotiator |
| SDLC2 — Medical Bill | 6 | **CANNOT-CASCADE** | 6 | 3 | Medical Bill Negotiator |

**Headline:** 1/2 teams **cannot autonomously cascade** as adopted.

## SDLC — Medical Bill Negotiator

- **Verdict:** `STRUCTURALLY-SOUND` · members 8 · executions ever: 41 · entry: T: Solution Architect · repo: Medical Bill Negotiator

| Member | entry | capability | use_cases | handoff-recv | self-start | pin | setup | blockers |
|---|---|---|---|---|---|---|---|---|
| T: Solution Architect | yes | instructions | 0 | ok | ok | Medical Bill Negotiator | ready |  |
| T: Code Reviewer |  | instructions | 0 | ok | ok | Medical Bill Negotiator | ready |  |
| T: Security Sentinel |  | instructions | 0 | ok | ok | Medical Bill Negotiator | ready |  |
| T: Release Manager |  | instructions | 0 | ok | ok | Medical Bill Negotiator | needs_credentials |  |
| T: Docs Steward |  | instructions | 0 | ok | ok | Medical Bill Negotiator | ready |  |
| T: Dev Clone |  | instructions | 0 | ok | ok | Medical Bill Negotiator | needs_credentials |  |
| T: QA Guardian |  | instructions+use_cases | 1 | ok | ok | Medical Bill Negotiator | needs_credentials |  |
| T: Visual Brand Asset Factory |  | instructions | 0 | ok | ok | **none** | needs_credentials |  |

<details><summary>T: Solution Architect — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: schedule→0 9 * * 1, manual, event_listener→architecture.review.completed, event_listener→team.idea.accepted, event_listener→trigger_fired
- subscriptions: architecture.review.completed, team.idea.accepted

</details>

<details><summary>T: Code Reviewer — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, event_listener→team_handoff.7cf556ae-d197-470b-90b2-59e62f093e8e, chain→team_handoff.7cf556ae-d197-470b-90b2-59e62f093e8e
- subscriptions: none

</details>

<details><summary>T: Security Sentinel — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, chain→team_handoff.11f95374-5789-431d-a41a-80399c9e7ca4, event_listener→team_handoff.11f95374-5789-431d-a41a-80399c9e7ca4
- subscriptions: none

</details>

<details><summary>T: Release Manager — 0 blocker(s), 2 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: manual, event_listener→github.pull_request.merged, chain→team_handoff.16ef9c2b-3ec9-4098-9fa8-809cc9c577ab, event_listener→team_handoff.16ef9c2b-3ec9-4098-9fa8-809cc9c577ab, chain→team_handoff.16ef9c2b-3ec9-4098-9fa8-809cc9c577ab
- subscriptions: github.pull_request.merged

</details>

<details><summary>T: Docs Steward — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, event_listener→release.published, chain→team_handoff.b3c0322b-2c43-44ff-8ddf-51c4e73a043b, event_listener→team_handoff.b3c0322b-2c43-44ff-8ddf-51c4e73a043b
- subscriptions: release.published

</details>

<details><summary>T: Dev Clone — 0 blocker(s), 2 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: polling→0 * * * *, manual→dev-clone.backlog.candidate, manual→dev-clone.backlog.triaged, schedule→0 17 * * 5, chain→team_handoff.26cb4689-a987-436b-9f5b-99bcf2fb2f10, event_listener→team_handoff.26cb4689-a987-436b-9f5b-99bcf2fb2f10, event_listener→trigger_fired, event_listener→trigger_fired, event_listener→dev-clone.backlog.candidate, event_listener→qa.bug.found, event_listener→dev-clone.backlog.triaged, event_listener→review_decision.approved
- subscriptions: dev-clone.backlog.candidate, qa.bug.found, dev-clone.backlog.triaged, review_decision.approved

</details>

<details><summary>T: QA Guardian — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: schedule→0 9 * * *, schedule→0 13 * * *, chain→team_handoff.29fa443d-d25a-402f-98de-137459bb0e6f, event_listener→team_handoff.29fa443d-d25a-402f-98de-137459bb0e6f, event_listener→trigger_fired, event_listener→trigger_fired
- subscriptions: dev-clone.pr.created

</details>

<details><summary>T: Visual Brand Asset Factory — 0 blocker(s), 3 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- ⚠️ no codebase pin — expected for non-code-track role 'artist' (generates assets, reads no repo)
- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: manual, manual, chain→team_handoff.7b95ec9e-9105-46c6-b217-68d7f6811b0f, event_listener→team_handoff.7b95ec9e-9105-46c6-b217-68d7f6811b0f, event_listener→brand.brief.generated
- subscriptions: brand.brief.generated

</details>

Connection graph: T: Code Reviewer→T: Security Sentinel[sequential] · T: Security Sentinel→T: Release Manager[sequential] · T: Release Manager→T: Docs Steward[sequential] · T: Docs Steward→T: Solution Architect[feedback] · T: Solution Architect→T: Dev Clone[sequential] · T: Dev Clone→T: Code Reviewer[sequential] · T: Dev Clone→T: QA Guardian[sequential] · T: QA Guardian→T: Release Manager[sequential] · T: QA Guardian→T: Dev Clone[feedback] · T: Solution Architect→T: Visual Brand Asset Factory[sequential]

## SDLC2 — Medical Bill

- **Verdict:** `CANNOT-CASCADE` · members 6 · executions ever: 3 · entry: T: Solution Architect · repo: Medical Bill Negotiator
- **Broken handoff edges (chain dies here):** T: Solution Architect → **T: Dev Clone** (no receiver); T: Dev Clone → **T: Code Reviewer** (no receiver); T: Code Reviewer → **T: Security Sentinel** (no receiver); T: Security Sentinel → **T: Release Manager** (no receiver); T: Release Manager → **T: Docs Steward** (no receiver)

| Member | entry | capability | use_cases | handoff-recv | self-start | pin | setup | blockers |
|---|---|---|---|---|---|---|---|---|
| T: Solution Architect | yes | instructions | 0 | ok | ok | Medical Bill Negotiator | ready | 1 |
| T: Dev Clone |  | instructions | 0 | ok | ok | Medical Bill Negotiator | needs_credentials | 1 |
| T: Code Reviewer |  | instructions | 0 | ok | ok | Medical Bill Negotiator | ready | 1 |
| T: Security Sentinel |  | instructions | 0 | ok | ok | Medical Bill Negotiator | ready | 1 |
| T: Release Manager |  | instructions | 0 | ok | ok | Medical Bill Negotiator | needs_credentials | 1 |
| T: Docs Steward |  | instructions | 0 | ok | ok | Medical Bill Negotiator | ready | 1 |

<details><summary>T: Solution Architect — 1 blocker(s), 1 warning(s)</summary>

- 🛑 persona is DISABLED — the event bus skips disabled personas silently, so it will NOT self-start; only a direct seed/kick runs it
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: schedule→0 9 * * 1, manual, event_listener→trigger_fired, event_listener→architecture.review.completed, event_listener→team.idea.accepted
- subscriptions: architecture.review.completed, team.idea.accepted

</details>

<details><summary>T: Dev Clone — 1 blocker(s), 2 warning(s)</summary>

- 🛑 persona is DISABLED — the event bus silently skips it (handoff delivered-then-dropped, no error/DLQ). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: polling→0 * * * *, manual→dev-clone.backlog.candidate, manual→dev-clone.backlog.triaged, schedule→0 17 * * 5, chain→team_handoff.e27ac4b3-210b-422d-8937-b6fe6fc5ae83, event_listener→team_handoff.e27ac4b3-210b-422d-8937-b6fe6fc5ae83, event_listener→trigger_fired, event_listener→trigger_fired, event_listener→dev-clone.backlog.candidate, event_listener→qa.bug.found, event_listener→dev-clone.backlog.triaged, event_listener→review_decision.approved
- subscriptions: dev-clone.backlog.candidate, qa.bug.found, dev-clone.backlog.triaged, review_decision.approved

</details>

<details><summary>T: Code Reviewer — 1 blocker(s), 1 warning(s)</summary>

- 🛑 persona is DISABLED — the event bus silently skips it (handoff delivered-then-dropped, no error/DLQ). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, chain→team_handoff.205a3812-0f37-4c03-9952-a4a9a37150b3, event_listener→team_handoff.205a3812-0f37-4c03-9952-a4a9a37150b3
- subscriptions: none

</details>

<details><summary>T: Security Sentinel — 1 blocker(s), 1 warning(s)</summary>

- 🛑 persona is DISABLED — the event bus silently skips it (handoff delivered-then-dropped, no error/DLQ). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, chain→team_handoff.eb984215-19d9-47bb-9d40-483b12945a92, event_listener→team_handoff.eb984215-19d9-47bb-9d40-483b12945a92
- subscriptions: none

</details>

<details><summary>T: Release Manager — 1 blocker(s), 2 warning(s)</summary>

- 🛑 persona is DISABLED — the event bus silently skips it (handoff delivered-then-dropped, no error/DLQ). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: manual, chain→team_handoff.5e3147b0-260d-4dc9-8c91-4bab6c322743, event_listener→team_handoff.5e3147b0-260d-4dc9-8c91-4bab6c322743, event_listener→github.pull_request.merged
- subscriptions: github.pull_request.merged

</details>

<details><summary>T: Docs Steward — 1 blocker(s), 1 warning(s)</summary>

- 🛑 persona is DISABLED — the event bus silently skips it (handoff delivered-then-dropped, no error/DLQ). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, chain→team_handoff.b740ae14-a857-4176-ac2d-3c1c2a4c56ab, event_listener→team_handoff.b740ae14-a857-4176-ac2d-3c1c2a4c56ab, event_listener→release.published
- subscriptions: release.published

</details>

Connection graph: T: Solution Architect→T: Dev Clone[sequential] · T: Dev Clone→T: Code Reviewer[sequential] · T: Code Reviewer→T: Security Sentinel[sequential] · T: Security Sentinel→T: Release Manager[sequential] · T: Release Manager→T: Docs Steward[sequential] · T: Docs Steward→T: Solution Architect[feedback]

---

## What this means (read critically)

- A `CANNOT-CASCADE` team is **not** a persona-quality problem — it is a **wiring** problem from best-effort adoption (README §2.1, §2.3): downstream members were adopted without the event_listener/subscription that lets an upstream completion reach them, so the chain stalls after the entry member.
- `use_cases=0` is expected here — these SDLC personas carry their job in `structured_prompt.instructions`. The runtime "Active Capabilities" prompt section will be empty, which is acceptable but worth noting.
- The event types the wired members listen for (e.g. `github.pull_request.merged`, `release.published`) are **external domain events, not intra-team completion events** matching the connection graph — so even the members that *can* be triggered are not necessarily triggered *by their upstream*. The connection graph (the visual design) and the runtime event wiring are decoupled.
- **Root cause:** handoff event subscriptions are derived at adoption from each use-case's `event_subscriptions` field — but these personas have **empty `use_cases`** (their job is in `structured_prompt`), so downstream members got **no** subscriptions wired. The connection graph is never translated into runtime event wiring.
- **Scope caveat (rigor):** this lint measures the **autonomous event-bus cascade** path. A separate pipeline/`assign_team` orchestration path *could* drive members by the connection graph regardless of triggers — but `pipeline_runs=0` for every team and there is no orchestrator-role member, so that path has never run and is untested. Either way, an event-bus cascade is the "works unattended for weeks" autonomy we care about, and it is broken.
- **Implication for the framework:** before P2 runs, the teams need their handoff wiring repaired. This is the first React-phase target AND a strong candidate for a real product fix (make adoption wire intra-team handoff from the connection graph, not best-effort from untyped template JSON).
