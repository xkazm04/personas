# Code-refactor scan — Templates Catalog & n8n Adoption

> Total: 12 findings (3 high, 6 medium, 3 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: many listed paths don't exist — actual locations are: `src/features/templates/{sub_generated,sub_n8n,sub_recipes,sub_diagrams,components}`, `src/api/templates/{n8nTransform,templateAdopt,templateFeedback}.ts`, `src/lib/templates/{templateVerification,personaSafetyScanner}.ts`, `src-tauri/src/commands/design/{template_adopt.rs,template_feedback.rs,n8n_transform/*,n8n_sessions.rs}`, `src-tauri/src/db/repos/{communication/template_feedback.rs,resources/n8n_sessions.rs}`. No `templateSlice`/`n8nSlice` zustand stores. No `src-tauri/data/templates` (templates JSON live in `scripts/templates/`).

## 1. Orphan adoption-job runners and prompt builders in template_adopt.rs (Stage A1 leftover)

- **Severity**: high
- **Category**: dead-code
- **File**: `src-tauri/src/commands/design/template_adopt.rs:687-1178, 1519-1584`
- **Scenario**: Stage A1 (2026-05-09) deleted six legacy adoption `#[tauri::command]` entry points (`start_template_adopt_background`, `clear_template_adopt_snapshot`, `cancel_template_adopt`, `confirm_template_adopt_draft`, `generate_template_adopt_questions`, `continue_template_adopt`) — documented as a banner comment in `src/api/templates/templateAdopt.ts:20-28`. However the private workers that backed them were left behind: `extract_template_seed_questions` (L687), `build_template_adopt_unified_prompt` (L694, ~140 LOC), `run_unified_adopt_turn1` (L834, ~75 LOC), `run_continue_adopt` (L908, ~130 LOC), `build_template_adopt_prompt` (L1040, ~140 LOC), `run_template_adopt_job` (L1519, ~65 LOC). Grep confirms none of these are called anywhere outside this file (`build_template_adopt_prompt` is only called by the orphan `run_template_adopt_job`, etc.) Also dead: helper state-mutators `set_adopt_questions` (L101), `set_adopt_claude_session` (L107), `get_adopt_claude_session` (L113) — only the orphan async fns use them.
- **Root cause**: Frontend command surface was pruned without dead-code-eliminating the Rust-side workers. `rustc` doesn't warn because the items remain reachable from inside the same module via the broken function chain.
- **Impact**: ~550 LOC of zombie code in a 1723-line file (32% of the file). Slows future refactors, leaks `N8nPersonaOutput` parsing wiring that no longer matters, holds the only remaining references to `ADOPT_JOBS.update_extra(...).set_questions/.set_claude_session` paths so they look load-bearing when they're not. Also retains a 140-line LLM prompt template that drifts from the actual one used in `n8n_transform/prompts.rs::build_n8n_transform_prompt` (silent duplication risk).
- **Fix sketch**: Delete `extract_template_seed_questions`, `build_template_adopt_unified_prompt`, `run_unified_adopt_turn1`, `run_continue_adopt`, `build_template_adopt_prompt`, `run_template_adopt_job`, plus the now-unused helpers `set_adopt_questions`, `set_adopt_claude_session`, `get_adopt_claude_session`, and the `claude_session_id`/`questions` fields on `AdoptExtra` (L62-66). Update the `AdoptSnapshotExtras` struct similarly. After removal verify `cargo check` still passes — the remaining live surface is `get_template_adopt_snapshot`, `instant_adopt_template`, `verify_template_integrity{,_batch}`, `get_template_manifest_count`, and the generate-template job path.

## 2. Duplicate N8nQuestion renderer logic across List + Stepper widgets

- **Severity**: high
- **Category**: duplication
- **File**: `src/features/templates/sub_n8n/widgets/N8nQuestionListView.tsx` and `N8nQuestionStepper.tsx`
- **Scenario**: Both widgets render the same three input variants (`select` → `N8nQuestionListbox`, `text` → `<input>`, `boolean` → toggle buttons) against the same `TransformQuestion` shape, with the same `userAnswers[q.id] ?? q.default ?? ''` fallback formula, the same 6-tone color cycle, and the same dimension-icon map (KeyRound/Settings2/ShieldCheck/Brain/Bell). `N8nQuestionListView.tsx:81-120` and `N8nQuestionStepper.tsx:131-172` are ~40 lines of near-identical JSX (only minor padding/spacing variances and the stepper wraps in motion.div).
- **Root cause**: Two layout modes (vertical list vs paged stepper) were each implemented top-down rather than as two shells around a shared `<QuestionInput question answer onChange tone />` cell.
- **Impact**: ~80 duplicate LOC; bugs/UX fixes (e.g. boolean default `['Yes','No']`, placeholder text) must be made in two places. The stepper also has hard-coded English `DIMENSION_LABELS` (L8-14) while the list view properly translates via `t.templates.questionnaire.category_labels` — a real drift bug visible now.
- **Fix sketch**: Extract `QuestionAnswerInput.tsx` (props: `question`, `value`, `onChange`, `selectedClassName`) covering the select/text/boolean rendering. Extract a `useDimensionLabels()` hook returning the translated map (icon + label). List & Stepper become thin layout shells. Removes ~80 LOC and fixes the i18n drift.

## 3. Duplicate filter-dropdown shell across gallery search filters

- **Severity**: high
- **Category**: duplication
- **File**: `src/features/templates/sub_generated/gallery/search/filters/ConnectorFilterDropdown.tsx`, `ComponentFilterDropdown.tsx`
- **Scenario**: Both files (154 + 161 LOC) implement the same searchable-multi-select dropdown: identical `useClickOutside`, `useViewportClampAbsolute`, `useDebounce` plumbing; identical search input box with focus-on-open `setTimeout(..., 50)`; identical sort-then-filter-by-debounced-query memo chain; identical `toggleX`, `setX([])`, "clear all" footer, count badge, and per-row checkbox UI. Only the data source (`ConnectorWithCount[]` vs `ComponentWithCount[]`), label resolver (`getConnectorMeta` vs `ARCH_CATEGORIES[k]?.label`), icon (`ConnectorIcon` vs `cat.icon`), and trigger-button label/icon differ.
- **Root cause**: Built component-first instead of extracting a `FilterDropdown<T>` generic shell when the second consumer appeared.
- **Impact**: ~300 LOC duplicate. Recent feature work (e.g. `highlightMatch`, debounced search, viewport clamp) shows up twice. Any future filter (e.g. "category", "use case", "platform") will spawn a third clone unless this is consolidated.
- **Fix sketch**: Extract `<FilterDropdown<T>>` taking `{items, selected, setSelected, getItemKey, getItemLabel, getItemCount, renderItemIcon, triggerLabel, triggerIcon, accentColor, searchPlaceholder, t}`. Each concrete dropdown becomes a 30-line config wrapper. `SortDropdown.tsx` (68 LOC) is partly similar but single-select; could share a `BaseDropdown` ancestor.

## 4. Dead exports in templateVerification.ts

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/lib/templates/templateVerification.ts:26, 62, 194, 211`
- **Scenario**: Four exported symbols have zero call sites in `src/`: `computeContentHash` (async Web-Crypto variant; only `computeContentHashSync` is used by `templateCatalog.ts:157` and `verifyTemplate`), `registerBuiltinTemplate` (singular; only the plural `registerBuiltinTemplates` is called from `templateCatalog.ts:197`), `filterTriggersForSandbox` (no consumers), `applySandboxOverrides` (no consumers — sandbox policy is only surfaced via `TrustBadge`/`SandboxWarningBanner`, never enforced). Also `BUILTIN_RUN_IDS` set (L83) only contains `seed-category-v1`, while `useTemplateCardData.ts:20` derives the same signal via `!review.test_run_id.startsWith('seed-')` — divergent built-in detection logic.
- **Root cause**: Sandbox-enforcement API was designed (the comment at L189 says "Sandbox enforcement helpers") but never wired into the adoption pipeline — only the badge/banner display side landed.
- **Impact**: ~60 LOC dead. Worse, the absence creates a security-soft-spot: the enforcement scaffolding looks present but does nothing — readers may falsely assume sandbox policies are applied at adoption time.
- **Fix sketch**: Either (a) delete `computeContentHash`, `registerBuiltinTemplate`, `filterTriggersForSandbox`, `applySandboxOverrides` and trim `SANDBOX_POLICY` shape accordingly, or (b) wire `filterTriggersForSandbox` into the adopt confirmation path in `n8n_transform/confirmation.rs::create_persona_atomically` (preferred — closes the gap). Also reconcile `BUILTIN_RUN_IDS` with the seed-prefix heuristic.

## 5. Dead exports in personaSafetyScanner.ts and n8nTransform API

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/lib/templates/personaSafetyScanner.ts:470`, `src/api/templates/n8nTransform.ts:304`
- **Scenario**: `scanToolDrafts` is exported but never imported anywhere — only `scanPersonaDraft` is used (by `ScanResultsBanner.tsx`). The tool-specific `TOOL_THREAT_PATTERNS` array (L440-464) is also dead since it has no other entry point. Separately, `listN8nSessions` (n8nTransform.ts L304) is unused — every call site uses `listN8nSessionSummaries` instead. The corresponding Rust command `list_n8n_sessions` is still registered in `lib.rs:1433`.
- **Root cause**: Tool-level scanning was split out as a separate API but never plumbed into the persona-creation flow (only the unified `scanPersonaDraft` is called). The full `list_n8n_sessions` payload was supplanted by the summary endpoint but its binding wasn't removed.
- **Impact**: ~50 LOC dead in the scanner; the unused frontend binding plus its Rust handler (~10 LOC) ships in the binary. Risk of accidental re-use returning to ts that's no longer kept in sync with the schema.
- **Fix sketch**: Either remove `scanToolDrafts` and `TOOL_THREAT_PATTERNS`, OR call `scanToolDrafts(draft.tools)` from `ScanResultsBanner` and merge its findings (the comment at L468 says it "supplements the main scanner" — currently not happening). Remove `listN8nSessions` export and the Rust `list_n8n_sessions` command; keep `list_n8n_session_summaries` as the canonical list.

## 6. Stale ts-rs binding: TemplateAdoptConfirmResult.ts

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/lib/bindings/TemplateAdoptConfirmResult.ts`
- **Scenario**: Generated ts-rs binding mirrors the response of a Rust command, but searching `src-tauri/` for either `TemplateAdoptConfirmResult` or `template_adopt_confirm_result` returns zero hits — the originating Rust struct was deleted (probably as part of Stage A1) but its binding file was orphaned. Meanwhile the live confirmation path uses a hand-rolled `ConfirmDraftResponse` interface in `n8nTransform.ts:257-264` whose shape is byte-identical to this dead binding.
- **Root cause**: Stage A1 deletion was incomplete — ts-rs codegen output wasn't re-run / pruned.
- **Impact**: Cargo + ts-rs auto-regen could re-emit/keep this file unless purged; future readers may import the wrong type. The duplication of the same shape (one ts-rs file, one hand-rolled interface) is a future-bug attractor.
- **Fix sketch**: Delete `src/lib/bindings/TemplateAdoptConfirmResult.ts`. Replace the hand-rolled `ConfirmDraftResponse` in `n8nTransform.ts:257` with the existing live binding from `confirmation.rs::ImportResult` — add `#[derive(TS)] #[ts(export)]` on that struct so the binding regenerates with the correct provenance, then import it.

## 7. Near-duplicate `verifyTemplate` and `verifyTemplateLight`

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/templates/sub_generated/gallery/cards/useTemplateCardData.ts:16-26` vs `src/lib/templates/templateVerification.ts:162-187`
- **Scenario**: `verifyTemplateLight` (gallery file, 10 LOC) reimplements `verifyTemplate` minus the `computeContentHashSync` call. Both compute origin → integrityValid → trustLevel → sandboxPolicy in the same order with the same expressions. They diverge subtly: the light variant always hardcodes `contentHash: null` and assumes integrity from origin alone, while the full variant computes the hash from `designResultJson`. The light path is selected based on `isActive` (hover/expand).
- **Root cause**: A perf optimisation was inlined as a separate function in the consumer instead of being added as a `{skipHash?: boolean}` option on the shared API.
- **Impact**: Two functions to maintain for the same logic; trust-level rules can drift between deferred and active states. Tightly coupled to the existing `getCachedVerification` wrapper at `reviewParseCache.ts:43`.
- **Fix sketch**: Add `verifyTemplate({..., skipHash?: boolean})` to `templateVerification.ts`. When `skipHash` is true, set `contentHash = null` and derive `integrityValid` from origin only. Delete `verifyTemplateLight`, update the hook to call `verifyTemplate({...params, skipHash: !isActive})`.

## 8. Shared prompt-builder boilerplate across n8n prompt variants

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/commands/design/n8n_transform/prompts.rs:296-402` and `:406-510`
- **Scenario**: `build_n8n_transform_prompt` and `build_n8n_unified_prompt` share their entire preamble (sanitize workflow_name, parser_result, workflow_json → fetch platform → format connector/credential sections → build credential_adaptation/protocol_docs/pattern_mapping/output_schema → canary_instruction → wrap_xml_boundary). Only the body template (PHASE 1 vs straight-shot) and a few wrapped fields differ. ~60 LOC of identical setup code is duplicated verbatim between the two builders.
- **Root cause**: The unified-prompt variant was forked from the original transform-prompt path when the single-CLI-session flow was introduced, without extracting a shared `PromptContext`.
- **Impact**: Sanitisation rules + canary text live in two places; future security tightening or platform-rule changes risk being applied to only one variant.
- **Fix sketch**: Introduce a `struct N8nPromptContext { workflow_name, workflow_json, parser_result_json, platform_label, credential_rules, connectors_section, credentials_section, credential_adaptation, protocol_docs, pattern_mapping, output_schema, canary, wrapped_workflow_name, wrapped_parser_result, ... }` constructed by a `prepare_n8n_prompt_context(...)` helper. Both builders accept the context and only format the body-specific section.

## 9. Inconsistent ConfirmResult import path (re-export vs source-of-truth)

- **Severity**: low
- **Category**: structure
- **File**: `src/features/templates/sub_n8n/hooks/n8nWizardTypes.ts:2`, `useN8nWizard.ts:11`, `steps/confirm/SuccessBanner.tsx:2`
- **Scenario**: `ConfirmResult` is defined in `steps/confirm/n8nConfirmTypes.ts:7` and re-exported at `steps/confirm/N8nConfirmStep.tsx:19`. Three files (`n8nWizardTypes.ts`, `useN8nWizard.ts`, `N8nConfirmStep.tsx` itself) import via the re-export; only `SuccessBanner.tsx` imports from the source-of-truth module. Mixed import paths create false coupling: hook files now transitively depend on the heavy step component just to get a 10-line type.
- **Root cause**: Type was extracted out of `N8nConfirmStep.tsx` into `n8nConfirmTypes.ts` (good) but the re-export was left in place for back-compat and consumers weren't migrated.
- **Impact**: `useN8nWizard.ts` and `n8nWizardTypes.ts` pull in (via the re-export chain) the entire `N8nConfirmStep` component module just to read one type — small but real bundling/circular-import smell.
- **Fix sketch**: Migrate the three re-export consumers to import directly from `./confirm/n8nConfirmTypes`. Then delete the `export type { ConfirmResult }` re-export line at `N8nConfirmStep.tsx:19`.

## 10. Hard-coded English DIMENSION_LABELS in Stepper widget

- **Severity**: low
- **Category**: cruft
- **File**: `src/features/templates/sub_n8n/widgets/N8nQuestionStepper.tsx:8-14`
- **Scenario**: Stepper widget hard-codes English category labels (`'Credentials'`, `'Configuration'`, `'Human in the Loop'`, `'Memory & Learning'`, `'Notifications'`) and a placeholder string `'Type your answer…'` at L146, while its sibling `N8nQuestionListView.tsx:38-44` does the correct `t.templates.questionnaire.category_labels.*` lookup for the exact same label set. The translation keys already exist.
- **Root cause**: Stepper was written before i18n was added; the listview was migrated but the stepper missed.
- **Impact**: Localised users see a mixed UI (translated chrome + English category headers + English placeholder) inside the import wizard.
- **Fix sketch**: Replace the literal map with `t.templates.questionnaire.category_labels`-driven lookup (mirrors `N8nQuestionListView.tsx:37-44`). Replace L146 placeholder with `t.templates.questionnaire.type_your_answer`. If the dedupe fix in Finding #2 lands, this is solved as a side effect.

## 11. Hash-collision-prone synchronous content hash

- **Severity**: low
- **Category**: cruft
- **File**: `src/lib/templates/templateVerification.ts:38-51`
- **Scenario**: `computeContentHashSync` is a hand-rolled 64-bit non-cryptographic hash used for template "content integrity" verification (called at `templateCatalog.ts:157` to compare against the manifest checksum, and within `verifyTemplate` for hash provenance). The async `computeContentHash` uses SHA-256 via `crypto.subtle.digest` but is unreachable (Finding #4) — meaning every verified template has only a 64-bit non-cryptographic checksum behind it, despite the file's docstring at L8 claiming "content-hash based integrity verification".
- **Root cause**: Sync variant was added for use cases where `await` was awkward, then became the default; the async (proper SHA-256) variant lost its consumer.
- **Impact**: The integrity story doesn't match the doc claim. Frontend trust gating relies on a checksum that could collide with negligible effort if an attacker controls template JSON content. (The Rust-side `verify_template_integrity_batch` does use a real hash at the trust boundary, so this is a defence-in-depth weakness, not an outright break.)
- **Fix sketch**: Replace `computeContentHashSync` call sites with the async `computeContentHash` (templateCatalog initialization is already async). Delete the hand-rolled sync hash, or relabel it as a "fingerprint" rather than an integrity hash so the contract is honest.

## 12. Templates source location drift — no `src-tauri/data/templates/`

- **Severity**: low
- **Category**: structure
- **File**: `scripts/templates/` vs the documented expectation of `src-tauri/data/templates/`
- **Scenario**: The harness scenario file listed `src-tauri/data/templates` as the catalog source. The actual templates JSON catalog lives in `scripts/templates/<category>/*.json`, loaded by both `src-tauri/src/engine/build_session/templates.rs:25` (Rust, runtime) and `scripts/generate-template-checksums.mjs` (build-time). `src-tauri/data/` only contains `radio_stations.json`. The `_recipe_seeds.json` aggregate sits in `scripts/templates/_recipe_seeds.json` next to the per-template files.
- **Root cause**: Templates live alongside the build scripts that generate them (checksums + seed bundle) rather than under `src-tauri/data`. The arrangement works but is not a typical "data" layout for a Tauri app — it implies templates are dev-time artifacts when they're really runtime assets read at adoption time.
- **Impact**: Confusing for new contributors; mixing `scripts/` (build artifacts) with `data/` (runtime resources) makes shipping logic and Rust read paths brittle. The Rust loader `load_template_index` (`templates.rs:23-44`) hardcodes `Path::new("scripts/templates")` relative to CWD, which only works during dev; in a packaged Tauri binary the path is unlikely to resolve.
- **Fix sketch**: Either (a) move `scripts/templates/` → `src-tauri/data/templates/` and update the load path to use `tauri::path::app_resource_dir()`, the checksum manifest generator, and the recipe-seed generator. Or (b) keep the location and rename to `templates/` at repo root with both Rust and JS reading from a single canonical path. Either way, the Rust loader should use a resource-dir resolver, not `Path::new("scripts/...")`.
