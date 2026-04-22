---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: messaging-and-notifications
status: active
next_phase: 19
stopped_at: "Phase 18 (personas_messages builtin connector) COMPLETE — single-plan (18-01) delivered CONN-04 zero-config empty state + regression guards for CONN-01/02/03 (existing code already satisfied those). 3 commits on master (3a1f5a3c, 17067e46, ec12bdbc). Phase 19 (Backend Delivery Glue) is next — plan 01 already drafted; needs plan 02 (Wave 2: IPC + frontend bridge) then execute."
last_updated: "2026-04-22T12:30:00.000Z"
last_activity: 2026-04-22
progress:
  total_phases: 6
  completed_phases: 2
  total_plans: 3
  completed_plans: 3
  percent: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (Current Milestone: v1.2 Messaging & Notifications).

**v1.2 Roadmap:** `.planning/ROADMAP.md` (canonical; 6 phases, 34 REQ-IDs, Phases 17–22). v1.0 and v1.1 roadmaps archived to `.planning/ROADMAP-V1-MATRIX.md` and `.planning/ROADMAP-SIMPLE-MODE.md`. Note: Phase 16 slot is a completed v1.1 deferred-resolution follow-up; Phase 16.5 is a completed v1.1 backend-completion follow-up — see below.

**Core value (v1.2):** Every persona gets first-class messaging out of the box — in-app inbox is the always-on default, TitleBar bell subscriptions are opt-in per event, external channels (Slack/Telegram/Email) are configurable per UC with sample-message testing. Composition (shared vs separate triggers/messages) is editable post-creation in the Agents module.

**Current focus:** Phase 17 (Schema v3.2) + Phase 18 (personas_messages builtin connector) COMPLETE. Phase 19 (Backend Delivery Glue) is next — extend `deliver_to_channels()` with `built-in` + `titlebar` branches, wire a frontend event bridge for titlebar notifications, and add a debounced `test_channel_delivery` IPC. CONTEXT.md + RESEARCH.md + VALIDATION.md + 19-01-PLAN.md (Wave 1: Rust backend) are already on disk at `.planning/phases/19-backend-delivery-glue/`. Plan 02 (Wave 2: IPC + frontend bridge) pending.

## Current Position

Phase: 19 — Backend Delivery Glue (plan 01 drafted; plan 02 + execute pending)
Plan: 19-02-PLAN.md (Wave 2) to draft; 19-01-PLAN.md (Wave 1) already on disk
Status: Ready to plan Phase 19 Wave 2; then execute both plans
Last activity: 2026-04-22 — Phase 18 verified and closed (commit ec12bdbc)

Progress: [██        ] 33%  (2/6 phases complete; Phases 17, 18 ✓)

### Phase 16 deferred-resolution (v1.1 carryover, 2026-04-20)

A one-plan "deferred-resolution" phase completed under `.planning/phases/16-deferred-resolution/` to close the two v1.1 Simple Mode carryover topics without backend work:

- **Topic A (illustration tier-3):** investigation confirmed no clean data path; shipped Tier-2 enrichment (parses `persona.design_context` JSON into the keyword scan) + richer Tier-3 deferral comment. Tier-3 stays deferred.
- **Topic B (output-kind emission):** shipped frontend-only heuristic (`isMessageOutput`) + `adaptOutput` adapter; `useUnifiedInbox` now emits `kind: 'output'` for markdown / output-keyword messages. Backend content_type enum + per-execution-output API remain deferred.

Outcomes: +15 simple-mode tests (now 98 total), 5 atomic commits `9229d74b`, `c878299a`, `18ea1ba7`, `41a88721`, `6345106a`. Summary: `.planning/phases/16-deferred-resolution/16-01-SUMMARY.md`.

This Phase 16 is orthogonal to v1.2 — it completed v1.1 Simple Mode carryover only. The v1.2 roadmap was subsequently renumbered 17–22 so Schema v3.2 is now Phase 17, not Phase 16.

