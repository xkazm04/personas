---
layer: technique
subject: sql-console
technique: dialect-capability-declaration
status: forged
laws: [one-authority-per-vocabulary, failure-not-empty-success]
shared_with: []
---

# Dialect capability declaration

SQL is a family of languages wearing one name. Engines differ in placeholder
syntax, identifier quoting, literal forms, statement inventory, catalog
shape, limit/offset spelling, transaction semantics, and which
meta-operations (explain plans, session settings) exist at all. A console
that supports more than one engine must decide *where those differences
live*, and the decision compounds with every engine added.

## The anti-pattern: discovered dialect

The default failure is dialect knowledge as **scattered conditionals** —
an engine check in the completion code, another in the guard, another in
the browser, each added when a bug surfaced. Symptoms:

- adding an engine means auditing every conditional in the console;
- two surfaces disagree about the same engine (the browser offers an
  operation the executor rejects);
- capability facts exist only as code, so nothing can render "what this
  connection supports" to the user.

This is a closed vocabulary maintained in N copies —
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
names the failure precisely: the copies drift the day someone adds engine
N+1 and finds only some of them.

## The pattern: one declaration per connector family

Group engines into **connector families** — clusters that share wire
behavior and catalog shape — and give each family a single authoritative
declaration that the entire console derives from. The declaration answers,
at minimum:

- **Language surface:** placeholder style, quoting characters, comment and
  literal forms (the safe-mode stripper reads this), statement separators,
  the highlighting profile.
- **Catalog strategy:** standard catalog schema or engine-specific tables;
  which introspection requests the door can serve; how row counts are
  estimated.
- **Feature inventory:** which statement classes exist (some families have
  no schemas, some no procedural objects), whether explain-plan is
  available, what pagination spelling the console should append when it
  bounds a query.
- **Operational notes for the human:** the capability notes rendered in the
  connection UI — what this engine supports, what the console therefore
  offers or hides. Capability facts are user-facing product content, not
  just plumbing.

Every consumer — editor, guard, browser, executor, NL lane's prompt
context — reads the declaration. Adding an engine becomes *writing a
declaration and the family's catalog queries*; no consumer changes.

Two placement rules keep the declaration honest:

- **The capability class lives next to the execute dispatch.** The function
  that says "this family supports full SQL / a select-subset / key-value
  commands / browsing only" sits in the same module as the code that
  actually routes a statement to a family's driver, so the advertised
  capability and the real behavior are edited together and reviewed
  together. A capability table maintained far from the dispatch is a
  second vocabulary with a delay fuse.
- **The client asks the trusted side what a connection can do.** The
  capability note the user sees is *fetched* from the declaration, not
  re-derived from a client-side family map. A client that keeps its own
  family classification for cosmetic decisions (which highlighter to load)
  is fine — as long as anything that promises behavior comes from the one
  authority.

Where the guard's read vocabulary is family-specific — a keyword that is a
harmless read in one engine and nonexistent or state-changing in another —
the declaration carries a per-family read list, and the guard consults it,
rather than one union list that is wrong somewhere for every family.

## Declare, don't sniff (mostly)

Prefer **declared** capability (the family says what it supports) over
**probed** capability (try it and see), because probing against a foreign
production database is a side effect, and because probe results are
connection-state that must be cached, invalidated, and explained. The
disciplined exceptions:

- **version-gated features** within a family, where the version arrives in
  the connection handshake — record it once at connect, derive from it;
- **graceful degradation** where a declared capability fails anyway
  (a locked-down managed instance denying catalog access): the console
  degrades the *surface* — hides the panel, explains why — rather than
  presenting an error as an empty schema
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success):
  "no tables" and "not permitted to list tables" must render differently).

## Unknown means absent, not assumed

The declaration is a closed vocabulary of families, and a connection that
matches no family gets the **minimal profile** — generic highlighting,
fail-closed guarding, no catalog promises — not the profile of the family it
most resembles. Guessing a dialect produces the worst failure class in this
subject: a console confidently offering operations that mangle or refuse on
the real engine, teaching the user the tool cannot be trusted. "This engine
family is not fully supported; here is what works" is a perfectly good
capability note.

## The declaration is testable

Because capability is data, it can be asserted: a fixture per family can
drive the guard's stripper with that family's literal forms, the paginator
with its limit spelling, the completion profile with its keyword set. The
scattered-conditional design has no equivalent — you cannot enumerate the
copies to test them. This is the quiet payoff of the pattern: the dialect
layer becomes the part of the console with the *best* test story instead of
the worst.
