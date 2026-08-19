# Golden path — Snapshot plus stream

> Situation node: `client-runtime/data-fetching/snapshot-plus-stream` ·
> [situation spine](../situation-spine.md) · recurrence **5** · risk **HIGH** ·
> `twoSided: true` · sides: **client** (**contradicted** — see [§12.1](#121--sidesclient-contradicted-the-only-gapless-implementation-in-the-app-is-a-rust-function)) ·
> convergence: **diverged** (**not tested** — see [§12.7](#127--what-was-not-done)) ·
> dimensions: **function · resilience · performance**
> Composed 2026-08-17 against `master` @ `cc27be561`. **Full contract** — nine sections plus §12.
>
> **Sweep size.** Every backend push-stream attachment in `src/` — **43 hook sites** plus the raw
> `listen()` population — enumerated three ways and reconciled. All **20** files attaching a stream
> through the unbuffered hooks opened and classified by hand for guard tokens. `createSingletonListener.ts`,
> `useTauriEvent.ts`, `executionSink.ts`, `executionSlice.ts`, `useRealtimeEvents.ts`,
> `useEventLog.ts`, `useCorrelatedCliStream.ts`, `LiveStreamTab.tsx`, `healingSlice.ts`,
> `useConversationRoster.ts`, `ProjectTeamPreviewModal.tsx` read in full or around every fetch and
> subscribe site; `commands/fleet/registry.rs` and `commands/fleet/commands.rs` read for the
> backend half.
>
> **Primed, not re-derived.** [`streaming-chat-transcript`](./streaming-chat-transcript.md) already
> executed this exact shape against the operator's real companion brain and measured **200 of 250
> rows discarded (80%)**. That number is **cited here, not re-measured** — see §7.2. Claims from
> [`live-log-stream-view`](./live-log-stream-view.md), [`stale-response-guard`](./stale-response-guard.md),
> [`backend-to-frontend-events`](./backend-to-frontend-events.md) and
> [`embedded-terminal-session`](./embedded-terminal-session.md) were verified on use.
>
> **Database:** the 2026-08-17 purge backup, copied read-only for the `persona_events` schema and
> row counts (**4,972 rows**); copy deleted. `cargo` was not run. No app instance was started.

---

## 0 The headline: the app's one gapless snapshot-plus-stream is 9 lines of Rust, and 34 of the 43 places that attach a stream in React have neither a buffer nor a count of what they lost

There is exactly one place in this codebase where attaching to a live stream and receiving its
history are **the same operation**:

```rust
// src-tauri/src/commands/fleet/registry.rs:1010-1019
pub fn subscribe_output(&self, session_id: &str) -> Option<String> {
    let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
    let session = map.get(session_id)?;
    let mut ring = session.output.lock().unwrap_or_else(|e| e.into_inner());
    ring.set_subscribed(true);
    Some(ring.snapshot())              // ← under the same lock
}
```

Exposed as `fleet_subscribe_terminal(session_id) -> Result<String, String>`
(`commands/fleet/commands.rs:107-114`). **You cannot subscribe without receiving the snapshot,
and no chunk can land between the two, because there is no "between".** The producer pushes into
the ring unconditionally so the PTY never blocks (`registry.rs:36-40`), and `subscribed` only gates
*forwarding* — the ring is the source of truth whether anyone is watching or not.

That is the answer. It appears once.

Everywhere else the app does the two halves separately, in JavaScript, in whichever order the
component author wrote them, and the window between them is unbuffered and uncounted. Measured
over `src/` (4,801 `.ts`/`.tsx` files):

| how a backend stream is attached in React | files | sites | early buffer | drop count |
| --- | ---: | ---: | :---: | :---: |
| `useTauriEvent` / `useTypedTauriEvent` | **20** | **34** | **no** | **no** |
| `useEventBusListener` / `createSingletonListener` | 9 | 9 | **yes (50)** | **yes** |

`createSingletonListener` (`src/hooks/realtime/createSingletonListener.ts`) is a genuinely good
piece of engineering — one Tauri subscription fanned out to N React subscribers, a 50-item
`earlyBuffer` for payloads that arrive before any subscriber registers (`:94-101`), a running
`earlyDroppedCount` surfaced to the UI through an `onDrop` callback (`:65-76`), a one-shot console
warning naming the cap, refcounted teardown, and an `attached: boolean` return so a caller can tell
"connected" from "connecting". It is the only subscription primitive in the fleet that can answer
*how much did I miss*.

`useTauriEvent` is the one 20 files reach for, and its own docstring explains the race it does not
close:

> ```
> // The cancelled flag is needed because `listen()` is async; if the
> // component unmounts (or the effect re-runs) before the subscription
> // resolves, we have to tear down whatever did register.
> ```

It handles the unmount case correctly and says nothing about the other direction: **events the
backend emits between the effect running and `listen()`'s promise resolving are not delivered to
anyone, and nothing counts them.**

Then the second half of the problem, which is the leaf's actual name. Of those 20 files, **17 also
fetch a snapshot**. Across all 20:

```
generation / epoch counter guarding the snapshot apply :  0
AbortController on the snapshot fetch                  :  0
```

Zero. The guards that *are* present are mount-scoped `let cancelled = false` flags (3 files) and
functional `setX(prev => …)` updaters (5 files), and neither answers this leaf's question. A
`cancelled` flag stops a fetch applying after **unmount**; it does not stop a snapshot applying
after a **stream event**. There is no epoch anywhere in the population, so in every one of these
17 pairs the last write wins, and which write is last is a race between two IPC round-trips.

The most compact instance is 50 lines of a modal
(`src/features/plugins/dev-tools/sub_projects/ProjectTeamPreviewModal.tsx:83-127`). Two code paths
call the same backend function and assign its result wholesale:

```ts
const refetchRuns = useCallback(async () => {
  const r = await listPipelineRuns(team.id);
  setRuns(r.slice(0, RECENT_RUN_LIMIT));                       // :86  (stream-driven)
}, [team.id]);

useEffect(() => {
  setRuns(null);                                               // :98     (blanks the list)
  Promise.all([...listPipelineRuns(team.id)])
    .then(([m, c, r]) => { setRuns(r.slice(0, RECENT_RUN_LIMIT)); });   // :107  (mount snapshot)
}, [open, team.id]);

useTypedTauriEvent(EventName.PIPELINE_STATUS, useCallback((payload) => {
  if (payload.team_id !== team.id) return;
  void refetchRuns();                                          // :126
}, [open, team.id, refetchRuns]));
```

A `PIPELINE_STATUS` event arriving while the mount `Promise.all` is in flight starts a second read
that can resolve **first**; the mount snapshot then lands on top of it and puts the *older* row set
back on screen, with no way for anything downstream to know. And `setRuns(null)` at `:98` is
[`overview-loading`](../../design/overview-loading.md) law 1 — *a fetch never hides rendered rows* —
violated on every reopen.

**The two ends of this codebase have opposite answers to the same question.** The Rust end made the
gap unrepresentable by returning the snapshot from the subscribe call. The React end has 34 attach
sites and not one epoch.

---

## 1 Trigger

1. *"Open the run and show me what it's doing."* — a detail view for something already in progress.
2. *"Fetch the recent ones, then keep it live."*
3. *"Re-fetch when the event arrives."* — **if you are about to call a loader from inside an event
   handler, you are here**, and you need §2(d).
4. *"It's showing stale data until I switch tabs."* / *"It jumped back to the old list."*
5. *"Why did the list get shorter?"* / *"My rows disappeared when the background job finished."*
6. *"Reconnect and resync."* — a reconnect is a second snapshot over a live stream, which is this
   situation at its most dangerous.

You are **not** here if there is no stream — repeated fetching on a timer is
[`polling-loop`](./polling-loop.md). You are not here if the only hazard is a response for a
*previous* entity arriving late — that is [`stale-response-guard`](./stale-response-guard.md), and
its `cancelled`/entity-key answer does not cover this one. You are not here for declaring the event
name and payload type — that is [`backend-to-frontend-events`](./backend-to-frontend-events.md).

---

## 2 The one way

**Make the subscription return the snapshot.** Everything else is a workaround for an API that
handed you two calls where one was needed. Concretely, in this order.

**(a) Prefer one command that attaches and hydrates atomically.** A backend that owns a bounded ring
and returns `snapshot()` from the same critical section that flips `subscribed` has no gap to
reconcile — `registry.rs:1010-1019` is nine lines and it is the whole path. The producer must push
into the ring **unconditionally**, so the buffer is complete whether or not anyone is watching;
subscription gates *forwarding*, never *recording*. This is the same producer-owns-the-bound rule
[`live-log-stream-view`](./live-log-stream-view.md) §2 arrived at from the other direction.

**(b) If you cannot have (a), attach first and buffer the gap.** Subscribe **before** you issue the
snapshot request, and hold every event that arrives until the snapshot has been applied — then
replay them on top of it. Attaching second guarantees a hole; attaching first without a buffer
merely moves the hole. `createSingletonListener`'s `earlyBuffer` (`:94-101`, `:78-86`) is this
mechanism and it already exists; reach for `useEventBusListener` or build a sibling with
`createSingletonListener(<event name>)` rather than calling `useTauriEvent` and hoping.

**(c) Never let a snapshot assign a live collection.** The snapshot is a **base**, not a truth:
merge it under what you already have, keyed by id, and let the newer of the two win per row. The
repo has the careful version — `prependMessages` in `companionStore.ts:811-818` dedupes by id and
returns `{}` when nothing is fresh — sitting immediately beside the clobbering one
([`streaming-chat-transcript`](./streaming-chat-transcript.md) §0). A whole-collection
`setX(fetched)` on a streamed cell is the defect; there is no version of it that is safe.

**(d) Carry an epoch, and check it after every await.** One monotonically increasing counter per
surface, captured before the request and compared before the apply:
`const gen = ++genRef.current; const rows = await load(); if (gen !== genRef.current) return;`.
This is the one guard that survives all three orderings — snapshot-after-event, two snapshots
racing, and a reconnect refetch — and **it appears zero times in the 20 files that need it.**
`executionSink` (`src/lib/execution/executionSink.ts:110`, `:215`, `:266`, `:309`) shows the shape
in production: a `generation` field bumped on `reset()`/`clear()`, captured into every scheduled
flush, and compared before the flush commits. Bump the epoch when the **entity** changes, not when
the component remounts — entity-keyed beats mount-keyed, per
[`stale-response-guard`](./stale-response-guard.md) §2.

**(e) A refetch-on-event is a snapshot, and it needs (c) and (d) too.** Calling a loader from an
event handler is legitimate — it is how you get a row the event payload does not carry — but it
turns every event into a race with every other event and with the mount fetch. If the payload
carries enough to apply directly, apply it directly; if it does not, refetch **the one row**, not
the collection (`healingSlice.ts:103-113` does exactly this and is the best refetch-on-event in the
repo), and still check the epoch.

**(f) On reconnect, clear the buffer before you replay.** A resubscribe that refetches without
resetting the dedupe index double-counts; one that resets the index without replaying loses the
overlap. Reset both together or neither. `LiveStreamTab.tsx:117-118` resets
`eventIdIndex.current` and the list in the same statement, which is right — and does it as an
*assignment* rather than a merge, which is §7.1.

**(g) A fetch never hides rendered rows.** [`overview-loading`](../../design/overview-loading.md)
law 1. `setRows(null)` before a refetch is this leaf's most visible failure, because on a live
surface the rows it blanks may be rows the stream put there and the snapshot will not return.

---

## 3 Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| `commands/fleet/registry.rs` — `OutputRing` (`:34-140`), `subscribe_output` (`:1010-1019`), `unsubscribe_output` (`:1021-1032`) | The backend half done right: an unconditionally-fed bounded ring, a `subscribed` flag that gates forwarding only, and one lock covering flip-plus-snapshot. |
| `commands/fleet/commands.rs:107-114` — `fleet_subscribe_terminal` | The IPC shape: `Result<String, String>`. The snapshot **is** the return value, so the caller cannot subscribe without it. |
| `src/hooks/realtime/createSingletonListener.ts` | The frontend half: one Tauri subscription per event name, an `earlyBuffer` (cap 50) for pre-subscriber arrivals, `earlyDroppedCount` + `onDrop`, per-frame coalescing (`:42-63`), refcounted teardown, and `attached: boolean`. |
| `src/hooks/realtime/useEventBusListener.ts` | The ready-made instance for `event-bus`. Use it rather than `listen('event-bus')`. |
| `src/lib/execution/executionSink.ts:110`, `:215`, `:262-272` | The epoch pattern in production: `generation` bumped on reset, captured into every deferred continuation, compared before commit. Copy the shape; the sink itself is a stream buffer, not a reconciler (see §12.2). |
| `companionStore.ts:811-818` — `prependMessages` | Merge-by-id that returns `{}` when nothing is fresh, so a no-op snapshot does not re-render. |
| `stores/slices/overview/healingSlice.ts:103-129` | Refetch-**one-row**-on-event with a functional `set((state) => …map)`, and a `not found`-only removal arm so a transient IPC error cannot delete a live row. |
| `display/UnifiedTable` (`isLoading` + `data`) | The three-state body, so the ghost never replaces rendered rows while a snapshot is in flight. |

**Do not invent** a second subscription manager. `useTauriEvent`, `createSingletonListener`,
`eventBridge.ts` and the raw `listen()` sites are already four; adding a fifth is how a surface ends
up subscribed twice and double-counting.

---

## 4 Steps

1. **Ask whether the backend can hand you both.** If the data is already buffered server-side (a
   ring, a log tail, a registry), add one command that returns the snapshot and marks the caller
   subscribed. This deletes the rest of this list.
2. **Choose the identity of a row before you write any code.** Every reconciliation below is
   keyed by it. If rows have no stable id, the merge in step 6 is impossible and you must fix that
   first.
3. **Attach the stream.** Through `createSingletonListener`/`useEventBusListener` if the event has
   more than one consumer, which is most of them.
4. **Buffer from the moment you attach.** Push arriving events into a local array; do not touch
   state yet.
5. **Issue the snapshot request, capturing the epoch.** `const gen = ++genRef.current;`
6. **Apply the snapshot as a base, then drain the buffer over it.** Check `gen !== genRef.current`
   first and bail. Then `setRows(prev => mergeById(snapshot, prev, buffered))`, newest-wins per id.
   Clear the buffer in the same update.
7. **Switch the handler to direct application.** From here every event mutates state directly,
   keyed by id — never a whole-collection assignment.
8. **And then stop.** The primitive owns the rest: cap, dedupe, coalescing, teardown. Do not add a
   poll "just in case" — that is a third writer to the same cell and it will race the other two.

**Before writing the gate, ask whether the signature can make the mistake impossible.** For this
leaf it can, and §9.1 says how far.

---

## 5 Anti-patterns

**5.1 `setRows(fetched)` on a streamed cell.** *Failure mode:* every row the stream added since the
request was issued is destroyed, and nothing observes it.
[`streaming-chat-transcript`](./streaming-chat-transcript.md) executed the arithmetic: **200 of 250
rows, 80%**, on a turn the user did not ask for.

**5.2 Subscribing after the fetch resolves.** *Failure mode:* a hole exactly the width of the IPC
round-trip, in the one period when the entity is most likely to be emitting — you just opened it
because it is running.

**5.3 A `cancelled` flag as the guard.** *Failure mode:* it is a mount-scoped answer to an
entity-scoped question. It correctly prevents an apply after unmount and does nothing at all about
a snapshot landing after a stream event. Three of the 20 files have one and are no safer for it.

**5.4 Refetch-on-event with no sequencing.** *Failure mode:* N events in flight produce N reads that
can resolve in any order, and the last to land wins regardless of which is newest.
`ProjectTeamPreviewModal.tsx:83-127` and `useConversationRoster.ts:36-52` + `:57-87` are both this.

**5.5 Blanking the list before the refetch.** *Failure mode:* law 1. `setRuns(null)`,
`setEvents([])`, `setLines([])`. On a live surface the rows you blank include rows the snapshot will
not return.

**5.6 A stream with no snapshot at all.** *Failure mode:* the surface shows only what happened
after you looked at it, and calls that "live". `useRealtimeEvents` starts from
`useState<RealtimeEvent[]>([])` (`:112`) and never fetches — the Events realtime view is blind to
the 4,972 rows already in `persona_events`.

**5.7 A snapshot with no stream, refreshed by remount.** The mirror of 5.6, and the reason people
add a poll, which becomes a third writer (5.8).

**5.8 Three writers to one cell.** *Failure mode:* a mount fetch, a stream handler and a refetch
handler all assigning the same array with no shared ordering discipline. This is 5.1 and 5.4
compounded and it is what §0's modal does.

**5.9 Fixing the race by editing a dependency array.** *Failure mode:* it removes today's trigger
and leaves the mechanism. See §7.1 — the fix shipped, the comment records the loss it prevented, and
the first-mount race it does not mention is still open.

---

## 6 Evidence

**The one site to copy: `src-tauri/src/commands/fleet/registry.rs:34-140` plus `:1010-1032`.** Read
the `OutputRing` doc comment first — *"The reader task ALWAYS pushes here (so the PTY pipe never
fills and claude never blocks); it only forwards bytes over IPC when `subscribed` is set. On
(re)subscribe the command replays `OutputRing::snapshot` so a freshly-focused terminal hydrates
from the ring instead of from a re-streamed full history."* That paragraph is §2(a) and (b) and (f)
in one place, and the code under it is nine lines. Then read
`commands/fleet/commands.rs:107-114` for the IPC shape that makes it unforgettable.

**Frontend: `src/hooks/realtime/createSingletonListener.ts`, all 177 lines.** `:88-118`
(`ensureListener`, including the teardown when every subscriber left while setup was in flight),
`:94-101` (the early buffer and its cap), `:65-76` (`recordEarlyDrop` — the only place in this
codebase that counts what a stream lost), `:142-169` (the subscribe effect, which flushes the buffer
*synchronously* on registration and only then awaits `attached`).

**Refetch-on-event done right: `stores/slices/overview/healingSlice.ts:103-129`.** It refetches the
**one** affected issue, applies it with a functional `set((state) => …map)`, and — the part worth
copying — removes the row only on a definitive `not found`, logging and keeping it on any other
error, because *"a transient failure is not evidence the issue was deleted"* (`:115-120`).

**Epoch, in production: `src/lib/execution/executionSink.ts`.** `generation` (`:110`), bumped by
`reset()` (`:155`) and `clear()` (`:175`), captured at `:137`, `:262`, `:305`, and compared at
`:215`, `:266`, `:309` before any commit. Re-bound on store creation at
`stores/slices/agents/executionSlice.ts:189-192`. This is the mechanic §2(d) asks for, already
written, in a file none of the 20 pairs import.

**Counter-evidence:** `ProjectTeamPreviewModal.tsx:83-127` (§0), `LiveStreamTab.tsx:113-124` (§7.1),
`useConversationRoster.ts:36-52` (§7.4), `useCorrelatedCliStream.ts:74-124` (§7.3).

---

## 7 Deviations

### 7.1 `LiveStreamTab` documents the exact loss, fixes the trigger, and leaves the mechanism

`src/features/triggers/sub_live_stream/LiveStreamTab.tsx:105-124`. The comment above the mount
effect is unusually good and worth quoting, because it is the repo diagnosing this leaf correctly:

> *"…keying this on `personas` only caused spurious re-runs on every roster mutation (health-score
> refresh, status poll, add/rename/enable) — each one hard-reset `eventIdIndex` and replaced the
> buffer with the fresh top-100, **discarding up-to-200 already-buffered live events**."*

The fix applied was removing `personas` from the dependency array. The body is unchanged:

```ts
listEvents(100).then((recentEvents) => {
  if (!stale) {
    eventIdIndex.current = new Set(recentEvents.map((e) => e.id));   // :117
    setEvents(recentEvents);                                          // :118
  }
});
```

That still runs once, on mount, *after* `useEventBusListener` has begun delivering
(`:128`) — and because `createSingletonListener` is a **singleton**, the listener is frequently
already attached from another mounted consumer, so events flow into `setEvents(prev => …)`
immediately and are then replaced wholesale when `listEvents(100)` resolves. A dependency array
is a fix for one caller of the mechanism; §2(c) is a fix for the mechanism. The file is otherwise
the strongest live surface in the app — rAF batching, a 200-row cap with index eviction, an
id-keyed in-place update for status changes, and a pause queue that replays in original order
(`:174-198`).

### 7.2 The companion transcript — cited, not re-derived

Five whole-collection message setters, one of which fires on a background turn; **200 of 250 rows
discarded, 80%**; the careful merge door (`prependMessages`) sitting beside the clobber door
unused. Measured and published by
[`streaming-chat-transcript`](./streaming-chat-transcript.md) §0 against the operator's real brain
(1,068 episodes, 3 conversations). Four of this leaf's 20 unbuffered-attach files are that surface
(`athenaChatEvents.ts` ×6 sites, `athenaChatNavigation.ts` ×6, `athenaChatShell.ts`,
`athenaChatStream.ts`). **Verified on use, not re-measured** — I confirmed the four files and their
14 attach sites are in this population and that `athenaChatStream.ts:162`'s
`live.setMessages(msgs)` is still a whole-collection assignment guarded only by
`live.activeConversationId === conv`.

### 7.3 `useCorrelatedCliStream` attaches after the run has already started, with nothing to replay from

`src/hooks/execution/useCorrelatedCliStream.ts:74-124`. `start(nextRunId)` sets `setLines([])` and
then `await listen(outputEvent, …)` — so the subscription is established after the caller has
already told the backend to run, and every line emitted in between is gone. There is no snapshot
call anywhere in the file. The correlation itself is good (`String(raw[idField]) !== nextRunId`
rejects other runs' lines — an entity-keyed filter, exactly what
[`stale-response-guard`](./stale-response-guard.md) §2 prescribes) and the buffering is careful
(5,000-line cap, 4,096-char clamp, adjacent-duplicate suppression). The gap is structural: this hook
is the client half of a stream whose producer keeps no ring, so §2(a) and §2(b) are both unavailable
to it and the fix has to start in Rust. Compare `registry.rs`, which solved the same problem for
PTY output.

### 7.4 `useConversationRoster` refetches the whole roster on every turn summary, unordered

`src/features/plugins/companion/useConversationRoster.ts:36-52`, `:57-87`. `refresh()` reads the
full conversation list and `setConversations(normalized)` assigns it. It runs on mount *and* on
every `companion://turn-summary` — which `send_turn` emits for **every** turn including background
ones. Two in-flight refreshes resolve in arrival order, not issue order, and there is no epoch. The
observable symptom is an unread badge that flickers backwards. The local normalization
(zeroing the active thread's unread, `:39-41`) makes it worse: an older response re-applies an older
unread count over a newer one.

### 7.5 Zero of the 20 unbuffered-attach files has an epoch or an AbortController

Hand-classified, all 20 opened. `generation`/`epoch`/`seq`/`requestId` counter: **0**.
`AbortController`: **0**. `let cancelled = false`: 3 (`useTraceData.ts`, `ContextMapPage.tsx`,
`useShipData.ts`) — mount-scoped, see 5.3. Functional `setX(prev => …)` on **some** write: 5.
**17 of the 20 also fetch a snapshot**, so 17 are pairs with no ordering discipline of any kind.

> The one `AbortController` in the neighbourhood belongs to `useEventLog`'s *search* path
> (`:130-132`, `:162-163`) — a different concern (a debounced server search), correctly guarded, in
> a file whose *stream* path has no such guard.

### 7.6 The Events realtime view is a stream with no snapshot

`src/hooks/realtime/useRealtimeEvents.ts:112` — `useState<RealtimeEvent[]>([])`, and the only `@/api`
import in the file is `testEventFlow` (a *writer*). The panel shows nothing that happened before the
tab was opened, against 4,972 rows in `persona_events` (backup DB, 2026-08-17). It does surface
`earlyDroppedCount` through `useEventBusListener`'s `onDrop` — so it is the one surface in the app
that can tell the user it lost events, and it cannot tell them it never had the earlier ones.

### 7.7 The Overview event log's two sources are reconciled by the user, not the code

`src/features/overview/sub_events/libs/useEventLog.ts` holds three collections — `serverResults`
(search, `:58`), `olderEvents` (pagination, `:66`) and the store's `recentEvents` (stream, via
`pushRecentEvent` at `:116-125`). The stream half is correct: a guard rejects the CDC
`{action,table,rowid}` notifications that share the channel (`:116-119`), and `pushRecentEvent` is
capped. But `setServerResults(result.events)` (`:163`) and the three `setOlderEvents([])` resets
(`:251`, `:318`, `:393`) are whole-collection assignments over the same conceptual list, and which
one the UI shows is decided by filter state rather than by recency.

### 7.8 `healingSlice` is the best refetch-on-event and still clobbers on the snapshot side

`stores/slices/overview/healingSlice.ts`. The handler (`:103-129`) is exemplary. `fetchHealingIssues`
(`:39-46`) is `set({ healingIssues: issues })` — a whole-collection assignment that will overwrite a
concurrently-applied per-issue update. It is *benign today* because both halves read the same
backend, so the snapshot is usually at least as fresh — and that is precisely the condition that
makes it a latent defect rather than a visible one: the moment the stream starts carrying something
the snapshot does not (a progress percentage, a transient state, an optimistic local edit), the
clobber becomes lossy with no code change.

### 7.9 Four subscription mechanisms, and the two that matter disagree about what a gap is

`useTauriEvent`/`useTypedTauriEvent` (34 sites), `createSingletonListener` (9), raw `listen()`
(45 files / 68 matches per the existing `unmanaged-tauri-subscription` baseline), and
`src/lib/eventBridge.ts` (1,254 lines, `globalThis.__personasEventBridge`). Only one of the four
buffers or counts. A developer choosing between them has no signal that they differ on this axis:
the hook is shorter, typed, and documented, and it is the wrong one for a live entity.

---

## 8 Gaps — what the primitive genuinely cannot do

**8.1 Tauri's `listen()` is a registration, not a replay.** Events emitted before it resolves are
never routed to the webview at all. `createSingletonListener`'s early buffer covers *"attached, but
no React subscriber yet"* — it cannot cover *"not yet attached"*. Closing that window requires the
backend to hold a ring, i.e. §2(a). This is the structural reason the fleet terminal is the only
gapless surface: it is the only one whose producer buffers.

**8.2 The early buffer is capped at 50 and the cap is not configurable.**
`createSingletonListener.ts:32`. A burst larger than 50 during app start drops the excess; the
count is preserved, the payloads are not.

**8.3 Merging needs a stable row id, and one channel multiplexes rows that have none.** The
`event-bus` channel carries full `PersonaEvent` payloads *and* lightweight CDC
`{action, table, rowid}` notifications, which two separate call sites have to filter out by hand
(`LiveStreamTab.tsx:130-133`, `useEventLog.ts:116-119`). A merge cannot key on an id the payload
does not have.

**8.4 An epoch cannot order two writers that do not share one.** The guard in §2(d) works because
one surface owns the counter. Where a store field is written from a slice action *and* a component
effect *and* a bridge listener, there is no single place to put it — which is §7.7, and the fix is
to reduce the number of writers, not to add a third guard.

**8.5 The census cannot express "this pair has no epoch".** That is a two-part condition over two
regions of a file, and the runner matches one pattern over whole-file content. §9.2 is what it can
express, and §9.3 says what the other half needs.

---

## 9 The missing gate

### 9.1 First: the type

**Make the two calls one call, and give React a hook that does not hand out a raw setter.**

*Backend, and this is the one that removes the class:* every stream-attach command returns its
snapshot. `fleet_subscribe_terminal(session_id) -> Result<String, String>` is the template — the
return type **withholds the dangerous freedom** (doctrine Q5): there is no way to subscribe and not
receive the history, so §7.3's structural gap cannot be written. It is not Q3 (a type nobody
constructs): the pattern applies to every producer that already buffers.

*Frontend:* a `useLiveCollection({ subscribe, fetchSnapshot, keyOf, applyEvent })` built on
`createSingletonListener`, returning `rows` and nothing else. Because it never returns a setter,
`setRows(fetched)` is unspellable at the call site, and the epoch lives inside the hook where it
cannot be forgotten. Held against the qualifications: **Q1 applies and limits it** — a closed hook
signature constrains exactly what it names, so a caller who also keeps a parallel `useState` for
the same rows is untouched by it (§7.7 is that shape today); **Q7 applies** — the fix is to *stop
handing back* the collection setter, not to make some new argument required.

**Where types cannot reach, item 5** bounds both: the events arrive over a serialization boundary
as JSON, so nothing in TypeScript can guarantee the payload carries `keyOf`'s field. §8.3 is that
limit made concrete.

**Deferred, not applied.** Both change what live surfaces render.

### 9.2 The ratchet

**Signal:** a backend stream attached through a hook that neither buffers pre-subscription arrivals
nor reports how many it dropped.
**Condition it is a proxy for:** *a stream attachment whose pre-attach window is neither buffered
nor counted.* An adopting repo re-derives its own proxy — for a WebSocket client the proxy is a
`ws.onmessage` assigned without a pending-queue; for an SSE reader it is an `EventSource` with no
`Last-Event-ID`. **Do not port the token**; port the question.

**Positive control, and it partitions the anchor.** The anchor is "attach a backend push stream
through a React hook". `useTauriEvent`/`useTypedTauriEvent` → **20 files / 34 matches**;
`useEventBusListener`/`createSingletonListener` → **9 files / 9 matches**. 34 + 9 = **43**, the
whole anchor, with nothing unclassified. This is the partitioning form doctrine §4 calls strongest.

**Hand-verified precision: 20/20 files opened** (§7.5's classification pass). Every one attaches a
backend event through a hook with no early buffer and no drop count; **17 of the 20 additionally
hold a snapshot for the same state**, which is the full defect. **1 raw match was excluded as
prose** — `src/api/templates/teamPresets.ts:62`, a JSDoc line telling the reader to
*wire `useTypedTauriEvent(EventName.TEAM_PRESET_ADOPT_PROGRESS, …)`* — dropped by
`ignoreCommentLines`, which is why that option is on. The primitive's own two definitions
(`src/hooks/useTauriEvent.ts:34`, `:76`) are excluded by path: they are the anchor, not call sites.

**This rule reports a real condition and is deliberately NOT a claim that `useTauriEvent` is
forbidden.** It is the right hook for a fire-and-forget signal (a toast, a navigation nudge, a
"reload your settings" ping) and six of the 20 files use it that way. It is the wrong hook for a
live entity, and the count is the population that has to be reviewed, not a bug list. Ratcheting it
means: **no new live surface may be built on the unbuffered form.**

**Overlap, measured at SITE level against the FINAL pattern** (doctrine §4). Nearest neighbour is
`unmanaged-tauri-subscription` (`backend-to-frontend-events`; raw
`(?<![.\w$])listen\s*(?:<[^>()]*>)?\s*\(` over `src`, baseline 45 files / 68 matches).
**Site overlap: 0** — the two patterns match disjoint tokens and no offset appears in both.
**File overlap: 1**, `src/hooks/useTauriEvent.ts`, which this rule excludes by path. The other
neighbour, `hand-rolled-stale-token` (`stale-response-guard`; `const X = ++Y;`, 36 files / 42
matches), has **0** site overlap: it matches the epoch **increment**, which — as §7.5 measures —
occurs in **none** of these 20 files. The two rules are complements: one counts surfaces that need
an epoch, the other counts the epochs that exist.

**Fail-loud:** `floor: 4000` against 4,801 walked files; the runner fails on a zero-file match, a
stale `exclude`, a rise, and an unratcheted drop. If §9.1's `useLiveCollection` lands and this
reaches zero, **delete the rule** — the census cannot express "must be zero" and a rule pinned at 0
is a gate that can never fail.

```json
{
  "id": "unreplayed-stream-attach",
  "goldenPath": "docs/concepts/golden-paths/snapshot-plus-stream.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\b(?:useTauriEvent|useTypedTauriEvent)\\s*[<(]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A backend stream attached through a hook that neither buffers events arriving before listen() resolves nor reports how many it dropped. Proxy for: a stream attachment whose pre-attach window is neither buffered nor counted."
  },
  "exclude": [
    { "path": "src/hooks/useTauriEvent.ts", "reason": "the primitive itself — its two definitions are the anchor, not call sites" }
  ],
  "baseline": { "files": 20, "matches": 34 },
  "floor": 4000
}
```

```json
{
  "id": "unreplayed-stream-attach-positive-control",
  "goldenPath": "docs/concepts/golden-paths/snapshot-plus-stream.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\b(?:useEventBusListener|createSingletonListener)\\s*[<(]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL: the compliant form — a subscription that buffers early arrivals (cap 50) and surfaces a drop count. Partitions the same anchor: 34 unbuffered + 9 buffered = 43 hook attach sites, nothing unclassified."
  },
  "floor": 4000
}
```

Validated standalone in a private registry (`mkB-private-rules.json`, filename unique to this
composer) — `run-census.mjs --check` exits **0** at these baselines. The full registry was **not**
run.

### 9.3 The half that cannot be gated, and what would gate it

The leaf's actual defect — *a whole-collection assignment applied to a cell a stream also writes* —
is a **two-part condition over two regions of one file**, and the census matches one pattern over
whole-file content. I built and rejected three candidates:

1. **`.then(setX)` point-free snapshot apply** — a promise continuation that is a bare setter, so no
   guard, no epoch and no error arm are even expressible. **50 files / 61 matches**, and only **7**
   of those files also attach a stream. Precision as *this leaf's* defect ≈ 14%. Most of the 61 are
   scalars (`.then(setAppVersion)`, `.then(setMaximized)`) and correct. **Rejected**: a gate that
   fires on correct content is worse than no gate.
2. **A tempered pattern from the subscribe call into its inline handler body** — matches the
   *markup* a handler happens to wear (inline arrow vs `useCallback` vs named function), which is
   the exact failure the portability test recorded: four §9 signals keyed on local formatting, all
   four scoring zero true positives in a sibling that had the condition at scale. **Rejected on
   principle, before measuring.**
3. **A backreferenced `const X = await f(…); setY(X)`** — expressible, but it is the normal and
   correct shape for a non-streamed surface, so it measures nothing about this leaf.

What would work is **not** a census rule but an **inventory**: enumerate every state cell written
from a subscription handler, then assert each has exactly one writer or an epoch. That is a
TypeScript AST pass (an ESLint rule with `RuleTester` fixtures is the right host —
[`inline-busy-state`](./inline-busy-state.md) §9 argues the same split), and it must **exit non-zero
when it finds zero subscription handlers**, or it becomes the `check-csp-hosts.mjs` failure: a
checker that silently measured nothing, twice, and would have passed forever.

---

## 12 Corrections

### 12.1 `sides: "client"` — contradicted. The only gapless implementation in the app is a Rust function

The spine says `client`, and the client is where the 34 unguarded attach sites are — so unlike the
doctrine's seventh contradiction, the label is not *inverted*. It is **incomplete in the way that
matters most**: the exemplar, the one construction in this codebase with no gap to reconcile, is
`registry.rs:1010-1019`, and it works precisely because it is **not** on the client. A
client-scoped brief would have found 34 violations, prescribed a buffer, and never discovered that
the answer is to stop needing one. Both halves are load-bearing and the node already carries
`twoSided: true` in the same object — the internal contradiction the doctrine records. Ledger:
`client` moves to 8 contradicted / 2 upheld.

### 12.2 The brief said `executionSink` is "the best answer in the repo" for this leaf. It is not an answer to this leaf at all

This is the correction I most expect to be inherited, because it is one hop from a true statement.

`src/lib/execution/executionSink.ts` never fetches a snapshot. It has no `invoke`, no `@/api`
import, and no reconciliation of any kind — it is a **stream-only** ring buffer (10,000 lines,
10 MB byte budget, tail mode, throttled flush) whose `generation` counter guards *its own scheduled
flushes* against a `reset()`/`clear()` that happened while a microtask or `setTimeout` was pending
(`:215`, `:266`, `:309`). The word "snapshot" in `executionSlice.ts` (`:569-570`) means something
else again: a copy of the finished output kept in a module-local `Map` for one-shot reading after a
run ends.

The lineage of the error is traceable. `.claude/CLAUDE.md`'s state-management section names
`executionSink` as the repo's good answer for **HMR-safe singletons**, after an earlier version of
that file had inverted its meaning; the correction is right and the file is right. The brief carried
the phrase across into a different leaf, where it does not hold.

**What survives, and it is the useful half:** `executionSink`'s epoch *pattern* — capture
`generation` into every deferred continuation, compare before committing — is exactly what §2(d)
prescribes, and it is the only production instance of that pattern in the frontend. So the brief
pointed at the right file for the wrong reason. §3 and §6 cite it as the epoch exemplar and say
explicitly that it is not a reconciler.

### 12.3 My two implementations disagreed, and neither was wrong — they answered different questions

Implementation A (library-assisted, using `scripts/census/lib/instruments/stripComments.mjs`)
counted **file-level co-occurrence**: files holding both a subscribe token and a data-fetch import.
It returned **0** files using `invokeWithTimeout` directly beside a subscription, and **45** files
subscribing while importing from `@/api/*`. Implementation B (bespoke, its own comment blanker and
brace matcher) counted **setter-level co-occurrence**: the same `setX` written from both a stream
handler region and an awaited read. It returned **31** files, plus 12 stream-only.

Neither number is the population, and taking either would have been wrong. A's zero is a genuine
finding — this app routes **all** IPC through `@/api` modules, so a co-occurrence scan keyed on
`invokeWithTimeout` is structurally blind here. B's 31 includes `setTimeout`, `setInterval` and
`setState` noise and misses every pair split across two files by a Zustand store, which is where
the biggest surfaces live (`healingSlice`, `chatSlice`, `fleetSlice`). **The unit had to change
from "file" to "attach site" before the two could be reconciled**, and at that unit the count is
exact and partitioned: 43 = 34 + 9.

### 12.4 The brief's canonical-bug list is right, and one of the three is more common than the other two combined

The brief named three: (i) a snapshot landing after a stream event and overwriting it; (ii) a stream
subscribed before the snapshot is requested, dropping events in the gap; (iii) a reconnect that
refetches without clearing the buffer, double-counting.

Measured: (i) is in **17 of 20** unbuffered-attach files — every pair, since none has an epoch.
(ii) is present in **all 34** attach sites structurally (Tauri's `listen()` is async and nothing
buffers), but is *severe* only where the entity is already running, which is §7.3's shape. (iii) I
looked for and **did not find** in this population: the two files with explicit reconnect logic
(`LiveStreamTab.tsx:117-118`, `:200-203`) reset the dedupe index and the list **together**, which is
the correct discipline. The brief's ordering was right and its (iii) is, on this evidence, a hazard
the repo has already avoided — worth saying, because a deviation list that reported it anyway would
be padding.

### 12.5 The brief's framing of `overview-loading` law 1 sharpened one deviation and mis-sized another

*"A snapshot arriving mid-stream that clears the list is law 1 violated at its most visible"* — yes,
and `ProjectTeamPreviewModal.tsx:98` (`setRuns(null)` before the refetch) is that, on a live
surface, on every reopen. But the leaf's dominant failure is **not** visible as a flash: it is a
snapshot that lands with plausible-looking rows and silently drops the newest ones. Law 1 catches
the blank; nothing catches the substitution. That asymmetry is why §9.3 argues for an inventory
rather than a UI-shaped check.

### 12.6 A neighbour's prescription and this one compose safely — checked, per doctrine §6

[`stale-response-guard`](./stale-response-guard.md) §2 prescribes `let cancelled = false` for
mount-only concerns and an entity key otherwise. Following it and following §2(d) here produces a
surface with **both** a cancel flag and an epoch, which is correct and not redundant — they answer
different questions (5.3). [`polling-loop`](./polling-loop.md) §2's *"first ask whether the backend
can just tell you"* points **into** this leaf rather than at a conflict. The one interaction worth
naming: [`live-log-stream-view`](./live-log-stream-view.md) §2 says *"never move the viewport the
user is holding"*, and §2(c)'s merge is what makes that possible — a whole-collection assignment
changes scroll height under the reader whether or not the autoscroll logic is correct. The two
prescriptions reinforce; neither undoes the other.

### 12.7 What was NOT done

- **The convergence label was not tested.** `convergence: "diverged"` stands untested against
  `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`, `../ascent`. The doctrine's
  ledger is unchanged. Note that `streaming-chat-transcript` §0 already reports one strong sibling
  result adjacent to this leaf — `personas-web/src/stores/eventStore.ts:91-117` **merges instead of
  replacing**, with a comment naming this exact failure — and that repo is a **port and a downstream
  consumer**, so per `shared-facts.json#lineage` it is disqualified as corroboration and admissible
  only as the cost evidence it is.
- **No app instance was started**, so no gap was timed. Every claim about ordering is structural.
- **`cargo` was not run.**
- **Deferred fixes owed to the register** (append at the orchestrator's next free numbers):
  (a) an epoch guard on `ProjectTeamPreviewModal`'s two writers to `runs`, and removing
  `setRuns(null)` at `:98`; (b) `useConversationRoster.refresh()` carrying a sequence number;
  (c) `LiveStreamTab`'s mount fetch merging by id instead of assigning; (d) a snapshot for
  `useRealtimeEvents` (the panel is blind to everything before it opened); (e) a ring +
  snapshot-on-attach for the correlated CLI stream, modelled on `OutputRing`;
  (f) `useLiveCollection` per §9.1.
