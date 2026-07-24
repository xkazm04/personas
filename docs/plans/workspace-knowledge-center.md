# Workspace Knowledge Center — cross-project best practices at workspace scale

**Status:** design approved (2026-07-24), Arc 1 (P0+P1) ready to build
**Author:** fable-5 design session with user; exploration digests from 5 parallel agents
**Decisions locked by user:** (a) single workspace per project (nullable `dev_projects.workspace_id`), (b) P0+P1 combined into one arc, (c) key UI design decisions go through `/prototype` (3 directional variants each, pick or fuse).

---

## 1. Vision

Personas manages a growing portfolio of dev projects. Projects differ in business domain, language, and scope — yet together they generate reusable good practice in **design, code quality, UI, and performance**. Today that knowledge evaporates: each repo's conventions live only in its own CLAUDE.md and each session's memory.

The Workspace Knowledge Center makes the **workspace** (a named group of projects — the "org") the container for a governed, provenance-carrying library of practices that:

1. is **harvested** from member repos by agents (Fleet-dispatched skill runs + deterministic miners),
2. is **adjudicated** by the user (agents propose, humans adopt — never auto),
3. is **distributed** back into member repos (push: adopt-dispatch per repo; ambient: CLAUDE.md projection into every future CLI session),
4. **scales autonomously**: a newly registered 10th project inherits the whole adopted ladder as a to-adopt queue; scheduled sweeps keep the library current as the workspace grows.

Skills are part of the same center: a skill is the executable form of a practice, and workspace becomes a third skill scope between `global` and `project`.

## 2. What the codebase gives us (exploration findings)

| Fact | Where | Consequence |
|---|---|---|
| No workspace entity exists; `dev_projects.group_id` is orphaned (absent from struct + bindings) | `src-tauri/src/db/models/dev_tools.rs:84`, `src/lib/bindings/DevProject.ts` | Do NOT resurrect `group_id`; mint `workspace_id` |
| A localStorage workspace prototype already exists and anticipates DB promotion | `src/features/plugins/dev-tools/sub_workspaces/workspaceStore.ts` (header comment), `SwitcherBreadcrumb` in `DesktopFooter.tsx:543`, `WorkspaceTabs` in `ProjectManagerPage.tsx` | P0 = finish a planned promotion, keep UI contracts (`useWorkspaces()`, selectors) stable |
| "Workspace facet" on `persona_teams` is an execution-crew concept (one team per project) | `src-tauri/src/db/models/team.rs:11-28` | Teams ≠ workspaces. Don't conflate; keep both axes |
| Skills scope is exactly `global \| project`; zero workspace wiring | `skill_files.rs:60`, `useSkillData.ts:12` | Workspace = third `source_kind`; extension points enumerated §9 |
| Brainiac-adoption P1/P2 already shipped: `skill_registry` + content-hash revisions, transcript-mined usage events, dormancy | `src-tauri/src/commands/infrastructure/skill_usage.rs`, `docs/plans/brainiac-adoption-skills-memory-docs.md` | This plan is the next phase of that arc |
| SkillsWorkbench (Atrium) is the single skills surface, **owned by a parallel session right now** | `src/features/teams/sub_factory/passport/improve/SkillsWorkbench.tsx`, ledger entry `mastermind-fleet-dispatch-and-skill-run` | Workspace skills lane sequenced LAST (P4), after that surface settles |
| Memory engine: `InjectionScope` documents "new scope axis = 3-line change"; `home_team_id` is the only sharing scope (single-team); `knowledge_health_snapshots.scope_kind` already reserves `'project'` | `db/repos/core/memories.rs:1285,1331`, `db/models/memory.rs:89-255` (MEMORY CONTRACT), `incremental.rs:4191` | Workspace knowledge gets its own store (see D3); persona-recall wiring deferred but cheap |
| Dev-event→memory bridge exists but only for idea accept/reject | `record_idea_decision`, `commands/infrastructure/dev_tools.rs:1249` | Generalize for project-scoped operational memory (P3+) |
| Proven app→repo skill dispatch contracts: context-block dispatch + prepare/ingest command pair | `passport/onboardDispatch.ts`, `commands/infrastructure/kpi_sim.rs` | `practice-harvest` copies these shapes exactly |
| Passport already extracts real framework names + versions per repo | `RepoEvidence.frameworks` (passport wall, commit `c2a194f36`) | Applicability auto-matching (D2) is free |
| Cross-project aggregation is portfolio-wide or team-scoped, never workspace | `dev_tools_portfolio_summary`, passport wall, Mastermind | Matrix/aggregation views need a workspace filter, not new plumbing |

