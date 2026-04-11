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

## Light Theme System

- [2026-04-10] 3 light themes: `light` (warm beige #e9e6df), `light-ice` (cool blue #e8eff6), `light-news` (newspaper gray #e0ded9). All ~90% lightness
- [2026-04-10] `[data-theme^="light"]` CSS selectors target all light themes at once. Prefer this over individual theme selectors unless News needs monochrome override
- [2026-04-10] `bg-white/[0.015]` zebra striping is invisible on light themes — CSS now overrides to `rgba(0,0,0,0.035)`. Do NOT use `bg-white/*` for subtle backgrounds; use `bg-primary/*` or `bg-secondary/*` which adapt per theme
- [2026-04-10] `hover:bg-white/[0.02-0.05]` hover states invisible on light — CSS now overrides. Same rule: never use white-based opacity for hover on semantic surfaces
- [2026-04-10] Text color light overrides exist for: violet, emerald, cyan, amber, sky, rose, red, indigo, pink, teal, blue, purple, orange, slate, green, fuchsia, lime, zinc, yellow, gray. If using a NEW Tailwind color, add a `[data-theme^="light"]` override in globals.css
- [2026-04-10] `text-white/*` is dark-theme-only. Use `text-foreground/*` or `text-muted-foreground/*` for theme-safe text. CSS now overrides text-white/30-80 to foreground-based colors on light themes as a safety net
- [2026-04-10] Badge.tsx neutral variant now uses `bg-secondary/40 border-border/50 text-muted-foreground` instead of white-based — safe on all themes
- [2026-04-10] light-news `--accent: #555555` makes focus rings near-invisible. Fixed with explicit `--focus-ring-color: rgba(26,26,26,0.5)`. light-news also has stronger shadow-elevation values and darker glass-bg

## Build & Tooling

- [2026-04-02] TypeScript check: `npx tsc --noEmit` (tsc not on PATH directly on Windows)
- [2026-04-02] Lint: `npm run lint`
- [2026-04-02] Build: `npx vite build`
- [2026-04-02] Need `npm install` before first typecheck
- [2026-04-02] Tailwind 4.2 with Vite plugin — uses `@theme` namespace for token bridging
- [2026-04-02] React 19, Zustand 5, Framer Motion 12
- [2026-04-02] State management: Zustand with slice pattern in `src/stores/slices/`
- [2026-04-02] The app uses Tauri v2 APIs — imports from `@tauri-apps/api/*` and `@tauri-apps/plugin-*`

## Composition / Workflow System

- [2026-04-11] Multi-agent workflow feature lives at `src/features/composition/` — ReactFlow canvas, DAG execution, NL composer. Now wired into sidebar as "Workflows" section
- [2026-04-11] Composition store is `compositionSlice` in `src/stores/slices/pipeline/compositionSlice.ts` — uses localStorage (`__personas_workflows` key), NOT SQLite. Migration to Tauri backend DB is a future task
- [2026-04-11] `compile_workflow` Tauri command converts NL descriptions → team blueprints → workflow DAGs (calls Rust backend)
- [2026-04-11] Workflow execution walks topological order, executing persona nodes via `agentStore.executePersona()` with polling (500ms, 5min timeout). Tracks cost/tokens per node
- [2026-04-11] Custom sidebar icons are in `SidebarIcons.tsx` — each section has a hand-crafted animated SVG using `pi-breathe`, `pi-pulse`, `pi-flow`, `pi-scan` CSS animation classes

## Chat / Operations Hub

- [2026-04-11] Chat tab now has `OpsSidebar` wrapping `SessionSidebar` — icon rail at `src/features/agents/sub_chat/OpsSidebar.tsx` with 5 panels: Sessions, Run, Lab, Health, Assertions
- [2026-04-11] Compact ops panels live in `src/features/agents/sub_chat/panels/Ops*.tsx` — each panel is lazy-loaded
- [2026-04-11] `chatOpsDispatch.ts` handles operation JSON dispatch (health_check, list_executions, execute, edit_prompt, create_assertion, start_arena, start_matrix, list_reviews, approve/reject_review)
- [2026-04-11] `OpsLaunchpad.tsx` has 8 preset cards for chat operations; `AdvisoryLaunchpad.tsx` has 4 advisory-mode presets (Improve, Experiment, Analyze, Test Run)
- [2026-04-11] `SessionSidebar` no longer has its own width — `OpsSidebar` controls the outer 28rem width and SessionSidebar fills the remaining space after the icon rail
- [2026-04-11] Keyboard shortcuts: Ctrl+1-5 switch between ops sidebar panels

## Open follow-ups (from Run #1, 2026-04-11)

- Migrate composition workflows from localStorage to SQLite backend table (compositionSlice currently uses `localStorage.getItem('__personas_workflows')`)
- Add workflow items to the CommandPalette (currently only automation items from vaultStore are surfaced; composition workflows are not)
- Add workflow execution history to the Overview > Activity section
- Consider i18n of the WorkflowList and WorkflowCanvas UI text (currently hardcoded English)

## Open follow-ups (from Run #2, 2026-04-11)

- Ops panels don't persist their data across tab switches (each panel re-fetches on mount). Consider caching in agentStore if switching feels slow
- The Assertions panel shows enable/disable toggles but doesn't show individual pass/fail rates per assertion — the `OutputAssertion` type has `passCount`/`failCount` fields that could be displayed
- Lab panel only shows quick-launch for Arena and Improve modes — Breed and Evolve modes exist but are left out of the compact panel (intentionally — they're advanced features)
- The ops panels use `sendChatMessage` to trigger operations through the chat flow — this is convenient but means the user has to be in a chat session. A more direct invocation path via `chatOpsDispatch.ts` could bypass this
- Health panel uses the global `healthDigest` (runs across ALL personas) — a per-persona health check would be more targeted but requires a different API call
