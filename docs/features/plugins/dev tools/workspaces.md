# Workspaces

> Group your dev projects into a **workspace** (your "org"): a named, coloured
> set of projects that the switchers, the Skills registry view, the Architect and
> the export picker all treat as one unit.

**UI:** Plugins → Dev Tools → **Workspaces** (`src/features/plugins/dev-tools/sub_workspaces/`)
**Backend:** `src-tauri/src/commands/infrastructure/dev_workspaces.rs` → `db/repos/dev_workspaces.rs` (a re-export shim over `db/repos/workspaces/org.rs`; the never-delete guards live in `workspaces/protection.rs`)
**Tables:** `dev_workspaces`, plus nullable `dev_projects.workspace_id`

## Concepts

- **Workspace** — a named, coloured group of dev projects. A project belongs to at
  most one workspace (`dev_projects.workspace_id`, NULL = unassigned). The old
  localStorage prototype (`devtools.workspaces.v1`) is imported automatically on
  first open (idempotent by name), and the footer workspace switcher + Project
  Manager tabs read the database. The UI is the **Atlas** shell: a crest-card
  grid showing each workspace's member count and members; the selected
  workspace unfolds a detail band with identity (rename / recolour / delete),
  the membership editor and the workspace's paired **knowledge registry**.
- **Adopt default skills** — the create-workspace form carries a checkbox
  (`dev_workspaces.adopt_default_skills`, default off — consent is explicit):
  when on, every project later assigned to the workspace gets the app's preset
  `scan-*` skills installed automatically (system-skill lane, skip-existing),
  and the workspace's crest shows a **Presets** badge. See the Skills section of
  `dev-tools.md` for the preset catalog itself.
- **Protected workspace** — the `last_working_version` never-delete tag. When
  set, every delete door that would remove the workspace, one of its projects,
  that project's team, or that team's personas' charters refuses.
- **Knowledge registry** — a workspace can be paired with a working copy of the
  organisation's ai-registry. The registry is the knowledge authority; the app
  **reads** it (Overview → Patterns: the Subjects and Coverage lanes) and never
  ingests it into SQLite.

## Commands

`dev_tools_workspace_list / create / update / delete / assign_project / import_local`
— wrappers in `src/api/devTools/workspaces.ts`. The headless bridge adds
`GET /dev-tools/workspaces` and `POST /dev-tools/workspaces/{id}/protect`.

## The workspace's group on the Fleet board

Creating a workspace creates one team that belongs to no project and carries the
workspace's id — the workspace's *cross-project group*. It is where personas that work
across every project in the workspace are filed, and it is the workspace's one presence
on **Fleet ▸ Activity**: pinned to the front of the board and drawn as a framed panel,
visible from the moment the workspace exists rather than from the moment somebody is
filed in it. The column's header rule carries the workspace's own colour, so the swatch
picked here is what identifies the group on the board.

The route runs both ways: right-clicking that column's header offers **Open workspace**,
which selects the workspace here and opens this page, or renames the group in place.

Workspaces that pre-date the column got theirs by backfill, and a workspace that had
already been given a hand-made project-less group kept it, with its members, rather
than being given a second one. Renaming a workspace renames its group; deleting one
unbinds the group rather than taking it down.

## Retired: the Workspace Knowledge Center (2026-09-14)

Until 2026-09-14 a workspace also carried a DB-backed, governed practice
library — the "Workspace Knowledge Center". The operator retired it: *"Workspace
knowledge should be deleted as we use external registry for the knowledge."*
Everything below was removed, code and data.

- **UI:** the Overview → Patterns **Practices** lane (library, topic tree,
  practice detail / rollout / create modals, Pulse, playbooks rail, Extract
  menu), the Approvals **Workspace Knowledge** mode, the `practice` kind in the
  unified triage deck, the practice tallies on the Atlas crests, and the
  harvest-coverage and practice-adoption halves of the registry Coverage lane.
- **Commands:** every `dev_tools_workspace_knowledge_*`, `_evidence_*`,
  `_adoption_*`, `_harvest_*`, `_run_miners`, `_run_divergence` /
  `_get_divergence_status` / `_cancel_divergence`, `_verify_adoptions` /
  `_get_verify_status`, `_project_practices`, `_backfill_practice_ideas`,
  `_roll_up_doctrine`, the playbook / pattern-edge / consult-stats /
  practice-context-rollup commands, and `dev_tools_promote_persona_knowledge`.
  The `/dev-tools/patterns/*` bridge routes (index, consult, propose, get) are
  gone too, as are Athena's `describe_knowledge`, `run_pattern_harvest`,
  `apply_pattern` and `evaluate_pattern` ops (constitution v62).
- **Backend side effects:** accepting, rejecting or dispatching a backlog idea
  no longer syncs a practice adoption cell; joining a workspace no longer seeds
  adoption cells or projects a `.claude/workspace-practices.md` bundle into the
  member repo; boot no longer back-fills practice ideas.
- **Data:** the incremental migration `retire_workspace_knowledge`
  (`db/src/migrations/incremental/e28_retire_workspace_knowledge.rs`) drops the
  nine tables — `workspace_knowledge`, `workspace_knowledge_evidence`,
  `workspace_practice_adoption`, `workspace_practice_context_state`,
  `workspace_pattern_edges`, `workspace_playbooks`,
  `workspace_playbook_patterns`, `workspace_consult_log`,
  `workspace_harvest_coverage` — with their indexes, children before parents.
  It is unconditional (the data was the reason for the change: ~112 MB of a
  347 MB database on the operator's machine) and the older CREATE / ALTER steps
  were removed so the replay-on-every-boot chain cannot re-create them. The
  space returns to SQLite's freelist; the file shrinks on the next `VACUUM`.
- **Portability:** bundles still carry workspace rows under the
  `workspace_knowledge` key, but no knowledge entries or adoption cells. Older
  bundles that do carry them still import; the extra arrays are ignored.

Left behind on purpose: backlog ideas already filed with origin
`workspace_practice` keep rendering (the origin stays in `FINDING_ORIGINS`), and
any `.claude/workspace-practices.md` bundle a projection already wrote into a
member repo stays on disk until someone deletes it there.
