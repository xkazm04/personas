# Golden path — Empty and demo states

> Situation node: `ui-system/empty-and-loading/empty-and-demo-states` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 from a repo-wide ground-truth sweep of **3,137 files under `src/features`**,
> **350 surfaces** carrying a settled-empty decision, **23** shared-table call sites, and a
> **convergence check against `personas-web`** (different stack, no shared document).
> Repo-level denominators come from [`shared-facts.json`](../shared-facts.json) —
> **2,104 `.tsx`**, of which 1,989 are non-test — rather than being re-derived here.
>
> **Scope split.** [`page-loading.md`](./page-loading.md) owns everything *before* the fetch
> settles — the ghost, the delay window, the cascade, the Suspense fallback. This path owns
> the frame *after*: what a surface shows once it has settled with nothing, and how content
> that is not real gets marked as not real. The two meet at exactly one predicate, stated in
> step 3. Do not duplicate the loading half here; link to it.

## Trigger

- "The list is empty — what do I put there?"
- "I filtered to zero rows and it says 'No data'." / "It says 'no matches for your filters' but I haven't set any filters."
- "The fetch failed and the user sees a cheerful 'create your first agent' screen."
- "I'm about to write `items.length === 0 ? <SomethingEmpty/> : <Rows/>`."
- "I'm about to create `FooEmptyState.tsx`."
- "This panel has no data yet, so I'm showing sample/placeholder numbers until the real ones arrive."
- "Where's `feedback/EmptyState`?" *(there is no such file — see Deviations G.)*

## The one way

**An empty region is never one condition — it is at minimum four, and the surface must know which one it is in before it renders a single word.** Compute the condition once, as an ordered cascade, and branch on it: **errored** (the fetch failed — say so, and offer retry; never paint a reassuring empty state over a network failure) → **still loading** (hand off to [`page-loading.md`](./page-loading.md); the empty state is unreachable until settled) → **filtered to zero** (the collection has members but the current query matches none — name the filter, offer a reset, never a first-run CTA) → **genuinely empty** (which splits again into *prerequisite not met* — the feature cannot produce data until something is connected or configured — and *first use*, the only case that gets the onboarding CTA). Express the choice through `feedback/ScenarioEmptyState` and its two wrappers (`NoResults`, `InboxZero`), or through the `emptyTitle`/`emptyDescription` props of the table primitive that already owns the branch — **never by writing a new `*EmptyState` component in your feature folder**; the repo has 36 of those and every one of them re-decides this question in isolation. Separately, and always: **any value on screen that is placeholder, simulated, or seeded rather than measured must carry a visible mark, and must be excluded from every aggregate computed over it** — an unmarked placeholder folded into a total silently turns a guess into a fact.

**Warrant tags** (per the [portability test](../research/portability-test.md), so an adopting repo can sort physics from local habit):
- *Physics* — errored ≠ empty; filtered-zero ≠ first-use; a placeholder inside an honest-looking total is a lie. All three were independently rediscovered in `personas-web` (see Convergence).
- *Ergonomics* — compute the condition once as a cascade rather than re-deriving it per branch; put the CTA only on first-use.
- *Local calibration* — the specific primitive names, the `variant` vocabulary, and the "prerequisite not met" fifth case (which exists here because this product has connectors and credentials; `personas-web` has no analogue and needs no such case).

## Mandated primitives

- **`feedback/ScenarioEmptyState`** — **a `default` export**, so `import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState'`. Props: `icon` | `glyph`, `title`, `subtitle`/`description`, `action`, `secondaryAction`, `iconColor`, `iconContainerClassName`, `children`, `variant`. Seven curated `variant` values exist (`credentials-need-agents`, `triggers-manual-only`, `dashboard-no-executions`, `subscriptions-empty`, `connectors-empty`, `use-cases-empty`, `no-results`), each supplying icon + colour + translated copy from `t.empty_states.*`.
- **`NoResults({ onReset, title?, subtitle?, resetLabel? })`** — named export from the same file (`ScenarioEmptyState.tsx:205`). **This is the filtered-to-zero primitive.** `SearchX` icon, muted `bg-secondary/40` treatment, `RotateCcw` reset CTA wired to `onReset`. The primitive already states this path's copy doctrine in two source comments: `:41-42` — the filter-reset case must read *"adjust, don't panic" rather than a full first-run empty state* — and `:82-83` — *"a 128px illustration that draws itself is wrong for a filtered-to-zero list."*
- **`InboxZero({ title, subtitle?, celebrate? })`** — named export (`ScenarioEmptyState.tsx:240`). Emerald `CheckCircle2`; `celebrate` plays a one-shot pop, reduced-motion gated. Use when zero is the *good* outcome (a queue drained, no incidents).
- **`display/FacetedDecisionTable`** — the only table primitive whose `labels` type makes `emptyTitle` and `emptyDescription` **required** (`FacetedDecisionTable.tsx:34-35`). All 3 call sites supply real translated copy. This is not a coincidence; see Gaps 1.
- **`display/UnifiedTable` / `display/DataGrid`** — `emptyTitle`, `emptyDescription`, `emptyGlyph`, `emptyIcon`. The settled-empty branch is `UnifiedTable.tsx:604-619` / `DataGrid.tsx:369-373`; both fall back to `t.shared.grid_no_data` (`en.json:18195` = `"No data"`) and both carry the identical in-source comment saying to always pass a specific `emptyTitle` instead (`UnifiedTable.tsx:614-616`, `DataGrid.tsx:369`).
- **`t.empty_states.*`** (18 keys, `en.json:12002`) — the shared translated vocabulary. `t.empty_states.no_results_title` / `no_results_subtitle` / `reset_filters` are the filtered-zero strings; do not invent parallel ones.
- **For the demo/placeholder mark:** the `FlaskConical` lucide glyph plus a neutral pill is the established treatment (`ExecutionListRow.tsx:77-82`), and `strokeDasharray` + a `trend_sim_suffix` label is the established chart treatment (`KPIDashboard.tsx:330,343`).

