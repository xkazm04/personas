# Ship: the milestone convergence layer

**Location:** Projects (sidebar) → Factory → open a project → **Ship** tab (L2). Also reachable in one click from the passport wall's cover roadmap strip (L1).
**Source:** `src/features/teams/sub_factory/l2/ship/`
**Backend:** `dev_milestones` + `dev_milestone_items` (SQLite), `dev_tools_*_milestone*` commands
**Status:** wired on live data as of 2026-07-28. The Planner runs on real rows; progress, footprint and exit criteria all derive client-side.

Ship sits between the passport (scaffolding: "can agents develop this?") and the KPI module (post-ship operation: "are the numbers on target?"). It answers the question neither of those does: **what, exactly, are we shipping, and is it done?**

---

## 1. What a milestone is here

A milestone is a **convergence cut**: a named deliverable ("v1 - First Ship") whose scope is a bucketed selection of the project's use cases plus a set of bound goals. It is not a date bucket and not a task list.

The doctrine, stated in three places in the source and enforced by the schema (`src/api/devTools/milestones.ts:1-5`, `src/lib/bindings/DevMilestone.ts:3-8`, `src-tauri/db/src/migrations/incremental.rs:6270-6278`):

> **The schema stores decisions, never percentages.**

Nothing on the Ship surface is typed in by a user as a number. The rows record only:

- which use cases joined the milestone and in which bucket,
- which goals are bound as its objective,
- the status of the milestone and the timestamps of its transitions.

Everything else, progress, the context footprint, the exit criteria and the overall verdict, is **derived at read time** in `useShipData.ts` by joining those decisions against signals the Factory already trusts: context health from Sentry attribution, active KPIs, use-case slices, and whether the project's monitoring / LLM-tracking connectors are bound.

Contexts are deliberately **never** members of a milestone (`src-tauri/db/src/repos/dev_tools.rs:6923` pins this with a test). They follow from the core use cases' slices, so re-scanning the codebase reshapes the footprint without anyone re-picking anything.

**Vocabulary note.** The UI says "feature"; the schema and identifiers say `use_case`. Only the labels were renamed (`shipModel.ts:9-10`).

## 2. How to reach it

**L2 tab.** `FactoryProjectTabs.tsx:38-43` renders four ink tabs (Overview, Ship, KPI matrix, Observability). `tab === 'ship'` mounts `FactoryShipTab`, which is a thin wrapper around `ShipPlannerTab`.

**L1 cover roadmap shortcut.** Each passport cover on the projects wall carries a minimized roadmap strip (`passport/CoverRoadmap.tsx`): one pip per milestone (filled = shipped, ringed = the active cut, hollow = planned, capped at 7 with a `+N` tail), a `shipped/total` count, and a line naming the next unshipped milestone with its target date. The whole strip is one button. Clicking it opens the project **on the Ship tab** instead of the default Overview:

- `ProjectsLayer.tsx:74-88` does one bounded `listMilestones` read per project and builds the view models via `buildCoverRoadmap`.
- `CoverBody.tsx:163-167` renders the strip and forwards `onOpenShip(slug)`.
- `FactoryShell.tsx:157` handles it: `setL2Tab('ship'); setProjectId(id)`.
- `FactoryProjectTabs.tsx:25-37` accepts `initialTab`, read at mount only (the shell remounts this subtree per opened project).

The strip is inert when no `onOpenShip` handler is supplied.

**Mastermind canvas.** Two doors, both landing on the Ship tab (2026-08-20):

- **The island ship chip** (`sub_mastermind/lib/IslandBanner.tsx`) floats above every island's name pill with the next milestone, `shipped/total`, and a warning tint when the forecast is late. It is clickable in **every** canvas mode — it used to be gated on edit mode, which made the one control that answers "where is this project's delivery at" go inert the moment you picked up the connect or note tool.
- **The milestone status bar** (`sub_mastermind/lib/MilestoneStatusBar.tsx`) is one line above the mode toolbar naming exactly ONE milestone for the whole workspace: the focused project's when a project is focused, otherwise the most urgent by the canvas's usual worst-first ordering (late → cut → planned → nearest date, with a dated milestone outranking an undated one). It distinguishes a committed **target** from a velocity **forecast** in the label rather than printing a bare date. It renders nothing when no project has an open milestone. `openMilestones()` is unit-tested in `__tests__/milestoneStatusBar.test.ts`.

Both read `IslandShip`, reduced from the batched `projectWallSummary` fan-out in `MastermindPage.tsx` through the same `buildCoverRoadmap` the passport cover uses — so the cover, the chip and the bar cannot disagree about which milestone is "next".

## 3. Data model

### `dev_milestones` (`incremental.rs:6283-6301`)

| Column | Notes |
| --- | --- |
| `id`, `project_id` | `project_id` cascades from `dev_projects` |
| `name` | required, non-empty (validated in the repo) |
| `goal` | the one-sentence core-value statement the cut converges on. Free text, distinct from bound `dev_goals` rows |
| `status` | CHECK-constrained to `planned` / `active` / `shipped` |
| `order_index` | roadmap ordering; assigned as `MAX+1` at create |
| `target_date` | optional; rendered by the cover strip and the timeline card |
| `cut_at` | stamped once: at INSERT when the milestone is created `active`, otherwise on the first transition to `active`. **The scope-creep baseline** |
| `shipped_at` | stamped on transition to `shipped` |
| `created_at`, `updated_at` | |

