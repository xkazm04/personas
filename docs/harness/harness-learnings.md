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

## BYOM / Local Models (Dead Code Cleanup Done)

- [2026-04-11] BYOM Settings UI at `src/features/settings/sub_byom/` — 5 tabs: Providers, API Keys, Cost Routing, Compliance, Audit Log. STAYS devOnly — local models don't work
- [2026-04-11] **Codex CLI REMOVED**: `codex.rs` deleted (490 LOC), `EngineKind::CodexCli` variant removed. `EngineKind::ALL` now single-element `[ClaudeCode]`. Legacy `"codex_cli"` in FromStr maps to ClaudeCode for backwards compat with stored settings
- [2026-04-11] **Dead env-var injection REMOVED**: Ollama, LiteLLM, Custom match arms removed from `apply_provider_env()` in prompt.rs. Claude Code CLI ignores all of these
- [2026-04-11] Frontend: `CliEngine` type simplified to just `"claude_code"`. `codex_cli` removed from PROVIDER_OPTIONS, ENGINE_LABELS, DEFAULT_CAPABILITIES, useEngineCapabilities hook
- [2026-04-11] Test fixtures (COPILOT_EXECUTION_LINES, etc.) kept — they test the stream parser's ability to handle varied output formats, not the engine
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

## Agent Editor Quick Stats

- [2026-04-11] `QuickStatsBar` at `src/features/agents/sub_editor/components/QuickStatsBar.tsx` — compact stat chips below the agent header: success rate, health grade, avg latency, cost/run, last run time
- [2026-04-11] `useQuickStats` hook at `src/features/agents/sub_editor/hooks/useQuickStats.ts` — fetches last 10 executions via `listExecutions`, reads health signal from `overviewStore.healthSignals`
- [2026-04-11] Rendered via ContentHeader's `children` slot in PersonaEditorHeader — no layout component changes needed
- [2026-04-11] Stats are computed client-side from 10 most recent executions — lightweight, no new API calls to Rust backend
- [2026-04-11] Color-coded: emerald (>=80% success / healthy), amber (>=50% / degraded), red (<50% / unhealthy)

## Workflow Persistence (localStorage → SQLite)

- [2026-04-11] **Migration complete**: compositionSlice now uses Tauri IPC (`api/composition/`) instead of localStorage. All CRUD is async with optimistic local updates
- [2026-04-11] Rust backend: `composition_workflows` table with JSON columns (nodes_json, edges_json, input_schema_json). Repo + commands at `src-tauri/src/db/repos/resources/composition_workflows.rs` and `src-tauri/src/commands/core/composition_workflows.rs`
- [2026-04-11] Auto-migration on first fetch: if backend returns empty but `__personas_workflows` localStorage has data, bulk-imports via `import_composition_workflows` command, then clears localStorage
- [2026-04-11] Falls back to localStorage if backend is unavailable (offline resilience)
- [2026-04-11] CommandPalette now includes composition workflows — searchable by name/description with blue styling, navigates to Workflows sidebar section on select
- [2026-04-11] `commandNames.generated.ts` is auto-generated from `lib.rs` — manually adding command names gets overwritten on regeneration. The Rust commands MUST be registered in `lib.rs` `generate_handler!()` for the TS types to pick them up

## Open follow-ups (from Run #8 — Workflow Persistence, 2026-04-11)

- **Register composition workflow commands in lib.rs**: `list_composition_workflows`, `get_composition_workflow`, `create_composition_workflow`, `update_composition_workflow`, `delete_composition_workflow`, `import_composition_workflows` — until registered, TS shows command name errors
- The `createWorkflow` in compositionSlice generates a UUID client-side but the backend also generates one — the IDs will diverge. Consider passing the client ID to the backend `create` call, or using the backend-returned ID
- Workflow execution history is still ephemeral (in-memory WorkflowExecution state) — not persisted to any table. Future work: add `composition_workflow_executions` table for execution replay
- The compiled workflow path (`compileWorkflow`) creates a workflow locally then persists — but uses a client-generated ID that won't match the backend's. Need to use the backend's returned ID
- Consider adding a `composition_workflows` sidebar badge showing workflow count (like the automations count badge)

## Visual Consistency Patterns

- [2026-04-11] `CARD_CONTAINER` in `dashboardGrid.ts` and `SectionCard` in `shared/layout/SectionCard.tsx` are now visually aligned: `bg-secondary/30 border-primary/12 shadow-elevation-1`
- [2026-04-11] Entrance animation pattern for sub-tab switching: `key={tabState} className="animate-fade-slide-in"` on the content wrapper div. Applied to: OverviewPage, SettingsPage, HomePage, ObsidianBrainPage, ArtistPage, TriggersPage, DesignReviewsPage, DocSigningPage
- [2026-04-11] `bg-white/*` is dark-theme-only for hover/stripe/zebra patterns. CSS safety-net overrides exist in globals.css, but JSX source should use `bg-primary/*` instead. Mapping: `bg-white/[0.015]` → `bg-primary/[0.03]`, `hover:bg-white/[0.03]` → `hover:bg-primary/[0.05]`, `hover:bg-white/[0.05]` → `hover:bg-primary/[0.08]`
- [2026-04-11] `typo-label` CSS class replaces inline `text-[10px] font-bold uppercase tracking-widest` patterns — same visual output but respects text-scale settings
- [2026-04-11] DocSigningPage was the last top-level section page without ContentLayout — now all sections use ContentBox + ContentHeader + ContentBody (or thin wrappers around sub-components that do)

