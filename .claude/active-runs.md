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

- **[2026-05-09 ~13:50] /research — companion-persistent-memory-blueprint**
  - **Source:** Medium "Persistent Memory for AI Coding Agents: An Engineering Blueprint for Cross-Session Continuity" (Sourabh Sharma, Feb 2026)
  - **Paths:** `Obsidian/personas/Research/`, `Obsidian/personas/Lessons/`, possibly `src-tauri/src/companion/brain/` if findings land
  - **Status:** started

## Recently completed (last 14 days)

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
