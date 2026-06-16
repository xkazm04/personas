# Bug Hunter — Personas Twin

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: personas-twin | Group: First-Party Plugins

## 1. Shared `twinPendingMemories` slice is status-filtered by whoever fetched last, silently corrupting the readiness score
- **Severity**: Critical
- **Category**: Silent failure / latent desync
- **File**: `src/features/plugins/twin/useTwinReadiness.ts:90-94` (consumer); `src/stores/slices/system/twinSlice.ts:469-479` (overwrite); `src/features/plugins/twin/sub_brain/RejectionPatternsPanel.tsx:35` and `src/features/plugins/twin/sub_knowledge/KnowledgeAtelier.tsx:103` (poisoning writers)
- **Scenario**: `useHydrateActiveTwin` seeds `twinPendingMemories` with `fetchPending(activeTwinId, 'approved')`. Readiness then computes `memoriesApproved = memories.filter(m => m.status === 'approved').length`. But `fetchTwinPendingMemories` does a wholesale `set({ twinPendingMemories })` with whatever status filter the *last* caller passed. Open the Brain tab → `RejectionPatternsPanel` fetches `'rejected'`; the slice now holds only rejected rows. Open Knowledge with the pending filter → only pending rows. The readiness derivation re-runs over that subset.
- **Root cause**: One global slice (`twinPendingMemories`) is reused as both the full-corpus source for readiness math and a per-panel filtered view; the fetch replaces, not merges, and carries no record of which filter produced it.
- **Impact**: After visiting Brain or Knowledge, `memoriesApproved` collapses to 0, the `memories` milestone silently flips `complete`→`empty`, and the readiness score in every TwinHeaderBand ribbon drops by ~8–17 points for data that is fully intact. A twin that earned 100 reads as e.g. 83. Worse, the score *drop* is not a celebration so it just looks like the twin regressed. Pure readiness-is-silently-wrong failure.
- **Fix sketch**: Either give readiness its own dedicated `twinApprovedMemoriesCount` source (separate store field / selector fetched only with `'approved'`), or key the slice by status (`twinPendingMemoriesByStatus[status]`) so panels and readiness read disjoint buckets. Do not let a filtered panel fetch overwrite the corpus readiness depends on.

## 2. `useReadinessCelebration` cross-twin baseline poisoning + missed celebration on slow hydration
- **Severity**: High
- **Category**: Race condition / success theater
- **File**: `src/features/plugins/twin/useReadinessCelebration.ts:33-53`
- **Scenario**: Two failure modes from the same arming logic. (a) The re-arm effect (`[activeTwinId]`) and the score-tracking effect (`[readiness.score, ...]`) are independent. On a twin switch, React may flush the score effect (recording the *new, still-0* score into `prevScoreRef`) before/after the re-arm effect resets it, and the 2.5s `HYDRATION_WINDOW_MS` is a fixed guess. If the per-layer fetches for a rich twin land *after* 2.5s (slow disk / cold IPC / many channels), `armedRef` is already true and `prevScoreRef` holds the early ramp value, so the late jump from 30→100 fires a bogus "milestone closed!" toast for a twin the user merely *switched to*. (b) Conversely, if hydration finishes inside the window, the genuine final score is recorded as the silent baseline and a real subsequent improvement that coincides with the window boundary can be swallowed.
- **Root cause**: Celebration correctness depends on a hardcoded wall-clock window racing an unbounded async hydration burst, with two effects sharing mutable refs and no signal that "hydration is actually done."
- **Impact**: False success toasts on twin switch (success theater) and occasionally missed real celebrations. Erodes trust in the readiness cue.
- **Fix sketch**: Drive arming off a real "hydration settled" signal (e.g. all four `*Loading` flags fall to false for the active twin) rather than a timer, and gate both refs on `activeTwinId` matching so a late fetch for the previous twin can't seed the new twin's baseline.