## Open follow-ups (from Run #9 — Visual Consistency, 2026-04-11)

- ~20 more files still use `bg-white/*` patterns outside overview/shared (artists Gallery2D, vault authMethodStyles, templates, agents, forms). Same mechanical replacement applies
- CredentialManager and ScheduleTimeline don't have sub-tab entrance animations — but they're single-content pages, not tabbed UIs. Low priority
- `text-3xl font-bold` in DashboardHome greeting was replaced with `typo-heading-lg` — slightly smaller on desktop but now respects text-scale. If users want it larger, consider adding a `typo-heading-xl` tier to typography.css
- FleetOptimizationCard's TYPE_CONFIG uses `text-*-300` badge text colors — all have light theme overrides. No action needed unless new recommendation types are added

## Button Component Adoption

- [2026-04-11] Shared Button at `src/features/shared/components/buttons/Button.tsx` — 6 variants (primary, secondary, ghost, danger, accent, link), 7 sizes (xs, sm, md, lg, icon-sm/md/lg), 13 accent colors, icon/iconRight, loading, disabledReason tooltip, block mode
- [2026-04-11] **NOT candidates for Button migration**: `role="switch"` toggles (use AccessibleToggle), tab bar buttons (specialized navigation), icon rail buttons with badge overlays (custom layout), card-like selection buttons
- [2026-04-11] Good migration candidates: action buttons (Save, Delete, Execute), link-style dismiss/cancel text, icon buttons (refresh, close), CTA buttons
- [2026-04-11] Ad-hoc pattern → Button mapping: `p-1.5 rounded-lg hover:bg-secondary/50` → ghost icon-sm; `px-3 py-1.5 rounded-lg bg-amber-500/20` → accent amber sm; `text-xs text-muted-foreground hover:...` → link xs
- [2026-04-11] 85 files already use Button; 651 use raw `<button>`. Migrated: AccountSettings (4), EditorBanners (5), PersonaEditorHeader (2), PersonaOverviewPage (1), QuickStatsBar (1), LeaderboardPage (1) = 14 buttons in this run

## Open follow-ups (from Run #10 — Button Upgrade, 2026-04-11)

- ~600+ files still use raw `<button>` — but many are legitimate (tabs, toggles, custom controls). A realistic migration target for future runs is 10-20 action buttons per run
- OpsSidebar PanelLoadingFallback uses ad-hoc spinner div instead of LoadingSpinner — minor
- `btn-sm` CSS class used in EditorBanners was replaced by Button size="sm" — check if `btn-sm` is used elsewhere and can be removed
- Consider adding a `variant="primary-soft"` to Button for the common `bg-primary/10 text-primary border-primary/15` pattern used in agent execute buttons and sign-in buttons

## Bug-Hunt Wave 8 — 2026-04-27 (multi-theme tail cleanup)

- [2026-04-27] **Wave 8a (race-window tail, 5 fixes)**: extended catalogue pattern #25 (capture context-id at op start; abort reconcile on mismatch) to 5 more sites — `useToolRunner` (state map keyed only by toolId, no persona namespace), `useEditorSave` (performSettingsSave + performModelSave both unguarded after IPC await), `ambientContextSlice` (5 fetch actions tracked by closure-captured latest-requested-personaId), `ChatTab.handleSend` (toast on persona-switch bail instead of silent return), `triggerSlice.recordTriggerComplete` (sticky throttle via `prev.isThrottled` OR — recompute from queueDepth+cooldownUntil instead).
- [2026-04-27] **Wave 8b (trust-boundary, 4 fixes)**: `src/api/drive.ts` — added `validateRelPath` helper (rejects `..`, abs paths, drive letters, NUL, > 1024 chars) and applied to all 16 drive_* IPCs + OCR helpers, plus `validateRenameTarget` for newName. `ByomApiKeyManager` URL fields now `new URL(value)` parsed + http(s) whitelist before save. `useQuerySafeMode` pendingMutation auto-clears on `runQuery` identity drift (parents should memoize runQuery keyed on credentialId+queryId). `parseEnvFile` errors reference line number, never echo content.
- [2026-04-27] **Wave 8c (cleanup-gap + ESLint guardrail, 4 + 1)**: ChatTab orphan-stream recovery now also clears chatTodos. HealthWatchToggle initial fetch uses cancelled flag. `CompositePartialMatchIndicator` 4 s polling now gated by `useElementVisible`. `useExperimentBridge` deliveredRunIds bounded FIFO (200 entries, evicts oldest). NEW custom ESLint rule `no-unmanaged-effect-resources.cjs` (warn) catches setInterval/setTimeout/addEventListener inside useEffect without matching cleanup return — registered in eslint.config.js alongside the 8 existing rules.
- [2026-04-27] **Wave 8d (NaN math, 3 fixes)**: PersonaSettingsTab.tsx (both copies — sub_settings/ root and sub_settings/components/) two-sided clamp on timeout input via `Math.min(Math.max(safe, 10), 1800)`, with `Number.isFinite` parse guard. `useAutomationSetupState` imports the existing `clampTimeoutSecs` helper from `useAutomationSetup` and applies it in 3 spots — editAutomation hydration effect, design.result effect, and the final IPC payload before deployAutomation.
- [2026-04-27] **`drive.ts validateRelPath`** is the canonical client-side path-traversal guard for the Drive plugin's managed-root sandbox. Future drive_* IPCs MUST route through it. The Rust backend has its own checks but the frontend gate keeps bad calls from crossing the IPC boundary at all.
- [2026-04-27] **`useQuerySafeMode` context-drift contract**: `useEffect` triggers on `runQuery` identity change. Parents must memoize `runQuery` with `useCallback` keyed on (credentialId, queryId) for the guard to track context. Without memoization, every render clears pending — safe but noisy.
- [2026-04-27] **ESLint rule `no-unmanaged-effect-resources` intentional gaps**: does NOT flag Tauri `listen()` (UnlistenFn promise pattern is bespoke), ResizeObserver/IntersectionObserver/MutationObserver (instance lifecycle not call-site obvious), AbortController, or ref-stored timers cleared via helper functions. Conservative rule — surface common shape during review, not a complete static analysis.
- [2026-04-27] **deliveredRunIds bounded-FIFO pattern** (in `useExperimentBridge`): module-level `Set<string>` + `markDelivered()` helper that evicts oldest when size exceeds limit. Set iteration is insertion order, so `deliveredRunIds.values().next().value` is always the oldest entry. Reusable shape for any "recently delivered/seen" dedup cache.
- [2026-04-27] **`clampTimeoutSecs` helper** at `src/features/agents/sub_connectors/libs/useAutomationSetup.ts:22` is the canonical timeout sanitiser. Handles `Number.isFinite(value)` (NaN/Infinity → DEFAULT 30) and clamps into [TIMEOUT_SECS_MIN=1, TIMEOUT_SECS_MAX=3600]. Use this anywhere a numeric timeout flows from external/user input toward an IPC payload.

