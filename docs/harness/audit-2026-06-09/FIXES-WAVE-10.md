# Audit Fix Wave 10 — Color-only status indicators (Tier-3 highs begin)

> First Tier-3 (high-severity) wave. 5 commits, 5 of 6 color-only-status a11y highs closed; 1 deferred (8px dots need design care).
> Theme: status conveyed by hue alone (WCAG 1.4.1) — a deuteranope or anyone scanning fast can't tell the states apart. Each gets a redundant non-color channel: an icon (shape), a text severity tier, or a glyph badge.
> Baseline preserved: `tsc --noEmit` 0; eslint 0 errors (warnings only — baseline).
> Branch: `vibeman/audit-2026-06-09`.

## Commits

| Commit | Finding | Files |
|---|---|---|
| `732803127` | execution-engine #2 — run-status pill is color+label only | `agents/sub_executions/components/list/ExecutionListRow.tsx` |
| `a3132ce25` | events-messages #1 — 5 statuses share one Clock glyph | `lib/design/eventTokens.ts`, `overview/sub_events/components/EventLogList.tsx` |
| `0c94833dc` | credential-vault #3 — owned connector is emerald-ring only | `vault/sub_catalog/components/picker/ConnectorCard.tsx` |
| `191db60dc` | dev-ideas #3 — effort/impact/risk pills hue-only severity | `plugins/dev-tools/constants/ideaColors.ts`, `plugins/dev-tools/sub_scanner/IdeaScannerCards.tsx` |
| `d63e34b14` | lab #2 — winning column + win/loss deltas color-only | `agents/sub_lab/components/arena/ArenaResultsView.tsx` |

## What was fixed

1. **execution-engine #2** — the run-status pill drew only colored label text while `EXECUTION_STATUS_MAP` already defined a per-status `icon` and a `pulse` flag for `running`. Now renders `statusEntry.icon` (spinning via `motion-safe:animate-spin` for running) beside the label, so state is shape-distinct.
2. **events-messages #1** — the Events status column collapsed `pending`/`skipped`/`discarded`/`dead_letter` (and unknowns) into one `Clock` glyph; only color differed. Added an `EVENT_STATUS_ICONS` map to `eventTokens.ts` in lockstep with `EVENT_STATUS_COLORS` (typed over `PersonaEventStatus`, so a new Rust variant is a compile error) and a `getEventStatusIcon()` getter; the column now draws a distinct shape per status (failed→XCircle, dead_letter→AlertOctagon, skipped→MinusCircle, discarded→Ban, pending→Clock, …). `processing` keeps its spinner. Dropped the now-orphaned icon imports.
3. **credential-vault #3** — an "owned" (credentials-ready) connector was distinguished only by an emerald ring/tint. Added a theme-aware `CheckCircle2` badge on the connector icon with an `sr-only` "Connected" label, so readiness reads by shape+text; the ring stays as reinforcement.
4. **dev-ideas #3** — effort/impact/risk pills encoded severity by hue alone (green ≤3 / amber ≤6 / red >6). Added a `levelSeverity()` helper sharing `levelColor`'s thresholds and surfaced `low`/`med`/`high` text in `LevelBadge`; dropped the badge type ramp to `typo-caption` so it reads as metadata.
5. **lab #2** — the winning model's matrix column was marked only by `text-primary` and the win/loss delta arrows were tinted at 60% opacity (faint for low-vision/color-blind users). Added a `Trophy` glyph beside the best model's column header (mirroring the winner card badge) and raised the delta arrows to full opacity; the `+`/`-` sign plus up/down arrow shape already disambiguate direction.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `eslint` (staged) | 0 errors (warnings only, baseline) |
| `cargo check` | n/a (no Rust this wave) |

## Deferred (1 of 6)

- **fleet #1 — two-dot session-status indicator is color-only** (`plugins/fleet/FleetStatusDots.tsx:64-77`). Fixing this well means encoding ~5 console/business states (alive/idle/working/awaiting_input/stale) into an 8px dot via fill-style/ring/micro-glyph differences without making the grid noisy — a genuine visual-design pass on a space-constrained indicator, not a mechanical badge edit. Deferred to a focused fleet-UI session (it also pairs with the duplicated FleetPaneHeader #4 and the kill-confirm #6 in the same report). The `CONSOLE_DOT`/`BUSINESS_DOT` maps + `FleetStatusLegend` are the surfaces to touch.

## Patterns reinforced (catalogue, continued)

36. **The map often already has the shape.** Before adding an icon, check the status/token map — `EXECUTION_STATUS_MAP` already carried `icon`+`pulse`; the bug was the renderer ignoring them. Render what's defined rather than hand-rolling color-only text.
37. **Keep an icon map in lockstep with the color map.** When a color map is keyed over a generated binding (`Record<PersonaEventStatus, …>`), add the parallel icon map the same way so a new backend variant is a compile error in both, and they can't drift.
38. **Non-color channel ≠ always an icon.** A text tier (`low/med/high`), a `+`/`-` sign, or a distinct glyph shape all satisfy WCAG 1.4.1. Pick the lightest one that fits the control's size — a severity word for a pill, a glyph for an icon-badge, a sign for a delta.
39. **Don't regress the import list.** Replacing an inline icon ternary with a map-driven icon orphans the old `lucide` imports — remove them in the same edit or eslint `no-unused-vars` blocks the commit.

## Cumulative status

| Tier | Waves | Theme | Criticals/Highs closed |
|---|---|---|---|
| 1 | 1–6 | Reliability criticals | 33/41 C |
| 2 | 7–9 | UI criticals | 16/19 C |
| 3 | 10 | Color-only status (highs) | 5/6 H |
| | | **Criticals fixed** | **49** |
| | | **Highs fixed (Tier-3)** | **5** |

Tier-3 remaining: ~164 highs across the per-context reports. Natural next themed waves (from the 25 high a11y findings alone): **keyboard reachability** (hover-only actions, no focus path — companion #3, teams #4, recipes #2/#3, use-cases #3, fleet #3), **label/ARIA association** (credential-vault #2, persona-authoring #2, dev-ideas #4), then the non-a11y high themes (duplicated component markup ~25, error-blind highs, missing-state highs).
