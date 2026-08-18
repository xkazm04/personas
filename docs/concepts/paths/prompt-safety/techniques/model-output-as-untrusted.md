---
layer: technique
subject: prompt-safety
technique: model-output-as-untrusted
status: forged
laws: [one-validation-door, gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Model output as untrusted input

The outbound half of the trust boundary, for **action surfaces**: the moment
model output stops being text someone reads and starts being a command
something executes. This is the highest-stakes door in the subject, because
everything upstream — fences, caps, canaries — only raised the *cost* of
steering the model. This door decides what a steered (or merely wrong) model
can *do*. The design stance: the model is a brilliant, unvetted contractor
proposing operations; the acting layer is the door that decides which
proposals are even representable.

## A closed grammar of operations

Output that drives behavior is parsed against an **allowlisted operation
grammar**: a finite, named set of verbs, each with a typed parameter schema.
The properties that make it a security boundary rather than a parser:

- **Closed.** An operation not in the set is rejected — never fuzzily matched
  to the nearest legal one, never passed through "because the model probably
  meant something reasonable." Guessing converts the attacker's problem from
  *forge a legal operation* to *emit anything at all*.
- **Typed per parameter.** Each slot in each operation has its own grammar —
  identifier, enumeration member, bounded number, constrained string — checked
  before dispatch. Free-form strings in an operation schema are the holes;
  every one that must exist is escaped for wherever it lands next.
- **Least by default.** The grammar for a given context contains only the
  operations that context needs. A summarizing run has no delete verb in its
  grammar at all — the difference between "the model was told not to" and
  "the request is unrepresentable" is the difference between a norm and a
  wall.
- **Reject means stop, visibly.** An unparseable proposal is a failed run
  with its own outcome status
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)),
  surfaced with the offending output attached for diagnosis. Bounded
  self-repair (re-prompting with the parse error) is legitimate *inside* the
  door — but every repaired attempt re-enters through the full gate, and the
  repair loop has a hard iteration cap.

## Every identifier is validated against the live store

The subtlest hole in acting layers: an operation is grammatically perfect and
refers to something the requester should never touch. Models emit identifiers
from everywhere in context — including hostile spans that planted them
precisely to be echoed into an action ("summarize this document" → the
document says "operate on record X" → the model proposes record X).

So the rule is unconditional: **no identifier the model emits is acted on
until it is resolved against the live authoritative store and checked for
existence, ownership, and entitlement in the acting context.** Three checks,
none implied by the others:

- **Existence** — it resolves at all; phantom identifiers fail cleanly here
  rather than deep in the action.
- **Ownership/scope** — it belongs to the tenant, workspace, or session the
  run acts for; a real identifier from someone else's data is the confused-
  deputy payload.
- **Entitlement** — this run, with this authority, may perform this verb on
  this record — the acting layer's own authorization check, at act time,
  regardless of what the prompt believed
  ([authorization](../../authorization/authorization.md) owns the entitlement
  model; this door is one of its enforcement points).

Validation reads the **current** store, not a snapshot from prompt-assembly
time ([gate-sees-target](../../_laws.md#gate-sees-target)): the record set
changes between assembly and action, and a check against the stale copy
passes exactly when the world has moved — the moment the check exists for.

## Escaping toward every next interpreter

Between "parsed" and "done", operation parameters travel into other
grammars — a query, a shell, a path, a markup surface, a log line. Every
model-authored string is escaped or parameterized for the specific
interpreter it enters: parameterized statements for queries, argument arrays
(never string-concatenated command lines) for processes, canonical-resolve-
then-contain for paths, the
[output-sanitization](output-sanitization.md) pass for anything rendered or
logged. The model is just another producer of the oldest injection classes;
all the classical rules apply, with the twist that this producer can be
*persuaded* by data it read.

## The acting layer holds least privilege

The final containment is not textual at all: the process or module that
executes validated operations holds only the capabilities those operations
need. It acts through brokered credentials it never sees
([credential-vault](../../credential-vault/credential-vault.md)), writes
through the same repositories every other caller uses (no private side door
that skips their checks), and for operations that are irreversible or
high-blast-radius, it stops and asks
([hitl-approval](../../hitl-approval/hitl-approval.md)) — the human gate as
the last, non-negotiable validator. Where the toolset is provided by an
external protocol, tool definitions are the grammar and the same discipline
applies at that boundary ([mcp-tools](../../mcp-tools/mcp-tools.md)).

Sizing rule for the whole door: assume the model's proposal stream is, on a
bad day, fully attacker-authored. The system's worst-case is then whatever
this door plus the acting layer's privileges allow — that is the number to
design down, because it is the only one that does not depend on the model
behaving.
