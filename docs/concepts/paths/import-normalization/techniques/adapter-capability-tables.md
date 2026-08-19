---
layer: technique
subject: import-normalization
technique: adapter-capability-tables
status: forged
laws: [one-authority-per-vocabulary, count-carries-predicate]
shared_with: []
---

# Adapters with capability tables as data

Each recognized foreign format gets **one adapter** — the only module in the
system that speaks that format's vocabulary — and the adapter's knowledge of
*what maps to what* lives in **declarative tables, not branching code**. The
technique is the difference between an import feature that a team can grow
weekly and one that only its original author dares touch.

## The adapter boundary

An adapter's contract is narrow: given a parsed document of its format (and
version), produce entities in the intermediate representation plus a loss
ledger. It never writes to the store, never talks to the user, never knows
about the review gate. Everything format-specific — the vendor's node
vocabulary, its parameter spellings, its credential field names, its quirks
("version 3 moved the trigger into the node list") — is confined here.
Downstream code that imports two formats identically is the proof the
boundary holds; a `switch` on source-format anywhere past the adapter is the
proof it leaked.

## What belongs in the tables

The mapping knowledge decomposes into a few table families, each a closed,
reviewable artifact:

- **Type maps** — foreign node/step/trigger type → internal kind, with the
  per-type parameter mapping (which foreign fields feed which internal
  fields, with unit or enum translations spelled out).
- **Capability grades** — per foreign type, what fidelity the mapping
  achieves: `full` (semantics preserved), `approximate` (works, differs in a
  stated way), `data-only` (carried as inert configuration for the user to
  finish by hand), `unsupported` (dropped, with reason). The grade column is
  what the loss ledger reads; it is written *here*, by the person who wrote
  the mapping, at the moment the knowledge is freshest.
- **Role classification patterns** — which foreign types are triggers,
  which are actions, which are routing/decision constructs, which are
  utilities that should not become host entities at all. Role decides an
  entity's *kind* in the host model, so misclassification is the
  highest-blast-radius row error; keeping it declarative keeps it auditable.
- **Credential consolidation rules** — foreign formats scatter secret-shaped
  fields (a token here, a key-plus-endpoint pair there, sometimes per-node),
  and frequently spell one real-world account as several distinct credential
  types; the rules declare which foreign fields are secrets, which of them
  consolidate into **one** internal credential requirement, and what
  internal connector type that requirement names. This table is a *security*
  artifact: a field the table misses is a secret the pipeline treats as
  ordinary text.
- **Exclusion lists** — foreign credential or node types the host itself
  provides (the host's own model access, its own scheduler) and must *not*
  re-surface as requirements the user is asked to fulfill twice.
- **Defaults and constants** — values the foreign format implies but never
  writes, which the internal model requires explicitly.

## Matching order is part of the table's semantics

Table rows are matched against foreign type strings by pattern — prefix,
substring, or glob — and the moment two patterns can both match one input,
**declaration order silently decides the winner**. The measured failure: a
generic row (`vendor`) declared above its specific siblings
(`vendor-spreadsheet`, `vendor-storage`) swallowed every specific match and
left those rows permanently unreachable — correct-looking table, wrong
behavior, no error anywhere. The fix is structural, not disciplinary: the
matcher **sorts by specificity** (longest pattern first) so the most
specific row wins regardless of authoring order, and authors never need to
know the trap exists. If your matcher walks the table in file order, the
file order is load-bearing and undocumented — which means it is wrong
already or will be after the next contributor.

## One authority, three consumers

The table is read by the **transformer** (to convert), by the **coverage
report** (to answer "what do we support?" in docs and marketing honestly),
and by the **loss ledger** (to grade every entity in a real import). That is
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
in load-bearing form: when support for a type is added or its grade changes,
all three surfaces move together because they are the same row. The
alternative — mapping logic in code, a support matrix in docs, disclosure
strings in the UI — is three hand-maintained copies of one vocabulary, and
they drift the week someone adds a type under deadline.

Coverage claims derived from the table inherit their predicate for free:
"supports 38 of the format's 51 node types at grade full-or-approximate,
per the version-4 table" is a sentence the table can prove
([count-carries-predicate](../../_laws.md#count-carries-predicate)).

The law has a second bite when the pipeline spans a process boundary — a
client that detects and previews, a service that validates and transforms.
Both sides need the tables, and the moment both copies are hand-edited, the
vocabulary has two authorities and a drift race. **Generate one side from
the other** (the same discipline as any cross-language constant), or load
both from one stored definition. A repo that did exactly this for its size
caps — one definition, a generated mirror, a CI check — and simultaneously
kept its mapping tables as two hand-maintained twins labeled "mirrors the
other struct" demonstrates both halves of the lesson in one codebase: the
mechanism is known, and nothing but the generator makes it apply.

## Extending support is editing a table

The payoff test: when a user asks for one more foreign node type, the diff
should be a **row** — type name, internal kind, parameter map, grade — plus
a fixture exercising it. If adding a type requires touching transformer
code, the table's schema is missing a concept (a parameter transform kind, a
conditional default) and the fix is to grow the schema once, not to open a
code escape hatch per row. Escape hatches (a per-row custom function) are
sometimes genuinely needed; keep them rare, named, and counted — a table
that is 30% escape hatches is branching code wearing a table costume.

## Unmapped types route through the table too

A foreign type with **no row** is not an error and not a skip — it is an
implicit `unsupported` row, and the adapter records it in the loss ledger
with the type name and an instance count. That record is the product's
demand signal: the ranked list of unmapped types actually appearing in real
user files is the only honest backlog for which rows to write next.

The trap to refuse here is the **fabricating fallback**: a resolver that,
finding no row, returns a cleaned-up version of the foreign type string *as
if it were* an internal vocabulary entry. It feels graceful — every node
"resolves" — but it mints host entities named after foreign implementation
details, pollutes the internal vocabulary with terms no other feature
recognizes, and, worst, erases the unsupported signal: nothing was dropped,
so nothing is disclosed, so the demand backlog never learns the type
exists. No-row must produce the *unsupported* grade, visibly, not a
plausible guess silently.
