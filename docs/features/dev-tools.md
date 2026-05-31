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
| Overview | `sub_overview` | Per-project metrics rollup. Six vital-sign tiles (issues, PRs, commits, unresolved, events 24h/7d) are drag-reorderable (order persists per project) and clickable: repo tiles deep-link to the connected GitHub/GitLab subpage, monitoring tiles reveal the Sentry connection chain. The header carries a live "updated Nm ago" timestamp and a manual Refresh control. |
| Projects | `sub_projects` | Register, edit, archive projects (see below). |
| Goals | `sub_goals` | Track project goals across **Board** (your-turn / agent's-turn / done kanban, with inline checklist to-dos that drive completeness) and **Map** (pan/zoom React Flow canvas — draggable persisted nodes, minimap, level-of-detail nodes, Now/Next highlighting over dependency edges), with `+ New goal` authoring and a detail drawer (checklist + hybrid progress nudge + team-step intervention + activity feed). **Goals is now also a top-level sidebar section**; this tab is a contextual shortcut to the same surface. Full reference: [`../goals/README.md`](goals/README.md). |
| Context Map | `sub_context` | Codebase scan results: groups, contexts, entry points, keywords. |
| Idea Scanner | `sub_scanner` | Generate improvement ideas from the codebase. |
| Idea Triage | `sub_triage` | Accept / reject scanned ideas into the backlog. |
| Task Runner | `sub_runner` | Execute implementation tasks against a project. |
| Lifecycle | `sub_lifecycle` | Project lifecycle controls. |
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

### Create / edit project (`ProjectModal.tsx`)

The dialog is grouped into three labelled sections — **Project**, **Source
control**, and **Workspace** — under a title + subtitle, in a roomy two-column
layout.

- **Folder first:** pick a project folder. The **project name is auto-extracted
  from the folder name** and pre-filled; the field stays editable (a pencil
  affordance + an "auto-filled from folder" hint), and editing it stops the
  auto-fill from overwriting your choice.
- **Project type** — optional visual tag (React, NodeJS, Rust, …).
- **GitHub connector** — bind a vault GitHub PAT (persisted as
  `pr_credential_id`) that authorises PR / source-control ops **and drives the
  repository picker beside it**: the searchable repo dropdown lists
  repositories from the selected connector (re-fetching when you change it),
  falling back to auto-discovery of the first usable PAT, or to a manual URL
  input when no healthy credential exists. A picked repo shows an inline preview
  (owner/name, private badge, description, open ↗); manual URLs are validated
  with an inline error when malformed.
- **Bound team** — optional; binds the project to a PersonaTeam pipeline.
- **Test environment** — optional URL + branch of the *living test environment*
  this project's team delivers into (e.g. a staging/preview deployment such as
  `https://staging.example.com` on branch `main`). Both fields live in the
  **Source control** section and are most useful when editing an existing
  project. The URL is persisted as `test_env_url` and the branch as
  `test_env_branch`; clearing either field removes that binding.
- **Create Codebase connector** (create mode only, on by default) — when
  checked, creating the project also creates a `Codebase — <project name>`
  connector (`service_type: codebase`) wired to the project, so agents can read
  the codebase immediately without opening the credential catalog and adding one
  manually. Unchecking skips it; the connector can still be added later from the
  catalog (Connections → Catalog → Codebase).
- After creation the modal offers to **run a context map scan** right away.

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
