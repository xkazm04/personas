---
layer: technique
subject: data-access
technique: repo-testing
status: forged
laws: [gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Repository testing

The data layer is the one layer whose correctness is defined by an external
system's behavior — the store's type coercions, its constraint enforcement,
its query planner's answer to your string. Testing it is therefore a
different discipline from testing pure logic, and the central rule falls out
immediately: **test against the real engine.**

## The real engine, not a mock of it

A mocked store returns whatever the test author believed the store would
return. Every one of this subject's interesting failure classes lives
precisely in the gap between that belief and the engine's actual behavior:
a statement with a syntax error the mock happily "executed", a type
coercion the author did not know about, a constraint that fires in a
different order, a null where the author assumed a default. A green suite
over a mocked store is a gate that observed a proxy
([gate-sees-target](../../_laws.md#gate-sees-target)); it passes exactly
when the belief diverges from the engine — the moment the test existed for.

Embedded and file-backed engines make this cheap: an in-memory or temp-file
instance per test, spun up in milliseconds. Client-server engines make it a
containerized fixture — more setup, same principle. The mock's legitimate
home is one layer *up*: application logic is tested against a mocked
*repository interface*, which is a contract you own and can fake honestly.
Mock the layer you wrote; never the engine you didn't.

## Build the test store by the production road

The test store's schema must come from **the same mechanism production
uses** — run the real migration chain (or the real schema-creation path)
against the fresh test instance. A hand-maintained "test schema" file is a
second authority for what the schema is, and it drifts from the first the
week someone ships a migration and forgets the copy; from then on the suite
is green against a schema production does not have. As a free by-product,
every repository test becomes a smoke test of the migration chain against
an empty store.

## Isolation: every test gets its own truth

Shared store state across tests produces the worst suite pathology:
order-dependent tests that pass alone and fail together, or worse, pass
*because of* a sibling's leftovers. The isolation options, in descending
order of strictness:

1. **Fresh instance per test.** Strongest and simplest to reason about;
   with an embedded engine, usually affordable. Default to this until the
   suite's runtime says otherwise.
2. **One instance, transaction-rollback per test.** Fast, but it forbids
   the code under test from managing its own transactions (the test's
   wrapper collides with the layer's boundaries) — which disqualifies it
   for exactly the unit-of-work code most worth testing.
3. **One instance, truncate between tests.** Middle ground; honest only if
   the truncation list is generated from the live schema, not maintained
   by hand (a hand list misses the table added last sprint, and the suite
   goes order-dependent silently).

Whichever level is chosen, the choice is the suite's, made once — not
per-test-file folklore.

## Fixtures go through the front door

Test data is created **through the repository's own write surface**, not by
raw inserts. The reasons compound: fixtures written via the surface can
only produce states the application can produce, so tests never certify
behavior against impossible data; they exercise the write path as a side
effect; and when the schema changes, fixtures follow the surface instead of
breaking in a hundred raw statements. Builder-style helpers with defaults
("a completed record, owned by X, three children") keep this terse.

The **one licensed exception** is the deliberate manufacture of illegal
state: corruption drills and legacy-shape rows *cannot* come through the
front door, because the front door's whole job is refusing them. Those
tests use a clearly named raw hatch, quarantined in test code:

- **Corruption drills**: write a row with a mangled serialized field, an
  unknown vocabulary value, a null the domain forbids — then assert the
  honesty contract: the collection read returns the healthy rows *and*
  records the skip (assert the telemetry, not just the result — a policy
  whose observability half is untested will lose it in a refactor,
  [failure-not-empty-success](../../_laws.md#failure-not-empty-success));
  the by-id read fails distinguishably from not-found.
- **Legacy-shape rows**: write what an old release would have written and
  assert current code's tolerance for it — the read-side complement of
  migration testing.

## What the suite asserts

Beyond happy-path round-trips, the assertions that earn their keep, in
rough order of defect yield:

- **Round-trip fidelity**: write a record with every field at a
  non-default value, read it back, compare whole records. This one test
  catches most mapping drift (the field added to the type but not the
  select list) forever.
- **Absence and emptiness semantics**: not-found returns the not-found
  shape; empty lists are empty, not errors; the corrupt-row contract above.
- **Predicate truth at the boundaries**: filters at their edge values,
  ordering with duplicate sort keys (does the tiebreaker hold?), limits at
  exactly the boundary. These are the store answering, not your code — the
  entire reason the real engine is in the loop.
- **Constraint behavior**: uniqueness violations, foreign-key enforcement,
  cascade behavior — asserted as *outcomes the layer translates*, since
  callers will branch on them.
- **Query-count ceilings** for set-shaped operations (the N+1 gate — see
  batching-and-n-plus-one).
- **Concurrency smoke where the engine model allows it**: two writers
  interleaving on a read-modify-write path; even one such test documents
  the intended isolation behavior.

## What not to test

Do not test the engine itself — that its `WHERE` filters or its indexes
index. The suite's subject is *your statements, your mappings, your
contracts* as interpreted by the real engine; the line is "would this
assertion fail if my code were wrong?" — if only the engine could fail it,
it is not your test. And resist snapshot-asserting generated query text:
text-equality tests certify spelling, not meaning, and break on every
harmless reformat while missing the wrong-rows defects that only execution
catches. The statement's *behavior against data* is the contract; assert
that.
