# Baseline Health Report — the 7 SDLC teams (as-adopted)

_Generated 2026-05-26T21:40:51.795Z by `scripts/test/health-lint.mjs` (read-only). See [run-protocol §9](../run-protocol.md) and [rubric §4](../evaluation-rubric.md)._

This is the honest starting line: **the structural state of the teams before any run or score.** A `CANNOT-CASCADE` verdict means the team's autonomous handoff chain is broken — running it would stall after the entry member, so it must be fixed (React phase / a product fix) before its output is worth grading.

## Summary

| Team | Members | Verdict | Blockers | Execs ever | Repo |
|---|---|---|---|---|---|
| SDLC — Apprenticeship Placement | 5 | **CANNOT-CASCADE** | 2 | 0 | Apprenticeship Placement |
| SDLC — Grant Writing Nonprofits | 5 | **CANNOT-CASCADE** | 2 | 1 | Grant Writing Nonprofits |
| SDLC — Immigration Paperwork | 5 | **CANNOT-CASCADE** | 2 | 0 | Immigration Paperwork |
| SDLC — Local SEO Agency | 5 | **CANNOT-CASCADE** | 2 | 2 | Local SEO Agency |
| SDLC — Medical Bill Negotiator | 5 | **CANNOT-CASCADE** | 2 | 3 | Medical Bill Negotiator |
| SDLC — ai-bookkeeper | 5 | **CANNOT-CASCADE** | 2 | 0 | ai-bookkeeper |
| SDLC — ai-paralegal | 5 | **CANNOT-CASCADE** | 2 | 0 | ai-paralegal |

**Headline:** 7/7 teams **cannot autonomously cascade** as adopted.

## SDLC — Apprenticeship Placement

- **Verdict:** `CANNOT-CASCADE` · members 5 · executions ever: 0 · entry: T: Solution Architect · repo: Apprenticeship Placement
- **Broken handoff edges (chain dies here):** T: Solution Architect → **T: Code Reviewer** (no receiver); T: Code Reviewer → **T: Security Sentinel** (no receiver)

| Member | entry | capability | use_cases | handoff-recv | self-start | pin | setup | blockers |
|---|---|---|---|---|---|---|---|---|
| T: Solution Architect | yes | instructions | 0 | ok | ok | Apprenticeship Placement | ready |  |
| T: Code Reviewer |  | instructions | 0 | **NO** | — | Apprenticeship Placement | ready | 1 |
| T: Security Sentinel |  | instructions | 0 | **NO** | — | Apprenticeship Placement | ready | 1 |
| T: Release Manager |  | instructions | 0 | ok | ok | Apprenticeship Placement | needs_credentials |  |
| T: Docs Steward |  | instructions | 0 | ok | ok | Apprenticeship Placement | ready |  |

<details><summary>T: Solution Architect — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: schedule→0 9 * * 1, manual, event_listener→architecture.review.completed, event_listener→team.idea.accepted, event_listener→trigger_fired
- subscriptions: architecture.review.completed, team.idea.accepted

</details>

<details><summary>T: Code Reviewer — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Security Sentinel — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Release Manager — 0 blocker(s), 2 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: manual, event_listener→github.pull_request.merged
- subscriptions: github.pull_request.merged

</details>

<details><summary>T: Docs Steward — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, event_listener→release.published
- subscriptions: release.published

</details>

Connection graph: T: Solution Architect→T: Code Reviewer[sequential] · T: Code Reviewer→T: Security Sentinel[sequential] · T: Security Sentinel→T: Release Manager[sequential] · T: Release Manager→T: Docs Steward[sequential] · T: Docs Steward→T: Solution Architect[feedback]

## SDLC — Grant Writing Nonprofits

- **Verdict:** `CANNOT-CASCADE` · members 5 · executions ever: 1 · entry: T: Solution Architect · repo: Grant Writing Nonprofits
- **Broken handoff edges (chain dies here):** T: Solution Architect → **T: Code Reviewer** (no receiver); T: Code Reviewer → **T: Security Sentinel** (no receiver)

