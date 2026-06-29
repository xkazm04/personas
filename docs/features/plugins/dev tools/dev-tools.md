# Dev Tools

> An AI-guided development pipeline that turns any codebase into a managed project — scanned into semantic contexts, mined for improvement ideas by 21 specialized agents, triaged Tinder-style, executed as tasks, and shipped as draft pull requests with agent reasoning attached.

The plugin lives at `src/features/plugins/dev-tools/` and is exposed through the **Plugins → Dev Tools** entry in the sidebar. The Rust surface lives at `src-tauri/src/commands/infrastructure/dev_tools.rs` plus sibling modules for the long-running operations (`context_generation.rs`, `idea_scanner.rs`, `task_executor.rs`).

---

## What it does

Dev Tools treats each linked repository as a *Dev Project* with its own lifecycle. The project moves through eight domains, each visible as a tab:

| Domain | Direction | Storage / artifact |
|---|---|---|
| **Overview** (GitHub / GitLab / Sentry stats) | External → App | Read-through cache of open issues, PRs, commits, unresolved errors |
| **Projects** (CRUD + GitHub linking + goals) | App | `dev_projects` table, 1 active project at a time |
| **Context Map** (semantic code domains) | App ↔ Codebase | `dev_context_groups` + `dev_contexts`, generated from a filesystem walk |
| **Idea Scanner** (21 LLM agents) | App → LLM → App | `dev_ideas` rows tagged with `scan_type` + per-scan history |
| **Idea Triage** (accept / reject / delete) | Human → App | Idea status transitions; optional auto-triage rules |
| **Task Runner** (batched execution) | App → LLM → App | `dev_tasks` rows + live output buffer + PR Bridge card |
| **Goals** (constellation + Kanban) | App | Goal graph, dependencies, checklist to-dos, goal↔task links |
| **Lifecycle** (Dev Clone setup) | App | Dev Clone adoption + autonomous review/scan triggers |
| **Competition** (multi-clone strategy races) | App → Claude Code worktrees → App | Parallel task execution; quality-scored strategy leaderboard |
| **Skills** (markdown-based dev patterns) | Disk ↔ App | `.md` files under the user's skills directory |

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

1. Open **Context Map**. Groups are displayed as color-tagged columns; contexts within each group show keywords, entry points, and file-path count.
2. Click **Scan Codebase**. The Rust backend walks the filesystem, clusters files by structural signal (imports, directory layout, naming), and returns `ContextGroup`/`ContextItem` rows. A **ScanOverlay** streams progress lines and can be cancelled mid-flight. Each context card also carries a **goal-coverage badge** — a violet "N goals" chip when one or more goals reference this context (click jumps to the **Goals** tab with the first matching goal pre-selected in the Pulse spotlight), or a dashed "no goal" hint otherwise. Selecting a context opens the right-side **ContextDetail** pane which now also lists the linked goals inline (with title, progress %, and a "done / total tasks" summary per goal — each row is a button that jumps to the goal's Pulse spotlight). The hand-off uses the `pendingGoalSpotlightId` slot in `uiSlice`, which `GoalConstellation` consumes on mount.
3. Scans survive navigation — a status-resync poll on mount reattaches to in-flight jobs via `dev_tools_get_scan_codebase_status`, so leaving the tab during a long scan and coming back picks up where you left off.
4. Completion fires an **in-app notification** (TitleBar bell) with the counts — groups created, contexts created, files mapped — and a redirect link.
5. **Re-scan + scheduling** — once a project has been mapped, the action row swaps the single "Scan Codebase" button for **Re-scan (incremental)** (passes `delta_mode=true` → `dev_tools_scan_codebase` diffs the live tree against `dev_context_file_hashes` and feeds the LLM only changed files, short-circuiting when nothing changed), a **Full re-scan** fallback, and a **Plan update** button. A "Last scan" relative-time tag shows recency. **Plan update** creates a weekly **system-op automation** (`planWeeklyContextScan` → `system_ops_create_automation`, `0 3 * * 1`) for the active project — the same `SystemOpAutomation` the Chain Studio commits; the background scheduler then re-derives the context map weekly and each run surfaces in the **Live Stream** via `dev_tools.context_scan_*` bus events. (Context scans are always scoped to one project.)

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
3. The optional **Auto-Triage Rules** panel above the stack lets you define conditional rules (e.g. "if effort ≤ 3 and impact ≥ 7 → accept") that are applied in bulk via `dev_tools_run_triage_rules`.
4. Progress bar + status badges (accepted / rejected / pending) update live. The help button (and the app-wide `?` shortcut) opens the global keyboard-shortcut cheat-sheet, which lists the triage accept/reject keys under its **Agents** section alongside every other discoverable binding.

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
├── sub_projects/
│   ├── ProjectManagerPage.tsx    # CRUD + GitHub repo selector
│   ├── GitHubRepoSelector.tsx    # live repo list from token
│   ├── CrossProjectMetadataModal.tsx
│   └── ImplementationLog.tsx     # per-project activity feed
├── sub_context/
│   ├── ContextMapPage.tsx        # group/context board + scan orchestration
│   ├── GroupList.tsx · ContextCard.tsx · ContextDetail.tsx
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
