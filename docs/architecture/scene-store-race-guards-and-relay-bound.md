# Scene store race guards + browser-bridge relay bound

**Status:** implemented 2026-08-30 · **Register:** Wave-3 item 3 (residual of
the 2026-08-29 architecture round) · **Registry:**
`software-engineering/client-state/async-race-guards`;
`software-engineering/backend-platform/resilience` (bounded queue + counted
shed, per the rate-limiting convention that a shed is "an event worth
counting, not a silent reset").

## Part A — sceneStore keyed token map + in-flight dedup

### Current state

`src/features/teams/sub_mastermind/lib/sceneStore.ts` carries one
latest-wins token per family (`guards`, :141-148) — the 2026-08-29 fix — but
two residuals remain:

1. **`invalidateScans` writes outside any token** (:196-210): a per-project
   merge with no guard at all. A stale scoped refresh can land after (and
   partially overwrite) a newer full `loadScans`; two invalidations for the
   same project race each other; and the merge target (`s.scans`) may be a map
   a superseding full reload is about to replace.
2. **N mounts = N calls**: `loadMeta`/`loadScans`/`loadGoals`/`loadRunners`
   have multiple mount-time callers (`MastermindPage.tsx:231-234`,
   `MastermindGoalsModal.tsx:74`, StrictMode double-mount) and no in-flight
   dedup — concurrent identical requests each fire their own IPC.

### Target shape (the technique's two guards, both centralized)

- **Keyed latest-wins** (`createKeyedLatestWins` added to
  `src/stores/util/latestWins.ts` — the one authority for the mint/compare
  pair): `invalidateScans` takes a token in the `scans:<projectId>` slot —
  keyed exactly like the write it protects — AND captures the scans *family*
  generation at dispatch (peek, not mint). Its completion is inert when either
  its keyed token was superseded (a newer invalidation for the same project)
  or the family generation moved (a full `loadScans` owns the whole map now).
  Inert means silently dropped — a stale response is normal delivery, not an
  error.
- **In-flight dedup registry** (`createInFlightRegistry` in
  `src/stores/util/inFlight.ts`): keyed by everything that changes the answer
  (`family`, plus `projectId` for scoped invalidations). A caller finding its
  key in flight joins that promise; the entry is removed on settlement —
  success AND failure (removal-on-failure is the half that gets forgotten).
  The four argument-less family loads dedup on their family name.
  `MastermindGoalsModal`'s post-mutation refresh must NOT join a
  pre-mutation flight, so the registry supports `replace` (start a fresh
  flight and repoint the key; the superseded flight's write goes inert via
  the family token) and the modal's path uses it.

### Out of scope

- `loadSentry` / `loadLlmSpend`: argument-carrying (projects + credentials)
  and already interval-throttled; a dedup key would have to fingerprint the
  argument arrays for marginal benefit. Deliberately left as-is.
- Cancellation (abort) — an optimization layered on tokens, not a substitute.

## Part B — bound the browser-bridge relay channel

### Current state

`src-tauri/src/browser_bridge/relay.rs:87`:
`mpsc::unbounded_channel::<Message>()` queues outbound frames to the Chrome
extension. Every `send_command` clones the sender and `tx.send(...)` never
blocks and never fails while the connection slot is occupied — a stalled
extension socket (service worker suspended mid-write, half-open TCP) lets the
queue grow without limit while every queued caller's timeout burns; memory is
the only backstop.

### Target shape

- `mpsc::channel::<Message>(RELAY_QUEUE_CAP)` (cap 256 — far above the
  handful of in-flight commands the pending map ever holds, small enough that
  a stalled socket is detected in kilobytes, and stated in a comment as a
  local decision, not an inherited number).
- **Shed policy: reject-new, loudly, at the door.** `send_command` uses
  `try_send`; on `Full` it removes its pending entry and fails THAT command
  with an explicit queue-full error naming the condition (the caller already
  handles errors and timeouts), and logs a constant-message warn with fields.
  Rationale: every frame has an awaiting caller with a deadline — blocking
  would hide the stall inside those deadlines, and dropping *old* frames
  would break request/response pairing for commands already counted as sent.
  A shed is a counted event, not a silent reset.
- Disconnect teardown unchanged (writer task ends when `rx` drops; pending
  map failed en masse).

### Out of scope

- Backpressure on event frames from the extension (inbound path is
  read-and-dispatch, no queue).
- Keepalive/reconnect policy (Phase 2 extension work).

## Acceptance checks

- Unit tests (vitest, `sceneStore.test.ts` + new `inFlight.test.ts`):
  concurrent same-key callers share one flight; a failed flight clears its
  entry; `replace` starts a new flight; a stale `invalidateScans` completion
  is inert after a newer full `loadScans` (family generation) and after a
  newer same-project invalidation (keyed token); distinct projects do not
  cancel each other.
- Rust: `cargo check -p personas-desktop --features desktop` clean; relay
  compiles with the bounded sender; a queue-full send fails the command
  rather than wedging (witnessed by a unit test on the try_send arm where
  feasible without a socket).
- Census ratchet does not rise; typecheck + scoped vitest green.
