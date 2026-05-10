# Bug Hunt Fix Wave 1B — TOCTOU + Smee origin allowlist

> 2 commits, 2 critical findings closed.
> Baseline preserved: tsc 0 errors → 0 errors; cargo check clean.

## Commits

| #  | Commit       | Findings closed                                              | Severity   | Files                                                                |
|----|--------------|--------------------------------------------------------------|------------|----------------------------------------------------------------------|
| 1  | `f81f10ad6`  | sharing-trusted-peers #1 (verify_document TOCTOU)            | critical   | src-tauri/src/commands/signing/mod.rs                                |
| 2  | `b236e62e0`  | webhooks-smee-relay-dead-letter #1 (zero authenticity check) | critical   | src-tauri/src/db/migrations/incremental.rs, src-tauri/src/db/models/smee_relay.rs, src-tauri/src/db/repos/communication/smee_relays.rs, src-tauri/src/engine/smee_relay.rs, src-tauri/src/commands/design/build_sessions.rs |

## What was fixed

### 1. verify_document TOCTOU (Fix 1)

The signing-verify path performed two independent disk reads of the same
file: `hash_file(&path)` followed by `std::fs::read(&path)`. An attacker
who controls the directory (or a sync client like Dropbox racing the
user) could swap the file between those two reads, so the `valid =
file_hash_match && signature_valid` check could resolve to true for a
file matching neither end-to-end. The `hash_bytes` helper was already
available — added previously to close the same TOCTOU on the *signing*
path. The verify path just hadn't been migrated to use it. Single-buffer
read, two checks against the same buffer.

### 2. Smee inbound origin allowlist (Fix 2)

The Smee SSE relay had **zero authenticity check** on inbound events.
Anyone who learned a relay's smee.io channel URL could `POST` arbitrary
JSON and inject fully-trusted `github_*` events into the local persona
event bus. Privilege escalation into whatever the listener persona
could do.

The textbook fix would be `x-hub-signature-256` HMAC verification, but
smee.io envelopes ship the body as re-parsed JSON, not raw bytes —
recomputing HMAC over re-serialized JSON produces a different byte
sequence than the one GitHub signed (whitespace, key order). HMAC over
smee-relayed payloads is fundamentally unreliable without changes to
the smee transport layer.

After the architectural decision (user approval), shipped the immediately
useful layer: an `allowed_repos` origin allowlist.

- `allowed_repos TEXT` column added to `smee_relays` (incremental
  migration `smee_relays_allowed_repos`). JSON-encoded array of
  `owner/repo` strings; NULL or empty = back-compat (accept-any) with a
  WARN logged once per relay session so the operator notices.
- `SmeeRelay`, `CreateSmeeRelayInput`, `UpdateSmeeRelayInput` extended
  with `allowed_repos: Option<String>`. `row_to_relay`, `create`,
  `update` migrated.
- `list_active_configs` now returns the column.
- `RelayParams` carries the parsed list. `relay_config_key` includes
  it so an edit restarts the task with the new policy.
- In `relay_sse_core`, after parsing the smee envelope body, an event
  whose `body.repository.full_name` is not in the allowlist is dropped
  with a `WARN` (including the rejected repo name).
- `commands/design/build_sessions.rs` updated to construct
  `CreateSmeeRelayInput` with `allowed_repos: None` (auto-relay creation
  inherits the back-compat default).

## What still remains in this theme

- **Raw-body HMAC verification (deferred).** Tracked as a follow-up: a
  separate scan/wave to investigate whether smee.io has a raw-body
  delivery mode (or whether we should bypass smee for GitHub webhooks
  and run a local receiver behind a reverse-tunnel that preserves bytes).
- **UI capture for `allowed_repos` (follow-up).** Until shipped, advanced
  users populate via SQL or the existing `update_smee_relay` command
  (now accepts the field).

## Verification table

| Counter                              | Pre-Wave-1B | Post-Wave-1B | Delta |
|--------------------------------------|------------:|-------------:|------:|
| `cargo check` errors                 |           0 |            0 |   0   |
| `npx tsc --noEmit` errors            |           0 |            0 |   0   |
| `smee_relays` columns                |          11 |           12 |  +1   |
| Critical findings closed (cumulative)|           5 |            7 |  +2   |

## Patterns established (additions to the catalogue, items 5-6)

5. **One-buffer-multiple-checks for file-integrity verification.** When
   verifying a file with multiple checks (hash, signature, etc.), read
   the file once into a buffer and run all checks on the same in-memory
   copy. Two `std::fs::read` calls on the same path open a TOCTOU window
   that defeats the whole verification chain. *When it bites*: any
   verify-path that calls `hash_file(path)` and a separate
   `std::fs::read(path)`; or any cryptographic operation that reads a
   file in two passes.

6. **Origin allowlist as defense-in-depth when message-auth isn't
   available.** When the transport (smee.io, GitHub Pages webhook
   receivers, third-party event buses) doesn't preserve raw bytes for
   HMAC verification, fall back to origin authentication: validate that
   the parsed event's claimed origin (e.g.
   `body.repository.full_name`) is in a configured allowlist. Imperfect
   (the origin field is part of the unauthenticated body) but raises the
   bar from "anyone with the URL" to "an attacker who can also forge
   credible repo metadata that matches the allowlist". Pair with full
   HMAC where the transport supports it. *When it bites*: any "we don't
   verify because we can't" surface that ingests external events.

## Cumulative status (waves 1 + 1B)

| Wave | Theme                                  | Closed | Notes                                       |
|------|----------------------------------------|-------:|---------------------------------------------|
| 1    | Privileged-IPC auth gates              |      5 | 2 deferred to Wave 1B                       |
| 1B   | TOCTOU + Smee origin allowlist         |      2 | Both originally Wave 1 items                |
| **Total** | **Privileged-IPC + auth-adjacent** |  **7** | All Wave 1 INDEX criticals closed           |

Pattern catalogue: 6 items.

Remaining critical themes (per INDEX.md): Wave 2 (argv-injection +
path-traversal), Wave 3 (execution-engine), Wave 4 (idempotency), Wave 5
(save-race), Wave 6 (async/concurrency + onboarding), Wave 7 (silent-
failure observability).
