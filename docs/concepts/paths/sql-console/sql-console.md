---
layer: golden-path
subject: sql-console
status: forged
techniques:
  - safe-mode-guarding
  - introspection-architecture
  - dialect-capability-declaration
  - editor-ergonomics
  - result-fidelity
  - nl-assist-gating
evidence:
  - src/features/vault/sub_databases/safeModeUtils.ts                 # client mirror: literal-stripped CTE scan, fail-closed on unclosed comment
  - src-tauri/src/engine/db_query.rs                                  # authoritative guard (is_mutation :383, guard :518, one-statement-in-safe-mode :535), LIMIT n+1 bounding, capability enum :621, parameterized introspection :696-835
  - src/features/vault/sub_databases/hooks/useQuerySafeMode.ts        # default-on safe mode + consent gate bound to its target connection
  - src/features/vault/sub_databases/introspectionQueries.ts          # frontend SQL builders deleted; connector-family classification remains
  - src-tauri/src/commands/credentials/db_schema.rs                   # the one execute door + introspection commands + cancel registry
  - src/hooks/database/useTableIntrospection.ts                       # module-scoped schema cache with explicit refresh, single consumer of the door
  - src/features/vault/sub_databases/tabs/ChatTab.tsx                 # NL lane: same useQuerySafeMode, same executeDbQuery, editable SQL shown before run
  - src-tauri/src/commands/credentials/nl_query.rs                    # NL schema context built from the same introspect_tables/introspect_columns door
  - src/features/vault/sub_databases/QueryResultTable.tsx             # NULL styled distinctly, settled-empty vs error, truncation notice, virtualized
  - src/features/vault/sub_databases/tabs/ConnectorCapabilityNote.tsx # capability note rendered from the backend declaration
counter_evidence:
  - src-tauri/src/companion/jobs/connector_use.rs   # a second execute door for a model author: starts_with over 7 verbs incl. drop, bypasses the classifier (:1443-1469)
deviations:
  - w12-sql-console   # anchor in docs/concepts/golden-path-deferred-fixes.md (to be registered by the wave-12 closer; findings enumerated in the composer report)
---

# SQL console & schema browser

When an application manages connections to external databases — the **user's
data, living in an engine the application neither owns nor backs up** — it
owes the user a first-class window in: a place to browse the schema, ask
questions in SQL, and read honest answers. The alternative is worse than a
missing feature: users who cannot explore their data inside the app copy the
connection credential into whatever client is nearest, and at that moment the
application loses both the credential's custody and any ability to guard what
runs against the data. A console is therefore a *containment* feature. Its
existence keeps the secret in the vault and the queries under the
application's guard; its quality decides whether users actually stay inside
it.

That framing defines the subject's unusual risk profile. Almost everything
else an application does runs against state the application controls —
schemas it migrated, data it can restore, invariants it enforced on the way
in. The console executes **user-typed strings against foreign state**: a
schema discovered at runtime, data with an unknown backup posture, an engine
whose version and quirks arrive with the connection. Every design decision
below follows from refusing to pretend otherwise.

## Where this subject ends

- The application's **own** persistence layer — repositories, migrations,
  typed queries over a schema the application controls — is
  [data-access](../data-access/data-access.md). The two look superficially
  alike (both emit SQL) and share almost nothing: data-access compiles
  developer intent against a known schema at build time; the console executes
  user intent against an unknown schema at run time. Conflating them is how
  string-built SQL leaks into the product.
- **Connection secrets** belong to the
  [credential-vault](../credential-vault/credential-vault.md). The console
  names a connection; the execution service resolves the credential behind
  the vault's one outbound door
  ([brokered-egress](../credential-vault/techniques/brokered-egress.md)). The
  console never holds a plaintext credential, so it can never log one.
- **Result-grid mechanics** — column model, pagination surfaces, body state
  model — are owned by [table](../table/table.md). The console's obligation
  is what it feeds the grid ([result-fidelity](techniques/result-fidelity.md)),
  not how the grid scrolls.
- The NL-assist lane's **extraction machinery** — getting well-formed SQL out
  of a model's prose — is
  [structured-output](../structured-output/structured-output.md)'s subject.
  This subject owns what happens to the SQL *after* extraction: it enters the
  same gates as typed SQL, without privilege.

## Safe mode is a two-sided guard

The console's cardinal safety feature is a read-only mode, default **on**,
that refuses mutating statements. Two properties separate a real safe mode
from theater:

