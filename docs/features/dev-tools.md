# Dev Tools

The Dev Tools plugin turns local code repositories into first-class objects the
app can reason about: register a project once, then scan it into a **context
map**, track **goals**, surface **ideas**, **triage** them, and hand
implementation **tasks** to agents. It is the bridge between a folder on disk
and the agent fleet.

Source: `src/features/plugins/dev-tools/` (frontend) and
`src-tauri/src/commands/infrastructure/{dev_tools,context_generation,incremental_scan}.rs`
(backend). The plugin is surfaced as a tabbed page (`DevToolsPage.tsx`); a
project-selector banner sits above every tab except **Projects**.

## Tabs

| Tab | Module | Purpose |
| --- | --- | --- |
| Overview | `sub_overview` | Per-project metrics rollup. A read-only **Pipeline** section at the top mirrors the onboarding stepper's two stages (Project; Source control — team-or-connector, repo, main branch, test env). Below it, six vital-sign tiles (issues, PRs, commits, unresolved, events 24h/7d) are drag-reorderable (order persists per project) and clickable: repo tiles deep-link to the connected GitHub/GitLab subpage, monitoring tiles reveal the Sentry connection chain. The header carries a live "updated Nm ago" timestamp and a manual Refresh control. |
| Projects | `sub_projects` | Register, edit, archive projects (see below). |
| Goals | `sub_goals` | Track project goals across **Board** (your-turn / agent's-turn / done kanban, with inline checklist to-dos that drive completeness) and **Map** (pan/zoom React Flow canvas — draggable persisted nodes, minimap, level-of-detail nodes, Now/Next highlighting over dependency edges), with `+ New goal` authoring and a detail drawer (checklist + hybrid progress nudge + team-step intervention + activity feed). **Goals is now also a top-level sidebar section**; this tab is a contextual shortcut to the same surface. Full reference: [`../goals/README.md`](goals/README.md). |
| Context Map | `sub_context` | Codebase scan results: groups, contexts, entry points, keywords. Each context card shows an **idea-coverage** badge (how many ideas that context produced, alongside the goal-coverage badge) and a one-click **scan-this-context** button that reuses the scanner's per-context run; coverage refreshes when the scan finishes. |
| Idea Scanner | `sub_scanner` | Generate improvement ideas from the codebase. The scan prompt now feeds back recently **rejected** ideas ("do NOT re-surface") so it stops repeating triaged-away items. Each idea card carries a **Value** verdict (High / Fair / Low — impact weighed against effort and risk) and the results grid can sort by **Best value** / **Quick wins** (shared scorer with triage). Scan agents that have landed well in past triage (≥50% accept over a real sample) get a **Recommended** star + a one-click **Recommended** quick-select, driven by the Agent Scoreboard's accept rates. |
| Idea Triage | `sub_triage` | Accept / reject scanned ideas into the backlog. The sidebar's **Order** control sorts the swipe stack by **Best value** (impact vs effort/risk) or **Quick wins** (low-effort first) instead of arbitrary scan order, and the swipe card shows the same **Value** chip so the ordering rationale is visible. Decisions **persist** server-side (`dev_tools_accept_idea` / `dev_tools_reject_idea` — previously no-op) and, when the project is team-bound, write a shared team memory (accepted=`decision`, rejected=`constraint`), mirroring the Human-Review learning loop. Pending ideas also surface in the Overview **Approvals** inbox for one-place triage. |
| Task Runner | `sub_runner` | Execute implementation tasks against a project. The queue is **grouped by status** (running / queued / failed / done / cancelled) under status headers, and a **Retry failed (N)** action re-queues every failed task as a `[Retry]` copy in one click. |
| Lifecycle | `sub_lifecycle` | Project lifecycle controls, including **Competitions** (strategy-racing: N agents solve the same task with different gene-weighted strategies). A resolved competition **spotlights** its winning strategy — label plus the gene weights recovered from its stored prompt — and offers a one-click **Rematch with winner** that seeds those genes into slot 1 of a fresh competition (exploit the winner while the other slots keep exploring). A **Winning gene profile** panel (on-demand) averages the recovered genes of all past winners into a 6-bar readout, so you can see what emphasis tends to win for this project. |
| Fleet / Skills | `../fleet` | Shared Fleet surface. |

## Projects module

A **project** is a name + local folder path, with an optional project type
(visual tag), GitHub URL, and a **bound team** (a PersonaTeam pipeline tied to
the project). Projects are listed in a table with bulk-archive, open-in-VS-Code,
open-folder, GitHub-issue-import, and — when a test-environment URL is set —
**open-test-environment** row actions. The last opens the project's living
test/staging deployment in your default browser (via the OS, http/https only).
Selecting a row makes it the **active project** (a compact summary banner) and
the active selection drives the project-selector banner on the other tabs.

### Create / edit project — pipeline-stepper (`ProjectModal.tsx`)

The dialog is a **horizontal SDLC pipeline-stepper**: a clickable rail of stages
across the top, with the active stage's fields below it and `Back` / `Next` /
`Create` navigation. It ships **three stages** (Project, Source control,
Standards); the rail + per-stage component pattern (`sub_projects/pipeline/`) is
built to grow as the pipeline gains build/review/deploy stages. The same stages
render read-only in the **Overview** tab's Pipeline section.

**Stage 1 — Project**
- **Folder first:** pick a project folder. The **project name is auto-extracted
  from the folder name** and pre-filled; the field stays editable (a pencil
  affordance + an "auto-filled from folder" hint), and editing it stops the
  auto-fill from overwriting your choice.
- **Project type** — optional visual tag (React, NodeJS, Rust, …).

**Stage 2 — Source control** (the former *Workspace* section is folded in here)
- **Team / Standalone switch** — mutually exclusive at the data layer:
  - **Team** binds the project to a PersonaTeam pipeline (team selector
    **mandatory**). Sets `team_id`; clears `pr_credential_id`.
  - **Standalone** binds a vault GitHub PAT (connector **mandatory**, persisted
    as `pr_credential_id`) that authorises PR / source-control ops **and drives
    the repository picker**. Sets `pr_credential_id`; clears `team_id`.
- **Repository** — searchable repo dropdown listing repos from the chosen
  connector (standalone) or auto-discovering a usable PAT (team), falling back
  to a validated manual URL when no healthy credential exists. A picked repo
  shows an inline preview (owner/name, private badge, description, open ↗).
- **Main branch** — the project's primary/default branch (e.g. `main`/`master`),
  optional, persisted as `main_branch`. The source-control stage's baseline.
- **Test environment** — optional URL + branch of the *living test environment*
  this project's team delivers into (e.g. `https://staging.example.com` on
  `staging`). Persisted as `test_env_url` / `test_env_branch`; clearing either
  removes that binding.
