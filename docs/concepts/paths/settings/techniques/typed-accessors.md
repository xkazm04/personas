---
layer: technique
subject: settings
technique: typed-accessors
status: forged
laws: [one-validation-door, failure-not-empty-success]
shared_with: []
---

# Typed accessors

The store persists serialized values — strings, at bottom — because a uniform
substrate is what makes a settings store generic. The *meaning* of each value
(a boolean, a bounded integer, an enum member, a duration) exists only at the
point of use, and the naive design lets every point of use reconstruct that
meaning itself: twelve call sites, twelve parses, twelve opinions about what
`"true "` with a trailing space means, twelve places a clamp was supposed to
happen. The correct shape is **one typed accessor per key** — a single
function that owns parse, validation, clamping, and the default — so the
stringly substrate is a private detail behind a typed door
([one-validation-door](../../_laws.md#one-validation-door)), and a consumer
cannot obtain an unvalidated value because no other path exists.

The accessor's contract, in order:

1. **Read** the raw value; if absent, return the declared default.
2. **Parse** it into the declared type; on failure, report the corruption
   (telemetry, not a crash — the app must still boot) and return the default.
3. **Validate and clamp** — range-check numbers, membership-check enums,
   normalize casing — so out-of-range stored values cannot propagate.
4. Return a value the type system vouches for.

Writes go through the mirror image: the setter takes the typed value,
validates it, serializes it. Symmetry matters — a store you can write raw but
read typed still has two doors. For structured values (a policy object, a
rule list serialized as one document), the strongest form validates the
incoming payload **against the exact type the consumer will parse** at write
time: any blob the write door accepts is a blob the reader is guaranteed to
load, so corruption is rejected at the moment someone is present to see the
error, instead of surfacing weeks later as a reader quietly falling back to
defaults. Where the consumer's type is out of reach, well-formedness
checking (does it parse at all?) is the honest floor — it still stops
truncated and garbage payloads at the door.

## The default is a decision with an owner

Most users never open the settings surface, so **the default is the value
most installations run with** — it is not an edge case, it is the shipping
configuration. Two consequences:

- **Defaults are declared in code, once, next to the accessor,** with a
  sentence of rationale. A default that exists only as a magic literal at
  call sites is an unowned decision, and unowned decisions are re-made
  differently by the next call site.
- **Never write the default into the store.** The moment a boot-time
  "initializer" persists defaults as rows, two states collapse into one: "the
  user chose this value" and "the user never touched this". That distinction
  is load-bearing — it is what lets a later release *change* a default and
  have the change reach everyone who never expressed a preference. Persisted
  defaults freeze every user at the default of the release that initialized
  them. Absence is information; preserve it.

## The fail direction rule

Every default has a direction it fails in when nobody configures the key, and
the direction must be chosen by consequence, not by convenience:

- **Preferences** — any reasonable value. The cost of a wrong default is
  taste.
- **Operational config** — the conservative value: the smaller concurrency,
  the longer interval, the safer endpoint. The cost of a wrong default is an
  outage.
- **Safety ceilings** — **closed, always.** An absent spend cap means zero
  spend authority, not unlimited; an absent autonomy level means ask, not
  act. The seductive convention "zero or absent means no limit" inverts the
  meaning of the empty store precisely on the keys where the inversion is
  most expensive — the unconfigured state, which is the *most common* state,
  becomes the most permissive state. The neighbouring subject's audit
  ([hitl-approval](../../hitl-approval/hitl-approval.md)) recorded exactly
  this in production: dollar ceilings where zero-or-absent meant unlimited,
  sitting beside switches that failed closed. If "no limit" must be
  expressible, make it an explicit, distinguishable sentinel that a human
  deliberately writes — never the reading of nothing.

A corrupted value follows the same rule: the accessor that swallows a parse
failure and substitutes the default has made a silent decision, and for a
ceiling, that decision must land on the closed side while saying so
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)) — a
malformed cap that quietly becomes "unlimited" is the same inversion arriving
through the side door.

## Absence, deletion, and reset

The typed door gives three operations distinct meanings that a raw store
blurs: **read-absent** returns the default (normal, silent); **delete**
restores a key to the default *by removing the row* — which is why delete
must be idempotent and why "reset to default" is a delete, not a write of the
current default value; and **write** records an explicit choice. Keeping
delete-as-reset honest preserves the absence-is-information property above:
after a reset, the user is once again downstream of future default changes,
which is what "reset to default" should mean.
