---
layer: technique
subject: sql-console
technique: safe-mode-guarding
status: forged
laws: [gate-sees-target, failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# Safe-mode guarding

Safe mode is the console's promise that a session marked read-only cannot
mutate the user's database. The promise is only as good as two things: **where
the guard stands** and **what the detector can see through**. Most broken safe
modes fail on one of exactly those two.

## The two-sided architecture

There are two guards, with different jobs and different authority:

- **The client mirror** exists for latency. As the user types, the console
  classifies the statement and reflects the verdict instantly — the run
  affordance relabels ("blocked in safe mode"), the reason is visible before
  any round trip. This guard is *advisory by design*: it runs in an
  environment the user controls, so nothing may depend on it.
- **The authoritative guard** stands on the trusted side, immediately in
  front of the execution call, and classifies **the exact string that will be
  sent to the engine** ([gate-sees-target](../../_laws.md#gate-sees-target)).
  Not the string the client claims it validated, not a normalized copy made
  earlier in the pipeline — the argument of the execute call itself. Every
  path that can reach execution (the editor, saved queries, the NL lane,
  automations, any future programmatic surface) passes through it, because it
  is placed where the paths converge, not where they originate.

The mirror duplicates the authority's predicate, and duplicated predicates
drift ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
names why). The drift is survivable **only** because the sides fail
differently by construction: a client that under-detects lets the user click
run and receive the server's refusal — a UX papercut; a client that
over-detects blocks a legitimate read — an annoyance with an override path
(the server re-judges). Neither direction is a security hole, because the
client was never the gate. Keep it that way deliberately: any "optimization"
that lets a client-cleared statement skip the server-side check converts
every future mirror bug into a breach. Where the two implementations can
share a spelled-out keyword vocabulary (a generated list, a shared fixture
corpus asserting both sides agree), share it.

## Detection that survives obfuscation

A detector that inspects the first keyword is theater. The realistic inputs
it must classify correctly:

```sql
WITH doomed AS (DELETE FROM orders RETURNING *) SELECT count(*) FROM doomed;
SELECT 1; DROP TABLE audit_log;               -- batch, mutation second
SELECT * FROM t WHERE note = 'DELETE FROM t'; -- keyword inside a literal
/* UPDATE nothing */ SELECT 1;                -- keyword inside a comment
```

The discipline, in order:

1. **Strip before scanning.** Remove string literals, quoted identifiers, and
   comments (line and block, including the engine family's exotic literal
   forms — dollar-quoting, escape-string prefixes — per the dialect
   declaration) *before* any keyword matching. Literal stripping is what
   makes the third and fourth examples reads; skipping it produces false
   positives that train users to distrust — and then disable — safe mode.
2. **In safe mode, a request is one statement — refuse batches.** After
   stripping, a remaining statement separator means "more than one
   statement", and the authoritative guard rejects the request with that
   reason. This is simpler and stronger than judging every member of a
   batch: it needs no statement splitter (which is itself dialect-shaped and
   easy to fool), and it closes the case where a pass-through connector
   forwards the whole payload verbatim to an engine that honors stacked
   statements. Write mode — where the user has consented to a mutation —
   may permit batches; safe mode never. The second example is refused
   before its first statement is even classified.
3. **Scan the whole statement.** Mutation keywords are matched anywhere in
   the stripped text, which is precisely what catches mutations hidden in
   common-table-expression bodies. A statement-shape parser that only
   classifies the outermost verb re-opens the first example.
4. **Classify by an explicit vocabulary, and classify session-state
   statements as their own class.** The mutation set is a named, closed
   list — data mutations, schema changes, permission changes,
   transaction-control statements that could commit prior work — not an
   ad-hoc regex per call site. The vocabulary has one home and both guard
   sides derive from it. And note the trap in the *read* list: engines have
   statements that mutate nothing in the user's tables yet change
   connection or engine state (pragma-style settings, session variables,
   journal modes). A read list that admits them lets a "read" alter a
   pooled connection that the next caller inherits. Treat them as a third
   class — permitted only where the connection is not shared, or not at
   all in safe mode.
5. **Fail closed.** A statement the classifier cannot confidently parse is
   treated as a mutation. Unknown constructs, engine-specific verbs the
   vocabulary has never seen, an unterminated literal that makes stripping
   ambiguous — all blocked, with the refusal saying *why*
   ([failure-not-empty-success](../../_laws.md#failure-not-empty-success):
   "blocked as unclassifiable" is a different message from "blocked as a
   mutation", and both are different from an empty result).

What this deliberately is **not**: a full SQL parser. Token-level scanning
over stripped text over-blocks a few legal exotic reads and never
under-blocks — the correct trade for a guard. The engine's own permission
system remains the last line; a console offered a read-only credential
should prefer it, and safe mode then becomes defense in depth rather than
the sole barrier.

## The executor demands a classified statement

Placement is the half of the guard that survives new authors. Every SQL
author in the application converges on **one executor**, and the guard sits
inside it — but "converges" is a hope unless the executor's contract
enforces it. An executor that accepts a raw string is a door anyone can
open: the next feature (a model-driven lane, an automation, a debug helper)
calls it — or, worse, calls the engine driver directly — with its own
shorter check, and the classifier becomes optional by construction. The
structural fix is a **type**: the execute call accepts only a
*classified statement* value that can be minted solely by the guard, so an
unclassified string cannot reach execution without a compile error. That is
what turns "every door is guarded" from a review discipline into a property.

## Mode semantics and the consent gate

- **Default on.** Per connection, not per statement — the toggle is a mode
  the user consciously leaves, visible in the console chrome the entire time
  it is off. A default-off safe mode protects only the users who least need
  it.
- **The client mirror decides whether to *ask*; the authority decides
  whether to *run*.** The mature shape of the client side is a consent gate:
  in safe mode a statement the mirror classifies as a mutation is *held*,
  the full statement is shown, and the user either confirms — the request
  then travels with an explicit "mutation permitted" flag the authority
  honors — or cancels. Turning safe mode off removes the asking, not the
  authority's classification. Two rules make the gate honest:
  - **The consent shows the whole statement.** A confirmation that
    truncates the text it is asking about is consent to a prefix; the tail
    is exactly where a stacked or hidden mutation lives. Scroll, never
    slice.
  - **A pending consent is bound to its target.** The held statement is
    pinned to the connection (and query context) it was submitted against;
    if that context changes before the user confirms — a switched
    connection, a different tab — the pending consent is voided, not
    carried over. Confirming a destructive statement against a database
    that silently changed underneath is the gate seeing the wrong target
    ([gate-sees-target](../../_laws.md#gate-sees-target)).
- **Confirmation friction scales with irreversibility.** Schema-destroying
  statements warrant a harder confirm than a row update; the class the
  guard computed is the input to that decision.
- **The refusal is a first-class result.** A blocked statement renders in
  the result area with the classification and the escape hatch (how to run
  it deliberately), not as a toast that evaporates. The user was told no;
  they must also be told what was refused and how to proceed on purpose.
