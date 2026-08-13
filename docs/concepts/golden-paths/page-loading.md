# Golden path — Page loading

> **Corrections pass — 2026-08-13.** This path was written as a probe BEFORE
> discovery replaced the top-down 56-topic tree with the 247-leaf spine, and
> its topic path was never re-pointed. Old address `frontend/motion/page-loading` names a domain that
> no longer exists. Corrected above. The document's content was not affected.

> Situation node: `ui-system/empty-and-loading/cold-load-choreography` · [situation spine](../situation-spine.md)
> Hand-authored 2026-08-13 from a repo-wide ground-truth sweep (60 tool calls).
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> in `workspace_practice_context_state` when this path is ingested.

## Trigger

- "I'm adding a new tab/page/panel that fetches data on mount — what do I show while it loads?"
- "This list flashes an empty state for a split second before rows appear."
- "I navigated away and came back and the whole section re-ghosted even though I loaded it 10 seconds ago."
- "I need a skeleton for this table" / "where's the spinner component?"
- "This route is `React.lazy` — what goes in `Suspense fallback`?"
- "Rows all appear at once in one big block; the page feels like it snaps."
- "A background poll just wiped my rows and showed a placeholder."

## The one way

Never gate a surface on a loading flag. Render the static chrome — header, filter bar, tab strip, column header, panel shell — unconditionally, outside every loading branch, and let the loading flag decide only what an **empty** body region shows. A fetch that is in flight while rows are already on screen must change nothing. If the region is genuinely empty and a fetch is running, paint a calm, geometry-matched ghost **under the real chrome**, entering via `animate-fade-in` behind a staggered `animationDelay` starting at ≥120ms — the CSS `fill-mode: both` makes that delay an invisibility window, so a fast fetch never paints a single ghost pixel and no JS timer is involved. Only once the fetch has *settled* with nothing may the empty state render. When data arrives it renders on that same frame, with no minimum placeholder duration and no `AnimatePresence mode="wait"` swap; life comes from a one-shot, id-guarded, first-viewport-only row cascade, never a block fade. For a list or table, do not build any of this by hand — pass `isLoading` + `data` to `UnifiedTable` and you get all five laws from two props. For a lazy route/section chunk, use `<Suspense fallback={<RouteChunkSkeleton />}>` — never `fallback={null}` on a full route, and never a centred spinner (spinners render nothing in this app). For a view that fully unmounts on nav-away and holds its data in `useState` rather than a store, stash the last fetch in a module-scoped cache keyed by entity so a return visit paints warm instead of re-ghosting.

## Mandated primitives

- **`display/UnifiedTable`** — the whole doctrine from `isLoading` + `data`: permanent column header, strict three-state body (`TableGhostRows` → settled empty → rows), row cascade **coupled to `isLoading`** via `resolveRowReveal`. Override with `rowReveal={false}` / `rowReveal={{ resetKey }}`.
- **`display/DataGrid`** (`DataGrid.tsx:305`) — paginated sibling; same ghost branch, shares `useRowRevealEntrance`.
- **`layout/RouteChunkSkeleton`** — the Suspense fallback for a lazy route/section. Renders *nothing* for 150ms, then a header-band-only `ContentHeaderSkeleton`. Props: `showIcon`, `showActions`, `showSubtitle`.
- **`display/RevealItem`** — one-shot staggered fade per row, marked on `animationend` (not mount), polymorphic `as={'div'|'tr'|'li'}`. Caps stagger at 8 × 35ms; short-circuits under reduced motion.
- **`useRevealTracker(resetKey)`** (`src/hooks/utility/interaction/useProgressiveReveal.ts:184`) — ref-backed per-id "already entered" set that survives virtualized unmount and clears on `resetKey`.
- **`useProgressiveReveal(total, opts)`** — spreads *mounting* of a large already-fetched list over ~2s.
- **`layout/ListSkeleton` / `TableSkeleton` / `ContentHeaderSkeleton`** — **only** inside delay-hidden Suspense fallbacks, and **only with `calm`** (their default is a banned pulse — see Gaps).
- **`feedback/LoadingSpinner`** — **renders `null`.** Spinners are disabled app-wide; it survives for import compatibility and emits an `sr-only` `role="status"` when given `label`. **A spinner is never a visual loading state in this app.** Any `{loading ? <LoadingSpinner/> : content}` is a *blank gap*, and `feedback/SuspenseFallback` is an empty `py-12` box.
- **CSS `.animate-fade-in`** (`src/styles/globals.css:1859`) — `animation: fade-in 150ms ease-out both`. The `both` fill-mode is the load-bearing part; neutralized under `prefers-reduced-motion` at `globals.css:4539`.

