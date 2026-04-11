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

## Tier / Simple Mode System

- [2026-04-11] Three tiers: `starter` (Simple), `team` (Power), `builder` (compile-time devOnly). Internal values unchanged, only UI labels renamed
- [2026-04-11] `TIER_CYCLE` now `[starter, team]` — builder removed from runtime cycle. `TIER_LABELS` in `uiModes.ts` maps to display names
- [2026-04-11] Interface Mode selector moved from devOnly AccountSettings to Appearance settings (accessible in prod)
- [2026-04-11] `useTier().isStarter` (aliased `isSimple`) is the standard guard pattern — ~20 components use it
- [2026-04-11] Simple mode sidebar: Home, Agents, Connections, Settings. Hidden: Overview, Workflows, Events, Templates, Plugins (all `minTier: TIERS.TEAM`)
- [2026-04-11] Agent editor tabs hidden in Simple: Activity, Matrix, Lab (via `minTier` on tab defs in `EditorTabBar.tsx`)
- [2026-04-11] `CredentialDetailModals.tsx` returns null in Simple mode — no playground/vector/schema modals
- [2026-04-11] `ExecutionMiniPlayer.tsx` has `SimpleExecutionView` — progress bar during execution, result summary + copy button on completion

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

## i18n System Architecture

- [2026-04-11] Main i18n hook: `src/i18n/useTranslation.ts` — lazy-loads locale bundles, deep-merges with English fallback at all nesting depths (fixed from shallow 1-level merge)
- [2026-04-11] 14 supported languages: en, zh, ar, hi, ru, id, es, fr, bn, ja, vi, de, ko, cs. English is always synchronous; others lazy-loaded on demand
- [2026-04-11] Feature-scoped i18n hooks exist at `src/features/home/i18n/` and `src/features/home/components/releases/i18n/` — marked @deprecated, should be consolidated into main i18n in Phase 2
- [2026-04-11] Main en.ts home section (line 310) and feature home en.ts have DIVERGED: main has `roadmap` subsection, feature has `nav` subsection. `operator` value differs ("User" vs "Operator")
- [2026-04-11] `tokenMaps.ts` — Option A pattern for Rust backend tokens: machine tokens stay in DB/IPC, frontend resolves via `tokenLabel(t, category, token)`. 10 token categories covering all backend status enums
- [2026-04-11] `useTranslatedError.ts` — i18n bridge for error registry. Wraps `resolveError()` pattern with translated messages. Old `resolveError()` in `errorRegistry.ts` kept for backward compat
- [2026-04-11] ESLint rule `custom/no-hardcoded-jsx-text` (warn) — catches hardcoded JSX text and placeholder/title/aria-label attrs. Skips i18n/, test/, data/ directories
- [2026-04-11] Locale parity: `scripts/check-locale-parity.mjs` — en.ts has 1,622 keys; non-English locales have ~1,014-1,032 (62-64% coverage). Major gaps: chrome, status_tokens, error_registry sections
- [2026-04-11] ~3,800+ hardcoded English strings across 1,203 of 1,216 .tsx files. Only 17 files use useTranslation. Constants files (19+) have hardcoded English labels
- [2026-04-11] Pre-existing TS errors in AccountSettings.tsx (missing Sparkles, TIERS, TIER_LABELS imports) — unrelated to i18n work

## Open follow-ups (from Run #2, 2026-04-11)

