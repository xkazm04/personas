---
layer: golden-path
subject: import-normalization
status: forged
techniques:
  - format-detection
  - adapter-capability-tables
  - intermediate-representation
  - import-validation
  - review-before-commit
  - lossy-conversion-disclosure
evidence:
  - src/lib/personas/parsers/workflowDetector.ts        # structural fingerprints, confidence grades, honest unknown outcome
  - src/lib/personas/parsers/workflowParser.ts          # bounded parse (YAML depth caps), unknown → speculative parse + mandatory user confirmation, zero-candidate refusal that names supported formats
  - src/lib/personas/parsers/workflowPipeline.ts        # the narrow waist: per-format adapters lower into NormalizedNode[], one shared extraction pipeline produces the host proposal
  - src/lib/personas/platformDefinitions.ts             # capability tables as data: node-type maps, credential consolidation, role classification, exclusions; specificity-sorted matching
  - src/lib/utils/sanitizers/workflowSanitizer.ts       # imported names/params sanitized before prompt embedding; shared injection-pattern module so sibling sanitizers can't drift
  - src-tauri/src/commands/design/n8n_limits.rs         # size caps defined once, exported to the client by codegen — one authority for the bound, both runtimes enforce it
  - src-tauri/src/commands/design/n8n_transform/prompt_sanitizer.rs  # structural isolation (nonce fencing) of untrusted workflow data at the model boundary
  - src-tauri/src/commands/design/n8n_transform/confirmation.rs      # staged receipt row + atomic create-with-rollback; per-entity errors returned; credential slots surfaced as requirements, never values
  - src/features/templates/sub_n8n/hooks/useN8nImportReducer.ts      # review wizard upload→analyze→transform→edit→confirm; restored step re-proven against restored state
counter_evidence:
  - src-tauri/engine/src/platform_rules.rs              # second hand-maintained copy of the capability tables — the TS file says "mirrors the Rust struct" and no codegen links them; the caps got one authority, the tables got a race
deviations:
  - w11-import-normalization   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Foreign-format import & normalization

A product that lets users bring their existing work from elsewhere — automation
definitions, workflow exports, configuration bundles, pipeline descriptions —
is building a **compiler front-end wearing a product feature's clothes**. The
input is a serialized artifact produced by software you do not control, in a
format you learned by observation rather than contract, carrying semantics
that only partially overlap your own. The output is entities in *your* model,
persisted in *your* store, some of which may later *execute*. Everything hard
about this surface follows from those three facts: the format is foreign, the
mapping is partial, and the destination is live.

The shape that survives is a staged pipeline with a narrow waist:

```
raw bytes → detect → parse (bounded) → adapt (per format, table-driven)
          → normalized intermediate representation (+ loss ledger)
          → validate & sanitize → user review → commit
```

Each stage has one job, each stage can refuse, and refusal at every stage is a
described outcome — never a crash, never a silent empty result, and never a
half-imported store. The user's original file is immutable throughout: an
import **reads** the foreign artifact and **proposes** internal entities; it
never edits the source and nothing persists before the review gate.

Two boundaries fix the subject's borders. Upstream of this path sits whatever
delivered the bytes — file picker, paste buffer, URL fetch, marketplace
download; transport is not this subject. Downstream sits everything the
committed entities then do — execution, scheduling, credential resolution
against the connector catalog, template scaffolding for the entities that land
as reusable blueprints. This path ends at the moment validated, user-confirmed
entities cross into the normal creation door of the host model; from that
point on they are ordinary citizens with a provenance stamp, not special
"imported" objects with a parallel lifecycle.

When *not* to build this:

- **When you control both ends.** Moving your own entities between your own
  instances is export/restore — a versioned serialization of your own model
  with none of the foreign-semantics problem. Do not route it through the
  foreign-import machinery, and do not let the foreign-import machinery relax
  because "it's probably our own format anyway".
- **When one format, one consumer, forever.** A single foreign format feeding
  a single destination can be a straight-line converter. The moment a second
  source format or a second consumer appears, retrofit the narrow waist —
  the pairwise-converter matrix grows as a product, not a sum.
