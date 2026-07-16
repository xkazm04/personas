# lib/personas — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 4 medium / 1 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. Cluster of dead exports across promptMigration, platformDefinitions, and templateOverlays
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/personas/promptMigration.ts:86 (also platformDefinitions.ts:363-372, templateOverlays.ts:64,324)
- **Scenario**: Repo-wide grep (src + tests + scripts) finds zero callers for `migratePromptToStructured`, `isStructuredPromptEmpty` (promptMigration.ts), `BUILTIN_DEFINITIONS` / `getBuiltinDefinition` (platformDefinitions.ts — `BUILTIN_DEFINITIONS` is only read by the equally-unused `getBuiltinDefinition`), and `drainOverlayMismatches` / `invalidateOverlayCache` (templateOverlays.ts). The latter two carry doc comments claiming "for use by parity tests" and "used by HMR hook during dev", but no test or hook references them anywhere.
- **Root cause**: Migration-era helpers and diagnostic hooks whose consumers were removed (or never landed) while the exports stayed behind, with comments that now over-claim usage.
- **Impact**: ~60 LOC of unmaintained surface that readers must treat as live API; the stale "consumed by parity tests" comments actively mislead — a mismatch buffer (`_currentMergeMismatches`) is appended to but never drained in any real code path, so it also grows unbounded across merges (tiny objects, but a genuine slow accumulation in long sessions with overlay mismatches).
- **Fix sketch**: Delete `migratePromptToStructured`, `isStructuredPromptEmpty`, `getBuiltinDefinition` + `BUILTIN_DEFINITIONS`, `drainOverlayMismatches`, and `invalidateOverlayCache` (or wire the intended parity test / HMR hook if that was the plan). If `drainOverlayMismatches` goes, also stop pushing into `_currentMergeMismatches`. Note: `HEALTH_FAILING_MIN` / `TRUST_WEIGHTS` / `HEALING_PENALTY_PER_FAILURE` / `VOLUME_FULL_CREDIT_RUNS` / `TRUST_SAMPLE_SIZE` in personaThresholds.ts are also uncalled, but the file's header documents them as deliberate doc-mirrors of the Rust constants — keep those, they are documentation by design.

## 2. Three parsers each hand-roll the same substring-based service-name resolution
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/personas/parsers/zapierParser.ts:29 (also makeParser.ts:34, githubActionsParser.ts:52)
- **Scenario**: `extractServiceName` in zapierParser and makeParser are near-identical (lowercase → strip non-alphanumerics → iterate a `toServiceMap()` record with `.includes()` → fall back to the cleaned string), and githubActionsParser's `extractServiceFromUses` repeats the same loop against its own inline `GHA_SERVICE_MAP` instead of a `PlatformDefinition`. Meanwhile platformDefinitions.ts already owns `resolveNodeType` for exactly this job (n8n uses it).
- **Root cause**: The config-driven `PlatformDefinition` refactor ("defined here as data rather than scattered across individual parsers", per the file header) was only completed for n8n; Zapier/Make kept a `toServiceMap` backward-compat shim and GHA never got a definition at all.
- **Fix sketch**: Add a `resolveServiceByIncludes(def, raw)` helper to platformDefinitions.ts (lowercase/clean + `.includes()` walk over `nodeTypeMap`), delete both local `extractServiceName` copies and `toServiceMap` usage in the parsers. Optionally promote `GHA_SERVICE_MAP` into a `GITHUB_ACTIONS_DEFINITION` so all four platforms follow one model. Behavior-preserving; verify with existing parser tests.

