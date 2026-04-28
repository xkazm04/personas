# Connector Catalog — Dev Experience Scan

> Total: 9 · Critical: 0 · High: 3 · Medium: 4 · Low: 2
> Scope: client-side only
> Date: 2026-04-27

---

## 1. `connector.metadata` schema is undocumented and parsed ad-hoc in 9 places

- **Severity**: High
- **Category**: documentation
- **File**: `src/features/vault/sub_catalog/components/picker/SetupGuideModal.tsx:64-68`, `forms/CredentialTemplateForm.tsx:75-78,144`, `autoCred/steps/CatalogAutoSetup.tsx:24-26,58-59`, `design/CredentialDesignHelpers.ts:64-72`, `picker/ConnectorCard.tsx:50`, `forms/TemplateFormBody.tsx:73-76`
- **Scenario**: Dev wants to add a new metadata key (e.g. `oauth_consent_url`). Greps for `metadata.` and finds the same `typeof metadata.X === 'string' ? metadata.X : null` pattern in 9 different files. There is no canonical `ConnectorMetadata` interface — `ConnectorDefinitionBase.metadata` is typed as `Record<string, unknown> | null` (see `src/lib/types/types.ts:164`). The dev has to read each file to discover what keys exist (`setup_guide`, `setup_instructions`, `docs_url`, `auth_type_label`, `auth_type`, `auth_methods`, `auth_variants`, `summary`, `template_enabled`, `oauthType`, `universal_source_url`, `connection_type`, `database_type`, `auth_template`, `env_vars`, `api_definition`, `openapi_spec_url`, `schema_spec`, `auto_explore_schema`).
- **Root cause**: Metadata is the single most-touched contract between the Rust connector catalog and the React UI, but it has no TypeScript interface and no docs. New keys are added implicitly by Rust seeders + frontend readers; nobody knows the canonical set.
- **Impact**: ~30+ min/dev to figure out "what can I store on a connector?". Drift between sub_catalog and `src-tauri/src/db/builtin_connectors.rs` (the schema is duplicated by convention only). Typos in metadata keys are silently invisible.
- **Fix sketch**: Define `ConnectorMetadata` as a discriminated/optional interface in `src/lib/types/types.ts` covering all known keys, with JSDoc on each field. Add a `parseConnectorMetadata(raw: unknown): ConnectorMetadata` helper that does the `typeof` checks once. Replace the 9 ad-hoc reads with `connector.metadata.setup_guide` (typed). Add a doc page `docs/concepts/connector-metadata.md` listing every key, where it's set, where it's read.

---

