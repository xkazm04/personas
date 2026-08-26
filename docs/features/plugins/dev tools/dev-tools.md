# Dev Tools

> An AI-guided development pipeline that turns any codebase into a managed project — scanned into semantic contexts, mined for improvement ideas by 21 specialized agents, triaged Tinder-style, executed as tasks, and shipped as draft pull requests with agent reasoning attached.

> **Folder index:** [`README.md`](./README.md). For the cross-surface picture read
> [`cx-map.md`](./cx-map.md) (the terrain for the 2026-07 CX/UX rethink); for the
> shipped detect→verify→learn loop read [`findings-loop.md`](./findings-loop.md).
> ⚠ The "Five development directions" section below predates the findings loop —
> treat it as history, not a plan.

The plugin lives at `src/features/plugins/dev-tools/` and is exposed through the **Plugins → Dev Tools** entry in the sidebar. The Rust surface lives at `src-tauri/src/commands/infrastructure/dev_tools.rs` plus sibling modules for the long-running operations (`context_generation.rs`, `idea_scanner.rs`, `task_executor.rs`).

---

## What it does

Dev Tools treats each linked repository as a *Dev Project*.

> **Consolidated (2026-07) — project surfaces moved to the "Projects" section.**
> The top-level **Teams** section was rebranded **Projects** and is now the home
> for project-level work. **Project management** (the old Dev Tools "Projects"
> CRUD tab), **Goals**, **Lifecycle** (Dev Clone setup), and **Competition** all
> moved there (**Projects → Manage / Goals / Lifecycle / Competition / Factory**).
> Dev Tools now hosts the **dev-automation** surfaces only. The `dev_projects`
> domain model, the `PersonaTeam` roster (still called a "team"), and every
> backend command are unchanged — only *where the UI lives* changed. Sections 1
> and 7 below describe those surfaces at their new home.

Dev Tools tabs today:

| Domain | Direction | Storage / artifact |
|---|---|---|
| **Overview** (GitHub / GitLab / Sentry stats) | External → App | Read-through cache of open issues, PRs, commits, unresolved errors |
| **Observability** (LLM + app-monitoring mapping) | External → App | Two sub-tabs sharing one assignment-matrix pattern: **LLM** (`dev_projects.llm_tracking_credential_id`; use-case rollups from Langfuse / LangSmith / Helicone / LightTrack) and **Monitoring** (`dev_projects.monitoring_credential_id`; Sentry unresolved-issues + events 24h/7d via the shared `fetchSentryStats`; Better Stack listed but pending an adapter) |
| **Context Map** (semantic code domains) | App ↔ Codebase | `dev_context_groups` + `dev_contexts`, generated from a filesystem walk |
| **Idea Scanner** (21 LLM agents) | App → LLM → App | `dev_ideas` rows tagged with `scan_type` + per-scan history |
| **Idea Triage** — *moved to* **Overview › Approvals › Backlog** (accept / reject / delete) | Human → App | Idea status transitions; optional auto-triage rules. Also the landing point of the **findings spine** — Observability, the Factory passport, the golden-standard scan, and the KPI layer all emit into `dev_ideas` with `origin` / `evidence` / `dedup_key`, so every sensor feeds the same triage → task → PR loop |
| **Run Desk** (batched execution) | App → LLM → App | `dev_tasks` rows + live output buffer + PR Bridge card |
| **Fleet** (Claude Code session aggregator) | App ↔ CLIs | Per-session xterm terminals over the active project's cwd |
| **Workspaces** (Workspace Knowledge Center — see [`workspaces.md`](./workspaces.md)) | App ↔ App | `dev_workspaces` + `dev_projects.workspace_id` (project grouping, promoted from the localStorage prototype) + `workspace_knowledge` / `workspace_practice_adoption` (governed cross-project practice library + per-project adoption matrix) |

Moved to the **Projects** section (rendered by `PersonasPage` under `teamsTab`): **Manage** (project CRUD, formerly `sub_projects`), **Goals**, **Lifecycle** + **Competition** (formerly `sub_lifecycle`), and **Factory** (the project-readiness passport wall). Since the 2026-07 cockpit-prototype adoption the wall has **two views**: **Overview** (default — a 3-column grid of passport covers with a blockers digest; the first layer for looking at projects) and **Compare** (the row-aligned dimension matrix in "Focus ink": segmented level bars for ordinal rows, brand icons with visible tool names, healthy rows receding, blue "set up →" for unwired sensors). Covers morph between the views via framer-motion layout ids. All improve machinery (ImproveCell popovers, connector wiring, LlmTracking live spend, warning badges, golden gauge, trend, markdown export, sorts) is unchanged. The 2026-07-22 wall pass added: **row-label meaning popups** in Compare (every dimension label is a click-target that explains what the row measures), a **confirm popover on the header Rescan** (it re-runs the cross-project metadata scan fleet-wide, so it no longer fires on a stray click), the **"Context graph" row renamed to "Context coverage"** with its cell popover now offering the same two scan modes as the Context Map page (incremental re-scan / full re-scan, via `dev_tools_scan_codebase` delta_mode), and the **Reusable-skills cell redesigned**: it renders two tallies (skills *shared* with the global library / sibling projects by name vs skills *specific* to the codebase) and opens a full **Skills module** (modal, `improve/SkillsModal.tsx`) with two LLM-backed directions — *Adopt from library* (Claude installs the selected skills into the repo's `.claude/skills`, customized to that codebase's commands/layout/conventions) and *Share to library* (Claude generalizes a repo-specific skill — stripping hard-coded paths/commands — and publishes it to `~/.claude/skills`). Both directions dispatch Dev-runner tasks (`createTask` → `executeTask`, visible in the Task Runner + activity dock); the skills cell stays locked (spinning gear) until the run's terminal event, and the wall re-derives on completion. The Brainiac-adoption P0 pass (2026-07-22, plan: `docs/plans/brainiac-adoption-skills-memory-docs.md`) made two more automation-section dimensions real: **Agent memory** is now a probed ordinal (`none → adhoc → curated → governed`; from the repo's MEMORY.md/.claude/memory plus the Claude Code auto-memory dir `~/.claude/projects/<encoded-root>/memory` — index entries + freshness; `governed` unlocks with the P3 review/decay loop) instead of a hardcoded false, and a new **Documentation** row grades `none → README only → structured → source-synced` (docs/ census + a feature-doc-map manifest signalling managed source→doc coupling). Both feed the automation score and the golden-standard rubric, carry level ladders + "why this rating" provenance, and offer Dev-runner setup tasks (baseline docs / MEMORY.md seed) from their cell popovers. The P1 pass added **skill usage telemetry**: a SQLite `skill_registry` (identity + content-hash revision history, reconciled from `.claude/skills` on disk) plus an append-only `skill_usage_events` log **mined from Claude Code session transcripts** (`~/.claude/projects/<encoded-cwd>/*.jsonl` — `Skill` tool_use blocks and `<command-name>` markers, incremental per-file byte watermarks, deduped by session+skill+timestamp; `skill_usage_scan` / `skill_usage_overview` commands). The skills cell gains an amber **dormant** tally (installed ≥30d, zero invokes in the window — age-guarded so new skills never read as dead), the Skills modal shows per-skill `N× / 30d · last <when>` usage lines and drops share candidates whose content already exists in the library under another name, and dormant skills raise `skill_dormant` findings into the triage spine. The **P2 pass added the doc-rot loop** — Brainiac's `dirty_at`, localized as a git signal: `doc_rot_scan` (one bounded `git log --name-only` per repo, 6h-throttled) marks a doc **stale** when its coupled sources have newer commits, with coupling from the doc-map manifest when present, else from repo paths the doc itself references. The 2026-08 honesty pass fixed three structural blind spots in it. (a) **Scope**: the walk was `docs/**` + root README only, depth-first, and the 400-doc budget was spent on whichever deep tree it entered first — measured on this repo, **0 of 37 doc-map-managed docs were reachable** and `docs/features/**` was entirely absent, so the highest-authority coupling tier was dead in practice. `list_docs` now fills the budget in priority order (root README + doc-map-managed docs → **co-located docs**, i.e. a `*.md` in a directory that also holds source, which is where every `DESIGN.md` in this repo lives → the rest of `docs/**` breadth-first with a per-directory cap so one generated report tree cannot crowd out maintained pages), sorted throughout so the truncated set is stable run to run. (b) **Method**: git timestamps can never express "this doc names a file that no longer exists", so a second, independent **content** signal was added — a doc is **broken** when it references a repo path that is gone while its parent directory still stands (the renamed/deleted shape). Deliberately mechanical and heavily guarded against the truncated-token false positives that prose produces (`src/.../File.tsx`, `assets/domain-*-{dark,light}.svg`, a directory whose real name contains a space); it is not a semantic checker. (c) **The compounding hole**: a doc whose every reference had been renamed away coupled to nothing, went unscoped, and unscoped was *never dirty-able* — so the docs most likely to be rotten rendered as clean. Unscoped is now the reported verdict **`unverifiable`** ("could not be judged", never folded into the clean remainder), and the content check condemns exactly that doc independently of any coupling. Each row carries a `status` of **`broken` > `stale` > `unverifiable` > `clean`**, and Rust `//!` module headers stay explicitly out of scope: they have no git history separate from the file they live in, so the only available coupling is dir-level — the rule that marked 78% of docs dirty on the first fleet scan. The same transcript miner now also extracts **doc reads** (`Read` tool_use into repo markdown) into an append-only `doc_read_events` log stamped `was_dirty` at insert — so "agents grounding in stale docs" is measurable and ranks which rot actually hurts. Surfaces: the Documentation cell carries a `N stale · N broken · N unverifiable · M unread` sub-line (the maturity ladder itself stays stable; the `unverifiable` tally is never suppressed — an unjudged doc rendering as a clean one is the failure this sub-line exists to prevent), the "why this rating" provenance line says what was actually established rather than the old "all N tracked docs are current", the cell popover offers a "Refresh stale docs" Dev-runner task, and rotten docs raise harm-ranked `doc_rot` findings whose descriptions carry the exact changed sources or the exact missing paths — the accepted task updates what changed instead of rewriting the doc. The **P3 pass closed the memory loop**: `memory_claims` brings Brainiac's open-until-resolved dispute semantics to the persona/team memory engine (file `wrong`/`outdated` from the memory detail modal in Overview → Memories; open claims apply a bounded −35% tanh penalty in the decay scorer so disputed memories sink in recall AND age out faster, but never silently vanish; one human decision — reverify / deprecate-and-archive / dismiss — answers every open claim on the memory). Disputed memories raise `memory_disputed` findings mapped onto the owning team's project. `memory_health_scan` snapshots per-project **knowledge health** (currency = share of active memories inside 2× their category half-life; consistency = disputed drag; governance = review-proposal backlog vs a 7-day SLO; composite capped below 70 while ≥3 memories stand disputed) into an append-only trend table; the wall's Agent-memory cell shows `health N · M disputed` and the **`governed` rung now unlocks** when a curated repo memory is backed by a running team health loop. Deliberate deviations (recorded in the plan doc): no `valid_to`/`superseded_by` columns — the category half-life decay, working-tier 30-day expiry and ACTIVE_CAP already implement Brainiac's TTL/neglect in continuous form. The same-day env/cost pass split the environment-dependent dimensions **per environment**: the **Database**, **Hosting** and (new row) **Monitoring** cells each render three visually separated slots — **local / test / production** — filled only by what was actually observed (repo-detected db engine → local; a `dev`/`start` script → local hosting; the project's test-env URL → test hosting; a bound monitoring connector → production monitoring) and showing an explicit em-dash empty state where no source or config is known in the codebase. It also added an **App cost** row: monthly running costs read from a well-known **`app-cost.json`** at the repo root (user-maintained and expected **gitignored** — cost data never belongs in version control; picked up by the evidence probe). File present with services → a `$N/mo` total + service count (unpriced entries stay visible); file present but empty → an "add services →" invitation; no file → **NA**, and the cell's gear dispatches a Dev-runner Claude task that creates the JSON skeleton and adds it to `.gitignore` — populating it stays manual for now. The 2026-07-23 extensions pass: the **Stack section now leads the Compare matrix** (right under the covers — a column reads "what this app IS" first), the **Frameworks row shows real names + versions** read deterministically from the dependency manifests by the evidence probe (`package.json` exact dep names + `Cargo.toml`; meta-frameworks like **Next.js**/Nuxt included — e.g. "Next.js 15.3 · React 19.1" — with the context-scan prompt updated to carry the same convention into `tech_stack` values), and two prototype dimensions joined Tooling & integrations: **Data analysis** (which registered projects post-process this app's internal data — user-declared via the cell's link picker writing a `data_links` JSON column; deliberately manual because no honest scan can propose a relation that doesn't exist in code yet — e.g. Brainiac → Pumper) and **Support** (incoming customer-support channel types — Email / Discord — derived from a new `support_credential_id` DevProject slot the cell's connector popover binds from the vault; not LLM-scanned, deeper support metrics come later). Opening a project lands on the **second level, divided into four ink tabs** (`sub_factory/l2/`): **KPIs** (the proposals review queue in the original KPIs-module structure — dense table + detail modal — plus the context×KPI matrix keeping the L3 table / L4 console drill), **Context map** (the Dev Tools Context Map content, read-focused; authoring stays in the original), **Observability** (LLM spend-by-feature + unresolved Sentry errors — the technical dimension; unwired sensors render blue invitations), and **Overview** (the cockpit prototype's Focus health grid wired to REAL contexts, KPI rollups, and runtime sensors). The donor modules (Dev Tools Context Map / Observability tabs, Projects → KPIs) are deliberately kept — dual-run until the Factory versions prove themselves.

