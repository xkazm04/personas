# Bug Hunt Fix Wave 1 — Privileged-IPC auth gates

> 5 commits, 5 critical findings closed.
> Baseline preserved: tsc 0 errors → 0 errors; ipc_auth tests 7 pass → 7 pass (with 4 new assertions).
> 2 critical findings deferred to Wave 1B (different mental models).

## Commits

| #  | Commit       | Findings closed                                                          | Severity   | Files                                                       |
|----|--------------|--------------------------------------------------------------------------|------------|-------------------------------------------------------------|
| 1  | `948ca7df1`  | credentials-management #1 (healthcheck_credential ungated)               | critical   | src-tauri/src/commands/credentials/crud.rs, src-tauri/src/ipc_auth.rs |
| 2  | `18cc57b12`  | settings-account #1 (register_claude_desktop_mcp ungated)                | critical   | src-tauri/src/commands/infrastructure/system/mcp_integration.rs, src-tauri/src/ipc_auth.rs |
| 3  | `7e5b78a43`  | settings-account #2 (crash-log surface ungated)                          | critical   | src-tauri/src/commands/infrastructure/system/crash_telemetry.rs, src-tauri/src/ipc_auth.rs |
| 4  | `97454e721`  | artist-plugin #2 (ffmpeg-spawning commands skip auth)                    | critical   | src-tauri/src/commands/artist/ffmpeg.rs, src-tauri/src/ipc_auth.rs |
| 5  | `8bfe3cd76`  | external-integrations #2 (langfuse_test_connection SSRF + secret leak)   | critical   | src-tauri/src/commands/infrastructure/langfuse.rs, src-tauri/src/langfuse/client.rs, src-tauri/src/ipc_auth.rs |

## What was fixed (grouped by sub-pattern)

### 1. Privileged IPC commands stranded in `AuthTier::Public`

Three of the five fixes had the same shape: `#[tauri::command]` functions
that perform sensitive work (decrypt secrets, write to global host config,
spawn ffmpeg over user paths, exfil credentials) but were not in the
`PRIVILEGED_COMMANDS` allowlist, so the IPC wrapper accepted them without
a session token. The body-level guards (`require_privileged_sync` /
`require_privileged`) were also missing or — in the artist case —
present but only as `require_auth(_)` which is documented to be a no-op
placeholder.

The fix is mechanical and uniform: register the command in
`PRIVILEGED_COMMANDS`, add `state: State<'_, Arc<AppState>>` to the
function signature, and call `require_privileged_sync(&state, "<name>")?`
(or `require_privileged(...).await?` for async commands) at the top.
Async commands cannot use the `_sync` variant because the thread-local
validation flag is unreliable across tokio task migration — that's
already documented at `ipc_auth.rs:370`.

Total commands moved from `Public` → `Privileged`: **20**
(2 healthcheck + 3 claude-desktop-mcp + 7 crash-telemetry + 8 artist
ffmpeg). The two artist commands that already had a `require_auth` call
got upgraded to `require_privileged` so the body-level guard now
actually enforces something.

### 2. SSRF + scheme + DNS-rebinding defense layered behind the auth gate (Fix 5)

`langfuse_test_connection` and `langfuse_save_config` got the same
auth-gate treatment, but they additionally needed *origin* validation:
even an authenticated user can be tricked (via prompt injection in a
persona tool, for instance) into POSTing to an attacker-controlled host
that captures the Langfuse Basic-auth credentials.

The fix is three-layered, modeled on the cloud-orchestrator policy:

1. `validate_langfuse_host()` parses the URL and rejects everything except
   `https://*` and `http://localhost` / `http://127.0.0.1`. Runs *before*
   any keyring write or network I/O, so a save attempt with a bad URL
   fails closed and never deposits credentials next to a host we'd
   refuse.
2. `require_privileged(...).await?` body guard ensures only authenticated
   IPC callers reach the validator at all (defense-in-depth over the
   wrapper-level `PRIVILEGED_COMMANDS` enforcement).
3. The reqwest probe client now uses `SsrfSafeDnsResolver`, so a hostname
   that *passes* static validation but resolves to a private/loopback IP
   at request time (DNS rebinding) is dropped at the transport layer.

The static check covers the easy cases (literal `file://`, `http://10.x`,
etc.); the DNS resolver covers the hard ones.

## Verification table (before/after counters)

| Counter                              | Baseline | After Wave 1 | Delta |
|--------------------------------------|---------:|-------------:|------:|
| `npx tsc --noEmit` errors            |        0 |            0 |   0   |
| `cargo check` errors                 |        0 |            0 |   0   |
| `cargo test --lib ipc_auth::` passed |        7 |            7 |   0   |
| `PRIVILEGED_COMMANDS` entries        |    ~115  |       ~135   |  +20  |
| `command_tier` test assertions       |       12 |           16 |   +4  |
| Critical findings closed             |        0 |            5 |   +5  |

The new `command_tier` test assertions cover: `healthcheck_credential`,
`healthcheck_credential_preview`, `register_claude_desktop_mcp`,
`unregister_claude_desktop_mcp` (all asserted as `AuthTier::Privileged`).
The previous (incorrect) assertion that `healthcheck_credential` is
`Public` was removed.

## Cumulative status (waves 1-1)