### Brainiac concepts adopted (and what we skip)

Adopt (all DB-agnostic): the memory-unit shape (`kind`: fact/decision/pattern/pitfall/howto), the **governance ladder** (raw→candidate→canonical, renamed here `observed→proposed→adopted`), provenance + temporal validity + `superseded_by`, **"rejection is knowledge"** (rejected items retained; miners dedup against them for 90 days), **practice-divergence detection** (same problem, N locally-reasonable solutions — visible only in aggregate; the project-axis prompt runs more conservative than team-axis because apps legitimately differ), **deterministic library miners** (signal before LLM spend), the **projection principle** (digest/docs are compiled views over knowledge, never a second source of truth), and the health pillar math (consistency/currency/liquidity/governance) as a pure function.

Skip: Postgres RLS/multi-tenancy, pgvector+RRF hybrid retrieval (desktop corpus is small; FTS5 later if needed), BYOM gateway, external publishers, Cedar/SCIM/blob store.

## 3. Design decisions

- **D1 — Workspace entity:** promote the prototype to `dev_workspaces` + nullable `dev_projects.workspace_id` (single workspace per project — user decision). One-time localStorage import (`devtools.workspaces.v1`). `persona_teams` untouched.
- **D2 — Heterogeneity via applicability, not uniformity:** every practice declares `applicability` (layers: design/code-quality/ui/performance/process; languages; frameworks; free-form conditions). Matched against passport `RepoEvidence` → non-matching projects show `na` in the adoption matrix, never "failing."
- **D3 — Workspace knowledge is its OWN store, not a persona-memory extension:** persona/team memory = agent behavior, decay-ranked, injected into persona prompts. Workspace knowledge = codebase practices, governed lifecycle, must never silently decay; consumers are CLI sessions + humans. The `InjectionScope` seam stays available if personas should later recall workspace knowledge (3-line change, deferred).
- **D4 — Adoption is per-project state** (`workspace_practice_adoption`): the scaling surface and the matrix view. New member project ⇒ automatic to-adopt queue for every applicable adopted practice.
- **D5 — Agents propose, humans adopt.** All extraction paths land as `observed`/`proposed`; only the user moves items to `adopted`. No automatic adoption, ever.
- **D6 — Distribution = push + ambient:** push adopts via Fleet dispatch (statement + evidence + "customize for this codebase", mirroring `skillTasks.ts` adopt prompts); ambient via a **managed CLAUDE.md section** in each member repo (pattern: `engine/claude_md_projection.rs`) so every future CLI session carries adopted standards at zero dispatch cost. Weekly digest = time-windowed projection, recomputed not stored.
- **D7 — Extraction engine = skills + miners:** `practice-harvest` skill per repo (context-block dispatch + ingest command), in-app divergence pass across members, deterministic Rust miners over `dev_ideas` dedup-keys and skill-usage telemetry.
- **D8 — Workspace skills scope:** `source_kind` gains `workspace`; files live in an app-data hub dir (`<app-data>/workspaces/<id>/skills/`) because `~/.claude/skills` is user-wide and cannot distinguish workspaces. Sequenced P4 (parallel-session coordination).
- **D9 — Naming:** entity/table prefix `dev_workspaces` / commands `dev_tools_workspace_*`. Avoid collision with `commands/infrastructure/dev_tools/workspace.rs` (git-worktree engine, unrelated) and `engine/workspace_sync/` (cross-device DB sync, unrelated) — never import from or extend those for this feature.

## 4. Data model (Arc 1 migrations)

