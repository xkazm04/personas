---
phase: 17-backend-completion
plan: 01
subsystem: backend-deferred-resolution
tags: [simple-mode, illustration, content_type, schema, ts-rs, template-adoption]
requires:
  - 05-01
  - 06-01
  - 10-01
  - 16-01
provides:
  - Persona.template_category column + ts-rs binding
  - infer_template_category reusable across commands::design
  - Explicit `output` content_type emission from engine/runner.rs
  - Tier-3 illustration resolver (TEMPLATE_CATEGORY_MAP)
  - isMessageOutput precedence: output → result → markdown → keyword
affects:
  - src-tauri/src/db/migrations/incremental.rs
  - src-tauri/src/db/migrations/schema.rs
  - src-tauri/src/db/models/persona.rs
  - src-tauri/src/db/repos/core/personas.rs
  - src-tauri/src/commands/design/reviews.rs (pub(crate))
  - src-tauri/src/commands/design/template_adopt.rs
  - src-tauri/src/commands/design/n8n_transform/types.rs
  - src-tauri/src/commands/design/n8n_transform/confirmation.rs
  - src-tauri/src/commands/design/n8n_transform/streaming.rs
  - src-tauri/src/engine/runner.rs
  - src-tauri/src/engine/{compiler,design,genome,management_api,prompt,types}.rs (test fixtures)
  - src/features/simple-mode/hooks/useIllustration.ts
  - src/features/simple-mode/hooks/adapters/outputAdapter.ts
  - src/features/simple-mode/components/inbox/{InboxList,detail/DetailHeader}.tsx
  - src/lib/bindings/Persona.ts
tech-stack:
  added: []
  patterns:
    - "Incremental SQLite ALTER TABLE gated by PRAGMA table_info lookup — idempotent."
    - "Nullable column + #[serde(default)] + Option<String> so existing JSON payloads + struct literals keep compiling."
    - "pub(crate) visibility on infer_template_category keeps the RULES table private to commands::design while allowing sibling modules to reuse it."
    - "Frontend: tier-3 resolver inserted BETWEEN tier-2 keyword scan and tier-4 hash so manually-named personas (Slack Bot → chat) still win over template_category for the common case where both exist."
    - "isMessageOutput precedence: explicit backend content_type signals short-circuit before the keyword heuristic."
key-files:
  created:
    - src/features/simple-mode/hooks/adapters/outputAdapter.test.ts
  modified:
    - src-tauri/src/db/migrations/{schema,incremental}.rs
    - src-tauri/src/db/models/persona.rs
    - src-tauri/src/db/repos/core/personas.rs
    - src-tauri/src/commands/design/reviews.rs
    - src-tauri/src/commands/design/template_adopt.rs
    - src-tauri/src/commands/design/n8n_transform/{types,confirmation,streaming}.rs
    - src-tauri/src/engine/runner.rs
    - src-tauri/src/engine/{compiler,design,genome,management_api,prompt,types}.rs
    - src/features/simple-mode/hooks/useIllustration.ts
    - src/features/simple-mode/hooks/adapters/outputAdapter.ts
    - src/features/simple-mode/hooks/useIllustration.test.ts
    - src/features/simple-mode/components/inbox/InboxList.tsx
    - src/features/simple-mode/components/inbox/detail/DetailHeader.tsx
    - src/lib/bindings/Persona.ts
decisions:
  - "Use `pub(crate)` on `infer_template_category` rather than moving the function + RULES table to a new `categorization.rs` module. Lower churn, same end result — both reviews.rs and template_adopt.rs live under commands::design so pub(crate) suffices."
  - "Wire template_category at THREE draft-finalization sites in template_adopt.rs (instant_adopt, handle_adopt_result, confirm_template_adopt_draft) so every template-adoption path stamps the column. Each site is guarded by `if draft.template_category.is_none()` so upstream values win."
  - "Runner.rs pre-existing content_type was `'text'`, not `'result'` as the plan's context stated. Renamed to `'output'` per the plan's intent (canonical output marker for the execution-completion hook). The frontend still accepts legacy 'result' as a transitional signal, so no data loss on migration."
  - "Frontend tier-3 TEMPLATE_CATEGORY_MAP collapses the 20-category Rust vocab to 12 bins: legal→writing (document-heavy), hr→meetings (meeting-heavy), marketing→social, project-management→meetings. Unmapped inputs fall through to tier-4 hash — safe + deterministic."
  - "Manually updated src/lib/bindings/Persona.ts to match ts-rs output. `cargo test` cannot run in this workspace (14 pre-existing errors from unresolved `xcap`/`image`/`which`/`desktop_discovery` crates unrelated to Phase 17), so automatic regen was unavailable. Manual value matches exactly what ts-rs would emit for `Option<String>` on a #[ts(export)] struct."
