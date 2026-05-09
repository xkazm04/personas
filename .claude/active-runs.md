# Active Runs Ledger

Coordination surface for CLIs (Claude Code agents, manual sessions, skill
invocations) operating concurrently on this checkout. Each session that
materially edits the working tree should touch this file twice:

1. **At session start (Phase 0):** read this file, scan `## Active` for
   running entries. If any entry's declared paths overlap with this
   session's planned scope AND the entry is less than 2 hours old AND its
   status is `started`, surface the conflict to the user before proceeding
   (options: abort, coordinate, or proceed-with-awareness). Then append
   your own entry under `## Active`.
2. **At session end (Phase 11/13):** move your `## Active` entry to the
   top of `## Recently completed`, update its status to `completed (commit:
   <sha>)` or `aborted (<reason>)`. Trim entries older than 14 days from
   `## Recently completed`.

If your session crashes, your entry stays under `## Active` with a stale
timestamp — the next session can recognize it as abandoned.

## Conventions

- Timestamps are local time, format `YYYY-MM-DD HH:MM`.
- `Paths` declares the directories or globs the session expects to read or
  write. Be specific enough that overlap is meaningful (`src/features/agents/sub_chat/`
  is good; `src/` is too broad to be useful).
- The `## Active` section is the source of truth; `## Recently completed`
  is a rolling history window.
- Concurrent edits to this file: re-read on Edit failure, repeat the
  conflict check, retry. The Edit tool's unique-old-string rule prevents
  silent clobbers.

## Active

- **[2026-05-09 ~21:15] /research — cli-coordination-active-runs (design + execute)**
  - **Source:** in-session conversation following Claude+CapCut run; user request to design and execute the active-runs ledger right away
  - **Paths:** `.claude/active-runs.md`, `.claude/CLAUDE.md`, `.claude/skills/research/skill.md`, `docs/concepts/cli-coordination-active-runs.md`, `docs/concepts/README.md`
  - **Status:** started — overlaps with browser-harness only on `.claude/active-runs.md` (by design — that file is the coordination surface itself)

- **[2026-05-09 ~23:30] manual — unclear-wins reactions (scoped to inflight-guard)**
  - **Source:** `.claude/commands/unclear-wins/idea-6157bb9b-reactions-collapse-events-trig.md` — original idea was a 7-system rewrite; user redirected to a single-subsystem win: extract the bespoke `INFLIGHT_TRIGGERS` mutex from `commands/tools/automations.rs` into a reusable `engine/inflight_guard` primitive
  - **Paths:** `src-tauri/src/engine/inflight_guard.rs` (new), `src-tauri/src/engine/mod.rs` (one-line module declaration), `src-tauri/src/commands/tools/automations.rs` (replace 2 inline lock callsites + remove `INFLIGHT_TRIGGERS` static), `.claude/commands/unclear-wins/idea-6157bb9b-*.md` (delete)
  - **Status:** started — Rust-only under `src-tauri/`; no overlap with active sessions

- **[2026-05-09 ~23:50] /architect resume — slice-test pattern + persist migration tests (decisions 1 + 2 of 3)**
  - **Source:** `Architect/decisions/2026-05-09-slice-test-pattern.md` + `Architect/decisions/2026-05-09-persist-migration-tests.md` — both queued from the 2026-05-09 state-management scan; resume-mode session
  - **Paths:** `src/stores/__tests__/README.md` (new), `src/stores/__tests__/agentStore.merge.test.ts` (new), `src/stores/__tests__/systemStore.rehydrate.test.ts` (new), `src/stores/__tests__/themeStore.rehydrate.test.ts` (new); read-only on `src/stores/agentStore.ts`, `src/stores/systemStore.ts`, `src/stores/themeStore.ts`; vault: `Architect/decisions/2026-05-09-{slice-test-pattern,persist-migration-tests}.md`, `Architect/backlog.md`, `Architect/scans/2026-05-09-state-management.md`, `Architect/weak-patterns.md`, `Architect/coverage.md`, `Lessons/2026-05-09-architect.md`
  - **Status:** started — test-only + a single README; no overlap with `unclear-wins reactions` (Rust) or with the ambient-simple-mode session's `src/App.tsx`/`stores/systemStore.ts` modifications (read-only on systemStore.ts here, no edit)

