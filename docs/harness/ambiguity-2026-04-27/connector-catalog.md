# Ambiguity Audit — Connector Catalog

> Total: 12 findings (2 critical, 4 high, 5 medium, 1 low)
> Files read: ~16
> Scope: src/features/vault/sub_catalog — picker, schemas, forms, design helpers (client-side audit; Rust builtin_connectors out-of-scope)

## 1. Role-preset categories silently couple to Rust catalog without contract

- **Severity**: critical
- **Category**: implicit-assumption
- **File**: src/features/vault/sub_catalog/components/picker/catalogRolePresets.ts:7-20
- **Scenario**: `ROLE_PRESETS` hard-codes category strings like `'devops'`, `'cloud'`, `'project_management'`, `'scheduling'` and is applied via `roleCats.includes(c.category)` in `usePickerFilters` (line 154). The comment says "Category values must match architectural component keys from connector-categories.json" but nothing in this file (or any TS test) validates that contract.
- **Root cause**: The category vocabulary lives in Rust (`builtin_connectors.rs` / `connector-categories.json`) and the frontend hardcodes the same strings without import, codegen, or a runtime guard. A typo or rename on either side fails silently (filter just returns 0 connectors for that role).
- **Impact**: Renaming a category in Rust (e.g. `project_management` → `projects`) makes the Manager role preset silently empty with no error, no test failure, and no telemetry — users see "no connectors" with no explanation.
- **Fix sketch**:
  - Generate `RolePresetCategory` from the same source as the Rust catalog (codegen or shared JSON import)
  - Add a dev-mode assertion in `usePickerFilters` that every preset category appears in `connectors[*].category`
  - At minimum, add a unit test that loads the canonical category list and fails when a preset references an unknown one

## 2. `metadata.auth_variants` cast as `AuthVariant[]` with zero validation

- **Severity**: critical
- **Category**: implicit-assumption
- **File**: src/features/vault/sub_catalog/components/forms/CredentialTemplateForm.tsx:75-83
- **Scenario**: The form reads `metadata.auth_variants`, checks only `Array.isArray`, then casts to `AuthVariant[]`. The downstream code (`v.fields.includes(f.key)`, `v.auth_type_label`, `v.id`, `v.label`) assumes every element matches the shape — but the runtime guard accepts `[42, "foo", null]` just fine.
- **Root cause**: The catalog metadata is JSON authored on the Rust side (or by AI-driven negotiation) but consumed as an opaque blob with structural type assertions only.
- **Impact**: If a connector ships malformed `auth_variants` (e.g. variant missing `fields`), `v.fields.includes(...)` throws inside a `useMemo` and crashes the picker for that connector — with no error boundary visible in this scope. Worse, a partial variant would silently misfilter visible fields, exposing or hiding sensitive ones.
- **Fix sketch**:
  - Define a Zod (or hand-written) validator for `AuthVariant` and run it in the `useMemo`; on failure, fall back to `null` and log via `silentCatch`
  - Add a contract test that round-trips Rust-emitted `metadata.auth_variants` through the validator
  - Document the metadata schema near the type definition so future authors know what shape is required

## 3. `template_enabled !== true` filter — undocumented gating semantic

- **Severity**: high
- **Category**: undocumented-decision
- **File**: src/features/vault/sub_catalog/components/design/CredentialDesignHelpers.ts:50
- **Scenario**: `filterTemplateConnectors` returns `false` whenever `metadata.template_enabled` is anything other than the boolean `true`. Connectors with no metadata, with `template_enabled: 1` (number), or with `template_enabled: "true"` (string) are silently excluded.
- **Root cause**: The `template_enabled` flag's semantics aren't documented anywhere visible in the catalog scope — no comment explaining what "template-enabled" means, who sets it, or why strict-equality is correct.
- **Impact**: A connector author who ships `template_enabled: 1` from Rust JSON serialization (perfectly natural for some serde configs) will see their connector silently disappear from the design flow with no error. Reverse: in `CredentialSchemaForm.tsx:114` the form writes `template_enabled: false` for user-created connectors — coupling between writer and reader is implicit.
- **Fix sketch**:
  - Add a JSDoc on `filterTemplateConnectors` and on the metadata writer in `CredentialSchemaForm.tsx` explaining the contract
  - Consider broadening to truthy-check, or normalizing in a single read helper
  - Add a unit test pinning the strict-equality behavior so future "lenient" refactors aren't accidental

## 4. Optimistic name-prefix coupling between `CodebaseProjectPicker` and parent

