# Perf-Optimizer Scan — First-Party Plugins

> Project: Personas (frontend-only)
> Scope: 22 paths in src/
> Total: 13 findings (1 C / 7 H / 4 M / 1 L)

## Scope notes

- Sampled plugins (hot files actually read): **artist** (Gallery2D, AssetCard, GalleryPage, useArtistAssets, useLocalImage), **drive** (DriveFileList, useDrive, DriveSidebar, DriveToolbar, DriveDetailsPane, DrivePage, api/drive.ts), **obsidian-brain** (GraphPanel, SyncPanel, BrowsePanel, CloudSyncPanel), **twin** (ProfilesAtelier, useProfileDashboards, BrainAtelier, useBrainConnection, twinSlice), **research-lab** (sub_graph/GraphPanel, graphLayout, ResearchDashboard, LiteratureSearchPanelAtelier, researchLabSlice), **gitlab** (GitLabPipelineViewer, usePipelineNotifications, gitlabSlice).
- Skipped (deferred to time budget): dev-tools (`sub_runner/TaskRunnerPage.tsx` 790 LOC, `sub_scanner/IdeaScannerPage.tsx` 665 LOC) — these belong logically to dev-tools/audit scope, not "first-party plugin ecosystem"; artist `sub_media_studio/*` (timeline editor, deserves its own pass); twin `sub_channels`, `sub_tone`, `sub_voice`, `sub_knowledge`, `sub_training`; research-lab `sub_experiments`/`sub_findings`/`sub_hypotheses`/`sub_reports`/`sub_projects`.
- Scope drift: the assigned path `src/api/system/gitlab` does not exist — the gitlabSlice imports from `@/api/system/gitlab` (so it does exist as a module, just under a different relative tree) but the slice itself is in the scope. No "src/api/devTools" exists either (it's `src/api/devTools/` directory — confirmed). `src/api/artist`, `src/api/twin`, `src/api/researchLab`, `src/api/obsidianBrain`, `src/api/ocr`, `src/api/signing` all exist.

---

## 1. Artist scan-and-import is a sequential N-per-file IPC waterfall  [plugin: artist]
- **Severity**: critical
- **Category**: async-coordination
- **File**: `src/features/plugins/artist/hooks/useArtistAssets.ts:40-43`
- **Scenario**: User clicks "Scan folder" on a directory with 500 image/3D files. `scanAndImport` `await`s `artistImportAsset(asset)` in a `for…of` loop — each IPC roundtrip blocks the next. At ~10 ms per Tauri invoke this is ~5 s wall-clock even when the backend would happily ingest in parallel; the UI shows a spinning icon the entire time and no progress.
- **Root cause**:
  ```ts
  for (const asset of scanned) {
    const result = await artistImportAsset(asset);
    if (result !== null) imported++;
  }
  ```
- **Impact**: Linear-with-asset-count freeze of the Artist page; first impression for any photographer / 3D artist importing a real library is "the app hangs." Subsequent `loadAssets()` then fires a single `artistListAssets()` IPC that returns everything imported, so the per-asset roundtrip is pure waste — could be a single bulk-import command or, at minimum, a bounded-parallel pool (see `drive`'s `runBulk` with `BULK_OP_CONCURRENCY = 8` which already exists in the same codebase).
- **Fix sketch**: Mirror the `runBulk` pattern from `useDrive.ts:67-88`: cap at 8 concurrent `artistImportAsset` calls, expose progress (`imported / scanned.length`) via state so the button can show "Importing 42/500…". Better: add a backend `artist_bulk_import` taking the full scanned array and returning the count.

## 2. Obsidian browse-tree filter calls O(n) recursive `matchesFilter` ~3× per node per render  [plugin: obsidian-brain]
- **Severity**: high
- **Category**: algorithmic
- **File**: `src/features/plugins/obsidian-brain/sub_browse/BrowsePanel.tsx:17-22, 31-37`
- **Scenario**: User types in the vault filter on a vault with thousands of notes (`obsidianBrainListVaultFiles` returns the entire tree client-side). For every keystroke React re-renders the tree; each `TreeItem` calls `matchesFilter(node, filter)` **inside a `useEffect`** (line 33), **inside `useState` initializer** (line 31), AND **inside the early-return guard** (line 37). Each call recursively walks the entire subtree. With a fan-out of N nodes, render cost is O(N²) per keystroke.
- **Root cause**: No memoization of filter results — each TreeItem independently re-walks its subtree multiple times per render. The recursion has no path-caching.
- **Impact**: 3000-note Obsidian vault on a typed character → ~9M operations; janky, freezing search input. The vault tree is also the centerpiece of the plugin.
- **Fix sketch**: Compute one filtered tree at the top (`useMemo` on `[tree, filter]`) producing a `Set<string>` of paths that match, then `TreeItem` checks `matchSet.has(node.path)` in O(1). Or memoize `matchesFilter` per `(node.path, filter)` with a `WeakMap` keyed on the node ref.

## 3. `useProfileDashboards` issues N × 4 IPC calls (no batching, no dedup across renders)  [plugin: twin]
- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/features/plugins/twin/useProfileDashboards.ts:42-86`
- **Scenario**: ProfilesAtelier mounts with 20 twin profiles → 80 parallel Tauri invokes (`listTones`, `listChannels`, `getVoiceProfile`, `listPendingMemories`) burst at once. Tauri IPC serialises through a single thread on the renderer side; the burst saturates the queue while the user is waiting on the readiness arcs to populate.
- **Root cause**: Comment claims "fan-out in parallel" but there's no concurrency cap — `for (const p of profiles) void loadOne(p)` kicks off `4×profiles.length` promises with no throttle. Also, the `loadedRef` gate is per-mount: navigating away from the Profiles tab and back re-runs everything because the hook unmounts and `loadedRef.current.clear()` (well, it survives, but if the component remounts the ref is fresh).
- **Impact**: ProfilesAtelier and any future ProfilesBaseline/Console render slowly on first paint; rosters of 10+ twins (realistic for "personas-as-fleet" UX) compound this.
- **Fix sketch**: (a) Cap parallelism via `runBulk`-style pool, e.g. 5 profiles in flight. (b) Add a single `twin_list_dashboards_for(twinIds: string[])` backend command that returns all four bundles in one IPC. (c) Lift the cache out of component state into a module-level Map so cross-mount visits hit cache.

## 4. Drive `visibleEntries` re-sorts the entire entry array on every entry/selection touch  [plugin: drive]
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/plugins/drive/hooks/useDrive.ts:429-472`
- **Scenario**: A drive folder with 5000 entries. `visibleEntries` is `useMemo`d on `[entries, searchQuery, sortKey, sortDir]` — fine for those — but the sort comparator for `kind` calls `visualForEntry(a)` AND `visualForEntry(b)` per comparison (line 461-462). That's O(N log N × 2) visual-resolution calls per recompute. Also, the comparator path for `name` builds `a.name.toLowerCase()` repeatedly on each comparison (N log N times per name).
- **Root cause**: No comparator-key precomputation. Same issue for `kind` (computes the bucket weight via `visualForEntry` mapping per comparison). For 5000 entries that's ~120k `.toLowerCase()` calls per re-sort.
- **Impact**: Sort-key change, search-query keystroke, or any entry-array refresh stutters on large folders. Drive is a hot UX surface and the user-perceptible threshold (~16 ms) is exceeded at ~3-4k entries on a mid-tier laptop.
- **Fix sketch**: Decorate-sort-undecorate: build `[{ entry, lowerName, bucketWeight }, …]`, sort once, then strip. Or memoize `_sortKey` precomputed per entry inside a separate `useMemo` keyed only on `entries`.

## 5. Drive `useDrive` returns a fresh result object literal on every render (re-render storm)  [plugin: drive]
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/plugins/drive/hooks/useDrive.ts:613-675`
- **Scenario**: `useDrive()` returns a `UseDriveResult` object built with bare `{ … }` literal at the bottom. It's never `useMemo`d. Every render of `DrivePage` (e.g. on any state change — drag counter, dialog open, context menu coords) constructs a fresh `drive` reference and passes it to `DriveToolbar`, `DriveSidebar`, `DriveFileList`, `DriveDetailsPane`, `DriveContextMenu`. None of those are `memo()`'d, so each re-renders. Each then re-derives sub-things from the fresh `drive` (e.g. `singleSelectedEntry` `useMemo` in toolbar depends on `[drive.selection, drive.visibleEntries, …]` — but those primitive props change identity every render too).
- **Root cause**: A custom monster-hook returning a 20+ field POJO with no stable identity. The downstream `useEffect`/`useMemo` chains all key on the contained references, which are themselves stable, but the *container* changes — and since the hook is consumed once at the top, the re-render fanout is unavoidable without memoisation.
- **Impact**: Every Drive UI interaction (open dialog, change drag count) re-renders the entire Drive subtree, including the 5000-row list view from finding #4. Compounding effect.
- **Fix sketch**: Return a memoised object (`useMemo(() => ({...}), [...all the bits])`), then `memo()` `DriveFileList`/`DriveSidebar`/`DriveToolbar`. Or split `useDrive` into multiple small hooks (`useDriveSelection`, `useDriveSort`, `useDriveClipboard`) so each consumer subscribes to only what changes.

## 6. Research-lab GraphPanel re-filters per kind per render (5× full-array `.filter()`)  [plugin: research-lab]
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/plugins/research-lab/sub_graph/GraphPanel.tsx:93-99`
- **Scenario**: GraphPanel has a `toggles` array built **inline in render body** (not memoised) that filters each of sources/hypotheses/experiments/findings/reports by project ID just to compute toolbar counts. With a project that has 100 sources + 50 hypotheses + 50 experiments + 200 findings + 30 reports, that's ~430 array walks per render. The graph also re-`buildGraph` on `[project, sources, hypotheses, experiments, findings, reports, visible]` — the `sources` array reference changes every time the slice mutates anything in `researchLabSlice` because every CRUD path does `s.researchSources.map(...)` returning fresh arrays.
- **Root cause**: Unmemoised toggles (line 93-99); no per-project pre-filtered selectors in the slice; `buildGraph` rebuilds React Flow node/edge arrays on every render of the parent component, blowing through ReactFlow's reconciliation.
- **Impact**: Graph view with a moderate project (~300 entities) stutters on every store update (new finding, new hypothesis) — the entire graph re-lays out.
- **Fix sketch**: `useMemo` the per-kind filtered slices once; key all derived structures on those memos. Pre-filter at the slice level with a `getProjectEntities(projectId)` selector. Memoise toggles by `t` only.

## 7. Drive recursive search results not paginated / not virtualised  [plugin: drive]
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/plugins/drive/components/DriveFileList.tsx:971-1015`, `src/features/plugins/drive/hooks/useDrive.ts:296-309`
- **Scenario**: `runRecursiveSearch` calls `driveSearch(q)` with no `maxResults` cap (the API accepts one but the call passes none → backend default). Results render as a flat `results.map((hit) => <RecursiveResultRow ...>)` — no virtualisation, no pagination. A search for `.png` on a 50k-file managed drive returns the entire matching set into the DOM.
- **Root cause**: `useDrive.ts:301`: `const results = await driveSearch(q);` — no limit. `DriveFileList.tsx:1009`: direct `.map()` render. `FileChip` + `RecursiveResultRow` are not memoised; each row reads context (`useTranslation()`) twice — once in the row, once via `FileChip` no, but on row count this still adds up.
- **Impact**: Single search keystroke producing 10k+ hits → 10k+ DOM nodes; main-thread freeze ~3-5 s plus high memory.
- **Fix sketch**: Pass `maxResults: 200` (or surface as a setting); virtualise the result list (the project already uses react-window elsewhere for chat history per the BASELINE.md mention); memoise `RecursiveResultRow`.

## 8. Gallery2D grid renders all assets at once (no virtualisation, all thumbnails decode)  [plugin: artist]
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/plugins/artist/sub_gallery/Gallery2D.tsx:98-112`, `src/features/plugins/artist/sub_gallery/AssetCard.tsx:86`
- **Scenario**: GalleryPage filters/sorts assets then renders `<Gallery2D assets={filtered} />` which `.map`s every asset to an `AssetCard`. Every AssetCard mounts a `useLocalImage(asset.filePath)` hook — even off-screen cards immediately issue a Tauri IPC for the base64 thumbnail. With 2000 images, that's 2000 IPC calls on tab open. `useLocalImage` does have a 300-entry LRU cache (line 10) so memory is bounded, but the IPC burst still happens because there's no off-screen gating.
- **Root cause**: No windowing/virtualisation; `loading="lazy"` on the `<img>` only defers network/decode of the *image*, not the upstream IPC fetch. `useLocalImage` fires the invoke unconditionally on mount.
- **Impact**: Opening Gallery with a real-world library (1k–5k assets) stalls the IPC thread for everything else in the app for many seconds; the 300-entry cache means 1700+ assets re-fetch when scrolled.
- **Fix sketch**: Virtualise the grid (react-window/react-virtual). Better: drive the thumbnail IPC with an IntersectionObserver inside `AssetCard` so off-screen cards stay in a `null` state. Even simpler interim: chunk render with `useDeferredValue` and only mount 200 cards at a time.

## 9. GraphPanel (obsidian) starts/stops vault watcher on every `loadStats` identity change  [plugin: obsidian-brain]
- **Severity**: medium
- **Category**: async-coordination
- **File**: `src/features/plugins/obsidian-brain/sub_graph/GraphPanel.tsx:79-102`
- **Scenario**: `useEffect` depends on `[connected, activeVaultPath, loadStats]`. `loadStats` is `useCallback`d with `[addToast]` — `addToast` is selected via `useToastStore((s) => s.addToast)`, which is identity-stable across renders only if the store keeps the same function reference. If addToast is ever recreated (e.g. selector returns a fresh closure), the effect re-fires → stops backend watcher → starts it again → re-walks the vault on the next event. The cleanup also unconditionally calls `obsidianGraphStopWatcher` even when the user merely tabs away momentarily — meaning the next mount re-walks the vault from scratch (potentially expensive on a 5k-note vault).
- **Root cause**: Over-broad effect deps + unconditional watcher restart. The 800 ms debounce on the listener side is fine, but it doesn't compensate for full watcher tear-down/re-init.
- **Impact**: Spurious vault scans, latent backend CPU spikes, occasional UI lag while stats re-load.
- **Fix sketch**: Pull `addToast` via `useToastStore.getState().addToast` lazily inside the handler, so it doesn't enter the dep array. Or separate watcher lifecycle into a dedicated effect with `[connected, activeVaultPath]` deps only.

## 10. SyncPanel re-fetches sync log via raw promise chain on every action  [plugin: obsidian-brain]
- **Severity**: medium
- **Category**: duplicate-call
- **File**: `src/features/plugins/obsidian-brain/sub_sync/SyncPanel.tsx:77, 105`
- **Scenario**: After every `pushSync` and `pullSync`, the code fires `obsidianBrainGetSyncLog(50)` again with a fire-and-forget promise. There's no debounce — if the user mashes "Push" then "Pull" in quick succession, two overlapping `getSyncLog(50)` invocations land out-of-order; the last `then(setSyncLog)` wins regardless of which started first. Also fires on initial mount with `[connected, activeVaultPath]` deps but `loadStats`/sync-log endpoints are unrelated — switching vaults re-fetches even when the panel didn't change.
- **Root cause**: No abort/dedupe; lost-update race possible on rapid clicks.
- **Impact**: Stale-log flicker, redundant IPC. Low frequency in practice but ugly under stress.
- **Fix sketch**: Track an `AbortController` ref for the sync-log fetch; abort prior request before issuing a new one. Or guard with a request-counter token.

## 11. GitLab `usePipelineNotifications` reads localStorage + JSON.parse on every pipelines change  [plugin: gitlab]
- **Severity**: medium
- **Category**: data-layer
- **File**: `src/features/plugins/gitlab/hooks/usePipelineNotifications.ts:102-106`
- **Scenario**: `loadPipelineNotificationPrefs()` is called *inside* the `useEffect` that fires on every `pipelines` change. With `usePolling` driving `gitlabRefreshPipeline` while a pipeline is running (per `GitLabPipelineViewer.tsx:59-62`), the `pipelines` array reference changes every ~5-10 seconds (the slice does `state.gitlabPipelines.map(...)` returning a fresh array on `gitlabRefreshPipeline`). Each tick triggers a synchronous `localStorage.getItem` + `JSON.parse`. localStorage reads block the main thread.
- **Root cause**: Reads-on-hot-path of cold settings.
- **Impact**: Minor sustained main-thread blocking while a CI pipeline is running. ~1-3 ms per tick — adds up over a long pipeline.
- **Fix sketch**: Move `loadPipelineNotificationPrefs()` outside the effect into a `useRef` initialised once, or into a `useMemo([])`. Re-load only when prefs are mutated (via custom event or store subscription).

## 12. `gitlabSlice.gitlabInitialize` does a `storeBus.get` synchronously inside an action, then mutates  [plugin: gitlab]
- **Severity**: medium
- **Category**: async-coordination
- **File**: `src/stores/slices/system/gitlabSlice.ts:160-196`, also `:271-275, :467-471`
- **Scenario**: `gitlabInitialize` reads vault credentials via `storeBus.get<...>(AccessorKey.VAULT_CREDENTIALS)`. The bus accessor isn't necessarily registered yet (the comment at line 178 acknowledges this), so on cold-boot the function silently bails. But on every subsequent `gitlabDeployPersona` call, `storeBus.get<Persona[]>(AccessorKey.AGENTS_PERSONAS)` returns the **whole personas array**, which the code linearly searches with `.find((p) => p.id === personaId)`. With a fleet of 200 personas this is O(N) per deploy.
- **Root cause**: No memoised persona-by-id lookup; storeBus accessor returns full snapshot.
- **Impact**: Minor today; will degrade as fleet scales.
- **Fix sketch**: Have `storeBus` expose a `getPersonaById` accessor; or memoise a `Map<personaId, Persona>` derived from the personas array in agent store.

## 13. PluginBrowsePage rebuilds full `PLUGINS` array on every render  [plugin: other]
- **Severity**: low
- **Category**: re-render
- **File**: `src/features/plugins/PluginBrowsePage.tsx:21-30`
- **Scenario**: The 8-entry PLUGINS array (with icon refs, translations, color strings) is constructed inside the component body. Each toggle of `enabledPlugins` re-renders the component and rebuilds the array, allocating 8 fresh object literals + the array itself. Since the inner `.map((plugin) => ...)` creates 8 button DOM trees with fresh callback identities, React reconciliation runs even when only one plugin's enabled-state changed.
- **Root cause**: Trivial — but the file is the user's first impression of the plugins UI. The translation function `t` is the only real reason it can't be hoisted to module scope, but `useMemo([t.plugins])` would do.
- **Impact**: Negligible at 8 plugins, but the page is the documented "browse plugins" surface and the pattern propagates.
- **Fix sketch**: `const PLUGINS = useMemo(() => [...], [t.plugins])`; or split each plugin tile into a `memo()`'d sub-component keyed on `{ plugin, enabled, toggle }`.