| Member | entry | capability | use_cases | handoff-recv | self-start | pin | setup | blockers |
|---|---|---|---|---|---|---|---|---|
| T: Solution Architect | yes | instructions | 0 | ok | ok | Grant Writing Nonprofits | ready |  |
| T: Code Reviewer |  | instructions | 0 | **NO** | — | Grant Writing Nonprofits | ready | 1 |
| T: Security Sentinel |  | instructions | 0 | **NO** | — | Grant Writing Nonprofits | ready | 1 |
| T: Release Manager |  | instructions | 0 | ok | ok | Grant Writing Nonprofits | needs_credentials |  |
| T: Docs Steward |  | instructions | 0 | ok | ok | Grant Writing Nonprofits | ready |  |

<details><summary>T: Solution Architect — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: schedule→0 9 * * 1, manual, event_listener→architecture.review.completed, event_listener→team.idea.accepted, event_listener→trigger_fired
- subscriptions: architecture.review.completed, team.idea.accepted

</details>

<details><summary>T: Code Reviewer — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Security Sentinel — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Release Manager — 0 blocker(s), 2 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: manual, event_listener→github.pull_request.merged
- subscriptions: github.pull_request.merged

</details>

<details><summary>T: Docs Steward — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, event_listener→release.published
- subscriptions: release.published

</details>

Connection graph: T: Solution Architect→T: Code Reviewer[sequential] · T: Code Reviewer→T: Security Sentinel[sequential] · T: Security Sentinel→T: Release Manager[sequential] · T: Release Manager→T: Docs Steward[sequential] · T: Docs Steward→T: Solution Architect[feedback]

## SDLC — Immigration Paperwork

- **Verdict:** `CANNOT-CASCADE` · members 5 · executions ever: 0 · entry: T: Solution Architect · repo: Immigration Paperwork
- **Broken handoff edges (chain dies here):** T: Solution Architect → **T: Code Reviewer** (no receiver); T: Code Reviewer → **T: Security Sentinel** (no receiver)

| Member | entry | capability | use_cases | handoff-recv | self-start | pin | setup | blockers |
|---|---|---|---|---|---|---|---|---|
| T: Solution Architect | yes | instructions | 0 | ok | ok | Immigration Paperwork | ready |  |
| T: Code Reviewer |  | instructions | 0 | **NO** | — | Immigration Paperwork | ready | 1 |
| T: Security Sentinel |  | instructions | 0 | **NO** | — | Immigration Paperwork | ready | 1 |
| T: Release Manager |  | instructions | 0 | ok | ok | Immigration Paperwork | needs_credentials |  |
| T: Docs Steward |  | instructions | 0 | ok | ok | Immigration Paperwork | ready |  |

<details><summary>T: Solution Architect — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: schedule→0 9 * * 1, manual, event_listener→architecture.review.completed, event_listener→team.idea.accepted, event_listener→trigger_fired
- subscriptions: architecture.review.completed, team.idea.accepted

</details>

<details><summary>T: Code Reviewer — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Security Sentinel — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Release Manager — 0 blocker(s), 2 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: manual, event_listener→github.pull_request.merged
- subscriptions: github.pull_request.merged

</details>

<details><summary>T: Docs Steward — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, event_listener→release.published
- subscriptions: release.published

</details>

Connection graph: T: Solution Architect→T: Code Reviewer[sequential] · T: Code Reviewer→T: Security Sentinel[sequential] · T: Security Sentinel→T: Release Manager[sequential] · T: Release Manager→T: Docs Steward[sequential] · T: Docs Steward→T: Solution Architect[feedback]

## SDLC — Local SEO Agency

- **Verdict:** `CANNOT-CASCADE` · members 5 · executions ever: 2 · entry: T: Solution Architect · repo: Local SEO Agency
- **Broken handoff edges (chain dies here):** T: Solution Architect → **T: Code Reviewer** (no receiver); T: Code Reviewer → **T: Security Sentinel** (no receiver)

| Member | entry | capability | use_cases | handoff-recv | self-start | pin | setup | blockers |
|---|---|---|---|---|---|---|---|---|
| T: Solution Architect | yes | instructions | 0 | ok | ok | Local SEO Agency | ready |  |
| T: Code Reviewer |  | instructions | 0 | **NO** | — | Local SEO Agency | ready | 1 |
| T: Security Sentinel |  | instructions | 0 | **NO** | — | Local SEO Agency | ready | 1 |
| T: Release Manager |  | instructions | 0 | ok | ok | Local SEO Agency | needs_credentials |  |
| T: Docs Steward |  | instructions | 0 | ok | ok | Local SEO Agency | ready |  |

