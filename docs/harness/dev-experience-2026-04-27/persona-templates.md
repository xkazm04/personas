# Persona Templates Catalog — Dev Experience Scan

> Total: 11 · Critical: 2 · High: 4 · Medium: 3 · Low: 2
> Scope: client-side only
> Date: 2026-04-27

---

## 1. `TemplateCatalogEntry.payload` typed as `AgentIR` but JSON files are a different shape

- **Severity**: Critical
- **Category**: convention-drift
- **File**: `src/lib/types/templateTypes.ts:93-101` (and consumers in `src/lib/personas/templates/seedTemplates.ts:28-90`, `src/features/templates/sub_generated/gallery/cards/useTemplateCardData.ts:42-80`)
- **Scenario**: A developer adds a new `payload.persona.principles[]` field to a template JSON. They open `TemplateCatalogEntry` to type the new field — `payload` is `AgentIR`, which has `structured_prompt`, `suggested_tools`, `summary`, `full_prompt_markdown`. None of those are in the JSON. To consume the field they have to cast `template.payload as unknown as Record<string, unknown>`.
- **Root cause**: `payload: AgentIR` is wrong. Real JSON payloads carry `service_flow`, `persona{ goal, identity, voice, principles, constraints, decision_principles, tool_guidance, error_handling, connectors[] }`, `use_cases[]`, `adoption_questions[]`, `persona_meta` — none of which exist on `AgentIR`. `AgentIR` is the design-engine output type, not the v3 template payload type. Result: every consumer that touches v3 fields (`seedTemplates.ts`, `useTemplateCardData.ts`, `useUseCaseChronology.ts`) does `as unknown as Record<string, unknown>` and re-derives shapes by hand with no compiler help.
- **Impact**: Every template field rename silently breaks consumers — there's no compile error linking JSON shape to TS code. Several files already grep for `payload.persona.goal` via `Record<string, unknown>` casts; a typo in `goal` → `gaol` compiles fine and renders empty UI. Touches ~5 files; affects every dev who edits template schema.
- **Fix sketch**: Define a real `TemplatePayloadV3` interface (or a Zod schema) that mirrors the JSON: `{ service_flow, persona: { goal, identity, voice, principles, constraints, decision_principles, tool_guidance, error_handling, examples, tools, connectors[], notification_channels_default[], core_memories, verbosity_default, trigger_composition, message_composition, operating_instructions }, use_cases: UseCase[], adoption_questions: AdoptionQuestion[], persona_meta }`. Replace `payload: AgentIR` with the new type. Have the seed-templates loader and complexity helpers consume typed fields instead of `as Record<string, unknown>`.

---

## 2. No runtime schema validation for template JSON — bad templates silently render broken cards

- **Severity**: Critical
- **Category**: tooling
- **File**: `src/lib/personas/templates/templateCatalog.ts:120-185`, `src/lib/utils/parseJson.ts:1-13`
- **Scenario**: A template author writes `"schema_version": "3"` (string instead of number) or omits a required `id` on a `use_cases[]` entry. The catalog loader checksums the file, accepts it, and the gallery shows a card with broken adoption flow that fails 4 clicks deep when something tries to look up the missing id.
- **Root cause**: `loadAndVerify()` only checks (a) checksum match, (b) `is_published` flag, (c) duplicate id. There is no Zod / Valibot / hand-rolled schema validation of the v3 template structure. `getCachedDesignResult` and `useTemplateCardData` use `parseJsonSafe(json, fallback)` which silently swallows parse errors and returns `null` — masking malformed payloads as "empty template." Templates have ~15 nested array shapes (`use_case_flow.nodes[]`, `connectors[].credential_fields[]`, `event_subscriptions[]`, `input_schema[]`, etc.) — a single missing field anywhere causes downstream UI to render nothing instead of erroring loudly.
- **Impact**: Template authors get zero feedback at edit time. Bugs surface in production cards. Adoption wizard is the testbench, not the schema. Every dev adding a field has to manually verify all consumers handle the missing case.
- **Fix sketch**: Add a Zod schema (`templateSchemaV3.ts`) that mirrors the canonical JSON shape. Run `schema.safeParse(template)` inside `loadAndVerify()` after the checksum check; route failures into `CatalogSkippedEntry` with a new `'schema_invalid'` reason and surface them in `CatalogLoadResult.skipped` so dev mode can show a panel listing them. Wire the schema into `scripts/check-template-ids.mjs` for pre-commit / CI to fail at PR time, not load time.

---

## 3. Template loader has zero dedicated tests — only one test file in the entire feature