1. **It is two-sided.** The client detects mutations for *instant feedback* —
   the run affordance changes, the user learns before the round trip — but
   the client's verdict is advisory. The authoritative guard lives on the
   trusted side, in front of the actual execution call, where it sees exactly
   the string that will run ([gate-sees-target](../_laws.md#gate-sees-target)).
   A client-only guard is bypassed by every path that is not the client:
   automations, the NL lane, a future API. A server-only guard is honest but
   hostile — every mistake costs a round trip to learn.
2. **It survives obfuscation.** A detector that reads the first keyword calls
   `WITH doomed AS (DELETE FROM orders RETURNING *) SELECT * FROM doomed` a
   read. The detection discipline — strip literals and comments first, refuse
   batches outright in safe mode (one request is one statement), treat
   common-table-expression bodies as first-class statements, fail closed on
   anything unparseable — is the
   [safe-mode-guarding](techniques/safe-mode-guarding.md) technique.

Default-on matters more than the toggle. The user who flips safe mode off has
formed intent; the user who never noticed a default-off toggle has formed
nothing, and the console mutated their production data on their behalf.

The guard's *placement* is what makes it a guard. Every author of SQL in the
application — the human at the editor, the model in the chat lane, a
background job, a debug assistant — must reach the engine through **one
executor**, and the guard stands inside it. The measured failure in this
subject is not a weak classifier; it is a **second executor**, written later
for a different author, with a shorter check, that never met the first. An
executor whose contract accepts a raw string invites that: any new door is
one function away and the classifier is optional at it. Making "this
statement has been classified" a *type* the executor demands turns the next
unguarded door into a compile error rather than an audit finding.

## Introspection is the one injection-proof door

The schema browser — namespaces, tables, columns, indexes, row counts — is
built entirely from **parameterized queries against the engine's catalog,
composed on the trusted side, as the single implementation**
([one-validation-door](../_laws.md#one-validation-door)). Table and schema
names travel as bound *values* into catalog lookups; they are never
interpolated into SQL as identifiers. This is the one architecture under
which the schema browser cannot become an injection surface, because the
untrusted input never touches the query text.

The structural corollary is the important one: when introspection needs exist
on the client, the client **requests introspection by name** — "columns of
this table on this connection" — and the trusted side owns the SQL. Any
client-side SQL-building helper for introspection is a second door, and
second doors are where the discipline dies; the correct move is to delete
them, not to harden them. The full catalog strategy — standard catalog schema
versus engine-specific catalogs, lazy loading, cache invalidation, honest row
counts — is [introspection-architecture](techniques/introspection-architecture.md).

## Dialect is declared capability

Engines differ: placeholder syntax, quoting rules, catalog shape, which
statements exist, whether the engine can even be asked for an execution plan.
A console that discovers these differences as scattered conditionals decays
with every engine added. The alternative is a **declared capability model**:
each connector family carries one authoritative declaration
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)) of
what the engine supports, and every console surface — which browser tabs
appear, which snippets are offered, how statements are guarded, what the
editor highlights — derives from that declaration. Adding an engine becomes
adding a declaration. The design of that declaration is
[dialect-capability-declaration](techniques/dialect-capability-declaration.md).

## The editor earns trust

Ergonomics is not polish on this subject — it is the mechanism by which the
containment argument holds. Users compare the console to the best external
client they know, and every missing convenience (highlighting, schema-aware
completion, history, saved queries, run-selection) is a reason to export the
credential to a tool that has it. **A console people avoid is a security
regression**, whatever its guards. The editor's obligations are
[editor-ergonomics](techniques/editor-ergonomics.md).

## Results are honest

The console is often the user's *only* lens on this data, so the grid must
not editorialize: `NULL` rendered distinctly from empty string and from the
literal text "NULL"; numbers that exceed the display tier's safe precision
transported without silent rounding; a truncated result saying it was
truncated and at what bound
([count-carries-predicate](../_laws.md#count-carries-predicate)); engine
errors relayed verbatim, because the engine's message is the diagnostic and a
paraphrase destroys it; a statement that returns no rows distinguished from a
statement that failed
([failure-not-empty-success](../_laws.md#failure-not-empty-success)). The
contract is [result-fidelity](techniques/result-fidelity.md).

## The NL lane passes the same gates

A chat lane that turns natural language into SQL is a second *author*, not a
second *path*. The model reads schema context from the same introspection
cache, its output is shown as editable SQL — never executed sight unseen —
and the statement enters through the same safe mode and the same execution
door as a typed one. The moment generated SQL gets a privileged path (auto-
execution, a separate service call that skips the guard), the two-sided guard
has a third side nobody audits. The gating rules are
[nl-assist-gating](techniques/nl-assist-gating.md).

## The techniques

- [safe-mode-guarding](techniques/safe-mode-guarding.md) — the two-sided
  mutation guard: client mirror for feedback, trusted-side authority,
  obfuscation-resistant detection, fail-closed posture.
- [introspection-architecture](techniques/introspection-architecture.md) —
  schema browsing through one parameterized door: catalog strategy, lazy
  loading, cache honesty, and why client-side SQL builders get deleted.
- [dialect-capability-declaration](techniques/dialect-capability-declaration.md)
  — connector families as one authoritative capability vocabulary the whole
  console derives from.
- [editor-ergonomics](techniques/editor-ergonomics.md) — highlighting,
  completion, history, saved queries: the retention features that make the
  guards reachable.
- [result-fidelity](techniques/result-fidelity.md) — what the console owes
  the grid: type truth, `NULL` honesty, truncation with its predicate,
  verbatim errors.
- [nl-assist-gating](techniques/nl-assist-gating.md) — the LLM lane as an
  ungated author: same schema source, same guard, same door, visible
  provenance.
