---
layer: technique
subject: observability-telemetry
technique: pre-boot-and-foreign-capture
status: forged
laws: []
shared_with: []
---

# Pre-boot and foreign capture

Two gaps break the "one sink, one story" invariant in practice: the
records produced *before* the sink exists, and the records produced *by
runtimes that do not know the sink exists*. Both gaps sit exactly where
incidents concentrate — startup, and the embedded layers whose failures
are the strangest — so both get deliberate bridges.

## The deferred buffer: log before the logger

Initialization has a chicken-and-egg problem: the logging subsystem is
configured from settings, paths, and platform facts that must be
resolved first — and resolving them is itself failure-prone work worth
logging. The naive orderings both lose: initialize logging first with
guessed configuration and you write to the wrong place at the wrong
level; initialize it last and the riskiest phase of the process runs
dark.

The converged answer is a **deferred writer**: from the first
instruction, a minimal in-memory recorder accepts records — same
envelope, same levels, no persistence, bounded capacity. When the real
sink comes up, the buffer **replays into it in original order**, then
the deferred stage removes itself from the path. Properties that make
it correct:

- **Same record shape from instruction one.** The buffer stores real
  records, not preformatted strings — replay then benefits from the
  sink's actual formatting, filtering, and scrubbing. A buffer of
  strings replays as second-class citizens that no filter can touch.
- **Bounded, with an overflow verdict.** If initialization hangs long
  enough to fill the buffer, keep the *newest* records — the value of
  pre-boot logs is diagnosing where startup stopped, which the tail
  shows and the head does not.
- **Replay is atomic with cutover.** Records emitted during the
  replay itself must not interleave ahead of the buffered history;
  the switch from buffer to sink is a single ordered handoff, or the
  timeline the whole exercise exists to preserve is scrambled at the
  seam.
- **The buffer must not be the crash gap.** If the process dies
  before cutover, the buffer dies with it. This is accepted for the
  ordinary sink — and is exactly why last-resort crash capture (owned
  by the failure domain) writes through its own store, not through
  this path.

## Foreign runtimes: no private diaries

Every runtime the product embeds or spawns has a native output channel
that predates your sink: an embedded renderer has a console, a child
process has standard streams, a plugin host has its own notion of
logging. Left alone, each keeps a private diary — visible in a
developer tool that is closed in production, or a pipe nobody reads —
and the incident story fragments. The rule: **each foreign channel gets
a capture bridge that forwards into the primary sink**, at the moment
the foreign runtime is created, by the code that creates it.

Design points for the bridge:

- **Map the foreign severity vocabulary onto yours once**, in the
  bridge — the renderer's warning becomes your warn, its error your
  error. Consumers downstream see one vocabulary.
- **Tag the origin.** Forwarded records carry which runtime and which
  instance they came from, as a field. During fan-in, provenance is
  the field you will filter by most.
- **Capture at creation, not on demand.** A bridge attached "when
  debugging" misses the record that mattered, because the defect did
  not schedule itself. The bridge is part of constructing the runtime,
  unconditionally cheap, always on.
- **The bridge is a consumer of the foreign channel, not a replacement
  for it.** Developers still get the native console in development;
  the bridge ensures production is not blind when that console is not
  open.

## The same trap at half-size

A subtler version of the private-diary failure happens *inside* the
main runtime: a subsystem that writes directly to standard streams, or
to its own file, "because it was quick". Every such site is a fragment
of the incident story in a place nobody will look. The audit is
mechanical: enumerate every write to a terminal stream and every file
opened for append outside the sink, and either route it through the
sink or write down why it is exempt (there are legitimate exemptions —
a crash store's synchronous writes, output that *is* the product's
interface — and they are few enough to list).