```sql
CREATE TABLE dev_workspaces (
  id          TEXT PRIMARY KEY,          -- 'ws-' || nanoid
  name        TEXT NOT NULL,
  color       TEXT,                      -- prototype swatch carries over
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

ALTER TABLE dev_projects ADD COLUMN workspace_id TEXT REFERENCES dev_workspaces(id);
-- nullable; single workspace per project (D1). NULL = unassigned.

CREATE TABLE workspace_knowledge (
  id                TEXT PRIMARY KEY,    -- 'wk-' || nanoid
  workspace_id      TEXT NOT NULL REFERENCES dev_workspaces(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK(kind IN ('pattern','pitfall','decision','howto','fact')),
  title             TEXT NOT NULL,
  statement         TEXT NOT NULL,       -- distilled claim; the retrieval/display surface
  detail_md         TEXT,                -- evidence verbatim: code, config, before/after
  applicability     TEXT,                -- JSON {layers:[],languages:[],frameworks:[],conditions:[]}
  status            TEXT NOT NULL DEFAULT 'observed'
                    CHECK(status IN ('observed','proposed','adopted','deprecated','rejected')),
  origin_project_id TEXT,                -- nullable; which repo it was harvested from
  provenance        TEXT,               -- JSON {actor_kind:'human'|'agent'|'miner', session_key, scan_id, model_ref}
  confidence        REAL,               -- extractor 0..1; NULL for human-authored
  dedup_key         TEXT,               -- miner idempotency; checked against rejected within 90d
  superseded_by     TEXT,               -- forward pointer on deprecation
  valid_from        TEXT, valid_to TEXT,
  decided_at        TEXT,               -- when user adopted/rejected
  created_at        TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_wk_ws_status ON workspace_knowledge(workspace_id, status);
CREATE INDEX idx_wk_dedup ON workspace_knowledge(workspace_id, dedup_key);

CREATE TABLE workspace_practice_adoption (
  practice_id      TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  state            TEXT NOT NULL CHECK(state IN ('na','proposed','dispatched','adopted','diverged')),
  fleet_key        TEXT,                -- passport-style dedup key of the adopt dispatch
  note             TEXT,
  last_verified_at TEXT,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (practice_id, project_id)
);
```

Later (P5): `knowledge_health_snapshots.scope_kind` CHECK gains `'workspace'`.

Rust models in `db/models/dev_tools.rs` with `#[derive(TS)] #[ts(export)]` → `src/lib/bindings/{DevWorkspace,WorkspaceKnowledge,WorkspacePracticeAdoption}.ts`; regen via `cargo test export_bindings`.

## 5. Command surface (Arc 1)

All in `commands/infrastructure/dev_tools.rs` (+ repo fns in `db/repos/dev_tools.rs`), `require_auth_sync`, registered in `lib.rs` generate_handler, then `node scripts/generate-command-names.mjs`:

- `dev_tools_workspace_list / _create / _update / _delete` — CRUD. Delete keeps projects (nulls `workspace_id`).
- `dev_tools_workspace_assign_project(project_id, workspace_id | null)` — single-assignment move.
- `dev_tools_workspace_import_local(payload)` — one-time localStorage prototype import (idempotent on name).
- `dev_tools_workspace_knowledge_list(workspace_id, status?)` / `_create` / `_update` / `_decide(id, adopt|reject|deprecate, superseded_by?)` — `_decide` stamps `decided_at`; adopt fans out `workspace_practice_adoption` rows (`proposed` for applicable projects, `na` otherwise, applicability matched against project tech evidence).
- `dev_tools_workspace_adoption_list(workspace_id)` / `_set(practice_id, project_id, state, note?)` — the matrix.

Arc 2 (P2) adds `dev_tools_workspace_knowledge_ingest(workspace_id, project_id, items[])` — the harvest-skill write-back, modeled on `kpi_sim.rs` prepare/ingest (validates, dedups vs `dedup_key` incl. 90-day rejected window, lands everything as `observed`).

Frontend wrappers in `src/api/devTools/devTools.ts` (`safeInvoke` pattern).

## 6. UI module — Dev Tools ▸ Workspaces

Registration (from the plugin-conventions digest, exact seams):

