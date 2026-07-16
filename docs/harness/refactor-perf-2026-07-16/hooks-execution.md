# hooks/execution — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Core Libraries & State | Files read: 11 | Missing: 0

## 1. Replay playback filters the full log array on every animation frame
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/hooks/execution/useReplayTimeline.ts:112
- **Scenario**: User hits Play on a replay of a long execution (log content split into thousands of `TimelineLogLine`s). The rAF loop calls `setCurrentMs` ~60x/sec, and every tick recomputes `visibleLines` (O(n) filter + new array), `completedSteps`, `activeStep`, `pendingSteps`, and `accumulatedCost`, then re-renders the entire replay view with a growing line list.
- **Root cause**: `visibleLines` is derived with `allLines.filter(l => l.timestamp_ms <= currentMs)` even though `allLines` is sorted by timestamp — a linear scan and full allocation per frame keyed on a value that changes every frame.
- **Impact**: Sustained 60fps allocations proportional to log size; visible jank and GC pressure during playback on real executions (the interactive feature this hook exists for). At 8x speed the same cost persists.
- **Fix sketch**: Since `allLines` is sorted, binary-search the cutoff index and return `allLines.slice(0, idx)` (or better: expose just the cutoff index and let the consumer slice/virtualize). Additionally, throttle `setCurrentMs` to ~10-15 updates/sec during playback (accumulate delta in a ref, flush on a coarser interval) — scrub precision does not need frame-rate state updates. The same index approach applies to `completedSteps`/`pendingSteps` if `toolSteps` is sorted by `started_at_ms`.

## 2. useReasoningTrace does a full array copy + state update per structured event
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/hooks/execution/useReasoningTrace.ts:16
- **Scenario**: During a live execution, every structured event — each text delta, tool call, tool result, file change, and heartbeat — triggers `pushEntry` (spread-copy of up to 500 entries) plus a `setEntries` that re-renders every consumer of the trace, event by event.
- **Root cause**: `pushEntry` rebuilds the whole entries array immutably per event, and each event commits its own render; bursts (e.g. rapid tool_result + text sequences) are not batched. Heartbeats are also pushed as entries even though `useExecutionSummary` ignores them, so they both evict real trace entries from the 500 cap and cause renders during otherwise-idle periods.
- **Impact**: O(500) allocation and a consumer re-render per event on the hot streaming path; bounded (cap 500) but continuous for the whole run duration.
- **Fix sketch**: Buffer incoming entries in `entriesRef` and flush with one `setEntries` per animation frame (or a ~100ms interval) while live. Keep heartbeat data in a separate lightweight state (or reuse `useActivityMonitor`) instead of pushing heartbeat entries into the capped trace array.

## 3. Tauri listen/cleanup boilerplate duplicated across five hooks
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/hooks/execution/useStructuredStream.ts:43
- **Scenario**: Any change to the subscription pattern (e.g. the `cancelled` guard, error handling on registration, the `allSettled` teardown fix already made in useAiHealingStream) must be re-applied by hand in each hook and can drift.
- **Root cause**: The identical pattern — `let cancelled; const p = listen(evt, cb); return () => { cancelled = true; p.then(fn => fn()); }` — is hand-rolled six times: useActivityMonitor (x2, lines 33-63), useFileChanges (37-62), useStructuredStream (43-91), and a variant in useAiHealingStream (52-122). Notably only useAiHealingStream got the `Promise.allSettled` rejected-registration hardening; the other four still ignore a rejected `listen` promise in cleanup.
- **Impact**: Real maintenance hazard: the safest teardown variant exists in one file only; five copies of subtly different lifecycle code.
- **Fix sketch**: Extract a `useTauriEvent<T>(eventName, handler, enabled?)` hook (handler via ref so subscription is stable) that owns registration, the cancelled guard, and settled-safe teardown. Each of the five call sites collapses to one line plus its payload filter.

## 4. Line cap/truncation ring-buffer logic duplicated between healing and CLI streams
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/hooks/execution/useAiHealingStream.ts:76
- **Scenario**: Tuning the stream buffer policy (line length cap, blank-line skip, ring-buffer eviction) requires editing two hooks with slightly different constants (MAX_LINES 500 vs MAX_STREAM_LINES 5000) and slightly different eviction code, inviting drift — useCorrelatedCliStream also dedups consecutive identical lines while useAiHealingStream does not.
- **Root cause**: useAiHealingStream:68-82 and useCorrelatedCliStream:85-104 independently implement trim-skip, 4096-char truncation, and capped append. The healing variant also double-copies on eviction (`[...prev.lines.slice(...) , line]` — slice allocates, spread copies again).
- **Impact**: Bounded but clear duplication of non-trivial buffer semantics on the two streaming paths; behavioral inconsistencies (dedup) are accidental rather than chosen.
- **Fix sketch**: Extract `appendCapped(prev: string[], rawLine: string, opts: { maxLines, maxLineLength, dedupConsecutive })` into a small lib module (e.g. src/lib/execution/streamBuffer.ts); both hooks call it inside their `setState` updaters. Fix the double copy (`prev.slice(...).concat(line)`) while consolidating.

## 5. Dead lastOutputRef in useActivityMonitor
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/hooks/execution/useActivityMonitor.ts:22
- **Scenario**: A reader assumes the hook tracks last-output wall-clock time locally; it never does anything with it.
- **Root cause**: `lastOutputRef` is written on reset (line 28) and on each output line (line 56) but never read — staleness is derived entirely from the backend's `silence_ms`. Likely a leftover from a pre-heartbeat local-timer implementation.
- **Impact**: Pure noise; no runtime cost beyond a ref write per output line.
- **Fix sketch**: Delete the ref and both assignments (verified: no other reference in this file; the hook's return value doesn't expose it).