<details><summary>T: Solution Architect — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: schedule→0 9 * * 1, manual, event_listener→architecture.review.completed, event_listener→team.idea.accepted, event_listener→trigger_fired
- subscriptions: architecture.review.completed, team.idea.accepted

</details>

<details><summary>T: Code Reviewer — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Security Sentinel — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Release Manager — 0 blocker(s), 2 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: manual, event_listener→github.pull_request.merged
- subscriptions: github.pull_request.merged

</details>

<details><summary>T: Docs Steward — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, event_listener→release.published
- subscriptions: release.published

</details>

Connection graph: T: Solution Architect→T: Code Reviewer[sequential] · T: Code Reviewer→T: Security Sentinel[sequential] · T: Security Sentinel→T: Release Manager[sequential] · T: Release Manager→T: Docs Steward[sequential] · T: Docs Steward→T: Solution Architect[feedback]

## SDLC — Medical Bill Negotiator

- **Verdict:** `CANNOT-CASCADE` · members 5 · executions ever: 3 · entry: T: Solution Architect · repo: Medical Bill Negotiator
- **Broken handoff edges (chain dies here):** T: Solution Architect → **T: Code Reviewer** (no receiver); T: Code Reviewer → **T: Security Sentinel** (no receiver)

| Member | entry | capability | use_cases | handoff-recv | self-start | pin | setup | blockers |
|---|---|---|---|---|---|---|---|---|
| T: Solution Architect | yes | instructions | 0 | ok | ok | Medical Bill Negotiator | ready |  |
| T: Code Reviewer |  | instructions | 0 | **NO** | — | Medical Bill Negotiator | ready | 1 |
| T: Security Sentinel |  | instructions | 0 | **NO** | — | Medical Bill Negotiator | ready | 1 |
| T: Release Manager |  | instructions | 0 | ok | ok | Medical Bill Negotiator | needs_credentials |  |
| T: Docs Steward |  | instructions | 0 | ok | ok | Medical Bill Negotiator | ready |  |

<details><summary>T: Solution Architect — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: schedule→0 9 * * 1, manual, event_listener→architecture.review.completed, event_listener→team.idea.accepted, event_listener→trigger_fired
- subscriptions: architecture.review.completed, team.idea.accepted

</details>

<details><summary>T: Code Reviewer — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Security Sentinel — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Release Manager — 0 blocker(s), 2 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: manual, event_listener→github.pull_request.merged
- subscriptions: github.pull_request.merged

</details>

<details><summary>T: Docs Steward — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, event_listener→release.published
- subscriptions: release.published

</details>

Connection graph: T: Solution Architect→T: Code Reviewer[sequential] · T: Code Reviewer→T: Security Sentinel[sequential] · T: Security Sentinel→T: Release Manager[sequential] · T: Release Manager→T: Docs Steward[sequential] · T: Docs Steward→T: Solution Architect[feedback]

## SDLC — ai-bookkeeper

- **Verdict:** `CANNOT-CASCADE` · members 5 · executions ever: 0 · entry: T: Solution Architect · repo: ai-bookkeeper
- **Broken handoff edges (chain dies here):** T: Solution Architect → **T: Code Reviewer** (no receiver); T: Code Reviewer → **T: Security Sentinel** (no receiver)

| Member | entry | capability | use_cases | handoff-recv | self-start | pin | setup | blockers |
|---|---|---|---|---|---|---|---|---|
| T: Solution Architect | yes | instructions | 0 | ok | ok | ai-bookkeeper | ready |  |
| T: Code Reviewer |  | instructions | 0 | **NO** | — | ai-bookkeeper | ready | 1 |
| T: Security Sentinel |  | instructions | 0 | **NO** | — | ai-bookkeeper | ready | 1 |
| T: Release Manager |  | instructions | 0 | ok | ok | ai-bookkeeper | needs_credentials |  |
| T: Docs Steward |  | instructions | 0 | ok | ok | ai-bookkeeper | ready |  |

<details><summary>T: Solution Architect — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: schedule→0 9 * * 1, manual, event_listener→architecture.review.completed, event_listener→team.idea.accepted, event_listener→trigger_fired
- subscriptions: architecture.review.completed, team.idea.accepted

</details>

<details><summary>T: Code Reviewer — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Security Sentinel — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Release Manager — 0 blocker(s), 2 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: manual, event_listener→github.pull_request.merged
- subscriptions: github.pull_request.merged

