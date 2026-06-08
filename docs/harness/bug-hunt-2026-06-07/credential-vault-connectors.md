# Bug Hunter — credential-vault-connectors
> Total: 6
> Critical: 2 · High: 3 · Medium: 1 · Low: 0

This audit covered the Rust crypto core (`engine/crypto.rs`), credential CRUD
commands + repo (`commands/credentials/*`, `db/repos/resources/credentials.rs`),
connector readiness (`commands/design/connector_readiness.rs`), the connector /
credential models, and the TS frontend (`api/vault/credentials.ts`,
`stores/slices/vault/credentialSlice.ts`, `lib/utils/platform/crypto.ts`, the
vault sub_credentials / sub_catalog components).

The crypto primitives themselves are sound (random 12-byte nonces per encrypt,
GCM AEAD verified by tests, zeroize-on-drop, mlock, DPAPI). The high-severity
bugs are in the *trust boundaries around* the crypto: a documented-vs-actual
inversion of the fail-closed switch, an attacker-plantable master key on Unix,
unverified "healthy/ready" claims, and an attacker-selectable weaker decrypt
path.

---

## 1. Master-key fallback is fail-OPEN by default, contradicting its own doc and error message
- **Severity**: Critical
- **Category**: crypto / silent-failure
- **File**: `src-tauri/src/engine/crypto.rs:428-469` (gate at `442-457`)
- **Scenario**: On a machine where the OS keychain is momentarily unavailable
  (locked GNOME keyring, no Secret Service daemon, corrupted credential store, a
  transient keyring API error at first launch), the very first call to
  `get_master_key()` enters the `Err(e)` arm. Because the only opt-out is
  `PERSONAS_DENY_FALLBACK_KEY=1` (which almost nobody sets), the code silently
  generates/loads a DPAPI/local-file fallback key and caches it in the
  `OnceLock` for the whole process. The vault is now keyed to a local file, not
  the keychain — permanently for that run, and the credentials written under it
  are no longer recoverable via the keychain key.
- **Root cause**: The doc comment (`419-427`) and the returned error string
  (`464-468`, "Set `PERSONAS_ALLOW_FALLBACK_KEY=1` to allow local fallback")
  describe an **opt-in, fail-closed** policy. The implementation does the
  opposite: it falls back **unless** an *opt-out* (`PERSONAS_DENY_FALLBACK_KEY`)
  is set, and never reads `PERSONAS_ALLOW_FALLBACK_KEY` at all. Default behavior
  is fail-open. An operator who reads the error and sets the documented
  `ALLOW` var gets exactly nothing; an operator who wants strict mode would
  never guess the undocumented `DENY` var.
- **Impact**: security — a transient keychain hiccup silently downgrades vault
  protection to a local file with no user signal, and the documented hardening
  switch is a no-op. The cached `OnceLock` means a single bad first-call sticks
  for the session.
- **Fix sketch**: Make the env contract match the documented fail-closed intent:
  treat fallback as opt-in (`PERSONAS_ALLOW_FALLBACK_KEY=1`), return `Err`
  otherwise, and *read the variable the error message names*. Encode the policy
  in one enum (`FallbackPolicy::{Deny, Allow}`) parsed once, so the doc,
  the error text, and the branch can never diverge again. Surface
  `key_source == LocalFallback` prominently in `vault_status` (it is already
  there) and warn in the UI when a fallback occurred unexpectedly.

## 2. Unix fallback accepts a raw 32-byte file as the master key — attacker can plant a known key
- **Severity**: Critical
- **Category**: crypto / validation-gap
- **File**: `src-tauri/src/engine/crypto.rs:860-869` (`platform_unprotect`), with `571-654` (`load_local_fallback_key`)
- **Scenario** (non-Windows desktop/CI/headless): An attacker with write access
  to `$APPDATA|$HOME/com.personas.desktop/` drops a `master.key` file whose
  contents are either (a) plain base64 of 32 known bytes (no `DPAPI:` prefix),
  or (b) `DPAPI:` + base64 of exactly 32 bytes. On next launch
  `load_local_fallback_key` decodes it; for case (b) `platform_unprotect`
  matches `data.len() == 32` and **returns the bytes as-is** ("Detected
  unencrypted fallback key data, returning as-is for migration",
  `863-866`); for case (a) the no-prefix branch (`628-632`) base64-decodes it as
  "legacy plaintext". Either way the attacker now controls the AES-256-GCM
  master key. Every credential the user subsequently enters is encrypted under
  a key the attacker knows, and any existing vault re-keyed to the planted key
  is readable by them.
