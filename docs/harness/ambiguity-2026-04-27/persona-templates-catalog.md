# Ambiguity Audit — Persona Templates Catalog

> Total: 12 findings (2 critical, 5 high, 4 medium, 1 low)
> Files read: ~14
> Scope: Template JSON catalog (scripts/templates), schema-aware loader (src/lib/personas/templates), template API surface (src/api/templates), and the auto-generated `templateIndex.ts`.

## 1. Auto-generated `templateIndex.ts` mixes canonical templates with translation overlays and is not imported anywhere

- **Severity**: critical
- **Category**: undocumented-decision
- **File**: src/lib/personas/templateIndex.ts:6-249
- **Scenario**: The file's header says "Auto-generated template index — DO NOT EDIT MANUALLY" and exports `allTemplates: any[]` containing 121 entries. It explicitly imports overlay sibling files (`autonomous-issue-resolver.ar.json`, `.bn.json`, `.cs.json`, …, lines 19-32) alongside the canonical English template (line 28), giving the impression that translation overlays are first-class catalog entries. Yet `templateCatalog.ts` is the actual loader and uses a Vite glob that filters out overlays via `isOverlayFilename`. A repo-wide search for `from '...templateIndex'` returns zero matches.
- **Root cause**: The generator script (`scripts/generate-template-index.mjs`) and `scripts/generate-template-checksums.mjs` have diverged from `templateCatalog.ts`'s overlay-aware design. The `useDevCloneAdoption.ts` comment ("templateIndex already imports it") cements the false belief that this file is load-bearing.
- **Impact**: A future dev who edits or deletes this file thinking it's authoritative will silently corrupt the catalog (or do nothing, but waste hours debugging). Conversely, a dev who relies on `allTemplates` will get duplicate entries (every translated file plus the canonical) and a typed-as-`any[]` payload.
- **Fix sketch**:
  - Either delete `templateIndex.ts` and the comment in `useDevCloneAdoption.ts`, or reconcile its generator with `isOverlayFilename` so overlays are excluded.
  - If kept, re-export it through a stable name and at least one consumer, or document at the top: "Generated for Rust binding tooling only — not consumed at runtime."

## 2. `skill-librarian.json` is in checksums + filesystem but missing from `templateIndex.ts`

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/lib/personas/templateIndex.ts:33-44 (vs. src/lib/personas/templates/templateChecksums.ts:32)
- **Scenario**: `scripts/templates/development/skill-librarian.json` exists on disk (verified: `is_published: true`, `schema_version: 3`) and `templateChecksums.ts` line 32 includes its hash `001fbf3a5f292e84`. But `templateIndex.ts` does not list it among `tpl_development_*` imports — it jumps from `self_evolving_codebase_memory` straight to `user_lifecycle_manager`.
- **Root cause**: The two generators (`generate-template-index.mjs` and `generate-template-checksums.mjs`) ran at different times, against different working trees, with no cross-validation. There is no integrity check that "checksum keys == index entries == disk files."
- **Impact**: If anyone ever re-points consumers to `templateIndex.ts` (the dev-tools clone code is one click away), Skill Librarian silently disappears from the catalog. Either generator scripts can run in isolation today and create a permanent quiet drift.
- **Fix sketch**:
  - Add a CI check (or vitest) that asserts `Object.keys(TEMPLATE_CHECKSUMS) === sorted(canonical files in scripts/templates)`.
  - Have a single generator drive both files, or at minimum include a build-time invariant test.

## 3. Sync content hash uses a non-cryptographic 64-bit hash for "tamper" detection