Index: `idx_dev_milestones_project (project_id, status, order_index)`.

**Ship is a transition, never a birth state.** Both `create_milestone` and `update_milestone` refuse it: you cannot create a milestone `shipped`, and you cannot jump `planned` to `shipped`. A milestone must pass through `active` (be cut) first, otherwise it would carry a NULL `cut_at` and a NULL `shipped_at` and would be invisible to the velocity forecast.

### `dev_milestone_items` (`incremental.rs:6311-6326`)

| Column | Notes |
| --- | --- |
| `milestone_id` | cascades |
| `item_kind` | CHECK `use_case` / `goal`. `use_case` rows are the work, `goal` rows are the bound objectives |
| `item_id` | polymorphic, so **no foreign key**. Orphans are swept at read time (the VM drops any item whose target no longer resolves) |
| `bucket` | CHECK `core` / `later` / `never` |
| `added_after_cut` | derived on the backend, never passed in |
| `order_index`, `created_at` | |
| `description` | nullable free text: why this member sits in this bucket |
| `rating` | nullable INTEGER, CHECK 1..5. **NULL means unrated**, which is deliberately not the same as a rating of 1 |

Primary key `(milestone_id, item_kind, item_id)`, so an item belongs to at most one bucket per milestone. Index on `(item_kind, item_id)`.

### View models (`shipModel.ts`)

| Type | What it is |
| --- | --- |
| `ShipContext` | a `dev_contexts` row through the Ship lens: `tone` (`ok`/`warn`/`crit`/`setup`), `groupId`, parsed `files`, count of active `kpis`, `errors` (null when monitoring is not wired) |
| `ShipFeature` | an active use case with derived readiness: sliced context **names**, `kpiCount`, `ready`, a state label + hue, and a single strongest `blocker` line |
| `ShipGoal` | a non-completed, non-archived `dev_goal` reduced to id / name / description / status / context names |
| `ShipMember` | `{ feature, bucket, afterCut }`, one per `use_case` item |
| `ExitCriterion` | `{ id, label, evidence, done, total, state }`. The evidence line is derived prose, never hand-typed |
| `ShipMilestoneVM` | the whole milestone: the raw `row`, status, target label, `members`, `boundGoals`, derived `footprint`, `criteria`, and `progress` |

### Derived numbers

- `ShipContext.tone`: `crit` at 25 or more attributed errors, `warn` above 0, `setup` when the context has zero active KPIs, otherwise `ok` (`useShipData.ts:103-107`). Errors come from `useContextRuntime`'s `errorsByContext`, which attributes **unresolved Sentry issues** to contexts by matching the issue culprit against the context's file paths. The UI copy calls these "errors this week"; the underlying source is the unresolved-issue list, not a strict 7-day window, so treat that label as approximate.
- `ShipFeature.ready`: true when the feature has at least one active KPI **and** no `crit` context in its slice. A `crit` context yields `Blocked`; zero KPIs yields `No KPI yet` (`shipModel.ts:138-146`). A feature's KPI count includes KPIs bound directly to the use case plus KPIs bound to any context it slices.
- `ShipMilestoneVM.progress`: `100` once shipped, otherwise ready CORE members / total CORE members, rounded. Zero core members means 0 percent, and the timeline card renders a dash rather than "0%" for a planned milestone with no members at all.

## 4. Lifecycle

Three statuses, driven by one button in the content header (`ShipPlannerTab.tsx:292-305`).

```
planned  --[Certify cut]-->  active  --[Certify ship]-->  shipped
             stamps cut_at              stamps shipped_at
             (first time only)
```

**planned → active ("Certify cut").** Ungated: the button is always enabled for a planned milestone. `update_milestone` stamps `cut_at` with `CASE WHEN ?2 = 'active' AND cut_at IS NULL`, so a milestone that is re-activated after being moved around keeps its original baseline. From this point, every **new** membership is flagged as scope creep.

A milestone can also be BORN cut. `create_milestone` stamps `cut_at` in the same INSERT when it is created with `status = 'active'` (`CASE WHEN ?5 = 'active' THEN ?8 ELSE NULL END`), because such a milestone never passes through the transition above. This closes a real hole: the seeded onboarding milestone (§9) is created directly active, so before this its baseline stayed NULL forever and the creep flag never fired on the one milestone most projects will ever have. A migration (`dev_milestones.backfill_cut_at`) repairs rows already on disk by setting `cut_at = created_at` for active milestones with no stamp.

**active → shipped ("Certify ship").** Gated: the button is disabled while `shipVerdict(vm.criteria) !== 'go'`, that is, while any registered exit criterion is anything other than met. The tooltip switches between "Every criterion reads GO. Ship it" and "Blocked until every exit criterion reads GO". The transition stamps `shipped_at` unconditionally.

**shipped.** `editable` becomes false, so the lifecycle button, the compose button and every bucket / promote / remove action disappear. The milestone becomes a read-only record; its progress reads 100 percent and its target label becomes `shipped <date>`.

The CRITERIA gate is UI-side only: `update_milestone` has no view of client-derived criteria, so it cannot refuse a `shipped` transition on an unmet one. It does enforce the LIFECYCLE, though. A direct `planned → shipped` jump is rejected with an `AppError::Validation` ("A milestone must be cut (set active) before it can be shipped"), so no caller outside the UI, the management HTTP API, a Fleet dispatch or the A2A gateway, can ship a milestone that was never cut. The row is left unchanged on refusal.

