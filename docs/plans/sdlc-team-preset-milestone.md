# SDLC Team Preset Milestone — Execution Plan

**Status:** in progress (started 2026-05-26)
**Owner session:** Teams milestone CLI (continues across compaction)
**Worktree:** `.claude/worktrees/sdlc-team-preset` (branch `worktree-sdlc-team-preset`)

## Goal (user's 4-part request)

Apply the 5 from-scratch-built SDLC personas into the Teams/pipeline system:

1. **Promote** the 5 glyph-built SDLC personas into reusable best-practice **templates** anyone can adopt.
2. **Review** the `/add-template` skill so future templates fit current design/practices.
3. **Create an SDLC Team preset** wrapping the persona group into an easy, adoptable experience.
4. **Test preset adoption** in the real live app — adopt the whole team with much less effort while preserving the same persona quality as the from-scratch builds.

## The 5 source personas (in persistent DB)

`C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db`

| short id | name | role in lifecycle |
|---|---|---|
| `a5652ba7` | Architecture Solution Guide | architect (ADRs, task breakdown) |
| `4147645f` | AI Bookkeeper Code Reviewer | reviewer |
| `88c89770` | Release Manager | release |
| `8ea131ec` | Security Sentinel | security |
| `a31c1255` | Docs Steward | docs |

All `enabled=1, setup_status=ready`. Built on the **bookkeeper** codebase, value-validated earlier this session.

## Key findings from investigation (anchor the plan)

### No persona→template export path exists
Greps for `export_persona`/`persona_to_template`/`derive_template`/`save as template` → zero hits. **Templates must be authored from the persona DB data** (by a focused script + hand-polish). This is task #1's core work.

### Persona data → template field mapping (verified against the DB)
- `personas.structured_prompt` = `{ identity, instructions, toolGuidance, errorHandling, examples }`
  - `identity` → `payload.persona.identity.{role,description}` (split) + `goal`
  - `instructions` → `payload.persona.operating_instructions`
  - `toolGuidance` → `payload.persona.tool_guidance`
  - `errorHandling` → `payload.persona.error_handling`
  - `examples` → `payload.persona.examples` (deprecated field; keep `[]` or summarize)
- `personas.description` → template `description` / persona `goal` seed
- `personas.design_context.useCases[]` — **the gold**: each is a fully-formed use-case object
  `{ id, title, description, category, execution_mode, review_policy, memory_policy, event_subscriptions, suggested_trigger, error_handling }`
  → one **recipe seed** per use case + one `use_cases[].recipe_ref` in the template.
- `persona_triggers` / `persona_event_subscriptions` / `persona_tools` — wired capability detail (mirrored per-use-case in design_context).
- `personas.notification_channels`, `personas.parameters` → template defaults / adoption questions.

### Template anatomy (schema_version 3) — gold standard = `scripts/templates/development/qa-guardian.json`
Top-level: `id, schema_version:3, name, description, icon, color, category[], is_published, service_flow[], payload`.
`payload.persona`: `goal, identity{role,description}, voice{style,output_format}, principles[], constraints[], decision_principles[], verbosity_default, trigger_composition, message_composition, operating_instructions, tool_guidance, error_handling, examples[], tools[], connectors[], notification_channels_default[], core_memories[]`.
`payload.use_cases[]`: each `{ recipe_ref: { id (uuid), version "1.0.0", bindings {} } }` — **no inline use_cases in v3**.
`payload.adoption_questions[]`: `{ id, scope (connector|persona), connector_names[], use_case_id, category, question, type, optional, allow_custom, default, maps_to, variable_name, context, dimension, dynamic_source{service_type,operation,source} }`.
`payload.persona_meta`: `{ name "T: <Name>", icon, color }`.

**Best-practice requirements (enforced by `generate-template-checksums.mjs` lint):**
- Every **optional** connector MUST have a `fallback_note`.
- Dimensional presets required: `trigger_composition`, `message_composition`, `error_handling`, per-use-case `review_policy`/`memory_policy`/`event_subscriptions`.
- `core_memories`/`examples`/`verbosity_default` deprecated — keep empty/minimal.

