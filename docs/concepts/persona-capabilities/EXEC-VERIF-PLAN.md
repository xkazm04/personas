# Persona Execution Verification — Implementation Plan

> Six-phase plan that closes the observability and verification gaps surfaced
> by the v3.1 template wire-audit. Ordered lowest → highest risk. Each phase is
> independently shippable, atomically committable, and ends in a working state.
>
> **Tracking mode:** standalone (outside `.planning/` to avoid conflict with
> concurrent GSD work in another CLI session). Commits land on the working
> branch; status is tracked inline below.

---

## Problem statement

After wire-auditing the v3.1 template shape (see `C3-v3.1-impact-analysis.md`),
six problems were identified between what templates declare and what the runtime
actually enforces:

1. **A2** — Execution failures do not land in the `TitleBar` notification center,
   so users only discover failures by opening the persona detail view.
2. **A1 + C** — A persona can return "success" while emitting prose like
   "Note: Telegram bot credentials are not configured in this environment",
   because the runner gates on CLI exit code, not semantic output. Required
   connectors are also never healthchecked before LLM spawn.
3. **B2** — Per-UC `error_handling` declared in templates never reaches the
   LLM prompt; only persona-wide `error_handling` is emitted.
4. **D** — `dispatch.rs` silently drops `ManualReview`/`emit_memory` emissions
   when policy says so, with only a log-file trace. Users can't verify that
   declared policies are actually being honored.
5. **B1** — Per-UC `model_override` is preserved through the flat IR but never
   read by the runner — the failover chain ignores it.
6. **B3/B4** — Dead schema fields: `core_memories`, `examples`, `execution_mode`,
   `verbosity_default`, `connectors[].fallback_note`. Templates uniformly
   populate them with defaults; no runtime consumer exists.

---

## Phase 5 — Execution lifecycle → Notification Center

**Status:** in progress

**Goal:** Every failed / cancelled execution appears in the `TitleBar` bell
with status, persona name, error summary, and a click-through to the execution
detail page.

**Scope (files touched):**
- `src/lib/notifications/executionLifecycleListener.ts` (new) — `typedListen(EXECUTION_STATUS)` bridge.
- Mount site: app-level listener registry (TBD on inspection).
- Possibly `src/stores/notificationCenterStore.ts` — widen `ProcessType` or
  normalize status mapping if needed.

**Success criteria:**
1. When `runner.rs` emits `EXECUTION_STATUS { status: "failed" | "cancelled" }`,
   a `PipelineNotification` lands in `useNotificationCenterStore` within 1 sec.
2. Notification title = persona name; body = error message; click navigates
   to execution detail.
3. Successful executions do **not** spam (only `failed | cancelled`).
4. Persists across reload (existing localStorage behavior).

**Out of scope:** OS toasts (already exist); any Rust-side change.

**Risk:** Low (pure additive frontend).

**Commit:** one commit `feat(notifications): surface execution failures in notification center`.

---

## Phase 6 — Pre-execution connector healthcheck + semantic output assertions

**Status:** pending

**Goal:** Personas never burn LLM tokens faking around a broken connector;
and prose-level blockers (e.g. "credentials not configured") are caught post-run.

**Scope:**
- `src-tauri/src/engine/runner.rs` — healthcheck gate before failover chain
  construction (~line 680).
- `src-tauri/src/engine/template_v3.rs` — baseline `NotContains` assertion
  injection; passthrough of `use_cases[].output_assertions[]`.
- `docs/concepts/persona-capabilities/C3-schema-v3.1-delta.md` — addendum for
  `output_assertions[]`.
- One v3.1 template (`dev-clone.json`) updated as reference.

**Success criteria:**
1. Before LLM spawn, `run_healthcheck` runs on every `required: true`
   connector referenced by the triggering UC; unhealthy → abort with status
   `failed`, error names connector.
2. `required: false` connectors that fail healthcheck inject `fallback_note`
   (or a generic fallback line) into the prompt.
3. `use_cases[].output_assertions[]` field added to v3.1 schema (additive).
4. Baseline persona-wide `NotContains` assertions auto-injected unless
   template opts out.
5. `Reject`-action assertion failure downgrades execution status to `warning`
   (which Phase 5 already surfaces).

**Out of scope:** Assertion authoring UI; retroactive migration of all 107
templates.

**Risk:** Medium (runner path).

**Commits:** likely 3 — baseline assertions, healthcheck gate, schema delta.

