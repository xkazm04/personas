---
layer: technique
subject: release-pipeline
technique: updater-chain
status: forged
laws: [gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Updater chain

An installed copy discovers releases by polling a small manifest — the
**update feed** — that names the newest version, where its payload lives,
and a signature proving the payload's origin. The chain runs: pipeline
generates feed → feed points at payloads → installed copies poll, compare
versions, download, verify, apply. Every link is part of the release; a
release that any link cannot deliver has been *built*, not *shipped*.

## The self-sealing defect class

The updater is the only component whose bugs disable their own fix. Ship a
defect in the update machinery in version N — a parser that rejects the new
feed shape, a verifier that chokes on a key rotation, an applier that dies
mid-swap — and version N+1, which contains the repair, must arrive *through
the defective machinery*. It cannot. The channel is severed for every copy
of N in the field, and the remedy degrades to manual reinstall, which most
users of an unattended product will never perform.

This one asymmetry generates the technique's whole posture:

- **The updater path gets the most conservative change policy in the
  project.** Feed format, verification logic, and apply logic change
  rarely, compatibly, and with dread. A new feed shape ships in two
  releases: first the reader that accepts both shapes, then — releases
  later, after the fleet has moved — the writer that emits the new one.
- **Every candidate release is rehearsed as an update, not just as an
  install.** Take the *previous shipped release*, point it at the candidate
  feed, and watch it discover, download, verify, apply, relaunch, and
  report the new version. Fresh-install testing proves the artifact;
  only update rehearsal proves the chain — and the chain is what a
  severed fleet needed proven.
- **The updater reports its own health.** A fleet that silently stopped
  updating looks identical to a fleet that is up to date — absence of
  update traffic is the failure wearing success's uniform
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
  Version-adoption telemetry (what fraction of active copies run the
  latest release, trending after each ship) is the only instrument that
  sees a severed channel from the outside.

## The feed is generated from the artifacts, not from intent

The feed manifest states facts about payloads: their location, their size,
their checksum, their signature. Every one of those facts must be **derived
from the actual uploaded artifacts** — computed by reading the bytes that
clients will download — never assembled from build-time intentions
([gate-sees-target](../../_laws.md#gate-sees-target)). A feed built from
intent drifts from the payload the moment anything intervenes: a re-run
that rebuilt one target, an upload that silently truncated, a rename in
storage. Ordering follows from this: payloads are uploaded and verified
first, the feed is generated from what is verifiably in place, and the
feed pointer advances last. The feed is the commit point of the whole
release; everything before it is preparation.

Two practical consequences. First, artifact storage is usually
**eventually consistent** — assets finalize asynchronously after upload —
so the feed generator polls with backoff until the artifact set it needs
is fully visible; it tolerates the storage's asynchrony by *waiting*,
never by weakening what it requires. Second, the generator **enumerates**
the complete required set — every platform's payload and every platform's
signature, by name — and hard-fails on any absence. The tempting graceful
degrade (emit the feed with an empty entry for the missing platform) does
not degrade gracefully at all: that platform's installed copies error on
every poll from then on, which reads as "updates are broken", silently,
platform-wide.

## Signing, and the custody of the key

Payload signatures are what stand between the fleet and anyone who can
write to the distribution storage — a compromised bucket without signing is
remote code execution on every installed copy. Discipline:

- The private key never enters the build environment as plain material
  longer than the signing step, and never exists in history, logs, or
  artifacts. The public key ships inside the application — which means it
  is subject to the self-sealing rule: rotating it is a two-release
  maneuver (ship the new public key alongside the old, then sign with the
  new), and it must be rehearsed before it is needed.
- **Losing the private key severs the channel as thoroughly as any updater
  bug** — no future release can prove its origin to the installed fleet.
  Key custody (where it lives, who can use it, how it is recovered) is
  release infrastructure, not a credential detail.
- The verifier on the client fails **closed**: an unsigned or badly-signed
  payload is discarded, silently from the user's view, loudly in
  diagnostics.

## Applying: the client's one-way door

The apply step swaps a running application out from under itself, and the
machine may lose power mid-swap. The contract is the same as any atomic
replacement: stage the new version completely beside the old, verify it
(checksum, signature — and re-verify *at apply time*: the gap between
download and apply is real time on a user's machine), and make the
switchover a single atomic operation with the old version retained as the
fallback. A failed apply must leave the old version bootable; "half of
each" is the one forbidden outcome, because a copy that cannot boot cannot
poll the feed, which converts an update failure into the severed-channel
class.

## Staged rollout: rate-limiting the blast radius

The feed is a lever, not a broadcast: it can offer the new version to a
fraction of the fleet — by percentage, by ring (internal, opt-in-beta,
everyone), or by cohort. The purpose is to bound the worst case: a defect
that escapes every rehearsal reaches five percent of the fleet, adoption
telemetry and crash reporting catch it, and the rollout **halts** — the
feed stops offering, and copies that have not yet updated never see the bad
version. Two requirements make this real rather than decorative: the halt
must be a tested, single-action control (a rollout you cannot stop is just
a slow broadcast), and the rollout fraction must be honored by the feed
server or feed content itself, not by client-side politeness. Note what
staging does not do: copies that already updated are through the one-way
door and can only be fixed forward — staging narrows the door, it does not
add a way back.
