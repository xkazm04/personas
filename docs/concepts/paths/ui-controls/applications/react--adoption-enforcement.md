---
layer: application
subject: ui-controls
technique: adoption-enforcement
stack: react
---

# React application — adoption enforcement

The detectors, nudges, gates, and ratios this repo actually runs against
its control library — including the ones that measured zero and taught the
technique its precision/recall clause.

## Detect by signature: the census rules

`scripts/census/rules.json` carries the control-library detectors, each keyed
on the temptation signature and each shipping its own baseline:

| rule | signature (not the name) | baseline |
|---|---|---|
| `native-title-tooltip` | `title=` on a lowercase DOM element | 566 files / 1,099 matches; precision 1109/1109, recall 99.7% vs a JSX-parser ground truth |
| `hand-painted-modal-backdrop` | `fixed inset-0` + a paint class | 19 files / 20 matches; precision 20/20 |
| `hand-rolled-spinner` | `animate-spin` in feature code | 180 / 246 |
| `null-spinner-busy-state` | `<LoadingSpinner/>` as the consequent of a ternary whose alternate is an icon | 50 / 68 |
| `unverified-clipboard-write` | `copyText(...)` in statement position — its `Promise<boolean>` bound to nothing | 22 / 32 |
| `tabstrip-with-no-declared-panel` | a tab-strip anchor in a file that never renders `role="tabpanel"` | 27 / 30 |

Every rule's `description` states what it is a PROXY FOR and, for the ones
that were validated, the precision/recall against hand-checked ground
truth. `npm run census:check` (in the `npm run check` chain,
`package.json:54`) fails on regression above baseline — the **ratchet**:
the count may only shrink.

## The rule that detected nothing — measured

`custom/enforce-base-modal` (`eslint.config.js:95`, level `warn`) was
believed to gate hand-painted modals. Driven over its whole anchor
(2026-08-17): **precision 0/8** (every hit an anchored popover or inline
notice — converting them would regress) and **recall 0/19** (the 19
hand-painted modal files carry no `role="dialog"`, which is what the rule
keys on). It is also satisfied by a bare *import* of `BaseModal` — the
proxy-check failure the technique names. Its own `RuleTester` fixtures
contain no `fixed inset-0`, so no fixture could ever have failed. The
census rule `hand-painted-modal-backdrop` above is the signature-keyed
replacement, and it is the one whose count is believed.

## Tiers, as this repo has them

- **Warn-level rules are routing, not gates — by construction.**
  `npm run check` runs `eslint src/` with no `--max-warnings`; the
  pre-commit hook runs `--quiet --max-warnings 99999`, and `--quiet`
  suppresses warnings before they can be counted (`.claude/CLAUDE.md`
  § Pre-existing Issues, corrected 2026-08-14). Every control-library lint
  rule — the shared-tree import boundary (`eslint.config.js:165-200`),
  `enforce-base-modal`, `no-hardcoded-jsx-text` — is at this tier. They
  correlate with adoption; none of them has ever failed a build.
- **Error-level rules that must hold**: `custom/no-silent-catch` at
  `"error"` (`eslint.config.js:104`) — 0 findings across 4,829 files; the
  condition is extinct because the gate worked. `no-restricted-imports`
  forcing `invokeWithTimeout` over raw `invoke` is the same tier.
- **The census baselines** are the ratchet tier: not per-file lint, but a
  count that fails the check chain if it grows.
- **The review-time table**: `.claude/CLAUDE.md`'s don't-hand-roll table,
  read at session start by every agent.

## Fix-as-you-touch, stated as policy

`.claude/CLAUDE.md` § "Pre-existing Issues": "Follow the fix-as-you-touch
policy; do not bulk-migrate." Lint baseline measured 2026-08-14: 0 errors,
1,135 warnings across 246 of 4,829 files — `no-low-contrast-text-classes`
705, `no-hardcoded-jsx-text` 226, `no-raw-radius-classes` 128. The i18n
section says the same for strings: extract when touching a file for other
reasons if the fix is < 5 strings; never bulk-migrate.

## Adoption ratios with their predicates

- **Modal**: 129 `<BaseModal>` render sites : 20 hand-painted backdrops =
  **86.6%** adoption, predicate = census rule `hand-painted-modal-backdrop`
  on the 2026-08-17 tree.
- **Clipboard**: 1 raw `navigator.clipboard.writeText` in production
  (`src/features/plugins/fleet/fleetTerminalManager.ts`) outside the
  canonical `copyText` door — near-total adoption of the door; the open
  count is the 32 *unverified* calls whose boolean result is dropped.
- **Field**: **4 `FormField` adopters : 19 shadow wrappers** — the
  inversion (`golden-path-deferred-fixes.md#w1-form`). Also 120 orphan
  labels across 49 files. This is the measurement behind the golden path's
  claim that shadows outnumbering adopters is the normal no-loop outcome.
- **Roving focus**: `useRovingTabIndex` **0 adopters**
  (`#w10-accessibility`); the strips that need roving hand-roll it. Zero
  is the loudest signal — the hook's index-keyed API is the reason.
- **Busy button**: `AsyncButton`/`Button loading` vs `null-spinner-busy-state`
  50 files / 68 sites — the invisible-busy shadow population, watched by
  the census rule and by CLAUDE.md's spinner-boundary section.

Each figure names its detector and date; the CLAUDE.md corrections of
2026-08-14 (the "~10,086 warnings" line, wrong by ~9×, cited by five
golden paths as the reason to ship gates at `error`) are the local proof of
why an adoption number without its predicate is a liability.
