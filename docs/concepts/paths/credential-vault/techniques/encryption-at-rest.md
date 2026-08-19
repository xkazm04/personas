---
layer: technique
subject: credential-vault
technique: encryption-at-rest
status: forged
laws: [one-validation-door, deletion-is-not-repair, count-carries-predicate]
shared_with: []
---

# Encryption at rest

Sealing stored values defends against a specific adversary: **someone who
obtains the storage without the running process** — a stolen disk, an exfiltrated
backup, a synced folder, a copied database file. It does not defend against a
compromised live process, which by definition can do whatever the process can
do. Stating the threat model first is not pedantry; it prevents both
over-claiming ("encrypted, therefore safe") and under-building ("the attacker
could compromise the process anyway, so why encrypt" — because disks travel and
processes don't).

## Envelope layering

The load-bearing structure is two tiers of keys:

- **A data key per secret** (or per small family of secrets) does the actual
  sealing. It exists to bound blast radius: breaking or leaking one data key
  opens one record, not the store.
- **A master key seals the data keys.** It is the only key that must be
  protected by something *outside* the store — because a key stored next to
  what it encrypts is a lock taped to its own key.

This layering buys the two properties flat encryption cannot offer at once:
**cheap rotation** (re-sealing the store under a new master key means
re-encrypting kilobytes of data keys, not the whole corpus) and **granular
compromise** (a bug that decrypts one record does not hand over the master).

### Master-key custody — a genuine trade-off, not a right answer

- **Platform key store** (the operating system's credential locker): survives
  no-password workflows, ties secrets to the machine account, but its security
  is exactly the account's — same-user malware reads it — and it complicates
  backup/portability by design.
- **Passphrase-derived** (a memory-hard key-derivation function over an
  operator secret): survives disk theft even against the machine account,
  portable, but introduces an unlock step and a forgotten-passphrase total-loss
  mode.
- **Hardware-backed** (a secure element that performs the unseal without ever
  releasing the key): strongest custody, least portable, and the recovery
  story must be written before adoption, not after the device dies.

A principal-quality vault picks per deployment posture — an unattended
automation host cannot prompt for a passphrase; a portable workstation should
not trust only the login session — and records which custody each store uses,
because migration between custodies is an explicit re-seal, not a config flip.

## The sealing itself

- **Authenticated encryption only.** The cipher must detect tampering, not
  just hide content; unauthenticated modes let an attacker who can write the
  store flip bits meaningfully. Reject-on-authentication-failure is a feature:
  it converts silent corruption into a loud, diagnosable error.
- **Nonce discipline is existential.** Reusing a nonce under the same key in
  the standard authenticated modes doesn't weaken the encryption — it breaks
  it. Fresh randomness per seal, wide enough to make collision negligible, or
  a counter regime with persistence guarantees; never "derived from the
  record" without a proof of uniqueness.
- **Bind the ciphertext to its record.** Feed the record's identity (its id,
  its purpose) into the authenticated-associated-data channel, so a ciphertext
  cut from one record and pasted into another fails to open. Without this, an
  attacker with write access to the store can swap a low-privilege secret's
  ciphertext for a high-privilege one and let the application confuse itself.
- **A versioned envelope header.** Every sealed blob states which algorithm,
  which layering, which master-key generation produced it. Algorithm agility
  is not speculative — parameters age, mistakes are found — and the version
  byte is what makes migration a rolling re-seal instead of a big-bang
  re-encryption with downtime. The key-identity half matters even before any
  second algorithm exists: a ciphertext that does not name its key makes key
  rotation *unrepresentable* (no way to tell migrated from unmigrated rows),
  and turns a wrong-key decrypt into an authentication error indistinguishable
  from corruption — a diagnosis dead-end at exactly the moment custody
  changed.

## One door ([one-validation-door](../../_laws.md#one-validation-door))

All sealing and unsealing passes through a single module; the writers and
readers of sealed values are enumerable by construction. The alternative —
cipher calls sprinkled across call sites — decays predictably: one site
forgets the associated data, one adopts the new envelope version late, one
logs an intermediate buffer. The single door is also where the blast-radius
disciplines live once instead of N times: zeroization, redaction of error
payloads, version checks.

**Altitude decides coverage.** Place the door at the *lowest layer all writers
share* — inside the storage write itself, not inside the request handler above
it. A control that lives in the record-insert path covers every entry route
automatically, including the four acquisition modes added after it was written;
a control that lives in one command covers that command, and each new
automation route (an import, a capture, a provisioning agent) silently ships
without it. The pattern repeats across vault history: the controls that
survive the addition of new doors are the ones that were never at a door.

## Memory hygiene

Plaintext exists between unseal and use. Its lifetime is minimized and its end
is explicit:

- Hold plaintext in wipeable buffers and **zero them deterministically** when
  done — release-to-allocator is not erasure; freed memory keeps its contents
  until something overwrites it, and crash dumps read it.
- Beware the runtime's copies. Immutable string types, growable buffers that
  reallocate, logging frameworks that format-then-buffer — each silently
  duplicates plaintext beyond the wipe's reach. Confine plaintext to types the
  door controls, and convert at the last edge.
- Zeroization is defense in depth, not the perimeter. Its value is bounding
  *how long* exposure lasts after use — against dumps, swaps, and reads of
  reclaimed memory — not preventing a live debugger.

## Deprecating a weak path — instrument, drain, then delete

Every long-lived vault accumulates a legacy: an older algorithm, an
unauthenticated mode, a plaintext column from before the vault existed. The
wrong move is deleting the legacy read path while data may still live under it
— that converts "weakly protected" into "unreadable", which is data loss
wearing a security costume
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)).

The correct sequence:

1. **Stop writing** the weak form — the one door makes this a one-line change
   with no stragglers.
2. **Upgrade on read**: when the door unseals a legacy blob, re-seal it in the
   current envelope in the same transaction.
3. **Instrument the legacy path** with a counter that carries its predicate
   ([count-carries-predicate](../../_laws.md#count-carries-predicate)):
   "N unseals via envelope-v1, measured at the door, since T" — not a vague
   feeling that "nobody uses that anymore". Surface the counter on the vault's
   own status surface; a number in a log nobody tails is not instrumentation.
4. **Sweep the remainder** proactively once the count plateaus — records never
   read on their own (retired credentials kept for audit) won't migrate via
   step 2.
5. **Flip the path to reject-by-default** behind an explicit, logged,
   temporary re-allow switch. Where the legacy branch is *selectable by the
   caller* (a format sniff, a separator, a version byte an attacker can
   choose), this rung is not optional: a downgrade path that any writer can
   dispatch into is an attack surface, and rejecting by default while the
   escape hatch exists converts "silently weaker" into "loudly refused, with
   a one-flag migration window".
6. **Delete the code when the measured count is zero over a full operational
   cycle** — and only then.

The instrument-then-drain shape is the general form of every security
migration: the gate that says "legacy is gone" must observe actual reads, not
the deployment date of the new code.