- **Severity**: High
- **Category**: testing
- **File**: `src/lib/personas/templates/__tests__/templateOverlays.test.ts` (sole existing test); missing for `templateCatalog.ts`, `seedTemplates.ts`, `useLocalizedTemplateCatalog.ts`, every file under `src/api/templates/`, every file under `src/features/templates/sub_generated/gallery/`
- **Scenario**: A refactor changes `loadAndVerify` to skip the duplicate-id check or accept missing checksums. Every other domain (`credentials`, `events`, `executions`, `personas`, `triggers`) has tests under `src/api/__tests__/`. Templates has none. CI passes; production breaks because the catalog now loads `is_published: false` files or accepts arbitrary tampering.
- **Root cause**: Test coverage stopped at `templateOverlays.test.ts` (the i18n merge). Catalog integrity (checksum mismatch, missing checksum, duplicate id, `CatalogIntegrityError`, the `ok | partial | failed | empty` discriminator), seed conversion (v2 vs v3 fallback paths, all the `as Record<string, unknown>` walks), API wrappers, search/filter, complexity heuristics, readiness scoring — all untested.
- **Impact**: ~60 files of behavior with no regression net. Refactors are scary; bugs land silently. `templateCatalog.ts` is a 354-line security-critical file (it gates which JSON is shown in the gallery) with one test file in its parent directory and that test file only covers overlays.
- **Fix sketch**: Add `templateCatalog.test.ts` with: checksum mismatch → skipped, missing checksum → skipped, `is_published: false` → skipped not-error, duplicate id → throws `CatalogIntegrityError`, `getTemplateCatalogStatus` discriminator transitions. Add `seedTemplates.test.ts` covering both v3-nested and v2-flat paths. Add `templateComplexity.test.ts` pinning the difficulty/setup heuristic outputs against known fixtures so weight tweaks don't silently drift.

---

## 4. `TEMPLATES.md` references types that no longer exist — dev onboarding doc is out-of-date

- **Severity**: High
- **Category**: documentation
- **File**: `TEMPLATES.md:9-19`
- **Scenario**: A new dev reads `TEMPLATES.md` to learn how to add a built-in template. It says "Each wraps a `DesignAnalysisResult`" and "**Type**: `BuiltinTemplate` (`src/lib/types/templateTypes.ts`)". They open `templateTypes.ts` and find no `BuiltinTemplate` export — only `TemplateCatalogEntry`. They search for `DesignAnalysisResult` and find a `@deprecated` alias for `AgentIR`. The doc never mentions schema_version, `is_published`, `service_flow`, `payload.persona`, `use_cases[]` — the entire v3 schema is invisible.
- **Root cause**: Doc was written for v1/v2 templates and never updated through the v3 migration. Templates are now nested (`payload.persona.*` + `payload.use_cases[]`) but the doc still describes the flat `DesignAnalysisResult` shape.
- **Impact**: Misleads every new contributor. Forces them to read the JSON files directly to learn the schema. Slows onboarding measurably (>30min just to map docs to reality).
- **Fix sketch**: Rewrite the "Template Types" + "Generation Process" sections against the actual v3 shape. Link to the canonical JSON sample (`scripts/templates/marketing/web-marketing.json`) as the source of truth. Document `schema_version: 3`, `payload.persona`, `payload.use_cases[]`, `adoption_questions[]`, the checksum manifest workflow, and the i18n overlay convention (`<name>.<lang>.json`). Drop / replace the `BuiltinTemplate` reference.

---

## 5. Checksum hash function duplicated verbatim between TS and JS with no shared source

- **Severity**: High
- **Category**: code-organization
- **File**: `src/lib/templates/templateVerification.ts:38-51` and `scripts/generate-template-checksums.mjs:24-37`
- **Scenario**: Someone optimizes the hash mixer in `templateVerification.ts` (e.g. swaps the constants). They forget to update `generate-template-checksums.mjs`. Next CI run, every template fails checksum because the script and the runtime compute different hashes. The "tamper detection" SECURITY error fires for every built-in template.
- **Root cause**: `computeContentHashSync` is reimplemented byte-for-byte in two places (one TypeScript, one ESM Node script). There is no shared module — the script is `.mjs` so it can't `import` the `.ts` source directly. The function is a non-cryptographic 64-bit fold (despite documentation claiming "SHA-256 content hash for integrity verification" in `templateTypes.ts:55`); the comment-implementation drift is itself a footgun.
- **Impact**: Silent drift waits to bite. Combined with the misleading "SHA-256" comment, a future dev thinking they're touching a crypto hash may make subtler mistakes. Touches build+runtime trust boundary.
- **Fix sketch**: Extract the function into a `.mts` or plain `.js` module both sides import (e.g. `scripts/lib/templateHash.mjs` re-exported from a barrel that the TS lib references). Or rename to `computeContentFingerprintSync` and remove the SHA-256 wording in the `TemplateVerification.contentHash` JSDoc — be honest that this is a non-crypto fingerprint backed by Rust-side cryptographic verification (`verifyTemplatesWithBackend`).