- **[2026-05-09 ~23:55] manual — radio MVP (D2 hidden window, Lofi/Focus stations)**
  - **Source:** in-session conversation; user request for YouTube-powered radio. Direction 2 (separate hidden Tauri WebviewWindow for IFrame Player) + footer controls in main window + Settings → Account setup card. No OAuth — IFrame Player API needs none. Curated tracklists (not user-editable), 2 stations to start (Lofi/Focus, 2 tracks each), shuffle by default, station-switch resumes per-station cursor.
  - **Paths:** `src-tauri/data/radio_stations.json` (new), `src-tauri/src/radio/` (new module), `src-tauri/src/commands/radio.rs` (new), `src-tauri/src/commands/mod.rs` (one-line add), `src-tauri/src/lib.rs` (module decl + command registry + window spawn), `src-tauri/tauri.conf.json` (CSP additions, new window config), `src-tauri/capabilities/radio.json` (new), `src-tauri/resources/radio-player.html` (new), `src/features/radio/` (new feature folder), `src/features/settings/sub_account/components/AccountSettings.tsx` (embed RadioSettingsCard), `src/i18n/locales/en.json` (add `radio.*` section), `src/i18n/routeSections.ts` (add radio to BASE_SECTIONS), `src/lib/bindings/{Station,Track,RadioState,StationCursor,PlayStatus}.ts` (regen), `docs/features/radio.md` (new) + `scripts/docs/feature-doc-map.json` (new entry)
  - **Status:** started — no overlap with active sessions (engine/inflight_guard is engine-internal Rust, /architect slice-test is test-only, cli-coordination is docs+ledger). Working in worktree `.claude/worktrees/radio-mvp` on branch `worktree-radio-mvp`. Active-runs ledger entry intentionally left uncommitted on master because cli-coordination session also has uncommitted edits to this file — sharing the file rather than overwriting their staging.

## Recently completed (last 14 days)

- **[2026-05-09 ~23:55] manual — unclear-wins github-style execution heatmap (gap-fill placement)**
  - **Source:** `.claude/commands/unclear-wins/idea-09267fcd-github-style-execution-heatmap.md` — heatmap component + Rust command + 1h cache + bindings already shipped in commit `ac9c9f507`. Existing placements: per-persona on `ActivityTab`, global on `DashboardHomeMissionControl`. Gap: persona LIST page (`PersonaOverviewPage.tsx`, the Personas sidebar entry) had no heatmap.
  - **Paths:** `src/features/agents/components/persona/PersonaOverviewPage.tsx` (one import + 5-line render), `.claude/commands/unclear-wins/idea-09267fcd-*.md` (deleted, untracked file)
  - **Status:** completed (commit `3fa0da9cf`). Compact mode hides the insights row to keep the list-page header dense; gated on `personas.length > 0` so the empty fleet state stays clean. Single-file change on master.

- **[2026-05-09 ~23:15] manual — unclear-wins stacked-modal depth**
  - **Source:** `.claude/commands/unclear-wins/idea-00838d36-stacked-modal-depth-progressiv.md` — ModalStackContext for topmost-only Escape, progressive blur, depth-based z-index
  - **Paths:** `src/lib/ui/BaseModal.tsx`, `src/lib/ui/ModalStackContext.tsx` (new), `src/App.tsx` (provider wrapper), `.claude/commands/unclear-wins/idea-00838d36-*.md` (deleted)
  - **Status:** completed (commit `61167b1d3`). `tsc --noEmit` clean. Worked in a worktree to coexist with the ambient-simple-mode session's uncommitted `src/App.tsx` edits; merged my 3 hunks back into master via `git apply --cached` against a hand-written patch so my commit excluded the parallel session's `AmbientCockpit` lazy-import + Suspense mount (those edits remain uncommitted in working tree, untouched). Worktree removed and branch deleted. Idea file deleted.

- **[2026-05-09 ~24:00] manual — unclear-wins split OverviewFilterContext**
  - **Source:** `.claude/commands/unclear-wins/idea-d60fdab2-split-overviewfiltercontext-in.md` — values+actions context split (textbook React perf pattern)
  - **Paths:** `src/features/overview/components/dashboard/OverviewFilterContext.tsx`, `src/features/overview/sub_activity/libs/useExecutionMetrics.ts`, `src/features/overview/sub_observability/libs/useObservabilityData.ts`, `.claude/commands/unclear-wins/idea-d60fdab2-*.md` (deleted)
  - **Status:** completed — provider split was already implemented (separate values + actions contexts + dedicated hooks); this session migrated the 2 remaining consumers off the back-compat `useOverviewFilters()` combined hook (`useExecutionMetrics`, `useObservabilityData`) and removed the back-compat `useOverviewFilters` + `OverviewFilterContextValue` exports so the perf split can't be silently reversed by a future contributor. `tsc --noEmit` clean.

