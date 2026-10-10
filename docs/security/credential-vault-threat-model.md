# Credential vault: threat model

> Written 2026-10-10 from the code, not from the README. Every claim cites the file and line it was
> read from at that date. **Re-read the cited line before you rely on a claim**: this repo's guidance
> has a long record of prose that outlived its code (see `.claude/CLAUDE.md`). The boundaries in
> section 7 that a text check can carry are checked against the source on every `npm test` (see the
> end of section 7); the rest of this file is not. A human security review of this document is owed;
> it was written by an agent.

This is the boundary map for the code that holds users' third-party secrets: API keys, OAuth tokens,
database passwords. It says what is protected, from whom, where the protection actually sits, and
which lines an agent editing these paths must not cross. It is not a list of everything the vault
does.

## 1. Assets

| Asset | Where it lives | Protection |
|---|---|---|
| **Master key** (32 bytes, AES-256) | OS keychain, service `personas-desktop`, account `credential-master-key` (`src-tauri/core/src/crypto.rs:569`) | OS keychain ACL |
| Master key, fallback copy | `$APPDATA` (or `$HOME`) `/com.personas.desktop/master.key` (`crypto.rs:653-659`) | DPAPI on Windows (`crypto.rs:887-890`); on Unix, AES-256-GCM under an HKDF key from a random `local.secret` + machine-id + UID (`crypto.rs:938-965`). File restricted to the current user before it becomes visible (`crypto.rs:784-799`) |
| Master key, in process | `static KEY_STORE: OnceLock<ProtectedKey>` (`crypto.rs:505`) | `Zeroizing<[u8;32]>` + `VirtualLock`/`mlock` so it is not paged to swap (`crypto.rs:319-361`). Lives for the **whole process**, by design |
| **Credential secrets at rest** | SQLite `credential_fields`, one row per field, `(encrypted_value, iv)` | AES-256-GCM, random 96-bit nonce per write (`crypto.rs:1244-1256`). A field with an empty `iv` is plaintext (`crypto.rs:1281-1284`, `1290-1306`) |
| IPC session token | `static IPC_SESSION_TOKEN` (`src-tauri/src/ipc_auth.rs:41`), and **also `window.__IPC_TOKEN` in the webview** (`ipc_auth.rs:697-698`) | 32 CSPRNG bytes per launch (`ipc_auth.rs:54-59`) |
| IPC session RSA key pair | `AppState.session_key` (`src-tauri/src/state.rs:48`), generated at boot (`src-tauri/src/boot/mod.rs:168`) | 2048-bit RSA-OAEP, memory only, new each launch (`crypto.rs:24-47`) |
| OAuth tokens mid-flow | Session maps, as `EncryptedToken` (`crypto.rs:276-307`) | Sealed with the master key; unsealed only into a `SecureString` at the moment of use |

## 2. Where a decrypted secret lives, and for how long

1. **Inbound from the UI.** The renderer encrypts a new secret with the session public key
   (`get_session_public_key`, `src-tauri/src/commands/credentials/crud.rs:31`). The backend
   decrypts it inside the command (`crud.rs:44`, `152`, `406`, `546`) into an ordinary `String`,
   parses it into a field map (`crud.rs:56`) and re-encrypts it per field for SQLite. The plaintext
   lives for one command invocation, in a `String` that is **not** zeroized.
2. **Outbound to a third party.** The API proxy decrypts every field of a credential
   (`src-tauri/src/engine/api_proxy.rs:664`), writes a decrypt audit row (`api_proxy.rs:666-675`),
   attaches the auth and sends the request. The plaintext lives for one request.
3. **OAuth.** Tokens are sealed on receipt and unsealed only at use (`crypto.rs:276-307`); a create
   that completes an OAuth flow redeems the tokens server-side from a session ref, so **they never
   cross IPC** (`crud.rs:59-72`).
4. **`SecureString`** (`crypto.rs:220-270`) zeroizes on drop, prints `[REDACTED]`, and deliberately
   has no `Serialize`, so a struct holding one cannot be sent over IPC by accident. It is used in
   the OAuth paths (`oauth.rs` `expose_secret()` sites). It is **not** used by the field-map paths
   in (1) and (2): those hold plain `String`s and depend on short lifetimes, not zeroization.

**What this does not protect against.** An attacker who can read this process's memory while it
runs gets the master key (it is resident for the process lifetime), and any secret that is in use at
that moment. `mlock` keeps the key out of swap and crash dumps. It does not keep it from a debugger.

## 3. Trust boundaries

```
 third-party API  <--- api_proxy / connectors (secrets leave here, attached to requests)
        ^
 [ Rust backend: master key, decrypt, audit ]  <-- the ONLY place plaintext should exist
        ^  IPC (Tauri invoke)
 [ Webview: React app + every plugin/companion UI that runs in it ]
        ^
 user
```