There is **no** `feedback/EmptyState` and no shared error-state primitive. Both absences are load-bearing; see Gaps.

## Steps

1. **Enumerate your conditions before you write JSX.** For this surface, which of the five can actually occur? A surface with no filter control cannot be filtered-to-zero. A surface reading a store that never fails has no error condition. Writing down "three of five apply here" is the step people skip.
2. **Read [`page-loading.md`](./page-loading.md) first** if the surface fetches. It owns everything until the fetch settles, and its law — *the empty state is unreachable until the fetch settles* — is the precondition for everything below.
3. **Derive the condition once, as a cascade, above the return.** The canonical shape, from `ExecutionList.tsx:454-493`:
   ```
   error && rows.length === 0      → error state + retry
   loading && rows.length === 0    → page-loading.md owns this branch
   rows.length === 0               → settled-empty (split further, step 4)
   otherwise                       → rows
   ```
   The `&& rows.length === 0` conjunct on the first two is what keeps a failed poll or a background refetch from wiping rows the user is reading.
4. **Split settled-empty on the raw collection, not the filtered one.** `filtered.length === 0 && raw.length > 0` is *filtered-to-zero*; `filtered.length === 0 && raw.length === 0` is *genuinely empty*. Reference impl: `TableSelector.tsx:120-130` and `TableListSidebar.tsx:88-99`. This exact predicate was independently rediscovered in `personas-web` (`executions/page.tsx:110-113`).
5. **Filtered-to-zero → `<NoResults onReset={…} />`.** Wire `onReset` to the same handler your "clear filters" control uses. Never show a create/onboard CTA here — the user has data; they have a query problem.
6. **Genuinely empty → decide prerequisite vs first use.** If the feature physically cannot produce data until something is connected/configured, use the prerequisite copy and make the CTA the *setup* action (`CloudWebhooksTab.tsx:137-138` is the shape). Otherwise it is first use: a `ScenarioEmptyState` with the onboarding CTA (`DashboardEmptyState.tsx:19-30`, `EventLogList.tsx:427-438`).
7. **If zero is the good outcome, use `InboxZero` instead of a first-use state.** A drained review queue is not a first-use screen.
8. **For a list or table, delete steps 4–7 and pass props.** `FacetedDecisionTable` requires `labels.emptyTitle`/`emptyDescription`; `UnifiedTable`/`DataGrid` take `emptyTitle`/`emptyDescription`/`emptyGlyph`. **Then stop** — the primitive owns the settled-only guard, the ghost hand-off and the layout. If the surface also filters, keep step 4 outside the table and swap the strings you pass (`EventLogList.tsx:276` computes `showRichEmpty` for exactly this).
9. **Write the copy to the condition, in the right register.** First-use copy is *instructional future tense* — "Events will appear here as agents process triggers." Filtered copy is *diagnostic present tense* — "Other runs exist but none match this filter." Prerequisite copy names the missing thing. `personas-web` arrived at this same register split with no shared document; it is the strongest available evidence it is real.
10. **Every string is `t.section.key`.** Not a ternary between two English literals — that is the single most common i18n defect in this corpus (Deviations F).
11. **If any rendered value is placeholder/simulated/seeded, mark it and exclude it.** Mark at the row (`FlaskConical` pill), at the series (`strokeDasharray` + label suffix), and — non-negotiably — **exclude it from every aggregate**. `MonitorTotals.tsx:20-23` states the reason better than this document can: *"folding them into a total would quietly turn a placeholder into a fleet fact."*
12. **Dev-only seed data is gated by `import.meta.env.DEV`, never by a runtime flag.** Five surfaces already do this correctly (Evidence).

## Anti-patterns

