# Code-refactor scan — Settings, BYOM & Engine Config

> Total: 11 findings (2 high, 5 medium, 4 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: several listed paths do not exist; the actual layout is:
> - `src/api/settings.ts` → `src/api/system/settings.ts`
> - `src/api/byom.ts` → `src/api/system/byom.ts`
> - `src/api/engineConfig.ts` → does not exist (no separate engine-config API; the capability map lives at `src/features/settings/sub_engine/libs/engineCapabilities.ts` and persists via the generic `app_settings` IPC)
> - `src/features/settings/byom` → `src/features/settings/sub_byom/`
> - `src/features/settings/engine-config` → `src/features/settings/sub_engine/` (no separate engine-config feature)
> - `src/lib/byom` / `src/lib/providers` / `src/lib/engineConfig` → none exist (helpers live under each `sub_*/libs/`)
> - `src/stores/slices/settingsSlice.ts` / `byomSlice.ts` / `providerSlice.ts` / `engineConfigSlice.ts` → none exist; settings/BYOM state lives in component-scoped hooks (`useByomSettings`, `useEngineCapabilities`) backed directly by `app_settings`
> - `src-tauri/src/commands/settings.rs` → `src-tauri/src/commands/infrastructure/settings.rs`
> - `src-tauri/src/commands/byom.rs` → `src-tauri/src/commands/infrastructure/byom.rs`
> - `src-tauri/src/commands/engine_config.rs` / `providers.rs` → do not exist
> - `src-tauri/src/db/models/setting.rs` / `byom.rs` / `provider.rs` / `engine_config.rs` → none; BYOM types live in `src-tauri/src/engine/byom.rs`, settings have no dedicated model
> - `src-tauri/src/db/repos/settings/` → `src-tauri/src/db/repos/core/settings.rs` (single file, not a directory)
> - `src-tauri/src/db/repos/byom/` / `providers/` / `engine_config/` → none; provider audit lives at `src-tauri/src/db/repos/execution/provider_audit.rs`
> - `src-tauri/src/lib/byom` / `lib/providers` / `lib/engine_config` → none; the modules are `src-tauri/src/engine/byom.rs`, `engine/provider/`, `engine/quality_gate.rs`

## 1. Six version-check helpers are dead code that the runner reimplements inline

- **Severity**: high
- **Category**: dead-code
- **File**: `src-tauri/src/engine/provider/mod.rs:197-341`
- **Scenario**: `load_engine_kind` (mod.rs:197), `load_engine_kind_notified` (mod.rs:209-236), `parse_version_tuple` (mod.rs:244), `version_gte` (mod.rs:256), `extract_version` (mod.rs:283), and `check_cli_version` (mod.rs:299) are all marked `#[allow(dead_code)]`. None are called from production code — `cargo build` would refuse them without the allow. The runner at `src-tauri/src/engine/runner/mod.rs:446-468` re-implements `load_engine_kind_notified` inline (the same CLI_ENGINE→`from_setting`→`emit_to(ENGINE_FALLBACK)` cascade).
- **Root cause**: Pending features ("wire from engine startup once fallback toast is desired" / "once minimum-version gating goes live") that never landed. The doc comment on `claude.rs:85` even claims "the check is advisory: `provider::check_cli_version` returns an Err string below the floor; no caller turns that into a hard refusal" — confirming the check is uncalled.
- **Impact**: ~145 LOC of unused logic in the canonical provider module (60 LOC implementation + ~50 LOC tests + module-level wiring noise) plus a divergence risk: the runner's inline cascade could drift from `load_engine_kind_notified` over time.
- **Fix sketch**: Either (a) wire `load_engine_kind_notified` into `runner/mod.rs:446` and delete the inline duplicate (preferred — the helper has tests, the inline copy does not), or (b) delete the dead helpers and `#[allow(unused_imports)]` on `tauri::Emitter`. The version helpers are isolated and can be removed independently of the engine-kind loader.

## 2. `BYOM_POLICY_KEY` is duplicated outside the canonical `settings_keys` allowlist

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/engine/byom.rs:22` and `src-tauri/src/db/settings_keys.rs:130`
- **Scenario**: Both files define the string literal `"byom_policy"` — `engine/byom.rs` as `pub const BYOM_POLICY_KEY` and `settings_keys.rs` as `pub const BYOM_POLICY`. `engine/byom.rs::load/save/delete` reference the local `BYOM_POLICY_KEY`, bypassing the canonical allowlist constant that `settings_keys.rs` exports for the same purpose.
- **Root cause**: When `settings_keys.rs` was created to centralise the allowlist (line 1: "Use these instead of raw string literals to prevent typo-based key mismatches"), `engine/byom.rs` was not migrated.
- **Impact**: A typo in either constant would silently desync the allowlist from the BYOM load/save path. Violates the module-doc contract on `settings_keys.rs:1-13`.
- **Fix sketch**: Delete `BYOM_POLICY_KEY` from `engine/byom.rs:22` and replace the three call sites (lines 220, 226, 243, 277) with `crate::db::settings_keys::BYOM_POLICY`.

## 3. Inline runner cascade for engine-kind loading duplicates `load_engine_kind_notified`

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/engine/runner/mod.rs:446-468` and `src-tauri/src/engine/provider/mod.rs:209-236`
- **Scenario**: The runner's `engine_kind` resolution block (the `let engine_kind = { ... }` 22-line cascade with `parse::<EngineKind>().is_err()` → `from_setting` → `emit_to(ENGINE_FALLBACK)` branches) is a byte-for-byte re-implementation of `load_engine_kind_notified`. Same `match raw`, same `emit_to`, same fallback to `EngineKind::ClaudeCode`.
- **Root cause**: The helper was written speculatively; when the runner needed the same cascade it inlined the code rather than calling the helper.
- **Impact**: Two copies of the engine-fallback emit contract. The helper's tests do not exercise the runner copy, so a behaviour change to one would not be caught by the other's tests. Tangled with finding #1 — fixing one resolves both.
- **Fix sketch**: Replace `runner/mod.rs:446-468` with `let engine_kind = provider::load_engine_kind_notified(&pool, &*emitter);`. Remove `#[allow(dead_code)]` from the helper.

## 4. `SEVERITY_STYLES` constant is duplicated between routing and compliance rule cards

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/settings/sub_byom/components/ByomRoutingRules.tsx:7-11` and `src/features/settings/sub_byom/components/ByomComplianceRules.tsx:7-11`
- **Scenario**: Both BYOM rule-list components declare an identical `SEVERITY_STYLES: Record<PolicyWarningSeverity, { border: string; text: string; icon: typeof AlertTriangle }>` table mapping `error`/`warning`/`info` → border, text, and lucide icon. The exact same lucide imports (`AlertCircle`, `AlertTriangle`, `Info`) appear in both files purely to feed this table.
- **Root cause**: Component-local copy-paste. Both files were authored when `PolicyWarning` was introduced and the styling table was never extracted.
- **Impact**: Two definitions to keep in sync when severity colours or icons change. The "worst severity" reduction (`ruleWarnings.some((w) => w.severity === 'error') ? 'error' : ...`) is also repeated at `ByomRoutingRules.tsx:51-54` and `ByomComplianceRules.tsx:51-54`.
- **Fix sketch**: Extract `SEVERITY_STYLES` (the table + the `worstSeverity` helper) into `src/features/settings/sub_byom/libs/byomHelpers.ts` alongside the existing `PolicyWarning` / `PolicyWarningSeverity` types, and import in both rule components.

## 5. `provider_audit::list` and `list_by_persona` duplicate the SELECT + row mapping

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/db/repos/execution/provider_audit.rs:43-119`
- **Scenario**: `list` (lines 43-77) and `list_by_persona` (lines 80-119) carry identical `SELECT id, execution_id, persona_id, persona_name, engine_kind, model_used, was_failover, routing_rule_name, compliance_rule_name, cost_usd, duration_ms, status, created_at FROM provider_audit_log ORDER BY created_at DESC` plus an identical 13-field `ProviderAuditEntry { ... }` row constructor. The only differences are the `WHERE persona_id = ?1` clause and the bind params.
- **Root cause**: Schema accreted columns over time; nobody factored out the row mapping when the persona-scoped variant was added.
- **Impact**: ~30 LOC of duplicate row deserialisation. Adding a column to `provider_audit_log` requires editing two `Ok(ProviderAuditEntry { ... })` blocks in lockstep, with no compile-time pairing.
- **Fix sketch**: Extract `fn map_row(row: &rusqlite::Row) -> rusqlite::Result<ProviderAuditEntry>` to a private helper at the top of the module and call it from both `query_map` closures. Optionally factor the `SELECT … ORDER BY created_at DESC` prefix into a shared string constant.

## 6. `PolicyWarning` validation logic is mirrored across Rust and TypeScript

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/settings/sub_byom/libs/byomHelpers.ts:60-152` and `src-tauri/src/engine/byom.rs:295-414`
- **Scenario**: `validateByomPolicy` in `byomHelpers.ts` is an explicit re-implementation of `ByomPolicy::validate` in Rust — same severity rules (unknown blocked = error, unknown allowed = info, compliance/routing targeting blocked = error), same message wording variants. The doc comment at `byomHelpers.ts:60-63` even calls this out: "mirrors the Rust `ByomPolicy::validate()` logic so warnings appear instantly on every edit without an IPC round-trip."
- **Root cause**: Intentional duplication for UX (instant validation feedback without IPC). The `validate_byom_policy` Tauri command (`commands/infrastructure/byom.rs:60`) exists but is unused — the TS validator subsumed it. Two slightly different `PolicyWarning` shapes (rich frontend with `ruleType`/`ruleIndex`, slim Rust binding) make the type alias dance at `src/api/system/byom.ts:11-19` necessary.
- **Impact**: Two validators that must stay semantically aligned on each provider/severity change. The `validate_byom_policy` IPC has zero callers in TS — verified via grep — but is still wired into the command surface.
- **Fix sketch**: Either (a) accept the duplication as a stability boundary and delete the unused `validate_byom_policy` IPC (commands/infrastructure/byom.rs:60-66 + matching TS exports in `src/api/system/byom.ts:31-32`), or (b) graduate the richer `PolicyWarning` shape into the canonical Rust binding and call `validate_byom_policy` from the UI via a debounced IPC. Option (a) is the smaller change and matches current usage; the alias comment at `byom.ts:11-16` explicitly anticipates the future collapse to option (b).

## 7. `engine_name` and `as_setting` on `CliProvider` are never read

- **Severity**: low
- **Category**: dead-code
- **File**: `src-tauri/src/engine/provider/mod.rs:47-87` and `provider/mod.rs:124-126`
- **Scenario**: `EngineKind::as_setting()` is marked `#[allow(dead_code)]` at line 82, and `CliProvider::engine_name` is referenced only from a single test (`resolve_provider_covers_all_variants`, mod.rs:392) and the runner's inline cascade (which uses `kind.as_setting()` for `event_name::ENGINE_FALLBACK` payload). The trait is also `#[allow(dead_code)]` at line 123.
- **Root cause**: The trait abstraction was designed for multi-provider support (Codex, Ollama) that never landed — see `engine/ollama.rs:7-21` which documents the deferral. With only `ClaudeCode` in `EngineKind`, most trait methods have a single trivial implementation and no caller.
- **Impact**: ~50 LOC of trait scaffolding (engine_name, context_file_name, supports_session_resume, prompt_delivery, minimum_version, build_execution_args_with_prompt, build_resume_args_with_prompt) that the compiler accepts only via `#[allow(dead_code)]` on the trait. Caution flagged in the brief — these are dispatched by name from `runner` for the active engine, so they're not removable until a second provider exists. Marking as low.
- **Fix sketch**: Leave intact (intentional abstraction boundary for future Codex/Ollama). At minimum, remove `#[allow(unused_imports)]` on `tauri::Emitter` at provider/mod.rs:7 if finding #1's `load_engine_kind_notified` is wired up.

## 8. `EXECUTION_RETENTION_MONTHS_PREFIX` and `FILE_WATCHER_DEBOUNCE_MS_DEFAULT` are dead

- **Severity**: low
- **Category**: dead-code
- **File**: `src-tauri/src/db/settings_keys.rs:60-61` and `settings_keys.rs:77-81`
- **Scenario**: Both keys are declared `#[allow(dead_code)]`. Grep shows no production caller for `EXECUTION_RETENTION_MONTHS_PREFIX` (only the prefix definition and its own allow-listing in `ALLOWED_PREFIXES`); `FILE_WATCHER_DEBOUNCE_MS_DEFAULT` is referenced only by the key's `validate_value` arm — the default is never read because nothing falls back to it.
- **Root cause**: Speculative additions for features that did not ship (per-persona execution retention overrides; configurable file-watcher debounce window).
- **Impact**: ~10 LOC of dead constants + the noise of `#[allow(dead_code)]` on a security-relevant allowlist file. Risk is that the prefix appears in `ALLOWED_PREFIXES` so a stray write to `execution_retention_months:<id>` would be accepted by `validate_key` but never read back — silent data loss.
- **Fix sketch**: Delete both keys plus the `EXECUTION_RETENTION_MONTHS_PREFIX` entry from `ALLOWED_PREFIXES` (line 207). If per-persona retention is still on the roadmap, file an issue rather than carrying placeholder constants.

## 9. `cli_engine` setting is read-only — there is no writer

- **Severity**: low
- **Category**: dead-code
- **File**: `src-tauri/src/db/settings_keys.rs:37` and `src/features/settings/sub_engine/components/EngineCapabilityBadge.tsx:24`
- **Scenario**: `CLI_ENGINE` is in the settings allowlist and is read at three production sites (`runner/mod.rs:449`, `provider/mod.rs:198`, `provider/mod.rs:215`, plus `commands/infrastructure/system/health.rs:67,156`), plus the badge `useAppSetting('cli_engine', 'claude_code')`. There is no UI that calls `setAppSetting('cli_engine', ...)` — verified via grep on the TS surface. Since `EngineKind::ALL` only contains `ClaudeCode` and `EngineKind::from_setting` falls back to `ClaudeCode` on any unrecognised input, the setting can never carry a meaningful value.
- **Root cause**: Same Codex-removal residue as findings #1 and #7. The reader code path remained when the writer (engine picker UI) was deleted.
- **Impact**: A code path that always resolves to `ClaudeCode` regardless of the stored value. `EngineCapabilityBadge.tsx:28`'s `(engineSetting.value || 'claude_code') as CliEngine` cast is meaningless — `CliEngine` only has one variant.
- **Fix sketch**: Until a second engine ships, simplify `EngineCapabilityBadge.tsx` to drop the `useAppSetting` read and assume `claude_code`. Leave `CLI_ENGINE` in the allowlist (the legacy `codex_cli` → `ClaudeCode` mapping at `provider/mod.rs:106` still handles forward-migration from old installs). Revisit when a real second engine returns.

## 10. `MAX_SETTING_VALUE_SIZE` is duplicated between command boundary and undocumented backend default

- **Severity**: low
- **Category**: duplication
- **File**: `src-tauri/src/commands/infrastructure/settings.rs:12` (constant) and `src-tauri/src/commands/infrastructure/settings.rs:66-72` (single use)
- **Scenario**: The 64 KB ceiling is declared at the command layer only; the repo `settings::set` (db/repos/core/settings.rs:40-54) accepts arbitrarily large values. Internal callers that bypass the Tauri command (e.g. `ByomPolicy::save` → `settings::set` at engine/byom.rs:277, `quality_gate::save`) are not subject to the limit. The module doc at settings_keys.rs:248-250 even claims "the 64 KB limit is enforced separately at the command layer," confirming the gap.
- **Root cause**: The size check was added at the command boundary as a defence against pathological IPC payloads but never promoted to the repo invariant.
- **Impact**: A malformed `ByomPolicy` or `QualityGateConfig` that serialises to >64 KB would be rejected via IPC but accepted via internal callers, then fail to round-trip through `get_app_setting` (which has no size limit either). Inconsistent contract.
- **Fix sketch**: Move `MAX_SETTING_VALUE_SIZE` into `db::repos::core::settings` and enforce it inside `set` after `validate_value`. Remove the command-layer check (or thin it to a redundant fast-path).

## 11. `PROVIDER_OPTIONS` is derived twice from `EngineKind`/`CliEngine`

- **Severity**: low
- **Category**: duplication
- **File**: `src/features/settings/sub_byom/libs/byomHelpers.ts:12-20` and `src/features/settings/sub_engine/libs/engineCapabilities.ts:93-95`
- **Scenario**: Two parallel provider-option arrays exist for two BYOM-adjacent settings pages: `byomHelpers.ts` builds `PROVIDER_OPTIONS: ProviderOption[]` from the `EngineKind` binding (id `claude_code`, label `'Claude Code'`); `engineCapabilities.ts` builds `PROVIDERS: ProviderMeta[]` keyed on `CliEngine` (id `claude_code`, label `'Claude Code CLI'`, shortLabel `'Claude'`). They describe the same provider with slightly different label text and slightly different shapes.
- **Root cause**: Each settings sub-feature defined its own copy independently. The labels diverged because BYOM uses `Claude Code` (user-facing routing rule rendering) and the engine matrix uses `Claude Code CLI` / `Claude` (capability matrix header).
- **Impact**: Two arrays to keep in sync when a second provider arrives, plus an inconsistency in user-facing naming across two adjacent settings tabs. Low priority while only one provider exists, but the divergence is already concrete.
- **Fix sketch**: When a second `EngineKind` variant lands, consolidate into a single `PROVIDER_REGISTRY` in `src/lib/types/types.ts` (or a new `src/lib/providers/registry.ts`) with `{ id, label, shortLabel, byomEnabled }` fields, and have both `PROVIDER_OPTIONS` and `PROVIDERS` derive from it. Filing as low — not worth refactoring while only `claude_code` exists.
