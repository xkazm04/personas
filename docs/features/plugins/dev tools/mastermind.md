# Mastermind — Multi-Project Portfolio (Soundings)

**Location:** Projects (sidebar) → Development → Mastermind
**Source:** `src/features/teams/sub_mastermind/`
**Status:** Soundings is the only view (2026-09-25). The Hex Mosaic canvas it replaced and the 3D audition before it are retired (§8). Mastermind is also the **primary channel** into the deeper dev-tools layers: it deep-links into Factory L2, the project's release plan in the notepad, and the Run Desk.

Mastermind draws every dev-tools project as a **station** on a nautical sounding chart where **depth means urgency**: the project that most needs you floats at the surface, a calm one rests deep. The goal is the same one the canvas had: understand the whole portfolio's state at first sight and act on it (Improve a reading, run an idea scan, dispatch Fleet, open a terminal) without leaving it. Design, data mapping and phases: [`docs/design/mastermind-soundings.md`](../../../design/mastermind-soundings.md).

---

## 1. Entry point and wiring

| Piece | Where |
| --- | --- |
| Sidebar entry | `TeamsSidebarNav.tsx` `DEV_ITEMS` → id `mastermind` (Network icon), i18n key `sidebar.mastermind` (codename, allowlisted untranslated in `docs/i18n/untranslated-allowlist.json`). Hovering or focusing the entry, and entering the Projects section, prefetch Mastermind's data (`lib/prefetchMastermind.ts`). |
| Tab union | `src/lib/types/types.ts` → `TeamsTab` includes `"mastermind"` |
| Route | `PersonasPage.tsx` → `teamsTab === 'mastermind'` → lazy `MastermindPage` |
| Page shell | `MastermindPage.tsx` — wraps content in `FactoryDataProvider` (KPI rollups) and `ImproveProvider` (row-action engine); lazy-loads `soundings/SoundingsView` |

## 2. Architecture

```
MastermindPage (data joins, settle gate, every surface a reading opens)
├── SoundingsView (soundings/ — the chart: levels, focus, keys, Athena's grammar)
│   ├── soundingsModel.ts     urgency metrics, ranking, reasons, lanes (pure)
│   ├── soundingsGeometry.ts  chart geometry, buoy depth, columns, labels (pure)
│   ├── SoundingsCard.tsx     L2 reading card + project file (+ MemorySection)
│   └── soundingsParts.tsx    status marks, ladder, tide, glyphs
├── DataHealthBar             failed data families + one retry
├── AthenaPanel               Athena's composed panel for the focused project
└── popovers / modals         Improve, IdeaScan, Goals, KPIs, stack lists,
                              personas, runners, Fleet preview, Dispatch,
                              Skills Workbench, New project (from the demo notice)
```

Key libs (all under `lib/`):

