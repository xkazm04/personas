# plugins/companion [2/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 2 medium / 3 low)
> Context group: Plugins & Companion | Files read: 34 | Missing: 0

## 1. SlashPalette duplicates its own exported filter logic inline
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/companion/SlashPalette.tsx:44
- **Scenario**: The component's `useMemo` (lines 44-51) re-implements the exact filter that the same file exports as `filterSlashPresets` (lines 118-127). The Composer uses the exported function to compute the keyboard-selection list (Composer.tsx:115), while the palette renders from its private copy.
- **Root cause**: `filterSlashPresets` was extracted for the Composer's arrow-key/Enter mirroring, but the component body was never switched over to call it.
- **Impact**: The rendered list and the Enter-selection list are only identical by convention. If either copy is edited (e.g. add fuzzy match or a `message` field search), Enter can pick a different preset than the highlighted row — a silent wrong-command bug. Tests only cover the exported copy.
- **Fix sketch**: Replace the inline body of the `useMemo` with `filterSlashPresets(presets, query)`. One line, removes the drift hazard entirely; the existing `__tests__/SlashPalette.test.tsx` then covers both call sites.

## 2. Decisions panel fires an unthrottled IPC/SQLite query per keystroke
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: missing-debounce
- **File**: src/features/plugins/companion/sub_decisions/useDesignDecisions.ts:44
- **Scenario**: `DecisionsFilterInput` calls `setFilter` on every `onChange`, and the effect keyed on `[filter]` immediately invokes `companionListDesignDecisions(probe, 200)` — a Tauri IPC round trip into rusqlite. Typing a 15-character filter issues 15 sequential backend queries (each up to 200 rows serialized across the bridge), all but the last discarded via the `cancelled` flag.
- **Root cause**: The fetch effect commits on the raw controlled-input value with no debounce; the cancellation flag prevents stale state but not the wasted queries.
- **Impact**: N wasted IPC round trips + row serializations per filter session and flickering loading state (`setLoading(true)` per keystroke). Bounded (local SQLite, 200-row cap) but pure waste on an interactive hot path, and it grows with the decisions table.
- **Fix sketch**: Debounce the query commit ~250ms: keep `filter` for the input, derive a `debouncedFilter` (small `useDebouncedValue` hook or a `setTimeout` in the effect keyed on `filter` that defers the invoke), and only flip `loading` when the deferred fetch actually starts. `handleShowAll`/scope changes can bypass the delay by committing directly.

## 3. MemoryPanel builds the decay toast by regex-stripping its own interpolation
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/plugins/companion/sub_memory/MemoryPanel.tsx:62
- **Scenario**: The success toast is assembled as `` `${n} ${t...decay_done.replace('{{count}}', String(n)).replace(/^\d+\s+/, '')}` `` — it interpolates the count into the template, then regex-strips the leading digits it just inserted, then re-prepends `n` manually.
- **Root cause**: Workaround layered on a template whose `{{count}}` placeholder position didn't match the desired output; the strip assumes the localized string starts with the number.
- **Impact**: Locale-fragile (any language where the count isn't sentence-initial renders doubled or mangled text) and genuinely hard to read — a reviewer can't tell what the toast says without executing the string surgery in their head.
- **Fix sketch**: Use the project's `tx()` interpolation (used elsewhere in this context, e.g. WakeCadence) or a plain `t...decay_done.replace('{{count}}', String(n))` with the placeholder placed correctly in the catalog string. Delete both `.replace` chains.

## 4. CompanionAssignmentCards: unused parameter and unsound section cast
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/plugins/companion/CompanionAssignmentCards.tsx:18
- **Scenario**: `handleOpen(_ref: AthenaAssignmentRef)` ignores its argument (deep-linking is deferred to "Phase C4"), and navigates via `setSidebarSection('pipeline' as Parameters<typeof setSidebarSection>[0])` — an `as`-cast that tells the compiler to trust a string it evidently can't verify.
- **Root cause**: Placeholder wiring left in place: the ref is threaded through for a future deep-link, and the cast papers over `'pipeline'` not being (or not provably being) a member of `SidebarSection`.
- **Impact**: If the pipeline section key is ever renamed or removed, this call site keeps compiling and silently navigates nowhere. The dead parameter also misleads readers into thinking the card routes to the specific assignment.
- **Fix sketch**: Drop the parameter until Phase C4 lands (`onOpen={() => handleOpen()}`), and either add `'pipeline'` to the `SidebarSection` union or import the typed constant so the cast disappears. If `'pipeline'` is genuinely not a valid section, that's a latent nav bug to fix now.

## 5. useHoldToTalk re-creates its entire API every render via unstable dictation identity
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/companion/useHoldToTalk.ts:55
- **Scenario**: `useSpeechInput`/`useDictation` return a fresh object literal each render, and `start`/`stop`/`abort` list `dictation` in their `useCallback` deps, so all three callbacks (and the returned `HoldToTalk` object) get new identities on every render of the host — including the high-frequency renders driven by `interimText` updates while the user speaks. The transcript-flush effect (line 92) also lists `dictation` and therefore re-runs every render.
- **Root cause**: The dictation hooks return `{ ...fields }` inline instead of memoizing, defeating the `useCallback`s downstream.
- **Impact**: Bounded — the effect body is guarded by refs and the consumers (footer button, orb layer) are small — but every memoization keyed on these callbacks downstream is dead weight, and the effect churn runs at speech-interim frequency during capture.
- **Fix sketch**: In `useDictation` (and `useLocalDictation`/`useSpeechInput`), wrap the returned object in `useMemo` keyed on its fields; `start`/`stop`/`reset` are already `useCallback`-stable there. Then narrow `useHoldToTalk`'s deps to the specific stable functions (`dictation.start`, `dictation.stop`, `dictation.reset`) instead of the container object.