- **Severity**: high
- **Category**: trade-off-hidden
- **File**: src/lib/templates/templateVerification.ts:38-51
- **Scenario**: `computeContentHashSync` is a hand-rolled MurmurHash-style 64-bit hash, used at startup to verify every template against `TEMPLATE_CHECKSUMS`. The catalog comment in `templateCatalog.ts:11` calls this "defense layer 1" against tamper/corruption. The async authoritative check (`computeContentHash`, SHA-256) only runs later via `verifyTemplatesWithBackend`, which can fail or be skipped (`return null` on error, line 350).
- **Root cause**: The function name "Sync content hash using a simple deterministic hash" doesn't convey that 64-bit non-cryptographic hashes are trivially collision-engineerable. Comment frames the choice as "Web Crypto unavailable" — but Web Crypto is synchronous-blocking-impossible-only, not unavailable, in Tauri renderer.
- **Impact**: An attacker who modifies a template and updates one corresponding checksum can engineer collisions in seconds. The "two-layer integrity verification" headline at `templateCatalog.ts:9-12` overstates layer 1's contribution. A reader could reasonably believe both layers contribute to security.
- **Fix sketch**:
  - Rename the function to `computeContentFingerprintSync` and explicitly document: "Not cryptographic; corruption-only check."
  - Update the catalog header comment: "Layer 1 detects accidental corruption; only Layer 2 (SHA-256 in Rust) detects tampering."
  - Or move the boot-time check to be async and use SHA-256 there too — there is no compelling reason it must be sync.

## 4. `web-marketing.json` connector slot names disagree with everything that references them

- **Severity**: high
- **Category**: requirements-unclear
- **File**: scripts/templates/marketing/web-marketing.json:86, 127, 253, 259, 826-828, 845-847
- **Scenario**: The persona declares connectors named `"advertising"` (line 86) and `"analytics"` (line 127). But the use_case_flow nodes reference `connector: "ad_platform"` (line 253) and `connector: "analytics_tool"` (line 259), and the adoption_questions reference `connector_names: ["ad_platform"]` (line 827) and `["analytics_tool"]` (line 846). Meanwhile each use_case's `connectors:` array (line 195-196 etc.) uses `"advertising"`/`"analytics"`.
- **Root cause**: The template author silently switched naming conventions partway through (slot vs. flow vs. adoption question) with no schema validation to catch the drift. The `mergeTemplateOverlay` matchKey logic at `templateOverlays.ts:79` matches by `name` — translators who mirror these inconsistencies will preserve the bug across locales.
- **Impact**: Adoption-time auto-fill that depends on resolving `connector_names → persona.connectors[name]` will silently fail for this template. The flow-diagram preview cannot show real connector icons. Any template-validation pass added later will flag this as broken — but right now it's "working" because nothing actually validates the cross-references.
- **Fix sketch**:
  - Add a vitest that, for every catalog template, verifies every `connector_names[]` and flow `connector:` entry resolves to a `persona.connectors[].name`.
  - Pick one name per connector and rename the offending references.

## 5. `aq_proposal_count` answer silently doubles as `discovery_count` for a different use-case

- **Severity**: high
- **Category**: implicit-assumption
- **File**: scripts/templates/marketing/web-marketing.json:710 (vs. 882-902, 696-706)
- **Scenario**: `aq_proposal_count` is declared `scope: "capability"` and `use_case_ids: ["uc_optimization_proposals"]` (lines 882-885). But `uc_free_research`'s `sample_input.discovery_count` (line 710) reads `"{{param.aq_proposal_count}}"` — pulling a value from a question scoped to a different capability. The two `enum` lists also differ: `uc_optimization_proposals.input_schema.proposal_count.enum` is `["Leave up to LLM", "3", "5", "6", "8", "10"]` (line 391-396) but `uc_free_research.input_schema.discovery_count.enum` is `["Leave up to LLM", "3", "5", "8", "12"]` (line 700-704).
- **Root cause**: The `{{param.X}}` interpolation contract is purely string-substitution at runtime — there is no constraint that the question's `use_case_ids` includes the use-case that consumes it. Authors who copy-paste from another UC accidentally bind to an unrelated question.
- **Impact**: If a user picks `discovery_count: "12"` it will not appear in the dropdown (the UC's enum doesn't include 12) yet still flow through. If `uc_optimization_proposals` is disabled but `uc_free_research` is enabled, the question may not be asked at all and the param is unresolved. The user's choice for one capability covertly shapes another.
- **Fix sketch**:
  - Add a validator: "every `{{param.X}}` reference in `use_cases[uc_K].sample_input` must come from a question whose `use_case_ids` contains `uc_K` (or has `scope: persona`)."
  - In this template specifically: introduce `aq_discovery_count` for free-research and stop reusing `aq_proposal_count`.

## 6. `TemplateCatalogEntry` interface omits fields the loader actually inspects

