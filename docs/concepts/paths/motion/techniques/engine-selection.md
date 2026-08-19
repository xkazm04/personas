---
layer: technique
subject: motion
technique: engine-selection
status: forged
laws: []
shared_with: []
---

# Engine selection

Every gesture in the vocabulary runs on one of three engines: the style
layer's **declarative keyframes**, a **scripted frame loop** you own, or an
**animation library** someone else owns. Teams usually compare them on
expressiveness. The comparison that decides architectures is different:
**who owns the gesture, what can turn it off, and what happens when it is
interrupted.**

## The ownership question

For every preset, the system must be able to answer: *what runs this, and
what can disable it?* The three engines answer very differently.

**Declarative keyframes** are owned by the platform. Nothing in application
code can globally disable them short of an explicit universal style rule —
which is grep-visible, reviewable, and yours. They run off the main thread
for compositor-friendly properties, cost nothing when idle, and survive
scripting stalls. Their limits: interruption is crude (a keyframe animation
cannot be smoothly retargeted mid-flight; restarting it snaps), and they
cannot react to values computed per frame.

**A scripted frame loop you own** is owned by you, entirely. Every line
between the clock tick and the style write is in your tree; there is no
upstream default to change under you. It buys real interruption — springs
retarget from current position *and velocity*, so a gesture redirected
mid-flight bends instead of snapping — at the price that every performance
mistake is now available to you (see
[performance-discipline](performance-discipline.md)) and the engine is code
you maintain.

**An animation library** trades ownership for expressiveness. The hazard
worth naming is not bundle size; it is **global configuration as a silent
kill switch**. Motion libraries commonly expose a provider- or context-level
setting that reduces or disables animation for an entire subtree —
genuinely useful, and precisely the risk: one ancestor, one changed default
in an upgrade, one well-meaning "reduce motion here" wrapper, and every
reveal beneath it stops playing. Nothing errors. Nothing logs. Entrances
simply never happen, and the absence is discovered by a person, not a test
— animation presence is the kind of thing almost no suite asserts. A
library-run vocabulary must treat that switch as part of its threat model:
know it exists, know every place it is set, and decide deliberately whether
any code outside the motion system may touch it.

The scoping of such switches cuts both ways. Every global switch —
library-level, stylesheet-level — governs only its own engine: the
library's reduce setting does not touch platform keyframes, and a
universal stylesheet reset does not reach scripted frame writes. That
asymmetry is a coverage gap when you forget it and an escape hatch when
you need it: a gesture that must survive an aggressive global switch can
be moved to the engine the switch cannot see. Using the hatch is
legitimate — *provided the move is documented at the preset*, with its own
reduction story intact, or the escape quietly becomes an accessibility
hole (the coverage discipline is
[reduced-motion-mechanics](reduced-motion-mechanics.md)).

## The interruption story

Interruption is the sharpest *behavioral* difference and worth choosing on:

- A user closes a panel that is still opening. Keyframes: the close either
  waits or snaps. A spring: the panel reverses from exactly where it is, at
  the velocity it had, and the interruption reads as physical.
- A value being animated changes again mid-animation. Declarative
  transitions handle simple retargets acceptably; anything choreographed
  needs script.

The honest rule: **interruption-heavy, user-steered motion earns a scripted
engine; fire-and-forget gestures do not.** An entrance, a success settle, a
one-shot reveal is born, plays, and dies — nothing retargets it. Spending a
scripted spring on a gesture that is never interrupted buys nothing and
costs main-thread frames.

## A default worth defending

A defensible allocation for a product-sized vocabulary:

- **Presets run on declarative keyframes** — fire-and-forget by nature,
  platform-owned, immune to any library's global switch, and off-thread for
  free. The vocabulary's availability then depends on nothing installable.
- **One shared scripted engine** exists for the genuinely continuous cases:
  physics-feeling drags, retargetable springs, values that must be computed
  per frame. One engine, not one per component.
- **A full animation library is adopted only when** the scripted needs
  outgrow what a small owned engine can carry — and its global switches are
  then inventoried and fenced on day one.

Mixed engines are fine; *unknown* ownership is not. The failure mode this
technique exists to prevent is discovering, in production, that your motion
vocabulary had an off switch you never installed and someone flipped it.