---

## Phase 7 — Per-use-case `error_handling` in prompt

**Status:** pending

**Goal:** Template author's per-UC error recipes (e.g. "GitHub 422 branch-exists
→ suffix counter and retry") reach the LLM for that capability.

**Scope:**
- `src-tauri/src/engine/template_v3.rs::compose_structured_prompt` — per-UC
  subsections under persona-wide baseline.
- `src-tauri/src/engine/prompt.rs` — active-capability renderer emits per-UC
  error_handling block.

**Success criteria:**
1. Templates with per-UC `error_handling` emit subsections in the rendered
   prompt.
2. Disabled UCs contribute nothing (P1 compliance).
3. Persona-wide `error_handling` remains as baseline (no regression).
4. Rust unit test covers the filtering by enabled set.

**Risk:** Low (pure prompt composition).

**Commit:** one commit.

---

## Phase 8 — Policy enforcement audit log

**Status:** pending

**Goal:** Every `[POLICY] ... dropped` action persists to a queryable table
and surfaces in a per-execution "Policy Events" tab.

**Scope:**
- DB migration: `policy_events` table (or tagged rows on existing `events`
  repo).
- `src-tauri/src/engine/dispatch.rs` — persist at each drop / auto-resolve site.
- Frontend: "Policy Events" tab under execution detail.
- Optional: verification assertion at execution end — if UC declares
  `review_policy: always` but emitted 0 manual reviews, log
  `policy.expectation_mismatch`.

**Success criteria:**
1. Every silent drop produces a persisted row.
2. Execution detail tab lists policy events with payload title + reason.
3. No behavior change in enforcement path.

**Risk:** Medium-low (new table + UI).

**Commits:** 2 — backend persist, frontend tab.

---

## Phase 9 — Per-UC `model_override`

**Status:** pending

**Goal:** `uc_backlog_scan` → Haiku, `uc_implementation` → Opus is respected
at runtime.

**Scope:**
- `src-tauri/src/engine/runner.rs` — model resolution at failover chain build.
- Persona editor UI — surface per-UC model (read-only initially).

**Success criteria:**
1. Failover chain primary is seeded from `design_context.use_cases[uc_id].model_override`
   when set; falls through to persona-level `model_profile`.
2. Backward compat: `null` override uses existing persona-wide model.

**Risk:** Low.

**Commits:** 1–2.

---

## Phase 10 — Schema cleanup (dead fields)

**Status:** pending

**Goal:** Stop lying about features. Each dead field is either wired or removed.

**Scope per field:**
- `core_memories[]` — wire as seed rows into `agent_memories` at promote time,
  OR remove from schema + all 107 templates.
- `examples[]` — wire via `adoption_answers` substitution + linter for PII,
  OR remove.
- `execution_mode` — remove (single-valued "e2e" everywhere) or formally park.
- `verbosity_default` — wire into prompt preamble or remove.
- `connectors[].fallback_note` — Phase 6 wires this into the healthcheck
  fallback path; Phase 10 adds a template linter requiring it when
  `required: false`.

**Success criteria:**
1. Each listed field either has a tested runtime consumer OR is absent from
   schema + templates + normalizer.
2. `C3-schema-v3.1-delta.md` updated with the decisions.
3. `generate-template-checksums.mjs` linter covers the new rules.

**Depends on:** Phases 5–9 (so the keep/cut decisions are informed).

**Risk:** Medium (touches all templates).

**Commits:** one per field (~5 commits).

---

## Execution notes

- Each phase commits atomically. On completion, the `Status:` line in this
  doc flips from `pending` → `in progress` → `complete`, and a brief
  "completed 2026-XX-YY" note lands at the phase end.
- Between phases, run: `npx tsc --noEmit` and `npm run lint` (project
  convention: 0 errors; warnings allowed per CLAUDE.md baseline).
- Rust changes: `cargo check -p personas` (from `src-tauri/`) before commit.
- No `.planning/` directory touches — another CLI session owns GSD state.

---

## Open decisions

1. **Phase 5 listener mount site** — resolved on inspection (see
   Phase 5 progress notes below when complete).
2. **Phase 6 baseline assertion list** — initial set: `["credentials are not configured", "cannot proceed without", "skipping this step because", "I don't have access to"]`. Open to user review before wire-up.
3. **Phase 10 per-field keep/cut decisions** — defer until Phases 5–9 complete.
