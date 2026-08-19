---
layer: technique
subject: mcp-tools
technique: tool-schema-design
status: forged
laws: [failure-not-empty-success, gate-sees-target, one-authority-per-vocabulary]
shared_with: []
---

# Tool schema design

A tool definition is a contract with two readers of very different kinds: a
**model** that will choose the tool and compose its arguments from prose
understanding, and a **program** (the server's validator) that will enforce
the schema literally. Design for both at once. The model reads the name,
description, and schema as *prompt material* — they are the only map it has —
while the server reads the schema as *law*. A definition that is fluent for
one reader and sloppy for the other fails in the mode of its sloppy half:
either the model misuses a well-enforced tool, or the model correctly uses a
tool whose server never checked what arrived.

## Naming for selection

The model selects a tool by name and description against a catalog of
competitors. Names therefore carry the disambiguation load:

- **Namespace, then verb-object**: `calendar_create_event`, not `create` —
  in a federated catalog, bare verbs from different servers collide, and the
  model's choice between colliding names is a coin flip weighted by
  description prose.
- **One tool, one operation.** A `manage_events` tool with an `action`
  argument hides the real operations from the selection step, where the model
  most needs to see them, and forces the schema into a union type that
  validates weakly.
- **The description says when to use it and when not to** — "searches
  scheduled events; for creating events use calendar_create_event" resolves
  at selection time the ambiguity that would otherwise surface as a wrong
  call. Descriptions are prompt engineering with a maintenance obligation:
  vague or stale descriptions are not cosmetic debt, they are active
  misdirection injected into every conversation that lists the tool.

## Arguments for a caller that guesses

The model is a probabilistic caller: it will produce plausible arguments, not
guaranteed-correct ones. Argument design absorbs that:

- **Flat and few.** Every additional argument multiplies the composition
  error rate; deep nesting multiplies it faster. If a tool wants seven
  arguments, it usually wants to be two tools.
- **Enums over free strings** wherever a closed set exists — the schema then
  *teaches* the legal vocabulary at selection time and the validator rejects
  the rest, one definition serving both readers
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
- **Constrain in the schema, not the prose.** Formats, ranges, required-ness
  belong in the machine-readable contract; a constraint that lives only in
  the description is enforced only by luck. Defaults declared in the schema
  spare the model a guess it can get wrong.
- **Identifiers come from prior results.** Arguments that accept an id should
  expect ids the model has actually seen (from an earlier listing call), and
  servers must treat any id as a claim to check against the caller's
  entitlements — the model will happily pass an id it hallucinated or one an
  injected result fed it.

Validation runs server-side, at dispatch, against the declared schema
([gate-sees-target](../../_laws.md#gate-sees-target)). The published schema
and the enforced schema must be the same artifact — a validator maintained by
hand alongside a schema maintained by hand is two authorities for one
contract, and they will diverge the week someone adds a field to only one.

## Results for a reader that reasons

The result is prompt material too — the model will read it, quote it, and act
on it. Shape accordingly:

- **Return answers, not payload dumps.** A raw upstream response with forty
  fields spends the caller's context on noise and invites the model to
  fixate on irrelevant detail. Select, summarize, and structure to the
  altitude of the question the tool answers.
- **Structured content when the contract matters.** Alongside human-readable
  text, results can carry machine-checkable structured output with its own
  declared schema — the same two-readers principle applied outbound. When a
  consuming application needs to *rely* on a field, that field belongs in
  validated structure, not in prose the model paraphrases.
- **Bound the size.** Tool results are the easiest place to blow a context
  budget; pagination and truncation with explicit "more exists" markers are
  part of the result contract, not an optimization.
- **Results are also an injection surface** — anything upstream-controlled
  that a result embeds rides straight into the model's context; the
  consuming-side defenses are
  [untrusted-result-handling](untrusted-result-handling.md), but the schema
  designer helps by keeping upstream text clearly attributed and separable
  from the tool's own voice.

## Two error channels, deliberately distinct

This subject's instance of
[failure-not-empty-success](../../_laws.md#failure-not-empty-success) is the
split between:

- **Protocol errors** — unknown tool, malformed arguments, failed
  authentication. The *call itself* was invalid; the error is addressed to
  the machinery, carries a machine-readable code, and never pretends to be a
  domain outcome.
- **In-band tool errors** — the search found nothing, the upstream API
  rejected the request, the file is missing. The call was valid and this is
  its *outcome*, flagged as an error but delivered as a result, addressed to
  the model — which can read it, explain it, and try a different approach.
  An in-band error worth returning tells the model what to do next: "date
  must be in the future" recovers in one turn; "error 422" burns a turn on
  archaeology.

Routing domain failures through the protocol channel kills conversations
that could have self-corrected; routing infrastructure failures in-band
buries operational fires in prose the model will politely summarize. And the
empty case is its own case: "no results" is a successful result saying so —
never an error, and never a silent empty string indistinguishable from a
tool that broke.

The channel binds the consumer too. The in-band error flag is only a
contract if every reader honors it — one audited system carried the flag on
the wire and recorded tens of thousands of tool results whose parser never
read it, so a failed call and a successful call became the same row in every
trace, audit line, and incident query downstream. A host that persists,
displays, or aggregates tool results without propagating their error flag
has rebuilt empty-success-as-failure one layer up, where no schema will
catch it.

## Annotate the blast radius, then distrust the annotation

Declared behavior hints — read-only, destructive, idempotent — let a host
sort tools into consent tiers: auto-approve the harmless, always-confirm the
irreversible. Publish them honestly. And on the consuming side, remember what
they are: **unverified claims by the server about itself.** A host may relax
friction for tools *claiming* to be read-only from servers it already
trusts; it must never treat the claim as proof across a trust boundary. The
annotation is a sorting hint for consent design, not a security property.
