---
layer: technique
subject: observability-telemetry
technique: crash-record-storage
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Crash record storage

The ordinary sink assumes a healthy process: buffered channels drain,
files flush, the remote channel sends. A crash voids every one of those
assumptions, so crash evidence gets a **dedicated store with the humblest
possible write path** — the storage counterpart to the failure domain's
[crash-capture](../../error-handling/techniques/crash-capture.md)
technique, which owns the *capture* side (last-resort handlers,
breadcrumb trails, crash-loop guards). That technique decides what gets
recorded at the moment of death; this one decides where it lands, what
shape it has, how long it lives, and how it is read back.

## The write path: small, synchronous, self-contained

The store's writer runs inside a dying program, so it inverts every
performance choice the ordinary sink made:

- **Synchronous, not queued.** The non-blocking channel that protects
  hot paths is exactly wrong here — a queued crash record dies in the
  queue. The final act is a direct write that either completes or
  fails now.
- **One record, one file, written atomically** — composed fully in
  memory, written to a temporary name, renamed into place. A store of
  independent small files needs no index, no locking, and no shared
  mutable state — every one of which is a way for a second crash to
  destroy the evidence of the first. Half-written garbage from a
  mid-write death is confined to one discardable file.
- **No dependencies on the subsystem being diagnosed.** The writer
  uses primitive facilities only — no framework, no allocator-heavy
  serialization, no call back into the sink whose corruption may be
  the cause.

## The record: structured, bounded, aggregatable

A crash record is a structured document, not a text dump: identity
fields (when, which version, which platform, which execution context
died), the failure's own detail (type, message, stack), the breadcrumb
trail the capture side maintained, and coarse process facts (uptime,
memory pressure) — each field bounded in size, the record bounded in
total. Two design rules:

- **Key it for aggregation.** The same fields the remote channel
  groups by (failure type, top of stack, version) live as first-class
  fields locally, so a hundred instances of one defect can be
  recognized as one defect even offline.
- **Bound everything.** Stacks truncate at a stated depth, messages at
  a stated length, the trail at its ring capacity. An unbounded crash
  record is how a pathological failure (an error message containing
  the document that caused it) turns the crash store into the next
  disk incident.

## Sanitize before persist — the one-way door

The crash record is the single most secret-prone artifact the product
produces: it serializes state indiscriminately at an unplanned moment.
The gate position is absolute: **scrubbing runs between composition and
the first write** — never "on upload", never "in the viewer". A raw
record that touches disk is already leaked to every backup, sync
client, and support attachment that will ever see that directory.
Allowlist the fields (the record schema is known — enumerate what may
appear, rather than guessing what must not); pattern-scrub the free
prose that remains (messages and stack text can embed anything); and
keep the breadcrumb rule from the capture side: the trail names events,
never payloads.

## Retention: a capped ring of evidence

The store declares its reaper at creation
([creation-names-reaper](../../_laws.md#creation-names-reaper)): keep at
most N records, oldest evicted on insert — a ring buffer on disk. The
cap is enforced by the *writer* at the moment of adding a record, not
only by a scheduled janitor, because a crash-looping process can emit
records far faster than any schedule reaps, and the store must be
incapable of unbounded growth even at its busiest. Shipped-to-remote
status, where a remote channel exists, is tracked per record so the
uploader deletes on confirmed receipt and the cap handles the rest —
the machine that never reconnects still never grows past N.

## Read defensively, surface honestly

The store is read in two places, and both treat corruption as expected
input: the **next-start shipper/inspector**, which must survive the
truncated record a mid-write death left behind (skip it, count it,
never crash — a crash store that crashes its reader has achieved
recursion, not diagnosis); and the **viewer** through which an operator
or support flow browses records, which belongs to
[diagnostic-access](diagnostic-access.md). One integration point back
to the product: the presence of a fresh record at startup is the signal
that drives the "we crashed last time" acknowledgment the capture
technique calls a product moment — the store is what makes that honesty
possible after the fact.
