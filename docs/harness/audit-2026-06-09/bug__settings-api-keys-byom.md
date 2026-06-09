# Bug Hunter — settings-api-keys-byom
> Total: 5
> Severity: 0 critical, 2 high, 3 medium

## 1. Credential export silently drops un-decryptable fields, then reports success
- **Severity**: high
- **Category**: silent-failure / data-loss / success-theater
- **File**: src-tauri/src/commands/core/data_portability.rs:2094 (standalone export), :1853 (unified bundle export)
- **Scenario**: A user clicks "Export Credentials" to back up their vault. One credential's fields can't be decrypted (OS keyring rotated, machine re-imaged, corrupt `iv`, or a partial migration). `cred_repo::get_decrypted_fields(pool, cred).unwrap_or_default()` swallows the error and yields an **empty** `HashMap`. That credential is written into the encrypted bundle as an entry with zero fields. `export_credentials` / `export_full` then return `Ok(true)`, the UI shows "success", and `handleCredExport` sets `credExportStatus = 'success'`.
- **Root cause**: `unwrap_or_default()` treats "could not decrypt this secret" as "this secret is empty". A backup feature must never silently substitute empty data for a read failure — the failure is exactly the case where the user most needs the warning.
- **Impact**: data loss disguised as a successful backup. The user later restores from the bundle and discovers the secret is gone, with no record that it was ever missing. For a credential-vault export this is the worst possible failure mode.
- **Fix sketch**: propagate the decrypt error — `get_decrypted_fields(...)?` — or, to keep the export resilient, collect per-credential failures into `result.warnings` / a non-`Ok(true)` return and surface them in the UI ("3 credentials could not be decrypted and were NOT included"). Never let an entry be exported with silently-zeroed fields.

## 2. External API key scopes are not validated against an allow-list
- **Severity**: high
- **Category**: state-corruption / privilege-scoping
- **File**: src-tauri/src/commands/credentials/external_api_keys.rs:18-23; src-tauri/src/db/repos/resources/external_api_keys.rs:53-67
- **Scenario**: `create_external_api_key(name, scopes: Vec<String>)` passes `scopes` straight to `repo::create`, which `serde_json::to_string(&scopes)`-serialises them verbatim into the `scopes` column. The only thing constraining scopes to the three known values (`personas:build|read|execute`) is the React `AVAILABLE_SCOPES` list in `CreateApiKeyDialog.tsx`. A direct IPC call (compromised renderer, plugin webview, the documented test-automation HTTP bridge) can mint a key carrying any string, including a privileged scope that does not exist yet but that future `require_api_key` middleware will honour the day it ships.
- **Root cause**: trust placed in the frontend allow-list; the backend treats the scope set as free-form text. Authorization tokens must be validated where they're minted, not where they're picked.
- **Impact**: security — silent privilege escalation / scope forgery for the management HTTP API. A key issued today with an unrecognised scope sits dormant until a code change starts trusting it.
- **Fix sketch**: define a canonical `KNOWN_SCOPES` set in Rust and reject `create` if any requested scope is not a member (`AppError::Validation`). Make unknown scopes impossible to persist, so the middleware can never be surprised by one.

## 3. Embedded-credential decrypt writes secrets to the WRONG shell on duplicate name+service_type
- **Severity**: medium
- **Category**: state-corruption
- **File**: src-tauri/src/commands/core/data_portability.rs:1958-1964
- **Scenario**: `apply_encrypted_credentials` locates the import shell via `existing.iter().find(|c| c.name == "{name} (imported)" && c.service_type == ...)` — first match wins. `persona_credentials` has **no UNIQUE constraint** on `name` (schema.rs:160). If the user imports the same bundle twice, or already had a credential literally named `"Foo (imported)"` with the same `service_type`, multiple shells match and the decrypted secrets are `INSERT OR REPLACE`d into whichever row `.find()` returns first — not necessarily the shell `import_bundle` just created.
- **Root cause**: name+service_type is treated as a unique key for matching, but the schema does not enforce uniqueness and the import deliberately appends a non-unique `" (imported)"` suffix, guaranteeing collisions on re-import.
- **Impact**: corruption — real secrets land on the wrong credential; the intended new shell stays empty. Hard to detect because both rows look plausible.
- **Fix sketch**: thread the freshly-created shell IDs out of `import_bundle` (it already builds `id_mapping`) and match by stable ID instead of `(name, service_type)`. Failing that, refuse to apply when more than one shell matches and emit a warning.