### Phase 17 backend-completion (v1.1 carryover, 2026-04-21)

A second v1.1 carryover phase completed under `.planning/phases/17-backend-completion/` that replaces the Phase 16 frontend workarounds with first-class backend signals:

- **Topic A (illustration tier-3) — resolved:** new `template_category TEXT` column on `personas` (incremental PRAGMA-check migration), populated by `infer_template_category` at three draft-finalization sites in template_adopt.rs. Frontend `useIllustration` adds a true tier-3 via `TEMPLATE_CATEGORY_MAP` (20 Rust categories → 12 illustration bins). Manually-created personas stay null and fall through to tier-4 hash.
- **Topic B (output-kind emission) — resolved:** `engine/runner.rs` now emits `content_type = 'output'` (renamed from `'text'`) on execution-completion auto-messages. `isMessageOutput` precedence is now `'output'` → `'result'` (legacy) → `'markdown'` → keyword fallback. Explicit backend signals short-circuit the heuristic.

Outcomes: +18 simple-mode tests (98 → 116), 6 atomic commits `cce2b3f5`, `edc70e30`, `19cba289`, `db834790`, `a2a05fa3`, `a6fb331d`. Summary: `.planning/phases/17-backend-completion/17-01-SUMMARY.md`.

Naming note: this "Phase 17" is a v1.1 carryover and uses directory `17-backend-completion`. The v1.2 milestone also calls its first phase "Phase 17 (Schema v3.2)" — those will live under a separate directory (e.g. `17-schema-v3-2`) when planned. The two are unrelated.

Key architectural outcomes for Simple-mode:

- Persona schema now carries lowercase category strings sourced from the shared `commands::design` category heuristic, keeping the Rust + TS vocabularies aligned.
- `infer_template_category` is now `pub(crate)` and reused across reviews + template-adopt, avoiding duplicate rule tables.
- Execution engine owns the canonical `output` content_type tag; frontend heuristics stay as fallbacks for legacy rows + pre-existing emitters that haven't adopted the signal.

## Performance Metrics

_(v1.2 metrics table will populate as plans complete.)_

## Accumulated Context

### Decisions (v1.2)

_(Will populate as phases complete. Pre-milestone decisions captured in .planning/PROJECT.md Current Milestone → Key locked decisions.)_

### Decisions (v1.1 deferred-resolution, 2026-04-20)

- Widened `PersonaLike` Pick in illustration resolver to include `design_context`; synthesized-persona call sites (InboxList PersonaThumb, DetailHeader fallback) pass `design_context: null`.
- Tier-3 template-category stays explicitly deferred — no clean data path exists (no template FK from Persona; template-system vocabulary doesn't map to resolver's 12-bin taxonomy). Enriched Tier-3 comment documents investigation.
- `isMessageOutput` keyword list locked English-only for v1.2; localization deferred to proper backend solution.
- `adaptOutput` defaults executionId to `''` (empty string) since `UnifiedInboxItem`'s output branch type declares it non-null.
- Full markdown rendering in OutputDetail deferred to v1.3; current `<pre whitespace-pre-wrap>` is legible for the typical short-to-medium artifact the heuristic catches.

### Decisions (v1.1 backend-completion, 2026-04-21)

