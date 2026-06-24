# Passport row actions — turning the readiness matrix into a codebase-upgrade surface

_Status: P0–P3 ✓ + streaming ✓ + UI/UX-pass ✓ + Next-Directions D1–D5 ✓ + Auth/LLM-tracking dims ✓ (2026-06-23). Owner: Factory / Dev-tools._

> **Two new certificate dimensions (2026-06-23):**
> - **Auth** (view-only) — a Stack row showing the detected auth method as text. The D1
>   evidence probe (`RepoEvidence.auth_method`) detects it from package.json deps (Clerk /
>   Auth.js / Auth0 / Supabase / Firebase / Lucia / WorkOS / Stytch / Kinde / Passport /
>   Better Auth); the derive surfaces `stack.auth`. No action — informational.
> - **LLM tracking** (connector-bindable, like monitoring) — a Tooling row wired to a
>   **dedicated** credential slot `dev_projects.llm_tracking_credential_id` (new migration +
>   DevProject field + repo/command + ts-rs binding) so it's distinct from app monitoring.
>   `connectors.ts` adds an `llmtracking` spec (Langfuse/Helicone/LangSmith/Arize/Phoenix/
>   Braintrust/Portkey/… service types, `bindField:'llm_tracking'`); `bindConnector` routes
>   that field to `updateProject({llmTrackingCredentialId})`. Reuses the existing
>   ConnectorSection UX. _Activates on the next app build (Rust column + command)._

> **Next directions (D1–D5) — shipped 2026-06-23, all gated (tsc 0 / eslint 0 / 13 tests / Rust compiles):**
> - **D1 — Deep evidence scanner.** New deterministic, no-LLM Rust command
>   `dev_tools_probe_repo_evidence(root_path)` (`commands/infrastructure/dev_tools.rs`,
>   registered in `lib.rs`, command-names regenerated) — reads package.json scripts +
>   test framework, `.github/workflows`, CLAUDE.md, Dockerfile, dependabot/CodeQL,
>   migrations dir, a bounded test-file walk. Hand-typed `RepoEvidence` (mirrors the
>   serde struct — no ts-rs). `usePassportData` probes every project in parallel
>   (defensive: null on older builds → heuristic fallback) and stores it on `ImproveRaw`;
>   the **derive now reads real evidence** for tests / evals / migrations / security
>   (CodeQL/Dependabot → scanning) / agent-instructions (real CLAUDE.md) / CI workflows —
>   turning permanent honest-gaps into measured signal, and making a scan actually move
>   the headline scores. _Activates on the next app build (the command isn't in the
>   running artifact)._
> - **D2 — Golden-standard rubric.** `improve/goldenStandard.ts` — per-archetype target +
>   weight per dimension; `scoreAgainstRubric` → weighted golden-% + below-target list.
>   `GoldenGauge` on the cover. A solo prototype isn't held to the org bar. (unit-tested)
> - **D3 — Readiness history.** `passportHistory.ts` — localStorage time series (deduped),
>   `Sparkline` widget + `ReadinessTrend` cover line (golden-% sparkline + Δ-since-last,
>   red on regression). Recorded on every build. (unit-tested)
> - **D4 — Improve Plan.** `improve/improvePlan.ts` + `ImprovePlanPanel` — ranks every gap
>   across the fleet by impact-per-effort (golden-% lift ÷ tier), header shows fleet golden
>   now→projected, batch-queues the Claude-deploy tasks. Opened from a header button.
> - **D5 — Provenance + portable passport.** `improve/provenance.ts` (`dimensionReason`)
>   renders "why this rating" in the cell popovers; `passportExport.ts` + a cover copy
>   button export a markdown readiness report; the schema `evidence` field is now populated
>   (confidence/source). CI-verify check is the noted next step (wants D1 headless).

> **UI/UX + functionality adjustment pass (2026-06-23):**
> - **Cover progress bars** — Automation/Production now render as filled `ScoreBar`s
>   (bar tinted by score + code + number) instead of compact seals, so the two axes
>   read as comparable progress lines.
> - **Warning icon fixed** — `WarningBadge` used `var(--destructive)` (undefined → white
>   icon + broken outline); switched to themed red classes.
> - **Level ladders** — multi-level rows (context, ci, tests, security, observability,
>   evals, migrations) now open a popover with a `LevelLadder` (the full scale, current
>   rung highlighted, one-line "how to climb") above the scan/deploy actions. `improve/levels.ts`
>   + `improve/LevelLadder.tsx`.
> - **Gear migration** — every non-standards improvable cell (skills, connectors, deploy)
>   now shows the persistent right-edge gear; only Tier-0 config-toggle rows (ci/self-verify)
>   keep the hover sparkle.
> - **Persistence as DB glyph** — derive emits the engine name only (dropped "· N tables"),
>   so `TechBadge` renders the brand icon.
> - **Scan-refresh bug** — context-graph level derives from the cross-project metadata
>   aggregate; a scan now dispatches `kind:'scan'` so the Wall REGENERATES that metadata
>   (`build(true)`), not a stale re-derive — the score actually rises after a scan.
> - **New scan/deploy prompts** — golden-standard `DeployAction`s for evals, security
>   (deps+code scanning), migrations, and hosting (deploy config; no credential slot).
> - **Connector wiring on tooling rows** — `ConnectorSpec`s for error-tracking/logs/metrics/
>   tracing (bind the monitoring slot; derive reflects a bound monitoring connector across all
>   four). _Verified: tsc 0 / eslint 0 errors; activity-store test green. Visuals need an app
>   relaunch to see (running instance is a pre-change built artifact)._