metrics:
  duration_minutes: 23
  completed: 2026-04-21
  tasks_completed: 8
  tests_added: 18
  tests_before: 98
  tests_after: 116
  commits: 6
---

# Phase 17 Plan 01: Backend Completion Summary

Close v1.1 deferred Simple-mode topics with first-class backend signals: `persona.template_category` column (Topic A) + canonical `content_type = 'output'` emission from the execution engine (Topic B). Frontend heuristics stay as fallbacks for legacy/null cases.

## Outcome

- **Topic A — template-category tier-3:** new nullable `template_category` column on personas, populated during template adoption via `infer_template_category`. Frontend resolver reads it through `TEMPLATE_CATEGORY_MAP` (20 Rust categories → 12 illustration bins) as a true tier-3 that sits between keyword scan and hash fallback. Manually-created personas stay null and fall through to tier-4 — unchanged behavior.
- **Topic B — output-kind emission:** `engine/runner.rs` now writes `content_type = 'output'` on its auto-emitted execution-completion message. `isMessageOutput` short-circuits on `'output'` (Phase 17) OR `'result'` (legacy/transitional) OR `'markdown'` (Phase 16 compat) before the keyword heuristic runs. Explicit backend signals win without requiring title/content keyword matches.

Both workarounds shipped in Phase 16 (`extractDesignContextText` for tier-2 enrichment, `isMessageOutput` heuristic) remain in place as fallbacks — they catch messages from code paths that don't yet emit the explicit signals.

## Tasks executed

| # | Task | Commit |
|---|------|--------|
| 1 | schema + struct + repo additions | `cce2b3f5` |
| 2 | N8nPersonaOutput + confirmation INSERT | `edc70e30` |
| 3 | infer_template_category reuse + template-adopt wiring | `19cba289` |
| 4 | runner output content_type rename | `db834790` |
| 5 | Rust build + ts-rs binding regen (manual) | *(folded into 6)* |
| 6 | Frontend tier-3 + TEMPLATE_CATEGORY_MAP + isMessageOutput precedence | `a2a05fa3` |
| 7 | Unit tests (tier-3 mapping + content_type precedence) | `a6fb331d` |
| 8 | Verification gate (tsc 0 / vitest 116/116 / eslint 0 err / all greps OK) | *(no commit)* |

Expected commit count: 6. Actual: 6. Task 5 produced only one user-visible artifact (updated Persona.ts binding) which logically belongs with the frontend tier-3 work, so it was bundled into commit 5 rather than isolated.

## Dependency graph resolved

