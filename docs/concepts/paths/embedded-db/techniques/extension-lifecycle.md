---
layer: technique
subject: embedded-db
technique: extension-lifecycle
status: forged
laws: [failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# Extension lifecycle

Embedded engines are extended in-process: loadable modules that add virtual
tables or vector indexes, registered scalar and aggregate functions, custom
collations, hooks. Each one is a capability the schema and the queries then
*depend on* — a table definition that names a module, a query that calls a
registered function — while existing only as an in-memory registration that
must be re-established every run, on every connection. That asymmetry (the
dependency is persistent, the capability is per-boot) is the entire hazard
class this technique manages.

## Register strictly before the pool exists

The pool manufactures connections lazily — later, on demand, on whatever
thread first needs one. Any capability that must exist on *every*
connection therefore has exactly one safe installation point: **before the
pool is constructed**, via the engine's process-level auto-registration
hook or the pool's connection factory. Registration sequenced "at startup,
near the pool" is a race; it wins in development, where the first
connection is opened by the same thread that just registered, and loses in
the field, where a background job hits the pool first. The failure mode is
maximally confusing: some connections have the capability and some do not,
so the same query succeeds or fails depending on which pooled connection
serves it — a heisenbug wearing a syntax error's message.

The ordering must be **structural, not conventional**: the function that
builds the pool takes the completed registration as a prerequisite (an
argument, a token, a builder stage), so the compiler or the constructor
order proves the sequence, and the next refactor cannot silently invert it.
A comment saying "call register() first" is the conventional form, and
conventions lose to refactors.

## One registration door

All registration flows through one function per store — one place that
lists every module, function, and collation the application installs. Two
call sites each registering "their" extensions is
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
violated for capabilities: the capability set becomes the union of what N
sites happened to run, differs by entry path (main app vs. test harness vs.
migration runner vs. command-line tool opening the same store), and the
divergence surfaces as "works in the app, fails in the test" — or the
reverse. The single door also gives the second database (see the golden
path's inventory obligation) a fighting chance: a new store calls the same
door, or its absence from the door is visible in review.

## Load failure is a boot decision, not a runtime surprise

Extension loading can fail — missing binary, version mismatch, platform
without the module. The policy must be decided per extension, at boot,
loudly ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):

- **Load-bearing extensions** (the schema names their module; core flows
  query them): failure to load is failure to boot, with an error naming the
  extension and the consequence. Limping into a session where the main
  store cannot open its own tables is strictly worse than not starting.
- **Feature-scoped extensions** (an optional capability, ideally
  compile-time or configuration gated): failure marks the feature absent
  through one flag the feature's surfaces consult. The mark must be a real
  signal, not an error swallowed into a log — a feature that silently
  half-exists (its UI present, its queries failing) is the empty-success
  spelling of this failure.

What is never acceptable is *deferring* the discovery: the first query
against a missing capability, mid-session, on the user's data, is the worst
place to learn a boot-time fact.

## Schema entanglement: the extension is part of the store's contract

Once a table definition names an extension's module, the store **cannot be
opened correctly without it** — by anyone. Migration runners, integrity
checkers, backup verifiers, support tooling, the quiet-window maintenance
pass: every one of them opens the store, so every one inherits the
registration prerequisite, which is one more reason the single door exists.
Version skew is part of the same contract: an index or table written by
extension version N may not be readable by N−1, so the extension's version
belongs in the store's own metadata alongside the schema version, checked at
boot the same way — the schema-version discipline is
[migrations](../../migrations/migrations.md)' ground; the extension version
rides the same rails. And because the capability can vanish (a platform
without the module), the data that only the extension can read should be
**derived, rebuildable data** wherever possible — an index over source
records that survive in plain tables — so losing the extension degrades to
re-derivation ([data-access](../../data-access/data-access.md) owns keeping
that split clean in the query layer) rather than data loss.
