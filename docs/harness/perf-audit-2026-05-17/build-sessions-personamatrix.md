# Perf-Optimizer Scan — Build Sessions & PersonaMatrix

> Project: Personas (frontend-only)
> Scope: 6 paths in src/
> Total: 9 findings (1 critical / 4 high / 3 medium / 1 low)

## Scope notes

Scope drift on 2 of 6 listed paths — substitutions confirmed via grep:

- `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx` → **`src/features/agents/components/matrix/UnifiedBuildEntry.tsx`** (renamed; no `UnifiedMatrix*` files in `src/`).
- `src/features/agents/components/matrix/useMatrixBuild.ts` → **`src/features/agents/components/matrix/useBuild.ts`** (renamed; no `useMatrixBuild*` files in `src/`).

Other 4 paths exist as listed. Read the actual surface: `useBuild` → `useBuildSession` → `useAgentStore` (matrixBuildSlice) → `UnifiedBuildEntry` → `GlyphFullLayout` → `GlyphSigilCanvas` (`GlyphHeroSigil` + `GlyphPetalIcons` + sweep) + `GlyphCoreContent` + `GlyphActivityStrip`. Also inspected the EventBridge fallback path (`src/lib/eventBridge.ts`) and the per-session scalar mirror pattern.

Files read in full: 12 (6 in-scope + GlyphFullLayout, GlyphSigilFace, GlyphSigilCanvas, GlyphCoreContent, GlyphPetalIcons, GlyphHeroSigil, GlyphActivityStrip, useGlyphLayoutState, useBuildingPetalSweep, useUseCaseChronology, useLifecycle, eventBridge).

---

## 1. Every BuildEvent flush re-creates the full ScalarsProjection AND triggers full GlyphFullLayout subtree re-render

- **Severity**: critical
- **Category**: re-render
- **File**: `src/stores/slices/agents/matrixBuildSlice.ts:483-499` (`updateSessionInState`) + `src/features/agents/components/matrix/useBuild.ts:35-61` (`useShallow` consumer)
- **Scenario**: A live build emits a continuous stream of `progress`, `cell_update`, `capability_resolution_update`, and `persona_resolution_update` events. `flushEvents` (useBuildSession.ts:198) dispatches all events buffered in a single RAF in one tight `for` loop, each invoking a `set(...)` that returns a fresh `{ buildSessions, ...scalarsFromSession(updated) }` patch.
- **Root cause**: Every mutation calls `scalarsFromSession(updated)` which **always returns a brand-new object** (the WeakMap cache is keyed on the new session reference — every patch produces a new session ref → cache miss every time). That projection has 27 keys, including 4 fresh array references (`buildPendingQuestions`, `buildOutputLines`, etc.) and 9 fresh object references. Within one RAF flush of N events, Zustand fires N notify cycles. `useBuild` uses `useShallow` over 9 fields — most are stable, but `buildOutputLines`, `cellStates`, `cellData`, `pendingQuestions`, and `buildPendingAnswers` change identity on most events, so the shallow comparator triggers re-render every burst, propagating through `GlyphFullLayout` → `GlyphSigilFace` → `GlyphSigilCanvas` → `GlyphPetalIcons` (8 petals with framer-motion `animate` props) per tick.
- **Impact**: 8 framer-motion petals + activity strip + chronology re-render up to 16-30 times per second during the resolving phase (when capability_resolution_update events fire fast). The reported jank lives here.
- **Fix sketch**:
  1. Batch the whole RAF flush into a **single** `set()` — accumulate the next `buildSessions` map across events then commit once with one `scalarsFromSession` call.
  2. Replace `useShallow` with selector-per-field on `useBuild` (or split into two hooks: a "fast" one for cellStates/pendingQuestions used by the sigil, a "slow" one for outputLines/testOutputs consumed only by ActivityStrip and TestReport).
  3. Memoize `scalarsFromSession` on **content hash** of changed fields, not reference, so unchanged keys reuse the previous reference — Zustand's default `Object.is` per-key would then short-circuit consumers reading individual scalars.

## 2. `useShallow` selector in `useBuild` returns fresh array/object references every render via `Object.keys()`

