# workers (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 2 medium / 1 low)
> Context group: Core Libraries & State | Files read: 1 | Missing: 0

## 1. ANSI-strip logic duplicated between worker and its consumer hook
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/workers/terminal-classifier.ts:18
- **Scenario**: `ANSI_ESCAPE_PATTERN` (built via `String.fromCharCode(27)` to avoid a control-char literal) and the strip-then-classify mapping are written twice, verbatim: once here (lines 18–25, 28–34) and once in `src/hooks/utility/useTerminalClassification.ts:9-22` (`classifySynchronously`, the no-Worker fallback path). Anyone extending the pattern (e.g. to also strip OSC sequences) will fix one copy and miss the other.
- **Root cause**: The worker cannot easily share module state with the hook, so the fallback re-implemented normalization instead of importing it from a shared util.
- **Impact**: Worker path and sync-fallback path can silently diverge — same input renders differently depending on whether `Worker` is available. Classic drift hazard on a pair of files that must stay behavior-identical.
- **Fix sketch**: Move `ANSI_ESCAPE_PATTERN` + a `normalizeLine()` (or a full `classifyTerminalLines(lines): ClassifiedTerminalLine[]`) into `src/lib/utils/terminalColors.ts`, which both files already import. Worker becomes a thin `self.onmessage` wrapper; the hook's `classifySynchronously` becomes a direct call to the shared function.

## 2. Entire lines array is re-serialized and re-classified on every update (O(n²) over a streaming session)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: redundant-recompute
- **File**: src/workers/terminal-classifier.ts:27
- **Scenario**: During a live agent run the terminal appends lines continuously; each append triggers the hook's effect, which posts the FULL `lines` array to the worker, which strips ANSI and re-classifies every line from scratch and structured-clones the full result back. For an n-line session that's O(n) clone+classify per update, O(n²) cumulative — and the structured-clone cost of shipping thousands of strings across the worker boundary twice per frame dwarfs the classification itself (`classifyLine` is ~a dozen `startsWith` checks).
- **Root cause**: The protocol is stateless full-snapshot (`{id, lines[]}`); there is no incremental "classify only the tail" request shape and no cache of already-classified prefixes.
- **Impact**: Measurable main-thread serialization + worker churn on the hottest UI path (streaming terminal), growing linearly with session length; the rAF coalescing bounds frequency but not per-message cost. Ironically the worker likely costs more than classifying inline would.
- **Fix sketch**: Either (a) drop the worker entirely — `classifyLine` is trivially cheap, so a memoized in-thread map keyed by line suffices — or (b) make the protocol incremental: hook sends `{id, offset, newLines}` for the appended tail, worker returns classified tail, hook concatenates with the cached prefix. Option (a) is simpler and deletes this file plus the fallback duplication in finding #1.

## 3. Lines are classified twice on mount (sync init + immediate worker round-trip)
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: redundant-recompute
- **File**: src/workers/terminal-classifier.ts:27 (with src/hooks/utility/useTerminalClassification.ts:36)
- **Scenario**: `useTerminalClassification` computes `classifySynchronously(lines)` in its `useState` initializer, then the mount effect immediately posts the same unchanged array to the worker, which classifies it again and triggers a second `setClassified` with an identical-by-value result.
- **Root cause**: No "already classified this exact array" check before posting; the worker path always runs even when the sync initializer just produced the answer.
- **Impact**: One wasted full-array classification + structured-clone round-trip + extra render per mount. Bounded (once per mount) — noticeable only when opening a terminal with a large backlog.
- **Fix sketch**: Track the last-classified `lines` reference in a ref; skip the worker post when `lines` is the same reference the initializer already handled. Moot if finding #2's option (a) — dropping the worker — is taken.
