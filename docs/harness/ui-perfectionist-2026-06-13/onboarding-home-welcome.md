# UI Perfectionist — onboarding-home-welcome

> Total: 9 findings (1 critical, 3 high, 4 medium, 1 low)

These are the app's first-impression surfaces, so deviations here read disproportionately loudly against the mature 199-component system. Findings are ordered reuse → token → hierarchy → state → polish → a11y.

## 1. Status colors hand-rolled instead of `statusTokens` across every onboarding/home surface

- **Severity**: high
- **Category**: token
- **File**: src/features/onboarding/components/StepIndicator.tsx:46-49; src/features/onboarding/components/OnboardingOverlay.tsx:21-26; src/features/home/sub_welcome/SetupCards.tsx:83,158,540-543; src/features/home/sub_learning/HomeLearning.tsx:23-29,59
- **Problem**: The "completed/success" state is re-typed as raw `bg-emerald-500/15 text-emerald-400 border border-emerald-500/25` (and `/10 /20`, `/20 /30`, `/40` variants) in at least five files, with each file picking slightly different opacity stops. `statusTokens.ts` exists precisely as "the single source of truth for status color" (`STATUS_PALETTE.success` = `text-emerald-400 / bg-emerald-500/10 / border-emerald-500/30`). The drifting opacities mean the same semantic "done" pill looks subtly different on the onboarding stepper, the setup cards, and the learning timeline — exactly the kind of inconsistency the token system was built to kill.
- **Fix sketch**: Replace the inline emerald/violet/amber/red triples with `STATUS_PALETTE.success` / `.ai` (violet) / `.warning` / `.error` from `@/lib/design/statusTokens`. For the onboarding "current" violet pill and CTA tone table, use the `ai` extended slot rather than re-deciding `violet-500/15…/25` per file.

## 2. Hand-rolled error block instead of `ErrorBanner`, plus hardcoded English strings, in the Cockpit (first cockpit impression)

- **Severity**: critical
- **Category**: reuse
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:179-190
- **Problem**: The cockpit's load-failure state is a bespoke `rounded-modal border border-red-500/20 bg-red-500/5` block with a hand-built Retry `<button>` and the literal strings `"Couldn't load your cockpit"` / `"Retry"` (the eslint rule for hardcoded JSX text is even suppressed inline). This is the canonical case the catalog's `ErrorBanner` + `Button` cover, it bypasses the `statusTokens.error` palette, and the untranslated English breaks a 14-language product on its flagship companion surface. The subtitle/`formatRelative` also emit raw English (`"Composed by Athena — updated …"`, `"just now"`, `"Your companion-driven workspace"`).
- **Fix sketch**: Swap the block for `ErrorBanner` (catalog feedback) with a retry action and an i18n message; render the Retry via `Button variant="secondary"`. Route the title/subtitle/empty copy through `useTranslation` like the rest of the file already does, and replace `formatRelative` with the catalog `RelativeTime` component.

## 3. Loading fallbacks hand-roll a spinner instead of `LoadingSpinner`

- **Severity**: high
- **Category**: reuse
- **File**: src/features/home/components/HomePage.tsx:15
- **Problem**: The Suspense fallback for Cockpit/Releases/Learning is a hand-built `w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin` div. `LoadingSpinner` is the catalog component (it is even imported two files away in `CockpitPanel`/`TemplatePickerStep`/`OnboardingOverlay`). A bespoke spinner here means a different size/stroke/color than every async surface it transitions into — the first thing a user sees when switching home tabs is off-system.
- **Fix sketch**: Replace the inline div with `<LoadingSpinner size="md" />` from `@/features/shared/components/feedback/LoadingSpinner`, centered with the existing flex wrapper.

## 4. Onboarding/welcome buttons hand-rolled instead of `Button`

- **Severity**: high
- **Category**: reuse
- **File**: src/features/onboarding/components/OnboardingOverlay.tsx:48-57,197-202; src/features/onboarding/components/TemplatePickerStep.tsx:67-73,84-90; src/features/home/sub_cockpit/CockpitPanel.tsx:123-133,231-239
- **Problem**: Continue/Skip/Retry/"Talk to Athena" CTAs are all raw `<button>` elements with per-file padding (`px-4 py-2.5`, `px-3 py-1.5`, `px-5 py-2`), per-file rounding (`rounded-modal` vs `rounded-card` vs `rounded-input`), and ad-hoc disabled handling (`disabled:opacity-40` vs `disabled:opacity-30`). `LanguageSwitcher.tsx` in the same scope already uses the catalog `Button` — proving it fits — so the onboarding flow is the odd one out. Inconsistent button metrics on the very first flow read as unpolished.
- **Fix sketch**: Adopt `Button` (`@/features/shared/components/buttons`) with `variant`/`size` props and `icon=`; it already encodes focus-ring, disabled (`is-disabled`), and consistent radius/padding. The `ONBOARDING_BUTTON_TONE` table can map to a Button variant rather than a className string.

