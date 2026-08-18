---
layer: technique
subject: embedded-preview
technique: convention-discovery
status: forged
laws: [derivation-names-recomputation, failure-not-empty-success]
shared_with: []
---

# Convention discovery

The host wants to know the guest's structure — which routes exist, which
pages can be navigated to, what to offer in a route picker — without
being told. The technique: **read the guest's own conventions.** Every
application framework this subject embeds encodes routing in file-system
convention (a routes directory, a pages tree, index files, parameter
segments in special filenames); the guest's file tree *is* the route
manifest, maintained for free by the very mutations the preview exists to
display. Scan it; never hand-maintain a parallel list.

## Why the hand-maintained list always rots

A route list written at generation time is a cached derivation with no
recomputation path — the exact shape
[derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)
forbids. The guest is under *continuous mutation*; that is the premise of
the subject. Every turn can add a page, delete one, or rename a segment,
and a static list is wrong after the first such turn, in the trust-eroding
way: the picker offers a page that 404s, the page just created never
appears, and the user concludes the preview — not the list — is broken.
The file tree cannot rot relative to itself. Deriving from it makes the
route list *definitionally* current as of the last scan, and reduces the
staleness problem to one question — when to rescan — which has a clean
answer below.

## The scanner

- **Scope by convention root.** Scan only the framework's routing
  directory, not the project; the scan stays cheap (tens of files, one
  directory family) and immune to noise elsewhere in the tree.
- **Recognize the convention's grammar, minimally.** Directory nesting →
  path segments; index files → the segment's root; parameterized
  filenames → dynamic segments; the framework's non-route housekeeping
  files (layouts, templates, error surfaces) excluded by name. The
  grammar implemented should be the subset the product needs — a route
  *picker* needs paths and their nature, not the framework's full
  resolution semantics. Resist re-implementing the router.
- **Dynamic segments are surfaced as dynamic**, not silently skipped and
  not offered as dead literal links. A path with a parameter is shown as
  a template; navigation to it either prompts for the parameter, uses a
  placeholder value, or is de-emphasized — a product choice, but an
  explicit one. Skipping them silently misrepresents the guest's shape,
  and in guests where most detail pages are parameterized, hides most of
  the application.
- **Multiple conventions, detected not configured.** Frameworks version
  their conventions (an older pages tree, a newer routes tree; different
  index-file names). The scanner detects which convention the guest uses
  by which root exists, and supports the small set the product's
  generators emit. A guest matching no known convention yields the
  *declared* outcome "no routes discovered — navigate by URL", never an
  empty list presented as "this app has no pages"
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success):
  a scanner that cannot read the guest must not report the guest as
  empty).

## When to rescan

The scan is the named recomputation; running it is cheap; the triggers
are the design decision:

- **after every mutation turn** — the primary trigger. The mutating actor
  (the build loop applying a model's edits) knows exactly when the tree
  changed; rescan on turn completion, before the preview announces the
  turn's result.
- **after checkpoint restore** — a restore rewrites the tree wholesale
  ([preview-checkpoints](preview-checkpoints.md)); the route list must be
  re-derived from the restored tree, not remembered from before.
- **on preview focus/open** — a cheap freshness catch for mutations that
  bypassed the loop (a human editing the project directly).

A file watcher is the high-fidelity alternative and usually overkill: the
mutation sources in this subject are known and countable, and each can
trigger a rescan explicitly. Add the watcher only when the product's own
story includes out-of-band editors as a first-class flow.

## Discovery and navigation meet at the bridge

Discovered routes feed the navigation surface; navigation executes over
the bridge — in-app route change when the instrumentation agent is
present, frame URL assignment when it is not (the fallback ladder of
[injected-instrumentation-with-fallback](injected-instrumentation-with-fallback.md)).
The current-location report flows back the other way (agent announcements,
or frame load events on the coarse rung), and the picker highlights where
the user *is*, not just where they may go. The route list, the current
route, and the frame URL are three views of one fact; the discovered scan
plus the bridge's announcements keep them from being three separately
maintained opinions.
