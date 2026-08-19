---
layer: technique
subject: settings
technique: key-registry
status: forged
laws: [one-authority-per-vocabulary, one-validation-door, creation-names-reaper]
shared_with: []
---

# Key registry

The key space of a settings store is a closed vocabulary, and like every
closed vocabulary it needs exactly one authoritative definition
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
A store that accepts any string as a key has delegated its vocabulary to the
union of every call site ever written — including the misspelled ones, the
renamed ones, and the deleted ones. Nothing in a key-value store errors on an
unknown key; that is the store's defining convenience and its defining trap.
The registry converts "we spell keys carefully" (a discipline, guaranteed to
decay) into "an unregistered key cannot enter the store" (a structure).

## Both ends of the pipe

One layer of protection is not enough, because each layer covers the other's
blind spot:

- **Caller-side constants.** Every key is a named constant in one shared
  module; call sites reference the constant, never a literal. A typo becomes
  an unknown-identifier error at build time instead of a silent default at
  runtime. Grouping the constants by feature gives the space a browsable
  table of contents — the registry doubles as documentation of everything
  configurable.
- **Store-side allowlist.** The write path — inside the store, behind
  whatever boundary callers cross — checks the key against the registered
  set and **rejects** unregistered writes, loudly. Constants cannot protect
  against the caller that builds a key by string concatenation, the second
  client that never imported the constants module, or the migration script
  written at 2 a.m. The allowlist is the one validation door all writers
  pass through ([one-validation-door](../../_laws.md#one-validation-door));
  the constants are ergonomics in front of it.

The two lists must not be two vocabularies. Either one side is generated from
the other, or a test asserts they are identical sets; two hand-maintained
copies drift exactly when someone adds a key and finds only one of them — and
the drift has a signature failure shape worth knowing on sight: a key that can
be *read* everywhere (reads are lenient) but whose *write* is rejected, so the
feature's toggle can never actually be enabled. That is not a hypothetical;
it is the routine first symptom of registering the constant and forgetting
the allowlist.

## Namespacing

Flat key spaces stop scaling around a few dozen keys. Prefix keys by feature
area (`notifications.sound_enabled`, `scheduler.max_concurrent`) with one
separator convention, chosen once. The namespace earns its keep three ways:
bulk reads can load a prefix, audit records can categorize by prefix, and
ownership is legible — the prefix names the team or module whose default and
validation rules apply.

Per-entity configuration (`auto_retry:<entity-id>`) tempts the design toward
free-form keys, because the entity ids are open-ended. The undisciplined form
— any key with an id embedded in it — is a table row wearing a key costume,
and it dissolves the closed vocabulary everything else here depends on. There
is a disciplined middle: a **governed prefix family**, where the *prefix* is
registered like any exact key and the registry validates the suffix's syntax
(non-empty, restricted character set) so downstream consumers can safely
strip the prefix and trust the remainder as an entity id. The family as a
whole then carries one validation contract, one audit category, and one
reaping rule — the closed-vocabulary properties survive at the family level.
If a candidate key fits neither an exact entry nor a governed family, that is
the signal it belongs in the owning entity's own storage instead.

## Renames are migrations

A key's stored value is user data filed under the key's name. Rename the key
without moving the data and every user's choice silently reverts to the
default — no error, no log line, just a preference that stopped sticking. So
a rename ships in three parts: register the new key, migrate stored values
from old to new (one-shot, at upgrade), retire the old key. The middle step
is the one that gets skipped, because skipping it produces no visible
failure. Treat a key rename with exactly the seriousness of a column rename,
because that is what it is.

## Orphan detection and reaping

Keys die when features die, but their rows do not — deletion of the reading
code deletes the only thing that ever noticed the row. The registry makes the
graveyard enumerable: **stored keys minus registered keys = orphans**, a set
difference any periodic check can compute. Run it both directions while
you're there — registered keys that no code reads anymore are candidates for
retirement too, and only the registry makes that question askable.

Every key therefore names its reaper at registration
([creation-names-reaper](../../_laws.md#creation-names-reaper)), and
retirement is usefully a two-stage affair. First **quarantine**: the key
stays registered — existing rows and stray external writers remain harmless
— but a write to it emits a deprecation breadcrumb naming what superseded
it, so a stale UI toggle or forgotten automation surfaces in observability
instead of silently persisting an inert row. Then the **reap**: delete the
registry entry *and* the stored rows, as an idempotent cleanup that can run
twice without error. Skipping quarantine and jumping straight to rejection
turns every laggard writer into a hard failure at the worst time; skipping
the reap leaves the quarantine as the permanent state and the registry as a
museum. A settings store that only ever
grows is not preserving history — the audit trail does that — it is
accumulating rows that no one can safely delete because no one can prove
what still reads them. The registry is that proof.
