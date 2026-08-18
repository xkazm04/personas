---
layer: golden-path
subject: guided-tours
status: forged
techniques:
  - anchor-contracts
  - missing-anchor-degradation
  - action-driven-advancement
  - overlay-precedence
  - tour-lifecycle
  - narration-and-pacing
evidence:
  - src/features/onboarding/components/TourSpotlight.tsx            # anchor-to-stable-testid spotlight: re-measure on scroll/resize/ancestor mutation, missing-anchor flags (never dismisses), pointer-events-none never traps
  - src/features/onboarding/components/GuidedTour.tsx               # step driver: completeOn advancement, route choreography, modal-owns-screen precedence, panel-scoped keys, timeout reaping
  - src/stores/slices/system/tourSlice.ts                           # tour registry + typed TOUR_EVENTS vocabulary, exploration-acknowledge steps (the retired 5s timer), persisted progress/completion, testid validation door
  - scripts/docs/gen-tour-anchors.mjs                               # generated anchor manifest (JSON + native allow-list) validating composed tours before persistence
  - src-tauri/src/companion/generated_anchors.rs                    # generated allow-list mirror — the manifest gate's backend half
  - scripts/test/run-tours-fresh.mjs                                # fresh-profile tour walk against an isolated empty-data instance (test-harness ground)
counter_evidence:
  - src/features/plugins/obsidian-brain/ObsidianBrainPage.tsx       # anchors declared as const-map values: visible to the drift test's grammar, invisible to the manifest generator's — two extractors, two authorities, six anchors in dispute
deviations:
  - w10-guided-tours   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w4-voice-io   # narration cache keyed by step-id only + object URLs never revoked (useTourNarration) — registered under voice-io; cited, not re-registered
---

# Guided tours & spotlight onboarding

A guided tour is in-product coaching that points at the **live interface** —
not a video, not a screenshot carousel, not a help page. It dims the world,
spotlights one real control, says one useful thing about it, and moves on. That
choice of medium is the whole value and the whole risk: because the tour
narrates the actual product, it is always true to what the user sees — until
the product moves underneath it, at which point it becomes confidently,
visibly wrong in a way a static help page never is. Every discipline in this
subject exists to keep the medium's promise while defusing its failure mode.

Three commitments define the standard:

- **The tour points at reality**, through anchors that are contracts with the
  product code, not screen-scraped guesses.
- **The tour never breaks the product.** Whatever goes wrong — a missing
  anchor, a surprise dialog, a mid-tour navigation — the user's session
  survives. Coaching is an accessory; it must fail as one.
- **The tour is content with a lifecycle** — authored, versioned, tested,
  resumed, completed, and retired — not a one-shot script welded into a
  release.

## What a tour is, and is not

A tour **teaches**: it transfers a mental model of surfaces that already work
without it. It does not **collect** — a flow that gathers required input,
makes decisions, or commits data is a wizard, with a wizard's step-state and
commit disciplines ([wizard-flows](../wizard-flows/wizard-flows.md)); dressing
a data-capture flow as a tour inherits the tour's skippability and loses the
wizard's integrity guarantees. Nor does a tour **navigate on its own
authority**: when a step lives on another screen, the tour requests travel
through the product's own navigation model
([app-shell](../app-shell/app-shell.md)) and choreographs around it, rather
than teleporting the user through a side door the product would never use.

The boundary matters because everything a tour highlights must remain a real,
working control. The moment a tour needs the product to behave differently
*because a tour is running* — special modes, disabled features, synthetic
data — it has stopped narrating the product and started performing a demo,
and demos rot on contact with reality.

## The anchor is a contract, not a lucky selector

A tour step points at an element. That pointer is the load-bearing joint of
the entire subject, and treating it casually — a styling class, a text match,
a positional guess — produces the worst artifact this medium can produce: a
spotlight confidently circling the wrong thing, or nothing. **A tour pointing
at a moved element is worse than no tour**, because it teaches a falsehood
with the full authority of the product's own chrome.

The standard makes the pointer a two-sided contract. The product side declares
stable, machine-facing identifiers on the elements tours may reference, and
maintains them *where the elements live* — whoever moves the control moves its
identifier, in the same change. The tour side references only declared
identifiers. Between the two sides stands a **manifest** — a generated,
verified inventory of which identifiers exist — so that a tour referencing a
vanished anchor is caught by a gate at build or test time, not by a user under
a misplaced spotlight. Geometry is the contract's second half: a spotlight is
a *derivation* from the anchor's live position, recomputed when the anchor
moves, scrolls, resizes, or is re-created. The full discipline is
[anchor-contracts](techniques/anchor-contracts.md).

## Degradation never kills the tour — or the app