- **Severity**: medium
- **Category**: missing-docs
- **File**: src/lib/types/templateTypes.ts:99-101 (vs. src/lib/personas/templates/templateCatalog.ts:139)
- **Scenario**: `TemplateCatalogEntry` declares only `id, name, description, icon, color, category[], payload`. The catalog loader reads `template.is_published` (line 139) and the JSON files all have `schema_version`, `service_flow`, `is_published` at the top level. The loader gets at `is_published` via an `as Record<string, unknown>` cast.
- **Root cause**: The interface predates v3 fields; the cast hides the drift instead of forcing a type update.
- **Impact**: A future dev adding new top-level fields will not know what already exists. Any consumer iterating `catalog.map(t => t.schema_version)` triggers a type error and they'll cast around it, perpetuating the gap. Schema-aware operations (like overlay merge) cannot rely on the type system to enforce the v3 shape.
- **Fix sketch**:
  - Extend `TemplateCatalogEntry` with `schema_version: number; is_published: boolean; service_flow?: string[]`.
  - Remove the cast at templateCatalog.ts:139.

## 7. `dimension` field is typed `string` but only 10 values are valid (and ordering is load-bearing)

- **Severity**: medium
- **Category**: magic-number
- **File**: src/api/templates/n8nTransform.ts:99-107
- **Scenario**: The `dimension?` field on `TransformQuestionResponse` is typed `string`. The doc-comment lists exactly 10 valid values and explains they drive ordering: `triggers → use-cases → connectors → messages → review → memory → events → error-handling → boundaries → voice`. A typo (e.g. `use_cases` vs `use-cases`) silently sorts the question to the end ("Questions without a dimension fall to the end of the list").
- **Root cause**: Author chose `string` for forward-compatibility but documented the contract only in a comment. There is no exported union type or runtime validator.
- **Impact**: Translators and template authors who type `"use_cases"` instead of `"use-cases"` get a silently-misordered questionnaire. Hyphen-vs-underscore drift is one of the most common copy-paste bugs.
- **Fix sketch**:
  - Replace `dimension?: string` with `dimension?: 'triggers' | 'use-cases' | 'connectors' | 'messages' | 'review' | 'memory' | 'events' | 'error-handling' | 'boundaries' | 'voice'`.
  - Surface a console warn at runtime when a template carries an unknown `dimension`.

## 8. Two ways to set `requires_resource` with "slot wins" rule documented only in API comment

- **Severity**: medium
- **Category**: undocumented-decision
- **File**: src/api/templates/n8nTransform.ts:60-74, 150-158
- **Scenario**: `requires_resource` can live at the slot level (`PersonaConnectorSlot.requires_resource`, line 71) OR per-question (`dynamic_source.requires_resource`, line 158). Doc-comment says "When both are set, the slot wins — slot-level is more discoverable." This precedence is only described in the TS API surface; the JSON schema authors of templates won't see it unless they read this file.
- **Root cause**: Two parallel mechanisms evolved without unifying. The "slot wins" rule is undocumented in the JSON files themselves and in TEMPLATES.md.
- **Impact**: Template authors who set both (because copy-paste examples may show either) will get behavior that contradicts the more "obvious" question-local setting. Migration scripts that drop one mechanism will silently change behavior for templates that relied on the other.
- **Fix sketch**:
  - Pick one; add a JSON-schema validator that errors if both are set on the same connector/question pair.
  - If keeping both, document the precedence rule in `scripts/templates/README.md` (or TEMPLATES.md) where authors actually look.

## 9. `mergeArray` falls back to index-merge for object arrays without match keys — silently misaligns reordered overlays

- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/personas/templates/templateOverlays.ts:152-166
- **Scenario**: When canonical and overlay arrays of objects have no `id|name|key|event_type` field, the merge zips by index. Comment says "Used for `notification_channels[]` ({ type, description }) where order matters and is stable." But "stable" is an unenforced assumption — a translator who reorders the overlay's notification_channels (or who has the canonical reordered after the overlay was written) gets descriptions paired with the wrong `type`.
- **Root cause**: The fallback exists because notification_channels has no natural identifier, and adding one would be a breaking schema change. The "stable order" contract is not validated and not surfaced in the overlay author workflow.
- **Impact**: If an overlay file is reviewed in isolation and reordered for readability, the merge silently swaps descriptions across channels. There is no parity-test signal because no id mismatch is recorded.
- **Fix sketch**:
  - Require that overlay arrays without match keys must have the same length as canonical, and fail loudly otherwise (currently truncates to `min(overlay.length, result.length)`, line 155).
  - Better: introduce an implicit `_index` match key, or require translators not to include `notification_channels` overlays at all (their `description` strings are user-facing and should be flagged).