## 4. Credential-import conflict detection is case-insensitive but resolution lookup is case-sensitive
- **Severity**: medium
- **Category**: edge-case / silent-failure
- **File**: src-tauri/src/commands/core/data_portability.rs:2291 / 2318 / 2321
- **Scenario**: First pass detects conflicts by `entry.name.to_lowercase()` against `existing_names` (also lowercased). Second pass looks up the user's chosen action with `resolutions.get(&entry.name)` — **exact case**. Bundle entry `"MyKey"` conflicts with existing `"mykey"`; the conflict UI receives `name: "MyKey"` and echoes a resolution keyed `"MyKey"`, which matches — but the moment any layer normalises casing (or the bundle has `"Mykey"` vs the conflict reported as `"MyKey"`), `resolutions.get` misses, the entry falls into the `_ =>` "no resolution needed" branch, and a duplicate is created under the original name. Because there is no UNIQUE constraint, this is a silent duplicate rather than a loud error.
- **Root cause**: two different equality definitions (case-insensitive for detection, case-sensitive for resolution) for the same logical key.
- **Impact**: UX degradation / state-corruption — a "replace" the user explicitly chose silently becomes a second copy; the old credential survives alongside it.
- **Fix sketch**: normalise the resolution key the same way as the conflict key (`resolutions.get(&entry.name.to_lowercase())`, with the map built lowercased), so detection and resolution share one comparison rule.

## 5. LiteLLM base_url accepts any http(s) URL with no host validation; provider auth token serialised toward the renderer
- **Severity**: medium
- **Category**: SSRF (latent) / secret-leak
- **File**: src-tauri/src/engine/config_merge.rs:51-52 & 247-264 (auth_token/base_url fields); src-tauri/src/engine/runner/globals.rs:33-40 (base_url applied from `LITELLM_BASE_URL`)
- **Scenario**: `ByomApiKeyManager.tsx` validates the LiteLLM Base URL to http/https only — but that is the *frontend* guard on the `litellm_base_url` setting. A model-profile `base_url` set via the engine/global path is merged in `resolve_effective_config` with **no scheme/host check** and flows into `runner/mod.rs` as the provider base URL; `resolve_global_provider_settings` pulls `LITELLM_BASE_URL` straight from settings. Today `apply_provider_env` (cli_args.rs:24) is a no-op, so no request is actually issued — the SSRF is dormant — but the field is already plumbed and the next provider that consumes it inherits an unvalidated, attacker-influenceable URL (internal metadata endpoints, link-local). Separately, `EffectiveModelConfig` is `#[ts(export)]` with `auth_token: ConfigField<String>` holding the resolved LiteLLM master key / Ollama key, so the config-resolution IPC serialises the plaintext provider secret toward the renderer.
- **Root cause**: URL trust is enforced only in one UI entry point, not at the single merge point every caller passes through; the secret-bearing config struct has no `skip_serializing` on `auth_token` (contrast `ExternalApiKey.key_hash`, which correctly does).
- **Impact**: security — latent SSRF the moment a provider wires `base_url` into an outbound request, plus a provider-secret exposure to the webview where any XSS/malicious-plugin context can read it.
- **Fix sketch**: validate base_url (allow only http/https, reject link-local / metadata hosts) inside `resolve_effective_config` so every tier passes through one check; mark `auth_token` `#[serde(skip_serializing)]` / `#[ts(skip)]` on `EffectiveModelConfig` and return a presence boolean instead of the secret.