---

## 6. `parseJsonSafe` / `parseJsonOrDefault` swallows every parse error in template path

- **Severity**: High
- **Category**: dev-loop-friction
- **File**: `src/lib/utils/parseJson.ts:2-13`, used in `reviewParseCache.ts:25-39`, `useTemplateCardData.ts:36-46`, `seedTemplates.ts`, `templateComplexity.ts:54-57`
- **Scenario**: A dev writes `JSON.stringify` somewhere that produces malformed output, or a backend round-trip strips a field. The card renders empty. They open devtools — no error, no warn, no breadcrumb. They can't tell whether the field is absent, the parse failed, or the schema changed. They fall back to `console.log`-driven debugging the parse boundary by hand.
- **Root cause**: `parseJsonOrDefault` has a bare `catch {}` with comment "intentional: non-critical" and falls back to default. Used in the hot path that parses every `review.connectors_used`, `review.use_case_flows`, `review.trigger_types`, `review.design_result` field for every visible card. Parse errors are invisible. No counter, no logger, no Sentry breadcrumb.
- **Impact**: Worst possible debugging UX in the most-used path. Multiple devs/week run into "card looks empty, why?" and have to step-debug. The `safeJsonParse` tuple variant exists in the same file but isn't used by template code.
- **Fix sketch**: Add an optional `onError?: (err: Error) => void` callback to `parseJsonOrDefault`, default to `logger.warn('json-parse fallback', { context, err })` in dev (`import.meta.env.DEV`). Or migrate template-side callers to `safeJsonParse` + an explicit fallback so the parse error is named in code. At minimum log via `createLogger('template-parse')` so it shows up in the dev console.

---