## 5. Greeting text dominates the home hierarchy while live fleet numbers compete with it

- **Severity**: medium
- **Category**: hierarchy
- **File**: src/features/home/sub_welcome/NavStatChips.tsx:66; src/features/home/sub_welcome/HeroHeader.tsx:97
- **Problem**: Both the hero greeting (`typo-hero`) and the per-card stat numbers (`typo-hero font-black`) use the largest type-ramp step. On the Welcome screen they appear within one viewport, so a `47` execution count on a nav card visually rivals the "Good Morning, Commander" H1. Two simultaneous `typo-hero` elements with no clear primary flattens the hierarchy the hero is meant to own.
- **Fix sketch**: Demote the nav-card stat number to a smaller ramp step (e.g. `typo-heading-lg`/`typo-data`) so the greeting stays the single hero-scale element; reserve `typo-hero` for the H1 per the type ramp in `typography.css`.

## 6. Cockpit "unknown widget" and empty states bypass `EmptyState`/token system

- **Severity**: medium
- **Category**: state-coverage
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:205-242,260-263
- **Problem**: `CockpitEmptyState` is a fully bespoke empty surface and the unknown-widget fallback hand-codes `border-rose-500/30 bg-rose-500/[0.06] text-rose-300`. The catalog `EmptyState` exists for the former; the latter duplicates `STATUS_PALETTE_EXTENDED.critical`/`.error`. A first-run user with no composed cockpit lands on a one-off layout that shares no chrome with the app's other empty states.
- **Fix sketch**: Build the empty surface on `EmptyState` (icon + title + description + action slot) so spacing/typography match the rest of the app; map the unknown-widget chip to `STATUS_PALETTE_EXTENDED.critical`.

## 7. Inconsistent ad-hoc font sizing fights the type ramp on the Learning screen

- **Severity**: medium
- **Category**: hierarchy
- **File**: src/features/home/sub_learning/HomeLearning.tsx:56,59,97
- **Problem**: The learning timeline mixes raw `text-[11px]` and `text-[10px]` for the step-count, completion counter, and "done" badge, sitting next to `typo-body`/`typo-heading` tokens. The reference flags "ad-hoc `text-[13px]` … that fight the ramp" as a finding; here three different hardcoded pixel sizes coexist in one card, producing uneven caption sizing across otherwise-identical rows.
- **Fix sketch**: Replace `text-[11px]`/`text-[10px]` with the existing `typo-caption` token (used elsewhere in this very scope) so all secondary text shares one size/line-height.

## 8. SetupCards / NavigationGrid wrap interactive elements but place a `Tooltip`-worthy title on a non-button and rely on `title=`-less truncation

- **Severity**: medium
- **Category**: polish
- **File**: src/features/home/sub_welcome/SetupCards.tsx:542-544; src/features/home/sub_welcome/LanguageSwitcher.tsx:90,194
- **Problem**: The completed-setup badge truncates the chosen value at `max-w-[80px] truncate` and the language labels `truncate` with no tooltip or accessible full text, so a longer role/goal/language name is silently clipped with no way to read it. Elsewhere in this scope `NavStatChips` correctly wraps clipped content in the catalog `Tooltip`; these truncations don't, so hovering reveals nothing.
- **Fix sketch**: Wrap truncated labels in the catalog `Tooltip` (content = full value) as `NavStatChips` already does, or widen the badge; this also gives keyboard users the full text.

## 9. Onboarding/cockpit icon-only close & action buttons use `title=` where `Tooltip` belongs and lack `focus-ring`

- **Severity**: low
- **Category**: a11y
- **File**: src/features/onboarding/components/OnboardingOverlay.tsx:128-135,49-54; src/features/home/sub_welcome/SetupCards.tsx:361-363
- **Problem**: The onboarding header close button and the stepper's X use raw native `title=`/no tooltip and a bare `hover:bg-*` with no `focus-ring`, while `ResumeBanner.tsx` in the same scope demonstrates the correct `focus-visible:ring-2 … ring-offset-background` pattern. `OnboardingActionButton` also relies on native `title=` for its disabled-reason hint. Native `title` tooltips are inconsistent with the catalog `Tooltip` used elsewhere and have no keyboard affordance.
- **Fix sketch**: Add the `focus-ring` globals utility to the icon buttons and replace `title=` with the catalog `Tooltip` for the skip/disabled-reason hints, matching `ResumeBanner` and `NavStatChips`.
