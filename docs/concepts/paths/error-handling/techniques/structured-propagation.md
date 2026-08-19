---
layer: technique
subject: error-handling
technique: structured-propagation
status: forged
laws: []
shared_with: []
---

# Structured propagation

Failures are born deep — a socket, a driver, a parser — and are decided high
— a request boundary, a command handler, a surface. Propagation is
everything between birth and the door, and it has one job: deliver to the
deciding layer a failure that is still *classifiable* and still
*diagnosable*. Both properties are lost by default; keeping them is the
technique.

## The typed error as the unit of propagation

What travels between layers is a **structured value**, not a string:

- the **category** from the taxonomy (see
  [taxonomy-design](taxonomy-design.md)) — the field every consumer
  branches on;
- the **cause** — the original failure, preserved intact, recursively (a
  cause chain, not a flattened summary);
- **context** — the accumulated trail of what each layer was doing;
- optional **category-specific data** — the stated retry interval, the
  field that failed validation, the entity that was not found.

Any layer may inspect the value; only the deciding layer routes it to a
door. This split — *enrich below, decide above* — is what keeps one failure
from being reported three times (see [error-doors](error-doors.md)).

## Enrichment: add what only you know

Each layer wraps the failure with what only it knows — which operation,
which entity, which attempt, which configuration was active. Rules:

- **Wrap, never replace.** Wrapping that discards the inner cause converts
  a diagnosable failure into "something failed somewhere below". The
  original classification and the original diagnostic detail must survive
  to the top, however many layers wrap them.
- **The category is decided at birth, at the boundary where structure
  exists** — where the status code, the native error kind, the typed
  variant is still in hand. Layers above may *narrow* a category with local
  knowledge ("not-found here means the record was deleted mid-flight"), but
  re-deriving the category high in the stack, from whatever survived, is
  re-classification of degraded input.
- **Context is for humans; fields are for machines.** The operation trail
  can be prose; anything a consumer will branch on or aggregate by must be
  a typed field. Aggregation by message text scatters one cause across a
  hundred wordings.

## Representation boundaries: class must cross

Real systems change error representation several times on the way up:
exception to returned value, returned value back to exception, native error
to serialized payload across a process or wire boundary, one language's
error type to another's. Every conversion is a chance to lose everything,
and one loss mode dominates:

> **Stringification at a boundary is the propagation killer.** The
> structured error flattened into its message text leaves the far side
> classifying prose — exactly what the whole subject forbids — and the far
> side degrades to the catch-all category with the vaguest copy and the
> most conservative policy. The system still "works"; it is merely wrong
> about every failure.

Discipline per boundary:

- Define the **serialized error shape** as part of the boundary's contract:
  category tag, message, context, category-specific fields. Both sides
  parse and emit it; round-trip tests pin it.
- **The category tag crosses as a stable machine string** (the authority's
  wire spelling — see taxonomy mirroring), never as a display string.
- A boundary that can carry only a string (a legacy channel, a constrained
  transport) carries a **serialized structure inside the string**, parsed
  on the far side — with the plain-prose case handled as the explicit
  fallback tier, not the norm.
- **Asynchronous and deferred paths are boundaries too.** A failure moved
  into a queue, a scheduled retry, or a background continuation must carry
  its structure with it; re-raising it later as a bare message orphans it
  from its cause and category.
- **The failures the system mints itself have no excuse.** Prose
  classification is a concession to *foreign* sources; a failure your own
  code constructs had its category in hand at the moment of minting.
  Flattening it to a message and letting it re-enter your own classifier
  downstream is a self-inflicted boundary loss — and it bites in the
  canonical measured shape: the system's own deadline-exceeded message
  failing the system's own timeout matcher, so the one category with the
  best recovery odds lands in the catch-all whose policy is "never retry".
  When you mint a failure, attach the category; never make your classifier
  rediscover from prose what the mint site knew as a fact.

## Loss is one-way

The asymmetry that justifies all this ceremony: a layer that receives a
structured failure can always choose to ignore the structure, but a layer
that receives a string can never recover it. Propagation decisions are
therefore made for the *most demanding* consumer — the door that wants full
diagnostics and exact classification — because every less demanding
consumer can project downward from structure, and no one can project up
from prose.
