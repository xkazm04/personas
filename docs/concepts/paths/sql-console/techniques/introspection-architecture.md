---
layer: technique
subject: sql-console
technique: introspection-architecture
status: forged
laws: [one-validation-door, count-carries-predicate, derivation-names-recomputation]
shared_with: []
---

# Introspection architecture

The schema browser answers structural questions — what namespaces exist,
what tables, which columns with which types, what indexes and constraints,
roughly how many rows — and every one of those answers is produced by
running SQL against the connected engine's catalog. That makes introspection
the console surface **most tempted into string-built SQL**, because the
"parameters" are identifiers: table names, schema names, things placeholders
famously cannot bind into identifier position. The architecture exists to
remove the temptation structurally.

## One door, trusted side, parameterized

The rule: **all introspection SQL is composed on the trusted side, in one
implementation, and user-influenced names travel only as bound values.**

The move that makes this possible: introspection queries interrogate the
*catalog* — the standard catalog schema where the family provides it, the
engine-specific catalog tables where it does not — and in catalog queries,
the table name the user clicked is **data**, not an identifier:

```sql
-- The clicked name binds as a value into a catalog lookup:
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = ? AND table_name = ?
ORDER BY ordinal_position;
```

No identifier interpolation, therefore no quoting/escaping problem,
therefore no injection surface — not mitigated, absent. The catalog query
shapes differ per connector family; the dialect declaration names which
catalog strategy each family uses, and the single introspection module holds
the per-family query text.

The client's role shrinks to **requesting introspection by name**: "columns
of this table on this connection". It sends identifiers as opaque strings
and receives structured results. It never assembles SQL.

Belt and braces on the trusted side is cheap and worth wearing: before the
name is bound, reduce it to the identifier character class (letters, digits,
underscore) — not because binding needs the help, but because some
connector families' catalog access is an API call rather than a SQL query,
and the reduced name is what travels into a URL or a path segment there.
One sanitizer, applied once at the door, covers every family's transport.

## The corollary with teeth: delete the second door

[one-validation-door](../../_laws.md#one-validation-door) is usually read as
"add a door". Here it reads as **"remove the others"**. A client-side helper
that builds introspection SQL — even a well-escaped one, even one used only
for a preview — is a second implementation with its own quoting bugs and its
own drift schedule, and its existence licenses the next feature to build SQL
client-side too, because precedent is the strongest architecture document.
The correct handling of such helpers when found is deletion, with the
trusted-side door absorbing their call sites. An escaping utility that
survives "just in case" *is* the vulnerability's seed: the enumerable-writers
property holds only while the set of SQL-composing sites stays enumerable.

The same door serves every schema consumer — the browser tree, the editor's
completion index, the NL lane's schema context. One source means the
completion list and the browser can never disagree about what exists.

The line that separates a legitimate client helper from a second door is
**executed versus emitted**. A helper that composes `SELECT * FROM "name"
LIMIT 100` *for the clipboard* — text handed to the user, who reads it and
decides — is a convenience, and quoting the identifier there is courtesy
(the unquoted form breaks on hyphenated names), not defense. The moment such
a helper's output is fed to the executor without passing through the user's
hands, it has become a door and belongs on the trusted side.

## Progressive disclosure and the cache

Full-schema introspection on connect is a trap: large schemas make
connection feel broken, and most of the fetched detail is never viewed.
Structure the fetch as the user descends:

- **On connect:** namespaces and table names — enough to draw the tree.
- **On expansion/selection:** that table's columns, indexes, constraints.
- **On demand:** expensive detail — row counts, sample rows, stored
  definitions.

Everything fetched is a **snapshot of foreign state that mutates outside the
application's sight** — another client can add a column at any moment. So
the cache is honest about being a cache
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)):
every cached level has a visible, user-invokable refresh that re-runs the
same introspection door, and schema-shaped errors from user queries (column
does not exist, table does not exist) are treated as staleness signals — the
prompt to refresh, or the trigger for an automatic one. A browser with no
refresh affordance is asserting the foreign schema is immutable, which is
false by definition.

## Honest row counts

Exact `count(*)` on a large table is a full scan; a browser that runs it per
table row turns the tree into a denial-of-service against the user's own
database. The choices, made explicitly per family:

- engine estimates (statistics tables, planner metadata) — cheap, labeled as
  estimates;
- exact counts on demand — a user action, never a side effect of drawing
  the tree;
- bounded counts ("more than N") where the family supports limited scans.

Whichever is shown, the number carries its predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)):
"~1.2M (estimate)" and "1,204,551 (counted now)" are different claims, and a
browser that renders both identically will have its estimates quoted as
facts.

## Read-only by construction

Introspection is the one console lane with no legitimate mutation, ever. It
should therefore not merely *pass* the safe-mode guard — it should be
incapable of expressing a mutation: fixed query texts selected by request
kind, parameters bound as values, no free-text lane in the door's contract.
The guard still stands in front of it (defense in depth is cheap here), but
the door's own shape is the real guarantee.