## 10. `BUILTIN_RUN_IDS` is a Set of one — no documentation of when more would be added

- **Severity**: low
- **Category**: magic-number
- **File**: src/lib/templates/templateVerification.ts:83
- **Scenario**: `const BUILTIN_RUN_IDS = new Set(['seed-category-v1']);`. Same string is exported as `SEED_RUN_ID` from `seedTemplates.ts:10`. The use of a `Set` implies multiple values could exist, but only one ever has.
- **Root cause**: Future-proofing for a versioned seeding scheme that never materialized. The implicit invariant ("every historical seed run id should remain accepted") is not written down anywhere.
- **Impact**: Negligible today. A future dev who renames `SEED_RUN_ID` will need to remember to add the old value to `BUILTIN_RUN_IDS` to keep grandfathered records valid; nothing flags this.
- **Fix sketch**:
  - Either inline the constant against `SEED_RUN_ID`, or comment why it's a Set (e.g. "future v2/v3 seeds will be appended; never remove").

## 11. Catalog cache invalidation deletes language overlays but not Rust backend's parsed copy

- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/personas/templates/templateCatalog.ts:222-226 (vs. 321-353)
- **Scenario**: `invalidateTemplateCatalog()` clears `_cached`, `_loading`, and `_localizedCache`. But the backend integrity check (`verifyTemplatesWithBackend`) uses the embedded checksum manifest in the Rust binary, which does not change with HMR. Comment at line 219-221 says the function exists to "pick up template JSON edits made while the dev server is running" — implying HMR safety. After an edit, layer-1 (sync hash) will still pass on the *previous* Vite-cached module unless Vite invalidates the JSON itself, and layer-2 will report `checksum_mismatch` against the now-stale Rust-side hash for the dev's edited file.
- **Root cause**: The cache invalidation contract is "frontend-only," but consumers of `verifyTemplatesWithBackend` aren't told that running it after HMR will mark every edited template as tampered.
- **Impact**: Devs who edit a template JSON in dev and then call `verifyTemplatesWithBackend` (or look at logs) see a `SECURITY:` error message at `templateCatalog.ts:341` claiming tamper — when it's just a stale Rust-side hash. Wastes time and erodes the security log's signal.
- **Fix sketch**:
  - In dev (`import.meta.env.DEV`), downgrade the SECURITY log to info or skip backend verification entirely.
  - Document at the function header: "Backend verification compares against a build-time hash; in dev, edits to template JSONs will appear as integrity failures."

## 12. Catalog throws `CatalogIntegrityError` on duplicate ids — but consumers catch `Promise<TemplateCatalogEntry[]>` like a normal error

- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/personas/templates/templateCatalog.ts:175-178 (vs. useLocalizedTemplateCatalog.ts:25-33)
- **Scenario**: `loadAndVerify` throws a `CatalogIntegrityError` if any two templates share an `id`. The simpler hook `useLocalizedTemplateCatalog` does `getLocalizedTemplateCatalog(language).then(...)` with no `.catch` (line 27-29). A throw here leaves `catalog` permanently `[]` with no error surface.
- **Root cause**: The discriminated `CatalogLoadResult` type was added to `getTemplateCatalogStatus` but the simpler accessor `getTemplateCatalog` was left as a "throws for hard errors" path. The two consumer hooks behave differently for the same underlying failure.
- **Impact**: A duplicate-id bug introduced by a copy-paste of a template file shows up in `useLocalizedTemplateCatalogStatus` consumers as `status: 'failed'` with a clear message — but in `useLocalizedTemplateCatalog` consumers as a silently empty gallery. Galleries that read the simple hook will look "empty but healthy."
- **Fix sketch**:
  - Document at the top of `getTemplateCatalog`: "Throws CatalogIntegrityError on duplicate ids — callers must wrap or use getTemplateCatalogStatus."
  - Or migrate all UI consumers to the status-aware variant and deprecate the bare accessor.
