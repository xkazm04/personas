# Perf-Optimizer Scan — Personas, 2026-05-17

> Frontend-only perf audit (`src/`, `src-tauri/` deliberately excluded).
> 23 parallel `perf-optimizer` subagent runs, dispatched in 3 waves of ≤8.
> Subject: `personas-desktop` @ `329409f4a7949ecfa441f9e23f26f04e7993b0d2` (master).

---

## Totals

| Severity | Count | Share |
|---|---:|---:|
| **Critical** | 25 | 12.4% |
| **High**     | 82 | 40.8% |
| **Medium**   | 73 | 36.3% |
| **Low**      | 21 | 10.4% |
| **Total**    | **201** | 100% |

Category distribution (top buckets, multi-tag entries split on `/` taken on first tag):

| Category | Count | Share |
|---|---:|---:|
| **re-render**         | ~85  | ~42% |
| **algorithmic**       | ~38  | ~19% |
| **duplicate-call**    | ~37  | ~18% |
| **async-coordination** | ~18 | ~9%  |
| **data-layer**        | ~17  | ~8%  |
| **memory + other**    | ~6   | ~3%  |

> **Headline:** ~80% of findings collapse to two root patterns — *unstable Zustand selectors / fresh-reference returns causing cascading re-renders*, and *unbatched event-bus work multiplied across N subscribers/rows*. Fixing the i18n triad + the realtime singleton coalescing alone closes ~15-20% of the catalog by lift.

---

## Per-context breakdown

Sorted by criticals desc, then total desc.

| # | Context | C | H | M | L | Total | Report |
|--:|--------|--:|--:|--:|--:|------:|--------|
| 1 | activity-events-realtime-bus | 3 | 4 | 3 | 1 | **11** | [`activity-events-realtime-bus.md`](activity-events-realtime-bus.md) |
| 2 | i18n-system-shared-design-components | 3 | 4 | 2 | 1 | **10** | [`i18n-system-shared-design-components.md`](i18n-system-shared-design-components.md) |
| 3 | templates-catalog-n8n-adoption | 2 | 5 | 2 | 1 | **10** | [`templates-catalog-n8n-adoption.md`](templates-catalog-n8n-adoption.md) |
| 4 | persona-crud-editor | 2 | 4 | 2 | 1 | **9** | [`persona-crud-editor.md`](persona-crud-editor.md) |
| 5 | first-party-plugins-artist-drive-gitlab-obsidian-twin | 1 | 7 | 4 | 1 | **13** | [`first-party-plugins-artist-drive-gitlab-obsidian-twin.md`](first-party-plugins-artist-drive-gitlab-obsidian-twin.md) |
| 6 | analytics-sla-usage-leaderboard | 1 | 5 | 3 | 1 | **10** | [`analytics-sla-usage-leaderboard.md`](analytics-sla-usage-leaderboard.md) |
| 7 | credential-vault-crud | 1 | 4 | 4 | 1 | **10** | [`credential-vault-crud.md`](credential-vault-crud.md) |
| 8 | trigger-studio-webhooks | 1 | 3 | 4 | 2 | **10** | [`trigger-studio-webhooks.md`](trigger-studio-webhooks.md) |
| 9 | build-sessions-personamatrix | 1 | 3 | 4 | 1 | **9** | [`build-sessions-personamatrix.md`](build-sessions-personamatrix.md) |
| 10 | lab-use-cases-tools-connectors | 1 | 3 | 4 | 1 | **9** | [`lab-use-cases-tools-connectors.md`](lab-use-cases-tools-connectors.md) |
| 11 | pipeline-team-memory-sharing-network | 1 | 3 | 4 | 1 | **9** | [`pipeline-team-memory-sharing-network.md`](pipeline-team-memory-sharing-network.md) |
| 12 | recipes-use-case-blueprints | 1 | 4 | 3 | 1 | **9** | [`recipes-use-case-blueprints.md`](recipes-use-case-blueprints.md) |
| 13 | settings-byom-engine-config | 1 | 3 | 4 | 1 | **9** | [`settings-byom-engine-config.md`](settings-byom-engine-config.md) |
| 14 | automations-deployment | 1 | 4 | 3 | 0 | **8** | [`automations-deployment.md`](automations-deployment.md) |
| 15 | incidents-manual-review-memories-knowledge | 1 | 3 | 3 | 1 | **8** | [`incidents-manual-review-memories-knowledge.md`](incidents-manual-review-memories-knowledge.md) |
| 16 | connector-catalog-mcp-gateways-recipes | 1 | 3 | 3 | 0 | **7** | [`connector-catalog-mcp-gateways-recipes.md`](connector-catalog-mcp-gateways-recipes.md) |
| 17 | execution-engine-healing-genome | 1 | 3 | 2 | 1 | **7** | [`execution-engine-healing-genome.md`](execution-engine-healing-genome.md) |
| 18 | schedules-cron-agents | 1 | 3 | 1 | 1 | **6** | [`schedules-cron-agents.md`](schedules-cron-agents.md) |
| 19 | tests-assertions-quality-gates | 1 | 2 | 2 | 1 | **6** | [`tests-assertions-quality-gates.md`](tests-assertions-quality-gates.md) |
| 20 | onboarding-home-simple-mode | 0 | 4 | 5 | 1 | **10** | [`onboarding-home-simple-mode.md`](onboarding-home-simple-mode.md) |
| 21 | agent-chat-sessions | 0 | 2 | 6 | 0 | **8** | [`agent-chat-sessions.md`](agent-chat-sessions.md) |
| 22 | companion-runtime-approvals | 0 | 4 | 3 | 1 | **8** | [`companion-runtime-approvals.md`](companion-runtime-approvals.md) |
| 23 | oauth-discovery-foraging-api-proxy | 0 | 2 | 2 | 1 | **5** | [`oauth-discovery-foraging-api-proxy.md`](oauth-discovery-foraging-api-proxy.md) |