Still open by design: `create_milestone` accepts `status: 'shipped'` at creation, producing a milestone with neither stamp. Same class of hole, not yet closed.

**Not implemented in the UI:** setting or editing `target_date`, reordering milestones (`order_index`), renaming, editing the milestone `goal` sentence after creation, and deleting a milestone. The API wrappers (`updateMilestone` patch fields, `deleteMilestone`) and the Rust commands all exist and are tested, but nothing on the Ship surface calls them. Milestones created here always land at `order_index = MAX+1` with no target date, except the onboarding seed (see §9).

## 5. The exit criteria

Criteria live in a **registry**: `SHIP_CRITERIA` in `shipCriteria.ts` is one table of self-describing `{ id, label, derive }` entries, and `deriveCriteria` runs it per milestone. Adding a criterion is an append to that table, not surgery inside the hook. `useShipData` iterates the registry and knows nothing about individual criteria.

`derive` is pure. It receives the milestone's decisions (the row, its CORE members, its bound goals) plus the signals the Factory already trusts (the derived footprint, sensor wiring) and returns `{ evidence, done, total, state }`. Each criterion carries a label, a derived evidence string, a `done/total` pair rendered on the chip, and a state.

**Every registered criterion is active for every milestone.** Per-milestone opt-in is deliberately not built: it needs a schema column, and a criterion a project can switch off stops meaning anything. That remains the open follow-up if projects ever genuinely need different bars.

State vocabulary (`shipModel.ts:17-18`): `go` = met, `warn` = partial, `nogo` = blocking, `setup` = the sensor or the scope is not wired yet.

| Criterion | `done/total` | State rules | Evidence |
| --- | --- | --- | --- |
| **Core contexts healthy** (`contexts`) | healthy footprint contexts / footprint size | empty footprint → `setup`; any `crit` context → `nogo`; some unhealthy → `warn`; all healthy → `go` | "N of M in-scope contexts healthy", plus " · critical: <names>" when any context is critical |
| **KPI coverage on core scope** (`kpi`) | footprint contexts with at least one active KPI / footprint size | empty footprint → `setup`; full coverage → `go`; otherwise `warn` | "N of M core contexts carry an active KPI" |
| **Objective bound** (`objective`) | 1 or 0 / 1 | at least one bound goal → `go`, otherwise `setup` | the bound goal names joined with " · ", otherwise "Bind a measurable goal from the composer" |
| **Sensors wired** (`sensors`) | (monitoring wired ? 1 : 0) + (LLM tracking wired ? 1 : 0) / 2 | both → `go`, otherwise `setup` | "Monitoring + LLM tracking both report" or "Bind monitoring / LLM connectors in Observability" |
| **Scope frozen** (`scope-frozen`) | core members not flagged `added_after_cut` / core members | `cut_at` null → `setup` (no baseline, so the flag carries no information); no flagged member → `go`; otherwise `warn` | "Nothing joined the cut after certification", or "N added after the cut: <names>" |

`scope-frozen` is `warn` rather than `nogo` on purpose: growing a cut is a legitimate decision, and this layer's job is to make it legible, not to block it. But because `warn` folds into `shipVerdict`, a milestone that kept growing after certification can no longer certify as shipped without the operator seeing the creep first. The per-member `added_after_cut` flag it reads is derived by the backend against `cut_at` (§6).

"Healthy" for the contexts criterion means `tone === 'ok'` specifically, so a context with zero KPIs (`setup` tone) also counts as unhealthy there. That is intentional overlap with the KPI criterion: an unmeasured context fails both.

The sensor booleans come straight off the project row: `llmWired = Boolean(project.llm_tracking_credential_id)`, `monitoringWired = Boolean(project.monitoring_credential_id)` (`factoryL2Data.ts:166-167`). Note the consequence: with monitoring unbound, every context's `errors` is `null`, so no context can ever read `crit` and the contexts criterion cannot go `nogo`. The sensors criterion is what surfaces that gap.

**The verdict.** `shipVerdict` (`shipModel.ts:129-135`) folds the four states with a fixed precedence: `nogo` > `setup` > `warn` > `go`. Anything short of all-four-`go` blocks the ship certification. Note that `setup` outranks `warn`, so an unwired sensor is treated as more urgent than partial coverage: you cannot judge what you cannot measure.

Criterion chips render in the content header with a border and text in the criterion's hue (emerald / amber / red / blue), the `done/total` figure, and a native tooltip carrying the evidence line.

### Cycle-time forecast

`shipVelocity.ts` is the one consumer of `cut_at` / `shipped_at` beyond the date label. It is pure and takes `DevMilestone[]`:

