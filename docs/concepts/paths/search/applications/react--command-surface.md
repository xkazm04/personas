---
layer: application
subject: search
technique: command-surface
stack: react
---

# The global command palette

The repo's command surface is `src/features/shared/chrome/CommandPalette.tsx`
over the pure, React-free model in
`src/features/shared/chrome/commandPaletteUtils.ts`. The split itself is
craft: matching, scoring, item building, and the recency ledger are all plain
functions with no store or component dependency, which is what makes the
palette's reachability contract unit-testable (the file says so at `:20-22`).

## One registry

`reachablePaletteSections` (`commandPaletteUtils.ts:23-25`) derives the
palette's navigation corpus from `NAV_SECTIONS` — the same single nav
registry the sidebar renders from — filtered through the same `passesGates`
(tier + dev gates) the rest of the shell uses. The palette cannot drift from
the real navigation set because it does not own a copy of it: the standard's
one-registry rule, satisfied by derivation. Settings entries reuse one
builder (`settingEntry`, `:83-96`) so every domain's rows stay uniform, and
each item carries a stable, kind-prefixed identity (`agent:${id}`,
`setting:${id}`, `cmd:run:${id}` — `:86`, `:163`, `:243`) minted from the
entity's own id, never from list position.

## Banded fuzzy scoring with field weights

`fuzzyScore` (`commandPaletteUtils.ts:124-137`) is the coarse banded scheme
the technique names as the legitimate simplification: exact = 100, prefix =
90, substring = 80, then subsequence with a gap penalty
(`max(10, 70 - gaps)`), and a hard 0 — the rejection threshold — when the
subsequence fails. Case folding on both sides; no boundary or camel-hump
bonuses, which is a defensible trade at this corpus size (short labels,
dozens-not-thousands of candidates).

`entryScore` (`:102-109`) adds the field weighting: label at full weight,
description × 0.7, keywords × 0.85 — meaning concentrated where the standard
expects it, encoded once. Extra match terms (synonyms, the parent group) ride
in `keywords` (`:50`) rather than being smuggled into labels.

## Recency

`trackRecent` / `getRecentAgentIds` (`:141-150`) keep a session-scoped,
most-recent-first ledger capped at 5, keyed by entity id. It feeds the
empty-query state so summoning the palette without typing surfaces recent
agents rather than a blank pane — the "switch back" gesture the technique
calls the palette's most-used state.

## Where it stops short of the standard (kept as standard; noted)

- **Score-only sort, no explicit tiebreak.** Every result list is ordered by
  `.sort((a, b) => b.score - a.score)` and sliced
  (`CommandPalette.tsx:232-235`, `:281-282`, `:292-293`, `:300-301`,
  `:308-309`). Under a banded scorer, ties are the common case (every prefix
  match scores exactly 90), so within-band order rests entirely on engine
  sort stability plus the accidental order of the source arrays. It is
  deterministic today by that accident; the blind-enter contract deserves an
  explicit tiebreak (recency, then stable id).
- **The recency ledger does not weight ranking.** Recents surface only in
  the empty-query state; once the user types, history plays no part in
  breaking the banded ties — the place the technique says the personal prior
  earns its keep.
- **The ledger is session-scoped and agent-only** — it resets on restart and
  does not learn for settings, templates, or navigation entries, all of
  which share the same tie-heavy bands.
