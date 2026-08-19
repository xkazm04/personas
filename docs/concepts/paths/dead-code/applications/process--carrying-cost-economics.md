---
layer: application
subject: dead-code
technique: carrying-cost-economics
stack: process
---

# Priced corpses — the three carrying costs this repo has actually measured

The technique says a carrying cost that leaves its measurement travels with its
predicate and names its recomputation. Three costs here meet that bar; the rest
of the ledger is stated qualitatively because nobody has measured it, which is
the honest label.

## Per-edit build tax: the command registry, ~11 ms per entry

Two independent measurements, both with their protocol on record:

- `docs/development/build-memory.md` ("`tauri::generate_handler!` — 10% of the
  memory, but HALF the time"): the handler list gutted from 1,827 entries to 8,
  `cargo check --lib` re-run — 169 s → 86 s wall (−49%), 4,242 MB → 3,803 MB peak
  (−10%). The conclusion is drawn carefully: not the memory hotspot, but "half of
  `cargo check`'s wall time, in one macro invocation," and reducing it "means
  reducing the *number of commands* … a design change, not a build flag."
- `scripts/build/unused-commands.mjs` header (2026-07-27, incremental `cargo
  check --lib` after touching one deep file): 1,647 entries 35.5 s, 823 entries
  23.5 s, 8 entries 17.0 s — "~11 ms per registered command, slightly superlinear
  at the top end. The handler is 52% of every incremental check — the cost is
  paid on EVERY edit, not just edits to lib.rs."

The recomputation is the script's own header (three points, one command, one
protocol), so the next person can refresh the price. At 1,585 registered commands
today with 23 never referenced, the *dead* share of the tax is small (~250 ms per
check); the *total* registry tax is the design finding — which is why the
instrument was built to inventory the whole registry, not only its corpses.

## Catalog multiplier: 118 dead keys × 14 locales

`find-unused-i18n-keys.mjs` reports 118 unused keys of 19,118 — two whole
sections, `planner` (67/67) and `deliberation` (51/51). The catalog fan-out is 14
locale files (`src/i18n/locales/`, `en.json` alone 20,290 lines) plus the
per-section split tree under `section-locales/`, so each dead key is carried
roughly 14× in source and once more per generated section chunk shipped to
users. The translation-completeness gate (`check:i18n:strict`) makes it worse in
the direction the technique predicts: a dead English key is a key thirteen
locales were *required* to translate — the pipeline spent translator budget on
strings that render nowhere, and would spend it again for the fifteenth locale.
Purge is a dry-run-default script (`purge-dead-keys.mjs`); the price of running it
is one review and one `split-locales.mjs`; the price of not running it is paid at
every locale addition.

## Dependency retention: `@xyflow/react`, 11 importers → 3, dependency stays

The `sub_canvas` deletion (`78e9bff68`) recorded the retention outcome
explicitly: "`@xyflow/react` drops from 11 importing files to 3 (all research-lab,
the one live `<ReactFlow>` mount) — the dependency stays." Measured today: 3
importers. The deletion removed 3,200 lines and eight of eleven importers of a
heavy graph library, and *did not* remove the library — a supply-chain liability
that would need the last live mount to go before it moves. Stated in the record so
the next session does not count the dependency as won.

## False affordances: three standards with zero witnesses

Not measured in seconds, but measured in adopters, which is the unit that matters
for this cost class:

- `ChartEmptyState` — in `src/features/shared/components/CATALOG.md`, the shared
  catalog readers are told to reach for; **0 render call sites** anywhere in
  `src/` (#w3-data-viz). A recommended component with no consumer teaches
  readers that the catalog is optional.
- `useRovingTabIndex` (`src/hooks/utility/interaction/useRovingTabIndex.ts`) —
  the accessibility golden path's named primitive for composite widgets; **0
  adopters** (#w10-accessibility). Its zero adopters are cited by that path as
  evidence the standard is ignorable, which is exactly the compounding the
  technique warns about.
- `max_retries` / `retry_count` / `auto_connect` in the peer-networking config
  (#w11-p2p-networking) — persisted, surfaced, and read by no behavior. Dead
  knobs: the header promises auto-reconnect and nothing implements it, so the
  false affordance is presented to *users*, not just readers.

## The gate-rot cost, observed once

The `sub_canvas` deletion ratcheted 11 census baselines downward (10 `title=`
attributes, 2 `animate-spin`, 3 document-level outside-click listeners) — every
one a convention violation the census had been *permitting* because it lived in
files nothing rendered. Dead code held those "allowed" counts high; the deletion
lowered the bar for the living code for free.

## What is not priced, and is labeled as such

Grep noise, review drag, and onboarding cost for the 354 unreachable non-test
modules are real and unmeasured. Nobody here has invented a number for them, and
the technique says not to: the honest entry is "qualitative, ranked below the
measured items, revisit when someone times a search."
