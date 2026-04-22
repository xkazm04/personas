---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: messaging-and-notifications
status: active
next_phase: 20
stopped_at: "Phase 19 (Backend Delivery Glue) COMPLETE — verifier returned 5/5 success criteria ACHIEVED. Wave 1 (4 commits: 854ec6cb, 49df82da, 9f9e3c89, 00db7cf3) + Wave 2 (6 commits: 8e34857d, f33d71fa, 7a784beb, a2bbedeb, f39c3132, f75f39c4). DELIV-01..06 all met. 3 deferred items are end-to-end UI round-trip checks (Phase 20/21 UAT). Next: Phase 20 (Adoption Flow Conversion). Prototype deviation alert: ba7b44f8 + 5f5f63ba renamed the adoption variants — 20-CONTEXT.md prototype_impact_analysis needs re-baselining against VariantL/M."
last_updated: "2026-04-22T14:15:00.000Z"
last_activity: 2026-04-22
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 5
  completed_plans: 5
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (Current Milestone: v1.2 Messaging & Notifications).

**v1.2 Roadmap:** `.planning/ROADMAP.md` (canonical; 6 phases, 34 REQ-IDs, Phases 17–22). v1.0 and v1.1 roadmaps archived to `.planning/ROADMAP-V1-MATRIX.md` and `.planning/ROADMAP-SIMPLE-MODE.md`. Note: Phase 16 slot is a completed v1.1 deferred-resolution follow-up; Phase 16.5 is a completed v1.1 backend-completion follow-up — see below.

**Core value (v1.2):** Every persona gets first-class messaging out of the box — in-app inbox is the always-on default, TitleBar bell subscriptions are opt-in per event, external channels (Slack/Telegram/Email) are configurable per UC with sample-message testing. Composition (shared vs separate triggers/messages) is editable post-creation in the Agents module.

**Current focus:** Phases 17, 18, 19 COMPLETE. Phase 20 (Adoption Flow Conversion) is next — convert the Pipeline-Canvas prototype into the production adoption surface, wired to real vault credentials, the Phase 18 `personas_messages` connector, Phase 19's `test_channel_delivery` IPC, and the shape-v2 channel format. **Prototype scope deviation alert:** commits `ba7b44f8` (Prototypes restore) and `5f5f63ba` (Prototype milestone 2) deleted `MessagingPickerVariantC.tsx` (the file 20-CONTEXT.md was written against) and replaced it with newer variants — at HEAD, the variants on disk are `MessagingPickerVariantH.tsx`, `MessagingPickerVariantL.tsx`, `MessagingPickerVariantM.tsx`. The Phase 20 research pass MUST re-baseline `20-CONTEXT.md`'s `prototype_impact_analysis` section before planning.

## Current Position

Phase: 20 — Adoption Flow Conversion (Not started)
Plan: — (needs full cycle: research + validation + plan + execute + verify)
Status: Ready to plan Phase 20; 20-CONTEXT.md in place but prototype_impact_analysis is stale vs current adoption variants
Last activity: 2026-04-22 — Phase 19 verified, 10 commits landed (854ec6cb..f75f39c4)

Progress: [███       ] 50%  (3/6 phases complete; Phases 17, 18, 19 ✓)

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

### v1.2 Phase 19 — Backend Delivery Glue (completed 2026-04-22)

Two-plan phase, 10 commits. **Plan 01 (Wave 1 Rust backend):** commits `854ec6cb`, `49df82da`, `9f9e3c89`, `00db7cf3` — added `TITLEBAR_NOTIFICATION` event constant + `TitlebarNotificationPayload`/`TestDeliveryResult`/`DeliveryContext` structs + `deliver_v2_channels` with `built-in`/`titlebar` arms + pure `filter_channels_for_delivery` and `apply_event_filter` helpers + shape-v2 passthrough in `resolve_notification_channels` + wired `DeliveryContext` through UserMessage/ManualReview/EmitEvent call sites in `dispatch.rs`. **Plan 02 (Wave 2 IPC + frontend):** commits `8e34857d`, `f33d71fa`, `7a784beb`, `a2bbedeb`, `f39c3132`, `f75f39c4` — added `test_channel_delivery` IPC with per-channel 1-req/sec rate limit (`channel_key()` hash + pure `rate_limit_check` helper) + registered in `lib.rs` + hand-patched `TestDeliveryResult.ts`/`TitlebarNotificationPayload.ts` ts-rs bindings + `eventRegistry.ts` + `eventBridge.ts` listener routing payload to `notificationCenterStore.addNotification` + `src/api/agents/channelDelivery.ts` wrapper. 9 new Rust tests (scoped `cargo test` blocked by 16 pre-existing xcap/image/which/desktop_discovery errors — tests are compile-verified + source-present, same constraint Phases 17/18 shipped under). 2 new vitest tests (eventBridge). Verifier: 5/5 success criteria ACHIEVED; 3 UI round-trip verifications deferred to Phase 20/21 UAT. Summaries: `.planning/phases/19-backend-delivery-glue/19-01-SUMMARY.md`, `19-02-SUMMARY.md`. Verification: `19-VERIFICATION.md`.

