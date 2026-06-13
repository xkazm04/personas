# UI Perfectionist — Fix Wave 1 — Status & severity token unification

> 6 commits, 6 findings closed (1 critical-adjacent theme, 4 high, 1 medium, + 1 extra high folded in).
> Baseline preserved: TS errors 4 → 0 (no regression; net cleaner). eslint clean on all changed files (pre-commit hook).
> One mental model: raw status colors → `StatusBadge` / `statusTokens`.

## Commits

| # | Commit | Finding closed | Sev | Files |
|---|---|---|---|---|
| 1 | `7aa7a0da5` | vault #2 — HealthBadge raw pills | high | CredentialListColumns.tsx |
| 2 | `4ff1c5228` | vault #4 — ReauthBanner raw amber | high | ReauthBanner.tsx |
| 3 | `baddd26ef` | overview-dashboard #1 — observability chips | high | ObservabilityDashboard.tsx |
| 4 | `164c42161` | memories-knowledge #1 — COLOR_MAP duplicate | high | KnowledgeRow.tsx, knowledgeHelpers.ts |
| 5 | `57c088eb6` | reviews-incidents #5 — IncidentRow severity | medium | IncidentRow.tsx |
| 6 | `c6a966b32` | execution #3/#7 — tool/file markers | high | ExecutionSummaryCard.tsx |

## What was fixed

1. **Credential HealthBadge → `StatusBadge`.** The vault list's primary health signal was raw
   `bg-emerald-600/15 text-emerald-700 dark:text-emerald-400` pills with a light/dark fork and
   off-token opacities. Now three `<StatusBadge variant=success|error|neutral>` — color, border, and
   theme parity come from the token map. Removes the only light/dark color fork in the vault list.
2. **ReauthBanner → `statusTokens.warning`.** Container, text, and icons now derive from
   `STATUS_PALETTE.warning` so it matches the sibling ScopeMismatchBanner exactly (they previously sat
   side-by-side at different amber tints). The reconnect/retry/dismiss buttons gained the shared
   `focus-ring` (they had no visible focus state at all).
3. **Observability panel chips → `StatusBadge`.** `PanelStatusChips` hand-rolled error/stale/ok pills
   at `/20` borders vs the token's `/30`; now `variant=error|warning|success`, so the dashboard's panel
   health reads in the exact same colors as status everywhere else.
4. **Knowledge pills → `StatusBadge accent`, `COLOR_MAP` deleted.** `knowledgeHelpers.COLOR_MAP` was an
   exact byte-for-byte duplicate of `StatusBadge`'s `ACCENT_CLASSES`. The per-type/-scope `color`
   strings already double as `BadgeAccent` keys, so the pills now render via `<StatusBadge accent>` and
   the duplicate table is gone — one fewer place for the palette to drift.
5. **IncidentRow severity accent unified.** The gutter stripe re-derived color from `severityRank`
   while the glyph used `severityShapeStatus` — two independent severity→color decisions. The stripe now
   keys off the same `severityShapeStatus`, and the stale pill + stale timestamp source from
   `statusTokens.warning`. Glyph and stripe can no longer disagree.
6. **Execution markers → `statusTokens`.** Tool-call invoke marker, file read/modified counts, and
   per-file dots used raw `text-green-400` / `text-orange-400` / `text-blue-400`. Now sourced from
   `STATUS_PALETTE` (success/info) + `STATUS_PALETTE_EXTENDED` (caution).

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` errors | 4 (pre-existing) | **0** |
| eslint (changed files) | — | clean (pre-commit) |
| New source files | — | 0 |
| Lines net | — | ~−25 (deleted COLOR_MAP table + collapsed pill markup) |

## Patterns established (catalogue items 1–4)

1. **Status pill = `StatusBadge`, never a hand-rolled span.** Any `inline-flex … bg-X-500/10 text-X-400
   border-X-500/20` pill is a `StatusBadge variant` (semantic) or `accent` (arbitrary color) waiting to
   happen. Grep `bg-(emerald|red|amber|blue|rose)-[456]00/1[05].*text-` to find them.
2. **A local `COLOR_MAP`/`*_COLORS` object is a duplicate token table.** If its values match
   `STATUS_PALETTE` or `StatusBadge.ACCENT_CLASSES`, delete it and pass the key straight to `StatusBadge`.
3. **One semantic decision, one source.** When a glyph and its accent (stripe/border/dot) both encode
   the same severity, derive both from a single `…ShapeStatus`/`…ToHealth` mapping — never two parallel
   `rank`/`switch` ladders that can drift.
4. **`statusTokens.warning|error|…` over raw `amber-/red-/emerald-400`.** Bind container+text+icon to the
   token's `bg`/`border`/`text`; use `opacity-*` for the dimmed variants instead of `/60`/`/70` color forks.

## What remains (this theme)

~24 more token findings across the scan, notably: settings status colors (#3, systemic across 4 sub-pages),
triggers (#2, both tabs disagree), companion (#2/#3/#6, 114 raw status occurrences), events/messages
(#3/#4/#9), recipes (#4), memories sparkline (#7), templates n8n (#2), persona-chat (#6/#7/#8),
overview certification/director (#4/#7), credential ConnectionTest (#5)/ScopeMismatch (#8). See INDEX
"Wave 1" theme. Then Waves 2–8 (buttons, states, markdown/number/time, lists, forms, hierarchy, polish/a11y).