- **When fidelity must be total.** If the business requirement is "everything
  round-trips exactly", you are not importing — you are embedding the foreign
  system's semantics, which is a different (and usually doomed) commitment.
  Import is *useful, honest, partial* translation. Say so up front.

## Detection before parsing

The first stage answers one question — *what is this?* — and it answers it
from **structural fingerprints, not labels**. File extensions lie, users paste
the wrong clipboard, and every vendor's export is "a text file" from the
outside. A detector examines cheap, discriminating structure: signature keys,
envelope shapes, version stamps, the presence of a node list versus a step
array versus a trigger block. Detection is ordered from most to least
specific, and it terminates in one of exactly three outcomes: a **named
format with a version and a confidence grade**, an **ambiguity** (more than
one candidate — resolved with the user, never by silent preference), or an
honest **unknown**.

Unknown is a first-class result with its own user-facing rendering ("this
does not look like any format we can import, here is what we looked for") —
never a *silent* fall-through into the most permissive parser, which
converts "we don't support this" into a screenful of nonsense entities that
the user may plausibly commit. The disciplined middle ground exists: when
fingerprints are inconclusive, run the adapters speculatively, keep the best
candidate, and **flag the result as a guess the user must confirm** — with
an honest refusal, naming the supported formats and each adapter's error,
when nothing usable emerges. What separates that from the anti-pattern is
one bit of state: the guess admits it is a guess. The rule generalizes the
law that failure must be spelled differently from empty success:
*unrecognized input must be spelled differently from an empty recognized
document.* Owned by
[format-detection](techniques/format-detection.md).

## One adapter per format; capability as data

Each recognized format gets exactly one **adapter** — the only code in the
system that knows that format's vocabulary. Everything downstream speaks the
internal representation only. Inside the adapter, the knowledge of *what maps
to what* — this foreign node type is our HTTP step, that trigger kind is our
schedule, these three credential fields consolidate into one secret of ours —
lives in **declarative capability tables, not in branching code**. The table
is simultaneously the transformer's instruction set, the coverage report's
source of truth, and the loss ledger's denominator: one authority, three
consumers, zero drift. Extending support for a new foreign node type means
adding a row; the diff is reviewable by someone who knows the two vocabularies
and nothing about the pipeline.

One warning earned the hard way: when the tables must exist on both sides of
a process boundary (a client that previews, a service that transforms),
**generate one side from the other**. Two hand-edited copies of a mapping
table are a race with a delay fuse, and the loser is whichever copy the next
format revision reaches second — the same repo that gave its size caps a
single authority with a generated mirror left its mapping tables as two
hand-maintained twins. Owned by
[adapter-capability-tables](techniques/adapter-capability-tables.md).

## The narrow waist: one intermediate representation

All adapters lower into a single **normalized intermediate representation** —
the IR. It is the product's own honest answer to "what do all these foreign
things have in common that we care about": steps, connections, triggers,
credentials-needed, parameters, plus per-entity **provenance** (source format,
source version, the foreign identifier it came from) and the **loss ledger**
(what the adapter could not carry, per entity, with reasons).

The IR is where identity is minted. Foreign identifiers are recorded as
provenance but never trusted as primary keys — they collide across files,
across re-imports of the same file, and across formats. Internal identity is
minted at IR construction and survives everything downstream, including the
user deselecting half the entities at review. Owned by
[intermediate-representation](techniques/intermediate-representation.md).

## An imported definition is untrusted input

A foreign file is attacker-grade input wearing a colleague's name. It can be
crafted, it can be huge, it can be deeply nested, and — the part teams miss —
its *contents* flow into dangerous sinks: parameter strings that will be
rendered into prompts, expressions that look executable, URLs that will be
fetched, credential values that must not land in plaintext. The pipeline
therefore enforces, before anything persists:

- **bounded parsing** — size and depth caps *before* deserialization, so a
  hostile file exhausts a limit, not the process;
- **one validation door** — every entity the import proposes passes the same
  schema validation as entities created by hand; import is a writer like any
  other, not a trusted bulk side-channel around the model's invariants;
- **sanitization at the sink boundary** — text that will reach a prompt is
  fenced as untrusted the way [prompt-safety](../prompt-safety/prompt-safety.md)
  prescribes; structures that a model will later transform obey the
  extraction discipline of
  [structured-output](../structured-output/structured-output.md);
- **secrets quarantine** — credential material discovered inside the file is
  never persisted with the entities; it is routed into the
  [credential-vault](../credential-vault/credential-vault.md) flow as a
  *credential requirement* the user fulfills, not a value the import smuggles.

Owned by [import-validation](techniques/import-validation.md).

## Review before commit

Between "we understood your file" and "it is now in your workspace" stands a
**review gate**: the user sees what was found, what it will become, what will
not survive the trip, and selects what to bring. This is a wizard in the full
sense of [wizard-flows](../wizard-flows/wizard-flows.md) — staged state,
resumable, with the commit boundary at the end — and the import-specific
obligations are what this subject adds: per-entity opt-in rather than
all-or-nothing, explicit collision policy when an incoming entity matches an
existing one (skip / rename / replace as a user choice, never a silent
default), and the loss disclosure rendered *at the decision point*, because
consent to a lossy conversion is only consent if the loss was visible when
the user clicked. Commit is atomic per selection: the confirmed subset lands
through the normal creation door in one transaction-like unit, and a failure
mid-commit leaves the store as if the import never happened. Owned by
[review-before-commit](techniques/review-before-commit.md).

## Losses are enumerated, never absorbed

The defining ethical property of this surface: **whatever did not map is told
to the user, itemized, with reasons** — never silently dropped, never
flattened into a vague "some features are not supported". Every entity in the
IR carries its conversion grade (mapped cleanly · approximated · carried as
inert data · dropped), the ledger's counts always name their predicate, and
the same ledger powers the honest answer to the round-trip question: what
could be exported back, what has been rebuilt in host-native terms, and what
is gone. A product that imports 40 of 50 nodes and says "imported!" has not
saved the user four hours of rebuilding — it has hidden the four hours inside
a runtime surprise. Owned by
[lossy-conversion-disclosure](techniques/lossy-conversion-disclosure.md).

## Round-trip honesty

Import is usually one-way, and pretending otherwise is a slow-burning trust
failure. State the contract explicitly, in product surface and in docs: which
entities can be exported back to the foreign format (typically: none, or a
degraded subset), which are now host-native and export only in the host's own
format, and which were consumed as one-time seeds (an import that lands as a
scaffold for template creation is a seed, not a synchronized mirror). If a
bidirectional bridge is ever built, it is a separate subject with separate
machinery — a sync engine with conflict semantics — not a bigger import
button. The loss ledger from the inbound trip is the design input for any
outbound claim: you cannot export back what you disclosed you dropped.

## Operator posture

An import pipeline decays from the outside: the foreign vendor ships a new
export version, a new node type becomes popular, and your detector or your
tables quietly age. The counters that make the decay visible are part of the
pipeline — detection outcomes by format and version (unknowns rising is the
alarm), unmapped-type frequency from the loss ledger (the backlog for new
table rows, ranked by real demand), review-gate abandonment (users who saw
the disclosure and walked away are telling you which losses matter). Each
number carries its predicate, and the unmapped-type ranking is the rare
metric that converts directly into a roadmap.

## The techniques

- [format-detection](techniques/format-detection.md) — structural
  fingerprinting, ordered discriminators, version sniffing, and the honest
  unknown/ambiguous outcomes.
- [adapter-capability-tables](techniques/adapter-capability-tables.md) — one
  adapter per format; node-type maps, parameter maps, and credential
  consolidation rules as reviewable data.
- [intermediate-representation](techniques/intermediate-representation.md) —
  the narrow waist: normalized entities, minted identity, provenance, and the
  loss ledger as IR citizens.
- [import-validation](techniques/import-validation.md) — bounded parsing, the
  single validation door, sink-aware sanitization, and secrets quarantine.
- [review-before-commit](techniques/review-before-commit.md) — the selection
  gate: per-entity opt-in, collision policy, disclosure at the decision
  point, atomic commit.
- [lossy-conversion-disclosure](techniques/lossy-conversion-disclosure.md) —
  conversion grades, the itemized ledger, counts with predicates, and the
  round-trip contract.