## Steps

1. **Read the doctrine first** — `docs/design/overview-loading.md` (five laws) and the reference impl `overview/sub_activity/components/GlobalExecutionList.tsx`.
2. **Wrap the lazy chunk** — `<Suspense fallback={<RouteChunkSkeleton …/>}>`, flags matched to the real `ContentHeader` so the swap is shift-free.
3. **Render the frame unconditionally** — `ContentBox` / `ContentHeader` / `FilterBar` / column-header row live *outside* every loading branch; build the header row once and render it identically above ghosts and rows (`GlobalExecutionList.tsx:284-340`).
4. **Define the flag with in-flight semantics only** — set in the fetch effect's `try/finally`. It means "a request is running", nothing about visibility.
5. **Derive the ghost condition** — `const showGhost = isFetching && rows.length === 0;`. Never `isFetching` alone.
6. **Branch three ways, in this order** — `showGhost ? <Ghosts/> : rows.length === 0 ? <EmptyState/> : <Rows/>`. The empty state is unreachable until the fetch settles.
7. **For a list/table, delete steps 4–6** and pass `isLoading` + `data` (+ `emptyTitle`/`emptyDescription`) to `UnifiedTable`.
8. **Otherwise write a module-local ghost** — same row height / grid template / group-header band as the real content, bars at `bg-primary/[0.06]`, deterministic width variety (`['w-40','w-28','w-36','w-32'][i % 4]`), `aria-hidden="true"`, `animate-fade-in` + `style={{ height: ROW_H, animationDelay: \`${120 + i * 35}ms\` }}`. Never `animate-pulse`.
9. **Add the row cascade** — `useRevealTracker(resetKey)` where `resetKey` encodes filter/persona/sort context; wrap rows in `RevealItem` with `index >= CASCADE_ROWS` short-circuit (`CASCADE_ROWS ≈ 14`).
10. **Warm the remount if data is not store-backed** — module-scoped cache keyed by project/entity, seed `useState` from it, start `isFetching` **false** on a warm hit.
11. **Charts:** reserve the final box height, ghost a calm rectangle in it. **Numbers:** never ghost a number you can count up — `AnimatedCounter` *is* the reveal.
12. **Verify against the Definition of Done** (`overview-loading.md:129-139`).

## Anti-patterns

- **`if (loading) return <spinner/>` / `if (loading) return <Skeleton/>`** — the most common violation here; hides header, toolbar, breadcrumb and pre-warmed store data on *every* visit.
- **Using a spinner as the loading state at all** — `LoadingSpinner` renders `null`, so it is not "a spinner", it is a blank rectangle.
- **`animate-pulse` on a placeholder** — banned outright; it blinks through the ghost→content swap and cannot be delay-hidden.
- **A shimmer sweep / looping framer-motion on a skeleton** — same failure, more expensive.
- **Ghosting without `&& rows.length === 0`** — a poll then wipes rows the user is reading.
- **Rendering the empty state while loading** — the empty-flash on every cold visit.
- **A placeholder with no `animationDelay`** — the anti-flash IS the ≥120ms delay + `fill-mode: both`.
- **`AnimatePresence mode="wait"` or any minimum-display gate** between placeholder and content — a forced delay; the swap is a plain conditional.
- **A big-bang block fade** when data lands — life comes from the per-row cascade.
- **A cascade that replays** — un-id-guarded reveal re-animates on every poll, refetch and virtualized scroll.
- **`fallback={null}` on a full route/section** — fine for overlays and invisible widgets, a blank content area on a route.
- **A body silhouette in a Suspense fallback** — lies about the incoming geometry and produces the skeleton→content blink. Header band only.
- **Hand-rolling loading rows on a `UnifiedTable` surface** — re-implements `TableGhostRows` and usually loses the cascade coupling.
- **Re-ghosting on remount** for a `useState`-backed view.

## Evidence

