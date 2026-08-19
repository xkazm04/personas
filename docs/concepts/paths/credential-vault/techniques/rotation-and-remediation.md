---
layer: technique
subject: credential-vault
technique: rotation-and-remediation
status: forged
laws: [one-authority-per-vocabulary, deletion-is-not-repair, failure-not-empty-success]
shared_with: []
---

# Rotation and remediation

Two loops keep a credential population healthy, and they must not be confused:

- **Rotation** is *planned replacement* — hygiene executed on policy, while
  everything still works.
- **Remediation** is *reactive response* — what the vault does when a
  credential is observed misbehaving.

Conflating them produces the two classic failure postures: vaults that only
rotate when something breaks (so every rotation is an incident), and vaults
that treat every observed failure as a rotation trigger (so every network blip
becomes a re-onboarding ceremony).

## Rotation: replace while it still works

**Policy is data, with one authority.** Rotation triggers — age thresholds,
personnel or ownership change, scope change, suspicion of exposure, provider
advisory — live in one declared policy per credential class, not as constants
scattered through schedulers. A credential's record can answer "when is your
next rotation and why" without running anything.

**The overlap window is the whole craft.** Rotation done right is a
four-step overlap, never a swap:

1. **Mint the successor** while the incumbent still works — which is exactly
   why rotation must not wait for breakage: a dead credential often can't
   authenticate the minting of its own replacement.
2. **Validate the successor live** — a real authenticated probe proving it
   works *and* carries the scopes the workload needs. Scope regression during
   rotation (the new key was created with defaults, the old one had been
   hand-widened years ago) is the classic silent downgrade.
3. **Cut consumers over** — atomic from the consumers' view because they
   resolve the credential through the vault by reference; nobody holds the
   old value directly (the brokered-egress dividend).
4. **Retire the incumbent** — revoke upstream, destroy locally — only after
   the successor has served real traffic. Never rotate into an outage: the
   incumbent's retirement is *conditioned on* the successor's proof, not
   scheduled beside it.

**The history write is part of the rotation, not a courtesy.** Each rotation
appends a ledger entry — when, why (which policy or evidence), from what to
what (by identity, never by value) — and the policy's own clock ("last
rotated", "next due") advances **only when that entry lands**. Two failure
shapes hide here, both observed in the wild: the ledger write is fire-and-
forget, so a rejected entry (a vocabulary the ledger's own validation refuses
— see the one-vocabulary rule below) vanishes silently at every call site;
and the clock advances on the line after the discarded write, so the policy
reports "rotated, next due tomorrow" with no ledger row to witness it. A
rotation that cannot prove it happened has not happened
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)
applied to the vault's own bookkeeping): couple the clock to the witness, and
treat a refused history write as a loud failure of the rotation itself.

**The provider rotates too.** Upstream-initiated rotation and revocation
arrive unannounced — the technique must detect them (a healthy-yesterday
credential rejected today) and route to remediation, because from the vault's
seat an upstream rotation is indistinguishable from breakage until diagnosed.

## Remediation: a ladder, not a kill switch

The naive design is a boolean: failures flip the credential to broken. The
result is a vault that pages the operator for every provider deploy. The
principal-quality design is a **graduated ladder** with proportional response:

> **observe → warn → degrade → suspend**

- **Observe.** Individual failures accrue as evidence, weighted by kind —
  definitive rejections from the authority weigh heavily (one can be
  conclusive on its own); transient failures weigh lightly and only in
  aggregate; could-not-verify outcomes weigh **zero**
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success):
  absence of proof accumulated into proof of breakage is how offline machines
  end up suspending their entire credential population).
- **Warn.** Enough evidence surfaces to the human — visible, attributed to
  its evidence, not yet consequential to traffic.
- **Degrade.** The vault reduces the credential's exposure: non-critical uses
  pause, probes intensify to sharpen diagnosis, dependent automations are
  told to expect trouble. Traffic that must flow still flows.
- **Suspend.** Use stops. This is the ladder's top, reached by accumulated
  weighted evidence or one conclusive rejection — never by a single ambiguous
  failure.

**Every rung has a way down.** Recovery evidence — successful probes,
successful real traffic — steps the credential back toward healthy. A ladder
without descent converts every transient incident into a permanent suspension
that only a human can clear, which quietly re-invents the kill switch with
extra steps.

**Scoring beats streaks.** A raw consecutive-failure counter treats one
timeout the same as one revocation and resets to innocence on a single lucky
success. A score that weights failure class, decays with time, and requires
*sustained* recovery to descend resists both false alarms and flapping — a
credential oscillating hourly between healthy and degraded is telling you
about your thresholds, and hysteresis (harder to descend than to ascend) is
the standard cure.

## Suspension is containment, not repair

Suspending a failing credential stops the bleeding. It fixes nothing
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair) — removing
the credential from service removes the *visibility*, not the cause). Every
suspension carries a diagnosis obligation: revoked upstream? expired grant?
quota exhaustion? clock skew? scope withdrawn? Each has a different remedy —
re-acquisition, refresh repair, waiting, time sync, re-consent — and the
remediation state must hold the evidence that answers it, because the human
arriving at the suspension notice starts from what the vault preserved.

The same law governs the tempting shortcut of *deleting* a chronically flaky
credential record: the flakiness had a cause; deletion orphans the automations
that depended on the credential and destroys the evidence trail in the same
motion.

## One status vocabulary

The ladder states, the health-probe outcomes, and every surface that renders
credential status draw from **one authoritative vocabulary**
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The failure mode is concrete: the ladder adds a `degraded` state, the
dashboard's hand-copied status list doesn't learn it, and the most important
intermediate state renders as a blank badge precisely when an operator needs
it. The subtler variant is *two adjacent vocabularies with one unguarded
assignment between them*: the policy's trigger-kind enum and the history
ledger's entry-kind enum evolve separately, a value from one is passed
straight into the other, and every member outside the intersection turns into
a rejected write — silently, if the write is fire-and-forget. Where two
vocabularies must map, the mapping is an explicit, total function, not an
assignment that happens to work for two of the values. Transitions are recorded with their evidence — "degraded at T because
score crossed S on evidence E" — because a status without its provenance
cannot be trusted enough to act on, and acting is the entire point of having
one.
