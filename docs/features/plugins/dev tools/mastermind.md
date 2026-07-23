# Mastermind — Multi-Project Development Canvas

**Location:** Projects (sidebar) → Development → Mastermind
**Source:** `src/features/teams/sub_mastermind/`
**Status:** experimental prototype (built via iterative `/prototype` rounds, 2026-07). Two canvas variants still develop in parallel behind a switcher; consolidation to a single variant is pending.

Mastermind renders every dev-tools project as an **island** on an infinite pan/zoom canvas — Civilization-style islands with Figma-style manipulation. The goal: understand the whole portfolio's scope and state at first sight (healthy / building / warning / critical / erroring), and react directly on the canvas (run scans, dispatch upgrades, open terminals) without leaving it.

---

## 1. Concept and visual identity

- Each project is an island: a **core** cell surrounded by **dimension** cells (DB, Monitoring, CI, … — see §5), plus an ops row below (fleet terminals + running personas) and stat columns at the sides.
- **Lines between islands** show integration: derived relations/similarity from the cross-project scan (dotted arcs) and user-drawn links (straight, styled, labelled).
- The canvas forges its **own typographic identity** deliberately distinct from the app UI: cartographic serif (`SERIF` in `lib/ink.ts`) for identity/details, mono (`MONO`) for instrumentation. All colour flows through **semantic theme tokens** (`var(--status-*)`, `var(--primary)`, `color-mix(...)`) so every switchable theme — including pre-darkened light skins — renders correctly. Never paint raw hex here (one documented exception: fleet violet/indigo states that have no semantic token).
- **Animation austerity:** entry/exit fades and click-gated transitions only; the single sanctioned always-on motion is the pulsing `awaiting_input` fleet badge (a terminal literally waiting on the user).

## 2. Entry point and wiring

| Piece | Where |
| --- | --- |
| Sidebar entry | `TeamsSidebarNav.tsx` `DEV_ITEMS` → id `mastermind` (Network icon), i18n key `sidebar.mastermind` (codename, allowlisted untranslated in `docs/i18n/untranslated-allowlist.json`) |
| Tab union | `src/lib/types/types.ts` → `TeamsTab` includes `"mastermind"` |
| Route | `PersonasPage.tsx` → `teamsTab === 'mastermind'` → lazy `MastermindPage` |
| Page shell | `MastermindPage.tsx` — wraps content in `FactoryDataProvider` (KPI rollups) and `ImproveProvider` (row-action engine) |

## 3. Architecture

```
MastermindPage (data joins, popover/sidebar state, mode + variant state)
└── variant wrapper (MastermindHexMosaic | MastermindInverseGrid) — thin
    └── CanvasShell (shared: sea, camera, groups/links/notes tools,
        │            hover focus, connect gesture, zoom chrome)
        └── renderIsland(island, ctx) → MosaicIsland | InverseIsland
            ├── IslandBanner (counter-scaled header = drag handle)
            ├── dimension cells (MosaicCell hexes | DimTile rects)
            ├── StatColumns (side stats, band-gated — REAL sensors via lib/islandStats: KPI attainment, live Sentry errors, 30d LLM spend via lib/llmSpend, tests/auto/prod from the passport; demo islands keep statsMock)
            └── FleetBadges (terminals + personas ops row)
```

Key libs (all under `lib/`):