- **`items.length === 0 ? <Empty/> : <Rows/>` with an `error` in scope that the branch never consults** — the failure mode is a user who is told their data doesn't exist when in fact the request failed. 20 of the 27 surfaces holding an error channel do this.
- **Rendering filter-specific copy unconditionally** — "No matches for your filters. Try adjusting your search" shown to a user who has set no filters. Actively misdirects: they go hunting for a filter to clear that isn't there.
- **Rendering first-use copy on a filtered-to-zero list** — "Create your first agent" to someone who has 400 agents and typed a typo.
- **Falling through to `t.shared.grid_no_data` (`"No data"`)** — grammatically fine, semantically empty. It cannot teach, cannot recover, and is identical across every table in the product.
- **Creating `<Feature>EmptyState.tsx` in your feature folder** — the reason 37 of these exist is that each one looked like a small local decision. The cost is that no condition taxonomy, copy register, or a11y treatment can ever be fixed centrally.
- **Treating "the user cleared it" as a distinct computed state** — neither this repo nor `personas-web` computes history, and both are right not to. It is a *tone* (emerald + check, via `InboxZero`), chosen from the entity's semantics, not a fifth branch. Do not add a `hadDataBefore` flag.
- **Substituting placeholder data for an empty state** — `phases: h?.phases ?? MOCK_PHASES` (`studioStore.ts:211`). The empty state is the honest answer; a mock is a fabricated one. `personas-web` commits the identical anti-pattern at `PerformanceView.tsx:48`, which is how you know it is a real trap rather than a local slip.
- **Marking placeholder rows visually but still summing them** — half a fix, and the worse half: the mark says "not real" while the total says "real".
- **`<p>No results</p>`** as the entire empty state — no icon, no recovery, no reason. 23 of the 33 filter-owning surfaces are some variant of this.
- **A `variant` on `ScenarioEmptyState` that duplicates a curated one** — five of the seven curated variants have zero `variant=` consumers while call sites hand-assemble the same icon/colour/copy inline.

## Evidence

**Copy this one:** `agents/sub_executions/components/list/ExecutionList.tsx:454-493` — the complete ordered cascade in one return: error-with-retry (`:454-464`), loading ghost (`:465-480`, deferring to `page-loading.md`), settled first-use with CTA (`:481-492`), rows (`:493`). It is the only site in the repo that gets all four right.

> **Cross-path correction.** [`page-loading.md`](./page-loading.md) Deviations A lists this same file at `:360-375` as its highest-value violation (*"`if (loading) return <TableSkeleton…>` — triple violation… the only such caller, so it pulses"*). **That row is stale as of this sweep**: `:356-375` now holds only the `selectedPersona` / comparison / bulk-report early returns, and the loading branch has moved to `:465-480` where it renders `calm` ghost rows under the real column header, inside the real chrome, guarded by `&& executions.length === 0`. The file went from that path's worst offender to this path's reference implementation. Fix the row when `page-loading.md` is next touched; do not re-derive the deviation from it.

- `shared/components/forms/TableSelector.tsx:114-130` — the raw-vs-filtered split, in a *shared* component: `error` banner, then `!loading && !error && filtered.length === 0 && tables.length === 0` (first use), then the same guard with `tables.length > 0` (no match). Four conditions, four lines, no local component.
- `vault/sub_databases/tabs/TableListSidebar.tsx:88-99` — the same predicate with a prerequisite affordance in the first-use branch (`SidebarTestConnection` at `:93`).
- `overview/sub_events/components/EventLogList.tsx:276` — `const showRichEmpty = !isFetching && displayedEvents.length === 0 && !hasActiveFilters;` — the cleanest single-expression statement of "settled **and** empty **and** unfiltered", feeding a rich first-use state at `:427-438` and the table's filtered copy at `:447`.
- `agents/components/allPersonas/PersonaOverviewPage.tsx:277` — `filteredData.length === 0 && hasActiveFilter` gating a reset-CTA empty state. Correct on the filtered half (the first-use half is a deviation, see A).
- `plugins/companion/sub_decisions/sharedBlocks.tsx:120-154` — `DecisionsEmpty({ filtered })` — the two-condition split extracted into one component with a boolean discriminator, each branch with its own CTA. The shape to reach for when a surface needs its own wrapper.
- `templates/sub_generated/gallery/explore/EmptyState.tsx:55-65` — `SearchEmptyState` as a pre-configured wrapper over a base, with a `clear_search` action. Local, but the right *structure*.
- `triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:137-138` — the prerequisite-not-met state (`cloud_not_connected` + `cloud_not_connected_desc`).
- `overview/sub_incidents/components/IncidentsInbox.tsx:521` — the sole `InboxZero` call site.
- `shared/components/display/FacetedDecisionTable.tsx:34-35,202-203` — required `emptyTitle`/`emptyDescription`, and 3 of 3 call sites (`BacklogTable.tsx:222`, `DispatchTable.tsx:137`, `KnowledgeTree.tsx:408`) supply real translated copy.

