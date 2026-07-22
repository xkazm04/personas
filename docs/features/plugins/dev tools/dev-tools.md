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
| **Idea Triage** (accept / reject / delete) | Human → App | Idea status transitions; optional auto-triage rules. Also the landing point of the **findings spine** — Observability, the Factory passport, the golden-standard scan, and the KPI layer all emit into `dev_ideas` with `origin` / `evidence` / `dedup_key`, so every sensor feeds the same triage → task → PR loop |
| **Task Runner** (batched execution) | App → LLM → App | `dev_tasks` rows + live output buffer + PR Bridge card |
| **Fleet** (Claude Code session aggregator) | App ↔ CLIs | Per-session xterm terminals over the active project's cwd |

Moved to the **Projects** section (rendered by `PersonasPage` under `teamsTab`): **Manage** (project CRUD, formerly `sub_projects`), **Goals**, **Lifecycle** + **Competition** (formerly `sub_lifecycle`), and **Factory** (the project-readiness passport wall). Since the 2026-07 cockpit-prototype adoption the wall has **two views**: **Overview** (default — a 3-column grid of passport covers with a blockers digest; the first layer for looking at projects) and **Compare** (the row-aligned dimension matrix in "Focus ink": segmented level bars for ordinal rows, brand icons with visible tool names, healthy rows receding, blue "set up →" for unwired sensors). Covers morph between the views via framer-motion layout ids. All improve machinery (ImproveCell popovers, connector wiring, LlmTracking live spend, warning badges, golden gauge, trend, markdown export, sorts) is unchanged. The 2026-07-22 wall pass added: **row-label meaning popups** in Compare (every dimension label is a click-target that explains what the row measures), a **confirm popover on the header Rescan** (it re-runs the cross-project metadata scan fleet-wide, so it no longer fires on a stray click), the **"Context graph" row renamed to "Context coverage"** with its cell popover now offering the same two scan modes as the Context Map page (incremental re-scan / full re-scan, via `dev_tools_scan_codebase` delta_mode), and the **Reusable-skills cell redesigned**: it renders two tallies (skills *shared* with the global library / sibling projects by name vs skills *specific* to the codebase) and opens a full **Skills module** (modal, `improve/SkillsModal.tsx`) with two LLM-backed directions — *Adopt from library* (Claude installs the selected skills into the repo's `.claude/skills`, customized to that codebase's commands/layout/conventions) and *Share to library* (Claude generalizes a repo-specific skill — stripping hard-coded paths/commands — and publishes it to `~/.claude/skills`). Both directions dispatch Dev-runner tasks (`createTask` → `executeTask`, visible in the Task Runner + activity dock); the skills cell stays locked (spinning gear) until the run's terminal event, and the wall re-derives on completion. The Brainiac-adoption P0 pass (2026-07-22, plan: `docs/plans/brainiac-adoption-skills-memory-docs.md`) made two more automation-section dimensions real: **Agent memory** is now a probed ordinal (`none → adhoc → curated → governed`; from the repo's MEMORY.md/.claude/memory plus the Claude Code auto-memory dir `~/.claude/projects/<encoded-root>/memory` — index entries + freshness; `governed` unlocks with the P3 review/decay loop) instead of a hardcoded false, and a new **Documentation** row grades `none → README only → structured → source-synced` (docs/ census + a feature-doc-map manifest signalling managed source→doc coupling). Both feed the automation score and the golden-standard rubric, carry level ladders + "why this rating" provenance, and offer Dev-runner setup tasks (baseline docs / MEMORY.md seed) from their cell popovers. The P1 pass added **skill usage telemetry**: a SQLite `skill_registry` (identity + content-hash revision history, reconciled from `.claude/skills` on disk) plus an append-only `skill_usage_events` log **mined from Claude Code session transcripts** (`~/.claude/projects/<encoded-cwd>/*.jsonl` — `Skill` tool_use blocks and `<command-name>` markers, incremental per-file byte watermarks, deduped by session+skill+timestamp; `skill_usage_scan` / `skill_usage_overview` commands). The skills cell gains an amber **dormant** tally (installed ≥30d, zero invokes in the window — age-guarded so new skills never read as dead), the Skills modal shows per-skill `N× / 30d · last <when>` usage lines and drops share candidates whose content already exists in the library under another name, and dormant skills raise `skill_dormant` findings into the triage spine. The same-day env/cost pass split the environment-dependent dimensions **per environment**: the **Database**, **Hosting** and (new row) **Monitoring** cells each render three visually separated slots — **local / test / production** — filled only by what was actually observed (repo-detected db engine → local; a `dev`/`start` script → local hosting; the project's test-env URL → test hosting; a bound monitoring connector → production monitoring) and showing an explicit em-dash empty state where no source or config is known in the codebase. It also added an **App cost** row: monthly running costs read from a well-known **`app-cost.json`** at the repo root (user-maintained and expected **gitignored** — cost data never belongs in version control; picked up by the evidence probe). File present with services → a `$N/mo` total + service count (unpriced entries stay visible); file present but empty → an "add services →" invitation; no file → **NA**, and the cell's gear dispatches a Dev-runner Claude task that creates the JSON skeleton and adds it to `.gitignore` — populating it stays manual for now. Opening a project lands on the **second level, divided into four ink tabs** (`sub_factory/l2/`): **KPIs** (the proposals review queue in the original KPIs-module structure — dense table + detail modal — plus the context×KPI matrix keeping the L3 table / L4 console drill), **Context map** (the Dev Tools Context Map content, read-focused; authoring stays in the original), **Observability** (LLM spend-by-feature + unresolved Sentry errors — the technical dimension; unwired sensors render blue invitations), and **Overview** (the cockpit prototype's Focus health grid wired to REAL contexts, KPI rollups, and runtime sensors). The donor modules (Dev Tools Context Map / Observability tabs, Projects → KPIs) are deliberately kept — dual-run until the Factory versions prove themselves.

Ideas are linked to the agent that proposed them via `DevIdea.scan_type` (a string matching a `ScanAgentDef.key`). Tasks are linked back to the originating idea via `DevTask.source_idea_id`. That single foreign-ish link is what makes the whole loop work: it lets the PR Bridge cite the agent that proposed the work, and lets the Agent Scoreboard score each agent on whether its ideas actually ship.

---

## User flow

The eight tabs are sequenced so a new project can walk top-to-bottom exactly once, then loops through **Scanner → Triage → Runner → PR** forever after.

### 1. Projects — register a codebase

1. Open **Plugins → Dev Tools → Projects**.
2. Click **New Project** and pick a local folder. The name is auto-filled from the directory name, the tech stack can be set visually, and you can attach a GitHub URL to unlock Overview stats and the PR Bridge later.
3. After creation, a **Generate Context Map** CTA appears — skip it only if you intend to define contexts manually.
4. A top-of-page **ProjectSelector** banner persists across every other tab so the active project is always visible. With zero projects it becomes a prompt → "Create Project" CTA; with one it collapses to a label; with many it becomes a dropdown.
5. Each project row carries quick-action icons in the last column: **Open test environment** (when `test_env_url` is set), **Open in VS Code** (deep-links via the `vscode://file/<path>` URI handler — silently falls back if VS Code isn't installed), and **Open project folder** (`shell.open(path)` → OS file manager). All stop click propagation so they don't toggle row activation.
6. **Bulk archive** — a leading checkbox column lets the user multi-select non-archived rows; the header checkbox toggles select-all-visible. When at least one row is selected, a sticky amber action bar appears above the table with a count + **Archive selected** button (loops `updateProject({ status: 'archived' })` per id and reports `Archived N` / `M failed` toasts). Archived rows render their checkbox disabled with an "Already archived" hint.
8. **Bind a Team** (added 2026-05-22) — the project create/edit modal includes an optional **Bound Team** picker listing every `PersonaTeam` (pipeline). When set, the project row in the table shows a small color-stripe pill with the team's name inline. The binding is stored as `dev_projects.team_id` (nullable, no FK — orphan-tolerant per the same rationale as `use_case_id`); if the bound team is later deleted, the pill renders as a muted "team removed" label and the user can rebind. Stage 2 will surface the pipeline's canvas thumbnail + recent run summary inline in the project detail panel.
   > **Removed (2026-05):** a separate **Bind a Group** step (`dev_projects.group_id` → `PersonaGroup`) existed alongside the team binding until the Groups→Teams consolidation retired the PersonaGroup primitive. The team binding above is now the only project↔workspace binding; the group binding + its project-row pill were dropped and existing `dev_projects.group_id` values were re-pointed onto `team_id` by the migration.

### 2. Context Map — scan the codebase into semantic domains

> Standalone design reference: [`context-design.md`](./context-design.md) —
> data model, scan protocol, integrity invariants, consumers, KPI pairing,
> and the forward roadmap.

1. Open **Context Map**. It renders as a single **ledger** (`ContextLedger.tsx`) — a cross-tab whose rows are contexts (grouped into colour-tagged group bands) and whose columns are the project's active **use cases**. See *Use cases* below for how to read it.
2. Click **Scan Codebase**. The scan spawns a Claude CLI pass over the repo (not a structural file walk) and streams `ContextGroup`/`ContextItem` rows back; a **ScanOverlay** streams progress lines and can be cancelled mid-flight. Each ledger row carries that context's **coverage cluster** — files · use cases · goals · ideas · KPIs — where the goal count jumps to the **Goals** board (pre-selecting the first matching goal via the `pendingGoalSpotlightId` slot in `uiSlice`) and the idea count jumps to **Idea Triage**. Selecting a row opens the right-side **ContextDetail** pane, which lists the linked goals inline (title, progress %, and a "done / total tasks" summary per goal) plus the use cases covering that context.

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
  Goals board; ideas open the triage queue).
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
- **On-demand audit** — `dev_tools_audit_contexts` reports referential integrity and freshness: `dangling_file_path` (mapped file gone), `unresolved_cross_ref` (a `cross_refs` entry naming no real context), and `stale_context` (a mapped file whose content changed since the last scan, by content-hash comparison against the cache). It never mutates state.
- **Canonical pins** — a context can be pinned (`dev_tools_set_context_pinned`; exported as `pinned` in the JSON). A **full re-scan preserves pinned contexts** instead of DELETE-and-recreate, and the re-scan prompt tells the LLM not to re-emit them — so hand-curation survives a rebuild.

### 3. Idea Scanner — run 21 specialized agents

1. Open **Idea Scanner**. Agents are grouped into four categories: **Technical, User Experience, Business, Mastermind**.
2. Pick agents manually (single, multiple, or **Select All**) and press **Run Scan**, or press **Auto-Scan** to iterate every mapped context and pick agents by keyword heuristic (see *Scan Agents → auto-match rules* below).
2a. **Configure** (gear) opens a full-page scan-configuration modal with two settings, both threaded through `dev_tools_run_scan` → `run_scan_core` → the LLM prompt: **Context scope** — restrict the scan to selected context groups / contexts (selecting a group toggles all its contexts; the prompt then instructs agents to analyze ONLY those areas; the scope section only appears once a codebase has been mapped), and **Target findings** (granularity) — a per-area target count injected as a "Target volume" hint (quality stays the gate, never padding). The button carries a badge when a scope/target is active; the scope resets on project switch. (Previously `context_id` was accepted but ignored — scans were always whole-project.)
3. A **ScanProgress** card streams live progress while the run is active. Ideas arrive as `DevIdea` rows with category, agent key, effort/impact/risk (1-10 each), and an optional `reasoning` blob.
4. The **Results** grid shows per-scan idea cards with color-coded level badges. A **Scan History** table below records timestamps, token counts, duration, and the agent set for every past scan.
5. The **Agent Performance** collapsible panel (see *Agent Scoreboard* below) surfaces per-agent accept / implementation / avg-impact stats aggregated across the whole project; it expands/collapses with a height transition.
5a. **Static Scan** runs a deterministic static-analysis CLI (`dev_tools_run_static_scan`). With no tool configured for the project, the button now opens a **Static scan tool** config modal (pick the tool — Fallow/Knip/Jscpd — and the argv command, persisted via `dev_tools_set_static_scan_config`) instead of firing a doomed run that surfaced the generic "Some input values are invalid" validation error; saving runs the scan immediately. Failure status now auto-clears so the control never looks stuck.
7. The **Idea Evolution** panel includes an **Accepted ideas — lifecycle** section at the top — a 3-step Accepted → Tasked → Shipped strip per recently-accepted idea. Each step is tinted by state (emerald for done, amber for running, red for failed, neutral for pending); the Tasked step is clickable and jumps to Task Runner with the matching task scroll-focused + ring-highlighted via the existing `pendingTaskFocusId` slot. The story of how an idea became code now lives in one strip instead of three tabs.
6. The **Scan History** table below the results gains an agent-set filter chip row (one chip per agent that has ever scanned, with a count badge — OR-combine semantics; an amber "Clear filter" chip appears when any chip is active) and a per-row **Rerun** button that re-runs the historical agent set against the current code. Rerun is disabled while another scan is in flight.

### 4. Idea Triage — Tinder-style accept / reject

1. Open **Idea Triage**. Pending ideas form a 3-card stack in the center; sidebar filters narrow by category, scan type, effort range, and risk range.
2. Swipe right (or ➡ / Z) to accept, left (or ⬅ / A) to reject. The top card drags physically via Framer Motion; the border glows red/green based on drag direction. Each card surfaces the proposing agent's identity and Scoreboard rank inline below the title — "🔒 Security Auditor · rank #3 (81% accept)" — computed from the same `computeAgentStats` aggregation the Scoreboard uses, so the credibility signal travels with every triage decision.
3. The optional **Auto-Triage Rules** panel above the stack lets you define conditional rules (e.g. "if effort ≤ 3 and impact ≥ 7 → accept") that are applied in bulk via `dev_tools_run_triage_rules`. Conditions can target `effort` / `impact` / `risk` / `category` / `scan_type` and — since the findings spine — **`origin`**, the sensor that raised the idea (e.g. "auto-accept `passport_gap`"). A classic scanner idea has no origin, so an origin rule never sweeps it up.
4. Progress bar + status badges (accepted / rejected / pending) update live. The help button (and the app-wide `?` shortcut) opens the global keyboard-shortcut cheat-sheet, which lists the triage accept/reject keys under its **Agents** section alongside every other discoverable binding.

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

**Sweeping.** The 🛰 button on the triage action row runs `runFindingSweep` for the
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
`standards_finding` / `passport_gap` / `skill_dormant` → presence-shaped, so absence is the whole verdict.
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

### 5. Task Runner — execute accepted ideas

1. Open **Task Runner**. Click **Batch from Accepted** to materialize one `DevTask` per accepted idea (source-linked via `source_idea_id`), or **New Task** to create an ad-hoc task with a **Quick / Campaign / Deep Build** depth picker.
2. Press **Start Batch**. Tasks transition through phases: `analyzing → planning → implementing → validating → complete`, visible as a tinted progress bar per card.
3. Output streams live via the **TaskOutputPanel** (expandable). Context warnings from the LLM (e.g. "couldn't load referenced file") are flagged as a **Partial context** badge with the full list revealed on expand.
4. A **Self-Healing** panel above the queue watches for failures and offers one-click retries.
5. **PR Bridge** (see *Proposal A* below) appears on every completed task — a collapsible card with the suggested branch name, commit message, PR title and body (with agent citation), plus several actions: *Copy PR body*, *Copy all*, *Copy reasoning* (visible only when the source idea carries reasoning text — drops just the agent's reasoning blob onto the clipboard for pasting into review threads), *Copy git commands* (outputs a ready-to-paste bash block: `git checkout -b`, `git add -A`, multi-line commit via single-quoted heredoc so the reasoning blob round-trips unescaped, `git push -u`, and an optional `gh pr create --draft` block when a GitHub URL is recognized), *Prepare branch & commit* (uses `dev_tools_create_branch` + `dev_tools_commit_changes`), *Open draft PR on GitHub* (via `@tauri-apps/plugin-shell` with GitHub's `quick_pull=1` URL pre-fill). When the source idea has a known scan agent the **PR title** is prefixed `[<emoji> <Agent Label>] <title>` so agent attribution survives in commit-log surfaces (GitHub PR list, `git log --oneline`) that never render the PR body.
6. Tasks linked to a goal show a clickable violet **goal pill** beside the source label; clicking it jumps to the **Goals** tab in one hop (`setDevToolsTab('goals')` + the `pendingGoalSpotlightId` slot in `uiSlice`).

### 6. Overview — live health signals

0. A **project pipeline** summary (Project / Source control / Standards stage cards) renders at the top. Every row is **inline-editable**: click any value — set *or* "Not set" — and an anchored **quick-edit popover** opens over the row with the right control (text input, team/connector or branch select, or pre-commit / automerge toggles). Saving writes through `dev_tools_update_project` (name, connector binding, repo URL, main branch, living test-env) or `dev_tools_set_standards_config` (pre-commit gates, PR base, automerge) and refetches the project. The popover shell is the reusable `QuickEditPopover` (`shared/components/overlays`); the field→draft→save mapping lives in `EditableProjectPipeline` + `pipelineFieldEditor`. The folder path stays read-only (no update path for `root_path`).
1. A two-column layout shows **Codebase** (GitHub / GitLab) on the left and **Monitoring** (Sentry) on the right.
2. Each card handles five states: **empty** (no credential) → **unmapped** (credential exists but not linked to this project) → **loading** → **connected** (with stat tiles) → **error** (with retry).
3. The vital-signs strip (open issues / open PRs / commits / unresolved / events 24h / events 7d) is **drag-to-rearrange**: grab any tile and drop it on another to swap positions. Order persists per project to localStorage under `personas.devtools.overview_tile_order.${projectId}` so each project remembers its "most-watched first" layout. Future tiles added to `DEFAULT_TILE_ORDER` auto-append for users with persisted state.
4. A **TODAY** activity feed sits between the vital signs strip and the connections rail when the store has anything to show. `buildTodayActivity` (in `overviewHelpers.ts`) selects today's scan runs, task created / completed / failed events, and goal signals from the existing Zustand store slices — no new query — then sorts chronologically (capped at 30 entries). Each row is click-jumpable to its source surface via the established `pendingTaskFocusId` / `pendingGoalSpotlightId` handoffs; scan rows jump to the Idea Scanner tab. The "what happened today" story now lives in one panel instead of five.
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
2. **Goals** renders a force-directed **Goal Constellation** (via `forceLayout.ts`) plus a Kanban board with `your turn / agent's turn / done` swim lanes. Goals can have dependencies, and tasks can link to a goal so progress propagates. The **Project Pulse** variant adds a right-side **spotlight pane** that lists the goal's dependency chain (requires / blocks) AND the tasks linked to it — title, status dot, live progress, and a `done/total` counter at the section heading; each task row is a button that hands off to Task Runner and highlights the matching card. Clicking any goal in the left rail updates the spotlight without leaving the tab; clicking a node in the **Baseline** force graph also switches to the Pulse variant with that goal pre-selected, so the spatial view and the actionable view stay connected. The **Kanban** board is interactive: drag a goal card between lanes to change its status (`pending` / `in_progress` / `completed`), and hover any card to reveal ±5% progress nudge buttons on either side of the progress bar — both routes hit `updateGoal` optimistically through the Zustand slice. Each card's top-right corner carries an **add-to-dos** button (left of the expand affordance, hover-revealed) for goals without a checklist.
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
3. The job fans out one LLM call per agent per targeted context, streaming token usage and partial ideas through `IDEA_SCAN_OUTPUT` events.
4. Each returned idea is persisted as a `DevIdea` row with `scan_type = agent.key` and effort/impact/risk extracted from the response.
5. On completion, `IDEA_SCAN_STATUS` fires with `completed | completed_with_warning | failed | cancelled`; the frontend re-runs `fetchIdeas(project_id)` and the scoreboard recomputes.

Because the agent key is stored as a string, *adding a new agent is a single-file change* — append to `SCAN_AGENTS`, give it a prompt, and it shows up in the Scanner grid, participates in auto-scan, and gets its own row in the scoreboard automatically.

### Auto-match rules

The Scanner has an **Auto-Scan** mode that loops every mapped context and picks agents by regex match over the context's name, description, keywords, tech stack, API surface, and file paths (see `SCAN_MATCH_RULES` in `sub_scanner/ideaScannerHelpers.ts`). Example: a context whose keywords include `auth|login|token|secret` gets Security Auditor, a context tagged `mobile|responsive|viewport` gets Mobile Specialist. Contexts with no match fall back to Architecture Analyst + Code Optimizer as a sensible baseline.

### Agent Scoreboard (Proposal B)

A collapsible section in the Scanner aggregates per-agent performance from stored ideas + tasks: **Ideas generated · Accept % · Impl % · Avg impact · Avg effort**. Source logic is in `sub_scanner/AgentScoreboard.tsx`. Null signals (no decided ideas yet, no tasks yet) sort to the bottom; leaders ≥50% acceptance get a 🏆. The whole panel is pure client-side aggregation — zero new backend, zero new schema, zero new dependencies.

### PR Bridge (Proposal A)

A collapsible card on every completed task in the Runner. Source in `sub_runner/PrBridge.tsx`. It parses `DevProject.github_url`, looks up the originating `DevIdea` via `DevTask.source_idea_id`, slugifies the idea title into a branch name, builds a commit message + PR body with the agent citation, and wires three actions: *Copy PR body*, *Prepare branch & commit* (uses existing `dev_tools_create_branch` + `dev_tools_commit_changes` Tauri commands), *Open draft PR on GitHub* (uses `@tauri-apps/plugin-shell` and GitHub's `quick_pull=1&title=…&body=…` pre-fill URL). Non-GitHub hosts (GitLab, Bitbucket) are detected and degrade gracefully to a "copy manually" message.

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
├── sub_triage/
│   ├── IdeaTriagePage.tsx        # Tinder-style swipe stack + filters
│   ├── TriageRulesPanel.tsx      # conditional auto-triage rules
│   └── EffortRiskFilter.tsx
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
└── sub_skills/
    └── SkillBrowserPage.tsx      # markdown skill browser + inline editor
```

All copy lives under `t.plugins.dev_tools.*` in `src/i18n/locales/en.json` (≈180 keys, including the `pr_bridge_*` and `scoreboard_*` blocks). Color tokens are static maps in `constants/ideaColors.ts` — dynamic Tailwind classes (`bg-${color}-500/15`) are banned because the JIT cannot see them. Tauri IPC uses `invokeWithTimeout` from `@/lib/tauriInvoke`; raw `invoke` is blocked by ESLint. Store slices live under `src/stores/slices/system/devTools*Slice.ts` and are composed into the single `useSystemStore`.
