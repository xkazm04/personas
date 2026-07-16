# plugins/radio — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Plugins & Companion | Files read: 14 | Missing: 0

## 1. Dismiss-on-outside-click/Escape effect triplicated across three popovers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/radio/components/NowPlayingCard.tsx:65 (also VolumePopover.tsx:23, StationPicker.tsx:65)
- **Scenario**: NowPlayingCard, VolumePopover, and StationPicker each hand-roll the same `mousedown`-outside + `Escape` document-listener effect. Any behavior fix (e.g. switching to `pointerdown`, capture-phase, or focus-return on close) must be replicated in three places; StationPicker's copy already had to grow context-menu special-casing, showing the pattern diverging.
- **Root cause**: No shared dismissable-popover hook in the feature; each popover was written independently.
- **Impact**: ~40 duplicated lines and a real drift hazard — a future fix to one popover's close behavior silently misses the other two.
- **Fix sketch**: Extract a `useDismiss(ref, onClose, opts?)` hook (in the radio feature or `features/shared/hooks` if one doesn't already exist app-wide — verify cross-context; other Personas popovers likely repeat this too). StationPicker keeps its context-menu guard by passing a `shouldClose` predicate or by intercepting in its own `onClose`.

## 2. `formatTime` and the YouTube progress-bar block duplicated between footer and card
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/radio/components/RadioFooter.tsx:43 (dup of NowPlayingCard.tsx:22)
- **Scenario**: `formatTime` is byte-identical in RadioFooter.tsx:43-47 and NowPlayingCard.tsx:22-26, and the `Math.min(100, current/duration*100)` accent-colored progress-fill markup appears in both (RadioFooter.tsx:678-695, NowPlayingCard.tsx:154-170). StationPicker.tsx:104 also reimplements the `trackCount` logic that already exists as a shared helper in radioManageShared.tsx:66.
- **Root cause**: Small helpers copied instead of hoisted to a feature-level util when NowPlayingCard was split out of the footer.
- **Impact**: Bounded — small functions — but three separate spots to touch if time formatting (e.g. hour support for long mixes) or the progress styling changes.
- **Fix sketch**: Move `formatTime` to a `lib/formatTime.ts` (or the feature's own `utils.ts`), import in both components; import `trackCount` from radioManageShared in StationPicker. Optionally extract a tiny `TrackProgressBar` component shared by footer strip and card.

## 3. `refreshNowPlaying` side effect fired inside the `setSnap` updater
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: side-effect-in-updater
- **File**: src/features/plugins/radio/hooks/useRadioState.ts:70
- **Scenario**: The `radio:state` listener calls `setSnap((prev) => { ... refreshNowPlaying(); return next; })` — an async IPC call launched from inside a state updater. React is free to invoke updaters more than once (and does under StrictMode dev double-invocation), so a single backend event can trigger duplicate `radio_get_now_playing` IPC round-trips; with two hook instances mounted (footer + settings page) that multiplies further.
- **Root cause**: The stale-`prev` comparison was solved by moving the trackKey check into the updater, dragging the side effect in with it.
- **Impact**: Redundant IPC calls on every track change and each racing response causes an extra `setSnap` → extra render of the whole footer. Also a purity violation that React's dev tooling flags.
- **Fix sketch**: Keep the latest state in a ref (`stateRef.current = snap.state` or updated inside the listener), compare `trackKey(stateRef.current)` vs `trackKey(event.payload)` outside the updater, then `setSnap` with the new state and call `refreshNowPlaying()` after. Updater stays pure; fetch fires exactly once per event.

## 4. Two independent `useRadioState` subscriptions when Settings → Radio is open
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: duplicate-subscription
- **File**: src/features/plugins/radio/hooks/useRadioState.ts:38 (consumers: RadioFooter.tsx:94, RadioPage.tsx:19)
- **Scenario**: RadioFooter and RadioPage each mount their own `useRadioState`, so with the settings tab open there are two `radio:state` Tauri listeners, two initial `Promise.all([getRadioState, getNowPlaying, listStations])` triple-fetches, and every backend state event (emitted on each play/pause/volume/status report — volume drags emit rapidly) does the trackKey compare and potential `getNowPlaying` refetch twice. Notably useStationPreview's docstring explicitly avoids "a second radio:state listener per page", but the page-level hook instance reintroduces exactly that next to the always-mounted footer.
- **Root cause**: Snapshot state lives per-hook-instance instead of in a shared module-level store/singleton.
- **Impact**: Bounded (2×) but on a chatty event stream: doubled IPC on every station/track change while auditioning stations — which is precisely when the settings page is open.
- **Fix sketch**: Back the hook with a module-level singleton (subscriber-count-managed listener + cached snapshot, `useSyncExternalStore`), or fold radio state into the existing Zustand systemStore slice. Consumers keep the same `useRadioState()` API.

## 5. Progress poll re-renders the entire footer every second during YouTube playback
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/radio/components/RadioFooter.tsx:487
- **Scenario**: The 1s poll calls `setProgress` at RadioFooter's top level, so while a YouTube station plays, the whole footer widget (transport buttons, TitleCrossfade, volume cluster, plus NowPlayingCard when expanded, including its full tracklist map) re-renders every second even though only the thin progress bar's width changed.
- **Root cause**: `progress` state is hoisted to the controller component that owns everything, rather than scoped to the two small progress-bar consumers.
- **Impact**: Small absolute cost (the tree is compact) but it is a permanent once-per-second render on an always-mounted surface for the app's lifetime; the tracklist `<ul>` re-map in the open card is the heaviest repeat.
- **Fix sketch**: Cheapest: memoize NowPlayingCard's tracklist section (or the card's non-progress children) with `React.memo`/`useMemo`. Fuller: move progress polling into a tiny `useYtProgress(ytHandle, active)` hook consumed by a dedicated `ProgressBar` child, keeping the parent free of per-second state (the every-5th-tick backend report can live in the same hook).