---

## All 25 critical findings — one-liners (grouped by theme)

### A. i18n / `useTranslation` cascade (3 criticals) — **highest leverage, single fix bundle**
1. **i18n #1 — `useTranslation` subscribes to the WHOLE `useI18nStore`** — every component re-renders twice on language switch because `fontReady` flips alongside `language`. `useTranslation.ts:320`.
2. **i18n #2 — `useActiveI18nSections()` returns a fresh array on every render** — kills downstream `useMemo` dependencies in hundreds of consumers. `routeSections.ts:30-31`.
3. **i18n #3 — `useTranslation()` returns a fresh `{ t, language, tx }` object every render** — breaks every consumer that puts `t` in a dep array or passes it to a `React.memo`'d child. `useTranslation.ts:327-337`.

> *Subagent note: a ~30-line patch to `useTranslation.ts` + `routeSections.ts` resolves findings 1-5 of the i18n report together.*

### B. Realtime event-bus cascade (6 criticals, all paths) — second-highest leverage
4. **activity #1 — Realtime hub fires 3 state updates per backend tick** (`setEvents` + `setCapDroppedCount` + `setDataVersion`), causing 3 React commits per event. `useRealtimeEvents.ts:146-158`.
5. **activity #2 — Event-bus singleton fan-out has no rAF/microtask coalescing, no payload dedup**; iterates subscribers synchronously inside the Tauri listener. `createSingletonListener.ts:62-76`.
6. **activity #3 — `EventLogSidebar` does `events.slice(-200).map(...).reverse()` + `personas.find()` per entry per tick** — O(events × personas) every render. `EventLogSidebar.tsx:50-67`.
7. **build-sessions #1 — Every `BuildEvent` flush rebuilds full `ScalarsProjection` AND re-renders the full `GlyphFullLayout` subtree** (8 framer-motion petals). WeakMap cache always misses. `matrixBuildSlice.ts:483-499`.
8. **execution-engine #1 — Titlebar `ProcessActivityIndicator` re-renders on every telemetry tick of every run**; `enrichProcess`/`updateProcessStatus` spread fresh outer objects, defeating `useShallow`. Globally mounted, so every tool call repaints titlebar. `ProcessActivityIndicator.tsx:12-14`.
9. **pipeline #1 — `TeamCanvas` sync `useEffect` spreads every node into a fresh object on each `PIPELINE_STATUS` tick** — full canvas re-render for N=30-60 nodes several times/sec. `TeamCanvas.tsx:67-75`.
10. **trigger-studio #1 — `LiveStreamTab` rebuilds event-row list on every event, no virtualization**, 50-200 evt/s sustained bursts; pins frame budget. `LiveStreamTab.tsx:97-110,371-393`.

