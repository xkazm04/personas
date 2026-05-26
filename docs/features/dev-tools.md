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
| Overview | `sub_overview` | Per-project metrics rollup. |
| Projects | `sub_projects` | Register, edit, archive projects (see below). |
| Goals | `sub_goals` | Track project goals. A variant tab strip switches between four views: **Constellation** (force-directed graph), **Project Pulse** (triage + spotlight), **Dependency Flow** (dependency-aware swimlanes), and **Kanban** (your-turn / agent's-turn / done board). **This is the home for goal management** — the Projects tab no longer embeds a goal board. |
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
open-folder, and GitHub-issue-import row actions. Selecting a row makes it the
**active project** (a compact summary banner) and the active selection drives
the project-selector banner on the other tabs.

### Create / edit project (`ProjectModal.tsx`)

- **Folder first:** pick a project folder. The **project name is auto-extracted
  from the folder name** and pre-filled; the field stays editable (a pencil
  affordance + an "auto-filled from folder" hint), and editing it stops the
  auto-fill from overwriting your choice.
- **Project type** — optional visual tag (React, NodeJS, Rust, …).
- **GitHub** — a searchable repo picker when a healthy GitHub PAT credential
  exists, otherwise a manual URL input (muted placeholder).
- **Bound team** — optional; binds the project to a PersonaTeam pipeline.
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

> **Note:** A successful scan used to raise a false "scan failed" OS
> notification. The cause was a payload-shape mismatch: the event carries a
> `ContextGenSummary` (with `status`), but the listener read a non-existent
> `event.payload.success` field — always `undefined` → treated as failure. The
> failure path never emits `context-gen-complete` at all, so receiving the event
> always means the scan succeeded. Fixed by deriving success from `status`.
