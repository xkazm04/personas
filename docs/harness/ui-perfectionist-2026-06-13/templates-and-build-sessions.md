# UI Perfectionist — templates-and-build-sessions

> Total: 9 findings (1 critical, 4 high, 3 medium, 1 low)

Scope reviewed: `src/features/templates/components`, `sub_presets`, `sub_n8n`
(~30 .tsx files; the prominent shared surfaces were read in full —
`PresetLibraryPage`, `PresetPreviewModal`, `PresetQuestionnaireForm`,
`DesignReviewsPage`, `N8nWizardFooter`, `N8nSessionList`, `N8nStepIndicator`,
`ConnectorRow`, `ConnectorHealthRail`, `SuccessBanner`, `PresetGraphAdapter`,
plus `colorTokens.ts`).

---

## 1. Raw `<button>` with hand-rolled variant styling instead of `Button` — systemic across the n8n wizard
- **Severity**: critical
- **Category**: reuse
- **File**: src/features/templates/sub_n8n/widgets/N8nWizardFooter.tsx:84, 115, 140, 151, 166 (also ConnectorRow.tsx:80,91,103; N8nSessionList.tsx:67,277; SuccessBanner.tsx:69)
- **Problem**: The wizard footer alone hand-rolls five buttons, each re-implementing padding, `rounded-modal`, border, hover, and `disabled:opacity-40 disabled:cursor-not-allowed` from scratch — and inventing a private `variant: 'violet' | 'emerald'` color vocabulary that exists nowhere else in the design system. The catalog ships `Button` (used correctly in `PresetPreviewModal`) with `variant="primary|secondary|ghost"` + `size` + `icon` + built-in disabled/focus handling. The two parallel button idioms in the *same feature* (PresetPreviewModal uses `Button`; the entire n8n flow does not) is the textbook reuse violation this codebase warns against, and it means focus-visible rings, tap-target floor, and disabled semantics are inconsistent between the two halves of Templates.
- **Fix sketch**: Replace every raw `<button>` with `Button` from `@/features/shared/components/buttons`. Map the bespoke emerald/violet "filled CTA" to `variant="primary"`, the bordered secondary actions to `variant="secondary"`, and Back to `variant="ghost"`. Drop the local `variant: 'violet'|'emerald'` union entirely; pass `icon=` and `disabled=` props rather than re-implementing them.