> **Shipped:** P0 (Tier-0 standards toggles, live projection) · P1 (standards-scan →
> findings popover → "Fix with Claude"; verified ai-bookkeeper 74%/8 open) · P2
> (connector wire on Observability: reads the vault via `listCredentials` +
> `healthcheckCredential`, lists the user's monitoring connectors with a health dot
> → Connect = `updateProject(monitoringCredentialId)` + re-derive; none → route to
> the Vault `credentials` section; verified — surfaced Sentry + Better Stack PATs) ·
> P3-v1 (Deploy Claude Code: golden-standard stack-aware prompts → Queue / Deploy
> now / auto-PR) + Tier-1 context-scan. **P2 broadened:** generalized `ConnectorSpec`
> (`bindField` monitoring/pr + `applicable(passport)`) now covers **Observability**
> (monitoring) AND **AI-in-workflow** (GitHub-PR → `prCredentialId`; a bound PR cred
> now counts toward aiInWorkflow); verified auto-invoicer surfaced 5 GitHub PATs.
> **Skills-install (cross-project):** the Reusable-skills row reads every project's
> `.claude/skills` + the global library (usePassportData), so a project can ADOPT
> skills its siblings have but it lacks (multi-select → `skill_files_install` from the
> source project) — verified: ai-bookkeeper offered 24 adoptable skills. The passport's
> skills artifact now reflects real installed skills + adds to the automation score.
> **P3 (partial):** cross-project BATCH shipped — each Claude task action offers
> "Queue for all N projects that need this" (queues the golden-standard task across
> every eligible project). UI: AI/LLM-upgradeable cells (Claude-deploy rows) now carry
> a PERSISTENT cog at the cell's right edge (opacity-50 → full on hover) so LLM-
> upgradeable items are discoverable; non-AI cells keep the hover sparkle.
> **P3 progress-streaming (background execution):** Deploy-now and context-scan now
> register in the **global activity dock** (`useOverviewStore` process slice) the same
> way every other Claude-Code CLI execution does — `processStarted('factory_deploy', taskId,
> …, { section:'plugins', tab:'task-runner' })` / `processStarted('factory_scan', scanId, …,
> { tab:'context-map' })`. Completion is resolved **globally** in `eventBridge.ts` (new
> `TASK_EXEC_STATUS` + `CONTEXT_GEN_COMPLETE` listeners, scoped strictly to the two factory
> domains so they never disturb TaskRunnerPage / ProjectManager), which ends the dock entry,
> raises a deep-linked completion **notification** (deploy), and dispatches
> `personas:factory-process-complete` so the Wall re-derives if still on screen. Net: the user
> fires an upgrade, switches modules, and the dock + bell tell them when the LLM is done —
> returning to the runner streams live output, returning to the Wall shows the lifted scores.
> **Progress-state indicators (three levels):** a purpose-built per-cell registry
> (`stores/improveActivityStore.ts`, keyed `${slug}:${rowKey}` → run id) drives — (1) the
> **1st-level Teams** sidebar pulse badge, (2) the **2nd-level Factory** pulse dot, and (3) the
> matrix **cell gear** itself, which `animate-spin`s + disables while its op runs. The engine
> now returns the task/scan id so `DeployPopover` marks the exact cell busy; `eventBridge`'s
> completion listeners call `endByRun(id)` to settle the gear + the dots, and the Wall
> re-derives in place (`personas:factory-process-complete`). No lingering "done" state —
> indicators clear themselves on completion. _Verified: tsc/eslint clean (no new warnings);
> `improveActivityStore` unit-tested (5 cases incl. supersede-safety); event→listener→
> notification mechanism proven via loopback. The new store + listeners + dots go live on the
> next app launch — the current running `:17320` instance is a pre-change built artifact
> (Vite `:1420` down → no HMR), so the visual indicators can only be seen after a rebuild+relaunch._
> **Remaining:** P4 (per-project Improve drawer). _Note: scan findings are repo-state → Claude
> fix, not the policy toggle._

## Vision

The Factory project-readiness matrix (`src/features/teams/sub_factory/passport/`) is
read-only today: each row is a passport dimension (CI, tests, observability, context
graph, …) showing a real-but-often-gapped state. This plan makes every gap **actionable**
— click it, see exactly how a golden-standard practice lifts the scores, and apply it
— up to **deploying Claude Code to change the actual repo and open a PR**.

The matrix becomes the place where "this project is at L1/Prototype" turns into "one
click → L3/Beta", and where scan findings convert into upgrades. We are, in effect,
forging a repeatable path to drive codebases toward a golden standard.