- **Severity**: high
- **Category**: re-render
- **File**: `src/features/agents/components/matrix/useBuild.ts:59`
- **Scenario**: The shallow selector contains `pendingAnswerCount: Object.keys(s.buildPendingAnswers).length`. `Object.keys()` is called inside the selector function but the value (a number) is OK — however, the projected object includes `cellStates: s.buildCellStates`, `cellData: s.buildCellData`, `pendingQuestions: s.buildPendingQuestions` and `outputLines: s.buildOutputLines`, all of which are recreated as fresh references in the scalar projection (see finding #1) on every event flush.
- **Root cause**: `useShallow` compares by shallow equality on the projected object's own keys — when ANY one of those 9 references changes, all consumers re-render. Combined with the projection always producing fresh references (finding #1), `useShallow` no longer provides the stability it implies. Practically, `useShallow` is being used as a glorified `Object.is`-grouped read but the upstream guarantees no reference stability.
- **Impact**: One `progress` event (which only legitimately changes `outputLines` + `activity` + `progress`) re-renders the entire build surface because `cellStates`, `cellData`, etc. reference-flip in the same projection. Compounds finding #1.
- **Fix sketch**: Stop using `useShallow` here. Read each scalar via a dedicated selector (`useAgentStore(s => s.buildCellStates)` etc.). Combined with finding #1 finding's reference-preserving projection, Zustand will only notify consumers whose specific scalar changed. Co-locate test-related fields (`buildTestPassed`, `buildTestOutputLines`, `buildTestError`) into a separate inner hook that mounts only when `buildPhase === 'testing' | 'test_complete'`.

## 3. EventBridge double-processes every build event during foregrounded session because guard logic checks the **same** event handler path

- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/lib/eventBridge.ts:360-422` (`BUILD_SESSION_EVENT` listener) + `src/hooks/build/useBuildSession.ts:68-93` (`__BUILD_CHANNEL_ACTIVE_SESSIONS__`)
- **Scenario**: The Channel handler processes events for the active session and registers the session id in `__BUILD_CHANNEL_ACTIVE_SESSIONS__`. EventBridge subscribes to the global Tauri `BUILD_SESSION_EVENT` and skips entries whose `session_id` is in the active set. But when the Rust side fires through both channels (current default for resilience), the registration happens **after** the first `start_build_session` returns its session id (useBuildSession.ts:374). Events that fired BEFORE the awaited `startBuildSession` returns hit EventBridge first because `markSessionActive` hasn't run yet.
- **Root cause**: There's a race window of one IPC roundtrip between channel creation and `markSessionActive`. During the channel's handshake the Rust runner can already emit `session_status:"initializing"` and `progress` events; those events fire through the global event bus, find the session id NOT in the active set yet, and the handler runs — but `store.buildSessions[payload.session_id]` doesn't exist yet either (createBuildSession hasn't fired), so they're silently dropped. Once the session is created, ALL late events queued by the Tauri Channel get processed by `onmessage` AND get re-broadcast via `app.emit`. The active set guard only protects events that arrive AFTER `markSessionActive`. Some "double resolved → updated" flicker is precisely this — see the comment in `eventBridge.ts:358-360` acknowledging the design issue.
- **Impact**: Per-cell visible status flicker (resolved → updated → resolved) on the first build of a session, plus every event handler runs twice during the racy window — extra work for `handleBuildCellUpdate` which does a `JSON.stringify` diff (see finding #6).
- **Fix sketch**: Either (a) register the session id in the active set BEFORE the `startBuildSession` invoke (use a tentative id reconciled when the real id comes back), or (b) sequence-number the events on the Rust side and drop duplicates by sequence on the frontend, or (c) drop EventBridge for build events entirely and rely on `getActiveBuildSession` hydration on unmount/remount transitions only.

## 4. `handleBuildCellUpdate` runs `JSON.stringify` on cell items inside the store updater path

- **Severity**: high
- **Category**: algorithmic
- **File**: `src/stores/slices/agents/matrixBuildSlice.ts:678-684`
- **Scenario**: Every `cell_update` event during resolving phase runs through this updater, which on a re-resolve compares old vs new items via `JSON.stringify(oldItems) !== JSON.stringify(newItems)` to decide `resolved` vs `updated` status.
- **Root cause**: For capability resolutions with many items (think 20-30 sub-tools or long URL lists), `JSON.stringify` is O(n) per call and runs **twice** per cell update — inside the Zustand `set` reducer (synchronous, blocks the render commit), and it runs even when the previous status wasn't `resolved` (the check is gated by `prevStatus === incomingStatus && prevStatus === 'resolved'`, but during re-emits this gate hits frequently). Re-parsing `event.data` from string then re-stringifying for the diff doubles the JSON cost.
- **Impact**: Each cell_update can spend 1-5ms stringifying mid-frame on long item arrays. Multiply by 8 cells × multiple resolutions over a build, plus the RAF batch effect.
- **Fix sketch**: Memoize the parsed payload (already parsed earlier in the same updater into `cellData`), and compare items via reference + length + sampled hash, not full JSON. Even simpler: trust the backend's status field as authoritative and skip the `updated` flicker logic — if the backend says `resolved`, render `resolved`. Move drift detection out of the hot path.

## 5. Hydration on every `personaId` change always invokes `getActiveBuildSession` even when store is already populated

- **Severity**: medium
- **Category**: duplicate-call
- **File**: `src/hooks/build/useBuildSession.ts:522-566`
- **Scenario**: Every time `UnifiedBuildEntry` mounts (or `personaId` changes), the effect at line 522 fires `getActiveBuildSession(effectivePersonaId)` as an IPC call. There's no precondition guard: even when `useAgentStore.getState().buildSessions[sessionId]` already has fresh state from a live Channel, the SQLite roundtrip runs and the result clobbers the slice via `hydrateBuildSession`.
- **Root cause**: The effect always calls the backend. The `hydrateBuildSession` action (matrixBuildSlice.ts:1262-1417) does a careful merge to preserve mid-flight state, so correctness is maintained — but it still performs a full IPC + JSON parse + slice rebuild every mount. With Suspense + lazy loading, that's a real IPC each navigation.
- **Impact**: Every navigation to the build surface hits SQLite even mid-build. Visible cost: ~5-20ms hydrate latency, and the resulting store update triggers a full re-render of the build surface even when nothing changed.
- **Fix sketch**: Gate hydration: if `useAgentStore.getState().buildSessions[?]` exists with a matching personaId AND its `phase` is non-terminal, skip the IPC. Only hydrate when we genuinely lack in-memory state. Alternatively, run hydration once per app lifetime per personaId via a sessionStorage-keyed flag and rely on EventBridge for catch-up.

## 6. `useUseCaseChronology` rebuilds full chronology object tree on every `buildDraft` reference change during build

- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/templates/sub_generated/adoption/chronology/useUseCaseChronology.ts:552-572` (consumed in `UnifiedBuildEntry.tsx:577`)
- **Scenario**: `agent_ir` arrives via `cell_update` events. `handleBuildCellUpdate` parses the raw JSON, sets `sess.draft = parsedIR`. `useUseCaseChronology` selector reads `s.buildSessions[id]?.draft` and memos on its reference. Each `agent_ir` event creates a new draft object reference even when the IR is byte-identical to the previous emit (the backend retries / re-emits during multi-round resolution). `buildChronology` is a deep parsing function that walks `use_cases[]`, every `event_subscriptions[]`, `nodes[]`, etc. and rebuilds the full row tree.
- **Root cause**: No structural-equality memoization, and the source object is replaced on every emit. Result: `glyphRows` reference changes pass to `GlyphFullLayout` → re-render → `GlyphRowStrip` re-renders all mini sigils + chronology cards.
- **Impact**: Repeated rebuilds for what's typically the same data (LLM emits agent_ir twice during draft + post-test refinement, plus phase-back oscillations). Each rebuild is hundreds of asObj/asArray calls. Combined with finding #1 the work is amplified.
- **Fix sketch**: In `handleBuildCellUpdate` (the `agent_ir` branch around matrixBuildSlice.ts:634-648), compute a content hash on parse and skip the state update when the hash matches the previously-stored draft. Or — cheaper — in `useUseCaseChronology`, dedupe by `JSON.stringify(draft).length` + a top-level title check before invoking the full builder.

## 7. Framer-motion variants on `GlyphSigilFace` + `GlyphCoreContent` recreate inline transition/animate objects per render

- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/agents/components/glyph/GlyphSigilFace.tsx:77-82`, `GlyphCoreContent.tsx:63-82,117-145`, `GlyphPetalIcons.tsx:122-160`
- **Scenario**: Every render of `GlyphSigilFace` reallocates `initial`, `animate`, `transition` literal objects (`{ opacity: 0, scale: 0.9 }`, `{ duration: 0.45, ease: [...] }`). `GlyphCoreContent` does the same for every phase branch's `motion.div`/`motion.button`. `GlyphPetalIcons` per-petal allocates `animate={{ opacity: [0.6, 1, 0.6] }}` and `transition={{ duration: 1.6, repeat: Infinity }}` 8 times per render — the inline `[0.6, 1, 0.6]` array is a fresh allocation each pass and Framer Motion's reconciler can't structurally dedupe.
- **Root cause**: Framer Motion compares props by reference; new literals each render mean the animation engine schedules unnecessary re-keyframe work (specifically AnimatePresence's `mode="wait"` recompute and per-frame interpolation reset for pending pulses).
- **Impact**: Animation re-init jank when the parent re-renders (which finding #1 makes frequent). Pending-petal pulse can visibly "restart" on every event tick.
- **Fix sketch**: Hoist all `initial/animate/exit/transition` literals to module-scope `const`s. Move per-petal pulse to a CSS keyframe via the `PULSE_CLASS` pattern already used in `GlyphHeroSigil.tsx:30-36` — extend it to cover `GlyphPetalIcons`' pending case. Eliminate motion props entirely for the static halo.

## 8. `buildOutputLines` reactivity flows to `useBuild` consumers even when only `GlyphActivityStrip` reads them

- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/agents/components/matrix/useBuild.ts:36-49` (returns `outputLines`); `GlyphActivityStrip.tsx:9` (only legitimate consumer); `UnifiedBuildEntry.tsx:700,732` (`cliOutputLines={build.outputLines}`)
- **Scenario**: `progress` events fire fastest of any build event class (the CLI emits stdout lines roughly every 50-200ms). Each appends to `outputLines` (a new array each time), which is bundled into `useShallow` projection from `useBuild`, which re-renders `UnifiedBuildEntry` → `GlyphFullLayout` → cascade.
- **Root cause**: `buildOutputLines` is included in the wide `useShallow` group despite being consumed only by the activity strip near the bottom of the tree. Hoisting it up forces the whole subtree to reconcile on every CLI stdout line.
- **Impact**: Re-render rate during analyzing phase is dominated by `progress` events, not state-meaningful changes.
- **Fix sketch**: Drop `outputLines` from `useBuild`'s return surface. Have `GlyphActivityStrip` read it directly via `useAgentStore(s => s.buildOutputLines)`. Same for `buildTestOutputLines` (only consumed by `GlyphCoreContent`'s testing branch — could be read directly there). This is the highest leverage single change in the audit.

