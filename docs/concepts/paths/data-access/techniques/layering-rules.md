---
layer: technique
subject: data-access
technique: layering-rules
status: forged
laws: [one-validation-door]
shared_with: []
---

# Layering rules

The repository pattern's guarantees are all downstream of two boundary
properties: the query language lives in one module tree, and dependencies
across that tree's border point in one direction. Neither survives on
convention alone. This technique is about making both properties structural
— enforced by the build, visible in the dependency graph — and about the two
pressures that most often break them: upward signals and convenience
imports.

## One module owns the query language

**Every statement the system can issue lives inside one module tree** — the
data layer — and nothing outside it constructs query text, holds a raw
connection, or names a physical column. The value of this rule is not
tidiness; it is that three expensive questions become finite:

- *What breaks if this column changes?* — read one directory.
- *Where could injection enter?* — audit one surface.
- *Who writes to this table?* — list one module's functions; this is the
  enumerable-writers property the one-door law requires of any mutable
  store ([one-validation-door](../../_laws.md#one-validation-door)).

The rule dies by leak, not by decree, and the leaks are always well-meaning:
a handler that runs "one tiny count query" inline because adding a
repository function felt heavy; a utility that accepts a connection "just
for this migration script"; a debug endpoint that takes query text from a
tool. Each is individually harmless and each re-opens all three questions to
the whole codebase. The countermeasure is enforcement at the import
boundary: the connection type, the statement-building machinery, and the raw
handle are simply not exported past the layer. Where the language supports
visibility control, use it; where it does not, a lint that flags the query
API outside the layer's directory converts the convention into a gate.

## Dependencies point down

The layering order, top to bottom: transport and orchestration → application
logic → **data layer** → domain types. Everything may depend on what is
below it; nothing depends on what is above. Two consequences of an upward
import justify the absolutism:

- **The layer everything trusts inherits every reason to change from the
  layers above it.** A data layer that imports application modules
  recompiles, retests, and re-reviews with them. The most trusted layer
  should be the most stable one, and stability is a function of what you
  depend on.
- **The layer stops being testable alone.** Standing up the data layer
  against a real store in a test requires standing up whatever it imports —
  and the transitive closure of "whatever" ends with the whole application
  in the test fixture.

The domain types themselves sit *below* the data layer for the same reason:
the repository's signatures speak them, so they must be importable without
importing the machinery. Types shared across layers live in the bottom
layer or a dedicated leaf module — never in a layer that also does work.

**State the rule where it can be read, and gate it where it can be
enforced.** A one-line dependency contract at the top of the layer's root
("this layer depends on the domain types and nothing else") tells the next
maintainer the constraint exists; the build's dependency graph is what makes
it true. When the module system can express the constraint (separate
compilation units with explicit dependency manifests), the wrong import is a
build error and the rule needs no vigilance at all — the strongest available
form, worth real restructuring to obtain.

## Upward signals: hooks, not imports

The legitimate pressure against the direction rule: sometimes the data layer
*discovers* something the layers above must react to. A read finds and
quarantines a corrupt row and the application wants telemetry; a write
completes and a cache must invalidate; a lifecycle table changes and a
notification should fan out.

The wrong fix imports the telemetry client, the cache, or the event system
into the data layer — one import each, and within a year the "bottom" layer
has a skyline. The right fix inverts the dependency: **the data layer
defines a narrow callback interface — named for what happened, not for who
listens — and the composition root injects implementations at startup.** The
data layer calls "a row was skipped during decode"; whether that becomes a
log line, a metric, or a toast is decided above, where those concerns live.

Three rules keep hooks from becoming a back door:

- **Hooks carry facts, not capabilities.** Parameters are values describing
  what happened — identities, counts, error text — never live handles into
  the layer (a hook that receives the connection has re-exported it).
- **Hooks are fire-and-forget from the layer's perspective.** The data
  layer must remain correct when a hook is absent, slow, or throwing; a
  hook failure is contained and logged, never allowed to fail the read or
  write that triggered it.
- **Hooks fire after the fact they report is durable.** A "record created"
  hook that fires inside an uncommitted transaction reports fiction if the
  transaction rolls back; ordering hooks after commit is part of the
  transaction discipline, not an optimization.

## The seam at the top: what the surface hands out

The repository's return types are the boundary's other half. Hand out domain
types and plain values; do not hand out anything that lets the caller
continue the conversation with the store — live cursors, lazy row iterators
tied to an open statement, connection-bound objects. Every such object is a
capability leak: it moves the end of the query outside the layer, entangles
callers with connection lifetime, and quietly breaks the one-module rule.
Where streaming is genuinely needed for scale, expose it as an explicit
paged or chunked *operation* on the surface — the layer keeps custody of
the statement; the caller gets data.

## Growth pressure and the mirror trap

Two failure shapes appear as the surface grows, and they are opposites.
**The mirror trap**: one repository function per statement, named after the
statement, until the surface is as wide as the query set and communicates
nothing — at which point callers agitate for a generic query function and
the layer collapses into a pass-through. **The god-module trap**: one module
accretes every operation for every table. The stable middle: partition the
layer by aggregate — the cluster of tables that change together under one
consistency boundary — with one module per aggregate owning all statements
that touch its tables. Cross-aggregate reads (reporting joins) get a home of
their own rather than a guest room in whichever aggregate came first; they
are reads, they respect both owners' schemas, and their placement is a
statement that they will break when either owner changes — which is exactly
the visibility you want.