- **[2026-05-09 ~22:30] manual — unclear-wins ambient simple mode**
  - **Source:** `.claude/commands/unclear-wins/idea-5bd6ecb5-ambient-simple-mode-fleet-stat.md` — full-screen always-on Simple Mode with auto-rotation between Mosaic (calm) and Inbox (attention) plus Pop-out button
  - **Paths:** `src/features/simple-mode/components/AmbientCockpit.tsx` (new), `src/features/simple-mode/components/SimpleHomeShell.tsx`, `src/stores/slices/system/simpleModeSlice.ts`, `src/App.tsx`, `docs/features/home.md`, `.claude/commands/unclear-wins/idea-5bd6ecb5-*.md` (deleted); plus i18n surface hijacked into commit `0b678344a` — final landing commit was `2a35b5138` ("research: Athena desktop-aware Phase 1 audit + decision gate"), the FOURTH occurrence of the parallel-commit hijack: another session pre-staged their athena audit doc + active-runs entry, my `git add` layered onto their staged set, and their `git commit` swept everything into their commit with their subject. My intended message was "ui(simple-mode): ambient mode — fullscreen always-on Simple Mode display" — searching `git log --grep="ambient"` finds nothing; the work is in `2a35b5138` + `0b678344a`.
  - **Status:** completed — `tsc --noEmit` clean, lint 0 errors. Functional behavior shipped across two commits: (a) the i18n surface (`src/i18n/locales/en.json` + `generated/types.ts` + `generated/enSectionStrings.ts`) was hijacked into commit `0b678344a` ("explorer(drive): OS→Drive drag-drop ingest") — third occurrence of the parallel-commit hijacking pattern (memory `feedback_atomic_commit_under_parallel_sessions`); (b) the rest lands in the followup commit. The stacked-modal session committing in `61167b1d3` between my edits did NOT sweep my work — they used `git apply --cached` selectively per their ledger note. Searching `git log --grep="ambient"` finds only the followup commit; the i18n + types wiring is in `0b678344a`.

- **[2026-05-09 ~13:50] /research — companion-persistent-memory-blueprint**
  - **Source:** Medium "Persistent Memory for AI Coding Agents: An Engineering Blueprint for Cross-Session Continuity" (Sourabh Sharma, Feb 2026)
  - **Paths:** `src-tauri/src/companion/brain/{consolidation.rs,semantic.rs,recall_synthesis.rs,mod.rs}`, `src-tauri/src/companion/{prompt.rs,session.rs}`, `src-tauri/src/commands/companion/consolidate.rs`, `src-tauri/src/lib.rs`, `Obsidian/personas/{Research/2026-05-09-companion-persistent-memory-blueprint.md,Lessons/2026-05-09-research.md}`, `.planning/handoffs/2026-05-09-companion-recall-synthesis.md` (gitignored, local only)
  - **Status:** completed (commits: `c5a549ec0` token-cap pruning, `639b062c9` fuzzy dedup at consolidation, `6bc205086` synthesis layer at retrieval). All 3 findings shipped in-session; the synthesis handoff was executed at the user's follow-up direction rather than left as a deferred plan. 3 findings + 9 catches against a richer-than-expected brain (13 modules — `ls` of the module dir would have caught the over-richness before I assumed a 3-file mental model from codebase-context.md). Follow-up UI wiring (`recall_synthesis_enabled` propagated through `companion_send_message` IPC + Setup toggle in SetupPanel.tsx) was hijacked into commit `ba821b2f7` ("explorer(drive): cache drive_storage_info with 5-second TTL") by a concurrent drive-plugin session that committed between my `git add` and `git commit` — second occurrence of the pattern documented in memory `feedback_atomic_commit_under_parallel_sessions`. Functional behavior is shipped correctly under that misnamed commit; searching `git log --grep="recall_synthesis"` will not find this work — look in `ba821b2f7` instead.

