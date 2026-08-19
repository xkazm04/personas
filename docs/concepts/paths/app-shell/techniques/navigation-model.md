---
layer: technique
subject: app-shell
technique: navigation-model
status: forged
laws: [one-authority-per-vocabulary, identity-survives-reuse]
shared_with: []
---

# Navigation model

The user's location in the product is state. This technique is about giving
that state one owner, one shape, and one direction of flow — everything else
in the shell (highlights, sub-navs, titles, preloading) becomes a pure
derivation from it.

## The section vocabulary is closed and owned

The top-level destinations form a closed vocabulary: a finite set of section
identities, defined once, in one registry that also carries each section's
metadata — label, icon, ordering, entitlement requirement, sub-destinations.
Every consumer derives from that registry: the nav renders by iterating it,
the router validates against it, the palette searches it, preloading keys off
it ([law: one authority per vocabulary](../../_laws.md#one-authority-per-vocabulary)).

The anti-pattern is the same vocabulary spelled twice: a nav component with a
hand-written list of entries *and* a route table with a parallel list of
paths. They drift the day someone adds a section and finds only one of them —
the entry with no route, or the route with no entry, is the canonical symptom.

Section identities are stable ids, not display labels and not positions.
Renaming a section, reordering the nav, or localizing labels must not change
what any persisted or linked location means
([law: identity survives reuse](../../_laws.md#identity-survives-reuse)).

Two extensions of the vocabulary rule, both learned from where it is
classically abandoned:

- **The discipline covers every level the shell can name, not just the top.**
  Sub-destinations — the tabs inside a section that a navigate call can
  target — are destinations too. A registry that governs the dozen top-level
  sections while dozens of sub-destination vocabularies stay hand-maintained
  has not solved the drift problem; it has gold-plated the smallest slice of
  it. Measure the registry's coverage of the *whole* destination space, and
  treat an unregistered sub-vocabulary as debt with the same failure modes.
- **Reachability is registry metadata.** Not every destination sits in the
  rail: some are nested under another section's sub-nav, some are summoned
  as overlays, some are retired ids kept only so old persisted locations
  still parse. Declaring *how* each destination is reached, in the registry,
  is what lets the rail, the router, the command surface, and the history
  engine each derive their own subset without inventing private lists.

## One current location, everything else derived

The model holds one value: the current location — a section id, plus whatever
sub-location the section defines. All presentation is computed from it:

- **Active state is a derivation, never a stored flag.** `isActive(entry) =
  entry.id === location.section`. The moment each entry stores its own
  active boolean, the invariant "exactly one active" becomes a protocol that
  every navigation site must remember to run — and the double-highlight bug
  is one forgotten site away.
- **Parent activation is a containment query.** When the user is at a
  sub-destination, the parent section is active *because it contains the
  location*, not because someone also set a second flag. Ancestry is derived
  from the registry's structure.
- **Titles, breadcrumbs, and context chrome** derive from the same value
  through the same registry. If the title bar and the nav highlight can
  disagree, there are two models.

Writes go through one door: a single navigate operation that validates the
target against the vocabulary, applies entitlement policy, records history,
and updates the one value. Scattered "set current tab" writes are how
half-transitions ship — highlight moved, content did not.

## Addressability: every stable destination has an address

If the product has any notion of links, sharing, or "open X" from outside a
page — a notification, a palette, a tour step — then locations must be
serializable and re-enterable:

- **Deep links resolve through the same door.** An address arriving from
  outside (link, notification tap, restored session) is parsed, validated
  against the vocabulary, checked against entitlements, and *then* becomes
  the location. An unrecognized or forbidden address degrades to a defined
  fallback — the section's root, or the home section — never a blank
  viewport or a crash. Addresses outlive releases; the parser must treat
  yesterday's vocabulary as input, not as an assertion.
- **The address encodes the location, not the journey.** What restores a
  destination is the location value; transient UI (an open panel, a scroll
  offset) rides along only where the product deliberately promises it.

## History and the back gesture

The back gesture is a promise: it returns the user to where they were. The
model keeps a navigation history of location values, and defines — per
transition class — what is *history-worthy*:

- Section-to-section moves push history.
- Replacing a location with its corrected self (a redirect, a default
  sub-destination filling in) replaces, not pushes — otherwise back bounces
  off the redirect forever, the classic trap.
- Intra-page state changes (a filter, a sort) are the page's business unless
  the product promises addressable filters.

## Restoring the user's session

A returning user resumes, not restarts. Two scopes, both explicit:

- **Last location per session**: on relaunch, the shell restores the last
  section (validated against today's vocabulary and entitlements — a
  persisted location pointing at a removed or forbidden section falls back
  gracefully, it does not wedge the shell).
- **Last sub-location per section**: returning to a section the user visited
  earlier in the session lands where they left it, not at the section root.
  This is the navigation-level twin of keeping page state alive across
  visits; the model owns *where*, the section owns *what was there*.

Persisted locations are data crossing a trust boundary from a previous
version of the product; the restore path validates as strictly as the deep
link path — they should in fact *be* the same path.

## The prohibitions, collected

1. No consumer keeps its own copy of "which section is active".
2. No navigation write bypasses the single navigate door.
3. Positions and labels are never used as identities.
4. A deep link or restored location is never trusted without validation
   against the current vocabulary and policy.
5. A redirect never pushes history.
6. Removing a section from the vocabulary always includes a fallback for
   addresses and persisted locations that still name it.