- **Evidence.** Every `shipped` milestone carrying BOTH stamps is one observed cut-to-ship cycle. Rows whose `shipped_at` precedes their `cut_at` (clock skew, a hand-edited row) are dropped rather than counted as a negative cycle.
- **Median, not mean.** One milestone that sat for 90 days must not drag the estimate for the well-behaved ones.
- **The evidence bar.** Below `MIN_SAMPLES` (2) observed cycles, `deriveShipVelocity` returns `null` and both surfaces say plainly that there is no history yet. A forecast is never rendered from one data point.
- **The subject.** The forecast is about the next unshipped milestone, chosen with the same rule the cover strip uses (the active cut, else the lowest-ordered planned). A shipped milestone never carries a forecast: it has a real date.
- **The basis.** Counted forward from the milestone's `cut_at` when it is cut (`basis: 'cut'`), otherwise from today, and the copy says "if cut today" (`basis: 'today'`) so the assumption is visible.
- **Against the target.** Both dates are `yyyy-mm-dd`, so `late` is a plain string compare. A late forecast is stated factually next to the target, not raised as an alarm.

Surfaced in two places: `ShipVelocityNote` under the criteria chips in the Planner's content header, and the cover roadmap strip, where `buildCoverRoadmap` folds `forecast` into its view model beside the next milestone's target date.

## 6. Scope buckets and the footprint

Every use case in the project sits in one of four states relative to a milestone: **core**, **later**, **never**, or unassigned (no row at all).

- **Core** is "in the cut". Only core members drive progress and the derived footprint.
- **Later** is explicitly deferred: acknowledged, not this milestone.
- **Never** is explicitly rejected. Rendered dimmed, so a decision to not do something stays visible instead of vanishing back into the unassigned pool.
- **Unassigned** features are listed under "Outside the cut" with an `unassigned` marker and no bucket highlighted.

Buckets are stored, not derived. Re-bucketing an existing member is a plain upsert (`ON CONFLICT ... DO UPDATE SET bucket = excluded.bucket`).

### `added_after_cut`

Derived by the backend at insert time (`dev_tools.rs:6813-6851`): the repo reads `cut_at IS NOT NULL` for the milestone and writes that boolean onto **new** memberships only. Re-bucketing an existing member keeps its original flag, because moving something you already committed to is not creep.

This exists so that scope growth after certification is a visible, permanent fact rather than an argument. In the UI, flagged rows carry a violet "added after the cut" label and, outside the cut, a violet sparkle marker in place of the state dot. Nothing blocks or reverts creep; the layer only makes it legible.

### The derived footprint

`deriveFootprint` in `shipDerive.ts`: take the CORE members only, flatten their features' context **ids**, dedupe, and resolve back to `ShipContext` records. Later and never members contribute nothing.

Consequences worth knowing:

- Adding a feature to the cut automatically pulls in every context it slices. The composer's footprint strip is labelled to say so ("every row pulled its contexts into the footprint above").
- The footprint is matched **by context id**. `ShipFeature` carries both `contexts` (display names) and `contextIds` (positionally aligned), and the join uses the ids. It used to join on names, which was a silent correctness hole: the generated context map emits near-identical names (`teams/factory [1/3]`, `[2/3]`) and every rescan can rename a context, so a collision or a rename dropped contexts out of the footprint. Since the footprint feeds both the `contexts` and `kpi` criteria, a milestone could read GO because a critical context had quietly vanished from its own scope. Renames are now free; only a deleted context leaves the footprint.
- An empty core cut yields an empty footprint, which is why both derived criteria read `setup` rather than a false `go`.

The composer renders the footprint as a chip row tinted by tone, with a summary line counting the critical and KPI-less contexts inside it.

## 7. The control bar, composer and goal rail

### The control bar (`ShipControlBar.tsx`)

One toolbar carries every milestone verb, ordered by how far each reaches:

| | Verbs | What they touch |
| --- | --- | --- |
| 1 | Certify · Compose scope | the milestone itself |
| 2 | Run milestone · Ingest run | hand the cut to a CLI skill and read the result back |
| 3 | Ask Athena | nothing — it starts a conversation |

Before 2026-08-20 these lived in four places (the lifecycle button and Compose floated right of the header, Run/Ingest sat in their own strip, the criteria were a permanent chip row) and there was no single answer to "what can I do to this milestone".

**Certify carries the criteria reading on its own face** — a `met/total` badge in the verdict's colour — which is what the five permanent chips were spending a header row to say.

**Ask Athena** builds the whole live milestone into a briefing (`shipAthena.ts`) and sends it through `useAskAthena` tagged `system_source: 'Ship'`. That tag is load-bearing: the backend files the turn as `TurnOrigin::External`, so Athena is told the surface handed her a situation rather than the operator asking a question. See §13.

### The objective heads the cut, not the page

`LedgerObjectiveHeader` (`shipRows.tsx`) renders the milestone's objective and description as the heading of the **in the cut** ledger, with the ready/total count on the right edge where every other ledger's count sits. They used to live in the page header, above the roadmap spine and separated from the ledger they describe by the velocity note and the duality summary — the milestone's name in one place, its contents in another, and four things to read before reaching anything actionable.

It renders unconditionally. `showCut` hides the LIST when the cut is empty and everything is still outside it; a milestone with no identity on screen at that exact moment would be worse than an empty list.

### Certification is two beats (`ShipCertifyModal.tsx`)

The exit criteria are no longer a permanent chip row. The Certify button opens a panel that shows each criterion's **full derived evidence in the layout** (it used to be compressed into a native `title=`, the one tooltip channel that reaches neither keyboard nor touch), keeps the per-criterion Fleet dispatch arm and its terminal door, and puts the commit at the bottom.

The gate is unchanged: `shipVerdict` over the criteria registry and nothing else. **Cutting is deliberately not gated on the criteria** — cutting is what stamps `cut_at`, and the criteria are measured against the cut, so requiring them first is backwards.

