---
layer: technique
subject: packaging
technique: signing-and-trust
status: forged
laws: [gate-sees-target]
shared_with: []
---

# Signing and trust

Between your installer and your user stands the operating system, and the
operating system no longer gives strangers the benefit of the doubt. Every
mainstream desktop platform now interposes some combination of quarantine
flags on downloaded executables, reputation scoring, provenance
verification, and hard refusal to launch unsigned code under default
settings. Code signing is therefore not a compliance checkbox appended at
release time — it is a **packaging obligation** that determines whether the
artifact you ship is, from the user's chair, software or a security
warning.

## What unsigned actually costs

The cost is not one scary dialog. Per trust class, the unsigned experience
ranges from friction to a wall:

- **Reputation-gated platforms** interpose a warning whose dismissal path
  is deliberately non-obvious; a meaningful fraction of users — and nearly
  all non-technical users — abandon at the warning. Reputation accrues to
  the signing identity over time, so an unsigned product restarts from
  zero trust with every release, and even a *newly* signed product pays a
  cold-start penalty the identity has not yet earned out.
- **Provenance-verified platforms** refuse to launch un-attested software
  under default settings at all; the workaround is a ritual most users do
  not know and should not be taught. Shipping unsigned there is shipping
  to developers only, whatever the download page says.
- **Distribution channels and enterprise fleets** filter earlier still:
  unsigned artifacts are rejected by store review, blocked by fleet
  policy, or stripped by mail and browser security layers before the user
  ever sees them.

The honest form of the decision is a per-cell line in the support matrix:
this platform, this trust class, signed with this identity — or unsigned,
with the measured cost accepted in writing. What never survives contact
with reality is the implicit posture, where some cells happen to be signed
because the pipeline for them happened to be finished.

Even a deliberately-unsigned posture has a **floor to assert**. Some
platforms require a minimal self-generated signature for a binary to
execute at all, and the bundling toolchain usually applies it silently —
which means it can also silently stop applying it. The acceptance path
verifies the floor explicitly: the artifact carries *at least* the minimal
signature class, so "unsigned by choice" can never quietly degrade into
"unlaunchable", and a future upgrade to a real identity is detected as the
improvement it is rather than passing unnoticed.

## Trust classes, not vendor rituals

The platforms differ in mechanism but the classes are stable, and a
packaging design addresses each by name:

1. **Signature over the artifact** — cryptographic proof the bytes are
   untampered and traceable to an identity. Applies to the installer
   *and* to the executables inside it; several platforms verify inner
   binaries independently, so an installer that signs only its outer
   shell fails deeper checks.
2. **Identity vetting** — the tier of the signing identity (individually
   vetted versus organization-vetted) changes the trust the platform
   extends; the higher tier is often what separates "warning" from "no
   warning".
3. **Platform attestation** — submitting the artifact to the platform
   vendor for automated inspection and countersignature before
   distribution. This adds a *service dependency* to the packaging
   pipeline: attestation takes minutes to hours, can fail on policy
   grounds unrelated to code correctness, and must therefore live inside
   the pipeline's critical path with a timeout and a failure mode — not
   be discovered at ship time.
4. **Timestamping** — a countersigned proof of *when* the signature was
   made, so artifacts remain valid after the signing credential expires.
   Omitting it plants a time bomb: every shipped artifact stops
   validating on the credential's expiry day, simultaneously.

## Keys are production credentials

The signing key is the most consequential secret the project holds: a
leaked deploy token is rotated in an hour; a leaked signing key means
hostile code can be shipped *as you*, to every user, with the platform's
trust machinery vouching for it. The custody rules follow:

- Keys live in hardware modules or a managed signing service — never as
  files in the repository, on developer machines, or in build-runner
  images. Modern platform requirements increasingly mandate hardware
  custody; design for it before it is mandatory.
- Signing happens at one pipeline chokepoint, with access controlled and
  every signing operation logged: which artifact, which identity, which
  trigger. An audit trail of what was signed is the only answer to "did
  we sign something we shouldn't have?"
- Revocation and rotation are rehearsed paths, not incident-day
  improvisations — including the re-signing story for still-supported
  older releases.

## Verify the signature you shipped

The gate: after packaging and signing, the pipeline **verifies the
signature on the artifact it is about to hand to the release pipeline** —
the actual file, through the platform's own verification tooling, in a
context that has no access to the signing key. Signing steps fail
partially in characteristic ways (one format signed, another missed; the
outer installer signed, an inner sidecar not; a configuration change that
silently skipped the step), and every one of them produces an artifact
that *looks* done. The signing log is a proxy; the verified artifact is
the target ([gate-sees-target](../../_laws.md#gate-sees-target)). Where
the platform distinguishes attestation from signature, verification
checks both — and does so on the exact bytes being published, because a
re-build after verification quietly ships an unverified artifact.
