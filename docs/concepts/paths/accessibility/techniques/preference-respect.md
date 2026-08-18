---
layer: technique
subject: accessibility
technique: preference-respect
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Preference respect

Users declare operating conditions at the system level — reduce motion,
increase contrast, force a color scheme, scale text — and the platform
hands every application those declarations for free. Reading them is a
one-liner. What separates products is not detection but **coverage**: a
preference is a contract with the whole surface area, and honoring it on
nine screens while the tenth still parallax-scrolls is a broken promise
delivered to precisely the user who cannot absorb the breach. The
vestibular user does not experience "90% reduced motion"; they
experience the one screen that triggered them.

## One signal per preference, every surface derives

The structural rule
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):
each preference is read at **one boundary** and exposed as a single
signal — a token the style layer keys off, a flag the behavior layer
consumes — and every surface *derives* from that signal rather than
re-detecting the platform state ad hoc. Ad-hoc detection is exactly how
the tenth screen gets missed: each hand-written media check is one more
copy of the vocabulary, written by whoever remembered, absent wherever
someone did not. Centralizing also creates the seam this contract needs
for verification: one signal can be forced in tests and in a debug
switch, so "the whole product under reduced motion" is a state a
reviewer can actually enter, instead of a matrix nobody audits. And it
gives the product a place to layer its **own** setting over the
platform's — users who want calm in one application without
reconfiguring their operating system get an in-app override that feeds
the same single signal, so no consumer knows or cares which source won.

The remainder of this technique is the per-preference contract — what
"honored" means for each. The mechanics live with the owning subsystems;
this subject holds the demand.

## Reduced motion: replace, never remove

The contract: **no non-essential motion when the preference is set** —
no parallax, no scale-and-slide entrances, no attention wiggles, no
animated number ticking. Two disciplines make it honest:

- **Feedback is replaced, not removed.** Motion often *carries*
  information — this panel came from the right, this row is new, this
  action landed. Reduced motion means delivering that information
  without the choreography: an instant settle, a static highlight, an
  opacity change. Stripping the animation and the answer together
  punishes the preference, and users learn to stop declaring
  preferences that cost them function.
- **Duration is never load-bearing.** Logic that awaits an animation's
  end (dwell timers derived from entrance choreography, state machines
  advanced by completion callbacks) breaks when the animation is
  reduced to zero — the classic bug family is a flow that hangs only
  for reduced-motion users. Time belongs to the message or the state
  machine; motion decorates it.

How the animation system implements this — token-level zeroing, the
essential-motion carve-out, transition choreography under reduction —
belongs to the motion subject; this contract is what its implementation
is measured against.

## Contrast: a floor with a gate, not a review note

The contrast contract has a number in it — the AA ratios for text and
for interactive/graphical elements — and a floor with a number is a
floor a build can enforce. The leverage point is wherever colors are
*defined*: when the palette lives in a token system, every text-on-
surface pairing the system sanctions can be computed against the floor
mechanically, and a failing pair rejects the change that introduced it —
[token-enforcement](../../design-tokens/techniques/token-enforcement.md)
is the owning ground. Two edges the gate must not miss:

- **States count.** Hover, focus, disabled, selected — contrast
  failures concentrate in state variants, which are designed later and
  dimmer. The focus indicator's own contrast is part of the floor.
- **User-authored color is inside the contract.** Theming systems,
  custom accent pickers, and imported palettes let users and tenants
  define pairings the design team never saw; the floor either applies
  at that door too (validate, clamp, or warn at theme-definition time)
  or the product ships a first-party path below its own minimum.

Beyond the floor sits the *increased*-contrast preference: surfaces
respond by selecting the stronger variant of the palette — again one
signal, again derived, never per-screen improvisation.

## Forced colors: structure must survive the palette

Under forced-color modes the platform discards the product's palette
wholesale and repaints from a small system set. The contract: **meaning
survives the repaint**. Everything communicated *only* by a background
tint, a brand color, or a subtle border vanishes — selected-vs-
unselected states, focus indication, chart series, status dots. Surfaces
honor this by pairing every color-borne meaning with a structural
carrier — an outline, an icon, a text label, a pattern — which is the
same redundancy the color-blind population needed all along. Forced
colors is less a new requirement than an audit that reveals where color
was carrying meaning alone.

## Text scale: reflow, never truncate

Users scale text up to 200% and beyond, via zoom or system type
settings. The contract: content **reflows** — wraps, grows its
container, scrolls in one direction — and never truncates, overlaps, or
clips its own controls. The failure pattern is fixed-height chrome with
font-relative content: at 200% the label outgrows the box and the
ellipsis eats the distinguishing word, or the button's text escapes its
hit area. Layouts honor the contract by sizing containers in
font-relative units where they hold text, reserving fixed pixels for
what is genuinely geometric, and treating "the design at 200%" as a
layout state that exists, not an edge case that will not happen.

## The shared shape

Each preference above has the same anatomy: **one signal, derived
everywhere; information preserved under the constraint; a verifiable
state a gate or reviewer can enter.** New preferences the platforms add
(reduced transparency, reduced data) slot into the same anatomy — read
once, expose as a signal, define what "honored" preserves, and add the
forced state to the verification walk
([a11y-verification](a11y-verification.md)).