**Demo / placeholder marking:**
- `plugins/fleet/sub_monitor/MonitorTotals.tsx:20-23,34` — the doctrine, stated in the repo's own words, and enforced: simulated rows are skipped in every measured sum.
- `plugins/fleet/sub_monitor/MonitorRow.tsx:48-49` — the matching row-level mark (`opacity-40` + `monitor_simulated_hint`).
- `agents/sub_executions/components/list/ExecutionListRow.tsx:77-82` — `FlaskConical` + `SIMULATED` pill + tooltip *"This run was a simulation — notifications were not sent."*
- `teams/sub_kpis/KPIDashboard.tsx:330,343` — simulated series get `strokeDasharray="6 4"` and a `trend_sim_suffix` in the legend; `kpiDetailParts.tsx:117,217` makes the simulated overlay hollow-dotted and "visually subordinate".
- `EventLogList.tsx:303-306`, `CronAgentsPage.tsx:42-44`, `MessageList.tsx:279-281`, `KnowledgeGraphDashboard.tsx:193-195`, `ManualReviewList.tsx:367-369` — all five seed buttons gated on `import.meta.env.DEV`.

## Deviations found

**A. Falls through to the untranslated-in-spirit last resort `"No data"`** *(5 sites — `UnifiedTable`/`DataGrid` with no `emptyTitle`)*

| Path | Defect |
|---|---|
| `overview/sub_certification/components/GroundingTable.tsx:73` | Grounding table settles to `"No data"` — no condition, no recovery |
| `plugins/dev-tools/sub_llm_overview/LlmOverviewPage.tsx:410` | Same, on the LLM call overview |
| `plugins/dev-tools/sub_projects/ProjectManagerPage.tsx:490` | Same; a first-use project list is exactly the case that wants an onboarding CTA |
| `recipes/sub_playground/tabs/RecipeOverviewTab.tsx:63` | Same |
| `agents/components/allPersonas/PersonaOverviewPage.tsx:291` | The **unfiltered** path reaches `"No data"`; the filtered path at `:277` is correct — one surface, one condition right and one wrong |

**B. Filter-specific copy rendered unconditionally** *(5 render sites in 4 files)* — a user who set no filter is told to adjust one.

| Path | Defect |
|---|---|
| `overview/sub_usage/components/ToolPerformancePanel.tsx:214` | `emptyTitle={t.overview.events.no_filter_match}` with no filter guard |
| `overview/sub_observability/components/IpcPerformancePanel.tsx:224` and `:240` | Two tables, both unconditional `no_filter_match` |
| `vault/sub_databases/DatabaseListView.tsx:126-127` | `no_matching` + *"Try changing the type filter"* on a first-run database list |
| `vault/sub_credentials/components/list/CredentialList.tsx:155-156` | `no_match` + *"Try adjusting your filters or search term"* — the empty vault on first launch |

**C. Errored fetch renders as "there is nothing"** *(20 of 27 surfaces that hold an error channel — 74%)*

The primitive layer is 100% of the problem: **all 23 `UnifiedTable`/`DataGrid`/`FacetedDecisionTable` call sites** are in files with no error affordance of any kind, because none of the three primitives has an error input. Only 7 surfaces in the whole corpus gate the empty branch on the error channel — `ExecutionList.tsx:454`, `LabEventStream.tsx:71`, `ReviewsRail.tsx:136`, `TemplateSuggestionsWidget.tsx:104`, `GalleryPage.tsx:196`, `N8nSessionList.tsx:249,253`, `DocumentsTab.tsx:112` (plus `TableSelector.tsx:120,126` and `TableListSidebar.tsx:88,97` in the shared/vault layer).

**D. Filter-owning surfaces that show one message for both conditions** *(23 of 33 — 70%)*

*Method, so the number is auditable:* of the 350 empty-render surfaces, 33 also own a search or filter control that narrows the very list they render (detected by co-occurrence of a filter/query identifier and a search-input marker). 10 of those distinguish the two conditions by some mechanism — a named `hasActiveFilters`-class flag, a `raw.length > 0` conjunct, `<NoResults>`, or a `search ? A : B` copy ternary. The remaining 23 use one string for both. A second, differently-shaped detector (named-flag presence over all 350) returned 17 with ~5 false positives, and the union of the two methods is 24 distinguishing surfaces repo-wide — so read "10 of 33" as the strict count within the filter-owning population and "~24" as the loose count everywhere. Both agree the majority does not distinguish.

