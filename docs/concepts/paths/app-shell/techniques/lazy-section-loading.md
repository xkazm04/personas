---
layer: technique
subject: app-shell
technique: lazy-section-loading
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Lazy section loading

The shell paints instantly; the product loads section by section. This
technique owns the split — what ships with the frame and what arrives on
demand — plus the three disciplines that make lazy loading invisible when it
works: the placeholder contract, prefetch on intent, and warm return.

## The split: frame eager, sections lazy

The first paint carries the shell and only the shell: the frame, the nav
(built from the local section vocabulary), the user's persisted posture, and
the currently requested section's code. Every other section — its code, its
translations or other locale assets, its heavy libraries — is a separately
loadable unit, fetched when the user (or the prefetcher) asks.

The boundary follows the navigation vocabulary: one loadable unit per
section, split at the section's root. Splitting deeper than the shell can
name creates waterfalls (a section that itself lazily assembles from five
sub-units arrives in five staggered pieces); splitting shallower re-couples
sections so that touching one re-ships the others. One section, one unit,
and the unit includes what the section needs to *render meaningfully* —
code that arrives without its strings or styles paints a broken surface on
time.

Shared heavyweight dependencies used by several sections are their own
units, loaded on the first section that needs them and reused thereafter —
not duplicated into every section, and not promoted into the eager frame
because deduplication was inconvenient.

## The placeholder contract

Between "user chose a section" and "section's code is running", something
occupies the viewport. The contract:

- **The frame never participates.** Nav, chrome, and posture hold still;
  only the content viewport is in transition. A load that blanks or shifts
  the frame reads as the application failing, not the content arriving.
- **The placeholder is the section's shape**, at low fidelity: the stable
  chrome the section will have (a header region, a toolbar line), in calm
  neutral tones — promising the geometry of what is coming and holding
  layout still so arrival replaces rather than rearranges.
- **Delayed appearance.** Warm and near-warm loads settle in tens of
  milliseconds; the placeholder renders only after a short delay (on the
  order of 150–300ms), so the common case shows *nothing* between click
  and content. Without the delay every warm navigation flashes a skeleton
  — motion that communicates only that loading exists.
- **Never a dead frame.** During the transition the nav remains live: the
  user who mis-clicked can immediately choose elsewhere, and the
  in-flight load is superseded, not queued behind.

This contract is the shell-level instance of the product's general async
posture — chrome first, geometry-matched placeholder under it, delay for
warm paths — applied to code arrival rather than data arrival. The two
compose on cold entry: section code arrives (this technique), then the
section's data arrives (the section's own loading states). The user should
experience that as one continuous settle, not two stacked skeletons of
different shapes; aligning the code placeholder's geometry with the
section's own loading chrome is what fuses them.

## Prefetch on intent

The gap between "will choose" and "chose" is free loading time. Ordered by
signal strength:

- **Expressed intent**: pointer hovering or focus resting on a nav entry —
  begin fetching that section's unit immediately; a click a few hundred
  milliseconds later finds it warm or nearly so.
- **Predicted intent**: the restored last location's neighbors, the
  product's most-entered sections, the section a live notification points
  at.
- **Idle warm-up**: after the current section is interactive and the
  network is quiet, warm remaining sections in priority order.

Prefetch is polite by construction: it never competes with the current
section's own loading, respects constrained or metered conditions where the
platform exposes them, and is idempotent — hover, unhover, hover again is
one fetch, not three. Prefetch failures are silent (the click path will
retry properly); click-path failures are not.

## Warm return

Re-entering a section the user already visited must not cost a reload:

- **Code stays warm for the session.** A loaded unit is never re-fetched.
- **The section's last surface state survives** per the navigation model's
  restore promise: returning lands where the user left, painted from
  session-held state — a remount that re-runs cold-load choreography
  (placeholders, entrance animation, refetches) on every return makes
  navigation feel like teardown. Data may revalidate quietly on return;
  quiet revalidation never wears the cold-load costume.
- The seen-it choreography rule follows: entrance animation and
  placeholders belong to *first* arrival in a session, not to every visit.

## Failure: a chunk that cannot load is a failure, not a blank

Lazy units load over real networks from real deployments, and both fail:
offline moments, evicted caches, and the classic post-deploy case — a
client holding yesterday's unit names asking a server that only serves
today's. The click path handles all of them honestly
([law: failure is not empty success](../../_laws.md#failure-not-empty-success)):

- **Retry once or twice automatically** — transient network blips are the
  bulk of failures and self-heal.
- **Then say so, in the viewport**: the section could not load, with a
  retry affordance. The frame and nav stay alive; the failure occupies
  only the territory the section would have. A blank viewport or a
  dead-silent error boundary tells the user the product broke with no
  path forward.
- **The version-skew case names its cure**: when the failure pattern says
  the deployment moved on (the unit's address is simply gone), the honest
  remedy is a refresh/relaunch offer, not infinite retry into a permanent
  404 — and the failed-unit record must not poison the session so that
  even a successful refresh keeps replaying the failure from cache.

## The prohibitions, collected

1. Nothing ships in the eager frame that only one section needs.
2. No load transition ever blanks or shifts the shell's frame.
3. No placeholder without the warm-path delay.
4. No prefetch that competes with the click path or repeats per hover.
5. No cold-load choreography on warm return.
6. No chunk failure rendered as blank; retry, then a stated failure with a
   cure — and version skew offers refresh, not eternal retry.
