---
layer: technique
subject: client-state
technique: persistence-and-migration
status: forged
laws: [derivation-names-recomputation, failure-not-empty-success, one-validation-door]
shared_with: []
---

# Persistence and migration

State that outlives the process is a message to a future version of the
application — one running code that does not exist yet. Everything in this
technique follows from taking that sentence literally: the persisted shape
is a **contract between versions**, and contracts are versioned, migrated,
and validated at the boundary, or they are time bombs that detonate only on
upgraded installations — never on the fresh profile where development and
testing happen.

## Who is the authority

Before deciding *whether* a value persists, decide *where its durable truth
lives* — because most clients have more than one storage tier, and the
tiers fail differently. Browser-profile-style local storage is synchronous
and available before anything else, but it is scoped to a profile that can
be cleared silently and completely, indistinguishable from a first run.
An application-owned datastore (local database, backend account) is
durable and authoritative but a round-trip away. The rule that falls out:

- **Anything whose loss would genuinely be felt** — user-authored content,
  rosters, configurations built up over time — belongs in the durable
  authority, with local storage at most a cache or degraded fallback.
  Products relearn this by losing user data; the lesson is always the same.
- **Values needed before first paint** (theme, language, initial route) are
  the one earned exception: local storage stays the *read* authority
  because it is synchronous, and the durable tier holds a mirror whose job
  is to rehydrate a cleared profile. A mirror needs echo suppression —
  the hydration write-back must not trigger the write-through that would
  loop it.
- **A migration between storage locations keeps the source until the
  destination write is confirmed.** Read legacy, write new, and only then
  remove the legacy copy; on failure, leave the legacy key so the next
  launch retries. A migration that deletes its source optimistically
  converts a transient write failure into permanent loss.

## What earns persistence

Persistence is earned, not defaulted. The audit question per field: *what
breaks if this is gone at next launch, and what breaks if it is stale?*

- **Earns it:** durable user intent — preferences, layout and panel
  geometry, drafts of unsaved work, dismissed-forever flags, the last
  active workspace. Losing these costs the user work or re-orientation;
  staleness is almost meaningless for them because the user is their only
  writer.
- **Does not earn it — server state:** the authority is a refetch away. A
  persisted copy is a second cache with independent staleness that will be
  *rendered as truth* at next launch before any refetch lands. Where
  restart-warmth genuinely matters, persist explicitly as a
  stamped-as-stale snapshot that rendering may use but nothing may trust —
  and let the invalidation layer treat it as expired on arrival.
- **Does not earn it — derived state:** persisting a computation lets it
  outlive its inputs; recompute instead, and if recomputation is costly the
  stored form names its recomputation path
  ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
- **Never:** secrets in general-purpose storage. Credentials, tokens, and
  keys go through the platform's protected storage or an encrypting layer
  with its own custody rules — general state persistence is readable at
  rest by anything that can read the profile.
- **Transient status never persists.** A status machine's in-flight states
  are meaningless in a process that no longer runs the flight. Rehydrating
  `loading` produces a surface waiting for a response that no one will
  send; persist-time serialization maps in-flight states back to a
  restartable state (idle, or stale-with-data).

Whole-store persistence fails this audit by construction. Persist an
explicit **allowlist** of fields — a denylist rots as fields are added,
and each addition silently joins the contract.

## The versioned shape

Every persisted payload carries a **schema version** written alongside the
data — *inside* the payload, under a stable storage key. Versioning the key
instead ("my-data-v2") orphans every existing row on each bump: the old data
sits unreachable under the old key, which reads as data loss to the user
and accumulates as junk in storage. The key is the address; the version is
the shape; they evolve independently.

On load, the version routes the payload through a **migration chain**:
an ordered sequence of steps, each transforming shape N into shape N+1,
composed until the payload is current. Rules that keep the chain sound:

- **Migrations are append-only history.** A migration, once shipped, is
  frozen — it describes a shape that exists in the field, and editing it
  breaks the installations still holding that shape. New changes append new
  steps.
- **Each step is total over its input version.** It handles every payload
  its version could have produced, including ones written by buggy
  releases of that version. Defensive defaults inside migrations are not
  paranoia; they are the acknowledgment that the field contains every bug
  ever shipped.
- **Version skew runs in both directions.** Downgrades happen — rollbacks,
  users on old installers, synced profiles. A payload from the *future*
  (version greater than the code knows) must be detected and handled
  deliberately: preserve-and-default is usually right (keep the payload
  untouched for the newer version that wrote it; run on defaults now);
  silently "migrating" it down destroys data the newer version needs.
- **The version covers everything under it.** One version for one payload;
  per-field versioning is a combinatorial trap. If two persisted domains
  evolve at different speeds, give them separate payloads with separate
  versions and separate chains.

## Rehydration is an untrusted read

The payload was written by a different version, possibly interrupted
mid-write, possibly edited by hand, possibly corrupted by the storage
layer. Rehydration therefore validates before adopting:

- **Parse, then check shape**, field by field, against the current
  contract; unknown fields are dropped, missing fields take defaults,
  wrong-typed fields take defaults (a persisted string where a list is
  expected must not become a latent crash three screens later).
- **Check semantics, not just shape**: references into data that no longer
  exists (a persisted selection naming a deleted entity, a layout for a
  removed panel) are resolved at rehydration — cleared or remapped — not
  left to surface as ghosts.
- **Failure falls toward defaults, loudly.** A payload that cannot be
  rescued yields a default state plus a diagnostic — distinguishable from
  first-run
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success):
  "your settings were reset" and "welcome" are different facts, and
  telemetry needs to see the former). Never toward a crash: a corrupt
  payload that prevents launch converts a data problem into an
  unrecoverable product problem, since the payload persists across the
  restart the user will try.

## Write-path hygiene

- **Writes are atomic.** Write-then-rename, or transactional storage —
  never truncate-then-write, which a crash converts into an empty payload.
- **Writes are debounced but bounded.** High-frequency state (panel drag,
  draft keystrokes) coalesces writes; the bound guarantees a crash loses
  at most a known window.
- **Deduplicate identical writes.** Serializing the same state repeatedly
  and rewriting an unchanged payload burns storage-write budget for
  nothing; compare (cheaply — a hash or the serialized form) before
  writing.
- **The contract has one author.** All persistence flows through one
  module that owns the allowlist, the version, the chain, and the
  validation — scattered ad-hoc reads and writes of storage are how a
  second, unversioned contract grows beside the official one
  ([one-validation-door](../../_laws.md#one-validation-door)).
- **Keys live in a registry, not in the modules that use them.** When every
  feature declares its own private key constant, nothing prevents two
  modules from claiming one key, a rename from silently orphaning another
  module's data, or a half-dozen incompatible naming prefixes from
  accreting in one namespace. One registry declares each key, its owner,
  and its durability class — and it is the natural place to hang the
  version and the machine-checkable inventory of what the contract holds.