### C. Keystroke-rate over-work (3 criticals, editor/search inputs)
11. **persona-editor #1 — `preparationFingerprint` does `JSON.stringify` on every keystroke** in any field. `useEditorDraft.ts:48`.
12. **persona-editor #2 — `useEffectivePersona` re-allocates merged persona object per keystroke** (draft identity changes per `patch`), cascading full `PersonaEditorHeader` repaint. `useEffectivePersona.ts:21`.
13. **connector-catalog #1 — Catalog filter pipeline rebuilds 5 filtered arrays + popularity sort per keystroke against ~200 connectors, no debounce**. `usePickerFilters.ts:81-105`.

### D. Unvirtualized lists with large N (4 criticals)
14. **credential-vault #1 — `CredentialList` no row memoization, no virtualization** — every bulk healthcheck batch touches all rows; combines with 35+ scattered `fetchCredentials()` callers with zero in-flight dedup. `CredentialList.tsx:130`.
15. **recipes #1 — `RecipeList` renders all ~291 cards unvirtualized**; every search keystroke triggers full reconcile + JSON-parse pass across catalog. `RecipeList.tsx:75`.
16. **templates #2 — `ChronologyAdoptionView` re-parses `review.design_result` (fat IIFE) on every render** of the entire questionnaire/UC picker — fires on every keystroke in answers, every UC toggle, every credential change. `ChronologyAdoptionView.tsx:458-465`.
17. **deployment #1 — `UnifiedDeploymentDashboard` rebuilds row array + remounts sparkline computations on every selection toggle** (50 rows × 3 sparklines per click); `selectedIds` Set invalidates row equality, `useDeploymentHealth` recomputes O(N log N) per parent render. `UnifiedDeploymentDashboard.tsx:56`.

### E. Polling / IPC waterfall (3 criticals)
18. **schedules #1 — `useCronPreview` fans out N parallel `cron_fire_times_in_range` IPCs every render** because `entries` reference churns; every 30s poll, legend toggle, persona-filter change re-fires N IPCs. `useCronPreview.ts:153`.
19. **settings #1 — `AmbientContextPanel` polls 2 Tauri invokes every 5s as long as the Engine tab is mounted** (only idle-unmounts after 30s) — continuous background IPC + global Zustand churn even when user is on another settings tab. `AmbientContextPanel.tsx:71-79`.
20. **plugins (artist) #1 — Sequential per-asset IPC waterfall in `scanAndImport`**: `await artistImportAsset(asset)` inside a `for…of` loop — 500-file scan = ~5s freeze. `useArtistAssets.ts:40-43`.

### F. Algorithmic O(n²) / hot-path JSON parse (3 criticals)
21. **memories #1 — `detectConflicts` is O(n²) pair loop, re-tokenizes both strings per pair** — UI freeze in seconds on >500 memories, fires whenever `memories` store reference changes. `memoryConflicts.ts:84`.
22. **templates #1 — `computeAdoptionReadiness` raw `JSON.parse` of `design_result` for every loaded item on every credential save**, bypassing the existing `reviewParseCache`. `adoptionReadiness.ts:20`.
23. **analytics #2 — `PredictiveAlerts` calls `useTranslation()` inside a non-component helper invoked unconditionally each parent render** — hooks-rules violation + 4-pass scan across health signals per render of `PersonaHealthDashboard`. `PredictiveAlerts.tsx:42`.

### G. Lifecycle / dead-code bugs (1 critical)
24. **tests #1 — `startTest` flips `isTestRunning=true` but `usePersonaTests` (the only listener that flips it back) is never mounted anywhere** — Test button stuck for the 30-min safety timeout after every click. `testSlice.ts:70`.

### H. Per-tile hook-subscription cascade (1 critical)
25. **lab #1 — `RecipesVariantSigilGrid` renders 9 tiles, each with `TileModelStrip` + `TilePolicyToggles` → each calls `usePolicyControls(...)` → `useAgentStore(...)` with no `React.memo` and an unstable `items` array** — every store change cascade-re-renders all tiles + remounts Listbox listeners. `RecipesVariantSigilGrid.tsx:244-277`.

---