- **Create Codebase connector** (create mode only, on by default) — also creates
  a `Codebase — <project name>` connector (`service_type: codebase`) wired to
  the project, now carrying the repo + main branch (`github_url`, `main_branch`)
  so agents read the codebase immediately. Unchecking skips it; it can still be
  added later from the catalog (Connections → Catalog → Codebase).

**Stage 3 — Standards** (the policy the connected team must respect; persisted as `standards_config` JSON)
- **Pre-commit gates** — toggle which must pass before a commit: **Lint**, **Docs covered**, **Code quality**.
- **PR base** — which branch PRs open against: **Main** (`main_branch`) or **Test** (`test_env_branch`).
- **Automerge** — enable **GitHub native auto-merge** (merges when required checks pass) into Main or Test.

Stage 3 is config-only (always valid via defaults, never blocks Create). It is
wired to the connected team's personas at runtime: `engine/runner/team_context.rs`
injects a **STANDARDS & BRANCHING POLICY** block into every team-member
execution's prompt (resolved from the bound project's `standards_config`), so
Dev Clone / QA Guardian open PRs against the configured base, run the named
pre-commit gates, and enable auto-merge per the policy.

**Golden-standard scan** — the Overview's Pipeline section has a **Standards
compliance** card that runs `dev_tools_run_standards_scan` (`standards_scan.rs`):
an LLM scan instructed with a shipped golden ruleset (`standards_ruleset.md`)
that adapts each rule to the repo's character and reports per-rule status
(`present`/`partial`/`missing`) to the `dev_standards` table, with a compliance %.

**SDLC persona impact** — the connected team's personas honor the policy at runtime
(the `team_context` block reaches every member execution): **Dev Clone** opens PRs
against the policy's base branch, runs its pre-commit gates before committing, and
enables GitHub-native auto-merge when the policy enables it. **QA Guardian** gained a
PR-test-merge capability (`uc_pr_review`): on `dev-clone.pr.created` it checks out the
PR in an isolated git worktree, runs the tests, then enables auto-merge (pass +
automerge) / approves (pass) / requests changes (fail) — emitting `qa.pr.approved` /
`qa.pr.changes_requested`. Adopted personas have no template→instance sync, so existing
teams are retrofitted in place by the idempotent **`dev_tools_backfill_qa_pr_review`**
command (appends the `uc_pr_review` use-case to `design_context` + inserts the
`dev-clone.pr.created` subscription); new adoptions get it from the updated
`dev-clone` / `qa-guardian` templates + the `uc_pr_review` recipe.