## 3. Whole template catalog (~3.7MB) is JSON.stringify'd twice — once for client hashing, again for backend IPC verification
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: redundant-serialization
- **File**: src/lib/personas/templates/templateCatalog.ts:348 (first pass at :162)
- **Scenario**: `loadAndVerify` serializes every template (`canonicalContent = JSON.stringify(template)`, line 162) to compute the client-side checksum, then throws the string away. `verifyTemplatesWithBackend` later re-serializes every verified template (line 350) to ship the full content across Tauri IPC. On the documented ~3.7MB catalog that is ~7.4MB of main-thread stringify work per session where ~3.7MB would do.
- **Root cause**: `VerifiedEntry` keeps only `{ template, relPath }`; the canonical serialized form computed during verification isn't retained for the layer-2 check that needs the exact same bytes.
- **Impact**: A bounded but measurable main-thread stall (large-object stringify is one of the pricier sync operations) duplicated for no benefit; it also risks subtle divergence if the object were ever mutated between the two stringify passes — reusing one string makes layer-1 and layer-2 provably hash the same content.
- **Fix sketch**: Add `canonicalContent: string` to `VerifiedEntry`, set it in `loadAndVerify` where it's already computed, and have `verifyTemplatesWithBackend` map `content: v.canonicalContent` instead of re-stringifying. ~5-line change, no behavior difference.

## 4. Seed runner re-upserts all ~115 templates (multi-MB payloads) into SQLite on every app session
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: redundant-writes
- **File**: src/lib/personas/templates/seedTemplates.ts:113
- **Scenario**: `seedCatalogTemplatesOnce` runs once per session, but `runSeed` unconditionally stringifies every template's full payload (`design_result: JSON.stringify(designResultObj)` per entry) and `batchImportDesignReviews` upserts all ~115 rows — even when the catalog hasn't changed since the last launch, which is every launch except right after an app update. Each seed row carries the whole v3 payload, so this is a multi-MB serialize + IPC + SQLite write burst at startup (behind requestIdleCallback, but still competing with early user interaction), plus `reviewed_at: new Date().toISOString()` churns every row's value on each run.
- **Root cause**: The upsert-everything approach was chosen for field backfills ("Upsert ALL seeds to backfill new fields"), with no cheap "catalog unchanged" short-circuit even though `TEMPLATE_CHECKSUMS` already gives a build-stable fingerprint of the entire catalog.
- **Impact**: Every launch pays serialization of the full catalog a second time (on top of finding #3's hashing pass), a large IPC payload, and ~115 SQLite row rewrites — pure waste in the steady state; on low-end disks this is the difference between an idle-time no-op and a visible write burst.
- **Fix sketch**: Derive a catalog fingerprint (e.g. hash of the sorted `TEMPLATE_CHECKSUMS` entries, or just its JSON) and persist it via the existing settings/kv store after a successful seed. On startup, skip `runSeed` when the stored fingerprint matches; run the full upsert + `deleteStaleSeedTemplates` only when it differs (new build) or the flag is absent. Keep `force` bypassing the check for dev.

## 5. promptMigration.ts is misnamed for its role and hides an import mid-file
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/lib/personas/promptMigration.ts:181
- **Scenario**: The file's own header declares it the "Canonical Owner Module" for StructuredPrompt (types, parsing, validation, rendering, IPC preview, editable conversion — 330+ LOC), yet it is named after the one 6-line migration helper (which is itself dead, see finding #1). The `import { previewPrompt as tauriPreviewPrompt } from '@/api/design/design'` sits at line 181, mid-file under a "Rendering" banner, where nobody looking at the import block will find the module's only external runtime dependency. `getSectionSummary`'s doc also claims "first 80 chars" while returning full section text.
- **Root cause**: The module grew from a migration shim into the canonical StructuredPrompt owner without being renamed, and the IPC import was added next to its consumer rather than at the top.
- **Impact**: Discoverability tax: ~10 importing files reference StructuredPrompt machinery under a name that suggests a legacy migration shim, and the buried import obscures that this "lib" module reaches into the Tauri API layer. The stale docstring misleads diff-viewer consumers about truncation behavior.
- **Fix sketch**: Hoist the import to the top of the file; fix the `getSectionSummary` doc (or implement the 80-char truncation if the diff viewers want it). Optionally rename to `structuredPrompt.ts` with a one-line re-export from the old path to avoid a 10-file churn in one commit.