Contracts reduce anchor failures; they do not eliminate them. Feature flags,
entitlements, empty states, and race conditions all produce moments where a
referenced anchor legitimately is not on screen. The standard's posture is
that a missing anchor is an **expected condition with a declared policy** —
skip the step, or re-center the guidance without a spotlight — never a crash,
never an infinite wait, and above all **never a stranding**: the user must not
be left under a dimmed overlay with nothing highlighted and no way out. The
degraded path is also instrumented, because each degradation is a signal that
either the tour or the anchor contract has drifted. The policies live in
[missing-anchor-degradation](techniques/missing-anchor-degradation.md).

## Advancement follows reality

The weakest tours are slide decks projected onto the interface: next, next,
next, done — the user has read about the product without touching it. The
standard prefers **action-driven advancement**: where a step says "open this
panel", the step completes when the user actually opens the panel, observed
through a real signal from the product, not through a button that takes the
tour's word for it. Interactive steps teach the hand, not just the eye, and
they keep the tour honest — a step that cannot complete because the described
action no longer works is a defect surfaced immediately.

Reality-driven advancement has consequences the technique must own: steps that
navigate mid-tour must choreograph the route change instead of racing it, and
any step waiting on a user action needs an exit for the user who does not act.
The full contract is
[action-driven-advancement](techniques/action-driven-advancement.md).

## The tour respects the app

A tour overlay is a citizen of the product's overlay order, not an occupying
force. Its precedence relative to dialogs, notifications, and critical alerts
is decided **once, at the product's single layering authority** — the tour
subject does not own that scale, it registers into it
([layering-and-precedence](../modal-stack/techniques/layering-and-precedence.md)
under [modal-stack](../modal-stack/modal-stack.md)). What the tour *does* own
is its conduct at each collision: what the tour does when a dialog opens on
top of it, whether toasts pierce the dimming, and — most strictly — its focus
policy. A tour that traps keyboard focus it cannot release, or swallows the
escape key the product needs, has broken the product to decorate it. The
conduct rules are [overlay-precedence](techniques/overlay-precedence.md).

## Tours are content with a lifecycle

A tour is authored once and then lives for years against an interface that
does not hold still. The standard treats each tour as a versioned content
entity with identity, state, and an end of life:

- **Progress persists.** An interrupted tour resumes where it stopped —
  including across restarts — rather than restarting from step one or
  vanishing.
- **Completion is tracked per tour, per user**, so finished coaching never
  replays uninvited, and product teams can see which tours are actually
  finished versus abandoned at step two.
- **Stale tours are retired.** When the surface a tour narrates is redesigned,
  the tour is updated or withdrawn *in the same change* — an outdated tour is
  active misinformation, not harmless cruft.
- **Tours are tested from a fresh profile**, because the entire experience is
  gated on first-run state that no developer's daily environment still has.

The registry of tours doubles as a coverage surface: which major surfaces have
coaching, which have none, and which have coaching that no longer matches. The
lifecycle discipline is [tour-lifecycle](techniques/tour-lifecycle.md).

## Narration is an accessory to the accessory

Spoken or animated narration can lift a tour from labels to a guided
conversation — and it inherits a double dose of the accessory rule: the
narration must never block the tour, just as the tour must never block the
product. Steps advance whether or not audio ever arrives; skipping is
instant and total; pacing is the reader's, not the soundtrack's. The audio
machinery itself — synthesis, caching, playback — belongs to the voice
subject ([voice-ux-integration](../voice-io/techniques/voice-ux-integration.md)
under [voice-io](../voice-io/voice-io.md)); this subject owns only the
coupling, in [narration-and-pacing](techniques/narration-and-pacing.md).

## Skippability is a hard requirement

Threaded through every technique, one rule is absolute: **the user can always
leave**. Every step offers exit; exit is one gesture, never a confirmation
chain; and exit restores the product completely — overlay gone, focus
returned, scroll released, nothing dimmed. A tour the user cannot escape
converts onboarding into hostage-taking, and users remember it. Skipping is
also recorded as an outcome distinct from completing, because a tour most
users abandon is a tour telling its authors something.

## The techniques

- [anchor-contracts](techniques/anchor-contracts.md) — stable identifiers as
  a two-sided contract, the generated/verified manifest, geometry as a live
  derivation, the anchor-drift gate.
- [missing-anchor-degradation](techniques/missing-anchor-degradation.md) —
  skip and re-center policies, the never-strand invariant, degradation
  telemetry.
- [action-driven-advancement](techniques/action-driven-advancement.md) —
  completion on real user actions, choreographed mid-tour navigation,
  fallbacks for the step that never completes.
- [overlay-precedence](techniques/overlay-precedence.md) — the tour as a
  citizen of the product's layering authority; conduct when modals, toasts,
  and alerts collide with it; focus and escape policy.
- [tour-lifecycle](techniques/tour-lifecycle.md) — progress persistence,
  resume, completion tracking, retirement of stale tours, fresh-profile
  testing, the registry as a coverage surface.
- [narration-and-pacing](techniques/narration-and-pacing.md) — narration as a
  non-blocking accessory, reader-paced steps, skippability of sound and
  motion.
