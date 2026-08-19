---
layer: technique
subject: sync-replication
technique: projection-security
status: forged
laws: [one-validation-door, gate-sees-target]
shared_with: []
---

# Projection security

Replication is disclosure with a multiplier. Whatever crosses the sync
boundary now exists in N places, under N custody regimes, in N sets of
backups, for N lifetimes you no longer control — and no later revocation
reliably un-discloses it. So the outbound edge of every stream is a
security boundary with the same seriousness as an API response: **what
leaves is an allowlisted projection, built at one door, and secrets never
leave at all.**

## Allowlist, never denylist

The projection for each stream **enumerates the fields it sends**; every
field not named stays home. The alternative — send the record minus a
list of withheld fields — fails open: the column added next quarter (a
cached token, an internal note, a derived score with someone else's data
in it) replicates by default, because nobody who added it knew about the
denylist. Under an allowlist the new column defaults to *not
replicated*, and extending the projection is a deliberate, reviewable
act on the stream's declaration. This is the difference between a
boundary that degrades toward disclosure and one that degrades toward
staleness — and staleness is the recoverable direction.

The projection is also where **derived-and-safe substitutes for
raw-and-sensitive**: send the display name, not the account identifier
it was derived from; the count, not the list; the status, not the error
string that may embed a path or a key. Each substitution shrinks what
the far side can leak.

## One door, enumerable writers

Everything outbound passes through one projection function per stream —
one place that builds the wire shape from the local record — and the set
of code paths that can put bytes on the sync transport is enumerable
([one-validation-door](../../_laws.md#one-validation-door)). Projection
logic sprinkled across call sites is an allowlist minus the site added
next quarter. The single door is also the only structure that makes the
boundary *reviewable*: a security pass reads N small projection
functions and knows the entire disclosure surface; against ad-hoc
serialization it reads the whole codebase and knows nothing durable.

The door earns a gate that watches it
([gate-sees-target](../../_laws.md#gate-sees-target)): a check that
diffs each stream's projected field set against its declaration, so a
field added to the wire shape without a declaration change fails loudly.
A review policy ("we look carefully at sync code") is a gate on a proxy;
the projection diff is a gate on the target.

## Secrets do not replicate — ever

Credentials, tokens, keys, and anything in their custody class are
excluded from every projection categorically, not stream by stream.
A secret that syncs has left its custody boundary: the far store's
encryption posture, operator set, and backup lifetime are all now part
of the secret's attack surface. Where replicated records *reference*
secret-bearing entities, the reference crosses (an identifier, a
non-sensitive label, a status) and the secret material stays behind its
own boundary with its own rules — custody, encryption at rest, rotation
— which are the [credential
vault](../../credential-vault/credential-vault.md)'s subject, not this
one. The test that keeps the promise honest: enumerate the secret
custody class, then assert that no stream's declared projection
intersects it — an assertion over declarations, which the one-door rule
is what makes possible.

## Encrypt for the least-trusted hop

When the transport or the destination store is less trusted than the
source — a relay you rent, a hosted hub, a peer device — the projection
is encrypted before it leaves, under keys the untrusted party never
holds. The relay then learns traffic shape (which streams, how much,
when) but not content; a breach of the hub discloses ciphertext. The
price is real and must be budgeted, not discovered: the hub cannot
index, validate, or conflict-resolve what it cannot read, so
content-dependent work (three-way compares, field merges) moves to the
edges that hold keys, and the hub degrades to an ordered blob store.
Choosing hub-side conflict resolution *and* hub-blind encryption is
choosing a contradiction; the topology declaration is where the choice
is made once.

## The receiving side scopes every write

Inbound is the boundary's other half. A merge that trusts the payload's
claimed ownership — writing to whatever tenant, owner, or workspace the
incoming record names — is a cross-tenant write primitive an attacker
reaches through the least defended replica. The receiving door derives
the scope from the **authenticated channel** (this connection belongs to
tenant T; everything arriving on it lands in T, whatever the payload
says), validates identities and shapes as untrusted input, and treats
out-of-scope references inside the payload as errors to report, not
links to honor. Symmetric doors: one projection door out, one scoped
validation door in, and the transport between them assumed hostile.
