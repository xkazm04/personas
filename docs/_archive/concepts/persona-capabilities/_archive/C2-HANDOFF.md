# C2 Handoff — Template Migration + Testing

> Hand-off from the 2026-04-19 session to the next CLI session. The outgoing
> session ran a full live-harness adoption sweep across 107 templates, fixed
> one React render crash inline, and set up the mechanism + infrastructure
> for the C2 capability-template migration. This doc is the durable state
> for picking up where we left off.

## Read these first, in order

1. [00-vision.md](00-vision.md) — mental model (1 persona = identity + capabilities)
2. [02-use-case-as-capability.md](02-use-case-as-capability.md) — what qualifies as a capability
3. [06-building-pipeline.md](06-building-pipeline.md) — AgentIr v2 + template v2 schema (primary ref)
4. [09-implementation-plan.md](09-implementation-plan.md) — phase sequencing
5. **[C2-template-audit.md](C2-template-audit.md)** — structural audit (107 templates)
6. **[C2-content-review.md](C2-content-review.md)** — content-quality audit (27 deep, 80 extrapolated)
7. **[C2-execution-plan.md](C2-execution-plan.md)** — redesign strategy + sequencing
8. **[C2-sweep-results.md](C2-sweep-results.md)** — live-harness sweep results
9. This doc.

## Status snapshot (2026-04-19)

| Phase | State |
|---|---|
| C1 runtime foundation | Being implemented by another terminal (files: `engine/prompt.rs`, `commands/execution/executions.rs`, `db/models/persona.rs`, `engine/background.rs`, `src/lib/types/frontendTypes.ts`). **Do not touch those files.** |
| C2 AgentIr v2 fields | Done (`src-tauri/src/db/models/agent_ir.rs` — round-trip tests passing) |
| C2 template v2 pilot | 1 of 107 templates migrated (`email-morning-digest.json` with `schema_version: 2`, `capability_summary`, `tool_hints`, `scope` on all questions) |
| C2 questionnaire scope UI | **Wrong component** — scope grouping added to `QuestionnaireFormGrid.tsx` but adoption renders `QuestionnaireFormFocus.tsx`. Needs to move. |
| C2 live-harness sweep | ✅ Ran against all 107 templates. Report: `tools/test-mcp/reports/c2-sweep-20260419_125431.json` |
| C2 107-template mechanical migration | Not started |
| C2 107-template content hand-pass | Not started |

## What the sweep proved

- 107 templates adopted end-to-end via the live Tauri app
- **Adoption + promote works for 51/107** (grades A+B+C), metadata populated
- **Triggers carry `use_case_id`** on 53/107 (semantic linkage via `build_structured_use_cases` works)
- **Subscriptions DON'T carry `use_case_id`** on 48/107 (v1 content gap — fixed by v2 per-capability event_subscriptions)
- **Adoption pipeline has no catastrophic code bugs** except one React crash that was fixed inline

## Bugs surfaced + fixed this session

### 1. React render crash on `{label,value}` option objects (fixed)
- **File:** `src/features/templates/sub_generated/adoption/QuestionnaireFormGridParts.tsx:357`
- **Templates affected:** 9 (`audio-briefing-host`, `game-character-animator`, `scientific-writing-editor`, `agency-client-retainer-manager`, `website-market-intelligence-profiler`, `crm-data-quality-auditor`, `local-business-lead-prospector`, `outbound-sales-intelligence-pipeline`, `website-conversion-auditor`)
- **Fix:** Adoption options mapper now accepts both string and `{label, value}` object shapes.

### 2. Stack overflow on disable-persona (fixed defensively)
- **Symptom:** `STATUS_STACK_OVERFLOW` in `personas-desktop.exe` when disabling a persona after the sweep created 49 personas.
- **Root cause:** Sync Tauri commands (`pub fn`) run on the Windows main thread with the default 1 MB stack; serde recursion on deeply-nested persona payloads exhausts it.
- **Fix:** `src-tauri/.cargo/config.toml` now sets `rustflags = ["-C", "link-arg=/STACK:8388608"]` for `x86_64-pc-windows-msvc` + `aarch64-pc-windows-msvc`. Requires rebuild.

### 3. Questionnaire UX improvements (done)
- **Enter confirms + advances** on any answered question (QuestionnaireFormFocus.tsx keyboard handler)
- **Multi-selects always allow custom input** — template's `allowCustom: false` no longer wins over multi-select behavior (SelectPills.tsx line 52)

### 4. Adoption Matrix connectors show icons + friendly labels (done)
- **Was:** raw slug "alpha_vantage — description" shown in Glass/Blueprint matrix variants
- **Now:** icon + "Alpha Vantage" via `getConnectorMeta` + `ConnectorIcon`
- **Files:** `PersonaMatrixGlass.tsx`, `PersonaMatrixBlueprint.tsx`

## Known issues NOT fixed

