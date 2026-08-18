---
layer: technique
subject: async-ui-states
technique: placeholder-design
status: forged
laws: []
shared_with: []
---

# Placeholder design

A placeholder — a ghost, a skeleton — is the rendering of the `loading` state:
what a surface shows while its first data is in flight and nothing is held.
Its job is narrow and easy to state: **promise the shape of what is coming,
and hold the layout still so arrival moves nothing.** Every design rule below
falls out of that job description; every placeholder defect is a way of
failing it.

## Geometry-matched, under the chrome

- **The placeholder describes only the content region.** Chrome — titles,
  toolbars, headers, footers — renders real and permanent above, beside, and
  below it. A full-surface skeleton that ghosts the chrome too is the "if
  loading, return placeholder" branch at the wrong altitude: it tells the user
  the *surface* is absent when only the *data* is.
- **Match the real geometry.** Blocks at the real item height, in roughly the
  real layout — the same number of columns, the same regions — so that when
  content lands it replaces the ghost in place and nothing reflows. Layout
  shift on arrival is the placeholder failing its second duty; if the ghost
  and the content disagree about geometry, the ghost is decoration, not a
  promise.
- **Vary the ghost deterministically.** Identical stripes read as a barcode;
  bars of deterministically varied widths across items and fields read as
  rows of data. Deterministic (seeded by position) rather than random, so the
  ghost does not shimmer with churn on every render.
- **Low contrast, calm motion or none.** The placeholder is background — a
  quiet neutral tone, with at most a slow shimmer or gentle pulse. It must be
  boring; anything eye-catching turns a wait into a performance. Reduced-motion
  preferences drop the animation entirely — a static ghost is fully adequate.

## The appearance delay — and where the delay lives

Delay the placeholder's appearance (on the order of 100–300ms). This single
rule does more for perceived quality than any visual polish:

- Responses that arrive inside the delay render **no loading state at all** —
  the region goes straight from blank-for-imperceptible-milliseconds to
  content. Warm caches, local stores, and fast paths never flash.
- Without the delay, every warm load shows a ghost for one or two frames.
  Sub-100ms flashes read as flicker — the user perceives instability, not
  responsiveness, and the product feels *slower* because something visibly
  churned.

**The delay lives on the placeholder, never on the content.** The moment data
exists it renders: no minimum placeholder display duration, no exit animation
gating the swap, no wait-for-both choreography. A minimum-display rule looks
like flicker prevention but converts the placeholder from wait-mitigation
into a wait of its own — the user watches a ghost perform over data that has
already arrived. The honest fix for the mid-window flash sits on the ghost's
side: give the placeholder a *gradual entrance* beginning after the delay
window, so a response landing just past the threshold interrupts a faint,
half-faded ghost rather than snapping a fully painted one away. Placeholder
to content is then a plain conditional swap in identical geometry, calm at
every arrival time.

One implementation trap follows directly: when the delay window rides on the
entrance animation itself, disabling animation — a reduced-motion preference,
a low-power mode — must not disable the window. Otherwise the users who asked
for *less* motion get *more* flashing, because the ghost now paints on the
first frame. Whatever mechanism grants the invisibility window must survive
every motion-off path; verify it under the preference, not just without it.

## Placeholders never cover data

The ghost renders in exactly one state: first load, nothing held. Once
content has ever been shown, a refresh renders as the existing content with
an ambient indicator — never as a ghost replacing it. This is the surface's
honesty rule, but it lands here as a design constraint: the placeholder
system must be structurally unable to render over held content, not merely
discouraged from it. Placeholders keyed off "is any request in flight" —
instead of "in flight *and nothing held*" — are the way this rule gets broken
by accident.

## Code arrival is the same wait

When a region's own implementation loads lazily, the user experiences the
identical gap — a hole where a surface should be — and the same rules apply:
a delayed placeholder, invisible on warm loads, holding the layout still. A
blank hole says the product is broken; a centered spinner says the product is
generic.

The lazy boundary adds one constraint of its own: **only promise geometry you
actually know.** The fallback often cannot know which surface is coming, so
it ghosts only the chrome every incoming variant shares at the same position
— typically the header band — and nothing below it. Faking a body silhouette
the incoming surface will not have produces exactly the swap-blink the ghost
exists to prevent; a placeholder that lies about geometry is worse than one
that promises less.

## What a placeholder is not

- **Not a spinner.** A spinner carries no shape information, recenters the
  layout twice, and answers a different question ("did my press register") —
  it belongs on activated controls, per
  [action-busy-states](action-busy-states.md).
- **Not a progress bar.** Progress implies known duration and quantifiable
  advance; a data fetch has neither. Fake progress that crawls to 90% and
  stalls is a small lie with a long memory.
- **Not for values that can animate into place.** A number that can count up
  from zero to its final value needs no ghost — the count-up *is* the
  reveal, and it starts the moment data exists. Never ghost what arrival
  itself can animate.
- **Not content.** The ghost is presentation only: hidden from the
  accessibility tree, never focusable, never announced item by item. The
  *region's* loading state is what assistive technology hears — once, on the
  region, not per fake row.