## 2. Status colors hard-coded throughout instead of `statusTokens`
- **Severity**: high
- **Category**: token
- **File**: src/features/templates/sub_n8n/steps/confirm/ConnectorHealthRail.tsx:20,36-45; SuccessBanner.tsx:15-71; ConnectorRow.tsx:142-160; N8nWizardFooter.tsx:100,108,119-173; PresetPreviewModal.tsx:288-307
- **Problem**: success/warning/error are spelled out as raw Tailwind (`text-emerald-400`, `bg-amber-500/10`, `text-red-400`, `border-emerald-500/30`, dot `bg-emerald-400`/`bg-red-400`/`bg-amber-400`) in at least five components. `src/lib/design/statusTokens.ts` is the single source of truth (`success/warning/error → text/bg/border/ring/icon`). Because each site picks its own opacity (`/10` vs `/15` vs `/20` vs `/5`) the same "ready / failed / warning" state renders at visibly different intensities across the confirm step, the rail, and the row detail — a perfectionist immediately reads it as un-tuned.
- **Fix sketch**: Derive every status color from `STATUS_PALETTE`/`statusTokens` (`success` for ready/done, `warning` for amber, `error` for failed). For the dots in ConnectorHealthRail use the token `.icon` class; for badges use the `StatusBadge` catalog component (see #3). Fold the ad-hoc `text-emerald-400/60`, `/50`, `/70` tints back to token text.

## 3. Hand-rolled status pills/dots instead of `StatusBadge` / `StatusDot`
- **Severity**: high
- **Category**: reuse
- **File**: src/features/templates/sub_presets/PresetPreviewModal.tsx:278-311 (StatusBadge fn); src/features/templates/sub_n8n/steps/N8nSessionList.tsx:56-58; ConnectorRow.tsx:62-68; ConnectorHealthRail.tsx:36-57
- **Problem**: `PresetPreviewModal` defines a *local* `StatusBadge` component re-implementing queued/adopting/done/failed pills; `N8nSessionList` builds its own `{style.bg} {style.text}` pill from `colorTokens.SESSION_STATUS_STYLES`; `ConnectorRow` builds another inline pill; `ConnectorHealthRail` hand-rolls a status dot (`w-2 h-2 rounded-full ${dotColor}`). The catalog already provides `StatusBadge` ("status pill mapping a status token to label + color, use with tokenLabel()") and `StatusDot` ("minimal colored status dot for compact rows"). Four bespoke reinventions of two catalog primitives in one feature.
- **Fix sketch**: Replace the local `StatusBadge` and the inline pills with the catalog `StatusBadge`; replace the rail's `dotColor` span with `StatusDot`. Map the `colorTokens` status enums onto status tokens so labels + colors come from one place.

## 4. Raw `<select>` instead of `Listbox` / `ThemedSelect`
- **Severity**: high
- **Category**: reuse
- **File**: src/features/templates/sub_presets/PresetQuestionnaireForm.tsx:299-310 (SelectControl); checkbox at 328-333
- **Problem**: The preset questionnaire renders a native `<select>` with a hand-built `bg-secondary/30 border border-primary/20 … focus:border-primary/60` skin and a bare native `<input type="checkbox">`. The catalog ships `Listbox` ("use instead of raw `<select>` or custom dropdowns") / `ThemedSelect`, plus a catalog `Toggle`/checkbox. A native select renders the OS-themed dropdown popup, breaking theme + dark/light parity the moment it opens — exactly the deviation the reference flags.
- **Fix sketch**: Replace `SelectControl` with `Listbox`/`ThemedSelect` (options map 1:1). Swap the raw checkbox in `BooleanControl` for the catalog toggle/checkbox so focus-ring and theming come for free.

## 5. `formatRelativeTime()` string instead of the `RelativeTime` component
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/templates/sub_n8n/steps/N8nSessionList.tsx:61 (`formatRelativeTime(session.updated_at)`)
- **Problem**: Session "updated" time is rendered as a static formatted string. The design system provides `RelativeTime`/`AbsoluteTime`; the static string never ticks ("2 minutes ago" stays frozen) and gives no hover-for-absolute affordance the rest of the app has, so timestamps read inconsistently with other lists.
- **Fix sketch**: Render `<RelativeTime value={session.updated_at} />` (keeping the `Clock` icon) so it auto-refreshes and exposes the absolute timestamp on hover.

## 6. Bespoke loading + missing empty/error states on async surfaces
- **Severity**: medium
- **Category**: state-coverage
- **File**: src/features/templates/sub_n8n/steps/N8nSessionList.tsx:245-251; src/features/templates/sub_presets/PresetLibraryPage.tsx:37-53
- **Problem**: `N8nSessionList` renders a bare spinning `RefreshCw` for loading instead of `LoadingSpinner` (which `ConnectorRow` *does* import — inconsistent within the same sub-feature), and its inline error block is hand-built rather than `ErrorBanner`. `PresetLibraryPage` shows loading as a plain centered `<p>` text line (no spinner/skeleton) and hand-rolls its empty state instead of the catalog `EmptyState`. Async state presentation is therefore three different visual languages inside one feature.
- **Fix sketch**: Use `LoadingSpinner`/`ListSkeleton` for both loading states, `ErrorBanner` (inline variant, it has built-in retry) for the session-list error, and `EmptyState` for the preset empty case.

## 7. Ad-hoc separator opacity vs the `ROW_SEPARATOR` token (used correctly only in one file)
- **Severity**: medium
- **Category**: token
- **File**: src/features/templates/sub_presets/PresetPreviewModal.tsx:63,193 (`border-primary/10`); PresetQuestionnaireForm.tsx:120,228; N8nWizardFooter.tsx:82,94; ConnectorRow.tsx:52
- **Problem**: Row/section separators are written as `border-primary/10` (and `bg-primary/10` rules, `border-primary/[0.06]`) ad hoc. `ConnectorHealthRail.tsx:18,34` correctly uses `border-primary/[0.06]` / `divide-primary/[0.06]` — i.e. the `ROW_SEPARATOR` value from `listTokens.ts` — so the *same feature* draws separators at two different opacities (`/10` vs `/[0.06]`). Hairlines that don't match across adjacent panels are exactly the kind of inconsistency this audit targets.
- **Fix sketch**: Import `ROW_SEPARATOR` from `src/lib/design/listTokens.ts` and apply it to all row/section dividers so every hairline matches.

## 8. Untranslated, hand-pluralized English strings in an otherwise fully-i18n surface
- **Severity**: high
- **Category**: hierarchy
- **File**: src/features/templates/sub_n8n/steps/confirm/SuccessBanner.tsx:36-48; ConnectorHealthRail.tsx:23 (`of N connectors ready`); N8nSessionList.tsx:79 (`Retry`), :282 (`Retry`); N8nStepIndicator.tsx:63,104 (`completed`/`in progress`/`upcoming`)
- **Problem**: This feature otherwise routes *everything* through `t.templates.n8n.*`, yet the success/confirmation banner builds sentences in raw English with manual `trigger${n!==1?'s':''}` pluralization, and the health rail, session list, and step indicator hard-code `Retry`, "of N connectors ready", and the sr-only status words. On the most celebratory screen (persona created) and in screen-reader output, the product silently drops out of its own localization + `tx()` pluralization system — a visible quality/consistency break.
- **Fix sketch**: Move all literals into `t.templates.n8n.*` and use `tx(..., { count })` for pluralization (the pattern already used in `ConnectorRow`/`PresetCard`). No raw concatenated plurals.

## 9. Indigo/violet hover accents hard-coded off-theme on the preset card
- **Severity**: low
- **Category**: token
- **File**: src/features/templates/sub_presets/PresetLibraryPage.tsx:107 (`hover:border-indigo-500/30`, `hover:shadow-[0_0_20px_rgba(99,102,241,0.08)]`, default `'#6366f1'`)
- **Problem**: The preset card's hover border + glow are pinned to literal indigo (`indigo-500`, `rgba(99,102,241,…)`) rather than the theme `primary` accent, so on a non-indigo theme the card's hover state clashes with every other interactive surface. The arbitrary `shadow-[…]` also bypasses the `shadow-elevation-*` ramp the modal itself uses (`shadow-elevation-4`).
- **Fix sketch**: Use `hover:border-primary/30` and a themed elevation/`primary`-tinted glow (or a `shadow-elevation-*` token) so hover affordance tracks the active theme.