`agents/components/PersonaSelector.tsx` · `agents/components/PersonaSelectorModal.tsx` · `fleet/monitor/channels/Stream.tsx` · `overview/sub_director/components/AddToScopeModal.tsx` · `overview/sub_knowledge/components/KnowledgeGraphDashboard.tsx` · `overview/sub_patterns/graph/FabricSearch.tsx:123` · `plugins/artist/sub_gallery/GalleryPage.tsx` · `plugins/dev-tools/sub_context/ContextGroupRowsStats.tsx` · `plugins/dev-tools/sub_context/ContextLedger.tsx` · `plugins/drive/components/DriveToolbar.tsx` · `plugins/fleet/SkillLibraryDrawer.tsx` · `plugins/fleet/sub_activity/FleetActivityPage.tsx` · `plugins/obsidian-brain/sub_graph/GraphPanel.tsx:283` · `plugins/research-lab/sub_literature/ArxivSearchModal.tsx:261` · `plugins/research-lab/sub_literature/LiteratureSearchPanel.tsx:139` · `plugins/twin/shared/TwinPicker.tsx` · `recipes/sub_list/components/RecipePicker.tsx:77` · `settings/sub_portability/components/ExportSelectionModal.tsx:310` · `templates/sub_generated/gallery/cards/GeneratedReviewsTab.tsx` · `templates/sub_recipes/components/RecipesBrowseList.tsx:191` · `triggers/sub_studio/routing/layouts/AddPersonaModal.tsx:236` · `vault/shared/vector/tabs/SearchTab.tsx:134` · `vault/sub_credentials/components/picker/ResourcePicker.tsx`

**E. Feature-local empty-state components** *(36 files, 38 declarations — the consolidation backlog)*

Every one bypasses the shared condition vocabulary. The full list is the census-rule baseline in §9. The highest-value merges, because they already implement a discriminator that belongs in the shared primitive:

| Path | What it already does that the primitive should own |
|---|---|
| `plugins/companion/sub_decisions/sharedBlocks.tsx:122` | `filtered: boolean` discriminator with per-branch CTAs |
| `templates/sub_generated/gallery/explore/EmptyState.tsx:55` | `SearchEmptyState` = a second `NoResults` |
| `overview/sub_memories/components/MemoryEmptyState.tsx:9` | `hasFilters: boolean` discriminator |
| `agents/components/allPersonas/PersonaOverviewEmptyState.tsx:13` | A second `NoResults` (its docblock says so: *"Shown when filters/search reduce the table to zero rows"*) |
| `vault/sub_credentials/components/list/EmptyStateView.tsx` · `plugins/research-lab/shared/EmptyState.tsx` · `overview/sub_leaderboard/components/EmptyStates.tsx` · `vault/shared/playground/tabs/{ApiExplorerSubComponents,McpToolResultDisplay}.tsx` · `teams/sub_teamWorkspace/TeamList.tsx` · `vault/sub_databases/tabs/ChatMessages.tsx` | Six components literally named `EmptyState` / `EmptyStateView`, each a partial reimplementation of the shared one |

**F. Hardcoded English in empty-state copy** *(4 files)* — a half-English UI in 13 locales.

| Path | Defect |
|---|---|
| `overview/sub_memories/components/MemoryEmptyState.tsx:19-20` | Both branches are English string literals — **and the translated key already exists and is unused** (`en.json:6637` = *"No memories match your filters. Try adjusting your search."*, byte-identical to line 19). Also keeps one title across both conditions, producing "No memories yet / No memories match your filters." |
| `agents/sub_lab/use-cases/UseCasesList.tsx` | `'No structured use cases found.'` / `'No use cases generated yet.'` |
| `plugins/fleet/sub_grid/FleetGridPage.tsx` | `'Click Spawn to launch claude…'` / `'Pick a project in Dev Tools → Projects.'` |
| `vault/sub_catalog/components/forms/CodebaseProjectPicker.tsx` | Two English literals in the empty branch |

**G. Documentation drift that causes the deviations**

- **`.claude/CLAUDE.md`, `docs/refactor/shared-component-reuse.md` and `CATALOG.md` recommended `feedback/EmptyState` for months. No such file exists.** The real component is `feedback/ScenarioEmptyState`, a **default** export — which is why `import EmptyState from '…/ScenarioEmptyState'` looked plausible: **31 of the 32 importing files alias it to exactly that name**, so the codebase reads as though `EmptyState` exists while no file declares it. That is also why 36 people wrote their own instead. A corrections pass has fixed the docs; category E is the residue. **The durable fix is a re-export** — `feedback/EmptyState.tsx` re-exporting the default — so the name every caller already uses resolves to the primitive instead of to nothing.
- `shared/components/CATALOG.md:42,50,55,99` — **all four shared empty-state components are listed with `_(add a @catalog tag)_` and no description**: `ChartEmptyState`, `EmptyIllustration`, `IllustratedEmptyState`, `ScenarioEmptyState`. A developer scanning the catalog sees four undifferentiated options and picks none. (Per `page-loading.md`'s own correction note, the fix for a `CURATED`-listed name is `scripts/docs/gen-shared-catalog.mjs`'s `CURATED` map, not a tag on the component.)

**H. Unflagged placeholder data**

