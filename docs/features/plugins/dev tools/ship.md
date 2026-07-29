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

Everything else, progress, the context footprint, the four exit criteria and the overall verdict, is **derived at read time** in `useShipData.ts` by joining those decisions against signals the Factory already trusts: context health from Sentry attribution, active KPIs, use-case slices, and whether the project's monitoring / LLM-tracking connectors are bound.

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
| `cut_at` | stamped once, on the first transition to `active`. **The scope-creep baseline** |
| `shipped_at` | stamped on transition to `shipped` |
| `created_at`, `updated_at` | |

Index: `idx_dev_milestones_project (project_id, status, order_index)`.

### `dev_milestone_items` (`incremental.rs:6311-6326`)

| Column | Notes |
| --- | --- |
| `milestone_id` | cascades |
| `item_kind` | CHECK `use_case` / `goal`. `use_case` rows are the work, `goal` rows are the bound objectives |
| `item_id` | polymorphic, so **no foreign key**. Orphans are swept at read time (the VM drops any item whose target no longer resolves) |
| `bucket` | CHECK `core` / `later` / `never` |
| `added_after_cut` | derived on the backend, never passed in |
| `order_index`, `created_at` | |

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

**planned → active ("Certify cut").** Ungated: the button is always enabled for a planned milestone. `update_milestone` stamps `cut_at` with `CASE WHEN ?2 = 'active' AND cut_at IS NULL` (`dev_tools.rs:6763-6769`), so a milestone that is re-activated after being moved around keeps its original baseline. From this point, every **new** membership is flagged as scope creep.

**active → shipped ("Certify ship").** Gated: the button is disabled while `shipVerdict(vm.criteria) !== 'go'`, that is, while any of the four exit criteria is anything other than met. The tooltip switches between "Every criterion reads GO. Ship it" and "Blocked until every exit criterion reads GO". The transition stamps `shipped_at` unconditionally.

**shipped.** `editable` becomes false, so the lifecycle button, the compose button and every bucket / promote / remove action disappear. The milestone becomes a read-only record; its progress reads 100 percent and its target label becomes `shipped <date>`.

The gate is UI-side only. `update_milestone` itself validates the enum but does not refuse a `shipped` transition on an unmet criterion, because criteria are derived client-side and the backend has no view of them.

**Not implemented in the UI:** setting or editing `target_date`, reordering milestones (`order_index`), renaming, editing the milestone `goal` sentence after creation, and deleting a milestone. The API wrappers (`updateMilestone` patch fields, `deleteMilestone`) and the Rust commands all exist and are tested, but nothing on the Ship surface calls them. Milestones created here always land at `order_index = MAX+1` with no target date, except the onboarding seed (see §9).

## 5. The four exit criteria

Built per milestone in `useShipData.ts:182-226`. Each one carries a label, a derived evidence string, a `done/total` pair rendered on the chip, and a state.

State vocabulary (`shipModel.ts:17-18`): `go` = met, `warn` = partial, `nogo` = blocking, `setup` = the sensor or the scope is not wired yet.

| Criterion | `done/total` | State rules | Evidence |
| --- | --- | --- | --- |
| **Core contexts healthy** (`contexts`) | healthy footprint contexts / footprint size | empty footprint → `setup`; any `crit` context → `nogo`; some unhealthy → `warn`; all healthy → `go` | "N of M in-scope contexts healthy", plus " · critical: <names>" when any context is critical |
| **KPI coverage on core scope** (`kpi`) | footprint contexts with at least one active KPI / footprint size | empty footprint → `setup`; full coverage → `go`; otherwise `warn` | "N of M core contexts carry an active KPI" |
| **Objective bound** (`objective`) | 1 or 0 / 1 | at least one bound goal → `go`, otherwise `setup` | the bound goal names joined with " · ", otherwise "Bind a measurable goal from the composer" |
| **Sensors wired** (`sensors`) | (monitoring wired ? 1 : 0) + (LLM tracking wired ? 1 : 0) / 2 | both → `go`, otherwise `setup` | "Monitoring + LLM tracking both report" or "Bind monitoring / LLM connectors in Observability" |

"Healthy" for the contexts criterion means `tone === 'ok'` specifically, so a context with zero KPIs (`setup` tone) also counts as unhealthy there. That is intentional overlap with the KPI criterion: an unmeasured context fails both.

