---
layer: technique
subject: import-normalization
technique: import-validation
status: forged
laws: [one-validation-door, failure-not-empty-success]
shared_with: []
---

# Import validation & sanitization

An imported file is **untrusted input with a friendly backstory**. The user
trusts it ("it's my own export"), the team trusts it ("it came from a real
product"), and neither trust is transferable to the bytes: the file may have
been crafted, tampered with in transit, exported from a compromised account,
or simply be enormous and pathological by accident. This technique is the
set of checks standing between the parse and anything that persists or
executes — and the discipline that they all live at declared doors, not
scattered as per-field paranoia.

## Bounded parsing: caps before deserialization

The cheapest attacks are resource attacks, and they hit before any schema
logic runs: multi-hundred-megabyte files, pathologically deep nesting that
overflows recursive parsers, entity counts chosen to make the review UI
allocate forever. The counters are enforced **before and during** parse, not
after: a byte-size cap at intake, a nesting-depth cap in (or wrapped around)
the deserializer, and entity-count caps at adaptation. Each cap, when hit,
produces a described refusal naming the limit — "file exceeds the 10 MB
import limit" is a support-ticket answer;
an out-of-memory crash is an incident.

Caps get enforced twice by architecture — once in the client for a fast,
friendly refusal, once at the service door because the client is advice,
not enforcement — which makes the cap value itself a cross-boundary
vocabulary. Define it **once**, on the enforcing side, and generate the
client's copy from it with a check that fails the build on drift. Two
hand-typed cap constants agree until the week one of them is raised. Size
the caps from measured reality, and write the rationale beside the number:
a cap whose derivation is recorded ("legitimate exports observed under
200 KB; the cap is 25× that") can be re-derived when reality moves; a bare
number can only be cargo-culted.

## One door: import is a writer, not a bypass

Everything the import proposes ultimately becomes entities in the host
store, and the host store already has a validation door — the same
invariants that entities created by hand must satisfy. The import **goes
through that door**, per
[one-validation-door](../../_laws.md#one-validation-door). The tempting
shortcut — a bulk insert path "because we already validated the IR" — forks
validation into two copies that drift, and the import copy drifts first
because it changes with foreign formats, not with the host model. IR-level
validation (shape, references, grades) is *additional* and earlier; it never
substitutes for the creation door.

And the strongest validation posture available to an import is one it gets
almost for free: **the adapter's lowering is a reconstruction, not a
filter**. An adapter that reads the foreign fields it knows *by name* and
builds fresh internal entities from what survived has — by construction —
dropped every field it never thought of; an adapter that clones or spreads
foreign objects into the internal representation forwards unknown keys it
cannot vouch for, and they ride through every later door as legitimate
structure. The same reconstruction discipline governs the model-output
boundary in [structured-output](../../structured-output/structured-output.md);
here it is cheaper, because lowering *has* to touch every field anyway —
the only mistake available is to copy wholesale out of convenience.

Reference validation is part of the door's job here in a form hand-creation
never exercises: an imported document arrives as a **closed graph of
cross-references** (steps referencing steps, credentials, positions in a
sequence), all rewritten to minted ids at the waist (see
[intermediate-representation](intermediate-representation.md)). Validation
proves the graph is closed — every reference lands on an entity in this same
proposal or on a host entity the user actually has — before review renders
it as selectable.

## Sink-aware sanitization

Field-level type checks miss the real hazard class: **string values that are
inert in the store and live at a sink**. The import cannot know every future
sink, but the host knows its dangerous ones, and imported text bound for
them is treated at the boundary:

- **Prompt sinks.** Imported names, descriptions, and parameter text will
  eventually be interpolated into model prompts — an imported definition is
  a prompt-injection carrier with excellent cover. Fencing and neutralizing
  that text is [prompt-safety](../../prompt-safety/prompt-safety.md)'s
  discipline; the import's obligation is to *mark* imported strings as
  untrusted-origin so the fencing actually engages, and to cap their length
  so a "description" cannot smuggle a ten-thousand-token payload.
- **Model-transformation sinks.** When the pipeline hands imported material
  to a model for conversion (generating host-native configuration from the
  foreign description), the model's output is a second untrusted artifact —
  the full extraction-and-validation discipline of
  [structured-output](../../structured-output/structured-output.md) applies
  to it, at its own single door.
- **Execution-adjacent fields.** Foreign formats carry expression snippets,
  inline code, and templated strings. The host either supports a
  corresponding executable concept — in which case the snippet imports as
  *disabled-by-default, visibly foreign* content the user reviews — or it
  does not, in which case the snippet is `data-only` cargo, never something
  an executor might later discover and helpfully evaluate.
- **Fetchable references.** URLs and endpoints in imported configuration
  are data until a user-authorized action fetches them; an import that
  triggers network calls to attacker-chosen hosts during *parsing or
  preview* is an exfiltration primitive.

## Secrets quarantine

Foreign exports contain secret-shaped material — sometimes real tokens the
vendor failed to strip, sometimes placeholders, sometimes credential
*references*. The credential consolidation table (see
[adapter-capability-tables](adapter-capability-tables.md)) declares which
fields are secret-bearing, and the rule for all of them is the same:
**values never persist with the entities**. A discovered value is either
discarded with disclosure ("this export contained an embedded token; we did
not import it") or offered into the host's credential flow, where it lands
encrypted, scoped, and owned — the
[credential-vault](../../credential-vault/credential-vault.md) door, not a
string column. What persists with the entity is a credential *requirement*:
a typed, valueless slot the user fulfills. The failure this kills is quiet
and durable: plaintext secrets riding an import into a store whose whole
security story assumed secrets only enter through the vault.

## Refusal is described, attributed, and partial where honest

Validation failures are outcomes, not exceptions escaping sideways
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
Attribution matters: "entity 14, field `retry_count`: must be a
non-negative integer" lets the user fix their file or deselect the entity;
"import failed" teaches nothing. And validity is per-entity where the
entities are independent — one malformed step disqualifies itself (shown at
review as unimportable, with its reason), not the other forty-nine. Whole-
file refusal is reserved for whole-file problems: unreadable syntax, caps
exceeded, an unclosed reference graph.