- `05-01`: Simple-mode foundation — provided `useIllustration` + inbox types this phase extended.
- `06-01`: unified inbox selector — provided the partition surface `isMessageOutput` drives.
- `10-01`: illustration library — provided the 12 bins `TEMPLATE_CATEGORY_MAP` targets.
- `16-01`: deferred-resolution — provided the honest Phase 16 workarounds (design_context enrichment + keyword heuristic) which now become explicit fallbacks behind the new backend signals.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — missing critical functionality] Added `template_category` to the n8n streaming draft constructor**
- **Found during:** Task 5 (cargo check after struct-field addition in Task 2).
- **Issue:** `N8nPersonaOutput` is built in two places (template_adopt.rs AND n8n_transform/streaming.rs). Only adding the field without patching both struct literals broke compilation (E0063 missing field).
- **Fix:** Added `template_category: None` to the streaming.rs literal with a comment noting future improvement path (thread workflow description through the merger so tier-3 applies to n8n imports too).
- **Files modified:** `src-tauri/src/commands/design/n8n_transform/streaming.rs`
- **Commit:** `a2a05fa3` (bundled with frontend work since they're interdependent)

**2. [Rule 3 — blocking issue] Added `template_category: None` to 7 Persona struct literals across test fixtures**
- **Found during:** Task 1 (cargo check after adding the new field to `Persona`).
- **Issue:** Seven test fixtures across `compiler.rs`, `design.rs`, `genome.rs`, `management_api.rs` (×2), `prompt.rs`, and `types.rs` construct Persona literals directly and would break the build if the new field wasn't added.
- **Fix:** Added the field with `None` — tests don't care about template_category at their test layer.
- **Files modified:** 6 files under `src-tauri/src/engine/`.
- **Commit:** `cce2b3f5` (bundled with Task 1 since it's the same struct change).

**3. [Rule 3 — blocking issue] Added `template_category: null` to 2 synthesized-persona call sites**
- **Found during:** Task 8 (tsc after widening PersonaLike).
- **Issue:** `InboxList.tsx` and `DetailHeader.tsx` synthesize a persona-shaped object when the persona row is missing (optimistic render). Widening PersonaLike's Pick made template_category a required field; the synthesized literals needed the field too.
- **Fix:** Added `template_category: null` to both literals with an explanatory comment.
- **Commit:** `a2a05fa3` (bundled with frontend tier-3).

### Planning-note corrections

**4. [Plan context drift] runner.rs pre-existing content_type was `'text'`, not `'result'`**
- The plan's context said "Existing tokio::spawn block already INSERTs a persona_message with `content_type = 'result'`". Actual code at `runner.rs:1928` had `'text'`.
- Applied the plan's **intent** (canonical `'output'` marker for execution-complete messages) rather than the literal renaming instruction.
- The frontend heuristic accepts BOTH 'output' (new) and 'result' (legacy) — so any historical 'result' rows from other code paths still land in the output bucket.

### Binding regeneration

**5. [Tooling constraint] ts-rs auto-regen unavailable in this workspace**
- `cargo test` is the canonical ts-rs regen path for this project (no explicit export binary / script found in the repo).
- `cargo test` fails to compile due to 14 pre-existing errors (unrelated to Phase 17) from unresolved crates `xcap`, `image`, `which`, and `desktop_discovery::*`. These are feature-flag-gated dependencies missing from the current Cargo.toml (confirmed by re-running `cargo check` on a stashed clean tree — same errors).
- **Resolution:** manually updated `src/lib/bindings/Persona.ts` to add `template_category: string | null`, matching the exact format ts-rs would emit for `Option<String>` on a `#[ts(export)]` struct. Verified by inspecting sibling bindings in the file (e.g., `parameters: string | null` for the same type pattern).
- When the pre-existing crate issues are fixed in a future phase, `cargo test` will regenerate Persona.ts and the result should be byte-identical to the manual version.

No architectural changes (Rule 4) were required.

## Authentication gates

None — pure codebase work.

## Known Stubs

**1. N8n-streaming draft template_category**: set to `None` in `n8n_transform/streaming.rs`. Personas created via the n8n-transform path (distinct from template adoption) won't populate the column at this layer. The `handle_adopt_result` fallback in template_adopt.rs covers the adopt path; the n8n confirmation path could gain a similar backfill in a future polish phase if users report illustration-resolution quality issues on n8n-imported personas. Documented inline with the stub.

## Verification gate

```
cd src-tauri && cargo check
  → 14 pre-existing errors (unrelated, feature-gated), 0 errors from Phase 17 changes.
  → Confirmed by stashing changes and re-running: same 14 errors on clean tree.

npx tsc --noEmit
  → exits clean (0 errors).

npx vitest run src/features/simple-mode
  → 5 files, 116/116 tests pass. Previous: 98. Added: 18 (8 tier-3 + 10 content_type precedence).

npx eslint src/features/simple-mode
  → 0 errors, 127 warnings (all pre-existing custom/no-raw-* + react-hooks/exhaustive-deps per CLAUDE.md baseline).

Grep checks (all pass):
  template_category in incremental.rs, schema.rs, persona.rs, types.rs, confirmation.rs,
                       Persona.ts binding, useIllustration.ts (as TEMPLATE_CATEGORY_MAP)
  infer_template_category in template_adopt.rs
  "output" in runner.rs (1 occurrence — the renamed literal)
```

## Self-Check: PASSED

- Files created exist:
  - `src/features/simple-mode/hooks/adapters/outputAdapter.test.ts` — FOUND.
- Commits exist (git log):
  - `cce2b3f5`, `edc70e30`, `19cba289`, `db834790`, `a2a05fa3`, `a6fb331d` — all FOUND.