| Path | Defect |
|---|---|
| `studio/studioStore.ts:211` | `phases: h?.phases ?? MOCK_PHASES` — fabricated build phases substituted whenever real history is absent, with no mark. Also `:555`. |
| `fleet/monitor/live/liveDevHarness.ts` | Subscribed in production code (`LiveChannelOverlay.tsx:21`) and **not** `import.meta.env.DEV`-gated, unlike the five seed buttons. `emitMockLiveMessage()` (`:60`) currently has zero callers, so it is inert — but the wiring is one call site away from injecting synthetic agent chatter into a live channel. |
| `templates/sub_recipes/mockRecipes.ts` | `MOCK_RECIPES` re-exported from the feature barrel (`index.ts:16`) with no render consumer — an eight-recipe fake catalog one import away from a real surface. |

**I. Dead configuration in the primitive** — 5 of the 7 curated `ScenarioEmptyState` variants have **zero** `variant=` consumers: `credentials-need-agents`, `triggers-manual-only`, `dashboard-no-executions`, `subscriptions-empty`, `no-results` (the last is reached only through the `NoResults` wrapper, 3 sites). Only `connectors-empty` (`PersonaConnectorsTab.tsx`) and `use-cases-empty` (`PersonaLayoutView.tsx`) are used directly. Ten `t.empty_states.*` keys × 14 locales are shipped for copy nothing renders — while call sites hand-assemble equivalent icon/colour/copy inline.

## Gaps in the primitive

1. **`ScenarioEmptyState` has no condition discriminator.** Its `variant` axis is *subject matter* (credentials, triggers, connectors), not *condition* (first-use, filtered, prerequisite, error). So the taxonomy this path prescribes has no home in the type system: nothing stops a caller passing first-use copy on a filtered list. **The type-level fix is visible in the repo already** — `FacetedDecisionTable` makes `emptyTitle`/`emptyDescription` *required* and gets 3/3 real copy, while `UnifiedTable`/`DataGrid` make them optional and get 5 of 20 falling through to `"No data"`. A required discriminated union (`condition: {kind:'first-use', action} | {kind:'filtered', onReset} | {kind:'prerequisite', setupAction} | {kind:'error', onRetry}`) would make categories A, B and D unrepresentable, and a lint rule cannot be disabled around a type.
2. **No primitive expresses "errored" at all.** There is no shared error-state component (`feedback/` has `ErrorBanner`, `InlineErrorBanner`, `ErrorRecoveryBanner`, `ErrorBoundary` — all *banners over content*, none an empty-region replacement), and none of the three table primitives takes an error input. Category C (74%) is entirely downstream of this one gap. `personas-web` solved the same problem with a dedicated amber `DashboardErrorBanner` + an explicit *suppress the empty state when `error` is set* rule at three sites — a smaller fix than a new primitive, and available here today.
3. **`t.shared.grid_no_data = "No data"` is a functioning default.** Both tables comment that a caller should always pass `emptyTitle`, and both then supply a fallback that makes ignoring the comment invisible. Making the prop required (Gap 1) deletes the fallback and the comment together. Note the copy itself is on the banned-string list from the [anti-ui-slop research](../research/anti-ui-slop.md) §3, found there by a completely independent method.
4. **`NoResults` is discoverable only by reading `ScenarioEmptyState.tsx` to the bottom.** It is a named export below a default export, absent from `CATALOG.md`, and has 3 call sites against 23 surfaces that need it. Meanwhile 4 feature-local components reimplement it.
5. **No "prerequisite not met" variant, though the vocabulary is enormous.** 68 `en.json` keys match the not-connected / needs-credentials / not-configured family, and two of the seven curated variants (`credentials-need-agents`, `triggers-manual-only`) *are* prerequisite states — unlabelled as such and unused. This is the one condition with no analogue in `personas-web`, so it is local calibration, not physics — but locally it is the second-most-common real condition after first-use.
6. **Nothing marks placeholder data at the type level.** `is_simulation` (executions), `simulated` (fleet terminals) and `source === 'simulation'` (KPI measurements) are three independent conventions on three unrelated types, each with its own hand-written render treatment and its own hand-written aggregate exclusion. A shared `Provisional<T>` wrapper — or at minimum a shared `<PlaceholderMark/>` — would make `MonitorTotals.tsx:34`'s `if (term.simulated) continue;` a property of the data rather than a thing each aggregator must remember. It is remembered in 1 of the 3.
7. **Zero automated enforcement today.** No ESLint rule, no check script, and no test asserts any condition split; `ScenarioEmptyState` has no test file. `.claude/conventions.json` lists no empty-state entry. **Every deviation above shipped under a green `npm run check`.**

## Convergence — measured against `personas-web`

A read-only census of the sibling repo (Next.js 16 / SWR / no Tauri / no shared document with this one) was run specifically to test whether the five-condition taxonomy is physics or taste. **It is neither, cleanly — three of five survived, one collapsed, one is local.**