- **Severity**: high
- **Category**: tribal-knowledge
- **File**: src/features/vault/sub_catalog/components/forms/CodebaseProjectPicker.tsx:71
- **Scenario**: `if (project && onCredentialNameChange && !credentialName?.startsWith('Custom'))` — the picker only auto-renames the credential when the current name does NOT start with the literal string `'Custom'`. There's no comment explaining what "Custom"-prefixed names are or who creates them.
- **Root cause**: The parent (`CredentialTemplateForm`) sets credential names like `${connector.label} CLI` / `${connector.label} MCP` / `${connector.label} ${authLabel}` — none of which start with "Custom". The "Custom" string seems to be a vestige from an older naming convention, but a future change to use "Custom API" prefix anywhere upstream would unexpectedly disable the auto-rename.
- **Impact**: Future developer changes a default name to start with "Custom" (e.g. `Custom API ${connector.label}`) and silently breaks the codebase picker's auto-naming UX — with no failing test.
- **Fix sketch**:
  - Replace the magic string with an explicit `userHasEditedName` boolean prop driven by parent
  - Or document the "Custom" prefix's origin in a comment + grep for other usages and consolidate
  - Add a test asserting the auto-rename behavior

## 5. `setPendingCatalogCategoryFilter(null)` effect runs without dependency, will re-fire on hot reload

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/vault/sub_catalog/components/picker/usePickerFilters.ts:19-25
- **Scenario**: Reads `pendingCatalogCategoryFilter` synchronously via `useSystemStore.getState()` outside React, then in `useEffect(..., [])` clears it. Comment says "Read once on mount and clear so it doesn't re-apply later."
- **Root cause**: `getState()` outside the render is intentionally non-reactive, but if React StrictMode (or HMR) double-mounts, the second read sees `null` and the cleared state is never restored. More subtly, two simultaneously-mounted picker instances would race: both read the value, but only one applies it as initial state — the other gets nothing.
- **Impact**: In dev (StrictMode), the pending filter may be cleared before being read by the actual visible mount. In prod, mounting two pickers concurrently (e.g. modal + sidebar) silently loses the redirect's category filter.
- **Fix sketch**:
  - Move the read+clear into a single store action (`consumePendingCatalogCategoryFilter`) called once in the effect
  - Make the clear synchronous before any other consumer can read
  - Document StrictMode safety inline

## 6. `api_definition` 500KB cap silently truncates user input

- **Severity**: high
- **Category**: magic-number
- **File**: src/features/vault/sub_catalog/components/schemas/schemaConfigs.tsx:154
- **Scenario**: `def.slice(0, 500_000)` truncates the OpenAPI/Swagger paste to 500KB without warning the user. The textarea help text says "Max 500KB" but the form submits the truncated value silently — no toast, no validation error.
- **Root cause**: The truncation happens inside `buildExtraMetadata` during save, after the user has already clicked Save. There's no UI feedback that bytes were dropped.
- **Impact**: A user pastes a 600KB OpenAPI spec, sees the green "saved" toast, then later finds tools generated from a corrupted (truncated mid-JSON) spec — with no diagnostic. Silent data corruption for any spec >500KB.
- **Fix sketch**:
  - Validate length pre-save and surface an inline error: "OpenAPI spec is X KB, max 500 KB"
  - Or accept arbitrary length and gzip server-side
  - At minimum, log a warning when truncation occurs so support can diagnose

## 7. Healthcheck template variables `{{api_key}}`, `{{anon_key}}` etc. are stringly-typed across boundaries

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/vault/sub_catalog/components/schemas/schemaFormTypes.ts:77-92, schemaConfigs.tsx:197
- **Scenario**: Healthcheck headers contain literal placeholders like `{{api_key}}` and `{{header_1_value}}`. Some Rust backend is presumably substituting these at execution time, but nothing in the TypeScript code documents (a) the substitution syntax, (b) the allowed variable names, or (c) what happens if a placeholder doesn't match any field key.
- **Root cause**: The contract between TS placeholder syntax and Rust substitution lives entirely in tribal knowledge / backend code that isn't in scope here.
- **Impact**: A future developer adds a new schema with header `Authorization: 'Token {{my_token}}'` and the test connection fails opaquely because the substitution engine expects `{{api_key}}`-style names with field-key correspondence. The Basic-auth case at line 87 actually does substitution client-side (`btoa`) — divergent strategies in the same file with no comment.
- **Fix sketch**:
  - Add a JSDoc to `HealthcheckConfig.headers` documenting placeholder syntax and where substitution happens
  - Consolidate substitution to one side (either always client-side or always backend), or call out the inconsistency
  - Validate placeholder names against `subType.fields[*].key` at schema-config definition time

## 8. Rollback after createConnectorDefinition is best-effort and silently swallowed

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/vault/sub_catalog/components/schemas/CredentialSchemaForm.tsx:152-156
- **Scenario**: If `createCredential` fails after `createConnectorDefinition` succeeded, the form attempts `deleteConnectorDefinition(createdConnectorId)` and swallows the result with `/* intentional: non-critical -- rollback is best-effort */`.
- **Root cause**: The two-step create isn't transactional, and the failure mode is acknowledged but not surfaced. There's no telemetry or even a `console.warn`.
- **Impact**: Repeated save failures leak orphan connector definitions in `connector_catalog` with no associated credential. Users may then see ghost connectors in the catalog list, or hit unique-name collisions on retry (`serviceTypePrefix_${sanitize(name)}`).
- **Fix sketch**:
  - Log rollback failures to the structured logger so they're observable
  - Consider a backend-side transactional endpoint that creates both atomically
  - Add a startup janitor that detects and warns about orphan connector definitions