- `overview/sub_activity/components/GlobalExecutionList.tsx:280` — canonical flag derivation, rationale at `:107-110`.
- `…/GlobalExecutionList.tsx:405-427` — the three-state body under a real column header.
- `…/GlobalExecutionList.tsx:563-608` — `ActivityGhostRows`: matched row height, `animationDelay: ${140 + i*35}ms`, deterministic widths, `aria-hidden`.
- `…/GlobalExecutionList.tsx:512-522` — `RevealItem` cascade with the `index >= CASCADE_ROWS` short-circuit.
- `shared/components/display/UnifiedTable.tsx:593-612` — primitive three-state body; permanent header at `:570-591`.
- `…/UnifiedTable.tsx:248-258` — `resolveRowReveal`, the `isLoading` coupling that makes ghost→ripple automatic.
- `…/UnifiedTable.tsx:270-297` — `TableGhostRows`, the reference calm-delayed ghost.
- `shared/components/layout/RouteChunkSkeleton.tsx:36-44` — 150ms-invisible, header-only fallback; rationale at `:10-17`.
- `overview/components/dashboard/OverviewPage.tsx:48-60` — the pattern it was extracted from ("never fake the incoming layout").
- `plugins/dev-tools/sub_lifecycle/LifecyclePage.tsx:28-36,63-72,154` — module cache + `everLoaded` gate.
- `…/sub_lifecycle/competitions/CompetitionList.tsx:14-40,116` — the *keyed* variant; project A's list never flashes under project B.
- `scraper/useScraperData.ts:24-31,53-59` — cache lifted into a hook.
- `templates/sub_generated/gallery/cards/TemplateVirtualList.tsx:130-140` — header always rendered.
- `vault/sub_credentials/manager/CredentialManager.tsx:43-49` — post-mortem comment naming the removed anti-pattern.
- `plugins/companion/BrainViewer.tsx:400-425` — clean local ghost; cascade at `:356-361`.
- `settings/sub_network/components/PeerList.tsx:241-258` — conforming `120 + i*35` delayed fade.
- `src/styles/globals.css:1859-1861` — why the delay is an invisibility window.

## Deviations found

**A. Whole-surface loading gates — replace chrome and pre-warmed data (highest value)**

| Path | What's wrong |
|---|---|
| `agents/sub_executions/components/list/ExecutionList.tsx:360-375` | `if (loading) return <TableSkeleton…>` — triple violation: hides all chrome, no `calm` (the only such caller, so it pulses), replaces rather than ghosts under. |
| `overview/sub_activity/components/ExecutionMetricsDashboard.tsx:28-34` | Cold branch early-returns a centred `LoadingSpinner size="xl"` → blank `flex-1` box. (Stale-while-revalidate is otherwise correct.) |
| `teams/sub_factory/l2/ship/ShipPlannerTab.tsx:245` | Empty 40px box in place of the whole planner. |
| `plugins/obsidian-brain/sub_cloud/CloudSyncPanel.tsx:167-171` | `py-20` blank box; also hardcoded English label (i18n bug). |
| `agents/sub_executions/detail/chain/ChainTraceView.tsx:33-38` | Replaces the whole chain trace with a blank spinner box. |
| `vault/sub_credentials/components/features/CredentialIntelligence.tsx:64-68` | Blank `py-8` box for the whole panel. |
| `vault/sub_catalog/components/forms/CodebaseProjectPicker.tsx:105-109` | Centred `Loader2 animate-spin` — a real spinning icon bypassing the disabled primitive. |
| `templates/sub_n8n/steps/N8nSessionList.tsx:241-245` | Centred `RefreshCw animate-spin` as the list placeholder. |
| `overview/sub_observability/components/HealingTimeline.tsx:267-273` | Centred spinner + label wipes the timeline. |
| `agents/sub_lab/components/arena/ArenaResultsView.tsx:133` | Ships the pulsing `LabResultsSkeleton`. |
| `recipes/sub_list/components/RecipeList.tsx:59-65` | Bespoke `RecipePageFlipLoader` centred in place of the list. |
| `agents/sub_executions/replay/ReplaySandbox.tsx:123` | Fixed `h-64` centred `Loader2`; drops transport controls. |
| `vault/shared/playground/tabs/ApiExplorerTab.tsx:26` | Hides the tab's own header bar. |
| `plugins/fleet/sub_grid/FleetSessionInsights.tsx:80` | Full-height centred spinner instead of ghosted tiles. |
| `agents/sub_deployment/components/cloud/CloudStatusPanel.tsx:29` | `py-12` centred spinner for the whole panel. |
| `plugins/dev-tools/sub_overview/OverviewParts.tsx:89` | Stats card becomes a box containing only a spinning `RefreshCw`. |
| `agents/sub_lab/use-cases/UseCaseHistory.tsx:63` · `onboarding/components/TemplatePickerStep.tsx:50` · `onboarding/components/DesktopDiscoveryStep.tsx:64` · `plugins/dev-tools/sub_projects/GitHubRepoSelector.tsx:127` · `vault/sub_databases/tabs/ColumnList.tsx:25` · `plugins/gitlab/components/JobRow.tsx:25` · `plugins/companion/BrainViewer.tsx:632` · `studio/StudioVisionStart.tsx:76` · `agents/quick-answer/QuickAnswerBody.tsx:58` | Same shape, smaller surfaces. |