- **Tier-3 no longer deferred** — Phase 16 decision reversed. Added `template_category TEXT` nullable column to personas via incremental ALTER TABLE (PRAGMA-check pattern matching existing `tool_steps`/`retry_of_execution_id` blocks in incremental.rs).
- **`infer_template_category` is `pub(crate)`**, not relocated — lower churn than moving it to a shared `categorization.rs`. Both reviews.rs and template_adopt.rs live under `commands::design` so crate-visibility suffices.
- **Three draft-finalization wire-up sites** in template_adopt.rs: `instant_adopt_template_inner` (uses full_prompt), `handle_adopt_result` (uses draft.system_prompt fallback), `confirm_template_adopt_draft` (backfill guard). Each guarded by `if draft.template_category.is_none()` so explicit upstream values win.
- **Frontend TEMPLATE_CATEGORY_MAP collapses 20 Rust categories → 12 bins** with semantic overrides: legal→writing (document-heavy), hr→meetings (meeting-heavy), marketing→social, project-management→meetings. Unmapped inputs fall through to tier-4 hash — safe + deterministic.
- **runner.rs content_type** renamed from `'text'` (plan context said `'result'` — plan was slightly off on the prior label; applied the plan's intent) → `'output'` as the canonical execution-complete marker.
- **Frontend keeps Phase 16 heuristics as fallbacks** — `isMessageOutput` short-circuits on explicit signals (`'output'` / `'result'` / `'markdown'`) before the keyword scan. Legacy rows + other emitters still classified correctly.
- **Manual ts-rs binding update** — Persona.ts was patched by hand because `cargo test` (the project's regen path) fails on 14 pre-existing errors from unresolved crates (`xcap`, `image`, `which`, `desktop_discovery`) unrelated to Phase 17. Manual value matches exactly what ts-rs would emit for `Option<String>`.

### v1.2 Phase 17 — Schema v3.2 (completed 2026-04-21)

Landed on master in 5 commits `5a5b8e2b`, `05a17ca2`, `cf348f6e`, `59bfbdd2`, `1abd49ab`. All 6 SCHEMA-0x requirements met. New types: `SampleOutput`, `ChannelSpecV2`, `ChannelSpecV2Type`, `ChannelScopeV2`. Hoisters: `hoist_sample_outputs`, `hoist_notify_titlebar_flags`. Parser: `parse_channels_v2` with `empty_use_case_ids` validator guard. Delta doc: `docs/concepts/persona-capabilities/C3-schema-v3.2-delta.md`. 5 ts-rs-matching TS bindings hand-patched. Summary: `.planning/phases/17-schema-v3-2/17-01-SUMMARY.md`.

### v1.2 Phase 18 — personas_messages Builtin Connector (completed 2026-04-22)

Single-plan phase landed in 3 commits `3a1f5a3c`, `17067e46`, `ec12bdbc`. Audit revealed `scripts/connectors/builtin/local-messaging.json` + seed path already satisfied CONN-01/02/03; the one real gap was CONN-04 (UI empty-state for zero-config connectors). Shipped: `TemplateFormBody` empty-state branch + i18n keys + vitest regression guards covering seed path + category filter. Summary: `.planning/phases/18-personas-messages-connector/18-01-SUMMARY.md`.

### Pending Todos (v1.2)

- **Plan Phase 19 Wave 2 (19-02-PLAN.md)**: DELIV-04 (eventBridge.ts listener) + DELIV-06 (`test_channel_delivery` IPC). 19-01-PLAN.md (Wave 1 Rust) already drafted. RESEARCH.md Wave 2 spec is at `.planning/phases/19-backend-delivery-glue/19-RESEARCH.md` §"Wave 2: Frontend + Bindings" (line ~847).
- **Execute Phase 19** (both plans sequentially, no worktree, regular commits — see guardrails).
- **Plan + execute Phase 20** (ADOPT-01..09). **Prototype deviation alert:** commit `ba7b44f8 Prototypes restore` deleted `MessagingPickerVariantC.tsx` and added `MessagingPickerVariantH/J/K.tsx` after Phase 18 landed. `20-CONTEXT.md` `prototype_impact_analysis` was written against VariantC — Phase 20 research pass must re-baseline.
- **Plan + execute Phase 21** (EDIT-01..07). Reuses Phase 20 channel matrix helper.
- **Plan + execute Phase 22** (TMPL-01..03). 120 templates; parallel category-scoped agent backfill.

### Pre-existing orphans (decide before starting v1.2 execution)

- ~~**`.planning/phases/17-backend-completion/17-01-PLAN.md`**~~ — **RESOLVED 2026-04-21**. Executed path (1). Summary at `.planning/phases/17-backend-completion/17-01-SUMMARY.md`. Both topics now ship first-class backend signals; Phase 16 frontend workarounds stay in place as fallbacks. See the "Phase 17 backend-completion (v1.1 carryover, 2026-04-21)" section above for the decision trail.

### Blockers/Concerns

- [Carryover from v1.1]: `check:i18n` gate has 206-key baseline drift + 7 new keys from Phase 15-01 + 1 new key from Phase 16 deferred-resolution (`simple_mode.inbox.the_output_label`). Managed by translation teams out-of-band per CLAUDE.md.
- [Carryover from v1.1]: ~127 lint warnings on `src/features/simple-mode + PersonasPage.tsx` scope — all `custom/no-raw-spacing-classes` / `custom/no-low-contrast-text-classes` baseline per CLAUDE.md's incremental design-token migration. Zero errors.
- [Pre-existing regressions — out of scope for Phase 16 deferred-resolution, but worth flagging for future polish]: 37 test failures across `features/agents/matrix`, `lib/personas/templates/__tests__/templateOverlays.test.ts`, and `test/e2e/cli-terminal-rendering.e2e.test.tsx`. Confirmed on master prior to Phase 16 changes. Will need a dedicated polish pass.

## Session Continuity

Last session: 2026-04-21T22:10:00.000Z
Stopped at: Phase 17 backend-completion (v1.1 carryover) executed + summary written. Six atomic commits, 18 new tests (simple-mode 98→116), tsc clean, eslint 0 errors. The v1.1 orphan PLAN at 17-backend-completion/ is now resolved — both deferred topics ship with first-class backend signals. Next up: v1.2 milestone starts at /gsd-plan-phase for Schema v3.2.
Resume file: .planning/phases/17-schema-v3-2/17-CONTEXT.md (v1.2 Phase 17 Schema v3.2 — distinct from the just-completed v1.1 carryover)

## Archived: v1.1 Simple Mode Home Base (completed 2026-04-21)

Milestone v1.1 shipped 11 phases (05–15): foundation, unified inbox selector, three variant wire-ups (Mosaic/Console/Inbox), illustration library, design-system compliance, onboarding + graduate modal, settings expansion, cleanup + QA, and post-close polish. All 83 simple-mode tests pass, tsc clean, eslint 0 errors on touched scopes. USER-DELTA.md in `.planning/phases/14-cleanup-qa/` captures the milestone-level before/after for ops/PM.

Key architectural outcomes:

- `useUnifiedInbox()` — single read surface for all three Simple variants, normalizes approvals + messages + outputs + healing into `UnifiedInboxItem[]` with 50-item cap
- `useSimpleSummary()` — cross-store counter selector (greeting, runs-today, active-personas, connected, needs-me, inbox)
- `useIllustration()` — four-tier resolver (icon → keyword → template-category [stubbed] → hash) serving 12 warm watercolor PNGs under `public/illustrations/simple-mode/`
- Closed 5-tone accent palette (amber/violet/emerald/rose/gold × text/soft/border/solid) as CSS utilities under `src/features/simple-mode/styles/simple-mode.css`
- `ModeComparisonCard` — shared Simple/Power preview card; compact variant for graduate modal + onboarding
- `GraduateToPowerModal` — wraps BaseModal with Power ModeComparisonCard + Confirm/Cancel
- PersonasPage Wave 2 fetch gated on `viewMode` (Simple skips Power-only tools/recipes/groups + prefetches)

Full v1.1 decision trail preserved in the git history of this file at commit `131baaec` (the last pre-reset state) and in each phase's `SUMMARY.md` under `.planning/phases/{05-15}-*/`.

## Archived: v1.0 Matrix Builder (completed 2026-04-13)

Previous milestone completed with 4 phases, 15 plans, 22 total plans executed across session infrastructure, unified matrix build surface, build lifecycle and approval, and visual polish. All decisions from v1.0 remain archived in `.planning/phases/01-04/*/SUMMARY.md` files.