| Module | Responsibility |
| --- | --- |
| `types.ts` | Scene model (`Island`, `DimNode`, `IslandEdge`, `FleetNode`, `RunnerNode`, `IslandShip`), `ZoomBand` (the action grammar's band vocabulary) |
| `sceneStore.ts` | **The data spine** (zustand): relations, idea scans, goals, monitoring, LLM spend and runners, each with a fetch STATUS; event-driven invalidation instead of polling; a 30 s freshness window so a prefetch is reused |
| `deriveScene.ts` | Passports (+ KPI/scan/live extras) → `Scene`; unsettled passports become provisional; demo scene fallback when nothing is scanned |
| `useSceneSettle.ts` | The settle gate: the chart receives the scene once every family that changes a verdict has answered (5 s ceiling, latched per session), so stations paint once with final values |
| `dimRegistry.ts` | **Single source of truth for dimensions** — label, lane (`category`), `derive()`, wall `rowKey`, action kind. Adding a dimension = one entry here |
| `dimActions.ts` | Reading → Passport-wall Improve applicability (mirrors `ImproveCell` checks) |
| `liveState.ts` | Live project colour: real Sentry error counts via bound monitoring credentials + fleet attention; honest fallback to readiness-only colour |
| `islandStats.ts` / `statsMock.ts` / `llmSpend.ts` | Real per-project stats (KPI attainment, errors, 30d LLM spend, tests/auto/prod); demo projects keep deterministic mock stats |
| `shipSummaries.ts` | One batched `projectWallSummary` IPC → each project's next release, cached for the prefetch |
| `scenePublish.ts` | Publishes the settled scene to `mastermind.scene.v1` for Athena |
| `canvasActionStore.ts` / `canvasTestBridge.ts` | The action grammar Athena (and the dev test bridge, `window.__mmCanvas`) dispatch into; SoundingsView answers it |
| `focusStore.ts` | "This project is the subject": set by Athena's compose op, read by the page (panel) and the chart (travel) |
| `layoutStore.ts` | **Durable layout doc** (`mastermind.layout.v1`): Athena's composed panels. Fields the retired canvas wrote (positions, groups, links, notes, hidden) are carried through on every write, never erased; a doc from a newer build is never downgraded |
| `ListPopover.tsx` | The one list-popover shell (header band, scrolling rows, Escape + outside-click dismissal) behind the goals, KPIs, personas, runners and stack lists |

Tests live in `__tests__/` (deriveScene status/edges/ideas/live/unknown, dimActions, layoutStore, liveState, sceneStore, scene settle, scene publish, canvas action store, Athena panel, jump palette, popovers, Soundings model/geometry and the mounted view).

## 3. Data sources (all read paths)

| Family | Source | Notes |
| --- | --- | --- |
| Projects (passports) | `usePassportData()` (Factory) — cross-project scan + project config → `AppPassport[]`; slug **is** the dev-project id | two-phase publish; `measured` gates the settle |
| Currents (edges) | `sceneStore` → `dev_tools_get_cross_project_metadata` → `cross_project.relations` (kind `relation`) + `similarity_matrix ≥ 0.5` (kind `similarity`) | deduped per pair; endpoints must both exist |
| KPI reading | `FactoryDataProvider` + `collectKpiAttention` / `groupKpis` — the SAME rollup the Passport wall's warning badges use | |
| Idea scans | `sceneStore` → `dev_tools_list_scans` | freshness = newest row's `created_at` |
| Fleet sessions | `systemStore.fleetSessions` (+ event-driven refresh); session→project by **longest `cwd` ↔ `root_path` prefix match** | |
| Running personas | `overviewStore.activeProcesses` → persona → `home_team_id` → `dev_projects.team_id` — the Monitor's join | teamless projects can't attribute persona work |
| Runner tasks | `sceneStore` → one batched `listTasks` IPC, live statuses only; kept live by `useRunnerRefresh` | |
| Live monitoring | `liveState.loadMonitoringSummaries` — per-project bound monitoring credential → Sentry adapter | absent credential ⇒ readiness-only colour |
| Goals | `sceneStore` → `dev_tools_list_goals` per project | ongoing = `isOngoing` from sub_goals/goalStatus |
| LLM spend | `sceneStore` → `lib/llmSpend` (30d trace spend per bound tracing credential, 5-min throttle) | absent key ⇒ "—" |
| Next release | `lib/shipSummaries` | |

**Cold load.** No skeleton: until the scene settles the chart shows its own chrome (water, depth bands) and a "loading projects" line, then the stations fade in at their final depth in one commit. A ghost of stations that did not exist yet had a different geometry from the chart that replaced it and read as a blink.

**Demo scene.** With zero scanned projects, `deriveScene` emits a built-in 6-project demo. A centred **DemoNotice** card makes the sample unmistakable and offers the two exits — scan the workspace (`rescan()`) or add a project (`ProjectModal`); dismissing it leaves a "sample data" badge that re-opens the notice. Demo projects refuse every action (no passport behind them).

**Data honesty.** Each fetch family carries a status; a failed or stale family surfaces in `DataHealthBar` (under the chart's top bar) by name with one retry — the chart never silently renders a partial truth. Idea-scan dispatches are busy **per project** with a 3-minute safety timeout. The page also mounts the R22 auto-verify loop (`useAutoRescanOnFleetExit`): when a `passport:*` Fleet session exits, a scoped passport rescan of that project runs automatically.

## 4. Dimensions (readings)

15 dimensions per project, declared in `dimRegistry.ts`. Status vocabulary (`DimStatus`): `absent` ("null is a first-class answer"), `solid`, `partial`, `risk`, `alert`, `unknown` (the data family failed).

| Key | Label | Lane | Derived from | Improve rowKey → surface |
| --- | --- | --- | --- | --- |
| `db` | Database | runtime | `stack.persistence` (+ migrations ⇒ solid) | `persistence` → Deploy |
| `monitoring` | Monitoring | runtime | monitoring tools + observability level | `monitoring` → Deploy/connector |
| `ci` | CI | delivery | `productionReadiness.ci` | `ci` → **Standards** (Tier-0 config) |
| `tests` | Tests | delivery | tests level (+ coverage detail) | `tests` → Deploy |
| `security` | Security | delivery | security level/tools | `security` → Deploy |
| `hosting` | Hosting | runtime | `stack.hosting` | `hosting` → Deploy |
| `auth` | Auth | runtime | `stack.auth` | — (**view-only by design**, §9) |
| `agents` | Agents | agentic | automation level L1–L5 | `aiflow` → Deploy |
| `skills` | Skills | agentic | `artifacts.skills` | green (installed) → **Skills Workbench**; else adopt → Deploy |
| `llm` | LLM cost | agentic | `stack.llmTracking` | `llmtracking` → Deploy/connector |
| `kpi` | KPIs | product | Factory KPI rollup; off-track ⇒ `alert` | any KPI defined → **KpiListPopover** |
| `ideas` | Ideas | product | days since last `DevScan` | always actionable → **IdeaScanPopover** |
| `goals` | Goals | product | ongoing dev-goal count | count > 0 → **MastermindGoalsModal** |
| `datalinks` | Data analysis | product | `stack.dataLinks` | anything declared → **DimListPopover** |
| `support` | Support | product | `stack.supportChannels` | anything declared → **DimListPopover** |

**KPI rule:** `off > 0` ⇒ `alert`, else `solid`, none defined ⇒ `absent`. Clicking answers *which* — `KpiListPopover` lists every KPI worst-status first; its door opens the project's Factory KPI matrix.

**Ideas freshness:** `<7d` solid, `7–30d` risk, `>30d` alert, never scanned absent.

**Skills Workbench (shared with the Passport wall):** a green Skills reading resolves to `'skills-run'` and opens `SkillsWorkbench` (`sub_factory/passport/improve/`) on its landing chooser; Dispatch runs `/skill <args>` as a background Fleet session.

**Adding a dimension:** one entry in `dimRegistry.ts` (see its `addingADimension` note); deriveScene, dimActions and Soundings (which places it in its lane) pick it up.

## 5. The chart (Soundings)

- **L0 chart.** Stations sit at fixed positions (project name order, so a place always means the same project). Each buoy floats at an urgency depth: `3 x alerts + risks + 2 late + 2 agent waiting + 3 critical / 1 warning + 1 no monitoring bound + 0.25 per gap`; bands Surface (>= 6), Shallows (>= 2), Mid-water (>= 1), Deep. Names are placed by urgency: the most urgent keeps its label above the buoy, a clashing one moves below, a third hides until hover or focus. Floats on the waterline name why (alert count, late release, a lilac flag for an agent awaiting input). Relations are currents along the seabed.
- **L1 station.** Enter widens the station into a water column; the others shrink to slivers that keep their order and a status tick. The fifteen readings sit in four lanes (runtime, delivery, agentic, product) at the band their status puts them in. A strip carries live work (sessions, personas, runner tasks), next release, LLM spend, errors and blockers.
- **L2.** Enter lifts a reading into a card: tooling, the real **Improve** action (the page's `onDimOpen`), the progress ladder, its depth, and the same reading across the portfolio. `I` opens the **project file**: sessions (open the Fleet preview), personas and runner tasks (open their lists), the release plan (opens the notepad), readiness, relations to follow, **Memory** (below), and Dispatch fleet / Open terminal / Open in Factory.
- **Keys** (through the app keyboard ladder at route priority): arrows, Enter, Esc, `I`, `/` (jump palette), `A` (next agent waiting), `R` (follow a current), `H`, `?` (help sheet).
- **Theming.** `soundings/soundings.css` derives every colour from the theme tokens, so the sea re-tints with all 11 themes; status is a hue AND a shape, so it still reads in the monochrome themes. Buoys move by `transform`, never `top`, so a depth change is compositor-only.

**Memory (project file).** Real projects show Project Memory Ledger coverage (`contexts with fresh ≤30d memory / all contexts` + unanchored count, `dev_tools_memory_coverage`). When the Obsidian Brain plugin has a vault configured, two actions appear: **Sync to vault** and **Import from vault** (the only door for importing projected-note edits and hand-authored notes back into the ledger). Design: `docs/plans/skill-memory-unification.md`.

## 6. Ops (live work)

- **Fleet sessions** — click a session to open **`FleetPreviewPanel`**, the live managed terminal (typing goes straight to the PTY). **Open terminal** spawns an interactive session in the project's `root_path`; **Dispatch fleet** (`DispatchFleetModal`) seeds a *background* session with a typed instruction and stays on the chart. Both are disabled for demo projects and projects without a folder.
- **Personas** — `PersonaListPopover`: one row per persona with a running execution, live elapsed time, and a click that navigates through `navigateToProcess` (the Monitor's switch).
- **Runner tasks** — `RunnerListPopover`: task title, running % or status; rows open the **Run Desk** with the project active (`openRunDesk` in `lib/navigate.ts`).
- **Attention** — an awaiting/stale session raises the project's attention (and its urgency); real monitoring errors drive its colour.

## 7. Actionable layer and doors

Mastermind shares the Passport wall's row-action machinery via **`useImproveEngine`** provided through `ImproveProvider`; every reading routes through one `ImproveSurface` router, so a dimension added to the wall's ladder is reachable here too. The Ideas reading opens `IdeaScanPopover` (agent combination, context scope, target count) and dispatches through the canonical recorded pipeline (`dev_tools_run_scan`). Deploys and scans launched here appear in the titlebar activity dock.

Doors (`lib/navigate.ts`): **Open in Factory** rides `pendingFactoryFocus {projectId, l2Tab}` (consumed by `FactoryShell`); the next-release line opens the project's plan in the notepad; runner rows open the Run Desk after `setActiveProject`.

## 8. History (retired views)

- **Hex Mosaic** (retired 2026-09-25). The shipped canvas from 2026-08: islands of hex dimension cells on an infinite pan/zoom sea with far/mid/near/close zoom bands, Figma-like edit/group/connect/note modes, drag-to-place positions, a tidy layout, a project list sidebar with hide/show, a passport sidebar, a milestone status bar and group-wide Fleet dispatch. Soundings replaced it once it had been tuned beside it. What carried over: every data family, every popover and modal, live work (now including runner tasks), Athena's grammar and panels, the demo notice, the data-health bar and the memory block. What did not: spatial authoring (positions, groups, links, notes) and the hidden-project filter — a fixed-geometry chart has no place for them, and ranking by urgency does the decluttering. Their stored data is kept in the layout doc. Everything is in git history before this change.
- **The 3D audition** (retired 2026-09-24). Strata and Holo (react-three-fiber worlds) and the dev-only design Board. "The three.js approach capped us into what we can do with design quality." A static HTML/CSS contest replaced it; its winner is Soundings. What it taught and still holds: position must carry stable meaning, levels beat one layer, and palette changes over an unchanged structure do not read as a new design.
- Earlier prototypes (deleted, in git history): Archipelago, Command Grid, Grid Board, Inverse Grid, fleet "Cells", stats Panels/Strip/Gauges.

## 9. Athena on Mastermind

**Reading it.** The scene is derived in the client, so the page publishes a snapshot to the `mastermind.scene.v1` app setting after each settled derive (debounced, deduped, never the demo scene), and the companion reads it. Until it publishes, her ops say plainly that the canvas is not reachable. Her block is worst-first triage with a footer carrying the true project count and any degraded families; `describe_canvas_project` and `describe_canvas_freshness` return bounded detail on demand.

**Acting on it.** `canvas_dispatch`, `canvas_group_dispatch` and `canvas_run_idea_scan` are thin slug-resolving wrappers onto the same plan rows, validation and executors as the chat plan card; group dispatch stays sequential and capped, demo projects are refused by name, and every dispatch writes one row to the decision ledger.

**Steering it.** `canvas_control` dispatches into `canvasActionStore`; SoundingsView answers: `camera.focus` opens a station, `camera.fit` returns to the chart and marks the named projects, `dim.open` lifts a reading and opens its Improve surface, `category.open` opens the station at that lane, `island.menu` opens the project file, `island.read` / `dim.read` return the model. Each move writes one line to the dock and pings the target with a sonar ring.

**Composing a panel.** `compose_canvas_panel` sends a surface spec for one project. It renders through `SurfaceRenderer` (schema-validated, consent-gated actions) in the right dock. Panels persist per project in the layout document; composing routes to the tab, focuses the project (`focusStore`) and the chart opens its station. Each panel has its own reset, and a spec version this build does not understand is dropped rather than retained.

## 10. Known gaps / deferred

- `auth` stays inert on purpose: making it actionable is a Passport-wall change (no `auth` row in `deployActions`/`connectors`, `stack.auth` is view-only), and `dimActions` keeps a reading clickable exactly when its wall row shows a gear. The registry marks it `viewOnly: true`, and its card says so.
- **KPI popover rows are inert** — the per-KPI jump into the Factory KPI dashboard is the next step.
- The urgency weights are a first cut from the contest; tune them against the real portfolio.
- Demo projects cannot exercise Improve actions, terminals, or real scan freshness.
- Persona attribution requires the project to have a `team_id`.
