---
layer: technique
subject: session-resume
technique: first-run-and-quiet-silence
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# First run and quiet silence

The hardest render in the resume system is nothing at all. A briefing
surface earns long-term attention by a simple contract: **when it
appears, it matters.** Every appearance that says nothing — an empty
shell, a cheery "all caught up!", a first-run card listing the entire
world as "new" — spends the trust that the one important briefing will
need. Users train fast: three contentless appearances and the surface is
banner-blind forever, taking its future signal with it. Silence is
therefore not the fallback state of the briefing; it is a designed
output with its own conditions and its own verification.

## First run says nothing

On first run there is no anchor, so there is no "since." Two tempting
defaults are both wrong: treating the missing anchor as epoch zero makes
everything "new" and produces the noisiest possible briefing at the
moment of least context; treating it as "now" is harmless today but
establishes the anchor from a moment the user never actually surveyed.
The correct behavior: the missing anchor is a first-class *first-run*
signal ([last-seen-anchors](last-seen-anchors.md)), the briefing renders
nothing, and the anchor initializes to the present so the *second*
session gets an honest delta. First-run orientation is a real need — but
it is onboarding's job (tours, welcome flows), a different surface with
different pacing, not a briefing wearing a costume.

## No news renders nothing

When the derivation runs and finds no deltas above threshold, the
briefing does not render. Not a collapsed version, not an "all quiet"
line, not an empty container holding a heading — *nothing*, with the
surrounding layout designed so that nothing is a natural state rather
than a hole. This is harder than it sounds organizationally: the surface
has an owner, owners want their surface visible, and "all caught up"
cards are how briefing surfaces justify their existence in demos. Resist
with the metric that matters: the briefing's value is measured on the
launches where it *doesn't* appear, because those are what make its
appearances mean something.

The same discipline extends below the briefing to its component parts:
a zero badge is no badge; a "0 new" count is no count. Zero is the
default state of the world, and the default state of the world is not
information.

## Designed silence versus accidental silence

Silence has two causes and only one is acceptable. **Designed silence**:
the anchor existed, the stores were ready, the derivation ran, nothing
cleared threshold. **Accidental silence**: the anchor was missing when it
shouldn't be, a store hadn't loaded when the derivation fired, the
derivation threw and someone swallowed it. Both render identically —
that is the trap, and it is the law
([failure-not-empty-success](../../_laws.md#failure-not-empty-success))
applied to a surface whose success state is *invisible*. A briefing
that breaks silently looks exactly like a peaceful week; nobody files a
bug against an absence.

The obligations:

- The derivation returns a **discriminated outcome** — "quiet" versus
  "could not derive (reason)" — never a bare empty list that conflates
  them.
- Accidental-silence outcomes are counted in telemetry, because no user
  will ever report them.
- The pipeline records its **own liveness**: a persisted last-ran mark,
  advanced every time the derivation completes regardless of outcome. A
  session that showed nothing and a session where the derivation never
  ran must be different observations. The cautionary extreme is real: an
  away-digest engine that sat behind two enable gates — one durable but
  with no writer any user could reach, one writable but never persisted
  — and produced zero output for ninety-nine days while looking, from
  every surface and every table, exactly like a quiet week. If the
  system can be switched on and off, the switch is one durable value
  read at boot; a second gate multiplies the failure modes and the
  product of the two defaults is "off forever, silently."
- The test suite covers the silent path as a first-class behavior:
  first run renders nothing, no-news renders nothing, *and* a
  deliberately-broken derivation is observably different from both.
  A feature whose success is invisible needs its tests more than one
  whose success is on screen.

## Suppression is part of the threshold system

Silence policy also governs *repetition*. A delta already briefed once
does not re-brief on the next launch: the briefing reports the interval
since the anchor, and the anchor advances, so each event gets one shot at
the user's attention. If an item is important enough to persist across
launches until acted on, it has outgrown the briefing and belongs in a
durable surface — a review queue, a task list, a badge that stands until
cleared. The briefing is a newspaper, not a to-do list; conflating them
produces the immortal briefing item, which is the empty-shell problem in
a different coat.

## Decision rules

- Missing anchor = first run = render nothing; initialize the anchor to
  now for next time.
- No deltas above threshold = render nothing; no empty shells, no
  "all caught up" cards, no zero badges.
- Derivation outcomes are discriminated: quiet ≠ failed; failed silence
  is counted somewhere a human looks.
- Persist a last-ran mark; never-ran must be observable. One durable
  enable switch at most, read at boot — never two gates.
- Test the silence: first-run nothing, no-news nothing, broken-derivation
  distinguishable.
- One briefing per delta; anything that must persist until acted on
  graduates to a durable surface.