- **[2026-05-09 ~21:30] manual — clear-wins/creative backlog execution (Tasks #1–#9 of 11)**
  - **Source:** user request to walk through `.claude/commands/clear-wins/creative/` task by task. 9 of 11 tasks completed; #10 (per-persona quick-action chips, requires DB migration) and #11 (speculative chat dispatch, critical-path) deferred at user direction.
  - **Paths:** `src/features/shared/{components/buttons/Button.tsx,components/display/{StatusDot,InlineEditableText,AnimatedCounter,ScrollShadowContainer}.tsx,components/forms/{PasswordToggleField,FormFieldGroup,AccessibleToggle}.tsx,components/layout/ContentLayout.tsx}`, `src/features/agents/{components/glyph/{GlyphCoreContent,GlyphFullLayout,GlyphPrototypeLayout,commandPanel/CommandPanelComposer}.tsx,components/persona/PersonaOverviewCells.tsx,sub_editor/components/PersonaEditorHeader.tsx,sub_executions/detail/inspector/TraceInspector.tsx,sub_model_config/components/{ProviderCredentialField,CustomModelConfigForm}.tsx,sub_use_cases/components/detail/UseCaseModelOverrideForm.tsx}`, `src/features/overview/{sub_realtime/components/panels/RealtimeStatsBar.tsx,sub_observability/components/AlertHistoryPanel.tsx,sub_knowledge/components/KnowledgeGraphDashboard.tsx,components/shared/KpiTile.tsx}`, `src/features/{deployment/components/cloud/CloudConnectionForm,plugins/langfuse/ConnectionForm,settings/sub_portability/components/{CredentialPortability,ExportSection,ExportSelectionModal},templates/sub_generated/adoption/glyph/PersonaChronologyGlyph}.tsx`, `src/styles/globals.css`, `src/lib/utils/designTokens.ts`, `src/i18n/locales/en.json`
  - **Status:** completed (commits: `5e3f9055a` swept Tasks #1–#4 by parallel session; merge commit `f8c929283` brings in Tasks #5–#9 from worktree-clear-wins-creative branch — `b00d34407 b dab6aee9`, `bdf52a755 d1f6cc4e`, `6c48cda79 f70f9677`, `bba22c5c9 0405f14a`, `6b800b47a 6e54974b`). Worktree removed + branch deleted per Phase 13 ritual. Lessons learned: parallel session swept Tasks #1–#4 + my en.json edit into their unrelated commit before I could batch-commit; switched to git worktree for #5–#9 to get physical isolation.

- **[2026-05-09 ~22:00] /research — printing-press cli-factory (Nate Herk)**
  - **Source:** [Printing Press walkthrough](https://www.youtube.com/watch?v=YHk45NEpspE) — 14:45 video by Nate Herk on Peter Steinberger's Claude Code skill + Go-CLI factory + community library
  - **Paths:** `src-tauri/src/engine/{skills_sidecar,bridge_manifest,connector_explorer}/`, `src-tauri/src/engine/{prompt/mod.rs,prompt/resume_prompt.rs,runner/mod.rs,mod.rs}`, `src-tauri/src/commands/{infrastructure/bridge_manifest.rs,design/connector_explorer.rs,infrastructure/mod.rs,design/mod.rs}`, `src-tauri/src/lib.rs`, `scripts/bridges/`, `src/lib/bindings/{BridgeManifestSummary,ConnectorManifestDraft,DiscoveredEndpoint}.ts`, `Obsidian/personas/{Research/2026-05-09-printing-press-cli-factory.md,Lessons/2026-05-09-research.md}`
  - **Status:** completed (commits `389ba7231` per-connector SKILL.md sidecar, `a37c251cb` declarative bridge manifests + dispatcher, `dca281f8e` connector_explorer v1 reverse-engineering pipeline) — Phase 0 ledger registration was missed; recording at session end. The `pub mod bridge_manifest;` line in `engine/mod.rs` was preempted into commit `6e1194e4f` (parallel browser-harness session) during a `git stash` window — F2 commit ships the module body that line refers to. Lesson appended to Lessons/2026-05-09-research.md and a new memory entry `feedback_atomic_commit_under_parallel_sessions` already captured the rule.

- **[2026-05-09 ~13:45] manual — long-tail active-runs adoption (6 skills)**
  - **Source:** continuation of the parallel-safety codification — propagating Coordination + Parallel-safety blocks to the 8 long-tail skills listed in `docs/concepts/cli-coordination-active-runs.md`. 2 of the 8 (`/simplify`, `/frontend-design`) are plugin-provided not local; updated the 6 local ones.
  - **Paths:** `.claude/skills/{sentry,triage-backlog,prototype,code-review,cli-quality-check,guide-sync}/SKILL.md`, `docs/concepts/cli-coordination-active-runs.md` (long-tail table updated to ✅), `.claude/active-runs.md`
  - **Status:** completed (commit `605cf0bc6` for the 6 skills + ledger registration; follow-up commit pending for the design-doc table update + this ledger move) — committed via `git commit --only <files>` per the c61914095 anti-index-race rule

- **[2026-05-09 13:24] manual — docs/ overhaul (audit, update, delete, backlog)**
  - **Source:** user request to audit `docs/` end-to-end, update where outdated, delete dead docs, and produce a backlog of extension ideas
  - **Paths:** `docs/README.md` (updated), `docs/BACKLOG.md` (new), `docs/concepts/README.md`, `docs/architecture/gitlab-integration.md`, `docs/devops/review-security-invisible-apps.md`, `docs/features/{artist,dev-tools,connections/README,events/event-routing}.md`, plus deletion of 4 harness wave-report subdirs and `docs/operations/`
  - **Status:** completed (commit pending — this commit) — three parallel Explore agents audited features/, architecture+development+devops/, concepts+tests+harness/ (~600–1000 lines per report). Edits + deletions + BACKLOG.md applied in-place; refactor/* and harness/{followups,typography-mapping,harness-learnings,simple-mode-roadmap} preserved with move/archive plans queued in BACKLOG.md. Worktree isolation attempted but absolute-path edits landed on master directly; worktree branch contained only duplicate deletions and was abandoned.

- **[2026-05-09 ~21:00] /research — browser-harness (browser-use)**
  - **Source:** [Browser Harness walkthrough](https://www.youtube.com/watch?v=YDqqRqqlnJU) (browser-use folks)
  - **Paths:** `scripts/connectors/builtin/desktop-browser.json`, `src-tauri/src/db/builtin_connectors.rs`, `src-tauri/src/engine/skill_scratchpad.rs` (new), `src-tauri/src/engine/mod.rs`, `src-tauri/src/engine/prompt/mod.rs`, `Obsidian/personas/Research/2026-05-09-browser-harness-browser-use.md`, `Obsidian/personas/Lessons/2026-05-09-research.md`
  - **Status:** completed (commit `6e1194e4f`) — recovery note: working-tree was stashed mid-session by the parallel cli-coordination commit; restored my 4 tracked files via `git show stash@{0}:<path>` and recreated the untracked `skill_scratchpad.rs` from conversation context

- **[2026-05-09 13:10] /research — claude-blender (defer-all-reopenable)**
  - **Source:** [Claude + Blender Is Insane Now](https://www.youtube.com/watch?v=wSY1kHXSap0); also extended `/research` skill with Phase 2.5 web augmentation + on-demand `docs/features/` lookup (skill edits already landed in commit `27b6d5a3b` via baseliner; ledger entry registered retroactively)
  - **Paths:** `.claude/skills/research/skill.md`, `.claude/active-runs.md`, `Obsidian/personas/Research/2026-05-09-claude-blender-mcp.md` (new), `Obsidian/personas/Lessons/2026-05-09-research.md` (appended), `Obsidian/personas/Patterns/descoped-reopenable.md` (new meta-entry)
  - **Status:** completed (commit `9ac5148ca`) — 0 accepted, 7 descoped-reopenable folded into one `descoped-reopenable.md` meta-entry (3D-readiness wave); ledger-only commit at the repo level (skill edits already landed in `27b6d5a3b`; Obsidian writes are out-of-repo)

- **[2026-05-09 ~21:50] cross-skill — active-runs adoption v2 (priority five)**
  - **Source:** in-session continuation of the active-runs ledger v1 commit; user request to do cross-skill adoption now
  - **Paths:** `.claude/skills/architect/skill.md`, `.claude/skills/add-template/skill.md`, `.claude/skills/add-credential/skill.md`, `.claude/skills/refresh-context/skill.md`, `.claude/skills/codebase-init/skill.md`, `docs/concepts/cli-coordination-active-runs.md`, `docs/concepts/README.md`
  - **Status:** completed (commit `a88d7f190`)

- **[2026-05-09 19:10] /research — claude-capcut-motion-graphics**
  - **Source:** [Matt Loui — Claude + CapCut tutorial](https://www.youtube.com/watch?v=8oIFBQ9BhVU)
  - **Paths:** `docs/concepts/`, `Obsidian/personas/Lessons/`, `Obsidian/personas/Research/`
  - **Status:** completed (commit `16bf3b431`)

- **[2026-05-09 ~19:30] /research — cli-coordination-active-runs (this entry's own author)**
  - **Source:** in-session design + execute (no external source)
  - **Paths:** `.claude/active-runs.md`, `.claude/CLAUDE.md`, `.claude/skills/research/skill.md`, `docs/concepts/cli-coordination-active-runs.md`
  - **Status:** completed (commit pending — this run is creating the ledger itself)