| Condition | `personas` | `personas-web` | Verdict |
|---|---|---|---|
| **filtered ≠ first-use** | 10–24 sites depending on detector; 23 of 33 filter-owning surfaces fail it | **6 independent implementations**: an `isFilteredEmpty: boolean` prop (`ExecutionsEmptyState.tsx:5`), inline triple-ternaries (`incidents/page.tsx:91-98`), icon swaps `FilterX`/`SearchX`, "Show all"/"Clear filters" actions — **and the predicate is identical to ours**: `filter !== "all" && executions.length > 0 && filtered.length === 0` (`executions/page.tsx:110-113`) | **Physics.** Reinvented, with the same guard. |
| **errored ≠ empty** | 7 of 27 error-holding surfaces get it right | **Stated in a code comment**: *"A failed fetch surfaces the banner above; don't also paint the reassuring 'no agents' empty state over a network error"* (`agents/page.tsx:143-144`), plus the same suppression at `incidents/page.tsx:76` and `health/page.tsx:66`, backed by a dedicated `DashboardErrorBanner` at 12 sites | **Physics.** Reinvented, and reasoned about in prose. |
| **first use** | Default branch; 61 i18n keys | Default branch; and an unwritten copy convention — every first-use description is instructional-future ("will appear here", "Deploy your first…"), every filtered one diagnostic-present ("Other runs exist but none match") | **Physics**, but only as "the else branch". No flag in either repo. |
| **user cleared it** | `InboxZero` (1 call site) + emerald/check tone | Emerald + `Check`/`ShieldCheck` at 5 sites — **and no `hadDataBefore` / `everHadItems` anywhere**; the tone is chosen from the entity's semantics, not from history | **Not a state.** Two repos independently declined to compute it. Demoted in this path from a branch to a tone. |
| **no permission / not entitled** | Does not occur: tier is resolved at build time (`useTier.ts:42` → `BUILD_MAX_TIER`), so a gated feature is *absent*, not *empty* | **Clean negative** — no entitlement concept exists at all; a 401/403 falls into the generic error banner (`lib/api.ts:37-43` defines `ApiError` with `res.status` and nothing branches on it) | **Fails as stated.** Replaced here by *prerequisite not met*, which is real in this repo (68 keys) and has no analogue there — therefore local calibration, not doctrine. |

Two further convergences worth recording:

- **The demo mark converged on the same glyph.** `personas-web` flags demo mode with an amber **`FlaskConical`** pill in the navbar (`DashboardNavbar.tsx:53-58`); this repo flags a simulated run with a **`FlaskConical`** pill on the row (`ExecutionListRow.tsx:80`). Same icon, two stacks, no shared document.
- **The anti-pattern converged too.** `personas-web`'s `PerformanceView.tsx:48` — `if (healthIssues.length === 0) return isDemo ? MOCK_HEALTH_ISSUES : [];` — substitutes mock data *for an empty state*, exactly as `studioStore.ts:211` does here. A trap two teams fell into independently is worth naming explicitly, which is why it is in Anti-patterns.

The counter-signal, and the reason Gap 1 is the highest-value item in this document: **`personas-web` distinguishes the conditions without ever encoding them.** No variant, no enum, no union type — the semantics live in ad-hoc ternaries at ~40 sites. The visible cost is `SubscriptionsPanel.tsx:114`, which swaps the *title* for the filtered case and leaves the first-use *description* underneath, shipping "No matching subscriptions / Create subscriptions to route events to your agents." That is precisely the drift a discriminated primitive prevents, observed in the wild.

## The missing gate

**The semantic condition to detect:** *a surface answers "what do I show when there is nothing" by authoring a new component in its own feature folder, rather than by selecting a condition on the shared primitive.* This is upstream of Deviations A–D: a local empty-state component cannot be given a condition taxonomy, a copy register, or an error branch centrally, so every one of them re-decides the question and most decide it wrong.

**What this repo's manifestation of that condition looks like:** a top-level `function` / `const` declaration under `src/features/**` whose identifier ends in `Empty`, `EmptyState`, `EmptyStateView`, `EmptyGlyph`, `EmptyHint` or `EmptyList`. **This shape is a local accident and must not travel.** `personas-web` has the identical condition — 32 of ~40 empty-state sites hand-rolled — and this signal scores **near zero** there, because its hand-rolls are inline `<p className="py-8 text-center">{labels.empty}</p>` inside the consuming component, never extracted into a named one. An adopting repo must re-derive its own proxy for the same condition; ours works here only because this codebase's house style is to extract.

**Mechanism — one census rule.** Countable, ratcheting, and it inherits the fail-loud contract (`floor` breach, zero-match, stale exclude, silent drop) rather than re-deriving it:

```jsonc
{
  "id": "local-empty-state",
  "goldenPath": "docs/concepts/golden-paths/empty-and-demo-states.md",
  "title": "Feature-local empty-state component instead of ScenarioEmptyState",
  "roots": ["src/features"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "^\\s*(?:export\\s+)?(?:default\\s+)?(?:function|const)\\s+(?:[A-Z]\\w*)?Empty(?:State(?:View)?|Glyph|Hint|List)?\\s*[(=<]",
    "flags": "gm",
    "ignoreCommentLines": true,
    "description": "a component declared in a feature folder to render a settled-empty region; the shared answer is feedback/ScenarioEmptyState + its NoResults / InboxZero wrappers, which is also the only place a condition taxonomy can live"
  },
  "exclude": [
    { "path": "src/features/shared/components/feedback/ScenarioEmptyState.tsx",
      "reason": "the primitive itself — this is the destination the rule routes callers to" },
    { "path": "src/features/shared/components/display/ChartEmptyState.tsx",
      "reason": "shared chart-shaped empty state; a consolidation target for Gap 1, not a feature-local hand-roll" },
    { "path": "src/features/shared/components/display/IllustratedEmptyState.tsx",
      "reason": "shared illustrated variant; same consolidation target, not a feature-local hand-roll" }
  ],
  "baseline": { "files": 36, "matches": 38 },
  "floor": 2500
}
```

**Verified through a second implementation, as the contract requires — and the second implementation was wrong.** A standalone script written to size this rule reported **37 files / 39 matches**; the real runner reports **36 / 38**, because its `isCommentOnlyLine` is stricter than the hand-rolled filter and correctly discards one match sitting in prose. The baselined number is the runner's. This is the `raw-web-storage` lesson (35% of its "430 lines" were comments about the migration) recurring at small scale: **do not baseline a count your own script produced.** Registered and verified: `npm run census:check` reports `OK local-empty-state 36 36 38 38 3137 2500` alongside the rest of the registry, and `npm run census:test` passes 21/21.

The walk sees **3,137** files under `src/features`; `floor: 2500` matches the sibling `hand-rolled-spinner` rule rooted at the same path. The three `exclude` entries are the **only** three files under `src/features/shared/` that the pattern matches — checked by running the pattern against that subtree alone, so none is a stale exemption, and `EmptyIllustration.tsx` is deliberately *not* listed (the pattern does not match it, so listing it would fail the run as a stale exemption). Precision on the 38 surviving matches: **36 true positives; 2 are `const X = lazy(...)` re-declarations of components already counted** (`HomeReleases.tsx:38`, `GoalsTimeline.tsx:32`) — 95%. A looser variant (`Empty\w*`, any suffix) yields 45 files / 50 matches at ~80% precision by admitting `EmptyLine`, `EmptyRow`, `EmptyDropZone`, `EmptyMark`; the tightened suffix list above is what buys the extra 15 points, and is what is baselined.

**What it deliberately does not catch, and why that is honest.** Non-exported locals *are* inside the 36 — `SectionEmpty`, `CockpitEmptyState`, `AtelierEmpty` ×2, `WorkbenchEmpty`, `CartoEmpty`, `RadarEmptyState`, `UnchartedEmptyState`, `DriveEmptyState` and four bare `EmptyState` locals all match. What escapes is (a) names outside the suffix list — `SearchEmptyWithCTA` and `ColumnEmptyLabel` (`DriveFileList.tsx`), `EmptySection` (`MonitorDrawer.tsx`), `EmptyRow` (`ScraperControlRoom.tsx`) — a deliberate trade, since admitting them also admits `EmptyLine`, `EmptyDropZone`, `EmptyMark` and `EmptyNote`, which are not empty states at all; and (b) the far larger population that never gets extracted into a component: the inline `<p className="…">{t.x.no_items}</p>` form, which is most of Deviations D. Recall is partial by construction. A ratchet trades recall for precision on purpose — the failure mode this gate must never have is the one the [portability test](../research/portability-test.md) documented: reporting green while the condition is present at scale. Recall is the ESLint rule's job, below.

**The complementary ESLint rule, and why the census cannot do its job.** The other half of the doctrine — *the empty branch must consult the filter state and the error state* — is genuinely AST-shaped and must not be attempted with a regex. The guard conjuncts (`!loading`, `!error`, `raw.length > 0`) appear in any order, on any line, and may be hoisted into a named boolean two hundred lines above the JSX (`EventLogList.tsx:276` is exactly that case); a whole-file pattern can see that the tokens co-occur but not that they *gate the same branch*, and would score `PersonaOverviewPage.tsx` — half right, half wrong — as clean. Specify `custom/require-empty-discriminator`: on a `ConditionalExpression` or `LogicalExpression` whose test contains `<ident>.length === 0` and whose consequent renders an empty-state element (`ScenarioEmptyState`, `NoResults`, `InboxZero`, or a JSX element whose name matches the census pattern), report when the enclosing component binds an identifier matching `/^(error|loadError|fetchError)$/` or `/^(has(Active)?Filters?|search|query|\w+Filter)$/` that the test expression does not reference. `RuleTester` fixtures come free: `TableSelector.tsx:120-130` is the positive case, `ToolPerformancePanel.tsx:214` and `CredentialList.tsx:155` the negatives. The two compose as the contract intends — **the rule reports the semantics, the census ratchets the population.**
