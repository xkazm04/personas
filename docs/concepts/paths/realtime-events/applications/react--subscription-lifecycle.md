---
layer: application
subject: realtime-events
technique: subscription-lifecycle
stack: react
---

# Subscription lifecycle — React over a Tauri IPC boundary

How this repo implements the [subscription-lifecycle](../techniques/subscription-lifecycle.md)
technique for Tauri backend→frontend events consumed by React components and
Zustand stores.

## The cancelled flag: `useTauriEvent.ts`

`src/hooks/useTauriEvent.ts` is the plain (non-singleton) form, and it is the
cancelled-flag discipline verbatim — Tauri's `listen()` is async, so teardown
can race the handshake:

```ts
useEffect(() => {
  let unlisten: UnlistenFn | undefined;
  let cancelled = false;
  listen<T>(eventName, (event) => {
    if (cancelled) return;          // zombie guard: handler inert after teardown
    handler(event);
  })
    .then((fn) => {
      if (cancelled) fn();          // handshake lost the race → release immediately
      else unlisten = fn;
    })
    .catch(silentCatch(errorContext));
  return () => {
    cancelled = true;
    unlisten?.();
  };
}, [eventName, handler, errorContext]);
```

Both halves of the technique are present: teardown sets `cancelled` and
releases the handle *if it exists*; the `.then` continuation checks
`cancelled` first and releases the just-created subscription instead of
storing it. The hook's own doc comment names the incident class it retired
("the asynchronous-cleanup race that bit `ContextMapPage` and friends").
`useTypedTauriEvent` is the same shape routed through `typedListen`, so the
payload type comes from the registry's `EventPayloadMap` rather than the call
site's assertion.

The flag is per-effect-run (a fresh `cancelled` per dependency change), which
is the technique's per-attempt identity requirement — a rapid detach/re-attach
has two independent flags in flight, and the stale handshake cannot adopt the
new attempt.

## Singleton + fan-out + early buffer: `createSingletonListener.ts`

`src/hooks/realtime/createSingletonListener.ts` is the boundary-singleton
topology, one factory call per event name:

- **One native listener** — `ensureListener()` memoizes a single
  `listen(eventName)` behind `setupPromise`; N components using the returned
  hook share it.
- **In-process fan-out** — subscribers are a `Set`; attach/detach are set
  operations, synchronous, unable to race the boundary.
- **Last-out reaping** — `teardownIfEmpty()` releases the native listener
  when the subscriber set empties, and the setup continuation handles the
  in-flight case: if all subscribers left *while the handshake was pending*
  (`setupInFlight`), the freshly resolved `unlisten` is called immediately
  rather than stored. Same cancelled-flag idea, expressed as a
  zero-subscribers check at resolution time.
- **Bounded early-arrival buffer** — payloads that arrive with zero
  subscribers are buffered (`MAX_BUFFER = 50`) and flushed to the next
  subscriber; overflow is **counted** (`earlyDroppedCount`), warned once
  loudly, and surfaced to consumers via the optional `onDrop` callback —
  including drops that happened *before* the consumer mounted, delivered at
  attach. That last detail is the drop-ledger rule done right: a late
  subscriber learns the gap exists.
- **Per-frame coalescing** — delivery routes through a `requestAnimationFrame`
  queue so a burst of payloads in one backend tick becomes one dispatch pass
  per frame, letting React 18's automatic batching collapse N events into one
  render (the [coalescing-and-batching](../techniques/coalescing-and-batching.md)
  technique riding along at the fan-out point). The buffer drain routes
  through the same queue, so a 50-entry replay does not become 50 renders.

## Where this repo deviates from the technique

- **Early-buffer eviction keeps the oldest, sheds the newest**: the buffer
  admits payloads only while `length < MAX_BUFFER`, so once full, the *new*
  arrival is dropped. The technique prescribes the inverse (retain newest,
  evict oldest) on push-is-an-optimization grounds — the freshest state is
  what a late subscriber can least afford to miss. The drop is at least
  counted, so the failure is visible.
- **No grace period on last-out teardown**: a view detaching and reattaching
  within one navigation cycles the full boundary handshake. Acceptable at
  current handshake cost; the technique's grace-period option is the upgrade
  path if thrash appears.
- **No subscriber census**: `getEarlyDroppedCount()` exposes the drop ledger,
  but there is no inspectable "which names have native listeners, how many
  consumers each" surface — the technique's audit question is currently
  answerable only in a debugger.