## 7. Hardcoded category metadata + alias map drifts from JSON `category` values

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/templates/sub_generated/gallery/search/filters/searchConstants.ts:39-119`
- **Scenario**: A template author adds a new template under `scripts/templates/wellness/`. They copy an existing file, change the `category: ["wellness"]`. The card renders with a generic `LayoutGrid` icon and grey color because `wellness` is not in `CATEGORY_META` and not in `CATEGORY_ALIASES`. They have to find and edit the constants file in a different feature folder.
- **Root cause**: `CATEGORY_META` is hand-maintained against the directory layout under `scripts/templates/`. There is no validation that every directory under `scripts/templates/` has a corresponding `CATEGORY_META` entry. Aliases (`'project-management'` → `'project_management'`) are also hand-maintained — drift is silent.
- **Impact**: Every new category requires a manual edit in an unrelated file. Drift causes generic-icon cards. Currently `scripts/templates/{content,development,devops,email,finance,hr,legal,marketing,productivity,project-management,research,sales,security,support}` exists; only some map cleanly.
- **Fix sketch**: Add a unit test (or a check in `scripts/check-template-ids.mjs`) that walks `scripts/templates/*/` directory names + every JSON's `category[]` array and asserts each is keyed in `CATEGORY_META` (after alias resolution). Alternative: drive `CATEGORY_META` from a `categories.config.ts` colocated with the template folders, fail-loud on missing entries.

---

## 8. Repeated JSON-parse-+-cache scaffolding across card variants

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/templates/sub_generated/gallery/cards/CompactRow.tsx:28`, `ComfortableRow.tsx:58`, `useTemplateCardData.ts:34-50`, `templateComplexity.ts:53-61`
- **Scenario**: A dev adds a new card density (e.g. `MatrixRow`). They have to re-derive the same fields (connectors, flows, triggers, designResult) from the JSON strings on `PersonaDesignReview` again — each card variant duplicates the parse-and-extract pattern. Same field is parsed in `getCachedLightFields`, `useTemplateCardData`, and `templateComplexity.extractSignals`.
- **Root cause**: There's a `reviewParseCache` WeakMap, but only `getCachedLightFields` / `getCachedDesignResult` flow through it. `useTemplateCardData` reparse `review.trigger_types` directly with `parseJsonSafe` even though the same string was already parsed in `extractSignals`. The split between "lightweight parse" and "full design result" is a useful idea but the cache doesn't cover triggers, flows, or the v3 nested fields. Result: every consumer reaches into JSON strings on the review object directly.
- **Impact**: Three dev-papercut effects: (1) duplicate parse work on every render, (2) every new card variant must re-implement the parse logic, (3) refactors to the parse layer touch many files.
- **Fix sketch**: Extend `CachedReviewFields` with `triggerTypes`, `flows`, `personaGoal`, `useCases` (all the high-traffic fields). Replace the hand-rolled `parseJsonSafe(review.trigger_types)` calls in `useTemplateCardData` and `templateComplexity` with `getCachedTriggerTypes(review)` etc. Then deleting a card variant is just deleting one component, not ripping parse logic out of three files.

---

## 9. Setup-time / difficulty heuristics use magic numbers with no test fixture pin

- **Severity**: Medium
- **Category**: testing
- **File**: `src/features/templates/sub_generated/shared/templateComplexity.ts:87-152`
- **Scenario**: A dev tweaks `score += Math.min(s.connectorCount, 6) * 2` to `* 3` thinking it's a small tuning fix. Suddenly every "intermediate" template flips to "advanced" — no test catches it; the change ships and the gallery looks alarming because every card now shows a red badge.
- **Root cause**: `computeDifficulty`, `computeSetupLevel`, `estimateSetupMinutes` are pure functions with hand-tuned weights, thresholds, and time-bucket snaps (5/10/15/20/30 min). Zero tests exist for them. Comments explain the intent ("Each connector credential: ~3 min") but nothing verifies the function still produces the documented output.
- **Impact**: Every dev who touches the heuristic is flying blind. UI-visible regressions slip through review.
- **Fix sketch**: Add `templateComplexity.test.ts` with ~6 fixtures covering each tier (beginner/intermediate/advanced × quick/moderate/involved). Tests pin the exact `setupMinutes` for each fixture so any weight change requires explicit fixture updates. Even better: make the weights a `const` config object so they're greppable and the test references the same object.

---

## 10. `src/api/templates/` has no barrel/index export — imports duplicate the path

- **Severity**: Low
- **Category**: dev-loop-friction
- **File**: `src/api/templates/` (no `index.ts`)
- **Scenario**: A consumer needs `listRecipes`, `executeRecipe`, `previewPrompt`, `createTemplateFeedback`. They write four separate imports: `import { listRecipes } from '@/api/templates/recipes'; import { executeRecipe } from '@/api/templates/recipes'; import { previewPrompt } from '@/api/templates/design'; import { createTemplateFeedback } from '@/api/templates/templateFeedback';`. Other API areas (`@/api/personas`, `@/api/credentials`) have similar layout — auto-import discoverability suffers.
- **Root cause**: No `src/api/templates/index.ts` aggregating the eight files (`design.ts`, `discovery.ts`, `n8nTransform.ts`, `platformDefinitions.ts`, `recipes.ts`, `skills.ts`, `templateAdopt.ts`, `templateFeedback.ts`).
- **Impact**: Minor papercut on every template-API touch. VSCode auto-import picks one of the eight files at random; rename refactors require manual reach-around.
- **Fix sketch**: Add `src/api/templates/index.ts` that re-exports `* from './recipes'; * from './design';` etc. Existing deep imports continue to work; new code can do `import { listRecipes, previewPrompt } from '@/api/templates'`.

---

## 11. `is_published: false` skips silently — no dev affordance to list hidden templates

- **Severity**: Low
- **Category**: dev-loop-friction
- **File**: `src/lib/personas/templates/templateCatalog.ts:139-142`, surfaced via `CatalogSkippedEntry`
- **Scenario**: A template author marks a draft template `is_published: false` to hide it from the gallery while iterating. They run the app — the template doesn't show up, exactly as intended. Two days later they finish the work and forget which file was hidden. They grep for `is_published.*false` across `scripts/templates/`. There's no UI surface that lists them.
- **Root cause**: `getTemplateCatalogStatus()` does return `skipped: CatalogSkippedEntry[]` with `reason: 'unpublished'`, but no UI consumes it for the unpublished bucket — the discriminated status is used for `failed`/`partial` error states, not for "show me draft templates I'm working on."
- **Impact**: Tiny papercut, but a really easy win — dev mode could show a "Drafts (3)" tray fed straight from `skipped.filter(s => s.reason === 'unpublished')`. Currently each author rolls their own grep.
- **Fix sketch**: In dev mode (`import.meta.env.DEV`), add a small expand-to-list "Hidden templates" panel under the gallery footer that lists `skipped.unpublished` entries. Cheap to wire — the data is already plumbed through `CatalogLoadResult`.