- **Root cause**: A migration convenience — "any 32-byte blob is probably a
  legacy raw key" — is a permanent, unconditional acceptance branch with no
  authentication. There is no MAC/marker distinguishing a legitimately-migrated
  legacy key from an attacker-planted one, and the `restrict_file_permissions`
  hardening only constrains files *this app writes*, not files an attacker plants
  before first launch.
- **Impact**: security — full credential-vault compromise on Unix from a single
  file write, with no integrity check.
- **Fix sketch**: Remove the unconditional "32 bytes = raw key" acceptance. Gate
  legacy-plaintext import behind an explicit one-time `PERSONAS_MIGRATE_LEGACY_KEY=1`
  run that logs loudly, and require the migrated file to be immediately
  re-written in authenticated (AES-GCM, which already MACs) form. Reject any
  fallback file that is not in the current authenticated format and whose
  provenance flag is absent — fail closed rather than trusting unauthenticated
  bytes on the key path.

## 3. `create_credential` trusts a client-supplied `healthcheck_passed`, writing "Connection verified" with no verification
- **Severity**: High
- **Category**: silent-failure / validation-gap
- **File**: `src-tauri/src/commands/credentials/crud.rs:57,72-84`; frontend `src/stores/slices/vault/credentialSlice.ts:55,124-137`
- **Scenario**: Any IPC caller (the catalog "auto setup" flow, a custom script,
  a compromised renderer) calls `create_credential` with
  `healthcheckPassed: true` while supplying credential data that was never
  actually probed — or that is empty/garbage. The backend takes the flag at face
  value (`let healthcheck_passed = input.healthcheck_passed.unwrap_or(false)`)
  and, when true, calls `append_healthcheck_metadata(.., true, "Connection
  verified during setup")`. The credential now shows a green/healthy state and
  `healthcheck_last_success = true` in its ledger despite no probe ever running.
- **Root cause**: The "was this credential tested before saving?" signal is
  carried as a client boolean across the IPC boundary instead of being a
  server-side fact. The command layer treats a UX hint as ground truth for a
  security-relevant readiness claim.
- **Impact**: security/UX — false "healthy" badges; downstream readiness and
  rotation logic (and the user) believe a credential works when it may be
  invalid, so the persona silently fails at runtime instead of at setup.
- **Fix sketch**: Don't accept `healthcheck_passed` as a writable input. Either
  (a) require the caller to pass the *same session-encrypted field values* and
  re-run `run_healthcheck_with_fields` server-side before stamping success, or
  (b) make the catalog flow call `healthcheck_credential` after create so the
  success record is produced by an actual probe. The ledger should only ever be
  stamped `true` by code that ran the probe.

## 4. Connector readiness reports "Ready" on mere credential-row existence — empty/broken creds promote a persona
- **Severity**: High
- **Category**: edge-case / silent-failure
- **File**: `src-tauri/src/commands/design/connector_readiness.rs:275-288, 393-437`
- **Scenario**: A `Credential`-class connector (e.g. `notion`) is judged `Ready`
  iff `resolve_one_credential` returns `Some` (`283`). `resolve_one_credential`
  returns the first/only `persona_credentials.id` whose `service_type` matches —
  it never inspects `credential_fields`. A credential created with empty data
  (`createCredential` accepts `data: {}` → `field_map` empty → zero field rows),
  with a since-revoked API key, or with a failing last healthcheck, still
  satisfies the bind. The persona is promoted "ready"/runnable and then executes
  with no usable secret.
- **Root cause**: The "Phase 2" redesign tightened readiness from "a credential
  of this kind exists" to "*uniquely bindable* to one credential" — but
  "bindable" still means only "a row exists with this service_type". It conflates
  *the existence of a credential record* with *the credential being usable*
  (non-empty required fields + last healthcheck not failing). The
  comment even warns "a persona promoted with an unbindable connector executes
  blind" — yet a bound-but-empty credential is exactly that.
- **Impact**: silent corruption of the readiness gate — personas pass adoption /
  promote and fail at runtime, the precise class of disagreement this resolver
  was built to eliminate.