## 2. Filter-counts logic in `usePickerFilters.ts` builds 4 nearly-identical pipelines (≈70 LOC of repetition)

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/vault/sub_catalog/components/picker/usePickerFilters.ts:66-144`
- **Scenario**: Dev wants to add a 5th filter axis (e.g. "by author" or "by region"). They have to: (a) add a 5th `xxxBase` `useMemo` that excludes the new axis, (b) add a 5th counts `useMemo`, (c) update the existing four `xxxBase` memos to also include the new axis, and (d) modify `filteredConnectors` at the bottom which re-implements the same five filters inline a 5th time. That's ~5 places per new axis, with subtle drift bugs (forgetting to add `ownedServiceTypes` to the deps array of one of them — the file already shows that `licenseBase` and `connectedBase` lists differ in their dependency arrays for no apparent reason).
- **Root cause**: No abstraction over "compute count for axis X excluding X's own filter". The four functions `applyConnected`, `applyCategory`, `applyPurpose`, `applyLicense`, `applyRole` each take `(list, value)` — but they're composed by hand 4× instead of via a generic `withFiltersExcept(axis)` helper. `filteredConnectors` then re-implements all 5 inline a 5th time.
- **Impact**: Every new filter is O(n²) work; bugs from forgotten axes (e.g. a count showing through after a filter is applied) are nearly invisible until users notice. ~30 min per filter change just navigating the duplication.
- **Fix sketch**: Define `type FilterAxis = { id: string; predicate: (c, value) => bool; getValue: (c) => string }`, build a registry `const AXES = [...]`, then derive `xxxBase` and `xxxOptions` generically. `filteredConnectors = AXES.reduce((list, axis) => axis.predicate ? list.filter(...) : list, connectors)`. Cuts the file roughly in half and adding a new axis becomes one entry in the array.

---

## 3. Only one test file in the entire `sub_catalog` directory (1/85 .tsx files)

- **Severity**: High
- **Category**: testing
- **File**: `src/features/vault/sub_catalog/components/forms/__tests__/TemplateFormBody.test.tsx` (only file)
- **Scenario**: Dev refactors `usePickerFilters` (188 LOC of filter algebra), `deriveCredentialFlow` (4 branches × OAuth/api_key combos), `parseAutoCredError` (regex-based string-to-struct mapping), `checkFieldCompleteness`, `parseSteps` (markdown-to-step-blocks), `splitByUrls`, `groupLogEntries`, `buildUniversalDesignResult`, `translateHealthcheckMessage` (10+ HTTP-status branches) — and has zero tests to catch regressions in any of these pure functions. The one existing test only covers a tiny CONN-04 zero-config edge case.
- **Root cause**: The catalog has many pure-function helpers (no hooks, no Tauri calls, no DOM) that are trivially testable but untested. Test infra exists (vitest + RTL is wired up — see the existing test) — convention just hasn't been applied to this module.
- **Impact**: Refactors of catalog code are scary; behaviour changes go unnoticed until QA. Every helper change risks breaking a connector flow without a fast feedback loop.
- **Fix sketch**: Add `__tests__/` neighbour files for the high-risk pure helpers (priority: `CredentialDesignHelpers.ts`, `usePickerFilters.ts`, `autoCredHelpers.ts`, `setupInstructionHelpers.tsx`, `types.ts` (`checkFieldCompleteness`, `parseAutoCredError`)). Aim for 5-10 unit tests per file. Estimate 1 day of work, removes a chronic refactor friction.

---

## 4. `'translateHealthcheckMessage'` and brand-color/hint constants live mid-file in CredentialDesignHelpers (357 LOC grab-bag)

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/vault/sub_catalog/components/design/CredentialDesignHelpers.ts:1-357`
- **Scenario**: File mixes (a) constants `QUICK_SERVICE_HINTS` + `HINT_COLORS`, (b) `OAUTH_FIELD` constant, (c) `extractFirstUrl` (regex helper), (d) `filterTemplateConnectors` + `buildTemplateResult` (template helpers), (e) `CredentialFlow` discriminated union + 8 derivers, (f) `translateHealthcheckMessage` (90 LOC, totally unrelated). Dev jumping in to fix an OAuth scope bug has to scroll past health-check string translation, then through brand-color hex codes. Searching for "where do we generate the friendly healthcheck error?" returns this file as a hit alongside `useCredentialHealth`, leading to confusion about which is canonical.
- **Root cause**: File is a misnamed grab-bag. "Helpers" tells you nothing. Each section is small enough to live alone or with a same-purpose neighbour (the OAuth derivers belong with `useCredentialDesignOrchestrator`, healthcheck translation belongs in shared health utilities, brand colors belong with template UI).
- **Impact**: Hurts code-search ergonomics. Imports from this file are scattered across 6+ files for unrelated purposes.
- **Fix sketch**: Split into `flowDerivation.ts` (CredentialFlow + derivers), `healthcheckMessages.ts` (translate function — also useful elsewhere), `templateHelpers.ts` (filter/buildTemplateResult), and inline the small constant objects into the one file that uses them. Add re-exports from `CredentialDesignHelpers.ts` for one release if external imports exist, then delete.

---

