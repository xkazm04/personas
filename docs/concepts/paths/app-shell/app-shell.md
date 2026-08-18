---
layer: golden-path
subject: app-shell
status: forged
techniques:
  - navigation-model
  - nav-hierarchy
  - entitlement-gating
  - badge-and-attention
  - shell-hosted-services
  - lazy-section-loading
evidence:
  - src/lib/navigation/registry.ts                          # the single-authority nav registry: closed vocabulary, gates, reachability, compile-time exhaustiveness
  - src/features/shared/chrome/sidebar/Sidebar.tsx          # two-level nav, collapse persistence, per-section scroll memory, tier redirect
  - src/features/shared/chrome/BackgroundServices.tsx       # the one enumerable host for always-mounted background workers
counter_evidence:
  - src/lib/types/types.ts   # ~23 sub-destination tab unions the registry does not govern — the vocabulary discipline stops at level 1
deviations:
  - w3-app-shell   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# App shell & navigation

The shell is the persistent frame around every page: the primary navigation,
the window or title chrome, the status surfaces, and the viewport the pages
render into. Two properties define it, and everything in this standard follows
from them:

- **The shell never unmounts.** Pages come and go on every navigation; the
  shell survives all of them. That makes it the only legitimate home for
  anything whose lifetime is *the session* rather than *a page* — live
  connections, event subscriptions, notification surfaces, command palettes,
  guided tours, background tickers. Conversely, anything mounted in the shell
  is paid for on every screen, forever: the shell's permanence is a privilege
  that must be earned per occupant.
- **The navigation is the product's map.** The nav is where a user learns what
  the product *is* — its top level is an argument about the product's shape,
  read hundreds of times a day. Its structure, depth, ordering, and gating are
  product decisions that deserve an owned model, not an accretion of booleans.

The failure modes of shells are correspondingly split. Structural failures —
chrome that flickers or remounts on navigation, scroll position and in-flight
state lost when the user glances at another section — come from breaking the
first property. Cartographic failures — a nav that no longer matches the
product, active states computed three different ways, entries that appear and
vanish depending on which page you came from — come from breaking the second.

## The shell owns the location; the location is one value

At any moment the application is *somewhere*: a current section, possibly a
current sub-section, possibly a current entity within it. That location exists
whether or not the code models it — the only choice is whether it is one owned
value that everything derives from, or a constellation of `is-active` booleans
and string comparisons that must be kept in agreement by hand.

The standard is a single navigation model: a closed vocabulary of section
identities, one current-location value, and every downstream concern — which
nav entry is highlighted, which sub-nav renders, which title shows, which
resources preload — expressed as a *derivation* from that value. The classic
defects (two entries highlighted at once, a highlighted entry for a page that
is no longer visible, back-navigation that the nav does not reflect) are all
the same root cause: location state duplicated instead of derived. The full
contract, including deep links, history behavior, and restoring the user's
last location, is the [navigation-model](techniques/navigation-model.md)
technique.

## Depth is earned, level by level

A navigation hierarchy has a natural budget. One level is the default: a flat
list of sections is scannable, learnable, and honest. A second level earns its
place only when sections have genuine internal geography — distinct
destinations a user moves *between* while staying in the section, not merely
content that happens to be long. And the second level belongs to its section:
it appears in the section's context, scoped and subordinate, never as a global
second column of everything. A third level in the nav is almost always a page
structure leaking upward; beyond two levels, the *page* owns the depth (tabs,
trees, master-detail), not the shell.

The same technique owns the shell's spatial economics: the collapsed/expanded
posture of the primary nav, what survives collapse (icons and badges do,
labels do not), and the rule that posture is the *user's* setting —
persisted, restored, never silently reset by a release or a route. See
[nav-hierarchy](techniques/nav-hierarchy.md).

## The nav is a policy surface

Not every user sees the same map. Tiers, feature flags, roles, and platform
capabilities all decide what the nav offers — which makes the nav a policy
*rendering* surface, and demands the distinction the policy already implies:

- **Hidden** — the feature does not exist for this user and knowing about it
  serves no one. Internal tooling, platform-inapplicable sections.