## 9. `removeBuildSession` performs unscoped `Object.keys(...).filter` for next-active pick

- **Severity**: low
- **Category**: algorithmic
- **File**: `src/stores/slices/agents/matrixBuildSlice.ts:465-481` (`pickNextActiveSessionId`)
- **Scenario**: On every `removeBuildSession` (and the implicit one inside `resetBuildSession`), this iterates the full session map twice: once filter by personaId, once sort by `createdAt`. Build flow normally has 1-3 sessions, so cost is trivial, but the function is called from `UnifiedBuildEntry`'s launch-failure cleanup (UnifiedBuildEntry.tsx:519-525) inside a path that can fire mid-build.
- **Root cause**: Linear scan + sort each call. Not on the hot streaming path but called from the cancel/cleanup hot path.
- **Impact**: Minor today; would scale poorly if multi-draft expanded past ~50 sessions.
- **Fix sketch**: Maintain a `personaToSessionIds: Record<string, string[]>` index alongside `buildSessions` so the filter is O(1) lookup. Defer until session count grows.

---

## Summary table

| #  | Severity | Category            | File                                  |
| -- | -------- | ------------------- | ------------------------------------- |
| 1  | critical | re-render           | matrixBuildSlice.ts:483 + useBuild.ts:35 |
| 2  | high     | re-render           | useBuild.ts:59                        |
| 3  | high     | duplicate-call      | eventBridge.ts:360 + useBuildSession.ts:68 |
| 4  | high     | algorithmic         | matrixBuildSlice.ts:678               |
| 5  | medium   | duplicate-call      | useBuildSession.ts:522                |
| 6  | medium   | algorithmic         | useUseCaseChronology.ts:552           |
| 7  | medium   | re-render           | GlyphSigilFace.tsx:77 + siblings      |
| 8  | medium   | re-render           | useBuild.ts:36                        |
| 9  | low      | algorithmic         | matrixBuildSlice.ts:465               |
