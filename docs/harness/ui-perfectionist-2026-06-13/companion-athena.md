# UI Perfectionist — companion-athena (Athena companion plugin)

> Total: 9 findings (0 critical, 4 high, 4 medium, 1 low)

Reviewed the most prominent surfaces of the Athena companion plugin: `CompanionPanel.tsx` (the panel shell, header, transcript body, stream wiring), `Composer.tsx`, `Bubble.tsx`, `ApprovalCard.tsx`, `ProactiveCard.tsx`, `ConnectorCallCard.tsx`, `QuickReplies.tsx`, `WelcomeHero.tsx`, and `CompanionPluginPage.tsx`. The surface is generally well-built (good `focus-ring`/`aria` discipline, `LoadingSpinner`/`CopyButton`/`RelativeTime`/`MarkdownRenderer` reuse, sr-live mic announcement). The findings cluster on one systemic theme: **status color is hand-rolled with raw Tailwind palettes instead of `statusTokens`**, and **error banners are hand-built instead of the catalog `ErrorBanner`/`InlineErrorBanner`**.

---

## 1. Hand-rolled error banners instead of catalog `ErrorBanner`/`InlineErrorBanner`
- **Severity**: high
- **Category**: reuse
- **File**: src/features/plugins/companion/CompanionPanel.tsx:1842, :2189–2191 (also ApprovalCard.tsx:169, :175; ProactiveCard.tsx:104)
- **Problem**: Every error surface in this plugin is a bespoke `<div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-... typo-... text-rose-400">`. The catalog ships `feedback/ErrorBanner` and `feedback/InlineErrorBanner` (and `InlineErrorRecovery`) for exactly this. Five near-identical copies means inconsistent padding (`px-3 py-2` vs `px-2.5 py-1.5`), inconsistent text size (`typo-body` for initError vs `typo-caption` for sendError), and a raw `rose` palette that bypasses `STATUS_PALETTE.critical`/`error`. This is the #1 reuse violation on the surface and the thing a designer notices first — error states should look identical everywhere.
- **Fix sketch**: Replace each block with `<InlineErrorBanner message={…} />` (or `ErrorBanner` with the retry action for the sendError case, which already has a re-send affordance). Drop the raw rose classes entirely.

## 2. Status accents hand-rolled instead of `statusTokens`/`SEVERITY_ACCENTS`
- **Severity**: high
- **Category**: token
- **File**: src/features/plugins/companion/ConnectorCallCard.tsx:222–243 (`iconFor`), ProactiveCard.tsx:140–171 (`accentForTrigger`)
- **Problem**: `iconFor` returns literal `border-blue-500/30 bg-blue-500/[0.05]` (running), `border-rose-500/30 bg-rose-500/[0.06]` (failed), `border-emerald-500/30 bg-emerald-500/[0.06]` (done) — these duplicate `STATUS_PALETTE.info/critical/success` at slightly different alpha values, so the companion's status cards don't match the rest of the app's status surfaces. `accentForTrigger` likewise hard-codes 6 palettes (amber/rose/violet/emerald/sky/cyan). 114 raw status-color occurrences exist across the plugin tree.
- **Fix sketch**: Map `job.status`/`triggerKind` to a `StatusKeyExtended` and pull `border`+`bg` from `STATUS_PALETTE_EXTENDED` (or `SEVERITY_ACCENTS` for the left-border treatment). This keeps alpha and hue consistent with credentials/health badges.

## 3. Mic/improve buttons use raw red/amber instead of status tokens
- **Severity**: high
- **Category**: token
- **File**: src/features/plugins/companion/Composer.tsx:253–259, :291
- **Problem**: The hot-mic state is `bg-red-500/15 text-red-400`, the mic-error state `bg-amber-500/10 text-amber-400`, and the improve button `bg-amber-500/10 text-amber-400`. These bypass `STATUS_PALETTE.error`/`warning`. The improve button reuses the *warning* palette for a neutral "enhance" action, which reads as a caution where none exists — a semantic-color misuse, not just a token deviation.
- **Fix sketch**: Use `STATUS_PALETTE.error` for the listening state and `STATUS_PALETTE.warning` only where a real warning exists (mic error). Re-tint the improve button to `primary`/`ai` (violet) accent so it doesn't read as a warning.

## 4. Day-separator / autonomous-marker dividers duplicate a row-separator pattern by hand
- **Severity**: medium
- **Category**: token
- **File**: src/features/plugins/companion/CompanionPanel.tsx:1953–1957; Bubble.tsx:79, :84
- **Problem**: Divider hairlines are hand-built as `<div className="flex-1 h-px bg-foreground/10">` (day separator) and `bg-primary/20` (autonomous marker). The design system defines `listTokens.ROW_SEPARATOR` (`border-primary/[0.06]`) as the single separator token; these ad-hoc `h-px bg-*` rules give the companion three different separator weights/colors from the rest of the app.
- **Fix sketch**: Standardize the hairline on the `ROW_SEPARATOR` token (or a shared `Divider` if the catalog has one), keeping a single weight/opacity across day separators, markers, and header dividers (`bg-foreground/15` at line 634).