## Decisions (locked 2026-06-23)

1. **Claude-Code autonomy: auto-PR allowed.** Tier-3 actions may open a PR on green
   (the `auto_pr_on_success` + `pr_credential` plumbing already exists). Still never
   silent: the work is a real branch + PR the human can review/revert.
2. **Multi-select is the default.** A single popover lets the user check several
   upgrades and apply them together (and, later, across several projects at once).
3. **Build P0 now**, phased plan below.

## The four engines (what can change state)

All already exist in the dev-tools backend (`src/api/devTools/devTools.ts`):

| Tier | Mechanism | Commands | Risk |
|---|---|---|---|
| **0 · Config** | project policy/flags | `setStandardsConfig`, `updateProject` | none (DB-only, reversible) |
| **1 · Scan** | gather/refresh findings | `scanCodebase`, `generateCrossProjectMetadata`, `runStandardsScan`, `runStaticScan` | read-only |
| **2 · Connect** | bind credential / install skills | `updateProject(monitoringCredentialId / prCredentialId)`, `skill_files_install` | low |
| **3 · Claude Code** | change the repo | `createTask`→`executeTask` / `startCompetition` (worktrees) → `applyDiff`/`runTests`/`commitChanges`/auto-PR | high — diff/PR gated |

## Per-row map

| Section / row | Action(s) | Tier |
|---|---|---|
| Self-verify · lint / typecheck | enable precommit flag | **0** |
| Self-verify · test | scaffold test setup + smoke tests | **3** |
| Context graph | run context scan | **1** |
| Agent instructions (CLAUDE.md) | deploy Claude `/init` | **3** |
| Reusable skills | install skills into `.claude/skills` | **2** |
| AI in workflow | bind GitHub cred + enable auto-PR | **0/2** |
| CI (none→gated→delivery) | set branching/automerge policy → **0**; add `ci.yml` → **3** |
| Tests | add test suite | **3** |
| Security | set policy → **0**; CodeQL/dependabot → **3** |
| Observability | bind Sentry cred → **2**; wire SDK → **3** |
| Integrations / monitoring nulls | add a connector | **2** |
| Stack / languages | correct `tech_stack` / rescan | **0/1** |

## Interaction model

- **Primitive — gap-cell popover (pattern D).** Click an actionable cell → an anchored,
  portalled popover (same infra as the warning badge) offering the applicable upgrades as a
  **multi-select checklist**, with a **live projected-passport preview** ("Automation L1·28 →
  L3·55, Production Prototype·25 → Beta·52") computed by re-deriving the passport with the
  hypothetical change. Apply → execute + re-derive.
- **Batch — project "Improve" drawer (pattern C, later).** A per-project side panel listing
  every gap as a prioritized checklist for "upgrade everything weak here," and cross-project
  batch ("apply lint-gate to all 4 projects that lack it").
- **Offered-from-scans.** A cell can "Run standards/static scan" → findings come back as
  pre-filled offered actions in the same popover.

## Safety model (Tier-3)

gap → task → **worktree / competition** → **diff preview** → **PR** (auto on green per the
decision) → human merge. Progress streams like existing task execution. Multi-select = a
batch of PRs. Reversible by closing/reverting the PR.

## Phasing

- **P0 (this change)** — Tier-0 standards toggles on the CI / Security / Self-verify cells via
  the gap-cell popover, multi-select, with a live projected-passport preview. Writes
  `standards_config` via `setStandardsConfig`, re-derives instantly (no scan). Cheap, safe,
  immediate readiness lift; establishes the action + popover + projection infrastructure the
  later tiers reuse.
- **P1** — scan-to-offer (standards/static scan findings populate the popover).
- **P2** — connector binds (observability, integrations, skills install) from the popover.
- **P3** — Claude Code deployment (tests, CLAUDE.md, `ci.yml`, SDK wiring) with diff/PR gating
  + multi-select batch + auto-PR.
- **P4** — project "Improve" drawer + cross-project batch.

## P0 design

- `improve/standards.ts` — `Standards` shape + `parseStandards`/`serializeStandards` (single
  source, also consumed by `passportDerive`) + `STANDARDS_ACTIONS` (lint, code-quality, docs,
  gate-on-base, auto-merge) each with `applicable(s)` + pure `apply(s, project)`.
- `improve/ImproveContext.tsx` — context exposing `getRaw(slug) → {project, meta}` and
  `applyStandards(slug, json)` (= `setStandardsConfig` + re-derive). Provided by `ProjectsLayer`.
- `improve/ImprovePopover.tsx` — checklist + live projected-passport preview + Apply.
- `improve/ImproveCell.tsx` — wraps an actionable cell: hover affordance, opens the popover;
  renders plain when the project's standards are already golden.
- `usePassportData` exposes `rawByProject` + `reload`; the Wall wraps CI/Security/Self-verify
  cells in `ImproveCell`.

Projects whose `standards_config` is already fully gated (the xprice fleet) show no
affordance ("already golden"); the un-configured ones (personas, studio-story, auto-invoicer)
get the one-click lift.
