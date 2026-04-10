# Harness Learnings — Personas Desktop

> Accumulated findings from codebase analysis. Fed into each harness session to prevent repeated mistakes.

---

## Typography System

- [2026-04-02] The `typo-*` CSS classes are defined in `src/styles/typography.css` and scale via `[data-text-scale]` attribute on `<html>`. Four tiers: compact (13px), default (14px), large (15px), larger (16.5px)
- [2026-04-02] `text-foreground`, `text-muted-foreground`, `text-primary`, etc. are COLOR classes, not SIZE classes — never replace these during typography migration
- [2026-04-02] `text-center`, `text-left`, `text-right`, `text-ellipsis`, `text-wrap`, `text-nowrap`, `text-balance`, `text-clip` are ALIGNMENT/OVERFLOW classes — never replace these
- [2026-04-02] Recharts components (XAxis, YAxis, Legend, Tooltip) use inline `fontSize` in tick/style props for SVG rendering — CSS classes don't apply to SVG text elements. Keep these as-is. The `sf()` helper function in chart components handles scale factor.
- [2026-04-02] `font-medium` (500) is the dominant weight class (638 files). When converting to `typo-body`, the class already sets weight 400 — if the original text was `text-sm font-medium`, evaluate whether the medium weight was intentional (e.g., emphasis) or just default styling
- [2026-04-02] `typo-heading` already includes `font-weight: 700` — don't add `font-bold` alongside it
- [2026-04-02] `typo-label` includes `text-transform: uppercase` and `letter-spacing: 0.15em` — strip any duplicate uppercase/tracking classes
- [2026-04-02] CJK languages override `typo-label` to remove `text-transform: none` — this is handled by CSS, no JSX changes needed
- [2026-04-02] For `text-[11px]` or other arbitrary Tailwind sizes, find the closest semantic class. 11px ≈ typo-caption at default scale

## i18n System

- [2026-04-02] Translation hook: `const { t, tx, language } = useTranslation()` — `t` is the nested object, `tx()` handles variable interpolation
- [2026-04-02] English file `src/i18n/en.ts` is the source of truth. Other locale files are partial — missing keys fall back to English automatically via shallow merge in the hook
- [2026-04-02] DO NOT translate brand names or technical terms — see the translator guide at the top of en.ts for the full list
- [2026-04-02] Key naming convention: `section.subsection.key_name` using snake_case for leaf keys (e.g., `agents.matrix.dimension_edit_title`)
- [2026-04-02] Pluralization: use `_one`, `_few`, `_many`, `_other` suffixes. Arabic also needs `_zero` and `_two`. Use `tx(key, { count })` for interpolation
- [2026-04-02] Only 11 files currently import useTranslation — sidebar, home, shared layout components. Everything else is hardcoded English
- [2026-04-02] The `useSidebarLabels()` hook in `src/i18n/useSidebarTranslation.ts` handles sidebar item label translation separately
- [2026-04-02] When adding keys to en.ts, add translator comments explaining context — this is critical for accurate translations
- [2026-04-02] `aria-label` attributes MUST also be translated for accessibility in non-English locales
- [2026-04-02] Some components use string templates (`\`${count} items\``) — these need `tx()` with interpolation, not direct t.* access

## Notification System

- [2026-04-02] OS notifications use `@tauri-apps/plugin-notification`: `isPermissionGranted()`, `requestPermission()`, `sendNotification({ title, body })`
- [2026-04-02] The notification center store (`notificationCenterStore.ts`) currently only handles pipeline notifications from GitLab CI/CD. It needs extension for background process notifications
- [2026-04-02] Notification persistence is in localStorage (`pipeline_notification_history`), max 50 items. Process notifications should use a separate key to avoid conflicts
- [2026-04-02] The toast system (toastStore) is for ephemeral feedback only — NOT for persistent notifications. Don't mix the two systems
- [2026-04-02] Healing toasts have their own priority system (critical/high/medium/low) — these are separate from process notifications
- [2026-04-02] The `sendAppNotification()` API function invokes a Tauri command — this is different from the notification center store. Evaluate whether to unify or keep both
- [2026-04-02] Background process state flags live in `uiSlice.ts`: n8nTransformActive, templateAdoptActive, rebuildActive, templateTestActive, connectorTestActive, contextScanActive
- [2026-04-02] Execution tracking is in `executionSlice.ts`, lab runs in `labSlice.ts`, matrix builds in `matrixBuildSlice.ts`, artist sessions in `artistSlice.ts`
- [2026-04-02] Sidebar badge priority system (lower = higher): count badges (1) > executing (2) > tests (3) > transforms (4) > scan (5) > completion dots (6)
- [2026-04-02] Only `contextScan` has redirect-on-completion: navigates to devToolsTab 'context-map'. Other processes lack this

## UX Patterns

- [2026-04-10] `focus-ring` CSS utility class defined in `src/styles/globals.css` — use it on all interactive elements for consistent keyboard focus. Don't mix with ad-hoc `focus-visible:ring-2` patterns
- [2026-04-10] `ConfirmDestructiveModal` at `src/features/shared/components/overlays/ConfirmDestructiveModal.tsx` supports blast-radius, type-to-confirm, and warning banners. Only used in 5 places; many destructive actions still lack confirmation
- [2026-04-10] Toast system: `useToastStore.getState().addToast(msg, 'error'|'success', durationMs)` — use for transient feedback. `toastCatch()` in `src/lib/silentCatch.ts` combines Sentry logging + user-visible toast
- [2026-04-10] `silentCatch()` logs to Sentry + console but shows nothing to users. For user-facing data fetches, use `toastCatch()` instead
- [2026-04-10] Mobile sidebar (IS_MOBILE) now has focus trap + Escape handler + backdrop click dismiss. Pattern can be reused for other mobile drawers
- [2026-04-10] Many views return `null` during loading instead of showing a spinner — always return a visual loading indicator. Use `LoadingSpinner` from `src/features/shared/components/feedback/LoadingSpinner.tsx` or inline spinner pattern

## Build & Tooling

- [2026-04-02] TypeScript check: `npx tsc --noEmit` (tsc not on PATH directly on Windows)
- [2026-04-02] Lint: `npm run lint`
- [2026-04-02] Build: `npx vite build`
- [2026-04-02] Need `npm install` before first typecheck
- [2026-04-02] Tailwind 4.2 with Vite plugin — uses `@theme` namespace for token bridging
- [2026-04-02] React 19, Zustand 5, Framer Motion 12
- [2026-04-02] State management: Zustand with slice pattern in `src/stores/slices/`
- [2026-04-02] The app uses Tauri v2 APIs — imports from `@tauri-apps/api/*` and `@tauri-apps/plugin-*`
