---
layer: technique
subject: settings
technique: settings-audit-and-history
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Settings audit and history

"What changed recently?" is the opening question of every debugging session
that starts with "it worked yesterday" — and in a configurable system, the
honest answer is very often a setting. A store that cannot answer the
question turns each of its keys into an unfalsifiable suspect: the behavior
drifted, forty knobs *could* explain it, and no record says which one moved.
The audit trail is what converts that search from interrogation to lookup.
Configuration changes are also the cheapest class of change to record —
low-frequency, tiny payloads, obvious schema — so the cost-benefit here is as
lopsided as instrumentation ever gets.

## The record

Every write that changes a value produces one record: **key, old value, new
value, timestamp, category, origin**. Each field earns its place:

- **Old value, not just new.** Reverting is the most common use of the
  history, and a record without the prior value can only tell you a change
  happened, not undo it. Old-and-new also makes the no-op write detectable —
  writes where old equals new should not pollute the trail (a surface
  re-saving an identical value is the most common write there is).
- **Category** — the registry's namespace or the key's kind — because the
  consumer of history thinks in features ("what changed in scheduling?"),
  not in raw keys. Category-tagging at write time is what makes the history
  surface filterable without parsing key names later.
- **Origin**: which surface, migration, sync event, or automated process
  wrote it. "The user changed it" and "the upgrade changed it" are different
  investigations. In multi-actor systems, *who* is the first question of
  ceiling changes specifically. Origin is also where audit depth forces a
  real trade-off: emit the record at the innermost write door and *every*
  writer is audited — including background processes that never cross the
  outer boundary — but the innermost layer often cannot see which surface
  called it. Auditing all writers is worth more than perfect attribution;
  take the deep door, record origin where the layer can know it, and leave
  the field optional rather than inventing one.
- **Redaction by classification, not by inspection.** If a value is
  sensitive enough to redact from the trail, it usually does not belong in a
  plaintext settings store at all — but where a borderline key exists, the
  registry marks it, and the audit writer redacts **structurally**: for a
  key classified as secret-bearing, the whole value is replaced, because the
  value *is* the secret. Pattern-based scrubbing (recognizing token-shaped
  substrings) cannot catch a bare credential that matches no pattern, and
  deciding sensitivity per-write at the call site is how one forgotten site
  leaks. The record still shows *that* the key changed — never what it was.

Two settings-specific policies complete the record contract:

- **Not every key is audit-worthy.** Machine bookkeeping that happens to
  live in the settings table — scan cursors, sync watermarks, "last ran"
  timestamps, minted device ids — advances on every background tick, and
  auditing it buries the eleven real configuration changes of the week under
  ten thousand rows no human wrote. The registry declares the exclusion
  per key (or per prefix family), which keeps the decision reviewable in one
  place; a history tab full of cursor noise is a history tab nobody opens.
- **The audit is best-effort relative to the write.** A failed audit insert
  is logged and the settings change still lands — losing one trail row must
  not block the user's configuration change. The reverse priority (audit
  failure vetoes the write) turns a telemetry table into an availability
  dependency for every knob in the product.

The ledger mechanics — append-only discipline, the write chokepoint,
retention and partitioning, the accounting for those dropped best-effort
rows — are owned by
[audit-logging](../../audit-logging/audit-logging.md) and apply here without
modification. This technique owns what is settings-shaped: the record's
fields and the surfaces built on it.

## The surfaces

A trail that only a database query can read answers questions only for the
person willing to write the query — which, during an incident, is nobody.
Two surfaces pay for the whole feature:

- **A history view**: reverse-chronological, filterable by category and time
  window, rendering old → new transitions in human terms (the display labels,
  not the serialized values). Counts shown on it carry their predicates —
  "12 changes this week *in scheduling*" is a finding; "12 changes" is a
  number ([count-carries-predicate](../../_laws.md#count-carries-predicate)).
- **Recent-change visibility at the scene.** A marker on the settings
  surface itself — this value changed recently — puts the signal where the
  investigating eye already is. The debugging path this enables is the whole
  point: open the relevant settings area, and the knob that moved is wearing
  a flag. Freshness needs a horizon (days, not forever) so the markers decay
  and stay meaningful; a surface where everything is marked "recent" marks
  nothing.

## Revert, with eyes open

Old values make revert cheap to offer: restore this key to what it was
before this change. Offer it — but as a *new audited write* whose origin
says "revert of change X", never as a deletion of history; the trail is
append-only and the undo is itself an event. And note the honest limitation:
reverting a value does not revert the world. Actions the system took while
the wrong value reigned — jobs scheduled, money spent, messages sent — are
not unwound by restoring a row. The trail's timestamps are what bound that
damage assessment; this is why they matter more than they look.
