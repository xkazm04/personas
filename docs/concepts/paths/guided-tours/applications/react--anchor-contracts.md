---
layer: application
subject: guided-tours
technique: anchor-contracts
stack: react
---

# Anchor contracts — React/Tauri implementation (Personas guided tours)

How this repo implements the [anchor-contracts](../techniques/anchor-contracts.md)
technique, including the place where it currently violates its own "one
extractor" rule.

## Stable identifiers and the validation door

Tour anchors are `data-testid` attributes — the same identifiers the test
suite keeps honest, exactly the "reuse the vocabulary a machine already
maintains" move the technique prescribes. A step declares
`highlightTestId: "settings-appearance-panel"` in its `TourStepDef`
(`src/stores/slices/system/tourSlice.ts:203-233`), and `TourSpotlight`
resolves `[data-testid="${id}"]` at runtime.

The syntax door sits at the slice, not at call sites:
`TOUR_TEST_ID_PATTERN = /^[a-zA-Z0-9_-]+$/` with `isSafeTourTestId()`
(`tourSlice.ts:189-194`). The comment explains the stakes precisely: an id
containing a quote or bracket would throw `SyntaxError` inside
`document.querySelector` and "kill the spotlight effect for the rest of the
session" — so the trust boundary lives at the setter.

## Geometry as a live derivation

`TourSpotlight.tsx` pins the derivation contract in its header comment
(2026-04-20): follow exactly one node; re-measure on scroll, resize, and
mutations of an *ancestor of the target* (not `document.body` — measured CPU
wins during onboarding); and on missing target, flag `tourHighlightMissing`
instead of dismissing the tour. The measuring core is extracted into the
shared `useTrackedElementRect` hook (also used by Athena's non-dimming
`TrackedGlowRing`), so the spotlight component owns only the dimming visual.
The overlay itself is `pointer-events-none` (`TourSpotlight.tsx:75`) — an
absent cut-out can never trap input, which is the never-strand invariant
implemented structurally rather than by policy.

## The manifest, generated twice into lock-step artifacts

`scripts/docs/gen-tour-anchors.mjs` scans the source tree for anchor
literals (verbatim `data-testid="x"` forms plus dynamic template *prefixes*
like `` `agent-${id}` ``) and the navigation vocabulary the tour driver
understands, then emits two artifacts in one run:

1. `src/features/onboarding/anchors/tourAnchorManifest.json` — imported by
   `dynamicTours.ts`, whose `isKnownAnchor()` (`dynamicTours.ts:43-48`)
   rejects any Athena-composed step naming an unknown anchor *before it is
   persisted*; an unknown route rejects the whole tour.
2. `src-tauri/src/companion/generated_tour_anchors.rs` — the backend
   allow-list `compose_tour` output is validated against, so a tampered
   payload or stale row never drives the spotlight. The sibling
   `generated_anchors.rs` (12 guidance anchors for `point_at`) is the same
   pattern for the lighter walkthrough surface, mirrored from
   `anchorCatalog.ts` with a "DO NOT EDIT / re-run" header.

Output is deterministic (sorted, no timestamps) so regeneration diffs
cleanly — the generated-never-edited property the technique demands.

The drift gate for *hand-written* tours is
`src/stores/slices/system/__tests__/tourAnchors.test.ts`: every
`highlightTestId` in the static registry must exist somewhere in source.

## Where the repo violates its own contract: two extractors

The technique's "one extractor, however many consumers" clause is violated
today, and the legacy composition measured it: `tourAnchors.test.ts` is a
substring scan over the whole tree, while `gen-tour-anchors.mjs` matches
anchors only in *attribute position* with six regexes. Anchors declared as
values in a `const` map (`src/features/plugins/obsidian-brain/ObsidianBrainPage.tsx`)
render fine, pass the drift test — and are absent from the manifest, so
`isKnownAnchor()` forbids Athena-composed tours from naming six anchors the
hand-written Obsidian Brain tour uses freely. Nothing reports the
disagreement between the two gates. This is the golden path's registered
counter-evidence: two authorities over one vocabulary, disagreeing exactly
where the declaration grammar is unusual.