### Recipe seeds — `scripts/templates/_recipe_seeds.json`
`{ version, ref, recipe_count, recipes[] }`. Each recipe:
`{ id (uuid), source_template_id, source_use_case_id, source_use_case_name, source_version "1.0.0", name, description, category, prompt_template (JSON-string of the use-case object), tool_requirements, tags ["<template-id>","derived"] }`.
- **INSERT-ONLY**, keyed on `(source_template_id, source_use_case_id)` — re-seeding never overwrites (`src-tauri/src/engine/recipe_seed.rs`).
- `include_str!`-embedded into the native binary → **rebuild required** for new recipes to load.
- `use_cases[].recipe_ref.id` MUST equal the recipe `id`.
- New recipe UUIDs: mint deterministic (e.g. uuid v5 from `<template-id>:<use-case-id>`) so re-runs are stable.

### Registration & checksums
- Templates are **directory-scanned** (`scripts/templates/**/*.json`, Vite glob front-end + `template_checksums.rs` back-end). No manifest.
- A template becomes adoptable when: JSON exists under `scripts/templates/<category>/`, `is_published:true`, checksums regenerated (`node scripts/generate-template-checksums.mjs` → `src/lib/personas/templates/templateChecksums.ts` + `src-tauri/src/engine/template_checksums.rs`), **app rebuilt**.
- Catalog load fails loudly on ID collision / checksum mismatch / schema-shape failure → validate before rebuild.

### Team preset — `scripts/templates/_team_presets/*.json` (FEATURE-COMPLETE backend)
Manifest shape (from `backlog-execution.json`):
`{ id, schema_version:1, name, description, icon, color, category[], team{name,description,color}, group{name,color,shared_instructions}, members[{template_id, role (free semantic string), x, y}], connections[{from,to,connection_type (data|feedback),label}] }`.
- Adoption: `adopt_team_preset` → create `persona_teams` → optional `persona_groups` workspace → per-member `instant_adopt_template_inner` → set `personas.home_team_id` → `teams::add_member` (role mapped to CHECK orchestrator/worker/reviewer/router) → wire `persona_team_connections`. Partial-success semantics, progress events `team-preset-adopt-progress`.
- **References `template_id` per member → task #1 is a hard prerequisite for task #3.**
- Frontend: `PresetPreviewModal.tsx`, `src/api/templates/teamPresets.ts`; commands `src-tauri/src/commands/design/team_presets.rs`. Doc: `docs/features/templates/08-team-presets.md`. e2e: `tests/playwright/preset-team-adoption.spec.ts`.
- **No backend code changes needed for adoption — only the manifest JSON.**