## 3. Picker `onSelect` fires for the already-active twin and races concurrent selections with no in-flight guard
- **Severity**: High
- **Category**: Race condition
- **File**: `src/features/plugins/twin/shared/TwinPicker.tsx:176,237`; `src/stores/slices/system/twinSlice.ts:383-392`
- **Scenario**: `onSelect(p.id)` is called unconditionally — including when `p.id === activeTwinId` — which routes to `setActiveTwin`, issuing a needless `twin_set_active_profile` + forced `fetchTwinProfiles`. More seriously, `setActiveTwin` has no in-flight latch: a user (or autorepeat Enter, or double-click) can fire it twice for different ids. Each `await setActiveProfile(id)` then `await fetchTwinProfiles({ force: true })`; the two refetches can resolve out of order, and the SQLite `set_active_profile` transactions interleave so the last-write-wins row may not match the last `activeTwinId` the UI thinks it picked. `fetchTwinProfiles`'s 10s freshness window doesn't help because both calls pass `{ force: true }`.
- **Root cause**: No equality short-circuit and no per-action concurrency guard; the active twin is derived by re-reading `is_active` from a refetch rather than set authoritatively from the returned row.
- **Impact**: Redundant IPC/DB churn on no-op reselect; on rapid switching the selector banner, readiness ribbon, and all hydrated layers can settle on a *different* twin than the one the user last clicked — a desync that persists until the next manual refetch.
- **Fix sketch**: Early-return in `setActiveTwin` when `id === get().activeTwinId`; add an in-flight guard (ignore/queue while a switch is pending) and set `activeTwinId` from the returned profile row instead of relying on the racey refetch's `is_active` scan.

## 4. CoachMark hydration race renders a one-frame flash and re-shows a just-dismissed mark on `id` change
- **Severity**: Medium
- **Category**: Race condition / edge case
- **File**: `src/features/plugins/twin/CoachMark.tsx:24-40`
- **Scenario**: State starts `dismissed = true`, then a `useEffect` keyed on `[id]` reads localStorage and may flip it to `false`. Between the first paint and the effect there is a frame where a never-dismissed mark is hidden then appears (flash). The inverse is worse: if a parent reuses one `<CoachMark>` instance and swaps the `id` prop (common when the same component renders per-subtab), the effect re-runs and *resets* `dismissed` from the new id's storage — but if the user just dismissed the previous id, the handler set state + storage for the *old* key while the effect now reads the *new* key, so a brand-new mark correctly appears, yet on a fast id-flip back the stale `dismissed=true` from the prior render can briefly suppress a mark that should show. The read also has no cross-render guard, so two marks mounting in the same tick both touch storage independently.
- **Root cause**: Dismissal state is hydrated asynchronously in an effect instead of via a lazy initializer, so the render output lags the source of truth by a frame and is re-derived on every `id` change.
- **Impact**: Visible flicker on first visit to a subtab; under reduced-motion / screen-reader use the `role="note"` appears then vanishes, announcing transient content. Low data risk but a real UX-correctness defect for the coach-mark surface.
- **Fix sketch**: Hydrate with a lazy `useState(() => readDismissed(id))` initializer (guarded for SSR) so first paint already reflects storage, and drop the hydrate effect — or key the whole component on `id` from the parent so each id gets a fresh instance.

## 5. `TwinPicker` is fully built but wired into nothing — empty-state + stale-list paths are dead code that will rot
- **Severity**: Low
- **Category**: Latent failure / silent gap
- **File**: `src/features/plugins/twin/shared/TwinPicker.tsx:88` (no importer anywhere in `src/`)
- **Scenario**: A repo-wide search for `import ... TwinPicker` / `<TwinPicker` returns zero hits — the component's docstring says it "replaces the native `<select>` twin dropdown in TwinSelector," but no `TwinSelector` consuming it exists. Its careful edge-case handling (empty `profiles` → "no matches", active-pinned ordering, recency sort, pin persistence) is therefore never exercised at runtime. Because it's unreferenced, its props (`activeTwinId`, `onSelect`, `onCreateNew`) drift out of sync with the live selection flow (`setActiveTwin`), and the readiness/desync issues above are *not* mitigated by the picker even though it appears to be the intended UI.
- **Root cause**: Ship-half-done: the picker landed without its host wiring (the "built-but-unwired" pattern flagged in prior scans), so the safer dropdown is dormant while the app still uses the older path.
- **Impact**: No live bug today, but the empty-picker / stale-list defenses give a false sense of coverage, the code can't be regression-tested in situ, and a future wire-up will surface the no-op-reselect and double-select races (finding #3) that were never hit because the component is dark.
- **Fix sketch**: Either wire `TwinPicker` into the actual twin selector (passing `activeTwinId` from the store and routing `onSelect`→`setActiveTwin` with the #3 guards) or remove it; do not leave a second, divergent selection surface unreferenced.