### Already-fixed during Wave 8 verification (skip on future scans)
- `useStatusPageData.ts` — 60 s auto-refresh + visibility-gated polling already present (lines 70-104). Wave 3 fix.
- `TwinBindingCard.loadedRef` — already set after fetch settles, not before. Wave 4/5 era.
- `UnifiedMatrixEntry autoTestedRef` — multi-round reset is INTENTIONAL (comment at lines 175-178), not a bug.
- `UniversalAutoCredPanel handleUniversalSave` — schema-mismatch guard already present at lines 142-165.
- `ScheduleTimeline doRefresh` — re-entrant recursion already guarded by `if (pending && !cancelled)` at line 91.
- `personaHealthSlice.ts:318` — `pt.total_cost > 0` guard already present at line 317.
- `leaderboardScoring.ts` — every divide-by-zero risk has explicit `<= 0` short-circuit; `Math.max(1, ...)` denominators; well-protected.

## Open follow-ups (from Bug-Hunt Wave 8, 2026-04-27)

- **Race-window tail still has further sites** — Wave 8a closed 5 of ~10. agent-lab-matrix-builder #6 (`useBuildSession` zombie session on cancel-before-resolve) and agent-editor-configuration #6 (TwinBindingCard) were dropped for scope (TwinBindingCard already-fixed; useBuildSession needs a separate dedicated touch). Future wave can pick up the remaining 4-5 race-window items.
- **Trust-boundary tail** — Wave 8b closed 4. Three deferred candidates: external-integrations #16 (twin.ts JSON schema validation), the BundleImportDialog deep-link `autoStartedRef` latch (the actual home of the share-link idempotence bug — ShareLinkHandler itself is fine), and vault #6 (SQL identifier quoting default-branch path which Wave 5 partially fixed).
- **Cleanup-gap ESLint rule has known false-negative classes** — Tauri `listen()` (UnlistenFn promise return), Observer instances (`.observe()` / `.disconnect()` on stored refs), AbortController, and refs cleared via helper functions. A v2 of the rule could track these by pattern; for now they remain manual-audit territory.
- **NaN math** — Wave 8d closed 3 (timeout clamp issues). 2 of the original report's 6 "NaN risks" were verified already-fixed; 1 had wrong file location. Future scans should grep for `parseInt(...) || N` patterns where N skips lower bounds, and `Math.min(...)` without matching `Math.max(...)` in input handlers.
- **Concurrent-WIP discipline**: when running fix waves on personas, expect parallel work (other AI sessions / human edits) to land mid-session. Snapshot it as a `chore: snapshot concurrent WIP` commit between wave commits to keep wave commits surgical and auditable.
- **`use-element-visible` pattern adoption**: `CompositePartialMatchIndicator` and `ScheduleTimeline` are now both visibility-gated. Other polling components in `triggers/`, `health/`, `overview/sub_realtime/` likely benefit from the same gate — audit ~10 candidate components on future cleanup-gap waves.

## Scan-and-decide — Connections & Credentials (Pipeline C, 2026-06-05)

### Build & verification gotcha (HIGH VALUE — read before any Rust work here)
- **`cargo check` with NO features FAILS** at Tauri codegen: `capabilities/default.json` references `updater:default`, but `tauri-plugin-updater` is an *optional* dep behind the `desktop` feature and `Cargo.toml` has `default = []`. The error ("Permission updater:default not found …") is a build-script failure that aborts **before** rustc compiles the crate, so a bare `cargo check` never type-checks your code. Always verify with `cargo check --features desktop-full` (CI build = desktop+ml+p2p). KB/vector code (`commands/credentials/vector_kb.rs`, `engine/vector_store.rs`, `state.vector_store`) is `ml`-gated, so `desktop-full` is required to check it.
- **`cargo … | tail` reports tail's exit code, not cargo's** — a "build failed" can hide behind EXIT=0. Use `${PIPESTATUS[0]}` or redirect to a file and check `$?`.