### Two workspace modes

The Planner has two workspace modes on the right, cross-fading in place.

### Default: the scope ledgers

Two ledgers rendered through the shared `LedgerRow` / `LedgerList` / `LedgerHeader` components in `shipRows.tsx`, so every Ship surface that lists items reads as one system.

- **In the cut** with an `N/M ready` count: the core members, each with its context chips, derived state label, and an amber blocker line when one exists. Row actions demote to Later or Never.
- **Outside the cut**: every non-core member plus every unassigned feature. Row actions are Cut (promote to core), Later, Never, with the current bucket highlighted.

### Compose scope (`ShipMilestoneComposer.tsx`)

A two-pane surface: the project library on the left, the milestone's live cut on the right (bound-goal chips, the derived footprint strip, the core member list with Remove actions).

**Goal rail** (`ShipGoalRail.tsx`) — the composer's left pane, and the whole of it.

It replaced a browsable library (group bands → contexts → features → per-context quick-add) and a 380px context drawer on the operator's ruling of **2026-08-24**: composing a milestone must not require browsing a tree to work out which context or use case an idea belongs to. That mapping is the LLM layer's job — `buildGoalAssistPrompt` already asks an agent to assign contexts, do the work and flag the result for review — and demanding it of a person meant asking them to think in the schema's vocabulary rather than their own.

A **goal** is the artifact the operator thinks in: an intention, not a slice of the codebase. So the rail lists goals and nothing else — unbound first, alphabetical inside each half so binding one does not reshuffle the list — with a Bind action, the ⚡ assist, and **New goal** as the primary affordance. The filter only appears past seven goals; a list you can read at a glance does not need a search box above it.

Removed with it, each deliberately: the context tree and feature rows; the per-context quick-add (it minted a use case against a context the operator had to pick — the same demand in a smaller hat); the "what this library is" paragraph; and `UnchartedEmptyState`'s context-scan button. Contexts are still scanned from the Factory's own surfaces, and a goal needs none, so an unscanned project can still be given objectives. `useShipData` lost `createFeature`, `scanContexts` and `ctxScanning` in the same change — they existed only for those two components, and leaving uncalled methods on the hook is the orphan rot this repo measures elsewhere.

Features still reach the cut, through the planner's own **outside the cut** ledger or through Athena — neither of which requires navigating a hierarchy.

## 8. Fleet dispatch and goal assist

Evaluation stays derived; **resolution** is a dispatch. Both paths are consent-first: the generated brief is shown in an editable textarea before anything spawns.

### Criterion dispatch (`ShipDispatch.tsx`)

A criterion chip whose state is not `go` grows a violet lightning button, but only when `buildCriterionPrompt` returns a brief. Only two criteria have agent-shaped work:

- **`contexts`** builds a brief listing every critical and warning context in the footprint with its error count, and asks the agent to investigate recent errors, fix the highest-impact root causes surgically, and run the relevant tests. Returns null when nothing is crit or warn.
- **`kpi`** builds a brief listing the footprint contexts with zero active KPIs and asks for 1 to 2 concrete measurable KPI proposals each (name, unit, direction, baseline, target, and how to measure), written to a markdown summary for the operator to accept into the KPI module. Returns null when coverage is complete.
- **`objective`**, **`sensors`** and **`scope-frozen`** return null by design: binding a goal, binding connectors, and accepting or dropping what joined the cut late are human scoping decisions, not work an agent can do on your behalf.

Confirming spawns a Fleet Dev-runner session in the project's `root_path` via `dispatchRowToFleet`, keyed `passport:ship-<criterion>:<projectId>` (`shipDispatchKey`). The `passport:` prefix is load-bearing twice over: it keeps the session inside `usePassportFleetSessions`' watch window (the same machinery the passport wall uses), and it enrolls the session in the R22 auto-verify loop — when any `passport:*` session exits, `useAutoRescanOnFleetExit` (mounted by the Factory wall and the Mastermind canvas) runs a scoped passport rescan of that project, so the wall reflects what the agent actually changed without a manual rescan. Once a session exists for that key, the chip's lightning is replaced by a terminal icon tinted by session state, and clicking it opens `PassportTerminalModal`.

### Goal assist

The "too many contexts to comprehend" helper. A goal can be written without picking a context (the shared `GoalEditorModal`), then handed to an agent from either the goal rail or a bound-goal chip in the composer. `buildGoalAssistPrompt` (`ShipDispatch.tsx:32-52`) briefs the agent with four ordered jobs:

1. Assign contexts by reading `context-map.json` at the repo root, or inferring from the directory structure.
2. Execute the goal if it is actionable now, otherwise break it down and complete the first step.
3. Update the goal's description with what it learned and an honest progress estimate.
4. Finish with a "MANUAL REVIEW" summary block naming what changed, what was assigned where, and what to verify.

Persistence is best-effort: the brief tells the agent to use the management API on `http://127.0.0.1:9420` if reachable, otherwise to write `SHIP_GOAL_REPORT.md` at the repo root for manual ingestion. There is no automated ingestion of that report.

Unlike criterion dispatch, goal assist goes through the universal `DispatchChooserModal`, so the operator picks the lane (Dev runner / Fleet / CLI), keyed `passport:ship-goal-<goalId prefix>:<projectId>`.

