# Bug Hunter Fix Wave 1 — Crypto: make the vault fail closed

> 5 commits, 5 findings closed (2 Critical, 3 High) from `credential-vault-connectors.md`.
> Baseline preserved: `cargo check --features desktop` 0 errors → 0 errors; crypto unit tests 14/14 pass.

## Commits

| # | Commit | Finding | Severity | File |
|---|---|---|---|---|
| 1 | `ef318142c` | #1 master-key fallback fail-open | Critical | `engine/crypto.rs` |
| 2 | `22ed806d6` | #2 attacker-plantable raw master key | Critical | `engine/crypto.rs` |
| 3 | `d37917ffe` | #5 legacy plain-RSA IPC decrypt fails open | High | `engine/crypto.rs` |
| 4 | `4f6e27ff2` | #3 client-trusted `healthcheck_passed` | High | `commands/credentials/crud.rs` |
| 5 | `3feb7271e` | #4 readiness on bare row existence | High | `commands/design/connector_readiness.rs` |

## What was fixed (grouped by sub-pattern)

**Fail-closed key acquisition (#1, #2)**
1. **Master-key fallback inverted to opt-in.** When the OS keychain was unavailable, `get_master_key()` silently used a local-file key *unless* an undocumented `PERSONAS_DENY_FALLBACK_KEY=1` was set — fail-open — while the doc and error string promised an opt-in `PERSONAS_ALLOW_FALLBACK_KEY` that the code never read. A transient keychain hiccup downgraded vault protection for the whole process (cached `OnceLock`). Now parsed once into a `FallbackPolicy` enum; default returns `Err` (fail-closed); fallback only with the documented `ALLOW` flag.
2. **Unauthenticated legacy key files rejected.** On Unix, `load_local_fallback_key`'s no-prefix branch and `platform_unprotect`'s `data.len()==32` branch accepted any 32-byte / plaintext blob as the master key, letting an attacker who can write the app-data dir plant a known key. Both now fail closed unless `PERSONAS_MIGRATE_LEGACY_KEY=1` is set for a single, logged migration run (after which the key is re-encrypted in authenticated form).

**No downgrade to weaker primitives (#5)**
3. **Legacy plain-RSA IPC decrypt closed by default.** `SessionKeyPair::decrypt` selected the weaker RSA-only path for any payload lacking a `.` separator — an attacker-controllable property, letting a hostile renderer force every credential write down the weaker, unauthenticated-transport path (and keep the retirement telemetry pinned above zero). Separator-less payloads are now rejected unless `PERSONAS_ALLOW_LEGACY_IPC=1`; the hit counter/warn are preserved for telemetry. The current frontend only emits the hybrid format, so default-closed is safe.

**Server-side truth, not client claims (#3, #4)**
4. **Healthcheck verified server-side.** `create_credential` stamped "Connection verified" from a client-supplied `healthcheck_passed` boolean with no probe, so any IPC caller could fake a healthy badge for empty/garbage credentials. The flag is now only a *request*: a real `run_healthcheck` runs server-side (loads + decrypts the stored credential, probes the service) and stamps the true result.
5. **Readiness requires a usable credential.** A `Credential` connector was Ready as soon as a `persona_credentials` row with a matching `service_type` existed — even with empty `data: {}` (zero field rows) or a failed last healthcheck — promoting personas that then executed blind. A readiness-only `resolve_ready_credential` wrapper now also requires ≥1 non-empty field value and `healthcheck_last_success != Some(false)`. The shared resolver/credential-link paths are unchanged (an empty credential stays editable, just not Ready).

## Verification

| Check | Baseline (B2) | After Wave 1 |
|---|---|---|
| `cargo check --features desktop` errors | 0 | 0 |
| `engine::crypto` unit tests | (not measured) | 14 passed / 0 failed |
| `tsc --noEmit` | 0 errors | 0 (no TS files touched) |
| Files modified | — | 3 (`crypto.rs`, `crud.rs`, `connector_readiness.rs`) |

> `cargo check` is scoped with `--features desktop` because the default feature set
> omits `tauri-plugin-updater`, whose permissions a capability references — plain
> `cargo check` fails in the build script before any Rust is compiled (pre-existing,
> environmental; not introduced by this wave). `vitest`/`eslint` binaries are not
> installed in this checkout. The `platform_unprotect` `#[cfg(not(windows))]` edit
> (#2) is not compiled on this Windows host; it was reviewed by hand and mirrors the
> always-compiled `load_local_fallback_key` branch.

## Cumulative status (waves 1–1)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Crypto — make the vault fail closed | 5 (2C / 3H) |

5 of 73 findings closed. Remaining: 14 Critical, 27 High, 24 Medium across waves 2–7.

## Patterns established (catalogue items 1–5)

1. **Documented-vs-implemented policy inversion** — a security switch whose doc/error names an opt-in `ALLOW` flag while the code reads an opt-out `DENY` flag (or nothing). Parse the policy once into a single enum so doc, error text, and branch can't diverge. *Grep:* env reads near `fallback`/`fail` with mismatched ALLOW/DENY naming.
2. **Unauthenticated migration-convenience acceptance** — "any N-byte blob is probably a legacy key/format" branches accept attacker-planted data on a security path. Gate every legacy import behind an explicit, logged, opt-in migration flag; fail closed otherwise. *Grep:* `len() == 32`, "as-is for migration", "legacy plaintext".
3. **Attacker-selectable downgrade by input shape** — dispatching to a weaker primitive based on a structural property of attacker-controlled input (e.g. presence of a `.` separator). Never select crypto strength from untrusted input; gate the legacy path off by default. *Grep:* `.find('.')`/`contains('.')` choosing a decrypt branch; counters that "prove" a path is unused.
4. **Client-asserted security facts** — a renderer-supplied boolean (`healthcheck_passed`) written as server-side truth (verified/healthy). Security/readiness facts must be produced by server-side code that actually performed the check, never accepted across IPC. *Grep:* `input.*passed`, `unwrap_or(false)` feeding a "success" write.
5. **Existence ≠ usability** — readiness/binding gates that treat "a row exists" as "it works." Require substance (non-empty required fields, last check not failed) for any ready/healthy/promoted gate; keep the looser check for editing/selection. *Grep:* `.is_some()` directly gating a `Ready`/`Healthy` state.

## What remains

Open themes (per INDEX): Wave 2 P2P/remote-control auth (largest), Wave 3 input validation/path traversal, Wave 4 atomicity/TOCTOU, Wave 5 sync data-loss, Wave 6 panics/integrity, Wave 7 autonomous control/success-theater.