**B. Ternary loading branches that swap out a region**

`plugins/dev-tools/sub_runner/RunDeskPage.tsx:215` · `settings/sub_portability/components/ExportSelectionModal.tsx:240` · `plugins/dev-tools/sub_projects/CrossProjectMetadataModal.tsx:344` · `overview/sub_observability/components/AnomalyDrilldownPanel.tsx:174` · `vault/sub_credentials/components/gateway/GatewayMembersModal.tsx:210` · `plugins/dev-tools/components/DevToolsProjectDropdown.tsx:129` · `plugins/dev-tools/sub_skills/contextPicker/ContextPickerModal.tsx:82` · `agents/sub_glyph/personaCore/PersonaCoreModal.tsx:34` (also hardcoded English at `:37`) · `triggers/sub_triggers/TriggerExecutionHistory.tsx:167` · `triggers/sub_triggers/WebhookRequestInspector.tsx:250` · `plugins/research-lab/sub_experiments/ExperimentRunsDrawer.tsx:61` · `teams/sub_factory/passport/improve/StandardsScan.tsx:126` (literal `Loading…`)

**C. Banned motion on placeholders (`animate-pulse` / shimmer)**

| Path | What's wrong |
|---|---|
| `agents/sub_lab/components/shared/LabResultsSkeleton.tsx:27` | The entire shared Lab skeleton is built on a pulse token (also `:41,63,70,85,122`); no delayed entrance. |
| `vault/sub_credentials/components/features/CredentialRotationSection.tsx:24-26` | Three pulsing bars, no delay. |
| `overview/sub_analytics/components/ExecutionHeatmap.tsx:311-317` | Pulsing block; charts want a calm reserved box. |
| `agents/sub_glyph/GlyphCinemaLayout.tsx:414-425` | Infinite framer-motion shimmer sweep. |
| `agents/sub_model_config/components/EffectiveConfigPanel.tsx:54-59` | `if (loading)` returns an `animate-pulse` card. |
| `teams/sub_teamWorkspace/teamStudio/slackBridge/TeamSlackBridgePanel.tsx:89` | Gating **correct**, motion wrong (`animate-pulse`, no delay). |
| `agents/sub_editor/components/QuickStatsBar.tsx:26` · `agents/sub_editor/components/PersonaChangeHistory.tsx:73` · `agents/components/allPersonas/PersonaConfigPanel.tsx:508` · `overview/sub_usage/components/LazyChart.tsx:47` · `agents/sub_executions/components/CircuitBreakerIndicator.tsx:154` · `overview/sub_director/components/CampaignReportPanel.tsx:107` · `teams/sub_factory/passport/improve/QuickDispatchLedger.tsx:23` · `home/sub_cockpit/widgets/WalkthroughOfferWidget.tsx:100-102` · `studio/StudioMessages.tsx:103-104` · `shared/chrome/DesktopFooter.tsx:92` · `plugins/companion/sub_voice/voiceEngineShared.tsx:266` · `plugins/radio/components/RadioFooter.tsx:659` · `plugins/radio/components/NowPlayingCard.tsx:189` | Pulse used as a loading affordance. |
| `shared/components/progress/ContentLoader.tsx:56,61` | `animate-pulse-slow` centred illustration, self-described as "universal loading state for pages and panels" — the banned big-bang gate, in a *shared* component. One caller: `agents/sub_executions/components/list/ComparisonDiff.tsx:104`. |

**D. Suspense fallbacks that aren't `RouteChunkSkeleton`**

| Path | What's wrong |
|---|---|
| `home/sub_welcome/WelcomeLayout.tsx:65` · `agents/sub_editor/components/EditorBody.tsx:182` · `agents/sub_design/DesignHub.tsx:102` · `plugins/fleet/FleetPage.tsx:88` · `settings/components/SettingsPage.tsx:84` | `fallback={<SuspenseFallback/>}` → empty centred `py-12` box (spinner is null). |
| `schedules/components/ScheduleTimeline.tsx:356` | Centred "loading calendar" text + null spinner at route level. |
| `overview/sub_health/components/PersonaHealthDashboard.tsx:149` | Centred `py-16` text block. |
| `personas/sub_foundry/CreatePersonaEntry.tsx:28` | Full-height empty div. |
| `onboarding/components/TourPanelBody.tsx:203` | Centred `tour_loading` text. |
| `triggers/TriggersPage.tsx:44` | Inline delayed blank box — follows law 3 but duplicates `RouteChunkSkeleton` and ghosts nothing. |