## 9. Empty states and the onboarding seed

The layer has four distinct empty states, each with exactly one follow-up.

| Situation | Surface | What it says and offers |
| --- | --- | --- |
| Project has no milestones | `ShipPlannerTab.tsx:229-237` | "No milestones yet" plus the prominent new-milestone input. The Ship tab is otherwise blank |
| Milestone exists, core cut empty | the In-the-cut ledger | "No cut yet. Promote from the ledger below, or open the composer." In the composer the copy splits by whether the project has been scanned at all |
| Contexts scanned but no features or goals | library hint line | "The scan mapped these areas but no features exist yet. Add the first ones right here, or run the feature scan from Overview." |

### The onboarding seed milestone

`seedOnboarding.ts`. When the passport wall's "Onboard with Fleet" action dispatches (`PassportActionsRow.tsx:66-71`), it fires `seedOnboardingMilestone(projectId)` so a fresh project's Ship tab never opens empty. The seed:

1. Returns immediately if the project already has any milestone (idempotent).
2. Creates a `dev_goal` titled "Passport created: Personas onboarding complete".
3. Creates an **active** milestone named "Onboard to Personas" whose goal sentence is the onboarding completion statement.
4. Binds the goal as a `core` item.

The seeded strings are resolved through `getActiveTranslations()` at creation time, not at render time, because seeded content is persisted data and should read in the language the user was using when it was written.

The result is a project whose first deliverable is the Personas onboarding itself: one active milestone, one bound objective (so the `objective` criterion already reads `go`), and an empty cut. Because the milestone is created directly as `active`, its `cut_at` is stamped at INSERT (§4), so items added to the seed milestone are flagged as creep exactly like anywhere else.

## 10. Where the code lives

| File | Responsibility |
| --- | --- |
| `src/features/teams/sub_factory/l2/ship/FactoryShipTab.tsx` | Tab wrapper, `data-testid="factory-ship-tab"` |
| `.../ship/ShipPlannerTab.tsx` | The surface: content header (goal, criterion chips, lifecycle + compose buttons), roadmap spine, workspace switch, dispatch and terminal modals |
| `.../ship/ShipControlBar.tsx` | The unified toolbar: Certify (with the criteria badge), Compose scope, Run, Ingest, Ask Athena |
| `.../ship/ShipCertifyModal.tsx` | The certify panel — every criterion's evidence, its dispatch arm, and the commit |
| `.../ship/shipAthena.ts` | `buildShipBriefing` — the live milestone as prose for the Ask-Athena handoff |
| `.../ship/ShipMilestoneRun.tsx` | `useShipMilestoneRun` (the two actions + their busy flags) and `ShipRunSummary` |
| `src/features/plugins/companion/useAskAthena.ts` | The one door an app surface uses to start a conversation, provenance-tagged |
| `src-tauri/src/companion/ship_ops.rs` | `describe_ship_milestone` — Athena's read op over a live cut |
| `.../ship/ShipMilestoneComposer.tsx` | Two-pane compose mode: library, bound goals, footprint strip, live cut, goal editor, dispatch chooser |
| `.../ship/ShipGoalRail.tsx` | The composer's left pane: the project's goals, Bind / assist / New goal |
| `.../ship/ShipDispatch.tsx` | `shipDispatchKey`, `buildCriterionPrompt`, `buildGoalAssistPrompt`, `ShipDispatchModal` |
| `.../ship/shipModel.ts` | Types, ink maps, `shipVerdict`, `featureState`, `bucketLabel` |
| `.../ship/shipDerive.ts` | `deriveFootprint`, the pure id-keyed scope derivation lifted out of the hook |
| `.../ship/shipCriteria.ts` | The `SHIP_CRITERIA` registry + `deriveCriteria`. Both unit-tested in `__tests__/shipDerive.test.ts` |
| `.../ship/shipVelocity.ts` | Pure cycle-time forecast from `cut_at` / `shipped_at`. Unit-tested in `__tests__/shipVelocity.test.ts` |
| `.../ship/ShipVelocityNote.tsx` | The Planner header's cycle-time + forecast line |
| `.../ship/shipRows.tsx` | `LedgerRow` / `LedgerList` / `LedgerHeader`, the shared ledger language |
| `.../ship/useShipData.ts` | The live adapter: fetch, join, derive, and every mutation |
| `.../ship/seedOnboarding.ts` | Idempotent onboarding seed milestone |
| `.../l2/FactoryProjectTabs.tsx` | L2 tab strip, `initialTab` entry point |
| `.../l2/factoryL2Data.ts` | The shared L2 data bundle Ship reads (contexts, groups, KPIs, use cases, runtime, sensor booleans) |
| `.../passport/CoverRoadmap.tsx` | L1 cover strip: `buildCoverRoadmap` + the pip row |
| `.../passport/CoverBody.tsx` | Renders the strip on the cover, forwards `onOpenShip` |
| `.../ProjectsLayer.tsx` | Bounded per-project `listMilestones` fan-out for the covers |
| `.../FactoryShell.tsx` | Routes `onOpenShip` to `initialTab='ship'` |
| `src/api/devTools/milestones.ts` | IPC wrappers and the `MilestoneStatus` / `MilestoneBucket` / `MilestoneItemKind` unions |
| `src/lib/bindings/DevMilestone.ts`, `DevMilestoneItem.ts` | ts-rs generated row types |
| `src-tauri/src/commands/infrastructure/dev_tools/milestones.rs` | The seven `dev_tools_*_milestone*` commands (thin, auth-guarded) |
| `src-tauri/db/src/repos/dev_tools.rs:6632-6926` | Repo layer: CRUD, timestamp stamping, `added_after_cut` derivation, enum validation, lifecycle tests |
| `src-tauri/db/src/migrations/incremental.rs:6270-6331` | The `dev_milestones` migration (both tables + indexes) |
| `src/i18n/locales/en.json` → `ship` | Every user-facing string in the layer |