- **Fix sketch**: In `resolve_one_credential` (or a wrapper used only by the
  readiness path), additionally require that the candidate credential has the
  connector schema's required fields present and non-empty, and that
  `healthcheck_last_success != Some(false)`. Treat zero-field or
  last-healthcheck-failed credentials as not bindable for *readiness* (they may
  still be selectable for editing). Add a test: connector with a credential that
  has no field rows must be `NeedsSetup`, not `Ready`.

## 5. Legacy plain-RSA IPC decrypt is attacker-selectable and fails *open* to the weaker primitive
- **Severity**: High
- **Category**: crypto / secret-leak
- **File**: `src-tauri/src/engine/crypto.rs:80-154` (dispatch at `81`, legacy arm `129-153`)
- **Scenario**: `SessionKeyPair::decrypt` chooses the legacy plain-RSA-OAEP path
  for *any* payload that contains no `.` separator. The separator is entirely
  attacker/frontend-controllable: a malicious or downgraded renderer (or an
  attacker who can craft an IPC message) sends credential payloads with no `.`,
  forcing every `create_credential` / `update_credential` /
  `update_credential_field` / `healthcheck_credential_preview` decrypt down the
  weaker, unauthenticated-transport RSA-only branch instead of the hybrid
  RSA+AES-GCM path. The code's only response is a counter bump and a
  `tracing::warn!` — it still decrypts and proceeds.
- **Root cause**: A migration/compat fallback is keyed on a structural property
  of attacker-controlled input rather than on an authenticated capability or
  negotiated version. "Be liberal in what you accept" is applied to a security
  primitive, so the system fails open to the weaker mode on demand. The
  retirement plan (delete after the counter stays at zero) presumes only honest
  callers ever hit it, which an adversary trivially violates to keep it alive.
- **Impact**: security — an attacker can force the weaker decrypt path for all
  credential writes (and keep the "should we delete it yet?" telemetry pinned
  above zero so it is never retired).
- **Fix sketch**: Gate the legacy branch behind a build/runtime feature flag that
  defaults OFF (e.g. `PERSONAS_ALLOW_LEGACY_IPC=1`), and when off return
  `CryptoError::Decrypt("legacy IPC payload rejected")` for separator-less
  payloads — exactly the planned end-state, just enforced now. The hybrid path
  is the only one the current frontend emits, so flipping the default closed is
  safe and removes attacker selectability.

## 6. `vault_status` permanently reports credentials with only non-sensitive fields as "plaintext"
- **Severity**: Medium
- **Category**: silent-failure / edge-case
- **File**: `src-tauri/src/db/repos/resources/credentials.rs:122-144`; surfaced via `src-tauri/src/commands/credentials/crud.rs:329-343`
- **Scenario**: A credential whose connector schema marks every field
  non-sensitive (e.g. a connector with only `base_url` / `host` / `region`, all
  in `NON_SENSITIVE_KEYS`) is stored with every `credential_fields.iv = ''`. In
  `count_vault_status`, `encrypted` counts only `DISTINCT credential_id` with
  `iv != ''`, so this credential is never counted as encrypted; `plaintext =
  total - encrypted` therefore counts it as plaintext **forever**. The
  `migrate_plaintext_credentials` / `assure_sensitive_fields_encrypted` passes
  correctly skip it (it has nothing sensitive to encrypt), so the status never
  converges to zero.
- **Root cause**: "Encrypted" is defined as "has at least one sensitive
  (`iv != ''`) field", which is not the same as "fully protected". A credential
  that legitimately has no secrets is mislabeled as an unencrypted/at-risk row,
  and the migration that would "fix" it is (correctly) a no-op, so the warning
  is permanent.
- **Impact**: UX degradation / success-theater inverse — the vault status panel
  shows a non-zero "plaintext" count that no user action can clear, eroding
  trust and masking genuinely-unencrypted rows in the same count.
- **Fix sketch**: Define `plaintext` as "has at least one field that *should* be
  sensitive but is stored with `iv = ''`" — i.e. join `credential_fields`
  against the connector sensitivity schema (`is_sensitive = 1 AND iv = ''`),
  mirroring the `assure_sensitive_fields_encrypted` query — rather than the
  blanket `total - (rows with any encrypted field)`. Credentials with no
  sensitive fields then correctly report as fully protected.
