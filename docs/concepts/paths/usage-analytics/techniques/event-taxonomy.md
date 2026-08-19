---
layer: technique
subject: usage-analytics
technique: event-taxonomy
status: forged
laws: [one-authority-per-vocabulary, identity-survives-reuse, count-carries-predicate]
shared_with: []
---

# Event taxonomy

The event vocabulary is the analytics system's schema, and it deserves the
same rigor as any schema: designed before use, owned in one place, extended
deliberately, never mutated silently. Everything downstream — queries,
dashboards, trend lines, the ignored-surface report — is only as coherent as
the names it groups by.

## The swamp, and why it is the default

Free-form emission is the natural state: any call site records any string.
The rot is gradual and irreversible. First come the synonyms — one screen
records `open`, another `opened`, a third `view`. Then the payload drift —
`id` means a document on one screen and a workspace on another. Then the
question that cannot be answered: "how often do users export?" has no query,
because exporting has four names and none of them is authoritative. At that
point the data is not merely messy; it is *unqueryable*, and the only honest
fix is to declare a year of history unreadable and start over. The taxonomy
technique exists to make that year never happen.

## One registry, one grammar

Every event name lives in a single registry — a closed enumeration the emit
door validates against, so an unknown name is a rejected record at the
boundary, not a new species in the warehouse
([law: one authority per vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The registry entry carries the event's full contract: its name, its payload
fields and their types, the question it exists to answer, and its status
(live or retired).

Names follow one grammar, chosen once and never negotiated per call site. A
workable one:

- **`object_action`, action in the past tense** — `section_visited`,
  `export_completed`, `setting_changed`. Past tense because an event is a
  record of something that happened, not a command.
- **Objects come from the product's existing vocabularies** — the surface
  ids from the navigation registry, the entity names from the domain model —
  never freshly invented spellings of them
  ([law: identity survives reuse](../../_laws.md#identity-survives-reuse)):
  when a surface is renamed for display, its analytics identity must not
  move, or every trend line breaks at the rename.
- **Payload fields are enumerated per event, closed, and typed.** No
  free-form string field, ever — a free-form field is where user content
  leaks in and where cardinality explodes. If a field's values form a set,
  the set is declared and validated like the event names are.

## What earns an event

The vocabulary stays queryable by staying small. The admission test is a
named question: an event earns its place when someone can state the decision
its data would change — "is this surface worth its maintenance cost", "do
users who start this flow finish it". "It might be interesting" admits
nothing; interesting-later can be added later, and the asymmetry is the whole
point — an event added late costs a gap in history, while an event added
speculatively costs vocabulary rot, privacy surface, and quota forever.

Corollary: most surfaces need only the standard pair — a visit event and an
activation event — both emitted by shared plumbing, not per-surface code. The
bespoke events are the rare, argued-for minority.

## Versioning: meaning never mutates silently

A dashboard groups a year of records by name. The moment a name's *meaning*
changes — the event fires in more places, the payload field changes unit, the
action's definition widens — every count that spans the change is corrupted,
and nothing in the data says so
([law: a count carries its predicate](../../_laws.md#count-carries-predicate)).
The rules:

- **A meaning change is a new name** (or an explicit version suffix). The old
  name is retired, not repurposed. Trend continuity is broken *visibly*, at a
  named boundary, instead of silently.
- **Additive payload fields are safe; everything else is a new version.**
  Adding an optional field does not corrupt old queries. Renaming, retyping,
  or re-uniting a field does.
- **Retired names stay in the registry**, marked retired with a date and a
  pointer to their successor. The registry is the record of what historical
  data means; deleting an entry orphans every stored record bearing the name.

## Retirement is part of the lifecycle

An event whose question has been answered — or whose surface has been removed
— is retired: the emit sites deleted, the registry entry marked, downstream
reports told. A vocabulary that only grows becomes a swamp by sheer mass even
if every entry was once justified. The registry entry's "question it answers"
field is what makes this audit possible years later; an event whose question
nobody can restate is a retirement candidate by default.