## Generalization requirement (the "best-practice, anyone can reuse" bar)
The source personas hard-code "ai-bookkeeper / Next.js/React/Zustand/Plaid". Templates must be **generic**:
- Replace concrete codebase references with neutral language ("your codebase", "the registered repository").
- Lift the codebase into a `connector` (category `development`, `dynamic_source.list_credentials`) + an `adoption_question` (like qa-guardian's `aq_target_codebase`).
- Lift any project-specific event names / thresholds into adoption questions where they vary per adopter; keep the cross-persona event contract (e.g. `architecture.analysis.completed`) intact since the preset wires those.

## Template ID plan (no collisions verified vs `scripts/templates/development/`)
Proposed IDs + categories (final naming decided at authoring; flag overlaps):
- `solution-architect` (development)
- `code-reviewer` (development)
- `release-manager` (devops)
- `security-sentinel` (security)
- `docs-steward` (development) — **overlap review:** existing `documentation-freshness-guardian` is adjacent; differentiate scope (Docs Steward = keep docs synced to shipped changes) or note as sibling.

## Cross-persona event contract (drives preset connections)
From design_context/events (verify per persona during authoring):
- architect emits `architecture.analysis.completed` → (code-reviewer / dev consumers listen)
- reviewer emits review-decision/completion events
- security emits findings events
- release-manager consumes upstream completion, emits release events
- docs-steward listens for shipped-change events
Map these into preset `connections[]` (`connection_type: data` for handoffs, `feedback` for learning loops).

---

## Execution phases

### Phase 0 — Coordination ✅ (done)
- Read active-runs ledger (no live conflict; all entries stale from 2026-05-25). Register an `## Active` entry.
- Create worktree `.claude/worktrees/sdlc-team-preset`.

### Phase 1 — Promote 5 personas → 5 templates (task #1)
1. Write `scripts/promote-personas-to-templates.mjs` (reusable; reads DB, emits scaffold template JSON + recipe rows). Keyed on the 5 ids; mints uuid-v5 recipe ids.
2. For each persona: generate scaffold, then **hand-polish** for best-practice + generalization (goal, voice, principles, constraints, decision_principles, connectors+fallback_note, adoption_questions, persona_meta, de-specialize bookkeeper → generic).
3. Append recipe rows to `_recipe_seeds.json` (bump `recipe_count`; leave `ref` or update).
4. Write 5 template JSONs under correct category dirs with `is_published:true`.
- **Commit per template** (atomic).

### Phase 2 — Checksums + validation (task #1 completion)
- `node scripts/generate-template-checksums.mjs` (regen both manifests).
- Verify no ID collision / checksum / schema failure; confirm 5 templates present.
- Lint: every optional connector has `fallback_note`.
- Commit checksums.

### Phase 3 — Review `/add-template` skill (task #2)
- Read `.claude/skills/add-template/skill.md` fully.
- Assess currency vs: schema v3.1, recipe_seeds insert-only, checksum regen, team-preset coupling, **the missing persona→template path**.
- Write recommendations; patch the skill if gaps found (e.g. add generalization checklist, recipe-seed step, persona→template note). Commit.

### Phase 4 — Author SDLC team preset (task #3)
- `scripts/templates/_team_presets/sdlc-lifecycle.json`: 5 members (template_ids from Phase 1) + roles + x/y layout, `connections[]` from the event contract, `group.shared_instructions` (codebase-grounded, cite evidence, prefer empirical), `team`/`group` metadata.
- Validate against `team_preset_loader.rs` expectations (member template_ids must resolve). Commit.

### Phase 5 — Live-app adoption test (task #4)
- Rebuild: `npm run tauri:dev:test` (recipes are `include_str!` → rebuild mandatory; templates via glob + checksums in binary). App may bind **:17321** (zombie on :17320) — drivers honor `PERSONAS_BASE`.
- Drive `adopt_team_preset` through the real UI (PresetPreviewModal) 1:1 — pick codebase connector during the questionnaire.
- **Verify in SQLite (success≠match):** `persona_teams` row, 5 `persona_team_members`, 5 new `personas` with structured_prompt quality matching the originals, `home_team_id` set, `persona_team_connections` wired, triggers/events created.
- Compare adopted-persona quality vs from-scratch originals (success criterion: "same quality").
- Execute one adopted persona → confirm business value.
- Update memory + this plan with results. Move ledger entry to `## Recently completed` with commit SHA.

### Docs sync (per CLAUDE.md, same session)
- Update `docs/features/templates/README.md` + `08-team-presets.md` (new SDLC preset + templates).
- feature-doc-map / onboarding / marketing: assess; dismiss if internal-only.

## Risks / gotchas
- **Rebuild required** before live test (recipes embedded). ~lite build.
- Recipe insert-only: if a recipe id already exists from a prior run, it won't update — use stable uuid-v5 and delete-on-rerun only if needaut.
- Catalog load is fail-loud — a malformed template blocks ALL templates; validate each before rebuild.
- Preset member roles: manifest role is free string; adopter maps to CHECK(orchestrator/worker/reviewer/router) — verify mapping in `team_preset_adopter.rs`.
- Generalization must not break the cross-persona event contract the preset connections depend on.
