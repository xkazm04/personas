---
layer: golden-path
subject: observability-telemetry
status: forged
techniques:
  - log-architecture
  - pre-boot-and-foreign-capture
  - rotation-and-retention
  - crash-record-storage
  - remote-telemetry-economics
  - diagnostic-access
evidence:
  - src-tauri/src/logging.rs                    # the whole recording spine: rolling non-blocking daily appender, deferred pre-init file writer, WebView console into the same file, per-crate EnvFilter, panic hook + capped crash store, walk-the-directory disk accounting
  - src-tauri/src/commands/infrastructure/system/crash_telemetry.rs   # diagnostic access: crash-log read/clear commands + log-directory stats for the settings surface
  - src/lib/utils/crashPersistence.ts           # sanitize-before-persist crash records, capped ring (20), fire-and-forget backend write, defensive corrupt-read that wipes and returns empty
  - src/lib/analytics/sink.ts                   # pluggable telemetry sink; noop sink when telemetry is off; pseudonymous random install id; deduped once-per-install conversion events
  - src/lib/silentCatch.ts                      # background failures become breadcrumbs, not events — the two-tier economics at a real door
  - src/features/overview/components/health/CrashLogsSection.tsx      # in-product crash viewer reading the actual stores (native crash dir, DB rows, local storage), with clear actions
counter_evidence:
  - docs/concepts/golden-paths/structured-logging.md   # measured: a second, unbounded, unredacted sink (per-execution logger) held 99.1% of log bytes and live credentials, beside a correctly bounded primary
deviations:
  - w5-observability-telemetry   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Logging & crash telemetry