| Module | Responsibility |
| --- | --- |
| `types.ts` | Scene model (`Island`, `DimNode`, `IslandEdge`, `FleetNode`, `GroupRect`, `UserLink`, `CanvasNote`), zoom bands, `CanvasMode`, `VariantProps` contract |
| `sceneStore.ts` | **The data spine** (zustand): batch-fetches relations + idea scans + monitoring with per-family fetch STATUS; surgical event-driven invalidation instead of polling; ≤1 IPC per family at open |
| `deriveScene.ts` | Passports (+ KPI/scan/live extras) → `Scene`; demo scene fallback when nothing is scanned |
| `dimRegistry.ts` | **Single source of truth for dimensions** — label, `derive()`, icon, wall `rowKey`, action kind, far-payload kind. Adding a dimension = one entry here |
| `dimActions.ts` | Canvas dim → Passport-wall Improve applicability (mirrors `ImproveCell` checks) |
| `liveState.ts` | Live island colour: real Sentry error counts via bound monitoring credentials + fleet attention (awaiting/stale); pure combination logic, unit-tested; honest fallback to readiness-only colour |
| `layoutStore.ts` | **Durable layout doc** — positions, groups, links, notes, hidden set as ONE versioned JSON document in app settings (`mastermind.layout.v1`); sync in-memory reads, debounced (~500 ms) write-through; one-time localStorage migration; browser-only fallback |
| `positions.ts` / `groups.ts` / `links.ts` / `notes.ts` | Stable import surfaces re-exporting layoutStore (plus `LINK_PALETTE`, `NOTE_SIZE_PX`, `NOTE_FONT`) |
| `useCanvasCamera.ts` | Camera: wheel zoom-to-cursor (native non-passive listener), pointer-capture pan (**render-free** — world transform driven imperatively; one culling commit per ~350 world units of travel), dblclick zoom, `fit(bounds, animate?)` with **linear rAF tween** (~380 ms) cancelled by any input |
| `tidyLayout.ts` | One-shot relation-aware layout (bounded spring-electrical pass + overlap resolution). Deterministic (no Date/random); user-pinned islands are immovable anchors; group members pulled to their centroid |
| `hex.ts` | Hex geometry, axial→pixel, deterministic `spiralPlace` + `hash01` |
| `ink.ts` | `STATE_INK`, `DIM_INK`, `FLEET_INK`, `scoreInkVar`, `mix()`, font stacks |
| `useIslandDrag.ts` | Header-handle drag with click-vs-drag threshold (≤4 px release = select). **Render-free**: the island <g> transform is written imperatively mid-drag; state commits once on release (GroupLayer moves member islands the same way) |
| `useEventCallback.ts` | Stable-identity callbacks so memoized islands skip re-renders |

**Render scale (optimizer pass, hundreds of islands):** island props carry a **quantized z** (~6% steps — islands re-render ~12× per zoom doubling, not per frame); `positioned` islands in MastermindPage are **content-stable** (per-slug cache; a fleet tick re-renders only the affected island); neighbor-dimming on hover writes opacity **imperatively** to the island `<g>`s (`data-mm-island`); halos are shared per-state **radialGradients** / layered plates, not per-island Gaussian filters; passports publish **two-phase** (evidence-less first paint, probe evidence merged in a second commit).
| `CanvasShell.tsx` | Everything shared per §1/§7/§8; owns groups/links/notes state + editors |
| `DataHealthBar.tsx` | Page chrome naming FAILED data families (relations/scans/monitoring/KPI/fleet) + retry; renders nothing when clean |

Tests live in `__tests__/` (deriveScene status/edges/ideas/live/unknown, dimActions, layoutStore + persistence, liveState, sceneStore, tidyLayout, camera).

## 4. Data sources (all read paths)