</details>

<details><summary>T: Docs Steward — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, event_listener→release.published
- subscriptions: release.published

</details>

Connection graph: T: Solution Architect→T: Code Reviewer[sequential] · T: Code Reviewer→T: Security Sentinel[sequential] · T: Security Sentinel→T: Release Manager[sequential] · T: Release Manager→T: Docs Steward[sequential] · T: Docs Steward→T: Solution Architect[feedback]

## SDLC — ai-paralegal

- **Verdict:** `CANNOT-CASCADE` · members 5 · executions ever: 0 · entry: T: Solution Architect · repo: ai-paralegal
- **Broken handoff edges (chain dies here):** T: Solution Architect → **T: Code Reviewer** (no receiver); T: Code Reviewer → **T: Security Sentinel** (no receiver)

| Member | entry | capability | use_cases | handoff-recv | self-start | pin | setup | blockers |
|---|---|---|---|---|---|---|---|---|
| T: Solution Architect | yes | instructions | 0 | ok | ok | ai-paralegal | ready |  |
| T: Code Reviewer |  | instructions | 0 | **NO** | — | ai-paralegal | ready | 1 |
| T: Security Sentinel |  | instructions | 0 | **NO** | — | ai-paralegal | ready | 1 |
| T: Release Manager |  | instructions | 0 | ok | ok | ai-paralegal | needs_credentials |  |
| T: Docs Steward |  | instructions | 0 | ok | ok | ai-paralegal | ready |  |

<details><summary>T: Solution Architect — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: schedule→0 9 * * 1, manual, event_listener→architecture.review.completed, event_listener→team.idea.accepted, event_listener→trigger_fired
- subscriptions: architecture.review.completed, team.idea.accepted

</details>

<details><summary>T: Code Reviewer — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Security Sentinel — 1 blocker(s), 1 warning(s)</summary>

- 🛑 CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.
- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual
- subscriptions: none

</details>

<details><summary>T: Release Manager — 0 blocker(s), 2 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- ⚠️ setup_status=needs_credentials (likely missing credentials)
- triggers: manual, event_listener→github.pull_request.merged
- subscriptions: github.pull_request.merged

</details>

<details><summary>T: Docs Steward — 0 blocker(s), 1 warning(s)</summary>

- ⚠️ use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)
- triggers: manual, event_listener→release.published
- subscriptions: release.published

</details>

Connection graph: T: Solution Architect→T: Code Reviewer[sequential] · T: Code Reviewer→T: Security Sentinel[sequential] · T: Security Sentinel→T: Release Manager[sequential] · T: Release Manager→T: Docs Steward[sequential] · T: Docs Steward→T: Solution Architect[feedback]

---

## What this means (read critically)

- A `CANNOT-CASCADE` team is **not** a persona-quality problem — it is a **wiring** problem from best-effort adoption (README §2.1, §2.3): downstream members were adopted without the event_listener/subscription that lets an upstream completion reach them, so the chain stalls after the entry member.
- `use_cases=0` is expected here — these SDLC personas carry their job in `structured_prompt.instructions`. The runtime "Active Capabilities" prompt section will be empty, which is acceptable but worth noting.
- The event types the wired members listen for (e.g. `github.pull_request.merged`, `release.published`) are **external domain events, not intra-team completion events** matching the connection graph — so even the members that *can* be triggered are not necessarily triggered *by their upstream*. The connection graph (the visual design) and the runtime event wiring are decoupled.
- **Root cause:** handoff event subscriptions are derived at adoption from each use-case's `event_subscriptions` field — but these personas have **empty `use_cases`** (their job is in `structured_prompt`), so downstream members got **no** subscriptions wired. The connection graph is never translated into runtime event wiring.
- **Scope caveat (rigor):** this lint measures the **autonomous event-bus cascade** path. A separate pipeline/`assign_team` orchestration path *could* drive members by the connection graph regardless of triggers — but `pipeline_runs=0` for every team and there is no orchestrator-role member, so that path has never run and is untested. Either way, an event-bus cascade is the "works unattended for weeks" autonomy we care about, and it is broken.
- **Implication for the framework:** before P2 runs, the teams need their handoff wiring repaired. This is the first React-phase target AND a strong candidate for a real product fix (make adoption wire intra-team handoff from the connection graph, not best-effort from untyped template JSON).