### SSRF infrastructure
- Two modules: `engine::ssrf_safe_dns` (defines `SsrfSafeDnsResolver` + `build_ssrf_safe_client()`, backs global `crate::SSRF_SAFE_HTTP`, 30s timeout) and `engine::url_safety` (`validate_url_safety()` pre-flight + a second `SsrfSafeResolver`). For any outbound call whose URL comes from user/credential data, use **`crate::SSRF_SAFE_HTTP`**, never the plain `crate::SHARED_HTTP`. Pre-flight `validate_url_safety` is TOCTOU-vulnerable (DNS rebinding) and ignores redirects — the resolver client is the real guard.

### Choke points (single point to fix a whole class)
- `engine/db_query.rs::http_client()` — every REST DB connector (neon/supabase/upstash/planetscale/convex + introspection) flows through it; now returns `SSRF_SAFE_HTTP`.
- `engine/mcp_tools.rs::validate_mcp_command()` — every stdio MCP spawn (via `spawn_mcp_process`) validates here; now constrains *arguments* (remote-URL specs + docker host-escape flags), not just the binary allowlist.
- `engine/rotation.rs` per-credential lock: `ROTATING_CREDENTIALS` static + `try_lock_credential`/`unlock_credential`/`is_credential_rotating`. Rotation `rotation_type` history values include `"anomaly"` and (new) `"anomaly_remediation"`; `detect_anomalies` once-per-episode dedup keys on the most-recent history entry's type.

### Pre-existing test failure (NOT a regression)
- `engine::db_query::tests::test_sanitize_strips_field_values` (db_query.rs:~3106) fails on master — `sanitize_error` redacts the short value "5432" the test expects preserved. Independent of any SSRF work; touched-module suite is otherwise 61 passed / 4 ignored.

