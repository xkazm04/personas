---
layer: technique
subject: error-handling
technique: crash-capture
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Crash capture

Every technique upstream of this one assumes the failure was caught by code
that expected it. Crash capture is the tier for the failures nothing
expected — the unhandled exception, the unhandled rejection, the panic, the
process that dies mid-write. Its posture differs from ordinary doors: it
cannot rely on the program being healthy, it captures the richest context
of any door, and it is the single most likely place to leak secrets.

## Cover every execution context, at the true edge

Unhandled failures escape per execution context, and each context has its
own escape hatch: the synchronous exception channel, the asynchronous
rejection channel, background workers, native layers with their own panic
path, and separate processes each with all of the above. The audit is an
enumeration: list every context the product runs code in, and name the
last-resort handler for each. A context without one does not "crash
loudly" — on most platforms it dies or limps *silently*, which makes the
missing handler a swallowed catch at the largest possible scope.

Rules for the handlers themselves:

- **Registered first, before any code that can fail.** A crash during
  startup, before the handler exists, is the least diagnosable crash and
  startup is where crashes cluster.
- **Minimal and self-contained.** The handler runs inside a dying program;
  it must not depend on the frameworks, state, or services whose corruption
  may be the cause. Capture, sanitize, persist — nothing clever.
- **Never crash in the handler.** Every step wrapped, every fallback
  terminal. A throwing crash handler recurses or takes down the platform's
  own reporting.

## Capture the trail, not just the point

The failure's own detail (type, message, stack) says where the program
died; diagnosing *why* usually requires what happened during the preceding
seconds. That is the **breadcrumb trail**: a small, bounded ring buffer of
recent significant events — navigations, commands issued, requests
completed and failed, state transitions — appended cheaply during normal
operation and read only at capture time. Design points:

- **Bounded and cheap by construction.** Fixed capacity, constant-size
  entries, no allocation spikes; the trail records the flight, it must
  never influence it.
- **Ordinary error doors append breadcrumbs too.** Handled failures often
  precede unhandled ones; the crash report that shows three handled
  timeouts before the fatal error has effectively diagnosed itself.
- Alongside the trail: coarse environment (version, platform, uptime) and
  the crash's own identity fields — everything keyed for aggregation, so a
  hundred instances of one defect arrive as one group with a count, not a
  hundred mysteries.

## Sanitize before anything persists

A crash report serializes state indiscriminately — argument values,
recent inputs, buffers — which makes it the most likely artifact in the
entire product to embed a secret, a credential, or personal data. The
discipline:

- **Sanitize at capture time, before the first write.** Once a raw report
  touches disk, deleting it everywhere is no longer in your control —
  files get shipped, backed up, attached to tickets.
- **Allowlist, not denylist.** Enumerate the fields the report carries;
  do not enumerate the secrets to strip. Denylists fail open on the secret
  shape nobody predicted; allowlists fail closed at the cost of an
  occasional missing field.
- **Breadcrumbs carry references, not payloads.** "Request to service X
  failed" — never the request body, never the response, never user
  content. The trail names events; the events' contents stay out.

## Persist first, ship later

The crash may take the network stack, the reporting library, or the whole
process down with it — so the capture path's terminal act is a **local
write**, small and atomic, to a spool location. Shipping happens on the
*next* healthy start: read the spool, send, and delete on confirmed
receipt. Per [creation-names-reaper](../../_laws.md#creation-names-reaper),
the spool names its reaper at creation: shipped reports are deleted by the
shipper; unshippable reports (endpoint gone, user opted out) are reaped by
an age/count cap, so the spool cannot grow without bound on a machine that
never reconnects.

Two guards on the restart path:

- **Crash-loop detection.** A crash during startup means the next start
  likely crashes too. Count rapid successive crashes; past a threshold,
  stop doing the normal thing — enter a degraded or safe mode, and make
  the loop itself a first-class report. Shipping the same startup crash
  every four seconds is a denial-of-service against your own telemetry.
- **The spool is read defensively.** A truncated report from a mid-write
  death must not crash the shipper — the parser that reads the spool
  treats corruption as expected input, reporting it as its own (small)
  finding rather than dying on it.

## Crash capture is also a product moment

The session after a crash is a user-facing state, not only a telemetry
one: work the user had in flight should be restored or explicitly
acknowledged as lost, and a product that just vanished mid-task owes the
user one honest sentence on return. Silence after a crash reads as "it
lost my work and won't admit it" — the trust cost of the crash is mostly
paid *here*, not at the moment of death.
