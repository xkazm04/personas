---
layer: technique
subject: client-fetch-cache
technique: in-flight-dedup
status: forged
laws: [identity-survives-reuse, creation-names-reaper]
shared_with: []
---

# In-flight deduplication

One question should be in the air at most once. When a second caller asks
while the first flight is still flying, it joins the flight instead of
launching another. This is the single-flight join policy — the general
primitive with its acquire/refuse/queue variants belongs to
single-flight-primitives under the concurrency-guards subject — specialized
to the client's dominant shape: promise-returning reads, where joining is
as cheap as handing the second caller the first caller's pending result.

## The registry

The mechanism is a map from request key to pending result:

- **Lookup before launch.** A caller derives its key
  ([cache-key-discipline](cache-key-discipline.md)), checks the registry,
  and on a hit returns the pending result as its own. On a miss it launches
  the fetch, stores the pending result under the key *synchronously, before
  any suspension point* — the gap between launching and registering is
  exactly where the duplicate slips through.
- **Removal on settle, both paths.** The entry is deleted when the flight
  settles — success **and** failure. Removal-on-failure is the half that
  gets forgotten, and forgetting it converts the registry into a negative
  cache: the failed pending result sits under the key forever, and every
  future caller joins a flight that already lost. The settle handler is the
  entry's reaper, named at insertion
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)).
- **Bounded by construction.** The registry holds only in-flight work, so
  its size is the client's concurrency, not its history. That property is
  worth protecting: a flight that can hang forever (a transport with no
  timeout) wedges its key permanently, which is one of the reasons the
  fetch underneath should already carry a timeout from the call-wrapping
  layer rather than trusting the server to always answer.

## Failure fans out to every joiner

Joining is a contract about failure as much as success. When the shared
flight rejects, **every** joiner receives that rejection — the launcher has
no privileged claim on the bad news. Two consequences follow:

- Each joining call site must handle failure as if it had fetched itself.
  Dedup multiplies the blast radius of one failed request across every
  caller that joined it; a caller that assumed "someone else will handle
  the error" now fails silently in company.
- One rejection object reaching N handlers means N reports if each handler
  reports independently. If failures are counted or alerted on, the
  fan-out should be visible to the telemetry design — one flight failed,
  not five — or the numbers lie about server health.

The joiners receive the *same settled outcome*, not a re-execution. A
caller with special needs — a different timeout, an abort tied to its own
lifetime — is not a joiner; forcing it through the shared flight couples
its lifetime to strangers. Abort in particular must be designed: a joiner
aborting *its interest* must not cancel the shared flight other joiners
still want. The simple resolution is that dedup'd flights are
uncancellable-by-joiners and abandonment is local — the joiner stops
listening, the flight lands for whoever remains.

## Dedup is not idempotency

The boundary that keeps this technique honest: dedup collapses *concurrent*
duplicates on *one client*. It is an optimization, never a correctness
guarantee, and three gaps mark where its protection ends:

- **Sequential duplicates pass through.** A caller retrying after settle
  starts a legitimate new flight. Dedup does not remember history — that
  is the cache's job, with its own lifetime policy
  ([swr-design](swr-design.md)).
- **Other clients are invisible.** Two windows, two devices, one user:
  each dedups its own flights and the authority still sees both.
- **Therefore mutations still need server-side idempotency.** Deduping a
  read costs nothing to reason about: same question, same answer. Deduping
  a mutation is a semantic claim — "these two submissions were one intent"
  — that only the authority can enforce, via idempotency keys minted per
  intent ([identity-survives-reuse](../../_laws.md#identity-survives-reuse):
  the key identifies the *attempt*, and survives the retry). Client-side
  dedup of mutations is at most a courtesy debounce layered on top of that,
  never a substitute for it.

## Dedup and its sibling guards

Three guards get conflated because all three involve keys and requests;
they answer different questions:

- **Dedup** (this technique): *concurrent identical* questions share one
  answer. The key is the question.
- **Latest-wins tokens**: *successive different* questions compete for one
  slot, and only the newest may write. The token is the attempt. Owned by
  [async-race-guards](../../client-state/techniques/async-race-guards.md).
- **Exclusion**: an operation must not overlap itself, and the second
  caller may need refusal or queueing rather than a shared answer — the
  general territory of
  [single-flight-primitives](../../concurrency-guards/techniques/single-flight-primitives.md).

A search box needs latest-wins, not dedup (the questions differ). A screen
of widgets mounting needs dedup, not latest-wins (the questions are
identical and all askers deserve the answer). A submit button needs
exclusion and an idempotency key. Choosing the wrong guard produces either
sharing between questions that should compete, or competition between
callers that should share.

## Decision rules

- Install dedup at the fetch layer, keyed by full request identity, so
  every caller inherits it; a per-view guard protects one call site.
- Register the pending result synchronously at launch; remove on settle,
  success and failure alike.
- Fan the rejection out to all joiners; design telemetry so N joiner
  failures count as one flight failure.
- Joiners abandon locally; they never abort the shared flight.
- Dedup reads freely; dedup mutations only as a debounce atop server-side
  idempotency keys, never instead of them.