| Issue | Location | Effort |
|---|---|---|
| Scope-grouping UI in wrong component | `QuestionnaireFormGrid.tsx` vs `QuestionnaireFormFocus.tsx` — adoption uses Focus. Either migrate grouping to Focus or have adoption switch to Grid for v2 templates. | 30 min |
| Gallery has no V2 badge/filter | User can't distinguish v2 from v1 templates visually. Add a `schema_version >= 2` badge in `ComfortableRow.tsx`. | 20 min |
| Subscriptions not attributed | 48 templates hit `create_event_subscriptions_in_tx` with empty reverse-map because v1 templates don't nest subscriptions per use_case. Fixed automatically by v2 migration. | per-template (content) |
| 32 templates blocked by `vault_category` questions | Adoption stalls when the vault has no matching credential. Either pre-seed creds in test env, or redesign questions to be skip-able / deferred. | see C2-content-review §3 |
| 9 templates hang initializing w/o vault_category | Some have `source_definition` / `directory_picker` / `devtools_project` question types my auto-filler doesn't handle. | per-template |
| 5 D-grade templates promoted but `design_context.useCases` empty | Adoption succeeded but useCases never wrote. Worth a dedicated bug investigation. | 1-2h |

## Files touched this session (keep/revert decisions)

| File | What changed | Keep? |
|---|---|---|
| `src-tauri/.cargo/config.toml` | Windows stack size bump | **KEEP** — prevents disable-persona crash |
| `src-tauri/src/db/models/agent_ir.rs` | v2 fields + round-trip tests | **KEEP** — C2 Step 1 complete |
| `src-tauri/src/commands/design/template_adopt.rs` | untouched | — |
| `src-tauri/src/test_automation.rs` | `/persona-detail` HTTP route + `getPersonaDetail` bridge method | **KEEP** — sweep dependency |
| `src/test/automation/bridge.ts` | `getPersonaDetail` bridge method | **KEEP** |
| `src/lib/types/designTypes.ts` | `AdoptionQuestionScope`, `inferQuestionScope`, `questionCapabilityId` helpers | **KEEP** |
| `src/api/templates/n8nTransform.ts` | scope/use_case_id/connector_names on TransformQuestionResponse | **KEEP** |
| `src/features/templates/sub_generated/adoption/QuestionnaireFormGrid.tsx` | Scope grouping (wrong component — see known issues) | **KEEP BUT MIGRATE** — needs to move to `QuestionnaireFormFocus.tsx` |
| `src/features/templates/sub_generated/adoption/QuestionnaireFormGridConfig.ts` | `groupByScope`, `inferScope`, `ScopeSection` helpers | **KEEP** — reusable for Focus variant |
| `src/features/templates/sub_generated/adoption/QuestionnaireFormGridParts.tsx` | Options type-safe (string or object) | **KEEP** — real bug fix |
| `src/features/templates/sub_generated/adoption/QuestionnaireFormFocus.tsx` | Enter advances + submits | **KEEP** |
| `src/features/templates/sub_generated/adoption/SelectPills.tsx` | Multi always allows custom | **KEEP** |
| `src/features/templates/sub_generated/adoption/PersonaMatrixGlass.tsx` | Connector icons in cell | **KEEP** |
| `src/features/templates/sub_generated/adoption/PersonaMatrixBlueprint.tsx` | Connector icons in cell | **KEEP** |
| `scripts/templates/productivity/email-morning-digest.json` | v2 pilot | **KEEP** — reference template |
| `src-tauri/src/engine/template_checksums.rs` | regenerated | **KEEP** |
| `src/lib/personas/templates/templateChecksums.ts` | regenerated | **KEEP** |
| `tools/test-mcp/e2e_c2_sweep.py` | New full-catalog sweep harness | **KEEP** |
| `tools/test-mcp/reports/c2-sweep-20260419_125431.json` | Sweep report | **KEEP** |
| `docs/concepts/persona-capabilities/C2-*.md` | Design + audit docs | **KEEP** |
| `docs/guide-adoption-test-framework.md` | Rewritten for live harness | **KEEP** |

## Recommended next-session sequencing

### 1. Validate the v2 pilot end-to-end (~30 min)
1. Restart the app (after the stack-size rebuild).
2. Run `uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py --template "Email Morning Digest"`.
3. Confirm grade A/B (was grade B before — with the object-options fix + schema_version marker it should be better).
4. Open the persona in the Agents tab and verify the design_context has `schema_version: 2` influence (capability_summary rendered in prompt assembly, etc.).

### 2. Move scope-grouping UI to the Focus questionnaire (~1h)
Either:
- **Option A**: Move the `groupByScope` + `ScopeSection` rendering from `QuestionnaireFormGrid.tsx` to `QuestionnaireFormFocus.tsx` — add a left-rail panel showing scope sections, current one highlighted.
- **Option B**: Route v2 templates to `QuestionnaireFormGrid` in `MatrixAdoptionView.tsx`, keep v1 on Focus. Cleaner separation, but doubles the UI surface to maintain.