### 3.1 The IPC gate, and what it really keeps out

There are three tiers (`ipc_auth.rs:1-27`). A **privileged** command needs an `x-ipc-token` header
that matches the session token, checked in constant time by the invoke wrapper **before dispatch**
(`ipc_auth.rs:610-660`).

- **The token is in the webview's global scope** (`window.__IPC_TOKEN`, `ipc_auth.rs:697-698`), and
  the wrapper patches `__TAURI_INTERNALS__.invoke` so that every call carries it
  (`ipc_auth.rs:699-731`). **So any script running in the main webview can call any privileged
  command.** That includes a plugin, a rendered markdown payload that achieved script execution, or
  a compromised dependency. The token keeps out callers that have no access to the main window's
  globals. It does not separate the app's own code from other code running inside it. Inside the
  webview, the CSP is the boundary that counts (`check:csp-hosts` gates its host list).
- **The wrapper is the only gate that authorizes.** `#[requires(privileged)]` on an **async**
  command expands to `require_privileged` (`src-tauri/macros/src/lib.rs:75-79`). That function only
  checks that the token is *initialised* and logs; it does not authorize (`ipc_auth.rs:534-555`).
  The sync guard does check the thread-local flag the wrapper sets (`ipc_auth.rs:440-467`). So an
  async command is protected only if its name is in `PRIVILEGED_COMMANDS` (`ipc_auth.rs:117`). The
  comment at `ipc_auth.rs:118-119` records that being absent from that list "is ZERO enforcement".
- **Deliberate exclusions that move secret-adjacent commands to the public tier.** This is the
  known, owned risk. Each is excluded because the WebView2 header race makes the wrapper check fail
  intermittently:
  - `execute_api_request`, `get_api_proxy_metrics` and `save_api_definition`
    (`ipc_auth.rs:256-267`). `execute_api_request` makes an **authenticated request with any stored
    credential**, to any path under that credential's base URL, and returns the full response body.
  - `export_credentials`, `import_credentials`, `export_full` and `import_portability_bundle`
    (`ipc_auth.rs:418-426`).
  - The tier ledger test lists these as "deliberate" or "OWED" (`ipc_auth.rs:1092-1123`).
- **Public by design:** `list_credentials` (`crud.rs:22-28`), `vault_status` (`crud.rs:475-489`)
  and `list_credential_fields` (`crud.rs:510-532`). They return metadata, never field values;
  `list_credential_fields` explicitly omits the value (`crud.rs:518-530`).

### 3.2 Which commands could exfiltrate a secret if a plugin misused them

"Exfiltrate" here means "cause the plaintext, or its effect, to leave the machine or reach the
renderer".

| Command | Tier today | How it could be misused |
|---|---|---|
| `execute_api_request` (`commands/credentials/api_proxy.rs:35-54`) | public at the wrapper (see 3.1) | Spends the credential against its own service. The host is fixed by the credential's base URL (`engine/api_proxy.rs:678-711`, joined by `build_full_url` at `:36-44`) and SSRF-validated unless the connector opted into private networks (`:750-760`). An endpoint that echoes request headers would return the secret in the response body |
| `export_credentials` / `export_full` | public at the wrapper | Bulk export of the vault. Sealing for export is in `src-tauri/src/commands/core/data_portability/sealing.rs` |
| `browser_sites_bind_credential` | privileged (`ipc_auth.rs:408`) | Points a stored credential at a web origin the browser agent can drive |
| `create_credential` / `update_credential` / `update_credential_field` | privileged | Overwrite a secret (integrity, not confidentiality) |
| `healthcheck_credential` / `healthcheck_credential_preview` | privileged | Sends the secret to its service's healthcheck URL |

## 4. Audit and the signals that say the vault is degraded

`vault_status` (`crud.rs:475-489`) is the one public read of vault health, rendered by
`VaultTrustBadge`. It reports:

- `key_source`: `keychain`, `local_fallback` or `unknown` (`crypto.rs:1207-1214`). `local_fallback`
  means the key is protected by DPAPI or the Unix file key, not by the keychain.
- `plaintext`: credential rows still stored without an `iv`. The startup migration encrypts them in
  one transaction (`crypto.rs:1312-1316`).
- `legacy_ipc_decrypt_calls` (`crypto.rs:172-181`): hits on the RSA-only IPC branch. That branch is
  **rejected by default** and honoured only with `PERSONAS_ALLOW_LEGACY_IPC=1` (`crypto.rs:130-149`).
- `credential_audit_write_failures` (`crypto.rs:183-202`): decrypts that happened with **no audit
  row**. Decryption deliberately never blocks on audit failure, so this counter is the only trace of
  that gap.

## 5. Fail-closed switches (environment variables)