A product records two kinds of things: its domain (the user's data) and
*itself* (what it did, what it saw, how it died). The second kind is the
subject here, and the senior insight is that it is a **subsystem, not a side
effect**. Self-records have consumers — the operator diagnosing an incident,
the support engineer reading a user's exported bundle, the future maintainer
reconstructing a crash — and they have costs: disk that fills, quotas that
meter, secrets that leak. A codebase that treats logging as free sprinkling
converges on the same three outages every time: the log that filled the
disk, the crash that left no trace, and the record that shipped a secret.

The boundary with the adjacent failure domain matters and is sharp:
[error-handling](../error-handling/error-handling.md) owns *classifying*
failures and routing them through doors — deciding what a failure is and
who must learn of it. This subject owns the **recording infrastructure
those doors write into**: the sinks, the levels, the files and their
lifecycle, the remote channel and its budget, the crash record store. A
door is a decision; a sink is a place. Doors change per failure; the place
is designed once.

## Records are a bounded resource with a lifecycle

The defining property of self-records is that **the program is both the
producer and the landlord**. Nobody external caps a log file; if the
recorder does not bound itself, the bound is the disk — and a product that
can fill its host's disk has converted its diagnostic subsystem into an
outage generator, usually on exactly the machine that was already
misbehaving (failures produce log volume; log volume produces the disk
failure; the two compound). So every record class is born with three
numbers: how large one unit may grow, how many units are kept, and who
deletes the excess ([creation-names-reaper](../_laws.md#creation-names-reaper)).
Rotation, retention, and the accounting that lets an operator see the
footprint are [rotation-and-retention](techniques/rotation-and-retention.md).

The same lifecycle discipline applies off the disk: an in-memory breadcrumb
trail is a ring buffer with fixed capacity, a remote channel has a quota,
a crash store has a count cap. *Unbounded* is not a default anywhere in
this subject; it is a bug that has not been paged for yet.

## One sink: the incident is a single story

An incident is diagnosed by reconstructing an ordered sequence of events
across every layer that participated — the interface layer, the core, the
background workers, the embedded runtimes, the child processes. That
reconstruction is only possible if the records **converge into one sink
with one ordering and one format**. The failure mode is gradual and
common: each layer grows its own ad-hoc output (a debug console here, a
private file there, a print-to-standard-streams habit in a worker), and
when the incident comes, the story exists in five fragments with five
clocks and three of the fragments were never persisted at all.

The rule: **every runtime the product embeds or spawns forwards its
records into the primary sink**, tagged with their origin. Foreign
runtimes — an embedded renderer with its own console, a child process
with its own standard streams — do not get to keep private diaries.
Capturing them, and bridging the moments before the sink exists, is
[pre-boot-and-foreign-capture](techniques/pre-boot-and-foreign-capture.md).

One sink does not mean one verbosity: the sink fans in, and filters fan
out — per-module level targeting decides what each origin contributes.
Structure, levels, targeting, and the non-blocking write path are
[log-architecture](techniques/log-architecture.md).

## The pre-boot gap: startup must not be dark

Crashes cluster at startup — configuration parsing, migration, resource
acquisition all run before the application is healthy — and startup is
also when the logging subsystem itself does not exist yet. Left unhandled,
this produces the least diagnosable failure the product can have: it died
before it could say anything. The senior structure is a **deferred
buffer**: from the first instruction, records go somewhere cheap and
allocation-light in memory; when the real sink comes up, the buffer
replays into it in order, and the log reads as if the sink had existed
from the start. The gap is bridged, not accepted.

The mirror-image rule applies at the other end of life: the crash path
must assume the sink is *already gone* — which is why crash records get
their own dedicated store with its own write path, below.

## Crash records: the store outlives the death

When the process dies unexpectedly, the ordinary sink cannot be trusted
to have flushed, and the remote channel cannot be trusted to have sent.
So crash evidence gets a **dedicated local store** with the humblest
possible write path: small records, written atomically, readable by the
next healthy start. The *capture* side — last-resort handlers, breadcrumb
trails, crash-loop guards — belongs to the failure domain and is specified
in [crash-capture](../error-handling/techniques/crash-capture.md); the
*storage* side — the record schema, the sanitize-before-persist gate, the
retention cap and its reaper, the defensive reader — is this subject's
[crash-record-storage](techniques/crash-record-storage.md).

## Remote telemetry is a metered, budgeted channel

Local recording and remote telemetry look similar and are economically
opposite. A local log line costs microseconds and bytes you own; a remote
event costs quota against a vendor plan, bandwidth on the user's
connection, and — the real currency — **attention in the triage queue**.
A remote channel with no budget discipline drowns: quota exhausts
mid-month, the noisy defect buries the novel one, and the team learns to
ignore the channel, at which point it is worse than absent.

The discipline is a two-tier vocabulary: an **event** is a failure or
signal worth a triage row — deduplicated, grouped, counted; a
**breadcrumb** is context that rides along free until an event makes it
relevant. Most records are breadcrumbs; events are *earned*. Around that
vocabulary sit the channel mechanics — session batching, sampling with
the rate recorded, quota-aware degradation, and the rule that the
channel's own failure must be visible somewhere other than itself
([failure-not-empty-success](../_laws.md#failure-not-empty-success): zero
events arriving is indistinguishable from perfect health unless something
asserts the pipeline). All of it is
[remote-telemetry-economics](techniques/remote-telemetry-economics.md).

## Privacy is enforced at the write path

Self-records are where secrets go to leak. Logs serialize arguments;
crash records serialize state; telemetry serializes context — all
indiscriminately, all at the worst moments, all into artifacts that get
copied, shipped, backed up, and attached to tickets. The only defensible
gate position is **before the first write**: scrub at the point of
recording, not at export, not at display, not "before we share it".
Once an unscrubbed record exists on disk, every later gate is a promise
that copies of the file will honor — and copies honor nothing.

Structurally this means the sink and the stores own the scrubbing, not
the call sites ([one-validation-door](../_laws.md#one-validation-door)):
a thousand log statements cannot each be trusted to remember redaction,
but the two or three places records pass through on their way to
persistence can be made to enforce it. Allowlist fields where the record
shape is known; pattern-scrub where it is not; and treat "the record
contained a credential" as a sev-high defect of *this* subsystem, not of
the code that logged it.

Two hard-won corollaries. **Scrub the record, not a list of its
fields**: a gate written as an enumeration of field names is complete
only on the day it is written — the record grows, the enumeration does
not, and the miss is silent; walk every string in the record, with a
depth cap that redacts on overflow. And **detection must never trigger
disclosure**: the reflex to log "I just redacted something — here is
the original for debugging" writes the secret to a new sink precisely
when it has been proven to be a secret. Log the fact and the shape,
never the value.

## Records nobody can reach do not exist

The last mile is access: the operator who needs the log directory, the
user asked by support to export a diagnostic bundle, the developer who
needs the crash history from a machine they will never touch. A recording
subsystem is finished only when each consumer has a **named path to the
records** — a viewer for the crash store, a one-action reveal of the log
location, an export that produces a shareable artifact and *re-applies
the privacy gate on the way out* (export crosses a trust boundary even
when the write path already scrubbed — the bundle travels further than
the file). This is [diagnostic-access](techniques/diagnostic-access.md).

## What "healthy" looks like

A healthy instance of this subject can answer, from any machine, without
a debugger: *what happened in the last hour* (one sink, ordered, level-
filtered), *what happened at 3am when it crashed* (crash store, with the
trail), *what has been happening since install* (rotated files within a
stated cap), *what the operator's telemetry saw* (events, deduplicated,
within quota), and *what it will never tell anyone* (the scrubbed
classes, enforced at write). Each answer names its bound and its reaper.
An instance that cannot answer one of these has a gap exactly where the
next incident will land.

## The techniques

- [log-architecture](techniques/log-architecture.md) — structured
  records, level semantics as a contract, per-module targeting, the
  non-blocking write path, and convergence into one sink.
- [pre-boot-and-foreign-capture](techniques/pre-boot-and-foreign-capture.md)
  — the deferred buffer that bridges the pre-init gap, and forwarding
  embedded/child runtimes' output into the primary sink.
- [rotation-and-retention](techniques/rotation-and-retention.md) —
  rolling policy, size and age caps, disk accounting, and the reaper
  that makes retention real.
- [crash-record-storage](techniques/crash-record-storage.md) — the
  dedicated crash store: schema, sanitize-before-persist, retention
  cap, defensive reads.
- [remote-telemetry-economics](techniques/remote-telemetry-economics.md)
  — event vs breadcrumb, batching, sampling, quota discipline, and
  asserting the pipeline itself.
- [diagnostic-access](techniques/diagnostic-access.md) — viewers,
  export bundles, log-location surfacing, and the second privacy gate
  at the export boundary.