## 11. Known gaps

- No UI for `target_date`, milestone reordering, renaming, editing the goal sentence, or deletion, although the API and repo support all of them (§4).
- The ship gate is client-side only for the UI path; the backend accepts any valid status transition. **Partially closed 2026-08-20** for Athena's path: `ship_milestone_lifecycle` refuses to ship a milestone with no goal bound to it (its `objective` criterion is unmet by definition) and its success message names the criteria it could NOT machine-check. The context-health and sensor criteria remain live readings no backend path can see.
- The `SHIP_GOAL_REPORT.md` fallback written by goal assist has no ingestion path; the operator reads it manually.
- The "errors this week" phrasing in blocker lines and dispatch briefs describes unresolved Sentry issues rather than a strict rolling window.
- `FactoryShipTab.tsx:5-6` names i18n extraction as the remaining pre-ship work; that extraction has since landed (the `ship` section exists in `en.json` and all 14 locales), so the comment is stale.

## 12. Executing a milestone: `/ship-milestone` and its one gated door

Everything above describes *deciding* a cut. This section is about *executing*
one, and it is the only place in the Ship layer where work happens outside the
app.

### The trade the skill makes

A milestone can be executed by an in-app Athena op or by a CLI skill. The skill
was chosen, and the trade is explicit: a Claude Code session is **invisible to
the app's progress surface and writes no audit ledger**. The compensating
control is that the skill reports back through a single validated command.
Without the ingest, a milestone executes invisibly — that is the entire risk of
running it this way, and the reason the two controls sit side by side in the UI.

### Dispatch

The Planner header carries **Run milestone** and **Ingest run**
(`ShipMilestoneRun.tsx`), shown while the milestone is not yet shipped.

Run milestone spawns a Fleet session in the project root with **exactly one
positional token**, `/ship-milestone <milestoneId>`. One token is not a style
preference: the spawner appends `--mcp-config` last, and anything placed after
that flag is swallowed by it. The prompt is built with `skillCommand()` from
`passport/improve/skillsWorkbenchData.ts`, the same helper the Skills workbench
uses.

`ship-milestone` is an app-owned **system skill** — it is listed in
`SYSTEM_SKILLS` (`skill_files.rs`) and mirrored into the installer bundle by
`scripts/sync-system-skills.mjs`, exactly as `scan-sweep` is, so a fresh clone
or a packaged install can dispatch it without the operator having a global copy.

### What the skill does

Its phases are documented in `.claude/skills/ship-milestone/skill.md`:

1. Register in the active-runs ledger; take a worktree for multi-file work.
2. **Resolve the milestone** — management HTTP API on `127.0.0.1:9420` when
   reachable, otherwise a `brief.json` in the run dir. The same fallback
   `buildGoalAssistPrompt` already relies on (§8). Neither available means stop,
   not guess.
3. **Interview the operator** in batched select-style questions — one batch for
   the target state and out-of-scope line, one batch covering every core member
   missing a `description`, each with inferred options plus free text. This is
   the session asking directly in its terminal; it is deliberately **not** the
   app's structured build-session elicitation (where the CLI emits a clarifying
   question, the runner persists it and blocks on a channel, and
   `answer_build_question` resumes it). Nothing is persisted by the runner and
   nothing blocks on the app, which is why the questions and answers are echoed
   back in the result.
4. **Compute the gaps from the duality** (§ the duality summary, `shipDuality.ts`).
   A member is a gap when **any** of: `ready === false` (automation-blocked),
   `rating === null` (unrated), or `rating <= 2` (rated low). Disagreements rank
   first, then automation-blocked, then unrated. Members that are ready and
   agree are not gaps.
5. **Dispatch at most 8 gap-workers**, mirroring `FLEET_PLAN_MAX_ROWS` — the
   same ceiling `SHIP_MILESTONE_MAX_ROWS` adopts, for the same reviewability
   reason. Workers run the repo's own checks and leave the tree clean on their
   branch, per the night-shift worker discipline.
6. **Propose, never widen.** Work the run discovers that the milestone needs
   goes into `proposed_additions` and stops there.
7. Write the result and stop. The skill never marks a milestone shipped —
   certification is the operator's, gated on the exit criteria (§5).

### `result.json`

`<repo>/.personas/ship-milestone/runs/<run-id>/result.json`. `.personas/` is the
app↔skill handshake dir and is already gitignored in managed repos.

```jsonc
{
  "schema_version": 1,
  "milestone_id": "<id>",
  "items": [                         // ≤100, every id already a member
    { "item_kind": "use_case", "item_id": "<id>",
      "changed": "what the run did for this member",
      "suggested_rating": 4,                       // optional, 1..5
      "suggested_description": "why it is in the cut" }   // optional, ≤1200
  ],
  "proposed_additions": [            // ≤8, surfaced only
    { "item_kind": "goal", "name": "…", "rationale": "…" }
  ],
  "asked": [ { "question": "…", "answer": "…" } ],       // ≤20
  "summary": "what advanced, what is blocked, what was not reached"
}
```