## Triage themes (10) — wave-fix groupings

Each theme below is one mental-model bucket — best handled in a single fix session of 5-7 atomic commits per the Pipeline-B wave rule. Listed in order of recommended attack.

| Theme | C | H+ | Why this is a wave, not isolated fixes |
|---|--:|--:|---|
| **A. i18n hook + selector triad** | 3 | ~5 | One file (`useTranslation.ts`) drives renders of HUNDREDS of components. Fixing the 3 criticals + 2 paired highs in one pass is the single highest-leverage change in the catalog. |
| **B. Realtime event-bus coalescing** | 6 | ~15 | Singleton fan-out, useRealtimeEvents 3-state, EventLogSidebar O(n²), TeamCanvas node spread, ProcessActivityIndicator titlebar, BuildSession scalars, LiveStreamTab. All share "Tauri event arrives → minimize work". |
| **C. Keystroke-rate over-work in editors** | 3 | ~7 | Persona Editor fingerprint+effective-persona, catalog filter, recipes lowercase-on-keystroke, agent-chat draft re-renders. Single mental model: "user types → minimize work per keystroke". |
| **D. Unvirtualized lists + write-then-refetch** | 4 | ~10 | CredentialList (50+ creds), RecipeList (291 cards), Incidents inbox (100 rows), DeploymentTable, LiveStreamTab. Plus `recipeSlice.ts` write-then-refetch anti-pattern + 35× scattered `fetchCredentials()` callers without dedup. Same fix family: `useVirtualList` + memo + consume mutation response. |
| **E. Polling / IPC discipline + lifecycle bugs** | 4 | ~6 | AmbientContextPanel 5s, useCronPreview N-fan-out, Artist scan waterfall, Tests stuck-state, Drive polling. All "tab-scoped lifecycle + IPC discipline" — same fix shape. |
| **F. Hot-path JSON parse cache discipline** | 2 | ~6 | computeAdoptionReadiness bypasses existing cache, ChronologyAdoptionView inline parse, OffspringCard genome parse, ApprovalCard paramsJson reparse on every chunk, EventLogSidebar tryParsePayload in render. One pattern: "cached parse; render reads cache". |
| **G. Selection / cascade-recompute components** | 2 | ~8 | UnifiedDeploymentDashboard, PredictiveAlerts, useDeploymentHealth, Health dashboard cascades. "User clicks → entire dashboard recomputes" pattern. |
| **H. Algorithmic O(n²) hotspots** | 2 | ~4 | memoryConflicts pair loop, useCalendarEvents derivation, LabEventStream deriveToolCallDurations, triggers sub_lineage canvas O(N²). Drop in Map-based lookups + memoize. |
| **I. Per-tile / per-row hook subscriptions** | 1 | ~4 | SigilGrid 9 tiles × hook, OffspringCard genome parse, Plugin browse page, RecipeCard inline, GitLab pipeline rows. "Lift store reads to the parent; pass props down". |
| **J. Process-activity & global Zustand churn** | 0 | ~6 | processActivitySlice consumed everywhere, enrichProcess outer-object replacement, healthCheckSlice fresh arrays, statsRef in useRealtimeEvents. Pair with B but separable. |

---

## Suggested 7-wave attack plan

Pipeline-B's hard rule: ≤7 fixes per wave, single mental model, atomic commit per fix, full quality-gate verification at end of wave.

| Wave | Theme | Findings | Why first/last |
|------|-------|----------|----------------|
| **1** | A — i18n triad | 3C + 2-3H (~5-6 commits) | Smallest blast radius, biggest payoff. Affects every component but the fix is concentrated in 2 files. Quality-gate-safe. |
| **2** | B — Realtime coalescing | 6C + 1H (~7 commits) | After Wave 1, every realtime tick costs less per subscriber. Adding rAF coalescing here compounds the win. |
| **3** | C — Keystroke-rate editors | 3C + 3H (~6 commits) | User-visible-jank class. PersonaEditor + catalog filter + chat thread. |
| **4** | D — Unvirtualize + write-then-refetch | 4C + 3H (~7 commits) | List rendering across 4 surfaces. Adopt `useVirtualList`; fix `recipeSlice` mutation pattern + `useCredentials` dedup. |
| **5** | E — Polling/IPC + lifecycle | 3C + 1C (tests bug) + 2H (~6 commits) | AmbientContextPanel/cron/artist/tests-stuck. All same shape: "what runs when component mounts and how long does it stay running". |
| **6** | F+G — Cascade-recompute + parse cache | 2C + 2C (templates) + 4H (~7 commits) | Touch UnifiedDeploymentDashboard, PredictiveAlerts, memoryConflicts, computeAdoptionReadiness, ChronologyAdoptionView, OffspringCard. |
| **7** | H+I+J — Algorithmic + per-tile + global churn | 1C (lab) + ~6H (~7 commits) | The remaining heavyweight findings; mental model has shifted to "look for fresh references in selectors and arrays-in-render". |