After creation the modal offers to **run a context map scan** right away.

> **Note:** `create_project` only takes name/path/type/github/team; the modal
> persists the remaining source-control fields (`pr_credential_id`,
> `test_env_*`, `main_branch`) via a follow-up `dev_tools_update_project`, which
> also fixes an earlier bug where those fields were dropped on creation.

## Context Map scan

Generating a context map runs a background scan of the project folder (kicked
off from the post-create modal, the Context Map tab, or programmatically). The
scan streams progress, creates context **groups** and **contexts** (with file
paths, entry points, keywords, DB tables, API surface), and persists per-file
hashes so subsequent scans can run in delta mode.

Completion is event-driven. The backend runs the scan on a background task; on
completion it sends an authoritative OS notification ("Context Map Ready" /
"Context Scan Failed") and, on success, emits a `context-gen-complete` event
carrying a `ContextGenSummary` (`{ scan_id, groups_created, contexts_created,
files_mapped, status, error }`). The frontend listener
(`useContextScanBackground`) consumes that event purely to update in-app state —
it derives success from `status` ("completed" / "completed_with_warning") and
does **not** send its own OS notification (the backend already did). Large
codebases can take a long time: the backend stream timeout is 30 minutes, and if
it fires after some contexts were committed the scan is reported as a **partial
success** rather than a failure.

The scan launcher is `context_generation::launch_context_scan(app, pool, project,
root_path, delta)` — shared by the `dev_tools_scan_codebase` command, Athena's
`register_project` auto-scan, and Athena's `enqueue_dev_job{kind:"scan_codebase"}`
(see below). All three produce the same real context map; there is no shallow
"file walk" scan path any more.

## Codebase connector — per-persona pin

The `codebase` connector resolves a Dev Tools project at runtime. Historically it
was a **global probe** — it picked the first/oldest `dev_projects` row, so every
persona read the same repo. As of 2026-05-26 a persona can be **pinned** to a
specific project via `design_context.dev_project_id` (mirrors the `twin`
connector's `twin_id`):

- **Adoption sets the pin.** A template's codebase adoption question
  (`maps_to: persona.design_context[dev_project_id]`) writes the chosen project
  onto each adopted persona (`apply_codebase_pin_from_design`). The answer may be
  a project id, name, or root path — it is resolved to a real `dev_projects.id`.
  A team preset adopted for repo X pins all its members to X (one choice,
  distributed to every member, so the binding survives team disband).
- **Runtime honours the pin.** The runner reads `design_context.dev_project_id`
  (from the raw JSON — a strict struct parse would drop it) and (a) injects
  `PERSONAS_DEV_PROJECT_ID` into the personas-mcp sidecar so the context MCP
  tools (`resolve_context_project`) resolve that project, and (b) overrides the
  `CODEBASE_ROOT_PATH` / `CODEBASE_PROJECT_NAME` / `CODEBASE_TECH_STACK` /
  `CODEBASE_PROJECT_ID` env vars from the pinned project (pushed after the
  credential env so it wins). Unpinned personas keep the global-probe fallback.

This is what lets N teams each work their own repo (e.g. one SDLC team per repo).

## Athena: create projects + scan from chat

Athena (the companion) can drive Dev Tools from the chat window when the Dev
Tools plugin is enabled:

- **`register_project`** (name + path) creates the real `dev_projects` row (so the
  codebase connector becomes available for a team on that repo) and auto-launches
  a context scan for a newly-created project.
- **`enqueue_dev_job` with `kind:"scan_codebase"`** runs a real context scan on a
  registered project (resolved by id, path, or name; falls back to the most-recent
  project). This is the precise "scan / map / index the codebase" operation — it
  changes nothing and does **not** build an agent. Athena's prompt explicitly
  separates a scan request from `build_oneshot` (build-an-agent), so "scan repo X
  for bugs and tests" runs a context scan (and points at the SDLC team's reviewer)
  rather than spinning up a new persona.

> **Note:** A successful scan used to raise a false "scan failed" OS
> notification. The cause was a payload-shape mismatch: the event carries a
> `ContextGenSummary` (with `status`), but the listener read a non-existent
> `event.payload.success` field — always `undefined` → treated as failure. The
> failure path never emits `context-gen-complete` at all, so receiving the event
> always means the scan succeeded. Fixed by deriving success from `status`.