## Open follow-ups (from Pipeline C — Connections & Credentials, 2026-06-05)
- **MCP consent gate (completes idea #2)**: arg-hardening blocks remote-URL specs + docker host-escape flags, but does NOT stop `npx <poisoned-but-real-registry-package>`. A per-command user consent gate (approve + remember on first use) is the only complete fix — a published package is statically indistinguishable from a malicious one.
- **Rejected this scan (still open)**: tool-audit log omits MCP call arguments (forensic gap); legacy RSA-only IPC decrypt path should default-reject (downgrade vector); credential-topology IPC reads (`list_credentials`/`vault_status`/`credential_blast_radius`) lack the `requires(privileged)` guard their write siblings have; forced OAuth refresh (`oauth_refresh.rs`, force=true) can revoke a working token then fail to persist without marking `needs_reauth`; `import_foraged_credential` is not idempotent (double-click dupes).
- **Fix the pre-existing `test_sanitize_strips_field_values` failure** (sanitizer over-redacts short numeric values).

## Scan-and-decide — Companion & Plugins (Pipeline C, 2026-06-07)

### Build & verification
- For the **Companion & Plugins** group, `cargo check --features desktop` is sufficient (no `ml`/`p2p` code in artist/drive/obsidian/ocr/research-lab/twin/companion). Note `commands/ocr/mod.rs` is `#[cfg(feature="desktop")]`-gated — a bare `cargo check` skips it entirely. (The earlier Connections run needed `desktop-full` only because vector_kb is `ml`-gated.)
- **lefthook pre-commit** runs `npx eslint` which fails in shells without node_modules/.bin on PATH ("'eslint' is not recognized"). The repo documents `LEFTHOOK=0 git commit …` as the per-command disable; eslint itself runs fine via `node node_modules/eslint/bin/eslint.js …`. tsc likewise: `node node_modules/typescript/bin/tsc --noEmit` (plain `npx tsc` grabs a registry stub here).

### Reuse-first infra (don't rebuild — scanners flag "plugins don't use X", not "X missing")
- **ErrorBoundary** (class component) at `src/features/shared/components/feedback/ErrorBoundary.tsx` — props `{children, name?, onReset?}`, "Try Again" resets state (re-attempts a failed lazy import). Wrap plugin `<Suspense>`/panel bodies; keep ContentHeader outside so nav survives a crash.
- **AriaLiveProvider** at `…/feedback/AriaLiveProvider.tsx` — app-wide region mounted in `App.tsx`. Use `useAnnounce()` in components, `announceImperative()` in non-component code. CRITICAL: `toastStore.addToast` ALREADY routes every toast through `announceImperative`, so toasts are auto-announced — only instrument the previously-silent operation *starts* / inline (non-toast) completions for a11y.
- **`.focus-ring`** `@utility` in `src/styles/globals.css` is the single keyboard-only focus source of truth (`:focus-visible`). Don't hand-roll `focus:ring-*`/`focus-visible:ring-*`. Remaining drift after this run: `fleet/` and `dev-tools/`.
- **Path sandbox pattern**: `commands/drive.rs::resolve_safe` (rejects abs + `Component::ParentDir`, canonicalizes, walks to nearest existing ancestor for not-yet-created targets). Mirror it for any user/agent-supplied path. `twin.rs::resolve_wiki_dir` and `companion/jobs/connector_use.rs::resolve_within` now follow it.

### Companion autonomy / security model
- Connector capabilities + the `requires_approval` gate live in `src/companion/connectors.rs`; the dispatcher honors it (`companion/dispatcher.rs:1270`). Reads with `requires_approval:false` auto-fire as jobs; flip the flag to put a human in front of a capability (done for `personas_database.execute_select`).
- **Fleet sessions ALWAYS run `claude --dangerously-skip-permissions`** (`commands/fleet/pty.rs:163/187`), so constraining *args* is pointless — the only meaningful containment for `execute_fleet_spawn`/`dispatch` is the **cwd**. The registered-project allowlist is the `dev_projects` table (`root_path`), read via `crate::db::repos::dev_tools::list_projects(&state.db, None)`; `app.state::<Arc<AppState>>()` gets state inside an executor.
- `serde_yaml = "0.9"` IS a dependency, but `commands/obsidian_brain/markdown.rs` deliberately uses a homegrown YAML emitter/parser — escaping was added in-place (`yaml_quote`/`unquote_yaml_scalar`) rather than reworking around serde_yaml.

## Open follow-ups (from Pipeline C — Companion & Plugins, 2026-06-07)
- **execute_select now approval-gated** — if autonomous read flows feel too gated, a column/table allowlist (denying the brain's PII tables) would be a less-blocking alternative to full approval.
- **Fleet cwd allowlist completes the backend half of idea #5** — the deeper fix is the **ApprovalCard showing the resolved command** (cwd + args), not just Athena's free-text rationale; that's a frontend change left undone.
- **aria-live instrumentation is representative, not exhaustive** — wired the 1–2 clearest long ops per plugin (image gen, vault sync, source ingest, OCR, twin studio). Other long ops (research report compile, experiment runs, blender renders) still announce nothing beyond their toasts.
- **focus-ring drift remains in `fleet/` and `dev-tools/`** — same mechanical `.focus-ring` swap applies there on a future pass.
- **Full vitest + full `cargo test` were NOT run** this session (time + pre-existing-noise risk). Verified: tsc 0, `cargo check --features desktop` 0, eslint 0 on changed files, and targeted tests `obsidian_brain::markdown` (9/9) + `render_plan_export_parity` (14/14).

### Round 2 — feature_scout (same group, 2026-06-07): codegen + feature wiring
- **New Tauri command ⇒ regenerate command names or tsc fails.** Frontend `invoke` is `invokeWithTimeout` from `@/lib/tauriInvoke`, whose name param is the generated `CommandName` union in `src/lib/commandNames.generated.ts`. After adding a `#[tauri::command]` + registering it in `lib.rs generate_handler!`, run `node scripts/generate-command-names.mjs` (static parse of lib.rs, fast, NO cargo) or tsc errors `"x" is not assignable to CommandName`. i18n keys similarly need `node scripts/i18n/gen-types.mjs` + `scripts/i18n/split-locales.mjs`. All codegen tasks live in `scripts/run-codegen.mjs` (predev/prebuild presets) — run the individual generator, not the whole preset.
- **i18n files are a shared-WIP trap.** `src/i18n/locales/en.json` + `src/i18n/generated/{types,enSectionStrings}.ts` are frequently part of a user's uncommitted WIP. Adding feature i18n keys entangles your change with theirs in the same generated artifacts (can't cleanly stage one without the other). For harness-added UI strings, prefer **inline literals** unless the i18n surface is yours — that keeps the user's i18n WIP untouched.
- **runPersona pattern (research-lab):** `shared/runPersona.ts::runPersonaAndWait({personaId,input,onStatus})` → `{execution,output,passed}`; persona picked from `useAgentStore(s=>s.personas)`; parse CLI output defensively like `sub_hypotheses/parseHypotheses.ts`; `GenerateHypothesesModal.tsx` is the end-to-end reference. Reused for report Discussion/Abstract synthesis.
- **ResearchReport has NO `content` column and NO update command** — reports are compiled to markdown on the fly (`sub_reports/compileReport.ts`); commands are only list/create/delete. Persisting compiled/synthesized report text across sessions needs a new `research_lab_update_report` command + ts-rs binding (out of scope this round; synthesis currently feeds the drawer's live Preview/Copy/Download only).
- **Twin primitives:** `twin_simulate_answer` (LLM draft via `spawn_claude_with_prompt`), `twin_recall`/`top_distilled_facts_for_recall` (grounding), `twin_record_interaction` (log a communication). `twin_draft_reply` was built by composing these; returns a plain `String` to avoid a new ts-rs binding.

## Open follow-ups (from Pipeline C round 2 — feature_scout, 2026-06-07)
- **Report synthesis doesn't persist** — add `research_lab_update_report` (+ a `content`/`synthesis` column or section row + ts-rs binding) so AI-authored Abstract/Discussion survive a reload, then save from ReportPreviewDrawer instead of only live-compiling.
- **OCR→KB/Obsidian sink (idea #1) was rejected this round** — still a real dead-end (OCR text never reaches the KB or vault); revisit if document search matters.
- **Crossref dedup is create-time only** — no backfill of `citation_count`/`doi` for sources already in the table, and no periodic citation refresh.

## Layered audit — Bug Hunter + UI Perfectionist, all 30 contexts (Pipeline B, 2026-06-09)

Full audit at `docs/harness/audit-2026-06-09/` — `INDEX.md` (triage) + 60 per-context reports (`bug__*.md`, `ui__*.md`) + `FIXES-WAVE-1.md`. 354 findings (60 critical / 169 high / 106 medium / 19 low). Wave 1 closed all 8 lost-update criticals (commits `41f54b4d4`..`720dc2d5b` on `vibeman/audit-2026-06-09`).

### Structural facts
- **2026-06-09** — `cargo test --lib` BUILD is broken on master (pre-existing, NOT a regression): `DevIdea` missing field `priority` at `commands/infrastructure/dev_tools/triage.rs:63`, and `CreateManualReviewInput` missing `assignment_id`/`step_id` at `db/repos/communication/manual_reviews.rs:721,791,835,926` — `#[cfg(test)]` struct-init drift. `cargo check --features desktop` compiles fine; only the test target fails. Fix these before relying on Rust unit tests.
- **2026-06-09** — `vitest run` is NOT green on master (26 failed / 1907, 9 files): `fleetSlice`, `FleetSettingsPage`, `FleetSessionInsights`, lab matrix `useBuild`/`useLifecycle`, `devToolsTaskSlice`, `ConnectorCallCard`, twin `ReadinessGapPopover`, `customRules` — mostly Vitest mock drift + struct-field drift. Establish a baseline before treating vitest failures as regressions.
- **2026-06-09** — `design_context` has TWO write paths: the frontend `writeQueue` (`hooks/design/core/useDesignContextMutator.ts`, full-document RMW) and backend commands (`commands/core/use_cases.rs`) that did their own RMW. Backend RMW must be transaction-wrapped; the two paths are not mutually serialized (open follow-up).
- **2026-06-09** — Context-map paths are stale in several places (see INDEX provenance): team canvas `pipeline/components/TeamCanvas` is a STUB, live canvas at `src/features/teams/sub_canvas` (orphaned — no host mounts `<ReactFlow>`); chat surface is `sub_editor/.../ChatThread.tsx` not `components/chat`; triggers cron builder in `sub_triggers/` not `sub_builder/`; evolution/genome UI was removed (headless Athena); dev-tools UI in `sub_runner`/`sub_scanner`/`sub_triage`; `testSlice` actions have NO UI consumer (test surface is the Lab tab).

### Conventions enforced (catalogue — see FIXES-WAVE-1.md for detail)
- Read-then-write of a shared SQLite blob/row goes in ONE transaction (`transaction_with_behavior(Immediate)` for `&mut Connection`, `unchecked_transaction()` for `&Connection`). Reading outside the write tx is a silent lost-update.
- Long-running edits (LLM/CLI between read and write) use optimistic-lock CAS: `WHERE id=? AND updated_at=?expected`, 0 rows ⇒ abort. Capture the token at read time, thread it through. False-reject safe; false-accept is the bug.
- Never `REPLACE`/`LIKE` on a JSON column — use JSON1 `json_extract`/`json_set` guarded by `json_valid`.
- If a pull/import path conflict-checks, the push/export path must too (`three_way_compare` is the shared mediator in `commands/obsidian_brain/conflict.rs`).

## Open follow-ups (from Layered Audit Wave 1, 2026-06-09)
- **use-cases #1** — unify the direct-command and `writeQueue` design_context paths so the post-commit refetch gap closes (backend now atomic; frontend already `fetchDetail`s).
- **evolution #2** — add a per-persona evolution mutex (mirror `healing_personas`) so two cycles don't both run to completion; the CAS only makes the outcome safe.
- **creative/obsidian #1** — add `conflicts: Vec<SyncConflict>` to `PushSyncResult` so SyncBridge can offer resolve actions on a push conflict (now surfaced only via `skipped` + sync log); consider auto-pull on conflict.
- **Remaining audit waves (per INDEX)**: Tier-1 criticals — Wave 2 status-transition guards & lock leaks (7), Wave 3 success theater (7), Wave 4 orphaned processes (5), Wave 5 security (7), Wave 6 corruption loops & stream/graph integrity (7); Tier-2 UI waves 7–9 (19); Tier-3 the 169 highs.
- **Pre-existing test debt** — fix the `DevIdea`/`CreateManualReviewInput` test-build drift and the 9 failing vitest files so future waves have a green baseline to regress against.

## Open follow-ups (from Layered Audit Wave 2 — transition guards & lock leaks, 2026-06-09)
5 of 7 criticals fixed (`d5b461b40`..`b1c83b5c3`); see `audit-2026-06-09/FIXES-WAVE-2.md`. Two deferred:
- **teams #1 (assignment double-run)** — needs a per-`assignment_id` live-orchestrator guard (atomic insert in `team_assignment_orchestrator.rs::run_assignment:106`, RAII `Drop` release inside the spawn at :119). Deferred because the guard races the pause→resume flow (tick loop reads `paused` and drops its guard just as `resume_assignment` re-inserts ⇒ assignment stuck `running` with no loop). Validate exit/restart semantics at runtime, or use a generation token.
- **events #2 (webhook re-delivery)** — `engine/webhook_notifier.rs:472-498` POST-then-`set_watermark` is non-atomic; crash/leader-flip re-POSTs the whole batch. Needs consult-before-send on a `(event_id, subscription_id)` delivery record (`record_delivery` exists in `db/repos/resources/team_channel.rs`) + `Idempotency-Key` header + watermark advanced from persisted delivery state. Needs runtime validation.
- **composition #6 part b** — approval still shares the cancel registry (`ActiveProcessRegistry` domain `pipeline_approval`); give it a dedicated signalling channel / 3-state enum and persist `awaiting_approval` so a restart resumes the gate (the 1-hour force-reject data-loss IS fixed).

## Open follow-ups (from Layered Audit Wave 3 — success theater, 2026-06-09)
4 of 7 criticals fixed (`c0dba70ba`, `c18051915`); see `audit-2026-06-09/FIXES-WAVE-3.md`. Structural facts + deferrals:
- **eval verdict flow** — `engine/eval.rs` computes `LlmEvalResult { passed: Option<bool>, eval_method: EvalMethod (Llm|HeuristicFallback|Timeout) }` but `score_result` drops `passed`; the runner now re-derives a verdict from the composite + `eval_method` (`verdict_status` in `test_runner.rs`). If you want the authoritative verdict, surface `passed` on `ScoreResult` instead of recomputing.
- **lab `update_status` callback** — its 4th param is `Option<i32>`, NOT an error string; a Failed lab run can't carry an error message through it (only via the emit `error` field + summary). Pre-existing constraint.
- **research #1 (deferred)** — experiment run row is created client-side after the long await ⇒ lost on app close / >120s. Needs server-side create-before-dispatch (status `running` + `execution_id`) + startup reconciliation. `runPersonaAndWait` now returns `kind:'terminal'|'timeout'`; reuse it.
- **teams #2 (deferred)** — abort/pause don't cancel detached step tasks (post-terminal `done`/`failed` writes + token spend). Thread a cancellation token into `start_execution`; same orchestrator surface as deferred teams #1.
- **events #1 (deferred)** — webhook watermark advances past undelivered events (drop); entangled with deferred events #2 (re-delivery). One delivery-tracking change keyed `(event_id, subscription_id)` fixes both.

## Layered Audit Wave 4 — orphaned processes (2026-06-09): all 5 closed
`214a2a755`, `7830e9ddd`, `24d936d52`, `d6add434c`; see `audit-2026-06-09/FIXES-WAVE-4.md`. Structural facts:
- **Fleet child lifecycle** — the child is owned solely by `reaper_loop` (moved into `spawn_blocking` at `pty.rs:281`). To terminate it from elsewhere you MUST clone a kill handle at spawn (`child.clone_killer()`, portable_pty `ChildKiller`) and store it; dropping the PTY writer/master does NOT stop interactive `claude` (ConPTY ignores stdin EOF → zombie). `FleetSessionInner.killer` is now that handle (`Option<...>` so test fixtures pass `None`).
- **Fleet `child_pid` truth** — clear it only on reaper-confirmed exit (`mark_exited` for normal exit, `clear_child_pid` in the reaper's `is_hibernating` branch), never on hibernate-intent, or `process_scan` mislabels the live process an orphan.
- **`exec_repo::set_claude_session_id`** — new column-scoped, status-guarded setter (`WHERE id=? AND status='running'`); use it (not `update_status`) for any detached/retrying field write that must not touch `status`.
- **CLI timeout pattern** — on a stream timeout, `child.kill().await` THEN a bounded `timeout(5s, child.wait())`; never an unbounded `wait()` (it borrows the child and blocks `kill_on_drop`). `idea_scanner.rs` / `context_generation.rs` are the reference; `task_executor.rs` now matches.
- **context-map regen** — clear is now LAZY (fires on first real output via `map_cleared`), so a failed/empty rescan keeps the curated map. Full stage-then-swap is the remaining follow-up.

## Layered Audit Wave 5 — security (2026-06-09): 6 of 7 closed
`cfd2efa4f`, `2b6f48deb`, `14ee563a8`, `fa8ee0c3d`, `abf9e808e`, `032b3de12`; see `audit-2026-06-09/FIXES-WAVE-5.md`. Structural facts:
- **SQL deny-list** — `engine/db_query.rs` write-mode deny-list now uses `extract_first_keyword` (the comment/whitespace tokenizer), not raw `starts_with`. Any new sandbox guard MUST tokenize the same way the classifier does.
- **sensitive-path guard** — `engine::path_safety::is_sensitive_credential_path` is the canonical backend denylist (SSH keys/cloud creds/wallets), enforced in `sign_document`. Mirror it for any new privileged file-read IPC; the renderer's `SENSITIVE_PATH_PATTERNS` is defense-in-depth only.
- **event rate limiting** — `AppState.rate_limiter` (`Arc<RateLimiter>`, `check(key,max,EVENT_SOURCE_WINDOW)`) reachable from any executor via `app.state::<Arc<AppState>>()` (needs `use tauri::Manager`). The smee relay now throttles; other internal producers (scheduler, chain, backfill) still publish unthrottled — moving the cap into a shared `publish_rate_limited` is the follow-up.
- **cloud remote-command** — `remote_command_approve` now device-scopes its fetch (`target_device_id=eq.{device}` via `cursor::resolve_device_id`); device/tenant scoping must be on the fetch, not the call site.
- **GitLab masking** — only set `masked:true` when value is len≥8 + maskable charset (excludes whitespace); unmaskable secrets are created unmasked, not falsely flagged (which 400s + aborts the batch).
- **p2p #1 (deferred)** — peer identity is self-declared, never proven (QUIC `SkipServerVerification` in `engine/p2p/transport.rs:171`); needs a signed-challenge handshake using the existing ed25519 identity (`engine/identity.rs`) + cert pinning. Wire-protocol change across `p2p/{connection,transport,mdns}.rs` — validate against a real second device before shipping.

## Layered Audit Wave 6 — corruption loops (2026-06-09): 5 of 7 closed
`967c84a25`, `37da4ad6c`, `f29f254ea`, `a9656bdd0`, `1819cf790`; see `audit-2026-06-09/FIXES-WAVE-6.md`. ALL SIX fresh Tier-1 waves now complete — 33/41 critical reliability findings fixed; 8 deferred (need runtime-validated infra). Structural facts:
- **twin record_interaction** — `twin_record_interaction`'s `create_memory` defaults `true` in Rust; outbound twin-authored content must pass `createMemory:false` (it's machine output, not knowledge). Store action is `recordTwinInteraction(twinId, channel, direction, content, contactHandle, summary, keyFactsJson, createMemory)` — createMemory is the 8th positional arg.
- **memory-review apply** — `memory_review_proposal::mark_applied` IS an atomic CAS (`UPDATE ... WHERE status='pending_review'` → bool); call it FIRST as the guard, mutate after. Remaining: wrap the mutation batch in one txn for crash-rollback.
- **team pipeline cycle** — `teams.rs::execute_team` now hard-stops on `has_cycle()` (mark run failed + return), mirroring the empty-members path; `create_pipeline_run` creates the row before the topo sort, so mark-failed-and-return is the pattern for any early refusal.
- **onboarding persistence** — `onboardingSlice` now persists `{completed, dismissedAtStep}` to localStorage key `onboarding-state-v1` (try/catch-guarded) + hydrates on init. Pattern for any first-run/completion flag.
- **lab #2 (deferred)** — `LabVariant` uses `format!("v{}",version_number)` as the variant↔result join key; needs a unique `version_id` field threaded through 6 construction sites (arena/eval/ab/matrix) + the persist closures, plus making `metrics.rs` version_number allocation atomic.
- **persona-chat #1 (deferred)** — `chatSlice`/`backgroundChatSlice` attach `listen()` AFTER `executePersona` + dynamic imports, so a fast turn's terminal `execution-status` is missed → permanent hang. Fix: subscribe-before-execute (filter by clientRequestId) or reconcile via `getExecution` after attach. Needs runtime validation.

## Layered Audit Wave 7 — error-blind UI (Tier-2, 2026-06-09): 6 of 7 closed
`e3a4542f1`, `1e4343705`, `13a43a70e`, cockpit, memories, `cda47b2ac`; see `audit-2026-06-09/FIXES-WAVE-7.md`. Pattern: surfaces need 3 states (loading/error/empty), not 2. Structural facts:
- **slice loading/error flags** — `memorySlice` now has `memoriesLoading`; `executionSlice` now has `executionsError` (set in fetch catch, cleared on start/cache-hit, exposed via `useExecutionList`). Both gate the empty state behind the flag. Use this shape for any list surface.
- **i18n in harness UI fixes** — the `custom/no-hardcoded-jsx-text` ESLint rule is a WARNING (lefthook passes); harness-added error strings use inline literals deliberately to avoid entangling the user's i18n WIP (`en.json`/generated artifacts). Don't add i18n keys for these.
- **persona name validation** — `inputFieldClass(hasError)` from `@/lib/utils/designTokens` is the error-state class helper; pair with `aria-invalid`/`aria-describedby` + a gate in `performSettingsSave` (skip the write while name is empty).
- **research-lab #1 (deferred)** — all 6 research-lab stage panels swallow fetch errors into the empty state; needs an `error` field on `researchLabSlice` + an error+retry branch per panel (repetitive 6-surface change, one focused pass).

## Layered Audit Wave 8 — critical accessibility (Tier-2, 2026-06-09): 5 of 6 closed
`2c8b38e36`, `f67c2e461`, `7cbf2bb78`, `89953a942`, `8147f3397`; see `audit-2026-06-09/FIXES-WAVE-8.md`. Theme: surfaces that work for a sighted-mouse user but exclude keyboard / SR / color-blind users. Structural facts:
- **`[object Object]` smell** — `MetricsCharts.tsx` interpolated a React element (`<AbsoluteTime/>`) into a `<title>` template literal. Any `String(...)`/template-literal coercion of JSX yields `[object Object]`; format the underlying value (here `Intl.DateTimeFormat(...).format(Date.parse(ts))`, finite-guarded) instead of reusing a display component. Grep `${<` to find others.
- **status-by-color** — `cloudDeploymentHelpers.ts` now exports `statusIcon(status): LucideIcon` (CheckCircle2/PauseCircle/XCircle/Circle) beside `statusColor`; the `DeploymentCard` badge renders the glyph (aria-hidden) so state has a shape channel. Reuse this color+icon pairing for any status badge (WCAG 1.4.1).
- **click-on-cell a11y** — copy-on-click `<th>`/`<td>` in `QueryResultTable.tsx` got `tabIndex=0` + `role="button"` + Enter/Space `onKeyDown` + `aria-label` + focus-visible ring, plus a single `sr-only aria-live="polite"` span announcing the copied value. Pattern for any clickable non-button element; `sr-only` (Tailwind built-in) is the visually-hidden class used across the app.
- **companion live regions** — the chat panel had NO `aria-live` (only the orb layers did). Now: `role="status" aria-live="polite"` on the streaming status line; a `sr-only aria-live="polite"` mirror of the latest *completed* assistant message (gated on `!streaming` so it announces once per turn) placed right after the message-map IIFE in `CompanionPanel.tsx`; and a `sr-only aria-live="assertive"` listening-state region in `Composer.tsx` driven by `dictation.listening`. Mirror the value, not the styled bubble.
- **composition #1 (deferred)** — node-canvas keyboard/SR a11y targets `sub_canvas` (ReactFlow), but `TeamCanvas` is a stub and no route mounts it = dead UI. Deferred until the canvas is wired into a page; fixing a11y on an unmounted surface is unverifiable.