1. `src/lib/types/types.ts:411` — `DevToolsTab` union + `"workspaces"`.
2. `DevToolsPage.tsx` — lazy import + `{devToolsTab === 'workspaces' && <WorkspacesPage/>}`.
3. `src/features/shared/chrome/sidebar/sidebarData.ts:128` — `devToolsItems` entry (icon suggestion: `Network` or `Landmark`).
4. `src/lib/analytics/navCatalog.ts:82` — `DEV_TOOLS_TABS` (build breaks without it).
5. i18n: `plugins` section keys in `en.json` + full 13-locale translation via the extract/merge pipeline (strict gate).
6. `scripts/docs/feature-doc-map.json` — dedicated entry → `docs/features/plugins/dev tools/workspaces.md` (write the doc in the same arc).
7. Store: promote `sub_workspaces/workspaceStore.ts` to backend-backed (keep `useWorkspaces()` / selector API stable so `SwitcherBreadcrumb` + `WorkspaceTabs` keep working); one-time localStorage import on first mount.

### /prototype rounds (user decision: 3 directional variants per key decision, pick or fuse)

The three genuinely open UI decisions, each a `/prototype` round behind a tab switcher inside the new page:

- **Round A — module shell.** How workspace selection, membership, and knowledge coexist on one page. Variants: (A1) master-detail — workspace rail left, detail right; (A2) card dashboard — one card per workspace with inline stats, click-through to detail; (A3) single-active-workspace cockpit — footer switcher is the selector, page is all detail (leans on the existing `SwitcherBreadcrumb`).
- **Round B — knowledge library + review queue.** Variants: (B1) governed ledger — one list, status as ink/inks (passport visual language), filters; (B2) ladder board — columns per status (observed → proposed → adopted), items move right as they're adjudicated; (B3) review-first inbox — proposed queue front and center with accept/reject, adopted library behind a tab.
- **Round C — adoption matrix cell.** Variants: (C1) passport-wall ink cells (reuse `InkWallCell` language, state-tinted); (C2) compact chips-per-project inside each practice row; (C3) heat/coverage bar per practice with a popover for per-project state + dispatch action.