Ideas are linked to the agent that proposed them via `DevIdea.scan_type` (a string matching a `ScanAgentDef.key`). Tasks are linked back to the originating idea via `DevTask.source_idea_id`. That single foreign-ish link is what makes the whole loop work: it lets the PR Bridge cite the agent that proposed the work, and lets the Agent Scoreboard score each agent on whether its ideas actually ship.

---

## User flow

The tabs are sequenced so a new project can walk top-to-bottom exactly once, then loops through **Skills → Triage → Runner → PR** forever after. Triage itself no longer lives here: the swipe deck moved into **Overview › Approvals › Backlog** (see §4).

### 1. Projects — register a codebase

1. Open **Plugins → Dev Tools → Projects**.
2. Click **New Project** and pick a local folder. The name is auto-filled from the directory name, the tech stack can be set visually, and you can attach a GitHub URL to unlock Overview stats and the PR Bridge later. Registration also writes **`.personas/project.json`** into the folder — the project's identity marker (`{ schema, id, name, written_at }`; commit it). Re-registering the same path is idempotent. Registering a folder whose marker names a project whose old folder is **gone** re-points that project to the new path, so contexts, KPIs, ideas, tasks and milestones stay attached across a move or rename. Registering a folder whose marker names a project that is **still registered elsewhere** (a `git clone` carried the marker) is refused with both paths named — delete the marker in the clone to register it as a new project. Logic: `personas_db::project_identity`.
3. After creation, a **Generate Context Map** CTA appears — skip it only if you intend to define contexts manually.
4. A top-of-page **ProjectSelector** banner persists across every other tab so the active project is always visible. With zero projects it becomes a prompt → "Create Project" CTA; with one it collapses to a label; with many it becomes a dropdown.
5. Each project row carries quick-action icons in the last column: **Open test environment** (when `test_env_url` is set), **Open in VS Code** (deep-links via the `vscode://file/<path>` URI handler — silently falls back if VS Code isn't installed), and **Open project folder** (`shell.open(path)` → OS file manager). All stop click propagation so they don't toggle row activation.
6. **Bulk archive** — a leading checkbox column lets the user multi-select non-archived rows; the header checkbox toggles select-all-visible. When at least one row is selected, a sticky amber action bar appears above the table with a count + **Archive selected** button (loops `updateProject({ status: 'archived' })` per id and reports `Archived N` / `M failed` toasts). Archived rows render their checkbox disabled with an "Already archived" hint.
> **Superseded (2026-08-26) — a project automatically owns exactly one team.**
> Teams are no longer created by hand and no longer carry an independent name:
> the team IS the project's roster (0..x members) and is named after the
> project, because that is the label the legacy team surfaces (Channels, the
> pipeline canvas) display. `dev_projects.team_id` is still the authority for
> the link, but it is no longer an optional binding the operator picks:
> `db::project_team::ensure_project_team` creates and links the team inside
> `register_project` (so `dev_tools_create_project` can never produce a
> teamless project), `dev_tools_update_project` renames the team whenever the
> project is renamed, and the boot migration step
> `dev_projects.one_team_per_project_backfill` converges every legacy row —
> `team_id` NULL *or* dangling — on the next launch. Team presets adopt
> **into** a project's team (see
> [templates/08-team-presets.md](../../templates/08-team-presets.md#adopting-into-a-projects-team-additive-mode))
> rather than minting a new named one. The step below describes the old
> hand-bound model.

8. **Bind a Team** (added 2026-05-22) — the project create/edit modal includes an optional **Bound Team** picker listing every `PersonaTeam` (pipeline). When set, the project row in the table shows a small color-stripe pill with the team's name inline. The binding is stored as `dev_projects.team_id` (nullable, no FK — orphan-tolerant per the same rationale as `use_case_id`); if the bound team is later deleted, the pill renders as a muted "team removed" label and the user can rebind. Stage 2 will surface the pipeline's canvas thumbnail + recent run summary inline in the project detail panel.
   > **Removed (2026-05):** a separate **Bind a Group** step (`dev_projects.group_id` → `PersonaGroup`) existed alongside the team binding until the Groups→Teams consolidation retired the PersonaGroup primitive. The team binding above is now the only project↔workspace binding; the group binding + its project-row pill were dropped and existing `dev_projects.group_id` values were re-pointed onto `team_id` by the migration.

### 2. Context Map — scan the codebase into semantic domains

> Standalone design reference: [`context-design.md`](./context-design.md) —
> data model, scan protocol, integrity invariants, consumers, KPI pairing,
> and the forward roadmap.

1. Open **Context Map**. It renders as a single **ledger** (`ContextLedger.tsx`) — a cross-tab whose rows are contexts (grouped into colour-tagged group bands) and whose columns are the project's active **use cases**. See *Use cases* below for how to read it.
2. Click **Scan Codebase**. The scan spawns a Claude CLI pass over the repo (not a structural file walk) and streams `ContextGroup`/`ContextItem` rows back; a **ScanOverlay** streams progress lines and can be cancelled mid-flight. Each ledger row carries that context's **coverage cluster** — files · use cases · goals · ideas · KPIs — where the goal count jumps to the **Goals** board (pre-selecting the first matching goal via the `pendingGoalSpotlightId` slot in `uiSlice`) and the idea count jumps to **Overview › Approvals › Backlog** (seeding `pendingApprovalsMode`). Selecting a row opens the right-side **ContextDetail** pane, which lists the linked goals inline (title, progress %, and a "done / total tasks" summary per goal) plus the use cases covering that context.

   **Runtime chips (findings loop 1A).** When the project has an LLM tracer and/or Sentry wired, each row also carries what that area actually *does* at runtime: a **30d LLM-spend** chip and an **unresolved-errors** chip (which jumps to Overview). The joins already existed in the data model — LLM pinpoints roll up per use-case slug, a use case slices N contexts (`context_ids`), and a Sentry issue's `culprit` is usually a path a context owns via `filePaths`. An unwired project renders exactly the chips it always did (`useContextRuntime` degrades to empty maps; telemetry being down can never break the ledger).

   > **Read the cost chip correctly:** a use case's *full* cost is attributed to **every** context it slices — it is not split between them. The chip answers "how much LLM spend flows through this area", not "how much of the bill this area owns", so the column intentionally sums to more than the project total. Splitting would invent precision the data doesn't have.
3. Scans survive navigation — a status-resync poll on mount reattaches to in-flight jobs via `dev_tools_get_scan_codebase_status`, so leaving the tab during a long scan and coming back picks up where you left off.
4. Completion fires an **in-app notification** (TitleBar bell) with the counts — groups created, contexts created, files mapped — and a redirect link.
5. **Re-scan + scheduling** — once a project has been mapped, the action row swaps the single "Scan Codebase" button for **Re-scan (incremental)** (passes `delta_mode=true` → `dev_tools_scan_codebase` diffs the live tree against `dev_context_file_hashes` and feeds the LLM only changed files, short-circuiting when nothing changed), a **Full re-scan** fallback, and a **Plan update** button. A "Last scan" relative-time tag shows recency. **Plan update** creates a weekly **system-op automation** (`planWeeklyContextScan` → `system_ops_create_automation`, `0 3 * * 1`) for the active project — the same `SystemOpAutomation` the Chain Studio commits; the background scheduler then re-derives the context map weekly and each run surfaces in the **Live Stream** via `dev_tools.context_scan_*` bus events. (Context scans are always scoped to one project.)

#### Use cases — the behavioral layer above the map

The Context Map renders as **one ledger** (`ContextLedger.tsx`) — a
cross-tabulation, not a card board:

- **Rows are contexts**, wrapped in their group bands. Each row carries that
  context's real coverage — files · use cases · goals · ideas · KPIs — and the
  goal / idea counts **click through** (goals seed the spotlight and open the
  Goals board; ideas open Approvals › Backlog).
- **Columns are the active use cases.** A filled cell means *this use case
  slices through this context*; the use case's primary context is ringed. So
  you read **down** a column to see a use case's whole slice, and **across** a
  row to see which use cases touch a context — the N:M relation is a shape, not
  a cross-reference exercise. Clicking a column header highlights that use case.
- The header carries a **context search/filter**, the use-case **Scan** /
  **From features** actions, and the pending-proposal **triage strip**. Each row
  has a per-context **idea-scan** action; the inline **new-group** form opens
  here from the "+ Group" action.

A use case is a slice *through* contexts ("Checkout conversion" spans a UI, an
API and a data context), so it is the honest owner of an outcome that no single
context owns.

- **From features** (`dev_tools_backfill_use_cases`) — deterministic, no LLM:
  promotes each distinct `business_feature` label into a proposed use case.
- **Scan** (`dev_tools_scan_use_cases`) — a headless Claude pass proposing the
  project's *key* use cases; capped at 12 and grounded against the map (a
  proposal that resolves no real context is refused).
- Proposals are **triage-gated** (accept / reject inline), which is what keeps a
  narrower scope from flooding the review queue.
- Each context card shows a **use-case badge**; the detail pane lists the use
  cases covering that context and lets a new KPI be scoped to one.
- A use case is the **narrowest KPI scope** (`dev_kpis.use_case_id`), and its
  `slug` is the join key the **LLM Overview** uses to mark which observed LLM
  call sites map to a declared use case.

Full design: [`context-design.md`](./context-design.md) §8.

#### Integrity, freshness & canonical pins

The map is treated as a self-validating artifact, not a fire-and-forget snapshot (the design borrows from the `ktx` context-layer's referential-integrity posture):

- **Self-heal on scan** — before publishing `context-map.json`, every context's `file_paths` is checked against the real filesystem and any entry that no longer exists is pruned (`prune_dangling_file_paths` in `context_generation.rs`). The pruned count is surfaced on the scan stream. A scan never *fails* on drift — it tidies.
- **Provenance** — the exported `context-map.json` stamps a top-level `provenance` block (`git_commit`, `git_commit_count`) and each context carries `last_written_at`, so a reader (a CLI, `/research`) can judge staleness against the current HEAD instead of a bare timestamp.
- **On-demand audit** — `dev_tools_audit_contexts` reports referential integrity and freshness: `dangling_file_path` (mapped file gone), `unresolved_cross_ref` (a `cross_refs` entry naming no real context), and `stale_context` (a mapped file whose content changed since the last scan, by content-hash comparison against the cache). It never mutates state. Each of the three high-volume kinds caps its findings at 25 while `totals` still carries the exact count.
- **Who calls the audit** — the **Map health** panel on the Context Map page (`ContextMapHealth.tsx`), automatically after a *whole-tree* scan (`report_context_audit`, verdict on the scan stream + tracing log), and on the way out of `POST /dev-tools/consolidate-contexts` (in the `audit` block of the response, on the dry run too). It stays advisory everywhere: it never fails a scan, a save or a consolidation.
- **Reference repair** — merging contexts re-points `cross_refs` in the same transaction, covering both ghost paths (absorbed names, and inbound refs to a survivor's *old* name after a rename); self-references and duplicates the remap creates are dropped. For damage predating that, `dev_tools_repair_cross_refs` / `POST /dev-tools/repair-cross-refs` resolves ghosts through the `[Consolidated <date>: absorbed …]` markers a merge writes into the survivor's description. **Dry-run by default** — `dev_contexts` is not versioned, so applying is an explicit second act (confirmed in the UI) and is wired into no scan hook. Names no marker explains are reported, never deleted.
- **Canonical pins** — a context can be pinned (`dev_tools_set_context_pinned`; exported as `pinned` in the JSON). A **full re-scan preserves pinned contexts** instead of DELETE-and-recreate, and the re-scan prompt tells the LLM not to re-emit them — so hand-curation survives a rebuild.

### 3. Skills — preset scan skills, analytics & the coverage pipeline

> **2026-07-28 consolidation:** the standalone **Idea Scanner** tab was retired. Its
> 22 scan agents became **preset system skills** (`scan-<key>/SKILL.md`, generated from
> `scan_agents.toml` by `scripts/skills/scan-agents-to-skills.mjs`, git-tracked in
> `.claude/skills/` and bundled into the installer via `resources/skills`). The backend
> scan lane (`idea_scanner.rs`, `dev_tools_run_scan`, `dev_scans`/`dev_ideas`) is
> **kept** — Context Map, Mastermind and the triage sweeps still drive it.

The **Skills** tab (`sub_skills/`) now has five page tabs (Overview | Analytics | Registry | Launch | Trace):

**Launch** (2026-08-23; consolidated to the Circuit winner 2026-08-24) — a skill-first
launch surface: pick ONE registry skill from a name-sorted dropdown (source = the
workspace's paired ai-registry clone's `skills/` lane, falling back to the active
project's `.ai/manifest.yaml` `registry.local` via `skill_files_registry_root`), and the
workspace's projects render as a wired circuit board scored against it. A wide source
panel on the left carries the skill's description and its **declared argument syntax**
(the `argument-hint:` frontmatter, now parsed into `SkillEntry.argumentHint`; the
registry lane is 26/26 hinted). Project nodes are two-row cards — row 1 identity +
status icon, row 2 action + versions — at the end of status-toned SVG wires: **ready**
(lit, click to launch), **needs adopt** (dashed stub, enabled adopt affordance running
the direct-install lane behind `SkillActionConfirm`), **adopting** / **running**
(disabled; running derives from live fleet sessions whose cwd + `/skill` args match).
Clicking a ready node hands the run to **Athena** as a provenance-tagged turn: the chat
opens with a short, non-leading system note (`TurnOrigin::External`, source
"Skills Launch" — rendered as a margin note, never a user bubble) stating what the user
requested plus the declared argument syntax; she gathers anything missing and composes
the audited `show_fleet_plan` herself. `launch/` = SkillLaunchTab + CircuitVariant +
CircuitNode + CircuitWires.


**Overview (default)** — the workspace library and the active project's skills side by side.
The library panel has a **Custom | Preset** switcher: Custom lists user-authored skills from
`~/.claude/skills`; Preset leads with the **scan-sweep hero row** — the consolidated
multi-lens context sweep is the ONLY scan entry point (the 22 single-lens `scan-*` skills
were retired 2026-08-04; their briefs live on in the sweep's `references/lenses.md`, their
visual identities survive for lens chips and historical usage rows, and a focused deep pass
is `/scan-sweep --lenses <key> <context>`). Adopting a
preset installs from the app bundle (`skill_files_install_system`); adopting a custom skill
dispatches the Dev-runner customization task. Project rows keep memory bindings, context
coverage bars, and the **Use** dialog (Fleet | Terminal dispatch target + Recommended / This one /
All context selection folded into the run as a trailing arg).

The preset catalog also carries one non-scan system skill: **`i18n-translate`**
(`.claude/skills/i18n-translate/SKILL.md`, in `SYSTEM_SKILLS` in both
`skill_files.rs` and `sync-system-skills.mjs`, hand-listed in `presetSkills.ts`
like `scan-sweep`). It is a portable copywriting-grade localization loop
(draft → typed MQM estimate → gated refine, validated on the kp repo's Czech
catalog); everything repo-specific — catalog paths, placeholder syntax, gates,
post-edit build steps — lives in the *target* repo's `docs/i18n/contract.md`,
which the skill discovers and bootstraps on first run (Personas' own contract:
`docs/i18n/contract.md` here). It has no scan lens and no match rules, so the
coverage pipeline never proposes it; the "prefer the sweep" nudge in
`UseSkillDialog` is gated on the `scan-` prefix so it doesn't apply.

Row columns (Skill · Coverage · Usage · Last used · Action) sit on a **fixed** column
template including the Action track. Each row is its own CSS grid, so an `auto` last
column sized to that row's own content — a project row with two action icons pushed
Coverage/Usage/Last used a full icon-width left of a one-icon row, and the header
matched neither. The track is spelled out literally (`4rem`) in both templates because
Tailwind only extracts classes it can read as source text.

**Analytics** — the scanner concepts generalized to skills:

1. **Coverage pipeline** (Auto-Scan successor, sweep edition) — every mapped context
   matched to its full **lens bundle** by the keyword rules (generated from
   `scan_agents.toml` into `constants/scanMatchRules.gen.ts` — the TOML's `match` field is
   the single source, so a lens can never ship unmatchable again), ranked least-covered
   first (Memory-Ledger node counts), checkbox-bounded; **Run** first refreshes
   `.personas/backlog-digest.json` (pending/accepted/rejected idea titles, so a scan never
   re-proposes a known idea or rephrases a rejected one) and then spawns one Fleet session
   per selected context running `/scan-sweep --lenses <keys> <context>` — the sweep reads
   the context's code once and judges it through every bundled lens. **Sweeps resolve by
   default**: each session implements its accepted S/M findings end to end (one atomic,
   explicit-pathspec commit per finding, verified against the repo's gates; fixed items
   arrive as progress nodes, not backlog findings), so several sessions can safely run per
   project, one context each. `--ideas-only` restores propose-only behavior; L moonshot
   items are never auto-built — they are operator-triaged or flagged `size:L` for backlog
   gating. Coverage populates via
   the memory-outbox ingest when each session exits (one `skill:scan-<lens>` node per
   evaluated lens, so per-lens coverage math needs no backend change).

   **Findings door + Tier 2.** Sweeps emit structured `finding` / `escalation` lines into
   the same memory outbox; ingest (`memory_ledger.rs`) routes findings into `dev_ideas`
   through `create_finding` (origin `scan_sweep`, standard dedup guard, `IDEA_BACKLOG_CAP`
   backpressure) so they land in Overview → Approvals → Backlog with a Scan-sweep badge.
   A **NEW** escalation (a lens that hit a critical finding or 3 real findings in one
   context) auto-dispatches a focused `/scan-<lens> <context>` Fleet session on ingest —
   at most 2 per ingest, toast per spawn, killable via the **Auto deep scans** toggle in
   the **Recommended deep scans** panel (which lists every open escalation for manual
   dispatch). The escalation finding's dedup key is the cooldown: re-escalations are
   absorbed until the operator resolves or archives the finding.
2. **Skill performance** (Agent Scoreboard successor) — per installed skill: transcript
   invokes (30d), context coverage, fleet run outcomes, and — for `scan-*` presets — the
   ideas accept/impl rates carried over from the agent-keyed history.
3. **Skill history** (Scan History successor) — a unified run log: Fleet sessions whose
   argv is a `/skill` command (state, tokens via transcript rollup, duration, per-row rerun)
   unioned with legacy `dev_scans` rows (agent emoji strips, idea counts).
4. **Static scan** — the deterministic-tool lane (config modal gate,
   `dev_tools_run_static_scan`). Tools: **Fallow** (parser wired), **Knip** /
   **Jscpd** (variants reserved, parsers not implemented), and **Impeccable**
   (parser wired, 2026-07-29).

   **Impeccable** (`npx impeccable detect --json --no-advisory src`) is the
   lane's only *design* sensor — every other tool here reports code hygiene
   (dead code, duplication, unused deps). Zero-LLM, zero-dependency, ~5s over a
   1200-component tree. Findings land as `dev_ideas` with the matched snippet
   as the description and the rule's rationale as the reasoning.

   **Scoped to the slop rules on purpose.** `parse_impeccable` drops the
   `design-system-*` family (`IMPECCABLE_DROPPED_PREFIXES`). Those rules compare
   every literal colour / size / radius / font against a root `DESIGN.md` token
   ramp; a field trial over this repo's `src/features` produced **69 findings
   without a DESIGN.md and 1038 with one — 969 of them that single family**.
   That is a token-drift report, not a backlog, and the repo's own
   `custom/no-raw-*-classes` ESLint rules already track it. What survives
   (side-tab accent borders, bounce easing, AI palettes, broken images,
   layout-property animation) is low-volume and high-signal.

   **Known limitation, recorded at the parser:** the detector reads *styling
   syntax*, not token indirection. `font-family: 'Inter'` is caught;
   `--font-sans: 'Inter'` is not, and a hex sitting in a token-map object
   literal is not. On a well-tokenised codebase it under-reports — a clean run
   means "no known slop patterns", never "no design problems".

**Registry** (`sub_skills/registry/`) — a workspace-wide coverage matrix: the library skills
(rows, grouped by category) × the workspace's projects (columns; the workspace is resolved
from the active project). It renders as a **heatmap** — each adopted cell fills with the
skill's lens colour at an intensity proportional to its context coverage, so the *shape* of
adoption reads at a glance; project headers run vertically to keep columns narrow. An adopted
cell shows coverage % + 30d usage and clicks through to a Fleet **use** dispatch; an
un-adopted cell is a dashed **adopt** control. Adoption runs **in parallel** (each cell tracks
its own in-flight state) and is **blocked while a Fleet dispatch of that skill is still
running** in that project (`useSkillsRegistry` derives the running set from live Fleet
sessions by matching `cwd` ↔ `root_path`). Data is a bounded per-project fan-out
(`mapWithConcurrency`) over `listSkills` / `memorySkillCoverage` / `memoryCoverage`.

**Trace** (`sub_skills/trace/`) — the skill-standard traceability surface
(docs/skill-standard.md), two levels, visually independent of Registry:

1. **Ember matrix** (`TraceOverview`) — skills ranked by recency-weighted heat
   (`rawHeat = sqrt(invokes30d) × 0.5^(days/7)`, normalized against the matrix
   max) × workspace projects. Cells are ember dots: radius ∝ √invokes, opacity
   ∝ heat, in the skill's accent colour; a dashed hollow ring = adopted but
   cold (the drift-risk signal), a faint dot = not installed. Row heads carry
   the library `version:` chip and a heat bar; a five-tier legend closes the
   surface. Click a cell or row → the skill tree.
2. **Skill tree** (`SkillTreeView`) — the workspace library as the core node
   (its declared version), one bezier branch per adopted project fanning
   across the upper arc, stroke width/intensity ∝ usage share. Each project
   node wears a **drift ring**: in-sync (green) / behind library (warning) /
   ahead (primary) / customized (info; same version, hash diverged) /
   unversioned (dashed). LESSONS.md entries sprout on the branch (redesign
   proposals in warning tone) and repeat in a readable panel next to the
   **version timeline** — the first UI reader of `skill_revisions`
   (`skill_version_timeline`), showing every method change with its declared
   version. Data: `useSkillTraceModel` (lean fan-out: library + usage overview
   + per-project skill lists) and `useSkillTreeModel` (timeline + lessons only,
   branches derived from the loaded matrix); both keep module-scoped warm
   caches. Pure math lives in `traceModel.ts` / `treeGeometry.ts` (vitest).

**Skill info modal** (`SkillInfoModal`) — clicking a **skill name** anywhere (Overview /
Analytics / Registry / Trace) opens a shared metadata modal: an understandable summary (the standard
`description` = what + when), **how to invoke** (command + argument variations, copy-on-click),
and metadata chips (memory binding, context-tracked, `argument-hint`). Preset scan skills are
described from the in-memory catalogue; custom skills are parsed from their `SKILL.md`
(`skillMeta.ts`). The `scan-*` skills carry an **`argument-hint: "[context]"`** frontmatter
field — the [Claude Code / Agent Skills standard](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
for documenting expected arguments; the generator (`scripts/skills/scan-agents-to-skills.mjs`)
emits it and the bundle is re-synced.

**Workspace consent:** creating a workspace (Workspaces tab → new-workspace tile) offers an
**"Adopt default skills"** checkbox (`dev_workspaces.adopt_default_skills`, default off —
consent is explicit). Projects assigned to a consenting workspace get the preset skills
installed automatically (skip-existing); consenting workspaces carry a **Presets** badge on
their Atlas crest card.

### 4. Triage — now in Overview › Approvals › Backlog

The standalone **Idea Triage** page was removed; `dev_ideas` are triaged in the
one decision center that already owned the other two "should this be accepted?"
queues. Open **Overview → Approvals → Backlog** (the Context Map's idea-coverage
badge deep-links straight there).

1. **Table** mode is the default — a cross-project faceted table (rail derived
   from `category/origin`, search, per-column filters, checkbox bulk verdicts,
   and a detail ledger that walks the visible ordering). See
   [`docs/features/overview/README.md`](../../overview/README.md).
2. **Focus** mode is the swipe deck, carried over intact: pending ideas form a
   3-card stack, dragged physically via Framer Motion with the border glowing
   red/green by direction. Swipe right (or ➡ / Z) to accept, left (or ⬅ / A) to
   reject; the action bar also offers **delete** and **Build now** (queue a
   linked task and accept in one move). A progress bar tracks reviewed/total and
   a session-summary toast fires when the queue empties after a real run.
   Focus mode is only offered over the **pending** bucket — swiping an
   already-decided row would silently re-decide it. What the deck lost in the
   move: the per-card agent rank / accept-rate line, which rewarded plausibility
   rather than outcome (the Sensor Scoreboard scores the same question honestly).
3. Both modes read the **same filtered + ordered row set**, so switching between
   them never reshuffles the queue. Panel-level **sort pills** (Default / Best
   value / Quick wins) and an **effort & risk** popover sit next to the search
   box; the value pill maps onto the table's value column.
4. The **Auto-Triage Rules** panel (conditional rules applied in bulk via
   `dev_tools_run_triage_rules`), the **Sweep** button and the **Sensor
   Scoreboard** moved with it and sit in the Backlog's action row. Rule
   conditions can target `effort` / `impact` / `risk` / `category` / `scan_type`
   and — since the findings spine — **`origin`**, the sensor that raised the
   idea (e.g. "auto-accept `passport_gap`"). A classic scanner idea has no
   origin, so an origin rule never sweeps it up.
5. The app-wide `?` cheat-sheet still lists the accept/reject keys under its
   **Agents** section.

#### The findings spine — every sensor feeds triage

> Design: [`docs/plans/dev-findings-loop.md`](../../../plans/dev-findings-loop.md).

The Idea Scanner used to be the *only* thing that could put work in the backlog. It
isn't any more: **a finding is an idea**. `dev_ideas` carries four additive columns —
`origin`, `use_case_id`, `evidence` (JSON), `dedup_key` — so every scan surface can
emit into the same triage → task → PR → scoreboard pipeline instead of growing its
own private one. A `NULL` origin IS a classic scanner idea, so nothing about the
existing deck changed.

| `origin` | Sensor | Raised when |
| --- | --- | --- |
| `standards_finding` | Golden-standard scan (`DevStandard`) | a rule is not `present` — the recommendation becomes the fix prompt |
| `passport_gap` | Factory improve plan | a readiness dimension is below target (effort tier ≤ 2 only; tier 3 = a full Claude deploy, still a human click on the passport) |
| `llm_cost` | LLM observability | a use case burns > $5/30d, **or** > 30% of calls carry no use-case label (uninstrumented call sites blind every other join) |
| `sentry_spike` | Sentry | an unresolved issue exceeds 25 events (top 3 per sweep), matched onto a context via its culprit path |
| `kpi_offtrack` | KPI layer | a KPI is off track (shares `collectKpiAttention` with the Factory warning badge, so the two can't disagree) |
| `skill_dormant` | Skill usage telemetry (transcript mining) | a skill installed ≥30 days has zero observed invocations in the window (age-guarded — a new skill is never "dormant"; top 3 per sweep, oldest first; dedup `skill:<scope>:<name>`) |
| `doc_rot` | Doc-rot scan (git) | a doc's coupled sources have commits newer than the doc (harm-ranked: docs read WHILE stale first, then oldest staleness; top 3 per sweep; dedup `doc:<path>`; the description carries the changed sources as the refresh-task prompt) |
| `doc_rot` | Doc-rot scan (content) | a doc NAMES repo paths that no longer exist though their parent directories do — renamed or deleted targets (ranked by how many references are gone, then by reads; top 3 per sweep; dedup `doc-refs:<path>`, disjoint from the staleness key so one doc can raise both). Independent of the git signal on purpose: a doc whose every reference was renamed away couples to nothing, so it is never "stale" |
| `memory_disputed` | Memory claims loop | a persona/team memory carries open `wrong`/`outdated` claims (most-disputed first, top 3; dedup `memory:<id>`; NOT a Claude-task seed — the description routes to Overview → Memories where a human resolves reverify/deprecate/dismiss) |

**Sweeping.** The 🛰 button on the Backlog action row runs `runFindingSweep` for the
active project: gather → emit → dedup → cap → persist. Every sensor is optional (a
project with no tracer, no Sentry, or no scan still sweeps what it has), and the
result toast **names the sensors it skipped** — a thin sweep must never read as a
clean bill of health. Emission is idempotent on `dedup_key` across *every* status,
**rejected included**: a human "no" is durable, and only deleting the idea frees the
key. Findings are ranked impact-per-effort and capped at 10 per sweep, with the
dropped count reported rather than silently truncated. Thresholds live in one file
(`sub_triage/findings/findingConfig.ts`).

**On the card.** A finding leads with its sensor badge instead of the scan agent's
emoji; clicking the badge opens the **evidence** it was raised on (the raw numbers
behind the threshold decision), so the claim can be judged rather than trusted. The
sidebar gains a **Source** filter, shown only once a sensor has actually raised
something.

#### Verification — did shipping it actually move the number?

Until now nothing checked whether merged work changed anything: **"merged" was
silently treated as "fixed".** It isn't. Every finding that ships now gets a verdict.

**The sweep IS the probe.** An emitter only fires when a signal is *over* threshold,
and the sweep already re-runs every emitter — so a fresh emit is the measurement:

- the finding's `dedup_key` is **absent** from the fresh drafts → the signal is gone → **`cleared`**
- it's **still there** → compare the primary metric against the stored `evidence` →
  **`moved`** (materially better, ≥10%), **`regressed`** (worse), else **`unchanged`**

Per-origin the "primary metric" is: `llm_cost` → cost (or unnamed-share) · `sentry_spike`
→ event count · `kpi_offtrack` → the reading vs its target (direction-aware) ·
`standards_finding` / `passport_gap` / `skill_dormant` / `doc_rot` / `memory_disputed` → presence-shaped, so absence is the whole verdict.
Results are stored on `dev_ideas` (`verify_state`, `verify_checked_at`, `verify_evidence` —
the *re-measured* reading, so a verdict is auditable before-vs-after, not taken on trust).

**Honesty rules, enforced in code and tests:**
- A finding is judged **only once the work shipped** (accepted + its task `completed`).
  A verdict on work never done would be the most damaging lie the loop could tell.
- We **never invent a `cleared`** — missing, unparseable or incomparable evidence
  yields `unchanged`, the conservative answer.
- A change below the material threshold is `unchanged`: **claiming a win on noise is
  how a loop starts lying.**
- `unchanged` and `regressed` are surfaced as loudly as `cleared` (a regression never
  wears a success colour in the sweep toast).

#### Sensor Scoreboard — credit for the number moving, not the PR merging

The Agent Scoreboard can only score *accepted + merged*, which rewards **plausibility**:
an agent whose ideas always merge and never change anything scores perfectly. A sensor
measures a **number**, so it can be scored on **effect**. The headline is the **verify
rate** — of the findings that shipped and were judged, how many cleared or improved.

- `unchanged` / `regressed` get their own columns.
- An unjudged sensor shows **"—", never 0%** (unknown ≠ bad), and a rate below a few
  verdicts is labelled **"(low n)"**.
- A *credible* sensor with a poor rate is flagged **noisy** — a finding about the finder.
  Advisory only: the app never silently retunes a sensor's threshold. Likewise, a sensor
  whose findings you keep rejecting produces an **"auto-reject &lt;sensor&gt;" rule
  suggestion** rather than quietly re-tuning itself.

### 5. Run Desk — execute accepted ideas

> Renamed from **Task Runner** (the sidebar tab id stays `task-runner`). The page is `sub_runner/RunDeskPage.tsx`; `TaskRunnerPage.tsx` is gone.

0. The **accept → execute bridge** starts one screen earlier. On Approvals › Backlog, **Execute accepted** calls `dev_tools_dispatch_ideas(ideaIds, "runner")`: per idea it auto-accepts anything still pending through the shared verdict core (dispatching *is* a decision — the memory + workspace-adoption write-backs happen too), composes the task description from the idea's title / description / reasoning / evidence (the Rust port of `findings/dispatch.ts::dispatchPrompt`), creates the task through `dev_tools_create_task` (so a materialized workspace practice's adoption cell moves `to_process → dispatched`), and starts the batch through the unchanged `dev_tools_start_batch`. The frontend then hands off via `pendingTaskFocusId` and lands on the Run Desk with the first new task focused. The same command's `"fleet"` target creates the tasks but returns each one's project `rootPath` + composed prompt instead of starting them, so the caller can `spawnSession` per project (the fleet arm stays frontend-composed).
1. Open **Run Desk**. Click **Batch from Accepted** to materialize one `DevTask` per accepted idea (source-linked via `source_idea_id`), or **New Task** to create an ad-hoc task with a **Quick / Campaign / Deep Build** depth picker.
2. Press **Start Batch**. Every card shows the **real** progress % from `progress_pct`, the status token, and the last streamed output line — the old invented phase ladder (`analyzing → planning → …`, derived from the progress number rather than reported by the executor) was removed because it told users things the backend never said.
3. The queue is **paged, not fetch-all**: `useTaskQueue` layers L0 per-status counts (from `dev_tools_tasks_page`'s `counts`, project-wide so the filter chips stay truthful) over a 40-row keyset page, with a scroll sentinel pulling the next page. Status filter chips across the top switch the server-side filter.
4. Live events **patch one row** instead of refetching the project: `TASK_EXEC_OUTPUT` feeds the bounded output ring, `TASK_EXEC_STATUS` / `TASK_EXEC_COMPLETE` call the `patchTask(id, partial)` store action, and a reload happens only when a transition can move a row across the active filter window, or on `AUTO_RUN_COMPLETE`.
5. **Auto-Run All** starts the scheduler at the chosen concurrency. The banner rehydrates from `dev_tools_get_auto_run_status` on mount, so reloading mid-run keeps the live banner (and a finished run leaves a dismissible summary line) instead of forgetting it existed. The **Parallel** stepper next to the actions binds `maxParallelTasks`, which previously had no UI at all.
6. Output streams live via the **TaskOutputPanel** (expandable). Context warnings from the LLM (e.g. "couldn't load referenced file") are flagged as a **Partial context** badge with the full list revealed on expand. (These arrive on the completion event only and are session-scoped — `dev_tasks` has no column for them.)
7. **Retries** go through `dev_tools_retry_task`: the new row copies the title verbatim and records lineage in `parent_task_id` / `attempt`, surfaced as an **Attempt N** chip (tooltipped with the parent title when that row is loaded). The old path prepended `[Retry] ` to the title, so a twice-retried task read `[Retry] [Retry] …` with no link back to its origin.
8. A **Self-Healing** panel above the queue watches for failures and offers one-click retries.
9. **PR Bridge** (see *Proposal A* below) appears on every completed task — a collapsible card with the suggested branch name, commit message, PR title and body (with agent citation), plus several actions: *Copy PR body*, *Copy all*, *Copy reasoning* (visible only when the source idea carries reasoning text — drops just the agent's reasoning blob onto the clipboard for pasting into review threads), *Copy git commands* (outputs a ready-to-paste bash block: `git checkout -b`, `git add -A`, multi-line commit via single-quoted heredoc so the reasoning blob round-trips unescaped, `git push -u`, and an optional `gh pr create --draft` block when a GitHub URL is recognized), *Prepare branch & commit* (uses `dev_tools_create_branch` + `dev_tools_commit_changes`), *Open draft PR on GitHub* (via `@tauri-apps/plugin-shell` with GitHub's `quick_pull=1` URL pre-fill). When the source idea has a known scan agent the **PR title** is prefixed `[<emoji> <Agent Label>] <title>` so agent attribution survives in commit-log surfaces (GitHub PR list, `git log --oneline`) that never render the PR body.
10. Tasks linked to a goal show a clickable violet **goal pill** beside the source label; clicking it jumps to the **Goals** tab in one hop (`setDevToolsTab('goals')` + the `pendingGoalSpotlightId` slot in `uiSlice`).

### 6. Overview — live health signals

0. A **project pipeline** summary (Project / Source control / Standards stage cards) renders at the top. Every row is **inline-editable**: click any value — set *or* "Not set" — and an anchored **quick-edit popover** opens over the row with the right control (text input, team/connector or branch select, or pre-commit / automerge toggles). Saving writes through `dev_tools_update_project` (name, connector binding, repo URL, main branch, living test-env) or `dev_tools_set_standards_config` (pre-commit gates, PR base, automerge) and refetches the project. The popover shell is the reusable `QuickEditPopover` (`shared/components/overlays`); the field→draft→save mapping lives in `EditableProjectPipeline` + `pipelineFieldEditor`. The folder path stays read-only in the UI; it is re-pointed only by re-registering a moved folder whose `.personas/project.json` marker names this project (see § 1).
1. A two-column layout shows **Codebase** (GitHub / GitLab) on the left and **Monitoring** (Sentry) on the right.
2. Each card handles five states: **empty** (no credential) → **unmapped** (credential exists but not linked to this project) → **loading** → **connected** (with stat tiles) → **error** (with retry).
3. The vital-signs strip (open issues / open PRs / commits / unresolved / events 24h / events 7d) is **drag-to-rearrange**: grab any tile and drop it on another to swap positions. Order persists per project to localStorage under `personas.devtools.overview_tile_order.${projectId}` so each project remembers its "most-watched first" layout. Future tiles added to `DEFAULT_TILE_ORDER` auto-append for users with persisted state.
4. A **TODAY** activity feed sits between the vital signs strip and the connections rail when the store has anything to show. `buildTodayActivity` (in `overviewHelpers.ts`) selects today's scan runs, task created / completed / failed events, and goal signals from the existing Zustand store slices — no new query — then sorts chronologically (capped at 30 entries). Each row is click-jumpable to its source surface via the established `pendingTaskFocusId` / `pendingGoalSpotlightId` handoffs; scan rows jump to the Skills tab. The "what happened today" story now lives in one panel instead of five.
3. Connecting Sentry uses an inline form (`MonitoringLinkForm`) that writes the credential ID + project slug back to `dev_projects.monitoring_*`.
4. Stat tiles use a static color token table — dynamic Tailwind classes (`bg-${color}-500/15`) are banned here because the JIT can't see them.

### 6a. Observability — LLM + app-monitoring mapping

> **Renamed from "LLM Overview" (2026-07).** The module now carries an **LLM /
> Monitoring** sub-tab switcher over one shared, accessor-driven assignment
> matrix (`AssignmentMatrix` + `matrixShared`). The **Monitoring** sub-tab
> applies the same philosophy to app monitoring: a projects × monitoring-
> connector matrix writing `dev_projects.monitoring_credential_id`, over a
> per-project stats readout (unresolved issues + events 24h/7d) that **reuses
> the existing `fetchSentryStats` adapter** and the Overview page's
> `SentryProjectPicker` for the org/project slug. Qualifying connectors today:
> Sentry (live adapter) and Better Stack (renders "unsupported" until an adapter
> ships). See `sub_llm_overview/{MonitoringSection,useMonitoringPinpoints}.tsx`.

**LLM sub-tab.** For each Dev Project, see *every place the codebase calls an LLM* — the use-case name, provider, model, usage (calls + tokens) and estimated cost — read live from whichever LLM-observability tool the project is wired to.

**Two layers:**

1. **Assignment matrix** (Layer 1) — a fleet-coverage board (`LlmOverviewMatrix`): a coverage strip (N/M projects instrumented + a per-tool tally) over a grid of brand-badged project tiles, with un-wired projects flagged as gaps. Each tile's picker — the themed brand-icon `ConnectorSocket` — writes `dev_projects.llm_tracking_credential_id` via `dev_tools_update_project` (mirroring the Sentry monitoring binding). Shown whenever a project exists; if the vault has no LLM-observability credential yet it prompts to add one under Vault → Connectors.
2. **Pinpoints table** (Layer 2) — for the active project, a `UnifiedTable` of use-case rollups over a rolling **24h / 7d / 30d** window (columns: Use case · Provider · Model · Calls · Tokens · Est. $). One row per distinct use-case name, showing its *default* (most-called) provider+model with summed usage; un-named calls roll up under their model (rendered "unnamed"). The five connection states (empty / unmapped / unsupported / loading / connected / error) mirror the Overview cards. Costs are labelled **estimates** (token×price, not billed amounts).

**Supported tools** — four builtin connectors, all behind one normalized `LlmPinpoint` contract + `foldByUseCase`:

| Tool | Endpoint | Auth | Notes |
|---|---|---|---|
| **LightTrack** (self-hosted; `github.com/xkazm04/tracklight`) | `GET /v1/usecases?since=` | Bearer | Server-side rollup; **live-verified**. The `name` field + endpoint were added to LightTrack itself |
| **Langfuse** | `GET /api/public/v2/observations` | Basic (public/secret key) | Provider inferred from the model (Langfuse doesn't report it) |
| **LangSmith** | `POST /runs/query` | `x-api-key` | Model/provider from `extra.metadata.ls_*` |
| **Helicone** | `POST /v1/request/query` | Bearer | Provider reported directly; `request_path` as the use-case name |

The three SaaS mappers are derived from each tool's public API docs; their adapters normalize raw per-call records that a bounded pager (`fetchPaged`) + `foldByUseCase` aggregate into the rollup.

**Reaching a self-hosted instance.** Self-hosted tools run on localhost/LAN, which the credential API proxy's SSRF guard normally blocks. The LLM-observability connectors that can be self-hosted declare `allow_private_network: true` in their connector metadata; the proxy **and** the healthcheck then route *their* requests through a non-filtered HTTP client (`HTTP_ALLOW_PRIVATE`) — scoped to those connectors only. Every other connector stays fully SSRF-guarded (field/URL validators + the SSRF-safe DNS/redirect client).

Frontend lives in `sub_llm_overview/` (`LlmOverviewPage`, `useLlmPinpoints`, `llmTracingAdapters`); auth is handled by `LangfuseBasicAuthStrategy` / `LangSmithStrategy` in `engine/connector_strategy.rs`, and per-connector private-network gating by `engine/api_proxy.rs::connector_allows_private_network`.

### 7. Lifecycle, Goals & Competition

> **Restructured (2026-06):** these are now three independent sidebar items. The old Lifecycle tab strip is gone (Lifecycle is Setup-only) and its **Project Tracking** sub-tab was removed entirely.

1. **Lifecycle** is the autonomous **Dev Clone** setup surface — a vertical step list (`FlowStepsList`): Dev Clone adopted, hourly scan trigger configured, approval-listener trigger, rejection-listener trigger, and goal count. Each step renders its own state (passed / pending / blocked) so the user can see exactly which piece is missing without a separate readiness summary. One-click **Adopt Dev Clone** registers the persona, its tools, and its triggers; the trigger list below the step-stones shows the live event-listener and schedule rows.
2. **Goals** renders a force-directed **Goal Constellation** (via `forceLayout.ts`) plus a Kanban board with `your turn / agent's turn / done` swim lanes. Goals can have dependencies, and tasks can link to a goal so progress propagates. The **Project Pulse** variant adds a right-side **spotlight pane** that lists the goal's dependency chain (requires / blocks) AND the tasks linked to it — title, status dot, live progress, and a `done/total` counter at the section heading; each task row is a button that hands off to the Run Desk and highlights the matching card. Clicking any goal in the left rail updates the spotlight without leaving the tab; clicking a node in the **Baseline** force graph also switches to the Pulse variant with that goal pre-selected, so the spatial view and the actionable view stay connected. The **Kanban** board is interactive: drag a goal card between lanes to change its status (`pending` / `in_progress` / `completed`), and hover any card to reveal ±5% progress nudge buttons on either side of the progress bar — both routes hit `updateGoal` optimistically through the Zustand slice. Each card's top-right corner carries an **add-to-dos** button (left of the expand affordance, hover-revealed) for goals without a checklist.
3. **Competition** (its own sidebar item) spawns 2–4 strategy variants in Claude Code worktrees racing against the same prompt. The **StrategyLeaderboard** ranks them by quality score + duration. A **WinnerInsightDialog** captures *why* a strategy won for future prompt tuning — its textarea now opens pre-filled with a plain-text summary of how the winner's prompt differs from each other variant (`summarizePromptDiff` in `PromptDiffModal.tsx` walks each pair through the same line-LCS used for the side-by-side diff, surfaces up to 4 added/removed sample lines per other, then prefixes "— My take on why this won:" so the user picks up where the data ends). When a competition has two or more slots, each row also carries a checkbox; select any two and click **Open diff** to see the full line-level prompt diff in a side-by-side modal.

### 8. Skills — browse dev patterns

1. Open **Skills**. The left pane lists markdown files from the **selected dev-tools project's** `.claude/skills/` directory (the project picker in the header is the source of truth — switching projects refreshes the list and clears the open file). A fuzzy-search box filters the list. A **Recent** chip row above the list surfaces the last five skills opened this session (persisted to `localStorage`), and each skill row has a star button that pins it to favorites — favorites float to the top of the list across sessions.
2. The right pane renders the selected file with an inline **Edit** toggle that writes changes back to disk. Edit mode is a 2-column split-view — raw markdown textarea on the left, live `MarkdownRenderer` preview on the right (with an "unsaved" indicator when the buffer diverges from disk). Markdown errors are now visible immediately instead of waiting for save.
3. A safety banner is shown when a file fails to load — editing is disabled to prevent data loss.

### Lifecycle, end-to-end

```
┌───────────┐   scan    ┌───────────┐   triage   ┌───────────┐  batch  ┌───────────┐
│ Codebase  │──────────▶│ 21 scan   │───────────▶│ Accepted  │────────▶│   Tasks   │
│ (files)   │           │  agents   │            │   ideas   │         │ (LLM run) │
└───────────┘           └───────────┘            └───────────┘         └───────────┘
                              │                        ▲                     │
                              │     feedback loop      │  scoreboard         │ completed
                              ▼                        │                     ▼
                        ┌───────────┐                  │              ┌───────────┐
                        │ Scoreboard│──────────────────┘              │ PR Bridge │
                        │ per-agent │                                 │  (GitHub) │
                        │  metrics  │                                 └───────────┘
                        └───────────┘                                       │
                                                                            ▼
                                                                      ┌───────────┐
                                                                      │  Human    │
                                                                      │  merges   │
                                                                      └───────────┘
```

Each arrow is stateful and survives navigation — scan jobs, task runs, and PR branches all persist in SQLite and resume on re-mount.

---

## Strongest use case (speculation)

> **A single human reviewer supervising twenty specialized AI reviewers — and every accepted idea shipping as a draft PR with the proposing agent's reasoning embedded.**

Most AI-coding products sit at one end of two axes: they are either (a) a single chat window where one generalist agent tries to do everything, or (b) a fully autonomous pipeline where the human only sees the final output. Both break for real codebases — the generalist misses domain-specific bugs, and the autonomous pipeline merges slop without review.

Dev Tools occupies the middle. You are never asked to decide *what* to look for — twenty-one specialists (Security Auditor, UX Reviewer, Tech Debt Tracker, Bounty Hunter, …) each scan the codebase from their own angle and each drop their own ideas into one shared queue. You triage the queue swipe-by-swipe in a minute, accept what's worth doing, and press **Start Batch**. Tasks run in parallel, each one completes, each one produces a draft PR with the proposing agent cited in the description.

The killer flow is:

1. Security Auditor proposes *"session tokens stored in localStorage survive XSS"*. The idea lands in the triage queue tagged `🔒 Security Auditor` with effort 4, impact 9, risk 3.
2. You swipe right. One click. Less than a second.
3. **Batch from Accepted** materializes the idea into a task. The task executes, writes the migration to httpOnly cookies, runs your test command, and emits `TASK_EXEC_COMPLETE`.
4. The **PR Bridge** card unfolds on the completed task: branch `dev-tools/session-token-xss-3a7b1c2`, commit `Move session tokens from localStorage to httpOnly cookies\n\nProposed by Security Auditor 🔒 via Personas Dev Tools.\n\n{reasoning}`, PR body with category / effort / impact / risk / description / full agent reasoning.
5. Click **Prepare branch & commit** → click **Open draft PR on GitHub**. GitHub's create-PR page opens with title and body pre-filled.
6. Reviewer on your team sees a draft PR that *explains itself* — the agent's reasoning for *why* the change is worth making travels with the code.
7. The **Agent Scoreboard** notices the PR merged. Security Auditor's accept rate ticks up to 81%. Next week's auto-scan weights its suggestions slightly higher.

No other product lets a human supervise this many specialists this efficiently. The lock-in is weak (it's your code, your repo, your PRs), the leverage is extreme (the scoreboard compounds), and the ceiling is the number of agents you trust — not the number of prompts you can type.

---

## Five development directions

Proposals A (PR Bridge) and B (Agent Scoreboard) are already shipped. What follows is the next five.

### 1. Cross-project refactor planner — find and lift shared code

Today every project is scanned in isolation. The `dev_tools_search_across_projects` and `dev_tools_get_cross_project_map` commands already exist but are under-used. Build a UI that:

- Detects near-duplicate functions, types, and config blocks across linked projects (using the cross-project search index).
- Proposes "extract to shared package" batches, with a **dry-run impact report**: which call sites change, estimated effort, suggested package location.
- Surfaces the diff inline with a one-click "create shared-library project" action that spins up a new dev project pre-seeded with the extracted code.

This converts Dev Tools from a single-repo scanner into a portfolio-level architect. It is uniquely possible here because you have the cross-project index nobody else has.

### 2. Live Tech Radar + upgrade debt dashboard

The `dev_tools_get_tech_radar`, `dev_tools_get_risk_matrix`, and `dev_tools_get_dependency_graph` commands exist as stubs. Light them up:

- Auto-extract dependency graphs from every linked project's lockfiles (package.json, Cargo.toml, requirements.txt).
- Render an interactive **radial Tech Radar** (adopt / trial / assess / hold) across the whole portfolio.
- Flag **version drift** across projects (React 18 vs 19, Node 16 vs 20) and generate ranked multi-project upgrade plans with effort / breaking-change estimates.
- Hook the radar into the Scanner: a new **Tech Debt Tracker++** agent can read radar state and propose upgrade ideas with real context.

This is the dashboard that turns a solo tool into something a tech lead keeps open all day.

### 3. Scan lineage and replay

Scans today are fire-and-forget: the history table shows a row with counts, but you cannot re-run a scan against a newer commit and diff the results. Add scan lineage:

- Each scan records the commit SHA + context version it ran against (extend `dev_scans` schema with two columns, zero breaking changes).
- A **Replay on current HEAD** button re-runs the exact same agents on the same contexts.
- A side-by-side diff viewer shows: *3 new ideas, 7 stale because the code changed, 2 still apply*.
- Stale ideas that have not been acted on for N days can be auto-rejected with a "superseded by newer scan" rejection reason.

This turns ideas from point-in-time snapshots into a living changelog, and makes the scoreboard's metrics defensible over time.

### 4. True API-driven PR creation (close the PR Bridge loop)

The PR Bridge currently ends at GitHub's pre-fill URL — the user still has to click "Create pull request" in the browser. That is the 80% solution. The 100% solution adds server-side PR creation:

- Replace the `quick_pull=1` open-in-browser step with a `dev_tools_create_draft_pr` Tauri command that hits GitHub's REST API using the user's stored GitHub credential (via `octocrab` or a raw reqwest client).
- Reviewers, labels, and milestones can be set from the PR Bridge card before submission.
- On PR merge, emit an event that updates the source idea's status to `shipped` and posts a merge signal into `dev_tools_create_goal_signal` (if the task had a `goal_id`), so goal progress advances automatically.
- Add GitLab as a second provider behind the same interface; the bridge code already handles host detection.

This is the feature that lets a team commit to Dev Tools as their real workflow, not just their ideation tool.

### 5. Per-persona task execution — route work to specialized Dev Clones

Right now every task runs through one generic task executor. Teams have specialists — a backend person, a frontend person, a tester. Let the scoreboard-verified *agents* choose the *executor*:

- Each scan agent gets a default **target persona** (e.g. Security Auditor → "Security Engineer" persona, UX Reviewer → "UI Polisher" persona).
- When a task is created from an accepted idea, the matching persona's system prompt and tools are preloaded into the executor — so the implementation inherits the reviewer's instincts.
- Per-persona overrides live in the Lifecycle → Setup tab alongside Dev Clone adoption. A visual mapping grid lets users bind any agent to any persona.
- The **Competitions** tab becomes the natural testbed: run the same task through three different personas in parallel worktrees and let the quality score pick the winner.

This is the feature that makes Dev Tools *your* tool, not a generic LLM wrapper — your team's style, your team's priorities, your team's taste — encoded in the personas each agent routes to.

---

## Scan agents — the 21-headed engine

Dev Tools ships 21 specialized scan agents defined in `src/features/plugins/dev-tools/constants/scanAgents.ts`. Each is a small prompt template + metadata record (key, label, emoji, category group, example ideas). They are the execution layer that makes the scanner worthwhile.

### Agent roster

| Category | Agents |
|---|---|
| **Technical** | Code Optimizer ⚡, Security Auditor 🔒, Architecture Analyst 🏗️, Test Strategist 🧪, Dependency Auditor 📦, Bounty Hunter 🏴‍☠️ |
| **User Experience** | UX Reviewer 🎨, Accessibility Checker ♿, Mobile Specialist 📱, Error Handler 🚨, Onboarding Designer 🎯 |
| **Business** | Feature Scout 🔭, Monetization Advisor 💰, Analytics Planner 📊, Documentation Auditor 📝, Growth Hacker 🚀 |
| **Mastermind** | Tech Debt Tracker 🏦, Innovation Catalyst 💡, Risk Assessor ⚠️, Integration Planner 🔗, DevOps Optimizer 🔧 |

### How an agent actually runs

There is one execution path and it is deliberately simple:

1. The frontend posts `dev_tools_run_scan(project_id, agent_keys[], context_id?)` via Tauri IPC.
2. `src-tauri/src/commands/infrastructure/idea_scanner.rs` spawns an async job and returns a `scan_id` immediately.
3. The job spawns ONE headless Claude CLI process for the whole run — all selected lenses concatenated into a single prompt (`build_idea_scan_prompt`) — streaming token usage and partial ideas through `IDEA_SCAN_OUTPUT` events.
4. Each returned idea is persisted as a `DevIdea` row with `scan_type = agent.key` and effort/impact/risk extracted from the response.
5. On completion, `IDEA_SCAN_STATUS` fires with `completed | completed_with_warning | failed | cancelled`; the frontend re-runs `fetchIdeas(project_id)` and the scoreboard recomputes.

Because the agent key is stored as a string, *adding a new agent is a single-file change* — append to `SCAN_AGENTS`, give it a prompt, and it shows up in the Scanner grid, participates in auto-scan, and gets its own row in the scoreboard automatically.

### Auto-match rules

The Scanner has an **Auto-Scan** mode that loops every mapped context and picks agents by regex match over the context's name, description, keywords, tech stack, API surface, and file paths (each agent's `match` field in `scan_agents.toml`, generated into `constants/scanMatchRules.gen.ts` by `scripts/skills/gen-scan-match-rules.mjs`). Example: a context whose keywords include `auth|login|token|secret` gets Security Auditor, a context tagged `mobile|responsive|viewport` gets Mobile Specialist. Contexts with no match fall back to Architecture Analyst + Code Optimizer as a sensible baseline.

### Agent Scoreboard (Proposal B)

A collapsible section in the Scanner aggregates per-agent performance from stored ideas + tasks: **Ideas generated · Accept % · Impl % · Avg impact · Avg effort**. Source logic is in `sub_scanner/AgentScoreboard.tsx`. Null signals (no decided ideas yet, no tasks yet) sort to the bottom; leaders ≥50% acceptance get a 🏆. The whole panel is pure client-side aggregation — zero new backend, zero new schema, zero new dependencies.

### PR Bridge (Proposal A)

A collapsible card on every completed task in the Runner. Source in `sub_runner/PrBridge.tsx`. It parses `DevProject.github_url`, looks up the originating `DevIdea` via `DevTask.source_idea_id`, slugifies the idea title into a branch name, builds a commit message + PR body with the agent citation, and wires three actions: *Copy PR body*, *Prepare branch & commit* (uses existing `dev_tools_create_branch` + `dev_tools_commit_changes` Tauri commands), *Open draft PR on GitHub* (uses `@tauri-apps/plugin-shell` and GitHub's `quick_pull=1&title=…&body=…` pre-fill URL). Non-GitHub hosts (GitLab, Bitbucket) are detected and degrade gracefully to a "copy manually" message.

---

## Portability

Dev projects travel with workspace exports via **Settings › Data Portability** (the "Dev projects" scope in the export picker). A project ships as its row plus the full planning graph (goals, contexts, ideas, tasks, use cases, competitions, pipelines, standards, milestones, project KPIs, memories) and its on-disk `.claude/skills/` library; telemetry/scan-cache tables, credential-id columns, and global skills deliberately do not travel. Importing a bundle whose project collides with an existing one (same `root_path` or name) surfaces a per-project **Skip / Duplicate / Replace** resolution panel in the Data tab. See [`docs/features/settings/README.md`](../../settings/README.md) § Data portability.

---

## Reference: backend commands

| Family | Key commands |
|---|---|
| **Projects** | `dev_tools_list_projects` · `_get_project` · `_create_project` · `_update_project` · `_delete_project` · `_get_active_project` · `_set_active_project` |
| **Goals** | `dev_tools_list_goals` · `_create_goal` · `_update_goal` · `_delete_goal` · `_reorder_goals` · `_add_goal_dependency` · `_remove_goal_dependency` · `_list_goal_signals` · `_create_goal_signal` |
| **Context Map** | `dev_tools_list_context_groups` · `_create_context_group` · `_update_context_group` · `_delete_context_group` · `_reorder_context_groups` · `_list_contexts` · `_create_context` · `_update_context` · `_delete_context` · `_move_context_to_group` · `_create_context_group_relationship` |
| **Codebase scan (async)** | `dev_tools_scan_codebase` · `_cancel_scan_codebase` · `_get_scan_codebase_status` |
| **Idea Scanner (async)** | `dev_tools_list_scan_agents` · `_run_scan` · `_cancel_scan` · `_get_idea_scan_status` · `_list_scans` · `_create_scan` · `_update_scan` |
| **Ideas** | `dev_tools_list_ideas` · `_create_idea` · `_update_idea` · `_delete_idea` · `_bulk_delete_ideas` · `_create_idea_batch` |
| **Triage** | `dev_tools_list_triage_rules` · `_create_triage_rule` · `_update_triage_rule` · `_delete_triage_rule` · `_run_triage_rules` |
| **Tasks (async)** | `dev_tools_list_tasks` · `_create_task` · `_update_task` · `_delete_task` · `_execute_task` · `_start_batch` · `_cancel_task_execution` |
| **Pipelines** | `dev_tools_create_pipeline` · `_list_pipelines` · `_get_pipeline` · `_advance_pipeline` · `_delete_pipeline` |
| **Competitions** | `dev_tools_start_competition` · `_list_competitions` · `_get_competition` · `_refresh_competition_slot` · `_get_competition_slot_diff` · `_pick_competition_winner` · `_cancel_competition` · `_delete_competition` |
| **Git / PR Bridge** | `dev_tools_create_branch` · `_apply_diff` · `_run_tests` · `_get_git_status` · `_commit_changes` |
| **Portfolio / cross-project** | `dev_tools_search_across_projects` · `_list_cross_project_relations` · `_upsert_cross_project_relation` · `_get_cross_project_map` · `_generate_cross_project_metadata` · `_get_cross_project_metadata` · `_get_portfolio_health` · `_get_tech_radar` · `_get_risk_matrix` · `_get_project_summary` · `_get_dependency_graph` |
| **Health snapshots** | `dev_tools_list_health_snapshots` · `_save_health_snapshot` |

## Reference: frontend modules

```
src/features/plugins/dev-tools/
├── DevToolsPage.tsx              # tab host + ProjectSelector banner
├── constants/
│   ├── scanAgents.ts             # 21 agent definitions + auto-match rules
│   ├── ideaCategories.ts         # technical/user/business/mastermind
│   └── ideaColors.ts             # static Tailwind color maps (no dynamic classes)
├── hooks/
│   ├── useDevToolsActions.ts     # typed facade over devApi + store actions
│   └── useContextScanBackground.ts   # background context-scan event listener
├── sub_overview/
│   ├── ProjectOverviewPage.tsx   # GitHub / GitLab / Sentry stat tiles
│   └── adapters.ts               # provider detection + API adapters
├── sub_llm_overview/             # LLM Overview tab (LLM-observability rollups)
│   ├── LlmOverviewPage.tsx       # Layer 1 assignment matrix + Layer 2 pinpoints table
│   ├── useLlmPinpoints.ts        # active-project binding + 5-state data layer
│   └── llmTracingAdapters.ts     # LlmPinpoint contract + per-tool adapters + foldByUseCase
├── sub_projects/
│   ├── ProjectManagerPage.tsx    # CRUD + GitHub repo selector
│   ├── GitHubRepoSelector.tsx    # live repo list from token
│   ├── CrossProjectMetadataModal.tsx
│   └── ImplementationLog.tsx     # per-project activity feed
├── sub_context/
│   ├── ContextMapPage.tsx        # scan orchestration + data assembly
│   ├── ContextLedger.tsx         # the ledger: contexts × use-cases cross-tab
│   ├── contextLedgerShared.tsx   # props contract, coverage cluster, triage strip
│   ├── useUseCases.ts · ContextDetail.tsx
│   └── ScanOverlay.tsx           # streaming progress overlay
├── sub_scanner/
│   ├── IdeaScannerPage.tsx       # agent selection grid + results + history
│   ├── AgentScoreboard.tsx       # Proposal B: per-agent performance table
│   ├── IdeaEvolutionPanel.tsx    # fitness ranking + synthesis + duplicates
│   └── ideaEvolution.ts
├── sub_triage/                   # component library only — the page moved to
│   │                             # Overview › Approvals › Backlog
│   ├── TriageRulesPanel.tsx      # conditional auto-triage rules
│   ├── EffortRiskFilter.tsx
│   └── findings/                 # FindingBadge · SweepButton · SensorScoreboard
├── sub_runner/
│   ├── TaskRunnerPage.tsx        # batch queue + phase progress
│   ├── PrBridge.tsx              # Proposal A: idea → draft PR card
│   ├── TaskOutputPanel.tsx       # live streaming output
│   └── SelfHealingPanel.tsx      # failure-aware retry surface
├── sub_lifecycle/
│   ├── LifecyclePage.tsx         # Dev Clone setup (no tab strip)
│   ├── CompetitionPage.tsx       # standalone "Competition" sidebar item → CompetitionList
│   ├── setup/FlowSteps.tsx · ReadinessGates.tsx · DevCloneAdoptionCard.tsx
│   ├── tabs/SetupTab.tsx
│   ├── competitions/             # NewCompetitionModal, StrategyLeaderboard, RacingProgress, qualityScore, …
│   ├── goals/forceLayout.ts      # constellation force-directed layout
│   ├── GoalConstellation.tsx · GoalKanban.tsx
│   └── i18n/                     # 14 language stubs (deprecated — use root i18n)
└── sub_skills/                   # Skills Manager (2nd-level "Skills" item)
    ├── SkillsManagerPage.tsx     # page chrome + tab routing ONLY (re-exports the row types)
    ├── skillsManagerRows.ts      # WsRow/ProjRow types + useSkillsManagerRows (row derivation + adopt/share/use ops)
    ├── SkillsOverviewPanel.tsx   # the Overview surface as ONE mountable component (board + its 2 detail modals)
    ├── skillsManagerData.ts      # data spine (workbench reuse + coverage + usage + memory switch)
    ├── skillsManagerBits.tsx     # MemoryBindingButton · UsageLine · CoverageBar
    ├── SkillsManagerBoard.tsx    # columnar board (Name·Usage·Last used·Action), icon actions
    ├── SkillActionConfirm.tsx    # Adopt/Share/Use confirmation modal (description + args for Use)
    └── SkillContextsModal.tsx    # per-context progress modal (Bars)
```

**Database & Monitoring dimension modals (2026-08-06).** The wall's Database and
Monitoring cells no longer fall through to the generic deploy popover — each
opens its own modal (`improve/DatabaseModal.tsx`, `improve/MonitoringModal.tsx`),
reachable identically from the wall and the Mastermind canvas via the shared
`improve/ImproveSurface.tsx` router (ONE row-key → surface decision for every
entry point; the canvas previously carried a two-branch copy that silently
missed every modal row). Both ride the new per-environment connector table
(`dev_project_env_connectors`, keyed project × dimension × env, capability
suffixes like `monitoring.logs`). Database: three env slots (local/test/prod),
each showing the DETECTED engine (brand glyph via techIcons — 15 new DB-provider
glyphs) beside the BOUND vault connector, assign/reassign/unbind per slot.
Monitoring ("Console v2", prototype winner): 2×2 capability cards — technical /
LLM / logs+tracing / metrics — each split codebase|vault with hero-size tool
marks that merge to a single mark when both sides name the same tool; four
states (empty / unconfirmed / not-implemented / covered) from crossing the two
facts; NOT_IMPLEMENTED offers a Claude integration deploy that reads the bound
connector. Header carries the current observability level (segmented strip) +
view-only vault marks; the commit-row footer carries THIS project's
queue/deploy actions (fleet-wide "queue for all N" stays in the wall popover,
whose body is now the shared `ImproveClassicPanel` over `useImproveActions`).
Each card also dispatches a FOCUSED per-area scan session. **One Skills UI, two entry points (2026-08-04).** The Skills surfaces are no
longer page-only. `SkillsOverviewPanel` (Overview board) and `RegistryTab`
(coverage heatmap) are mountable components, and the **Skills Workbench modal**
— opened from the Passport wall's skills cell and from the Mastermind canvas's
green Skills cell — mounts exactly those: its **Manage** lane renders
`SkillsOverviewPanel`, its **Dispatch** lane renders `RegistryTab`. The modal's
former private two-pane list+detail (`SkillListPane` / `SkillDetailPane` /
`resolveLane`) is **deleted** — it was a second, thinner skills UI that showed
no coverage, memory binding, usage or context picker, and meant every skills
improvement had to be built twice. Row derivation and the adopt / share / use
operations live once in `useSkillsManagerRows`, which the page's Overview tab,
the page's Analytics tab and the modal all consume. The modal is `size="6xl"`
with a viewport-relative height because a two-panel board and a skills ×
projects matrix need more room than the old 540px `lg` shell.

### Skills Manager (`skills` tab)

The workspace skill library (`~/.claude/skills`) on the left, the **active
project's** installed skills on the right, a project switcher in the toolbar.
Both panels are columnar — **Name · Usage · Last used · Action** — with sortable
Skill/Usage headers (sorting applies WITHIN groups); grouping renders as divider
rows only (left: category; right: context-tracked vs standard, no category),
installed state is an icon, and the 30-day window is stated once per panel
footer. Row actions are **icon-only** (Adopt ↓ / Share ↑ / Use ▶) and each opens
a **confirmation modal** showing the skill's description before firing; the
**Use** action (project side) dispatches the skill (`/skill args`, optional args
field + live preview) via the SkillsWorkbench, over one of two transports:

- **Fleet** — a background session inside the app (`runDispatch` → `spawnSession`).
- **Terminal** — `runConsole` → `fleet_spawn_external_console`, which opens a NEW
  OS console window already `cd`'d to the repo root with the Claude CLI running and
  the `/skill …` command seeded, carrying `--dangerously-skip-permissions` to match
  the Fleet lane (a skill run walks the whole repo). The window is the operator's:
  the app keeps no handle, cannot steer or kill it, and it outlives the app.
  Windows-only today; when no console can be spawned the exact command falls back
  to the clipboard, which is what this lane used to do unconditionally.

**"All contexts" batches differently per transport, because a batch costs
differently per transport.** Fleet spawns one background session per context — it
manages them, so N is free. A console is an OS window the operator closes by hand,
so this lane opens **exactly one** regardless of N (on this repo, "all" is 767).
`consolePrompt()` builds the seed: a single run stays a bare `/skill args` so the
CLI recognizes the slash command, while a batch becomes prose listing every command
and asking for them one at a time — text appended to a slash command would be
swallowed as arguments, so the batch seed deliberately does not lead with one. Past
~4 KB of command list the batch travels as `.personas/skill-batch.md` (written via
`fleet_write_dispatch_brief`) and the prompt points at it, staying clear of the
~32 KB Windows command-line ceiling and letting the operator re-run the batch after
closing the window. Pinned in `skillsWorkbenchData.test.ts`.
Reuses the unified skills-workbench ops (adopt/share = Sonnet-pinned Dev-runner
LLM tasks). Rows carry transcript-mined usage (`skill_usage` — automatic, no
skill instrumentation needed), a **memory-binding icon** (internal ledger /
Obsidian / none — click cycles it by patching the SKILL.md `memory:`
frontmatter), and the project side splits **context-tracked** skills (declared
`contexts: tracked` in frontmatter OR evidenced by skill-attributed Memory
Ledger nodes) from standard ones. Context-tracked rows show **coverage %**
(distinct contexts with fresh ≤30d nodes from that skill / all contexts) and
click through to a per-context progress modal. Attribution contract: outbox
node lines carry `"skill":"<name>"` (baked into the dispatch MEMORY BLOCK).

**Two ingest doors** (2026-07-29). A skill only reports coverage when the repo
looks Personas-managed — the gate is a **`.personas/` directory at the repo
root**, which is why the marker dir is committed rather than generated. The
outbox it leaves behind is swept into the ledger by (a) the Fleet session-exit
listener, for sessions the app itself spawned, and (b) **opening this panel**,
which calls `ingestMemoryOutbox` for the active project before reading
coverage. Door (b) exists because a skill run manually in a terminal
(`/perfect`, `/explorer`, `/architect`, …) is not a Fleet session — without it
those runs write an outbox nothing ever reads, and their coverage stays at 0%
forever. A missing outbox is a no-op, so the sweep-on-view is free.

All copy lives under `t.plugins.dev_tools.*` in `src/i18n/locales/en.json` (≈180 keys, including the `pr_bridge_*` and `scoreboard_*` blocks). Color tokens are static maps in `constants/ideaColors.ts` — dynamic Tailwind classes (`bg-${color}-500/15`) are banned because the JIT cannot see them. Tauri IPC uses `invokeWithTimeout` from `@/lib/tauriInvoke`; raw `invoke` is blocked by ESLint. Store slices live under `src/stores/slices/system/devTools*Slice.ts` and are composed into the single `useSystemStore`.