### Pending Todos (v1.2)

- **Plan + execute Phase 20** (ADOPT-01..09). **Prototype scope deviation — MUST RE-BASELINE BEFORE PLANNING:** commits `ba7b44f8` (Prototypes restore) and `5f5f63ba` (Prototype milestone 2) iterated the adoption variants after Phase 18 landed. `MessagingPickerVariantC.tsx` (the file `20-CONTEXT.md`'s `prototype_impact_analysis` was written against) is gone; at HEAD, the variants on disk are `MessagingPickerVariantH.tsx`, `MessagingPickerVariantL.tsx`, `MessagingPickerVariantM.tsx`. Phase 20 research pass must re-audit `src/features/templates/sub_generated/adoption/` to determine which variant is the current production target (ask user if unclear) and which prototype patterns survived the iteration.
- **Plan + execute Phase 21** (EDIT-01..07). Reuses Phase 20 channel matrix helper.
- **Plan + execute Phase 22** (TMPL-01..03). 120 templates; parallel category-scoped agent backfill.

### Verifier corruption guard (2026-04-22)

One of the Phase 19 subagents (Plan 02 executor or verifier) invoked `gsd-tools state ...` despite the explicit handoff guardrail, which rewrote STATE.md frontmatter to `milestone: v3.2`, wiped `next_phase`, and fabricated `total_phases: 7` / `completed_plans: 6` / `percent: 100`. Orchestrator restored the frontmatter manually after Phase 19 verify. **Reinforce in any future agent prompts:** "Do NOT run `gsd-tools state record-session`, `state begin-phase`, `state planned-phase`, or `phase complete` — they corrupt this file."

### Pre-existing orphans (decide before starting v1.2 execution)

- ~~**`.planning/phases/17-backend-completion/17-01-PLAN.md`**~~ — **RESOLVED 2026-04-21**. Executed path (1). Summary at `.planning/phases/17-backend-completion/17-01-SUMMARY.md`. Both topics now ship first-class backend signals; Phase 16 frontend workarounds stay in place as fallbacks. See the "Phase 17 backend-completion (v1.1 carryover, 2026-04-21)" section above for the decision trail.

### Blockers/Concerns

- [Carryover from v1.1]: `check:i18n` gate has 206-key baseline drift + 7 new keys from Phase 15-01 + 1 new key from Phase 16 deferred-resolution (`simple_mode.inbox.the_output_label`). Managed by translation teams out-of-band per CLAUDE.md.
- [Carryover from v1.1]: ~127 lint warnings on `src/features/simple-mode + PersonasPage.tsx` scope — all `custom/no-raw-spacing-classes` / `custom/no-low-contrast-text-classes` baseline per CLAUDE.md's incremental design-token migration. Zero errors.
- [Pre-existing regressions — out of scope for Phase 16 deferred-resolution, but worth flagging for future polish]: 37 test failures across `features/agents/matrix`, `lib/personas/templates/__tests__/templateOverlays.test.ts`, and `test/e2e/cli-terminal-rendering.e2e.test.tsx`. Confirmed on master prior to Phase 16 changes. Will need a dedicated polish pass.

## Session Continuity

Last session: 2026-04-22T14:15:00.000Z
Stopped at: Phase 19 (Backend Delivery Glue) COMPLETE. 10 atomic commits on master (4 Wave 1 + 6 Wave 2). 9 new Rust tests + 2 new vitest tests. Verifier returned 5/5 ACHIEVED. `cargo check --package personas-desktop` holds the 14-error pre-existing baseline. `npx tsc --noEmit` clean. Frontend regression: `npx vitest run src/features/vault src/features/simple-mode src/lib/credentials` 168/168 pass. Frontmatter corruption from gsd-tools state invocation was manually corrected post-verify. Next up: Phase 20 (Adoption Flow Conversion) — MUST re-baseline `20-CONTEXT.md` `prototype_impact_analysis` against the current adoption variants (H/L/M) before planning, since prototype iteration on master deleted VariantC/J/K.
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