Each round: build variants → user picks or fuses → consolidate winner → delete losers (the `/prototype` skill's own consolidation ritual). Design.md tokens throughout; shared components (`SegmentedTabs`, `BaseModal`, `EmptyState`, `Tooltip`, `RelativeTime`) — no hand-rolling.

## 7. Extraction engine (Arc 2 / P2 — contract sketch)

- **`practice-harvest` skill** (`.claude/skills/practice-harvest/`): dispatched per member repo via Fleet with a composed context block (workspace name, member roster + stacks, existing adopted practices to avoid re-proposing, rejected dedup keys). Mines: repo conventions (lint configs, design tokens, CI, perf patterns), plus the app's own signal handed in the context block (`dev_ideas` findings, `standards_config`, passport evidence). Writes back through `workspace_knowledge_ingest`. Most target repos never need the skill installed — same doctrine as kpi-sim (the app dispatches the contract).
- **Divergence pass** (in-app LLM call or hub-checkout skill run): clusters candidates + adopted practices across members sharing a concern; where N projects solve the same problem differently, proposes ONE recommended practice with per-project current-approach evidence. Conservative bar (apps legitimately differ — Brainiac's project-axis lesson).
- **Deterministic miners** (pure Rust, no LLM): (a) `dev_ideas` findings with matching `dedup_key` across ≥2 member projects → propose as shared pitfall; (b) skill-usage telemetry: a skill heavily used in one project and absent in siblings → propose adoption. Both respect the 90-day rejected window.

## 8. Distribution (Arc 3 / P3 — contract sketch)

- **Adopt-dispatch:** matrix cell action → Fleet `spawnSession(project.root_path, [instruction])` with statement + `detail_md` evidence + customize-for-this-codebase instruction (mirrors `skillTasks.ts` `adoptTaskPrompt`); `fleet_key = workspace:<practice>:<slug>` dedup; session outcome flips state `dispatched → adopted`.
- **Ambient CLAUDE.md projection:** managed marker section (`<!-- personas:workspace-practices -->`) in each member repo's CLAUDE.md, regenerated from adopted+applicable practices on adoption change — pattern from `engine/claude_md_projection.rs`. This is the autonomy lever: every future CLI session in any member repo carries the standards.
- **Digest:** "adopted/deprecated/proposed this week" — computed view in the module (and later a Mastermind surface), never stored.
- **Verification:** rescans can flip `adopted → diverged` when evidence contradicts (surface only; never auto-un-adopt).

## 9. Memory & skills integration (Arc 3+/P4 — seams already identified)

- **Project-scoped operational memory:** generalize `record_idea_decision` (`dev_tools.rs:1249`) into a dev-event→memory writer (adopt/reject decisions, notable fleet outcomes → `team_memories` via `dev_projects.team_id`, proposal-gated as today). Practice adopt/reject decisions SHOULD write team memory (consistent with the review-decision memory pattern).
- **Workspace memory:** `workspace_knowledge` IS the workspace-scoped memory for dev activities (D3). Persona-recall wiring deferred; if wanted later: `InjectionScope` axis + predicate (`memories.rs:1285,1331`) + `knowledge_health_snapshots.scope_kind += 'workspace'`.
- **Workspace skills (P4, after the parallel SkillsWorkbench session settles):** `source_kind`/`SkillSource` gain `'workspace'`; hub dir `<app-data>/workspaces/<id>/skills/`; `skills_dir` resolution + registry `scope` column extend; SkillsWorkbench gains a workspace lane (adopt from workspace / share to workspace). Provenance sidecar (`.personas-skill-meta.json`) already models source→copy sync; also fix: the LLM adopt/share path should write the sidecar (today only raw `skill_files_install` does).

## 10. Implementation plan

### Arc 1 (this arc): workspace entity + knowledge base + module

Work in a worktree (`.claude/worktrees/workspace-center`), atomic commits per phase, ledger discipline.

1. **DB + backend:** migrations (§4), models + ts-rs export, repo fns, commands (§5), `lib.rs` registration, command-names regen, bindings regen/commit.
2. **Store promotion:** `workspaceStore.ts` → backend-backed (stable hook API), localStorage import, `SwitcherBreadcrumb`/`WorkspaceTabs` verified unchanged.
3. **Module registration:** tab + sidebar + navCatalog + skeleton page (§6 items 1–6).
4. **/prototype Round A** (shell) → user gate → consolidate.
5. **/prototype Round B** (knowledge library/review) + manual authoring + `_decide` flow → user gate → consolidate.
6. **/prototype Round C** (adoption matrix, manual state setting only in this arc) → user gate → consolidate.
7. **Finish:** i18n 13 locales (pipeline), feature doc `docs/features/plugins/dev tools/workspaces.md` + map entry, vitest coverage for store/derivations, full gates (`npm run check`, `check:i18n:strict`, vitest, clippy + cargo test if Rust), live-verify via test-automation.

Definition of done: create workspace → assign projects → author a practice → propose→adopt → matrix shows per-project states — all persisted in SQLite, all three UI rounds consolidated.

### Later arcs
- **Arc 2 (P2):** ingest command + `practice-harvest` skill + miners + divergence → review queue fills itself.
- **Arc 3 (P3):** adopt-dispatch, CLAUDE.md projection, digest, diverged verification; dev-event→memory writer.
- **Arc 4 (P4):** workspace skills scope + Workbench lane (coordinate with the Atrium owner-session).
- **Arc 5 (P5):** scheduled sweeps, workspace health pillars, Mastermind "workspace alignment" surfacing.

## 11. Risks & coordination

- **Parallel session ownership:** `sub_factory/passport/improve/**` (SkillsWorkbench) is actively owned by the `mastermind-fleet-dispatch-and-skill-run` session — Arc 1 must not touch it; P4 waits.
- **Naming traps (D9):** `workspace.rs` (worktree engine) and `workspace_sync/` (device sync) are unrelated — never extend them.
- **Prototype scope creep:** three rounds is the ceiling for Arc 1; further visual polish goes through normal iteration, not more variants.
- **Cross-repo writes (CLAUDE.md projection, Arc 3):** writing into member repos' CLAUDE.md needs the managed-marker discipline + never stomping uncommitted user edits — design detail deferred to Arc 3.