The sensor booleans come straight off the project row: `llmWired = Boolean(project.llm_tracking_credential_id)`, `monitoringWired = Boolean(project.monitoring_credential_id)` (`factoryL2Data.ts:166-167`). Note the consequence: with monitoring unbound, every context's `errors` is `null`, so no context can ever read `crit` and the contexts criterion cannot go `nogo`. The sensors criterion is what surfaces that gap.

**The verdict.** `shipVerdict` (`shipModel.ts:129-135`) folds the four states with a fixed precedence: `nogo` > `setup` > `warn` > `go`. Anything short of all-four-`go` blocks the ship certification. Note that `setup` outranks `warn`, so an unwired sensor is treated as more urgent than partial coverage: you cannot judge what you cannot measure.

Criterion chips render in the content header with a border and text in the criterion's hue (emerald / amber / red / blue), the `done/total` figure, and a native tooltip carrying the evidence line.

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

`useShipData.ts:173-177`: take the CORE members only, flatten their features' context names, dedupe, and resolve back to `ShipContext` records. Later and never members contribute nothing.

Consequences worth knowing:

- Adding a feature to the cut automatically pulls in every context it slices. The composer's footprint strip is labelled to say so ("every row pulled its contexts into the footprint above").
- The footprint is matched **by context name**, not id, because features carry display-ready context names. A context rename between a scan and a read reshapes the footprint accordingly.
- An empty core cut yields an empty footprint, which is why both derived criteria read `setup` rather than a false `go`.

The composer renders the footprint as a chip row tinted by tone, with a summary line counting the critical and KPI-less contexts inside it.

## 7. Composer, library tree and context drawer

The Planner has two workspace modes on the right, cross-fading in place (`ShipPlannerTab.tsx:333-348`).

### Default: the scope ledgers

Two ledgers rendered through the shared `LedgerRow` / `LedgerList` / `LedgerHeader` components in `shipRows.tsx`, so every Ship surface that lists items reads as one system.

- **In the cut** with an `N/M ready` count: the core members, each with its context chips, derived state label, and an amber blocker line when one exists. Row actions demote to Later or Never.
- **Outside the cut**: every non-core member plus every unassigned feature. Row actions are Cut (promote to core), Later, Never, with the current bucket highlighted.

### Compose scope (`ShipMilestoneComposer.tsx`)

A two-pane surface: the project library on the left, the milestone's live cut on the right (bound-goal chips, the derived footprint strip, the core member list with Remove actions).

**Library tree** (`ShipLibraryTree.tsx`), built for the 10-to-100-context case:

- **Group bands.** Contexts are bucketed by their `dev_context_groups` group, colored by the group's color (named palette or a raw hex), with ungrouped contexts collected into a trailing "Ungrouped" band. The first band opens by default.
- **Context rows.** A tone dot, the name (a button that pops the drawer), a chevron that expands children in place, and a right-side count reading `Nf Mg` (features, goals), `empty`, plus " · in cut" when the context is already in the milestone's footprint.
- **Children.** Features (violet sparkle) with an add-to-cut button or an "in cut" label; goals (teal target) with a Bind button or a "bound" label, each carrying a goal-assist lightning button.
- **Quick-add.** Every expanded context ends with an inline "New feature in <context>..." input. Submitting calls `createUseCase` with that context as both the sole slice and the primary context, so a thin library never dead-ends.
- **Filter.** One search box over contexts, features and goals. A context survives if its own name matches, or any feature or goal beneath it matches. An active query force-opens every surviving band and context, and an empty result renders a "Nothing matches" state.
- **New goal.** Opens the shared `GoalEditorModal` from `sub_goals`, so goals can be authored here without leaving the composer.

**Context drawer** (`ShipContextDrawer.tsx`): a 380px right-side panel opened by clicking a context name. It re-hosts the Context Map's ContextDetail pattern on Ship-local data only, never `systemStore`. Contents: group name, a health record row (file count, KPI count or "no KPI", error count when monitoring is wired), the features slicing this context, the goals attached to it, and up to 8 sample file paths with a "+N more" tail. Features and goals in the drawer carry the same Cut / Bind affordances as the tree, so the drawer is a selection surface, not just a readout.

## 8. Fleet dispatch and goal assist

Evaluation stays derived; **resolution** is a dispatch. Both paths are consent-first: the generated brief is shown in an editable textarea before anything spawns.

### Criterion dispatch (`ShipDispatch.tsx`)

A criterion chip whose state is not `go` grows a violet lightning button, but only when `buildCriterionPrompt` returns a brief. Only two of the four criteria have agent-shaped work:

- **`contexts`** builds a brief listing every critical and warning context in the footprint with its error count, and asks the agent to investigate recent errors, fix the highest-impact root causes surgically, and run the relevant tests. Returns null when nothing is crit or warn.
- **`kpi`** builds a brief listing the footprint contexts with zero active KPIs and asks for 1 to 2 concrete measurable KPI proposals each (name, unit, direction, baseline, target, and how to measure), written to a markdown summary for the operator to accept into the KPI module. Returns null when coverage is complete.
- **`objective`** and **`sensors`** return null by design: binding a goal and binding connectors are human decisions.

Confirming spawns a Fleet Dev-runner session in the project's `root_path` via `dispatchRowToFleet`, keyed `passport:ship-<criterion>:<projectId>` (`shipDispatchKey`). The `passport:` prefix is load-bearing: it keeps the session inside `usePassportFleetSessions`' watch window, which is the same machinery the passport wall uses. Once a session exists for that key, the chip's lightning is replaced by a terminal icon tinted by session state, and clicking it opens `PassportTerminalModal`.

### Goal assist

The "too many contexts to comprehend" helper. A goal can be written without picking a context (the shared `GoalEditorModal`), then handed to an agent from either the library tree, the drawer, or a bound-goal chip in the composer. `buildGoalAssistPrompt` (`ShipDispatch.tsx:32-52`) briefs the agent with four ordered jobs:

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
| Project has zero contexts | `UnchartedEmptyState` in the library tree | The motionized `SCOPE_MAP_GLYPH`, "Nothing mapped yet", and a **Run context scan** button. The scan goes through `scanCodebase`, registers in the activity dock as `factory_scan`, and refetches both the context map and the milestones when `CONTEXT_GEN_COMPLETE` lands with a matching `scan_id` (`useShipData.ts:278-303`) |
| Contexts scanned but no features or goals | library hint line | "The scan mapped these areas but no features exist yet. Add the first ones right here, or run the feature scan from Overview." |

### The onboarding seed milestone

`seedOnboarding.ts`. When the passport wall's "Onboard with Fleet" action dispatches (`PassportActionsRow.tsx:66-71`), it fires `seedOnboardingMilestone(projectId)` so a fresh project's Ship tab never opens empty. The seed:

1. Returns immediately if the project already has any milestone (idempotent).
2. Creates a `dev_goal` titled "Passport created: Personas onboarding complete".
3. Creates an **active** milestone named "Onboard to Personas" whose goal sentence is the onboarding completion statement.
4. Binds the goal as a `core` item.

The seeded strings are resolved through `getActiveTranslations()` at creation time, not at render time, because seeded content is persisted data and should read in the language the user was using when it was written.

The result is a project whose first deliverable is the Personas onboarding itself: one active milestone, one bound objective (so the `objective` criterion already reads `go`), and an empty cut. Note that because the milestone is created directly as `active`, its `cut_at` is **not** stamped (only an `update_milestone` status transition stamps it), so items added to the seed milestone are not flagged as creep.

## 10. Where the code lives

| File | Responsibility |
| --- | --- |
| `src/features/teams/sub_factory/l2/ship/FactoryShipTab.tsx` | Tab wrapper, `data-testid="factory-ship-tab"` |
| `.../ship/ShipPlannerTab.tsx` | The surface: content header (goal, criterion chips, lifecycle + compose buttons), roadmap spine, workspace switch, dispatch and terminal modals |
| `.../ship/ShipMilestoneComposer.tsx` | Two-pane compose mode: library, bound goals, footprint strip, live cut, goal editor, dispatch chooser |
| `.../ship/ShipLibraryTree.tsx` | Group bands, context rows, feature/goal children, quick-add, filter, uncharted empty state |
| `.../ship/ShipContextDrawer.tsx` | Right-side context detail panel with Cut / Bind affordances |
| `.../ship/ShipDispatch.tsx` | `shipDispatchKey`, `buildCriterionPrompt`, `buildGoalAssistPrompt`, `ShipDispatchModal` |
| `.../ship/shipModel.ts` | Types, ink maps, `shipVerdict`, `featureState`, `bucketLabel` |
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
- The ship gate is client-side only; the backend accepts any valid status transition.
- The `SHIP_GOAL_REPORT.md` fallback written by goal assist has no ingestion path; the operator reads it manually.
- The "errors this week" phrasing in blocker lines and dispatch briefs describes unresolved Sentry issues rather than a strict rolling window.
- `FactoryShipTab.tsx:5-6` names i18n extraction as the remaining pre-ship work; that extraction has since landed (the `ship` section exists in `en.json` and all 14 locales), so the comment is stale.
