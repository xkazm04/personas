---
layer: technique
subject: signed-artifacts
technique: import-verification-flow
status: forged
laws: [gate-sees-target, one-validation-door, failure-not-empty-success, identity-survives-reuse]
shared_with: []
---

# Import verification flow

Import is where a signed artifact stops being a file and becomes rows in your
store, configuration in your engine, instructions your agents will follow. It
is the highest-consequence moment of the subject and it gets a three-act
structure: **verify → preview → commit**. Nothing merges before act one
passes or the user explicitly overrides; the user decides on facts shown in
act two; act three commits *exactly* the bytes those facts described.

## Act one: verify, behind the door

Parse defensively first — the artifact is untrusted input before it is
anything else: cap decompressed sizes on the declared size *and* on the
actual read (archive formats lie), refuse unknown format versions before
reading a single row, and treat parse failure as its own verdict, never as
an empty artifact. Then compute the signature verdict as
[detached-signatures-and-key-identity](detached-signatures-and-key-identity.md)
prescribes — trust-store key, id↔key binding, two booleans.

Now the rule this technique exists for: **the refusal must live on the same
side of the boundary as the commit.** A verdict computed in the backend and
enforced only by a disabled button is not enforcement — anything that can
invoke the import can skip the view, and the producing half of the same
codebase usually already knows it (the honest comment "the frontend is not
the boundary" tends to exist somewhere nearby). The most instructive failure
shape is the verdict that is computed correctly, then written onto the
imported rows as a provenance field while the import proceeds regardless:
the work of verification done, only the `if` missing. Recording provenance
on committed rows is good practice — *in addition to* the gate, never as its
residue ([gate-sees-target](../../_laws.md#gate-sees-target): the gate on
"may this merge" must read the verdict at the door that merges).

## Act two: preview, with provenance

The preview answers, before anything is written: **who** signed this (as
resolved by the verifier — trusted name, unknown identity, or tamper
warning, per [verification-ux](verification-ux.md)); **what** is inside
(resources by type and name); **what happens on collision** (exists already
— skip, rename, overwrite?); and **what reach** the contents would gain
(network destinations, capabilities, spend limits declared by the artifact).
Provenance badges belong here, on the preview — the user's yes/no is a trust
decision and the preview is where trust information must concentrate.

Consent to proceed past a failed or unverifiable verdict follows
[verification-ux](verification-ux.md)'s rules: kind-matched to the specific
danger, re-armed whenever the artifact hash, trust state, or verdict
changes, styled as the exception.

## Act three: commit the previewed bytes — not the path

Between preview and commit sits a classic time-of-check gap: the user stares
at the preview while the file on disk (or the clipboard, or the remote host
behind a link) changes. Commit must therefore prove it is operating on the
bytes the preview described:

- **Pin by content hash.** The preview computes and displays a digest; the
  commit call requires it and refuses on mismatch. When a preview happened,
  the pin is *mandatory* — a commit that arrives with a preview reference
  but no expected hash is refused outright, because optional pins decay
  into absent ones.
- **Prefer cached bytes.** Hold the previewed bytes (keyed by a preview id,
  with an expiry — name the reaper) and commit from the cache; fall back to
  re-read *plus* the mandatory hash check when the cache has expired.
- **Re-verify on the committed buffer.** The signature verdict, like the
  hash, holds for one byte sequence; act three runs against the buffer it
  actually commits.

## Every ingress channel, one validation door

Artifacts arrive through more doors than the file picker: paste-from-
clipboard, deep links that resolve to a fetch, drops, remote pulls. Each
channel is a *transport*; all of them must converge on the same parse-verify-
preview-commit core, so the guard count is one, not one-per-channel
([one-validation-door](../../_laws.md#one-validation-door) — enumerate the
writers; the door added next quarter is the one that skips the checks).
Channel-specific integrity composes on top: a link minted by your own system
carries the producer's content hash, and fetched bytes are re-hashed against
it before anything else happens — a link *without* its hash is anomalous
(your own generator always emits one) and is refused, while a hashless
foreign URL may proceed with an explicit warning. Whatever the policy per
channel, decide it deliberately, write it beside the code, and pin it with
tests — these are exactly the decisions that look accidental two years later
([failure-not-empty-success](../../_laws.md#failure-not-empty-success):
"could not verify" must never flow silently into "verified enough").

## What commit writes

- **Fresh local identity.** Mint new ids for arriving entities, or match on
  a genuinely stable key. Never match on a field the importer itself mutates
  (a display name it suffixes, a path it relocates) — that makes every round
  trip a duplicate, compounding
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
- **Quarantine defaults.** Imported executable things (agents, automations,
  schedules) land disabled; the artifact proved who built it, not that it is
  safe to run here. Enabling is a separate, human act.
- **Provenance stamped on rows** — signer, verdict, artifact digest, import
  time — so later audits can answer "where did this come from" without
  archaeology.
- **An import ledger entry** with real per-entity results. A ledger whose
  every row says "committed, details: none" is the marker-never-read shape
  in bookkeeping form; record what was skipped, renamed, or refused, or the
  ledger cannot support the one question it exists for.