| Variable | Default | When set |
|---|---|---|
| `PERSONAS_ALLOW_FALLBACK_KEY` | off: no keychain means **no vault** (`crypto.rs:449-470`, `523-532`) | Use the local fallback key (CI, headless, tests) |
| `PERSONAS_MIGRATE_LEGACY_KEY` | off: an unauthenticated key file is refused (`crypto.rs:472-481`, `723-734`, `905-917`) | Import a legacy plaintext key once, then re-write it authenticated |
| `PERSONAS_ALLOW_LEGACY_IPC` | off: RSA-only IPC payloads are rejected (`crypto.rs:139-149`) | Accept them during a migration window |

Each default was flipped from fail-open after a bug hunt (2026-06-07 #1, #2, #5, cited inline).
**Defaulting any of them back to permissive is a security regression, not a convenience fix.**

## 6. Recovery

- **Keychain entry lost, fallback file present.** `try_keychain` loads the fallback file and
  backfills the keychain (`crypto.rs:589-597`). No data is lost.
- **Keychain entry and fallback file both lost.** A **new random key is generated**
  (`crypto.rs:599-610`), and every existing `credential_fields` row then fails AES-GCM
  authentication on decrypt (`crypto.rs:1272-1275`). **The ciphertext is unrecoverable by design.**
  Users must re-enter their credentials. Restore the old key, or a backup that holds it, before the
  app writes new secrets under the new key. The key is never written into the database.
- **Keychain temporarily unavailable at boot.** The failure is **not cached**; a later call retries
  (`crypto.rs:499-504`, `1225-1228`). Do not "fix" this by caching a `Result` in a `OnceLock`
  (`.claude/rules/rust-backend.md` forbids it for exactly this reason).
- **Fallback file has the wrong permissions.** The app tries an additive ACL repair; if that fails it
  **deletes the file** and generates a fresh key (`crypto.rs:674-700`). If the keychain does not
  also hold the key, that is the second case above.
- **SQLite corruption.** The vault inherits the database's recovery story. Field rows are
  self-contained (ciphertext plus its own nonce), so any row that survives a restore decrypts under
  the same master key. A restore must keep the master key that wrote the backup.

## 7. Boundaries an agent must not cross

1. **Never return a decrypted field value from a `#[tauri::command]`.** The renderer is not a trust
   boundary (3.1). New UI needs `has_value` / masked metadata, as `list_credential_fields` does.
2. **Never log plaintext, and never put it in an `AppError` message.** Error text reaches the
   renderer and Sentry. Wrap secrets in `SecureString`, whose `Debug` / `Display` redact.
3. **Never add `Serialize` to `SecureString` or `EncryptedToken`** (`crypto.rs:268-270`).
4. **A new secret-touching async command goes into `PRIVILEGED_COMMANDS`.** `#[requires(privileged)]`
   alone does not authorize an async command (3.1). If the WebView2 race forces an exclusion, record
   it in the tier ledger (`ipc_auth.rs:1092-1123`) and flag it for human review.
5. **Never flip a fail-closed default in section 5**, and never add a new fallback that reads a key
   from a file without authentication.
6. **Never cache a key-derivation `Result`** (section 6).
7. **Every decrypt writes an audit row via `audit_log`, and must not block on that write.** A new
   decrypt path that skips the audit row is invisible to `credential_audit_write_failures`.
8. **Do not widen `execute_api_request`'s host.** The host comes from the credential, never from the
   caller's `path`. Keep `build_full_url` the single place that joins them, and keep the SSRF gate
   inside the interceptor continuation (`engine/api_proxy.rs:724-760`).

### Which of these are checked

[`vault-boundaries.json`](./vault-boundaries.json) restates this list by number, and
`src/__tests__/structural/vault-boundaries.test.ts` enforces it on every `npm test`. A failure names
the rule it guards (`rule 4: ...`), so read the matching item above before you change anything.

| Rule | Checked against the source | What fails |
|---|---|---|
| 1, 2, 7 | No (`prose-only`, each with its reason in the JSON) | Nothing. These need a data-flow or call-graph check |
| 3 | Yes | `Serialize` derived or implemented for `SecureString` or `EncryptedToken` |
| 4 | Yes | A command in `mustBePrivileged` leaves `PRIVILEGED_COMMANDS`, or a `deliberate` exclusion in the tier ledger (`DRIFT_BASELINE`) is not in `publicByDecision` and section 3.1 |
| 5 | Yes | A section 5 variable is no longer read with its closed default in `crypto.rs` |
| 6 | Yes | `OnceLock<Result<` appears in `crypto.rs` |
| 8 | Yes, for the single join point only | `build_full_url` is defined anywhere other than `engine/api_proxy.rs`, or more than once |

The test also fails when this list and the JSON disagree. Add or renumber a rule in both places, in
the same change. Editing a command list in the JSON is a security decision; flag it for human review.

Changes to these paths are security-sensitive edits under `.claude/CLAUDE.md` § PR self-review:
flag them for human review.