## 5. `__procedure_log` and `_universal*` magic prefixes mixed into typed `ExtractedValues`

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/vault/sub_catalog/components/autoCred/helpers/TauriPlaywrightAdapter.ts:135-137`, `autoCred/steps/universalAutoCredHelpers.ts:29-31`, `autoCred/steps/UniversalAutoCredPanel.tsx:87,137`
- **Scenario**: Dev sees `ExtractedValues = Record<string, string>` but then notices `(values as Record<string, string>).__procedure_log = result.procedure_log` and `_universalServiceUrl` cast onto `CredentialDesignResult`. Filtering them out is `Object.keys(...).filter((k) => !k.startsWith('__'))` — repeated in two places. New devs reading `extractedValues` think it's a clean string map; in fact it has reserved keys.
- **Root cause**: Side-channel data was bolted onto an existing typed object instead of extending the type. The `_universalServiceUrl` / `_universalDescription` field was added to `CredentialDesignResult` via a type cast inside the helper rather than extending the binding.
- **Impact**: Type system lies. Any dev iterating `extractedValues` (e.g. for telemetry, debugging, save) has to remember to filter prefixes. Easy to leak `__procedure_log` into a saved credential.
- **Fix sketch**: Add explicit fields to the result types: `interface AdapterResult { values: ExtractedValues; partial: boolean; procedureLog?: string; ... }`. Extend `CredentialDesignResult` (or a wrapper) with `universalContext?: { serviceUrl, description }` instead of casting. Remove the `__` prefix filtering in `UniversalAutoCredPanel.tsx:87,137` since the values map is now clean.

---

## 6. `desktop` connector picker option is gated behind `import.meta.env.DEV` with a hardcoded `'DEV'` badge — friction to test in production builds

- **Severity**: Medium
- **Category**: dev-loop-friction
- **File**: `src/features/vault/sub_catalog/components/forms/CredentialTypePicker.tsx:45-53,114`
- **Scenario**: QA / a stakeholder tries the prod build of Personas, asks "where's the desktop discovery option?". Dev says "oh, it's hidden behind `import.meta.env.DEV`". To test it in a prod-mode build, dev has to either flip the flag (changes git state), build with a custom Vite mode, or temporarily comment it. There's no `localStorage.setItem('feature.desktop', 'true')` override, no settings toggle, no debug menu.
- **Root cause**: One-shot dev gate. There's no project convention for opt-in feature flags (no `useFeatureFlag('desktop_discovery')` hook). The decision was hardcoded into the spread.
- **Impact**: 5-10 min per test cycle for whoever needs to verify the desktop flow in prod-mode, recurring weekly while the feature is in active development. Also blocks dogfooding.
- **Fix sketch**: Introduce a tiny `useFeatureFlag(name)` reading from settings store + localStorage override. Replace `import.meta.env.DEV ? [...] : []` with `featureFlags.desktopDiscovery ? [...] : []`. Add a settings toggle in the experimental panel. Costs ~30 min, removes a recurring papercut.

---

## 7. `SOURCE_META` map in `ForagingResultCard` is missing entries — silent fallback to `env_var` icon

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/vault/sub_catalog/components/foraging/ForagingResultCard.tsx:23-34,51`
- **Scenario**: Dev adds a new `ForageSource` variant in the Rust binding (e.g. `azure_credentials`). Frontend compiles fine because `SOURCE_META: Record<ForageSource, ...>` is well-typed — except wait, the lookup is `SOURCE_META[credential.source] ?? SOURCE_META.env_var`, which fails open. So the card silently shows the env-var icon and label "Env Variable" for the new source. The bug is invisible; nobody catches it until a user notices "why does my AWS-looking credential say 'Env Variable'?".
- **Root cause**: The `?? SOURCE_META.env_var` fallback was added (probably defensively) but neutralizes the exhaustiveness benefit of `Record<ForageSource, ...>`. The TS compiler can't enforce the map is complete because `ForageSource` is a union from the Rust binding — when a new variant is added, TS compile WILL flag missing entries on the Record literal, but the runtime fallback masks the symptom if the dev removes the entry by mistake.
- **Impact**: Silent UX rot whenever sources are renamed. Users see the wrong label/icon; no error.
- **Fix sketch**: Drop the `?? SOURCE_META.env_var` fallback so missing entries become a runtime error in dev (or use `satisfies Record<ForageSource, ...>` with no fallback so TS keeps full exhaustiveness). Add a vitest assertion that `Object.keys(SOURCE_META).sort() === ALL_FORAGE_SOURCES.sort()` if both are exported.

---

## 8. Dead `_autoSetupPending` and `showUniversal` props in `CredentialDesignModalBody`

- **Severity**: Low
- **Category**: code-organization
- **File**: `src/features/vault/sub_catalog/components/design/CredentialDesignModalBody.tsx:49`, `design/useCredentialDesignModal.ts:30,82,124,196-197`
- **Scenario**: Dev reads `CredentialDesignModalBody.tsx` and sees `autoSetupPending: _autoSetupPending` (underscored to silence ESLint). Wonders if this prop matters — it's never used in the body. Traces back to `useCredentialDesignModal` and finds `showUniversal`/`setShowUniversal` state still being managed but never wired into the body component (the `CredentialDesignModal.tsx` doesn't pass them either). Looks like a half-done refactor that left stub state behind.
- **Root cause**: A "Universal AutoCred" feature was wired in, then partially extracted, leaving orphaned state and an underscored prop that exposed the abandonment.
- **Impact**: Confusion (~5 min reading) for anyone touching the design modal. Misleads grep results when searching for "where is universal mode handled?". One unused state subscription per render.
- **Fix sketch**: Either remove `showUniversal/setShowUniversal` from `useCredentialDesignModal.ts` (and the `_autoSetupPending` underscore-renamed prop), or wire them up to render `<UniversalAutoCredPanel>` inside the modal body. 10 min cleanup.

---

## 9. Brand colors for service hints encoded as plain hex in CredentialDesignHelpers (drift risk vs. connector catalog)

- **Severity**: Low
- **Category**: convention-drift
- **File**: `src/features/vault/sub_catalog/components/design/CredentialDesignHelpers.ts:11-18`
- **Scenario**: Dev updates the OpenAI brand color in the connector catalog (Rust seeders) from `#10A37F` to a new value. They forget to update `HINT_COLORS` in this file, because there's no link between the two sources. Hint chips and the catalog now show the same connector with two different brand colors. Same risk for GitHub, Slack, Stripe, Notion, Datadog (all six hints have hardcoded hex).
- **Root cause**: Two sources of truth for brand colors. The connector catalog already carries `connector.color` per definition (used in `ConnectorCard`); the hint chips re-encode the same colors keyed by display label.
- **Impact**: Subtle visual drift over time. Low daily impact but compounds.
- **Fix sketch**: Resolve `HINT_COLORS[hint]` at runtime by matching the hint to a connector definition (e.g. find `connectorDefinitions.find(c => c.label.toLowerCase().includes('openai'))?.color`), with `#888` fallback. Or move `QUICK_SERVICE_HINTS` to be a `[label, connectorName]` tuple so the lookup is direct. Eliminates the duplicate.