- **Visible but locked** — the feature exists, this user's plan does not
  include it, and the product *wants* them to know. The locked state is an
  honest upsell affordance, not a broken link.
- **Visible and enabled** — the ordinary case.

The gate that decides this must be the same gate that guards the destination:
a nav entry hidden by one check while the route is reachable by another (a
deep link, a command palette, a stale bookmark) is a policy with a hole in it.
The visibility/lock/upsell contract and the single-authority rule live in
[entitlement-gating](techniques/entitlement-gating.md).

## The nav carries attention, sparingly

Because the nav is always on screen, it is the natural place to route
attention: unread counts, pending approvals, failures in a section the user is
not looking at. It is also the easiest surface to devalue — a nav where every
entry glows is a nav where nothing does. Badges are counts with predicates and
lifecycles: each one states what it counts, when it appears, and — the part
that is always forgotten — what makes it go away. The discipline is the
[badge-and-attention](techniques/badge-and-attention.md) technique.

## The shell is a host, and hosting is a discipline

The never-unmounts property makes the shell the mount point for the product's
session-scoped machinery: the notification outlet, the command palette, the
tour engine, connection managers, schedulers, telemetry flushers. Hosting them
is not free composition; it is a discipline with rules — one instance per
service, an explicit mount order when services depend on each other, an
explicit teardown story for the few things that do end (sign-out, workspace
switch), and a bright line between services the shell *hosts* and page
concerns that merely wish they were global. The contract is
[shell-hosted-services](techniques/shell-hosted-services.md).

## The shell paints first and never waits

The shell has no loading state of its own. It is assembled from local
knowledge — the section vocabulary, the user's persisted posture — and paints
immediately and completely; a shell that skeletons its own nav tells the user
the *application* is absent rather than the *data*. Pages are the opposite:
they are loaded lazily, section by section, so the first paint is not taxed
with the whole product. Between those two postures sits a contract — the
shell's frame holds still while the section's content arrives under it, cold
loads show a calm placeholder inside the viewport (never a blank frame, never
a dead click), likely-next sections are warmed on intent, and a section the
user returns to paints warm rather than re-loading. That contract is the
[lazy-section-loading](techniques/lazy-section-loading.md) technique.

## Accessibility posture

The shell is the one surface every user of every page must pass through, so
its accessibility failures are multiplied by every screen:

- **Landmarks are real.** The primary nav, the main content region, and the
  status chrome are distinct labeled landmarks, so assistive-technology users
  can jump between them rather than crawl the whole frame.
- **A skip link exists.** The nav renders before the content in every
  traversal order; keyboard users get a first-tab affordance that jumps past
  it. A shell without one charges a per-page toll of a dozen tab presses.
- **The current location is stated, not just painted.** The active nav entry
  carries the current-page semantic, not only a highlight color.
- **Navigation moves focus.** Activating a nav entry moves focus (or an
  announcement) into the new content; a silent viewport swap strands
  non-visual users in a nav that claims nothing happened.
- **Collapsed does not mean inaccessible.** An icon-only nav still exposes
  full names to assistive technology and keyboard users, and badges still
  carry their meaning as text, not only as a colored dot.

## The techniques

- [navigation-model](techniques/navigation-model.md) — location as one owned
  value: the section vocabulary, active-state derivation, deep links, history
  and back behavior, restoring last location.
- [nav-hierarchy](techniques/nav-hierarchy.md) — when a second level earns its
  place; section-scoped sub-navs; collapse posture, what survives it, and its
  persistence.
- [entitlement-gating](techniques/entitlement-gating.md) — hidden vs locked vs
  enabled; the upsell affordance; one policy authority gating both the entry
  and the destination.
- [badge-and-attention](techniques/badge-and-attention.md) — badges as counts
  with predicates and lifecycles; attention routing without devaluation.
- [shell-hosted-services](techniques/shell-hosted-services.md) — the
  always-mounted service host: single instances, mount order, teardown, and
  the admission test for shell residency.
- [lazy-section-loading](techniques/lazy-section-loading.md) — per-section
  code splitting, the placeholder contract, prefetch on intent, warm
  remounts, and chunk-failure honesty.