After Wave 7, the remaining ~64 medium + ~21 low findings can be batched into 2-3 "polish" waves OR skipped entirely depending on user-visible-jank reports.

---

## Known scope drift (Vibeman context-manager stale paths)

5 of 23 subagents reported that some of their assigned `filePaths` no longer exist on disk:

- **agent-chat-sessions**: 13 of 18 paths missing — `sub_chat/` was retired (commented out in `chatSlice.ts:283-286` — chat moved to companion). Subagent adapted by analyzing only the surviving slices + the orphaned `ChatThread.tsx`.
- **persona-crud-editor**: `src/features/agents/PersonasPage.tsx` does not exist; lives at `src/features/personas/PersonasPage.tsx`. Subagent substituted.
- **build-sessions-personamatrix**: `UnifiedMatrixEntry.tsx` → `UnifiedBuildEntry.tsx`; `useMatrixBuild.ts` → `useBuild.ts`.
- **templates-catalog-n8n-adoption**: `src/features/templates/i18n` does not exist; i18n lives globally in `src/i18n/section-locales/`.
- **activity-events-realtime-bus**: `src/features/overview/i18n` does not exist (same reason).
- **schedules-cron-agents**: `sub_cron_agents/` has a duplicate `CronAgentsPage.tsx` at feature root; only `components/` version is exported via `index.ts`.

**Action item for the Vibeman team**: the personas project's context-manager registry needs a refresh pass — these paths are 6-12 months stale. Same observation made in the 2026-05-12 code-refactor scan; still not addressed.

---

## How this scan was run

| Setting | Value |
|---|---|
| Pipeline | B — Scan + Triage + Wave-based fix |
| Scan agent | `perf-optimizer` (`src/lib/prompts/registry/agents/perf-optimizer.ts`) |
| Date | 2026-05-17 |
| Project | Personas (`personas-desktop` v0.1.0-1) |
| Project ID | `f8698d31-be3e-4806-9d33-972feaa49bc2` |
| Side scope | **Frontend only** (`src/` + `scripts/`); `src-tauri/` excluded |
| Wave size | ≤8 parallel general-purpose subagents |
| Waves | 3 (8 + 8 + 7) |
| Contexts scanned | 23 of 24 (skipped 1 garbage `x` context) |
| Findings target | 6-10 per context (relaxed to 4-6 for small contexts) |
| Total findings | 201 |
| Verification | Two-way: `^> Total: N findings` headers summed = 201; `^- **Severity**:` bullets counted = 201 ✓ |

### Baseline (preserved through all waves — see `BASELINE.md`)
- `tsc --noEmit`: **0 errors**
- `eslint --quiet src/`: **0 errors**
- `vitest run`: **1412/1416 passing** (4 pre-existing failures in `useLifecycle.test.ts`)
- git HEAD: `329409f4a7949ecfa441f9e23f26f04e7993b0d2`

### File layout under this directory
- `INDEX.md` (this file) — triage entry point
- `BASELINE.md` — health snapshot to preserve across waves
- `<context>.md` × 23 — per-context perf reports (cite these in fix-wave commits)
- `_dispatch.json` — subagent dispatch manifest (frontend-only filtered)
- `_findings.json` — parsed criticals/highs catalog (mechanically extracted from the per-context reports)
- `FIXES-WAVE-<N>.md` — written after each fix wave completes (one per wave)

### Replay / continue
Future sessions resume by reading this INDEX, the relevant per-context report(s), and any prior `FIXES-WAVE-*.md` files. Wave plan above sequences the work; the user can override per-wave scope at the Phase-B6.1 ask.
