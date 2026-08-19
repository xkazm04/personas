---
layer: application
subject: streaming-output
technique: buffering-and-backpressure
stack: react
---

# ExecutionSink — how this repo's frontend bounds and throttles the live terminal stream

The canonical bounded live buffer is `ExecutionSink` at
`src/lib/execution/executionSink.ts` — a self-contained subsystem owning the
ring buffer, byte budget, batching, and flush scheduling, extracted from
`executionSlice.ts` precisely to kill module-level mutable state (its header
comment, `:1-8`, says so). The execution slice holds one sink reference
(`executionSink`, `:339`) and delegates `append`/`clear`; re-binding happens at
`src/stores/slices/executionSlice.ts:189-192`. This is the repo's best answer
to the technique, and the root `CLAUDE.md` names it as such.

## The budgets — two currencies plus the single-entry cap

All three caps from the technique are present as named constants (`:15-26`):

- `MAX_TERMINAL_LINES = 10_000` — the entry budget, enforced by
  `TerminalRingBuffer` (`:39-89`), a fixed-capacity ring with O(1) append and
  head eviction (`pushMany`, `:53-69`) and a dirty-flag snapshot cache
  (`toArray`, `:72-81`) so unchanged buffers don't re-materialize the array.
- `MAX_TOTAL_BYTES = 10 MB` — the byte budget, tracked as `totalBytes` and
  checked at flush (`:236`).
- `MAX_LINE_LENGTH = 4096` — the single-entry clamp, applied on admission in
  `append` (`:128-130`) with an explicit `...[truncated]` marker, so one
  pathological line cannot eat the budget.

One honest caveat: `batchBytes += safeLine.length` counts UTF-16 code units,
not encoded bytes — the "10 MB" is approximate for non-ASCII-heavy streams.
Acceptable for a memory bound; worth knowing before quoting the number.

## Head eviction and honest truncation

Under the line budget the ring silently evicts oldest — correct for a tail
view. Crossing the *byte* budget switches modes (`:236-242`): the main ring is
frozen with a truncation notice appended, and a 200-line `tailRing`
(`TAIL_BUFFER_LINES`) takes over. Every subsequent flush renders
`formatTruncationNotice(totalBytes)` — *"Output truncated — 10 MB limit
reached. Showing most recent output below. (N MB received)"* (`:28-33`) — plus
the tail. The notice carries a predicate (how much was received), satisfying
the technique's honesty rule; it states bytes received rather than
entries-dropped, a lighter form than the technique's ideal but a truthful one.

## Throttled, visibility-aware flushes

Arrival and render cadence are decoupled twice:

1. `append` batches synchronous bursts via one `queueMicrotask` (`:135-139`).
2. Because transport events arrive as separate tasks, microtask batching alone
   would still flush per event — so `scheduleNormalFlush` (`:255-292`) throttles
   store pushes to one per `NORMAL_FLUSH_INTERVAL_MS = 100ms` window (500ms in
   tail mode, `:298-335`). The comment at `:247-254` documents exactly this
   two-layer rationale.

Visibility-awareness: when the document is hidden, the pending flush parks on a
`subscribeDocumentVisibility` callback instead of a timer (`:280-289`,
`:323-332`) — zero paints while hidden, one catch-up flush on re-show. This is
the technique's "buffer at wire speed, paint only when watchable" realized.

The guaranteed trailing flush is `forceFlush` (`:143-151`), called before state
reset so callers see final output even with a throttle window pending.

## Generation gating

`generation` (`:110`) increments on `reset`/`clear`; every scheduled flush
captures `gen` and goes inert on mismatch (`:215`, `:266`, `:309`) — the
run-attribution technique's consumer-side guard, here protecting against stale
microtasks and timers from a previous execution painting into the new one.

## Where the repo diverges from the technique

- **The record is not fed from a durable spill.** Lines beyond the ring are
  gone; the settled execution record keeps what the backend persisted, not
  what the sink held — acceptable because the backend writes its own log
  (`[STDOUT]` lines in the app log dir), but the two retention policies are
  not documented as a pair.
- **Boundary broadcast**: the sink is downstream of a global-broadcast event
  channel. The legacy census measured 26 line-bearing channels with 13 having
  zero frontend readers, and 166 `emit_line` call sites vs 13 record-only ones
  — the "produce into the buffer, not across the boundary" section of the
  technique is the standard this repo's emit-heavy pattern deviates from.
  `BackgroundJobManager::record_line` (`src-tauri/src/engine/background_job.rs`)
  is the in-repo counter-pattern to copy.