Option A recommended — matches existing Focus-mode UX.

### 3. Write the mechanical migration script (`C2 §7 Step 4`) (~2h)
- `scripts/migrate_templates_v2.mjs` per [C2-template-audit.md §3](C2-template-audit.md)
- Pseudocode is already in the audit doc
- Handle edge cases (flow/trigger mismatch, object-shape options, `suggested_parameters`)
- Output `.report.json` with per-template warnings

### 4. Bulk-run the migration script on all 107 templates (~15 min)
- Produces 107 updated template JSONs with `schema_version: 2`, `capability_summary: ""` (TODO), `tool_hints: []` (TODO), question `scope` tags
- Commit as one bulk migration
- Regenerate checksums after

### 5. Re-run the sweep (~60 min)
- Expected improvement: subscriptions_attributed passes jump from 5 → ~60 templates (v2 per-capability subscriptions now linkable)
- Write results to `c2-sweep-postmigration-<ts>.json` for comparison

### 6. Hand-fill pass (per C2-content-review §7 tiers)
- Tier 1 (7 flagships, ~10h): `financial-stocks-signaller`, `digital-clone`, `client-portal-orchestrator`, `youtube-content-pipeline`, `autonomous-cro-experiment-runner`, `autonomous-issue-resolver`, `onboarding-tracker`
- Tier 2 (28 per-category, ~28h)
- Tier 3 (72 bulk, ~20h)

### 7. Fix the 5 D-grade templates (investigate design_context useCases missing)
- Template IDs in the sweep report (`grade: "D"` entries)
- Likely: `build_structured_use_cases` returns empty for specific `AgentIr` shapes — investigate by stepping through one of them

## Live-harness cheat sheet

```bash
# Launch app with test-automation (first time takes ~1 min to compile)
npx tauri dev --features test-automation

# Wait for port 17320
curl http://127.0.0.1:17320/health

# Single template
uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py --template "Incident Logger"

# One category
uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py --category finance

# Full catalog (~60 min)
uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py

# Inspect created persona via the new /persona-detail endpoint
curl -s -X POST http://127.0.0.1:17320/persona-detail \
  -H "Content-Type: application/json" \
  -d '{"persona_id":"<persona-uuid>"}' | python -m json.tool
```

## Sweep runner hot spots (in `tools/test-mcp/e2e_c2_sweep.py`)

- `reload_app()` — full page reload between templates, avoids lingering build session state
- `click_submit_all()` — advances through focus-mode questions (Next×N → Submit All); also auto-selects first pill when nothing selected
- `fill_empty_text_inputs()` — fills blank text/textarea inputs with `"c2-sweep"`
- Per-template flow: reload → gallery → find review_id → /open-matrix-adoption → fill+submit → poll buildPhase → test agent → promote → fetch /persona-detail → grade
- Personas are **never deleted** — kept for user inspection

## C1 files — DO NOT TOUCH

The other CLI terminal is editing these; cross-terminal conflicts will corrupt:

- `src-tauri/src/engine/prompt.rs`
- `src-tauri/src/commands/execution/executions.rs`
- `src-tauri/src/engine/background.rs` (scheduler_tick comment scope)
- `src-tauri/src/db/models/persona.rs` (DesignUseCase fields)
- `src/lib/types/frontendTypes.ts` (DesignUseCase type)

When in doubt, read those files but don't edit.

## Open questions to resolve with the user

1. **Scope of v2 content rewrite** — is a full content redesign (per C2-content-review) in-scope for C2, or is that a separate milestone?
2. **Vault-blocked templates** — 32 templates block on `vault_category` questions without matching creds. Template redesign or vault pre-seeding?
3. **Catalog restructure** — merge candidates (email cluster, sales CRM cluster, guardians cluster per C2-content-review §6.2). Post-C2 milestone?
4. **Retire duplicates** — `sales/website-conversion-auditor` vs. `marketing/website-conversion-audit` (same template twice).

## Appendix — Session chronology

- Started with C1 runtime foundation work (moved to other terminal)
- Added AgentIr v2 fields + round-trip tests
- Delegated subagent audits: structural (C2-template-audit.md) + content (C2-content-review.md)
- Designed questionnaire scope mechanism + wrong-component scope-grouping UI
- Piloted `email-morning-digest` to v2 shape (capability_summary, tool_hints, scope tags, schema_version)
- Built live-harness sweep (`e2e_c2_sweep.py`) against all 107 templates
- Fixed 3 inline bugs: `{label,value}` option crash, Windows main-thread stack size, Enter-to-confirm
- Added UI polish: multi-select custom input always allowed, Matrix connector icons in Glass/Blueprint
- Identified 56 incomplete templates (32 vault-blocked, 9 type-blocked, 9 grade-F-on-validation, 4 promote-failed, 1 flow-less, 1 race)