Members are `use_case` or `goal` only. **KPIs are not milestone items** — they
are the outcome layer above a milestone (§1), and the door refuses `"kpi"`.

### The door

`dev_tools_ship_milestone_ingest(milestoneId, runDir?)` —
`src-tauri/src/commands/infrastructure/dev_tools/ship_ingest.rs`, modelled on
`dev_tools_workspace_knowledge_ingest` and `dev_tools_kpi_sim_ingest`.

| Guard | Behaviour |
| --- | --- |
| Path confinement | `runDir` is canonicalized and must sit under `<root>/.personas/ship-milestone/runs/`; omitted means the newest un-ingested run |
| Size cap | `result.json` over 1 MiB is refused (`MAX_RESULT_BYTES`) |
| Version check | `schema_version` must equal `SHIP_MILESTONE_RESULT_VERSION` (1); missing or unknown is refused, not best-effort parsed |
| Identity | a `milestone_id` naming a different milestone is refused |
| Membership | an `items` row that is not already a member is refused — it can never insert one |
| Range / kind | `suggested_rating` outside 1..5, or an `item_kind` other than `use_case` / `goal`, is refused |
| Caps | >100 item outcomes, >8 proposed additions |
| Idempotency | a run dir carrying `ingested.json` is refused on a second pass; the marker is written after a successful ingest |

Unlike the harvest door, which skips bad rows and reports them, this one
**validates the whole file before writing anything**. A harvest row is an
independent proposal; a milestone result is a report on a cut, and half of it
applied is a lie about what the run did. A refused ingest writes nothing and no
marker, so a corrected `result.json` can simply be re-ingested.

Every accepted row is written through the ordinary `repo::set_milestone_item`
upsert, replaying **the member's existing bucket** — the door can annotate a cut
but never reshape one, and a pre-cut member is never re-flagged as creep.

Proposed additions come back in `ShipMilestoneIngestSummary` and are rendered as
proposals in the Planner. Nothing adds them; widening the cut stays an operator
decision made in the composer.

### Where this code lives

| File | Responsibility |
| --- | --- |
| `.claude/skills/ship-milestone/skill.md` | The skill: phases, gap rule, interview shape, result contract |
| `.../ship/ShipMilestoneRun.tsx` | Run + Ingest controls and the inline result panel |
| `src/api/devTools/milestones.ts` → `shipMilestoneIngest` | IPC wrapper |
| `src-tauri/src/commands/infrastructure/dev_tools/ship_ingest.rs` | The door: validation, path confinement, idempotency, per-member writes |
| `src/lib/bindings/ShipMilestoneIngestSummary.ts`, `ShipMilestoneProposedAddition.ts` | ts-rs generated result types |
| `src-tauri/src/commands/infrastructure/skill_files.rs` → `SYSTEM_SKILLS` | System-skill allowlist |
| `scripts/sync-system-skills.mjs` | Mirrors the skill into the installer bundle |

---

## 13. Athena's Ship toolset

Added 2026-08-20 (constitution v55). She could propose a whole milestone (`show_ship_milestone`) long before she could read one, so asked where the next milestone stood her only move was to propose a brand-new cut. Three ops close it.

### `describe_ship_milestone` — a read op

Auto-fires, costs nothing, lands as a System episode on her next turn. Resolves, in order: an exact milestone id → an exact milestone name → a **project** name/slug/id, which resolves to that project's open milestone by the same `active`-then-`planned` rule the cover roadmap and the canvas status bar use.

It answers with the live cut per bucket — each member's contexts, active-KPI count, the operator's own note and rating (labelled every time as an opinion that gates nothing), the `added_after_cut` flag — plus the bound goals and the cut/target/shipped dates. Orphan members (a use case a rescan deleted) are reported as orphans rather than dropped.

**What it deliberately does not answer.** The exit-criteria verdicts, per-context health and the ship verdict derive client-side in `useShipData` from runtime signals the database cannot see. Recomputing them in Rust would give the app a second, quieter derivation that drifts from the one on the operator's screen. The op says so in its own body; the Ship control bar's Ask-Athena button is what carries the live reading into a conversation instead.

### `set_ship_scope` — approval-gated

Moves members between `core` / `later` / `never`, or `remove`s the membership. Capped at 8 rows (the shared reviewability ceiling). Every id is resolved against the milestone's own project **before an approval row exists**, so an invented id is refused with a readable reason rather than becoming a row pointing at nothing. It passes `None` for `description` / `rating`, so re-bucketing never erases what the operator thought of a member.

### `ship_milestone_lifecycle` — approval-gated

`cut` (planned → active, freezing the scope) and `ship` (active → shipped). The precondition logic is `ship_lifecycle_target()`, split out of the executor so it is testable against a plain pool.

Both are ordinary approval actions: with autonomous mode off they wait on a click, with it on they fire (the autoapprove allowlist was retired 2026-08-10). That is exactly why the `ship` arm carries the DB-checkable precondition described in §11 rather than trusting a human to be watching.

Tests: `approval_exec_ship.rs::ship_scope_tests` (11).
