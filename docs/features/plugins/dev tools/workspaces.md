# Workspaces — Workspace Knowledge Center

> Group your dev projects into a **workspace** (your "org") and grow a governed,
> cross-project best-practice library inside it: practices are harvested from
> member repos, adjudicated by you, and distributed back — so good design, code
> quality, UI and performance patterns discovered in one project lift all of them.

**Design & full arc:** [`docs/plans/workspace-knowledge-center.md`](../../../plans/workspace-knowledge-center.md)
**UI:** Plugins → Dev Tools → **Workspaces** (`src/features/plugins/dev-tools/sub_workspaces/`)
**Backend:** `src-tauri/src/commands/infrastructure/dev_workspaces.rs` → `db/repos/dev_workspaces.rs`
**Tables:** `dev_workspaces`, `workspace_knowledge`, `workspace_practice_adoption`, plus nullable `dev_projects.workspace_id`

## Concepts (Arc 1 — shipped)

- **Workspace** — a named, coloured group of dev projects. A project belongs to at
  most one workspace (`dev_projects.workspace_id`, NULL = unassigned). The old
  localStorage prototype (`devtools.workspaces.v1`) is imported automatically on
  first open (idempotent by name), and the footer workspace switcher + Project
  Manager tabs now read the database. The UI is the **Atlas** shell (a crest-card
  grid; the selected workspace unfolds a detail band with membership + library).
  The library listing is the shared **DataGrid** (paginated, per-column
  sortable/filterable) beside an emergent slash-path **topic tree** derived from
  the items — crisp at hundreds of practices. A **Demo corpus** toggle blends in
  a deterministic sample dataset so scale is visible before harvesting exists
  (demo rows never touch the database).
- **Knowledge item (practice)** — a governed unit of cross-project knowledge:
  `kind` (pattern / pitfall / decision / howto / fact), a distilled `statement`,
  optional evidence (`detail_md`), a slash-path `topic` (`ui/motion/reveals`)
  that drives the library's arbitrary-depth tree, and an `applicability`
  envelope (layers, languages, frameworks) so a practice only targets the
  projects it can apply to. Author one by hand via **New practice** in the
  library header (lands as `proposed`); the harvest engine (Arc 2) fills the
  rest automatically.
- **Governance ladder** — `observed` (machine-harvested) → `proposed` →
  `adopted` / `rejected`, plus `deprecated` (optionally superseded by a newer
  practice). **Agents only ever propose; adoption is always your decision.**
  Rejected items are kept so future extraction runs don't re-propose them.
- **Adoption matrix** — adopting a practice fans it out to every member project as
  a per-project state: `proposed` (to adopt), `na` (not applicable to that
  stack), `dispatched`, `adopted`, or `diverged`. A project newly assigned to the
  workspace automatically inherits every applicable adopted practice as its
  to-adopt queue — the library scales with the workspace.

## Commands

`dev_tools_workspace_list / create / update / delete / assign_project / import_local`,
`dev_tools_workspace_knowledge_list / create / update / decide / delete`,
`dev_tools_workspace_adoption_list / set` — wrappers in `src/api/devTools/workspaces.ts`.

## Later arcs (planned)

Harvest skill + divergence detection + deterministic miners (Arc 2), adopt-dispatch
via Fleet + managed CLAUDE.md projection into member repos + weekly digest (Arc 3),
workspace-scoped skills (Arc 4), health pillars + Mastermind alignment (Arc 5).
