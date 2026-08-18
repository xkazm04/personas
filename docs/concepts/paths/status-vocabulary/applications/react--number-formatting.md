---
layer: application
subject: status-vocabulary
technique: number-formatting
stack: react
---

# React application — number formatting

This repo is where the technique's central claim was measured as a diff:
**one edit binding the locale inside the primitive corrected ~212 call
sites that a green gate had blessed.** The deep audit is
`docs/concepts/golden-paths/number-and-cost-formatting.md` (2026-08-14,
recurrence 176); the fix landed the same day.

## The primitive, and the fix written into it

`src/features/shared/components/display/Numeric.tsx` is the one renderer:
`value` + `unit` (`ms|s|usd|percent|ratio|count|compact|plain`) delegated
to `formatNumeric` (`src/lib/utils/formatters.ts:389`), tabular lining
figures inline so digits never jitter, compact values auto-titled with
the full-precision figure. Its `language` prop doc (`Numeric.tsx:35-49`)
carries the measurement: it used to default to `'en'`, callers were
instructed to pass the locale, and **8 of 197 value-driven call sites
did** — 95.9% rendered en-US separators in a 14-locale app, seven of
whose locales use a decimal comma. The lint rule `custom/prefer-numeric`
could not catch it: *"the rule verifies you REACHED this primitive and
cannot verify you CONFIGURED it — a gate pointing at a broken
destination."* The fix binds `useTranslation().language` inside the
component (`:77-78`) and, for non-component callers, an
`activeLanguage()` reader off the i18n store replaced the four `?? 'en'`
defaults in `formatters.ts` (`:21`). The prop survives as a genuine
override (fixed-locale export previews). The convergent confirmation:
`politicas` binds the locale inside its `useFormat()` hook — no argument
to forget — and its off-token rate is 1 in 827.

The boundary note the technique generalizes: `shared/components/` by
convention does not import `@/stores`, which is what originally made the
locale a prop — the boundary, not the author, created the forgettable
input; the fix crossed it via the hook 57 other shared components already
consume.

## Units, rounding, and the three facts — the measured bugs

- **Glyph concatenation:** 40 `` `$${…toFixed(n)}` `` sites, 10
  `$<Numeric/>` sites, 83 hand-pasted `%` sites against 22 on-doctrine
  percent renders. `formatCost` places the symbol per locale
  (`$1,234.50` en · `1.234,50 $` de · `US$1.234,50` id) — no
  concatenation reaches that, nor `12,34,567.5` (hi lakh grouping), nor
  `123.5万` (zh compact).
- **Sub-unit money:** 22 of the 40 hand-rolled money sites render real
  sub-cent spend as `$0.00` (three as whole dollars —
  `FactoryOverviewTab.tsx:284`). `formatCost`'s `<$0.01` guard is the
  whole reason it beats `.toFixed(2)`.
- **Zero/unknown asymmetry, live in the primitive's own formatter:**
  `formatCost(0)` → `$0.00` at precision 2 but `<$0.001` at `4`/`'auto'`
  (the `usd === 0` guard sits inside one branch, `formatters.ts:122`);
  `formatCost(null)` → `$0.00` at 2 but `—` at the others; any negative
  → `<$0.01` (the guard fires on `usd < 0.01`). `<Numeric unit="usd">`
  uses `'auto'`, so ~29 exposed sites render a failed-before-first-call
  execution's $0 as "less than a tenth of a cent"; two sites guard with
  `> 0` (`LlmCallsTable.tsx:263`, `GlobalExecutionList.tsx:466`).
  `formatNumeric` also silently drops `precision` for `usd`/`ms`/`s` —
  nine sites pass a precision that never arrives.

## The gate blindness, as source code

`eslint-rules/prefer-numeric.cjs:78-80` aborts on any enclosing
`CallExpression` / arrow / function expression — so every chart
`tickFormatter`, every `format={(v) => …}` callback, and every `.ts`
helper is invisible. Measured population: ~141 display-intent
`.toFixed()`/`.toLocaleString()` sites; the rule reports **5** — recall
≈ 3.5% — and at warn-level it enforces nothing at either gate anyway
(`npm run check` has no `--max-warnings`; pre-commit runs `--quiet`).
`personas-web` reached the same hole by an unrelated mechanism (its
scanner gates on `hasLetters`, so a bare `%`/`$` can never be reported).

## What to copy

`src/features/overview/sub_activity/components/LlmCallsTable.tsx`: takes
`language` because it renders numbers (`:62`), `unit="compact"` for token
counts (`:235,:249`), zero-guarded `unit="usd"` (`:263`), and `t` +
`language` in the column `useMemo` deps (`:269`) so a language switch
rebuilds the columns. The remaining structural gap is `NumericUnit`'s
missing `bytes` member — ten independent KB/MB ladders exist because
there is nowhere to send them; add the unit before gating them.