| Wave | Theme                              | Closed | Notes                                    |
|------|------------------------------------|-------:|------------------------------------------|
| 1    | Privileged-IPC auth gates           |      5 | 2 of 7 originally-planned items deferred to Wave 1B (different mental models) |

Pattern catalogue: 4 items (see below).

Remaining critical themes (per INDEX.md):

- **Wave 1B (next)** — Smee inbound HMAC + `verify_document` TOCTOU
  (originally Wave 1 fixes 5 and 7; deferred because they need different
  mental models — schema work for Smee, file-handling for verify_document)
- **Wave 2** — Subprocess argv-injection + path-traversal (7 criticals)
- **Wave 3** — Execution-engine cancel/retry/tick (4 criticals)
- **Wave 4** — Idempotency on CRUD & import (5 criticals)
- **Wave 5** — Save-race / stale state in editing surfaces (5 criticals)
- **Wave 6** — Async/concurrency in IPC + chat send + onboarding (6 criticals)
- **Wave 7** — Silent-failure observability (10 criticals)

## Patterns established (additions to the catalogue, items 1-4)

1. **Two-layer auth gate pattern.** A privileged Tauri command needs *both*
   (a) inclusion in `PRIVILEGED_COMMANDS` so the IPC wrapper enforces the
   session token at command entry, and (b) a body-level
   `require_privileged_sync`/`require_privileged` call for
   defense-in-depth + audit logging. Either alone is a partial defense:
   without (a), a tunneled invoke that bypasses the wrapper succeeds;
   without (b), an audit-log gap means the command's invocation isn't
   recorded as privileged. *When it bites*: any command that reads/writes
   credentials, host config, secrets, or spawns subprocesses with
   user-supplied paths.

2. **Sync vs. async guard selection.** `require_privileged_sync` checks a
   thread-local `is_ipc_validated()` flag that becomes unreliable across
   tokio task migration. Async commands must use `require_privileged`
   (the async variant) which only checks the static
   `IPC_SESSION_TOKEN.get()` initialization. The async variant relies on
   the wrapper-level enforcement as primary; the sync variant adds a
   thread-local check as defense-in-depth that's only useful inside `pub
   fn` (non-async) commands. *When it bites*: copying the
   `require_privileged_sync` pattern verbatim into an `async` command
   works in tests but races in production under load.

3. **Validate-before-side-effect for external URLs.** When a Tauri command
   accepts a user-supplied URL that will be used as either an HTTP target
   or a credential store key, validate the URL *before* doing keyring
   writes, network I/O, or file dialogs. The `langfuse_save_config` fix
   added the validator before `config::store_*` so a bad URL doesn't
   leave the keyring in a poisoned half-state. *When it bites*: any
   command that takes a URL parameter; the keyring or filesystem state
   shouldn't depend on URL validity being checked downstream.

4. **DNS-rebinding defense at the transport layer.** Static URL validation
   (parse + scheme check + IP literal check) covers the static cases. To
   defend against the dynamic case — a public hostname whose A record
   resolves to a private IP at request time — wire
   `engine::ssrf_safe_dns::SsrfSafeDnsResolver` into the reqwest client
   builder. Both layers are needed; either alone leaves a hole. *When it
   bites*: any `reqwest::Client` that hits a user-supplied URL,
   especially when the credentials in the request are sensitive.

## What remains

### Open follow-ups from this wave

These items showed up while implementing Wave 1 but are out of scope for
the auth-gate theme:

- **mcp_integration.rs `resolve_mcp_server_path` walks ancestors of
  `current_exe()`.** Even with the auth gate closed, an attacker who can
  also plant a file under any parent directory of the exe (e.g. via a
  weaker file-write bug) can still steer the registered MCP path. The
  path-resolution should canonicalize under the bundle's known resource
  dir. *Tracked for: Wave W (hygiene).*
- **`report_frontend_crash` payload redaction.** Crash payloads land in
  the DB unsanitized; React error boundaries routinely capture in-render
  state including BYOM keys / passphrases. The auth gate prevents
  exfiltration *via the read commands*, but the underlying data is still
  stored in plaintext on disk. Truncate stack length, strip
  Bearer-token-shaped values and query strings before storing.
  *Tracked for: Wave W (hygiene).*
- **`require_auth` and `require_auth_sync` are no-ops.** Three call sites
  in this codebase (and probably more) believe they're enforcing auth
  but aren't. Either delete the no-ops and force callers to use the
  privileged variants explicitly, or make them actually enforce.
  *Tracked for: Wave W (hygiene).*

### Deferred from Wave 1 (becoming Wave 1B)

- **webhooks-smee-relay-dead-letter #1** — Smee inbound zero authenticity
  check. Needs a `webhook_secret` column on `smee_relays`, repo updates
  to read/write it, and UI capture in CloudWebhooksPanel. Different
  mental model (external origin auth vs. IPC-caller auth) and bigger
  surface area than fits in Wave 1.
- **sharing-trusted-peers #1** — `verify_document` re-reads file after
  hashing. Different mental model (file-handling correctness): the fix
  is to read the file once into a buffer and run both hash and signature
  verification from the same buffer. Pairs naturally with the
  external-integrations path-traversal fixes and would best run in a
  small focused file-handling wave.