## 5. Empty/loading states are bespoke rather than catalog `EmptyState`/`ListSkeleton`
- **Severity**: medium
- **Category**: state-coverage
- **File**: src/features/plugins/companion/CompanionPanel.tsx:1836–1840 (init loading), :1893 (empty transcript → WelcomeHero)
- **Problem**: The initial-load state is a hand-assembled `LoadingSpinner + span`, and the transcript never shows a skeleton while the 50-message fetch is in flight — the user sees a spinner row then a hard pop-in of bubbles. While `WelcomeHero` is a deliberate (good) rich empty state, the *loading* path has no `ListSkeleton`/`TableSkeleton` to preserve layout. Async lists elsewhere in the app use skeletons.
- **Fix sketch**: While `initialized && messages` is loading, render `feedback/ListSkeleton` rows instead of a single centered spinner so the transcript area reserves space and the bubbles don't jump in.

## 6. ConnectorCallCard error/retry tones use raw `text-rose-300/90` / `text-emerald-300/90`
- **Severity**: medium
- **Category**: token
- **File**: src/features/plugins/companion/ConnectorCallCard.tsx:127, :160, :171, :274–279, :293
- **Problem**: Inline error and success text uses one-off `text-rose-300/90` and `text-emerald-300/90` — a *third* alpha variant of the status hues (300 at /90, vs the card border's 500 at /30, vs `statusTokens` 400). Three shades of "error red" appear within one component, which a perfectionist reads as drift.
- **Problem cont.**: The `font-mono` error body is fine, but the color should come from one source.
- **Fix sketch**: Use `STATUS_PALETTE.error.text` / `.success.text` (the `*-400` tokens) for these tone strings so error/success text is a single hue app-wide.

## 7. Header icon-button cluster lacks `Tooltip`; relies on `title=` only
- **Severity**: medium
- **Category**: a11y
- **File**: src/features/plugins/companion/CompanionPanel.tsx:620–712 (search, autonomous, compact, doctrine, reset, close)
- **Problem**: Six icon-only header buttons communicate their function purely via native `title=`. The reference calls out "`title=` where `Tooltip` belongs." Native `title` has ~1.5s delay, no styling, doesn't show on keyboard focus, and is invisible on touch — for a dense flagship toolbar this is the weakest possible affordance. (`aria-label` is correctly present, so screen readers are fine; the gap is sighted-hover/focus discoverability.)
- **Fix sketch**: Wrap each header icon button in the catalog `Tooltip` (the `CopyButton` here already takes a `tooltip` prop, proving the pattern is available) and drop the redundant `title=`.

## 8. Approval/Proactive action buttons are raw `<button>` instead of catalog `Button`
- **Severity**: low
- **Category**: reuse
- **File**: src/features/plugins/companion/ApprovalCard.tsx:184–209; ProactiveCard.tsx:109–134; WelcomeHero.tsx:72–82; QuickReplies.tsx:43–58
- **Problem**: The primary/secondary action buttons hand-roll the full class string (`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-primary text-primary-foreground … hover:opacity-90 focus-ring`) plus a manual `Loader2 animate-spin` busy state. The catalog `buttons/Button` (with `variant="primary"|"ghost"` and a `loading` prop) covers this exactly, including the spinner swap. The hand-rolled versions are consistent with each other but drift from the app's Button (e.g. `hover:opacity-90` vs Button's hover treatment).
- **Fix sketch**: Adopt `Button variant="primary" loading={busy==='approve'}` etc.; the busy `Loader2` swap and disabled styling come for free and match every other CTA in the app.

## 9. Composer send-disabled-while-palette-open gives no visible reason
- **Severity**: medium
- **Category**: polish
- **File**: src/features/plugins/companion/Composer.tsx:302–304
- **Problem**: The Send button is disabled whenever the slash palette is open (`disabled={… || paletteOpen}`), but the only feedback is `opacity-40` — identical to the empty-draft disabled state. A user who has typed `/goals` and expects Enter/click to send gets a dimmed button with no hint that they must pick a preset first. State is technically covered but the *reason* isn't legible.
- **Fix sketch**: When `paletteOpen`, either keep Send visually active (Enter already routes to the palette pick) or add a `Tooltip` on the disabled button explaining "Pick a command or clear `/` to send." Minimal: don't disable on `paletteOpen` since Enter is already intercepted upstream.
