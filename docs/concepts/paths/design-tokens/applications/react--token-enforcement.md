---
layer: application
subject: design-tokens
technique: token-enforcement
stack: react
---

# React application — token enforcement

This repo is the technique's best measured specimen: it has every kind of
gate the technique names, and 2026-08 audits measured exactly what each one
does and does not hold. File-and-line evidence throughout; the deep audits
are `docs/concepts/golden-paths/design-token-usage.md` and
`docs/concepts/golden-paths/theming-and-contrast.md`.

## The contrast gate — the strong half

`scripts/check-themes.mjs` is a real gate-sees-target instrument: it parses
the shipped stylesheet (`src/styles/globals.css`), layers each
`[data-theme=...]` block over `:root`, recomputes WCAG ratios for the text
pairs, and hard-fails (exit 1) any theme where body/muted text drops below
4.5:1 (header comment, `check-themes.mjs:1-40`). It runs in CI
(`.github/workflows/ci.yml:144`), supports a fixture redirect for testing
the checker itself (`CHECK_THEMES_CSS`, `check-themes.mjs:47-50`), and has
no dependencies. Its measured limits (audited at
`theming-and-contrast.md:245-287`): it reads *pre-filter* declarations while
a whole-document brightness filter changes what reaches the screen — the
light themes' default 0.82 level pushes `muted-foreground@80%` from a
passing 4.6:1 to a failing 4.0–4.1:1 with the gate green — and it audits 11
of the 66 reachable theme × brightness × contrast configurations. A correct
instrument pointed at a proxy of the target.

## The raw-value bans — the advisory half

The lint rules the technique prescribes all exist
(`eslint-rules/no-raw-radius-classes.cjs`, `no-raw-text-classes.cjs`,
`no-low-contrast-text-classes.cjs`, …) and all sit at `"warn"`
(`eslint.config.js:96-101`). The measured lesson, verbatim from this repo's
own audits: `npm run check` runs with no `--max-warnings`, and the
pre-commit hook runs `--quiet --max-warnings 99999`, so **a warn-level rule
enforces nothing at either gate at any count, by construction**
(`theming-and-contrast.md:761-765`). Baseline at HEAD: 0 errors, 1,135
warnings — 705 of them `no-low-contrast-text-classes`, 128
`no-raw-radius-classes`. The correlation-without-enforcement effect is also
measured: token axes with an early-wired rule sit at 94–99% adoption (typo
99.0%, elevation 99.4%, radius 94.0%); axes with no firing rule collapse
(`CARD_PADDING` 0.8%, `MOTION` 3.4%, `is-disabled` 1.0%)
(`design-token-usage.md:285-330`) — and the cross-repo check falsified
delivery format as the cause, leaving "a gate fires, wired early" as the
surviving predictor.

## The visibility failures, one specimen each

- **Byte-identical token:** `STATUS_PALETTE.success.text` *is* the string
  `'text-emerald-400'` (`src/lib/design/statusTokens.ts:26-33`), so no
  lexical rule can tell an adopter from a violator — which is why the color
  axis has no raw-value rule at all
  (`design-token-usage.md:493-511`).
- **Deny-list certifying the nonexistent:** `no-raw-text-classes.cjs:41` is
  a deny-list, so `text-md` — a class defined by *no* layer — passes green;
  230 occurrences across 63 files, four of them inside the shared `Button`
  (`design-token-usage.md:438-451`).
- **Exemption buckets:** the radius rule's path exemptions and
  attribute-visiting gaps leave it seeing 130 of 307 real occurrences
  (42.3%) (`design-token-usage.md:401-411`); the contrast rule walks
  template-literal quasis but never expressions, costing 14% recall
  (`theming-and-contrast.md:429-467`).
- **The authority violating itself:** the token file ships raw values the
  standard bans — `INPUT_FIELD` hardcodes `rounded-xl` against the
  documented `rounded-input` mandate (`src/lib/utils/designTokens.ts:104`
  vs `.claude/Design.md:216`) — and it can, because the exemption matrix
  excludes `src/lib/` from the rules (`no-raw-radius-classes.cjs:46-52`).

## The migration clause, lived: the 2026-08-07 type-recipe softening

The golden path's "a token change is a migration" section is this repo's
`typo-label` change, generalized. The recipe dropped its uppercase + wide
tracking (`src/styles/typography.css` — the current file carries the
post-change script notes at `typography.css:89-98`; `.claude/Design.md:61`
records the before/after). Because the recipe had been *suppressing* local
styling — `typography.css` is unlayered and beat utility-layer declarations
— **567 `uppercase`/`tracking-*` utilities sitting next to `typo-label` in
class strings were inert, and every one would have switched back on the
instant the token stopped declaring `text-transform`**. The change swept all
of them pre-emptively, touching 143 component files in the same commit
(`193d4aeab`; run ledger `.claude/active-runs.md:75-79`). The ledger's own
lesson: *"when you soften a `typo-*` token, sweep the utilities it was
silently suppressing in the same change or the app ends up half-shouting."*
The blast radius of a token change is what referenced it plus what it
overrode — measured here at 143 files for a one-recipe edit.
