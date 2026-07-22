# overview/manual-review — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 4 medium / 1 low)
> Context group: Observability & Monitoring | Files read: 14 | Missing: 0

## 1. Un-memoized `parseDecisions` JSON.parse on every render of ReviewFocusFlow
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_manual-review/components/ReviewFocusFlow.tsx:96
- **Scenario**: `const { decisions, galleryImage, contextText } = current ? parseDecisions(current.context_data) : …` runs in the component body with no `useMemo`. ReviewFocusFlow re-renders on every keystroke in the ActionZone notes textarea (`actionNotes` state) and on every decision/verdict/index state change — each render re-runs `JSON.parse` over `context_data` (which can carry large multi-decision payloads with descriptions and media refs).
- **Root cause**: The parse result was destructured inline instead of being memoized on `current.context_data`, unlike `suggestedActions` two lines below which *is* memoized.
- **Impact**: JSON.parse per keystroke, plus — worse — `decisions` gets a fresh array identity every render, so `decideAndAdvance`, `setAllDecisions`, `buildVerdictNotes` (all depending on `decisions`) are rebuilt every render, and the keyboard `useEffect` (deps include `decideAndAdvance`) tears down and re-adds the window keydown listener on every render, including every keystroke.
- **Fix sketch**: `const parsed = useMemo(() => current ? parseDecisions(current.context_data) : EMPTY, [current?.context_data])` and destructure from that. This stabilizes `decisions` identity, which in turn stabilizes the three callbacks and stops the keydown listener churn.

## 2. Decision-notes summary building duplicated 3× (twice inline in ReviewDetailPanel, once in ReviewFocusFlow)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_manual-review/components/ReviewDetailPanel.tsx:315
- **Scenario**: The Approve button onClick (lines 315–328) and Reject button onClick (lines 329–341) each contain the identical ~10-line block that filters `decisionStates`, maps to `+/- label`, joins, and appends `Decisions:\n…` to the notes. ReviewFocusFlow.tsx:134 (`buildVerdictNotes`) implements the same `+/- label` / `Decisions:\n` format a third time with a different verdict-state shape.
- **Root cause**: The summary logic was pasted into both button handlers rather than extracted, and ReviewFocusFlow grew its own parallel implementation.
- **Impact**: Three copies of a user-visible note format (the backend/team-memory parses these notes) that can silently drift; any format change must be made in three places.
- **Fix sketch**: Add `buildDecisionNotes(decisions, states, extraText?)` to `libs/reviewHelpers.ts` (accepting a `Record<string, 'accepted'|'rejected'|'accept'|'reject'|null>`), call it from both ReviewDetailPanel button handlers (collapsing them to one line each) and from ReviewFocusFlow's `buildVerdictNotes`.

## 3. `DecisionItem` type + decisions-from-context_data parsing triplicated
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_manual-review/components/ReviewDetailPanel.tsx:87
- **Scenario**: Parsing `context_data` JSON and extracting `parsed.decisions` exists in three places: `parseDecisions` in reviewFocusHelpers.tsx:39 (the full canonical version), the `decisions` useMemo in ReviewDetailPanel.tsx:87–94, and `ContextDataPreview` in ReviewListItem.tsx:72–78. The `DecisionItem` interface is likewise declared in reviewFocusHelpers.tsx:22 (with image fields), ReviewListItem.tsx:42 (without), and inline as an anonymous shape in ReviewDetailPanel's useMemo.
- **Root cause**: ReviewDetailPanel and ReviewListItem predate the helpers file and were never converged onto `parseDecisions`.
- **Impact**: The detail panel silently misses fields the focus flow handles (e.g. it never surfaces `context_text` or per-decision images), and any change to the backend decisions shape has to be re-discovered in three parsers.
- **Fix sketch**: Import `parseDecisions` and `DecisionItem` from reviewFocusHelpers into ReviewDetailPanel (replacing the useMemo body) and into ReviewListItem's `ContextDataPreview` decisions branch; delete the two local type declarations.

## 4. `STATUS_LABELS` missing `resolved` — resolved reviews are badged "Pending" in the inbox
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/overview/sub_manual-review/libs/reviewHelpers.ts:7
- **Scenario**: `STATUS_LABELS` only maps pending/approved/rejected, but the status domain includes `resolved` (present in `FILTER_LABELS`, in `ManualReviewCounts`, and produced by the stale-review GC). `InboxItem` (ReviewListItem.tsx:112) does `STATUS_LABELS[review.status] ?? 'Pending'`, so under the "All" filter a GC-auto-resolved review renders with a "Pending" badge.
- **Root cause**: `STATUS_LABELS` was not extended when the `resolved` status (Clear-stale GC) was added; the fallback masks the gap by defaulting to the most misleading label.
- **Impact**: User-visible mislabeling — auto-resolved rows look actionable/pending in the inbox list, contradicting the AutoResolvedBadge work whose whole point was making auto-resolution visible.
- **Fix sketch**: Add `resolved: 'Resolved'` to `STATUS_LABELS` and change the fallback to something neutral (e.g. the raw status string) so future statuses can't masquerade as Pending. Verify `STATUS_COLORS` in designTokens has a `resolved` entry too (same `?? STATUS_COLORS.pending` fallback pattern on line 111).

## 5. Bulk approve/reject fires one IPC call + one SQLite write per selected review
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: batching
- **File**: src/features/overview/sub_manual-review/components/ManualReviewList.tsx:223
- **Scenario**: `handleBulkAction` does `Promise.allSettled(selectedIds.map(id => updateManualReviewStatus(id, status)))` — with "Select all" on a large pending queue this is N parallel Tauri invokes, each an individual rusqlite UPDATE (no transaction), followed by a full L0+L1 reload.
- **Root cause**: No batch command exists on the Rust side, so the frontend loops single-row updates.
- **Impact**: N IPC round trips and N separate writes for one user action; partial failure leaves a mixed state that `allSettled` swallows silently (no toast for the rejected promises). Bounded by page size (~40 + loaded pages) so not unbounded, but it is the hottest bulk path in this view.
- **Fix sketch**: Add a `bulk_update_manual_review_status(ids, status, notes)` Tauri command that runs one `UPDATE … WHERE id IN (…)` inside a transaction and returns the affected count; call it once from `handleBulkAction`. Cloud reviews keep the per-item loop (external API). Surface a toast when the returned count is less than requested.

## 6. Sidebar resize drag leaves document listeners and body styles if the panel unmounts mid-drag
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/overview/sub_manual-review/components/ReviewInboxPanel.tsx:80
- **Scenario**: `handleResizeStart` attaches `pointermove`/`pointerup` to `document` and sets `body.style.cursor/userSelect`, cleaning up only in the `pointerup` handler. If the component unmounts mid-drag (filter switch to "pending" swaps the panel for ReviewFocusFlow, or navigation away), there is no unmount cleanup; the listeners keep firing setState on the unmounted component until the next pointerup anywhere.
- **Root cause**: Drag cleanup lives only in the `onUp` closure with no corresponding `useEffect` teardown.
- **Impact**: Self-heals on the next pointerup, so the window is short — but during it, every pointer move runs the RAF coalescer and a dead setState, and the forced `col-resize` cursor/`userSelect: none` persist over the new view.
- **Fix sketch**: Keep the active cleanup function in a ref and add `useEffect(() => () => cleanupRef.current?.(), [])`; or switch to `setPointerCapture` on the handle element so listener lifetime is tied to the element and browser-managed.
