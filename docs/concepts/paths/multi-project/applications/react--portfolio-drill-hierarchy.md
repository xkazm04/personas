---
layer: application
subject: multi-project
technique: portfolio-drill-hierarchy
stack: react
---

# React — the passport wall and the Factory drill

The reference implementation of
[portfolio-drill-hierarchy](../techniques/portfolio-drill-hierarchy.md)
(with [cross-project-comparison](../techniques/cross-project-comparison.md)
and [project-identity-and-joins](../techniques/project-identity-and-joins.md)
visible on the same surfaces) is the Teams Factory area:
`src/features/teams/sub_factory/`.

## The levels, named in a header comment

`FactoryPage.tsx` declares the tower explicitly: "L1 Projects (score cards) →
L2 context × KPI matrix (sparkline cells) → L3 KPI table → L4 KpiConsole.
Traffic-light colour; keyed transitions; Back steps up one level." Each level
states its question — exactly the technique's demand that a drill's levels be
nameable — and the deeper levels (L3 table, L4 console) are the "record
console" floors the technique allows as long as they keep their budget.

## L1 with two lenses — covers and the compare matrix

`passport/ProjectsPassportWall.tsx` is the wall, and it implements the
"two presentations, one level" pattern verbatim:

- **Overview (default)** — `WallOverviewGrid`: one passport *cover* per
  project, the triage face (favicon/status dot, headline scores, a blockers
  digest, a minimized roadmap strip).
- **Compare** — `WallCompareTable`: the row-aligned projects × dimensions
  matrix with the improve machinery hanging off each cell.
- The two views share `columns` (one sorted array of `AppPassport`), and the
  covers carry framer-motion `layoutId`s so "switching views RECOMPOSES the
  wall: each cover morphs between its grid tile and its table column"
  (header comment) — the operator never loses the card↔column mapping,
  which is the technique's closing requirement for dual-lens walls.

Sorting is triage-shaped: `'automation'` ("weakest automation first —
surfaces the agents-can't-help-here projects"), `'production'`, and `'gap'` —
biggest divergence between the two composite axes first, the header calls it
"the passport's headline view" (`ProjectsPassportWall.tsx:98-103`). That is
the axis-divergence ranking from
[cross-project-comparison](../techniques/cross-project-comparison.md),
shipped as a first-class sort tab.

## The wall reads summary rows, joined by id

The wall's inputs are pre-digested maps, all keyed by project id (the
passport's `identity.slug` *is* `meta.project_id`): `attentionByProject`,
`headerStats` ("computed by the host; the cover renders 0/dim placeholders
when absent"), `faviconBySlug`, `roadmapBySlug`. The wall never fans out to
per-project detail fetches; N projects cost N summary rows. The derivations
behind those rows live in `passport/passportDerive.ts`, whose header states
the honesty contract: "Where there is NO signal the passport shows an
explicit gap (null / 'none'), never an invented value — that honesty is the
whole point of the comparison." Probe fields are optional by design — "an
older backend yields 'no signal', never an invented level"
(`passportDerive.ts:170`) — the technique's level-parity rule (absent ≠
zero) applied at the derivation layer, before display can launder it.

## The id-join doctrine, one floor down

The same discipline holds where the drill reaches L2/L3:
`l2/ship/shipDerive.ts` opens with the subject's sharpest field lesson —
"The footprint resolves by context ID, never by display name. Names in the
auto-generated context map are near-identical by construction
('teams/factory [1/3]', '[2/3]') and every rescan can rename a context, so a
name-keyed join silently drops contexts out of the footprint… a milestone
could read GO because a context quietly vanished from its own scope." The
fix is the technique's prescribed shape: one `Map(id → context)`, one
`inContext()` helper "used by both surfaces, keeps that fixed in one place"
— after the library tree and the context drawer had each independently
shipped the name-join bug.

## Deviations visible from here

- `passportDerive.ts` composites are **fixed-anchor** (score → band
  thresholds), while the sibling leaderboard
  (`src/features/overview/sub_leaderboard/libs/leaderboardScoring.ts`)
  is cohort-relative — a per-dimension anchor choice, correctly made, but
  the anchor policy is not rendered next to the traveling scores the way
  the technique demands; a reader of the wall cannot tell which cells
  re-rank with the fleet and which hold still.
- `FactoryPage` and the passport wall are two L1s over the same project
  population (KPI-flavored and readiness-flavored). Both drill correctly,
  but the sibling-switcher ("next project, hold the view") exists via
  `FactoryBreadcrumb` on the Factory tower only; the wall's L2 modals
  (`ImprovePlanPanel`, per-slug) close back to L1 instead of switching
  laterally.
