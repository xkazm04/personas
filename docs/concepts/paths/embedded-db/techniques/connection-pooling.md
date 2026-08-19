---
layer: technique
subject: embedded-db
technique: connection-pooling
status: forged
laws: [creation-names-reaper, failure-not-empty-success]
shared_with: []
---

# Connection pooling for an in-process engine

A pool in front of an embedded engine exists for different reasons than a
pool in front of a server. There is no network handshake to amortize and no
remote session to conserve; connections are file handles plus per-connection
state. What the pool actually provides here is **admission control** — a
bounded number of concurrent entrants into an engine with hard concurrency
limits — plus a single choke point where per-connection configuration is
applied uniformly and where every data operation can be observed. Treat it
as a gate with a meter, not as a cache of expensive objects.

## Size from the engine's concurrency model, not from server instinct

Server pools are sized to saturate a remote machine. An embedded engine
lives on *this* machine and usually has a sharply asymmetric concurrency
model: many simultaneous readers are cheap, while writers serialize — often
to exactly one at a time, with a second writer waiting on a lock rather
than proceeding. Under that model, raising the pool size does not raise
write throughput at all; it raises the number of threads parked on the
writer lock, which converts engine-level serialization into pool-level
queueing plus lock-level queueing, two waits stacked where one sufficed.

Consequences:

- **Small pools are correct.** A handful of connections covers an
  interactive application; the ceiling should trace to the engine's real
  parallelism, not to a copied server default of dozens.
- **Reader/writer separation pays where the engine rewards it.** With
  journal modes that let readers proceed during a write, a dedicated writer
  lane (a single writer connection or a writer sub-pool of one) plus a
  reader pool matches the engine's shape exactly: writes serialize where
  they must, reads never queue behind them in *your* code.
- **Per-connection setup is part of pool construction.** Pragmas, timeouts,
  foreign-key enforcement, registered functions — applied by the pool's
  connection factory so every connection is identical. A connection
  configured "at the call site that happened to open it" is a second
  configuration authority waiting to disagree with the first.

## Instrument acquisition or contention is invisible

The wait for a pooled connection happens *before* the query runs, in code no
query profiler attributes and no engine log records. An application can be
spending most of its perceived database time queueing at its own pool while
every query measures fast. This is unmeasurable retroactively; it must be
measured at the source.

The standard wrapper: every acquisition goes through one function that
records **who asked** (a static call-site label, not a stack walk), **how
long acquisition took**, and **whether it timed out** — and logs loudly when
the wait crosses a stated threshold. The label matters as much as the
number: a pool that reports "acquisitions are slow" invites guessing; one
that reports "this named caller waited 800ms" names the hoarder or the hot
path outright. Feed the records into the same bounded-ring discipline as
the rest of [db-self-instrumentation](db-self-instrumentation.md); pool
saturation events also belong on the activity picture that
[quiet-window-maintenance](quiet-window-maintenance.md) reads, since a
saturated pool is the strongest possible "not a quiet window" signal.

## Timeouts: refusal must not impersonate absence

An acquisition wait needs a bounded timeout, and the timeout needs an error
that names the pool — distinct from every other database error
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)). The
degenerate designs both occur in the wild: an unbounded wait, which turns
pool exhaustion into a silent application hang with a stack trace pointing
at innocent code; and a timeout whose error is swallowed into a generic
"database unavailable," which sends the responder to the engine when the
defect is a leak or a sizing decision. "The pool was exhausted for 5s; the
current holders were last acquired by X, Y, Z" is a five-minute diagnosis;
"timeout" alone is an afternoon.

## Leaks: every checkout names its return

A pooled connection is a created resource, and
[creation-names-reaper](../../_laws.md#creation-names-reaper) applies at
checkout: the return path must be structural — scope-bound guards, RAII
handles, closures that receive the connection and end — never a manual
release a distant error path can skip. In an embedded app a leaked
connection is worse than its server cousin: the pool is small, so leaking
two or three connections is not degradation but standstill, and if the
leaked handle holds a read snapshot open it can also pin the journal,
turning a code bug into unbounded disk growth (see
[journal-and-durability-modes](journal-and-durability-modes.md)). Hold
checkouts for the duration of an operation, not the duration of an object:
a connection stored in a long-lived struct is a leak with extra steps.

The subtler cousin of the leaked connection is the **polluted** one: a pool
recycles session state, not just handles. Any per-connection setting an
operation toggles — relaxed integrity enforcement for a bulk load, a
changed timeout, a temporary mode — rides back into the pool with the
connection and detonates under a random future caller who never asked for
it. The rule is the same as for the checkout itself: state changes are
scope-bound guards that restore the setting on every exit path, including
panic and early return. A convention ("remember to turn it back on") is
exactly the discipline the next error path skips.

## The pool is a boot-order participant

The pool's connection factory runs whenever the pool decides to create a
connection — including lazily, mid-session, on a worker thread. Anything
that must be true of *every* connection (extensions, function registration,
collations) must therefore be in place before the pool exists, not merely
before the first query. That ordering contract is
[extension-lifecycle](extension-lifecycle.md); the pool is where violations
of it detonate.