**E. Hand-rolled loading rows on a `UnifiedTable` surface**

| Path | What's wrong |
|---|---|
| `overview/sub_events/components/EventLogList.tsx:465,525` | `isLoading={false}` explicitly suppresses the primitive's ghost so a local `EventGhostRows` can render. |
| `overview/sub_activity/components/LlmCallsTable.tsx:338,381` | Local `CallsGhostRows` mimics the header band instead of ghosting under the real one. The comment at `:35-41` claiming the cascade is unfixable is **stale** — `rowReveal` is passed at `:344`. |
| `plugins/dev-tools/sub_projects/ProjectManagerPage.tsx:491,577` | Local `ProjectGhostRows` in front of a `UnifiedTable` at `:509`. |
| `agents/components/allPersonas/PersonaConfigPanel.tsx:508` | Per-cell pulse skeleton in a hand-rolled `<table>` inside a `UnifiedTable` surface. |

**F. Documentation drift that actively causes deviations**

- `shared/components/CATALOG.md:97` — `LoadingSpinner` described as "Canonical loading spinner… Use for any full-element loading state." **The component renders `null`.** This line is the likeliest single cause of categories A and D.
- `shared/components/CATALOG.md:190` — `ContentLoader` has no `@catalog` tag, so its banned status is invisible to the catalog.

## Gaps in the primitive

1. **The three shared skeletons default to the banned behaviour.** `ListSkeleton.tsx:34`, `TableSkeleton.tsx:53`, `ContentHeaderSkeleton.tsx:38-39` compute `calm ? 'bg-primary/[0.06]' : 'bg-primary/10 animate-pulse'` with `calm = false`. Every call site passes `calm` except `ExecutionList.tsx:366`. The default should be inverted, or the pulse variant deleted.
2. **No shared calm-delayed-ghost primitive.** ~70 module-local `*GhostRows` components re-implement the identical recipe, most carrying a copy-pasted doctrine comment. A parametrized `<GhostRows rows gridTemplate rowHeight barWidths/>` would make the category-C deviations impossible.
3. **No shared module-scoped-cache primitive.** `LifecyclePage.tsx:34`, `CompetitionList.tsx:22`, `useScraperData.ts:30` hand-roll `let cachedX` with duplicated comments; six more hooks do variants. Mechanic 4 has no primitive, so it is adopted almost exclusively inside `plugins/dev-tools/`.
4. **`UnifiedTable` renders header + body as one opaque unit.** A caller cannot render the real interactive column header above a *custom* ghost — which is why `LlmCallsTable` and `EventLogList` mimic header geometry, making their swap move. A `renderGhost` slot or `headerOnly` split would close it.
5. **The cascade cap is duplicated, not shared.** `REVEAL_CASCADE_ROWS = 14` in `UnifiedTable.tsx:202`, `CASCADE_ROWS = 14` in `GlobalExecutionList.tsx:59`, `LIST_CASCADE_ROWS` in `BrainViewer.tsx`; `RevealItem` doesn't implement the cap, so every non-table caller rewrites the guard.
6. **`RouteChunkSkeleton` has no body slot.** Correct for routes, but a *section* whose header is already painted has no shared fallback — hence the ad-hoc blank at `TriggersPage.tsx:44` and the five `SuspenseFallback` boxes.
7. **`LoadingSpinner` is a silent trap.** It type-checks, has `size`/`className` props that do nothing, and renders `null` — no error, no lint warning, blank page.
8. **Zero automated enforcement.** No ESLint rule, no check script, no test asserts any of the five laws; `UnifiedTable` has no test file. Contrast `custom/enforce-base-modal`, which does gate the modal primitive. `.claude/conventions.json:112` lists `"spinner"` under `doNotHandRoll` but nothing reads it at build time. **Every deviation above was introduced under a green `npm run check`.**

**Not a gap — confirmed clean:** the v1 pattern is fully retired; `LoadingReveal` and `useStableLoading` have zero occurrences in `src/`.

> **Corrections pass — 2026-08-13 · catalog mechanism.** An earlier version of
> this document said the `LoadingSpinner` row in `CATALOG.md` comes from the
> component's missing `@catalog` tag. **That is wrong.**
> `scripts/docs/gen-shared-catalog.mjs:92-96` — `describe()` returns
> `CURATED[name]` and only falls through to a `@catalog` tag when the name is
> absent from that map. `LoadingSpinner` IS in `CURATED`, so adding a tag to the
> component would appear to work and change nothing. The row was fixed at its
> real source (the `CURATED` map) and the catalog regenerated.