## 9. `defaultMethodId` redundant fallback chain hides intent

- **Severity**: medium
- **Category**: requirements-unclear
- **File**: src/features/vault/sub_catalog/components/forms/CredentialTemplateForm.tsx:110-113
- **Scenario**: `(authMethods.find((m) => m.is_default) ?? authMethods[0])?.id ?? authMethods[0]?.id ?? 'default'` — three fallbacks, but the second and third are redundant: if `find(...)` returns undefined, `authMethods[0]?.id` is computed twice via the `??` chain.
- **Root cause**: Probably defensive coding against `authMethods` being filtered to `[]` after `cliSpecs` resolves. But the literal string `'default'` as final fallback has no upstream meaning — no auth method has id `'default'`, so passing it to `setActiveAuthMethodId` puts the form into a state where `activeMethod` is undefined.
- **Impact**: When all CLI-only auth methods get filtered out and there are no other methods, the form silently falls back to a non-existent id, and `activeMethod = authMethods[0]` (line 115) which is also undefined — UI may render but submit handlers depend on `activeMethod?.type`. Behavior under "connector with only filtered-out CLI methods" is undefined.
- **Fix sketch**:
  - Remove the `'default'` fallback; render an explicit empty state ("No auth methods available") when `authMethods.length === 0`
  - Simplify to `authMethods.find(m => m.is_default)?.id ?? authMethods[0]?.id`
  - Add a test for the all-filtered case

## 10. `sanitize()` collapses distinct names to identical service types

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/vault/sub_catalog/components/schemas/schemaFormTypes.ts:55-57
- **Scenario**: `sanitize("My API!")` and `sanitize("My API?")` both return `my_api_`. The function lowercases and collapses any non-alphanumeric run to a single underscore, with no uniqueness guarantee.
- **Root cause**: Service-type derivation is `${serviceTypePrefix}_${sanitize(effectiveName)}` (line 101) — if two credentials have similar names, they generate the same service_type, which is presumably a primary or unique key.
- **Impact**: Second save with a similar name fails on unique constraint with a backend error message; the user has no warning before clicking Save. For database/MCP/Custom flows, this means user-visible errors with cryptic messages instead of inline name-collision validation.
- **Fix sketch**:
  - Append a uniqueness suffix (timestamp or short hash) when collision detected
  - Validate name uniqueness in the form before save and show inline error
  - Document the collision behavior in `sanitize`'s JSDoc

## 11. CLI service-type registration check assumes 1:1 connector-name = CLI service-type

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/vault/sub_catalog/components/forms/CredentialTemplateForm.tsx:101-103
- **Scenario**: `m.type !== 'cli' || registered.has(selectedConnector.name)` — filters CLI auth methods out unless the connector's `name` is in the registered CLI specs list. This assumes the CLI spec's `service_type` always equals the connector's `name`.
- **Root cause**: The mapping between CLI specs and connectors lives in the Rust backend; the frontend takes the equivalence for granted with no contract.
- **Impact**: If a CLI spec is registered under a different service_type than the connector name (e.g. multiple connectors share one CLI spec, or naming diverges), the auth tab is silently hidden — user sees no CLI option even though one exists. Also, the same assumption is repeated in `SetupGuideModal.tsx:36-37` and `CliConnectionPanel.tsx:49,63,87`.
- **Fix sketch**:
  - Add a `cli_spec_id` field to `ConnectorDefinition.metadata` to make the link explicit
  - Or document the equivalence in a comment near each call site
  - Add a build-time check that every connector advertising CLI auth has a matching registered spec

## 12. `oauthCompletedAt` typed as string — formatted directly into translation

- **Severity**: low
- **Category**: magic-number
- **File**: src/features/vault/sub_catalog/components/forms/TemplateFormBody.tsx:144
- **Scenario**: `oauthCompletedAt ? tx(cf.oauth_connected_at, { label, time: oauthCompletedAt }) : undefined` — `oauthCompletedAt` is typed `string | null` but no contract on whether it's an ISO timestamp, a locale-formatted date, or a relative-time string. It's passed directly to `tx` interpolation as `{time}`.
- **Root cause**: The string contract is implicit between whoever sets `oauthCompletedAt` (not in scope) and this presentational component.
- **Impact**: A future change to set `oauthCompletedAt = new Date().toISOString()` would render "Connected to GitHub at 2026-04-27T15:23:00.000Z" instead of a human-readable time. Currently works because some upstream formatter is doing the right thing, but the contract isn't enforced.
- **Fix sketch**:
  - Type as `Date | null` and format inside this component
  - Or rename to `oauthCompletedAtDisplay` to make presentation-readiness explicit
  - Add JSDoc clarifying the format expectation