| Family | Source | Notes |
| --- | --- | --- |
| Islands (passports) | `usePassportData()` (Factory) — cross-project scan + project config → `AppPassport[]`; slug **is** the dev-project id | |
| Edges | `sceneStore` → `dev_tools_get_cross_project_metadata` → `cross_project.relations` (kind `relation`) + `similarity_matrix ≥ 0.5` (kind `similarity`) | deduped per pair; endpoints must both exist |
| KPI dimension | `FactoryDataProvider` + `collectKpiAttention` / `groupKpis` — the SAME rollup the Passport wall's warning badges use | |
| Idea scans | `sceneStore` → `dev_tools_list_scans` (`DevScan` rows: scan_type, status, created_at) | freshness = newest row's `created_at` |
| Fleet sessions | `systemStore.fleetSessions` (+ event-driven refresh); session→project by **longest `cwd` ↔ `root_path` prefix match** (a session has no project id) | |
| Running personas | `overviewStore.activeProcesses` (status `running`, `personaId`) → persona → `home_team_id` → `dev_projects.team_id` — the Monitor's join | teamless projects can't attribute persona work |
| Live monitoring | `liveState.loadMonitoringSummaries` — per-project bound monitoring credential → the Observability tab's Sentry adapter | absent credential ⇒ readiness-only colour |
| Goals | `sceneStore` → `dev_tools_list_all_goals` (one batched IPC, grouped by project) | ongoing = `isOngoing` from sub_goals/goalStatus |
| LLM spend | `sceneStore` → `lib/llmSpend` — `fetchLlmPinpoints(serviceType, credId, '30d')` per project with a bound live tracing credential (LlmTrackingCell's sum), 5-min throttle | absent key ⇒ not wired ("—") |
| Layout artifacts | `layoutStore` (app-settings document) | |

**Demo scene:** with zero scanned projects, `deriveScene` emits a built-in 6-island demo (varied states, fleet sessions, personas, all Ideas freshness bands). A centered **DemoNotice card** (`lib/DemoNotice.tsx`) makes the sample unmistakable and offers the two exits — scan the workspace (`rescan()`) or add a project; dismissing it leaves a corner "sample data" badge for the session. Demo islands are inert for Improve/terminal actions. The canvas is also held back behind a spinner during the FIRST passport load (not just layout hydration), so an in-flight fetch never renders as an empty world.

**Data honesty:** each fetch family carries a status; failures surface in `DataHealthBar` by name with a retry — the canvas never silently renders a partial truth. The passport family itself is included (a failed passport load joins the bar rather than rendering a raw error string), and the bar anchors ABOVE the mode toolbar so degraded data never hides mode switching. Idea-scan dispatches are busy **per project** with a 3-minute safety timeout; the in-flight Ideas cell pulses.

## 5. Dimensions (the island body)

13 dimensions per island, declared in `dimRegistry.ts`. Status vocabulary (`DimStatus` → `DIM_INK`): `absent` (grey, dashed — "null is a first-class answer"), `solid` (success), `partial` (info), `risk` (warning), `alert` (error).

| Key | Label | Derived from | Improve rowKey → popover |
| --- | --- | --- | --- |
| `db` | Database | `stack.persistence` (+ migrations ⇒ solid) | `migrations` → Deploy |
| `monitoring` | Monitoring | monitoring tools + observability level | `observability` → Deploy/connector |
| `ci` | CI | `productionReadiness.ci` | `ci` → **Standards** (Tier-0 config) |
| `tests` | Tests | tests level (+ coverage detail) | `tests` → Deploy |
| `security` | Security | security level/tools | `security` → Deploy |
| `hosting` | Hosting | `stack.hosting` | `hosting` → Deploy |
| `auth` | Auth | `stack.auth` | — (inert) |
| `agents` | Agents | automation level L1–L5 | `aiflow` → Deploy |
| `skills` | Skills | `artifacts.skills` | `skills` → Deploy |
| `llm` | LLM cost | `stack.llmTracking` | `llmtracking` → Deploy/connector |
| `kpi` | KPIs | Factory KPI rollup; off-track ⇒ `alert` | — (inert) |
| `ideas` | Ideas | days since last `DevScan` | always actionable → **IdeaScanPopover** |
| `goals` | Goals | ongoing (not-done) dev-goal count — `dev_tools_list_all_goals` batched via sceneStore | count > 0 → **GoalListPopover** (titles asc, inert rows) |

**Goals rule:** count = goals where `isOngoing(status)` (any non-`done`: open / in-progress / awaiting_acceptance / blocked). Count renders as the far/mid payload (`payloadKind: 'count'`); 0 = grey icon-only inert cell; family failure = `unknown`.

**Ideas freshness rule:** `<7d` green (`solid`), `7–30d` amber (`risk`), `>30d` red (`alert`), never-scanned grey (`absent`). At far/mid zoom the cell renders the **day count** (`12d`) as its payload (`payloadKind` in the registry) instead of an icon.

**Brand icons:** `DimGlyph` prefers the identified tool's official mark via the Passport wall's `resolveTechIcon` (simple-icons set — Supabase, Sentry, GitHub, Postgres, …) at every LOD; generic lucide outline otherwise; absent cells always generic + muted.

**Actionability affordance:** a cell whose registry/engine checks yield an action gets `cursor: pointer` + a quiet primary ring on hover; inert cells ignore clicks and show no affordance.

**Adding a dimension:** one entry in `dimRegistry.ts` (see its `addingADimension` note) — deriveScene, glyphs, menus, actions and both cell renderers pick it up. Lattice capacity: Hex ring-2 and Inverse layer-2 currently hold 12; beyond ~14–15, plan the **dimension-categories** evolution (far/mid shows 4–5 aggregated category cells that explode at near/close) before injecting more.

## 6. Zoom bands and level-of-detail

`ZOOM_THRESHOLDS` in `types.ts` — the single source of truth: `far < 0.34 ≤ mid < 0.72 ≤ near < 1.05 ≤ close`.

| Band | Cells render | Identity |
| --- | --- | --- |
| far | fullscale state-coloured icon (or day-count payload) per cell | counter-scaled **banner** (name + state dot + blockers + A·P scores) at 20 px screen |
| mid | same fullscale icons | banner 18 px |
| near | icon + uppercase label | banner 17 px; stat columns visible |
| close | + tool detail + ordinal progress bar | banner 16 px |

The banner is rendered in world space but **counter-scaled by 1/z** (the Civilization city-label trick), so identity holds at any distance. Native `<title>` tooltips on every cell name the dimension + tool regardless of LOD. Stat columns hide at far. The dev-only `ZoomBadge` (top-right, `import.meta.env.DEV`) shows exact z / % / band for tuning.

## 7. Canvas variants

- **Hex Puzzle** (`MosaicIsland`) — core + dimensions snapped edge-to-edge on the axial hex lattice (ring-1 six + contiguous ring-2 caps); state halo behind the honeycomb; reads as an interlocking mosaic when far.
- **Inverse Grid** (`InverseIsland`) — the grid turned inside out: core in the **centre** cell, dimensions in a 3×3 layer around it, layer-2 opening along the top row for 9+.

Retired along the way (deleted, in git history): Archipelago (R1 winner, later baseline), Command Grid, Grid Board, fleet "Cells", stats Panels/Strip/Gauges.

## 8. Interaction model (Figma-like, edit-first)

**Modes** (bottom toolbar, `CanvasToolbar`, keyboard `E`/`G`/`C`/`N`, `Esc` = universal cancel; a one-line hint names what the mouse does):

| Mode | Behaviour |
| --- | --- |
| **Edit** (default) | sea drag = pan; **header (banner) drag** moves an island (body is inert for moving); header click (≤4 px) opens the right sidebar; groups move (carrying contained islands), resize (corner handle), rename; notes drag/edit; link labels editable |
| **Group** | drag draws a labelled rectangle (dashed, primary-tinted); label inline-renamable; × deletes |
| **Connect** | drag from island A → rubber-band line, nearest island in radius highlights, release links; click-click fallback; editor popover: label, full/dashed, 6-colour palette |
| **Note** | click places a world-space text note — sizes S/M/L/XL (16/26/42/64), fonts Inter/Roboto/**Caveat** (import-free stacks; Caveat falls back to Segoe Script/Ink Free) |

**Camera:** wheel zoom-to-cursor; dblclick zoom (island dblclick = **linear tween focus** onto it); zoom cluster bottom-right: −/+/Fit-all/**Tidy**/Undo. Tidy runs the deterministic relation-aware layout once (pinned islands anchored, groups kept contiguous) with single-level undo.

**Hover focus:** hovering an island dims everything except it and its integration neighbours.

**Context menu:** right-click a header → the island's dimensions sorted by name with the same glyphs; hovering a row echoes a double ring on the matching cell; row click is currently a no-op (reserved for the per-dimension action layer).

**Motion:** sidebars fade+slide, islands fade in/out on hide/show/create (AnimatePresence), all linear.

## 9. Ops layer (terminals + personas)

Below each island, an ops-badge row (`FleetBadges`, counter-scaled):

- **Terminal state badges** — one badge per fleet-session state present (attention-first order; `awaiting_input` dot pulses). Click → `FleetListPopover` listing that state's sessions, each with a deterministic **animal glyph** (hash of session id — Cat/Dog/Bird/Fish/Rabbit/Squirrel/Turtle/Snail) so parallel terminals stay tellable. Picking one opens…
- **`FleetPreviewPanel`** — the live managed terminal (`FleetTerminalPane`, fully interactive: typing goes straight to the PTY). Headless/exited sessions get a status body (no TTY). There is also an **Open terminal** action (spawns a fleet session in the project's `root_path` via `spawnSession`; disabled for demo islands / missing path).
- **Personas badge** — Bot icon + count of personas with a running execution (processing-blue). Click → `PersonaListPopover` with the names; rows deliberately inert for now.
- **Live attention:** any awaiting/stale session raises the island's "needs you" marker; real monitoring errors can drive island colour (§4).

## 10. Actionable layer (Improve + scans)

Mastermind shares the Passport wall's row-action machinery via the extracted **`useImproveEngine`** (`sub_factory/passport/improve/useImproveEngine.ts`) provided through `ImproveProvider`:

- **Canvas cells** — clicking an actionable dimension opens the SAME `ImprovePopover` (Tier-0 standards) or `DeployPopover` (Claude deploy / connector bind) the wall uses, anchored at the click point via a synthetic `DOMRect`; both popovers flip vertically and clamp horizontally themselves.
- **Right sidebar rows** — every `IMPROVABLE_ROWS` row wraps in `ImproveCell` (gear/sparkle affordances, busy spin, identical popovers).
- **Ideas cell** — opens `IdeaScanPopover`: the Idea Scanner's `SCAN_AGENTS` in their category groups + last-run line; picking an agent dispatches a single-agent scan for that project through the **canonical recorded pipeline** (`dev_tools_run_scan` — writes the `DevScan` row, registers in the activity dock, streams `IDEA_SCAN_STATUS`; completion anywhere refreshes freshness). *Deliberate deviation:* dispatching via a raw fleet session was rejected because it would bypass `DevScan` recording — swap the execution lane only once fleet dispatch records scans.

Deploys/scans launched here appear in the titlebar activity dock and busy-spin the corresponding wall cell — one machinery, two views.

## 11. Sidebars

- **Left — project list** (`ProjectListSidebar`): hidden by default behind a panel icon; name-asc rows with state dot + eye toggle hiding/showing the island on the canvas (persisted in the layout doc; the list always shows all). Header **+** = the Projects manager's `ProjectModal` (same create/update store actions, path-dedup, background context scan), then passport reload.
- **Right — project passport** (`ProjectSidebar`): opens on header click; renders the wall's exported `CoverBody` (R18 Statband, `stats={null}`) + every dimension section with `InkWallCell`, dividers brightened for the panel backdrop (`border-foreground/12`).

Both sidebars, the context menu, and the list popovers share the app sidebar-menu language: `bg-secondary/95 backdrop-blur` + `border-primary/15` + `shadow-elevation-4` surfaces, `bg-primary/5` header bands with `typo-label text-foreground/90`, `typo-body text-foreground/70 hover:bg-secondary/40` rows.

## 12. Known gaps / deferred

- **Variant consolidation** — Hex Puzzle vs Inverse Grid still A/B; the winner absorbs the loser and the switcher goes away.
- **Context-menu row click** and **persona list row click** are reserved no-ops (per-item action layers to come).
- `auth` and `kpi` dimensions have no Improve counterpart yet (inert).
- **Fleet-lane scan dispatch** (see §10 deviation).
- **Dimension categories** for ≥15 dimensions (see §5). Candidate future dimensions were brainstormed (Memory, Billing gate, Integrations constellation, Brand-in-core, Secrets hygiene, Dependency health, Backups/DR, i18n, Uptime, Agent Context, Evals) — design notes live in session history, not yet implemented.
- Demo islands cannot exercise Improve actions, terminals, or real scan freshness.
- Persona attribution requires the project to have a `team_id`.
