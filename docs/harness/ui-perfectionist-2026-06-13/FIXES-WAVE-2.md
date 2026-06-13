# UI Perfectionist — Fix Wave 2 — Catalog Button adoption

> 4 commits, 4 findings closed (1 critical — footer portion, 3 high).
> Baseline preserved: TS errors 0 → 0. eslint clean on all changed files (pre-commit hook).
> One mental model: hand-rolled `<button>` with private variant vocabularies → catalog `Button`.

## Commits

| # | Commit | Finding | Sev | Files |
|---|---|---|---|---|
| 1 | `90bea906c` | templates #1 — n8n wizard buttons | critical (footer) | N8nWizardFooter.tsx |
| 2 | `bd562e74b` | reviews #3 — approve/reject | high | ReviewDetailPanel.tsx |
| 3 | `48d35327c` | triggers #4 — cloud-webhook actions | high | CloudWebhooksTab.tsx |
| 4 | `bea5b5d8e` | onboarding #4 — onboarding CTAs | high | OnboardingOverlay.tsx |

## What was fixed

1. **n8n wizard footer → `Button`.** Five footer buttons used a private violet/emerald variant
   vocabulary (`bg-violet-500/25 text-violet-300 …`) — the second button idiom that made templates #1 a
   critical. Back→`ghost`; the colored actions→`variant=accent` (color via `ACCENT_CLASSES`, the
   token-backed source); manual `RefreshCw` spinners replaced by Button `loading`/`loadingLabel`.
   *Footer closed; the sibling n8n files (ConnectorRow, N8nSessionList, SuccessBanner) remain.*
2. **Manual-review approve/reject → `Button`.** Raw `<button>`s with literal emerald/red and a manual
   "Processing…" text swap became `Button` (accent emerald / accent rose) with `loading` + `loadingLabel`,
   keeping the multi-decision notes logic. The incidents module already used the catalog one folder over.
3. **Cloud-webhook actions → `Button`.** Add/create/cancel were hand-rolled with a private blue
   vocabulary, divergent from the sibling Smee-relay tab. Now `Button` (accent blue / ghost) with
   `loading` on create; dropped the now-dead `LoadingSpinner` import.
4. **Onboarding CTAs → `Button`.** The shared `OnboardingActionButton` wrapper kept a local
   violet/emerald tone table; it now renders `Button` (`variant=accent, accentColor=tone`) and the
   `ONBOARDING_BUTTON_TONE` table is deleted — every onboarding CTA inherits catalog sizing, press
   feedback, and disabled handling on the first-impression surface.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` errors | 0 | **0** |
| eslint (changed files) | — | clean (pre-commit) |
| New source files | — | 0 |

## Patterns established (catalogue items 5–7)

5. **A private `tone`/`variant` table on a hand-rolled button = catalog `Button variant=accent`.** When
   the tone keys are color stems (`violet`, `emerald`, `blue`), pass them straight to `accentColor` — the
   table is a duplicate of `ACCENT_CLASSES`. Delete it.
6. **`Button loading`/`loadingLabel` replaces every `isX ? <Spinner/> : <Icon/>` + text-swap pattern.**
   Don't hand-wire a spinner and a "…ing" label; Button does both and preserves width.
7. **`Button` is a default export** (`import Button from '…/buttons/Button'`); the `buttons` barrel
   re-exports it named. Importing `{ Button }` from the deep path is a TS2614 — prefer the barrel
   `@/features/shared/components/buttons` for named imports of `Button`, `CopyButton`, `AsyncButton`.

## What remains (this theme)

Button-adoption findings still open: **creative-plugins #1 (critical)** — Artist hand-rolls its whole UI
vocabulary (buttons + spinners + dots + focus); best as its own session. Plus settings #1 (three Save-button
languages), recipes #2 (RecipeManager), memories #9 (Annotate/MemoryDetail modals), companion #8, and the
n8n sibling files above. Then Waves 3–8 (states, markdown/number/time, lists, forms, hierarchy, polish/a11y).