- Ops panels don't persist their data across tab switches (each panel re-fetches on mount). Consider caching in agentStore if switching feels slow
- The Assertions panel shows enable/disable toggles but doesn't show individual pass/fail rates per assertion — the `OutputAssertion` type has `passCount`/`failCount` fields that could be displayed
- Lab panel only shows quick-launch for Arena and Improve modes — Breed and Evolve modes exist but are left out of the compact panel (intentionally — they're advanced features)
- The ops panels use `sendChatMessage` to trigger operations through the chat flow — this is convenient but means the user has to be in a chat session. A more direct invocation path via `chatOpsDispatch.ts` could bypass this
- Health panel uses the global `healthDigest` (runs across ALL personas) — a per-persona health check would be more targeted but requires a different API call

## Open follow-ups (from Run #3 — i18n Infrastructure, 2026-04-11)

- **Phase 2: Constants & Registries migration** — Migrate 19+ constants files (STATUS_CONFIG, FILTER_LABELS, CATEGORY_META, etc.) from hardcoded English labels to i18n key references using tokenLabel() or tLabel() pattern
- **Phase 3: Shared Components** — Translate 114 untranslated shared components (buttons, modals, forms, feedback) using useTranslation()
- **Phase 4: Backend Token Bridge adoption** — Wire tokenLabel() into all components that display execution/event/automation/severity/healing status badges (currently still using raw English tokens)
- **Phase 5-8: Feature module migration** — agents (303 files), vault (218), overview (152), then remaining features
- **Consolidate feature i18n hooks** — Merge home/releases locale files into main locale files, remove feature-scoped i18n directories. Note: home section has diverged (main has `roadmap`, feature has `nav`)
- **Backfill non-English locales** — 13 locales missing status_tokens (97 keys) and error_registry (89 keys) sections added in this run
- **Add parity check to CI** — Wire `scripts/check-locale-parity.mjs` into the build/CI pipeline as a quality gate
- **Rust backend error codes** — Replace hardcoded English format! strings in healing.rs, error.rs with error code tokens that the frontend can translate (currently Rust sends full English sentences over IPC)

## Agent Leaderboard

- [2026-04-11] Leaderboard feature at `src/features/overview/sub_leaderboard/` — 6 files: scoring engine, data hook, page, card, radar chart, index
- [2026-04-11] Composite score formula: Success (30%) + Health (20%) + Speed (20%) + Cost Efficiency (20%) + Activity (10%). All normalized to 0-100
- [2026-04-11] Data source: `PersonaHealthSignal[]` from `overviewStore.healthSignals` — already computed by the health dashboard pipeline. No new API calls needed
- [2026-04-11] Speed and Cost scores use fleet-average normalization (ratio to average, clamped 0-100). Activity uses max-relative normalization
- [2026-04-11] Medals: gold (#1), silver (#2), bronze (#3). Tiers: elite (80+), strong (60+), average (40+), developing (<40)
- [2026-04-11] SVG radar chart is pure SVG — no Recharts dependency. Supports 1-2 overlaid entries for comparison
- [2026-04-11] Wired as `OverviewTab = "leaderboard"` in sidebar with Trophy icon. Lazy-loaded via `lazyRetry()`

## Open follow-ups (from Run #6 — Leaderboard, 2026-04-11)

- The leaderboard auto-triggers `refreshHealthDashboard()` on first visit if health data is empty — this is expensive (~400ms). Consider adding a staleness check instead of always refreshing
- No per-agent drill-down from the leaderboard card — clicking shows the radar but doesn't navigate to the agent editor. Consider adding a "View Agent" link
- The cost scoring uses `dailyBurnRate` as proxy for cost-per-execution — this is imprecise for agents with variable execution frequency. A proper cost-per-success metric would be more accurate
- Radar chart doesn't support touch/hover tooltips — each axis vertex shows the dimension score value but not the raw metric. SVG title elements could help
- No comparison mode yet — the radar supports 2 overlaid entries but the UI only shows 1 at a time (the selected card). A "compare" checkbox or multi-select would enable side-by-side comparison

## BYOM / Local Models

- [2026-04-11] BYOM Settings UI at `src/features/settings/sub_byom/` — 5 tabs: Providers, API Keys, Cost Routing, Compliance, Audit Log. STAYS devOnly — local models don't work
- [2026-04-11] **DEFINITIVE: Local models CANNOT work with Claude Code CLI.** Two separate failure modes:
  1. Claude Code validates model names against Anthropic's list — rejects non-Anthropic model IDs before making any API call
  2. Even with LiteLLM proxy bridging the API format, local models (gemma4, qwen3.5) cannot handle Claude Code's internal tool-use system prompt — they output malformed tool-call JSON instead of text responses
- [2026-04-11] The failure is a MODEL CAPABILITY gap, not connectivity. Claude Code sends complex multi-tool system prompts (Bash/Read/Write/Edit tool definitions) that require Anthropic-level instruction following. Local 9-12B models cannot reliably follow this protocol
- [2026-04-11] LiteLLM proxy (pip install litellm[proxy]) successfully bridges Anthropic Messages API → Ollama, but the model responses are garbage because the model doesn't understand the protocol
- [2026-04-11] Codex CLI path is irrelevant — user confirmed the entire app is built around Claude Code CLI. Codex is dead code
- [2026-04-11] Ollama model quality for DIRECT API calls (not through Claude Code) is good — structured JSON, code review, multi-tool orchestration, planning all work. But this requires a separate execution path that bypasses Claude Code entirely
- [2026-04-11] **Native Ollama path IMPLEMENTED** in `src-tauri/src/engine/ollama.rs` (~240 LOC). When `model_profile.provider == "ollama"`, the runner bypasses CLI spawn and calls Ollama's `/api/chat` directly via reqwest streaming. Uses simplified prompt format (system + user, no tool-use protocol). Emits same `EXECUTION_OUTPUT` / `EXECUTION_STATUS` events as CLI path
- [2026-04-11] Integration point: `runner.rs` checks provider before the failover loop. If "ollama" → native HTTP path, else → CLI failover as before
- [2026-04-11] Frontend already has "Ollama (local)" in per-persona model config (`CustomModelConfigForm.tsx` line 30). Setting provider=ollama + base_url=http://localhost:11434 + model=gemma4 triggers the native path
- [2026-04-11] Pre-existing build errors in `commands/artist/ffmpeg.rs` (6 type mismatches) prevent `cargo build` but `cargo check` passes — native Ollama code is correct

## Open follow-ups (from Run #4 — BYOM, 2026-04-11)

- **Remove Codex CLI entirely** — dead code, user confirmed all app functionality is Claude Code only. Remove `src-tauri/src/engine/provider/codex.rs`, `EngineKind::CodexCli`, and all related frontend types/options
- **Remove dead Ollama env-var injection** — `apply_provider_env` (prompt.rs:758) sets OLLAMA_BASE_URL but Claude Code never reads it. Misleading dead code (native path uses reqwest directly now)
- **Test native Ollama path end-to-end** — requires running the Tauri app, creating a persona with provider=ollama, and executing it. The Rust code compiles but needs runtime validation
- **Add Ollama health check** — before execution, `GET /api/tags` to verify Ollama is running and the model is available. Currently fails at request time with a generic error
- **If local models are ever wanted**: build a native Rust execution path in the engine that calls Ollama's `/api/chat` directly with a custom prompt format (not Claude Code's tool-use protocol). Estimated 2000+ LOC
- Persona tags are not passed to BYOM compliance evaluation (runner.rs:625 passes `&[]`) — compliance rules based on workflow_tags will never match

## Obsidian Brain Plugin

- [2026-04-11] Frontend: `src/features/plugins/obsidian-brain/` — 4 sub-panels: Setup, Sync, Browse, Cloud. Now uses ContentLayout, SectionCard, AccessibleToggle, EmptyState, LoadingSpinner
- [2026-04-11] Backend: `src-tauri/src/commands/obsidian_brain/` — 5 module files: mod.rs (13 commands), conflict.rs, lint.rs, markdown.rs, semantic_lint.rs, drive.rs (new)
- [2026-04-11] Google Drive cloud sync via `drive.rs` — uses reqwest to call Google Drive REST API v3. Files stored in `Personas/ObsidianSync/<vault>/` in user's Google Drive
- [2026-04-11] Sync manifest (`.sync-manifest.json`) tracks content hashes per file — same hash-based comparison strategy as local vault sync
- [2026-04-11] Auth extension: `provider_token` from Supabase OAuth callback gives raw Google access token. Stored in `AuthStateInner.google_provider_token`. `provider_refresh_token` persisted in OS keyring
- [2026-04-11] `login_with_google_drive` command: separate re-auth with `drive.file` scope (incremental consent). Does NOT replace the base `login_with_google` — additive
- [2026-04-11] Supabase's `scopes=` query parameter on the authorize URL is how additional Google scopes get requested from code — no Supabase console change needed
- [2026-04-11] `ObsidianBrainTab` type extended to include `"cloud"` — stored in systemStore

## Open follow-ups (from Run #5 — Obsidian Brain, 2026-04-11)

- Google provider token refresh: currently only stored on initial OAuth; needs a refresh mechanism when the token expires (~1 hour). Should use `google_provider_refresh_token` from keyring
- Auto-sync to Drive: the local vault auto-sync flag exists but Drive auto-push is not wired up. Consider triggering Drive push after each local push
- Supabase Google provider must have the correct OAuth Client ID/Secret configured for the `drive.file` scope to appear in the consent screen
- Drive sync currently handles only flat files per folder — nested subdirectories within sync folders are skipped during pull (push handles them via recursive walk)
- The `obsidian_drive_status` and `obsidian_drive_push/pull_sync` Tauri commands need to be registered in `lib.rs` `generate_handler!()` macro to be callable from frontend
- BrowsePanel markdown rendering uses `prose-invert` — needs light theme override for `[data-theme^="light"]` to avoid invisible text
- No i18n for any Obsidian Brain UI text (all 4 panels hardcoded English)

## Lab Regression Testing

- [2026-04-11] LabMode extended with `"regression"` — 8th mode alongside arena/ab/matrix/eval/versions/breed/evolve
- [2026-04-11] Baseline pinning via localStorage (`dac-lab-baselines` key) — stores `BaselinePin { versionId, versionNumber, runId, pinnedAt }` per personaId
- [2026-04-11] VersionItem has Pin/Unpin Baseline buttons (Star icon) + golden "baseline" badge. Currently pins with empty runId — needs UX to link an eval run when pinning
- [2026-04-11] RegressionPanel uses existing `startEval` to run baseline + selected version as a 2-version eval. Results compared via `compositeScore` from `evalFramework.ts` (weights: 0.4 tool_accuracy, 0.4 output_quality, 0.2 protocol_compliance)
- [2026-04-11] RegressionResultsView shows overall verdict (pass/fail/improved), summary deltas per metric dimension, per-scenario breakdown with color-coded rows
- [2026-04-11] Regression threshold is configurable (default 5 pts) — fail if any scenario's composite score drops more than threshold vs baseline
- [2026-04-11] Regression nudge banner in VersionsPanel: appears when baseline exists AND newer non-archived versions exist. One-click navigation to Lab > Regression tab

## Open follow-ups (from Run #6 — Regression Testing, 2026-04-11)

- The "Pin as Baseline" action currently passes empty string for runId — should be linked to a specific eval run. Consider showing a run picker when pinning, or auto-selecting the most recent completed eval run for that version
- No auto-regression-on-save: prompt saves don't auto-trigger regression checks yet. A future enhancement could add a setting to run regression automatically on every prompt version creation
- No CI/CD integration: regression pass/fail verdict is UI-only. A Tauri command exposing the verdict programmatically would enable external CI hooks
- Regression results are ephemeral — they exist as normal eval runs, not tagged specially. Consider adding a `regression_check` tag to eval runs started from the Regression panel for filtering/history
- The compositeScore weighting (0.4/0.4/0.2) is hardcoded — consider making weights configurable per persona for specialized use cases
- No i18n for any regression panel text

## Prompt Version Timeline

- [2026-04-11] Timeline view at `src/features/agents/sub_lab/components/shared/PromptTimeline.tsx` — vertical connected timeline with version nodes, inline diffs between consecutive versions
- [2026-04-11] `TimelineEntry.tsx` — individual timeline node with expand/collapse, actions (promote/archive/rollback), tag badges, baseline indicator
- [2026-04-11] `InlineDiffPreview.tsx` — compact diff showing changed sections with word counts (added/removed). Uses existing `diffStrings` + `getSectionSummary` from labPrimitives
- [2026-04-11] VersionsPanel now has list/timeline toggle (persisted to localStorage as `dac-version-view`, default: timeline)
- [2026-04-11] Timeline renders versions newest-first, looks up previous version by `version_number - 1` for diff computation

## Open follow-ups (from Run #7 — Prompt Timeline, 2026-04-11)

- Timeline doesn't support multi-select for A/B comparison — the list view still has the A/B buttons for that workflow. Consider adding "Compare" action to timeline entries that switches to list view with pre-selected versions
- InlineDiffPreview only shows section-level changes (which sections changed + word counts) — doesn't show the actual text diff inline. Users need to switch to list view for full DiffViewer. Consider adding an "expand full diff" option per section
- No integration with the regression testing panel — timeline entries don't show whether a regression check was run against that version. The `baselinePin` is shown but not linked to regression results
- Timeline animations use `framer-motion` (already a dependency) — entrance animation has a staggered delay per entry. May need `layout` animations for smooth expand/collapse if performance becomes an issue with many versions
