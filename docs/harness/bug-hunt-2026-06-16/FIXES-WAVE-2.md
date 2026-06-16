# Bug Hunter Fix Wave 2 — Security & trust-boundary

> 5 commits, 5 criticals closed (the highest-blast-radius set in the scan).
> Theme: close the trust-boundary hole — and where the codebase already had the
> correct guard elsewhere, mirror it instead of inventing a new one.
> Baseline preserved: `cargo check --features desktop` 0 → 0 errors. No frontend
> changes (tsc still 0; the 5 pre-existing vitest failures are unrelated).

## Commits

| # | Commit | Finding closed | File |
|---|---|---|---|
| 1 | `b8f759842` | oauth-api-proxy-foraging #1 — SSRF via unchecked redirect | `src-tauri/src/engine/ssrf_safe_dns.rs` |
| 2 | `a3eebc13c` | settings-byom #4 — management-API CORS `allow_origin(Any)` | `src-tauri/src/engine/management_api.rs` |
| 3 | `a02e21210` | tauri-ipc-bridge-api #1 — PostgREST filter injection | `src-tauri/src/cloud/remote_commands.rs` |
| 4 | `34a3fc3f3` | obsidian-brain #1 — path-traversal guard bypass | `src-tauri/src/commands/obsidian_brain/graph.rs` |
| 5 | `a0b13eaec` | crypto-secure-storage #1 — enclave signature byte mismatch | `src-tauri/src/engine/enclave.rs` |

## What was fixed

1. **SSRF via redirect (credential API proxy).** `build_ssrf_safe_client()` had an SSRF-safe DNS resolver but no redirect policy, so reqwest auto-followed up to 10 hops. The resolver only inspects hostnames, so an upstream `302 Location: http://169.254.169.254/...` (raw IP literal) skipped DNS and the proxy sent the credential's authenticated request straight to cloud-metadata / internal services. Added a `redirect::Policy::custom` that errors on any hop whose target IP is private (`url_safety::is_url_target_private`) and caps at 5 hops — mirroring the already-correct twin ingest client. Every client built through this shared helper is now covered.
2. **Management-API CORS `Any`.** The loopback control server (127.0.0.1:9420) hosts `/api/execute`, `/api/proxy/{credential_id}`, `/api/build`, version rollback, but allowed any origin — so any visited web page could fetch them cross-origin, making a single Bearer-token leak weaponizable from a browser tab. Replaced `Any` with an `AllowOrigin::predicate` trusting only the app's own webview (`tauri://localhost`, `http(s)://tauri.localhost`) and loopback dev origins. MCP/CLI clients send no Origin and are unaffected; the Bearer check stays as layer two.
3. **PostgREST filter injection.** `remote_command_approve/reject` interpolated the caller-supplied `id` into `pending_commands?id=eq.{id}`; PostgREST reads `&`/`=`/`eq.` as query syntax, so a crafted id widened the WHERE clause of a tenant-scoped GET/PATCH under the user's own JWT (mass-reject, status spoofing, defeating per-device scoping; RLS scopes to tenant, not row). Added `validate_command_id` (UUID parse) at the top of both public handlers; downstream interpolations run only after the validated entry point.
4. **Path-traversal guard bypass (obsidian graph).** `ensure_within_vault` canonicalized both paths with `unwrap_or(<raw path>)`, turning a canonicalize failure (or a one-sided Windows `\\?\` prefix) into a guard *bypass* that compared un-normalized paths — a crafted `note_path` with `..`/symlinks read arbitrary files, reachable on the normal flow (the UI passes absolute paths). Made canonicalize a hard requirement on both sides (failure → rejection); canonicalization resolves `..`/symlinks before the prefix check, so in-vault absolute paths still pass and escapes are caught.
5. **Enclave signature byte mismatch.** `seal()` signed `to_string_pretty(&manifest)` but `verify()` recomputed the message with `to_string(&manifest)` (compact) from the round-tripped struct — different bytes, so every honest enclave failed verification, and verifying a re-serialized struct silently dropped unsigned/extra on-disk fields (tamper bypass). `parse_enclave` now returns the raw `manifest.json` bytes and `verify()` checks the signature over exactly those.

## Verification (before / after)

| Gate | Baseline | After Wave 2 | Notes |
|---|---|---|---|
| `cargo check --features desktop` | 0 errors | 0 errors | Each fix verified individually + a final full check. `--features desktop` is the required gate (enables the feature-gated `updater` capability). |
| `tsc --noEmit` | 0 errors | 0 errors | No frontend files changed this wave. |
| `vitest run` | 5 pre-existing failing | 5 (same) | Unchanged — no frontend changes. |

No regressions introduced.

## Cumulative status (across all waves)

| Wave | Theme | Closed | Commits |
|---|---|---:|---|
| 1 | Concurrency / missing-CAS double-execution | 5 | `c3ab4aa7f` `6e960f1b5` `fa326eb14` `9d1de3d78` `0ff899369` |
| 2 | Security & trust-boundary | 5 | `b8f759842` `a3eebc13c` `a02e21210` `34a3fc3f3` `a0b13eaec` |

Criticals closed: **10 / 42**. Findings closed overall: **10 / 260**.

## Patterns established (catalogue additions, items 5–9)

5. **Front-loaded SSRF defense misses redirects.** A DNS-resolver SSRF guard only sees *hostnames*; an upstream redirect `Location` carrying a raw IP literal skips DNS entirely. Any reqwest client built for user-influenced URLs needs a `redirect::Policy` that re-validates *each hop's* target IP, not just the initial URL.
6. **`allow_origin(Any)` on a loopback control server is wrong even with token auth.** A localhost server with state-changing/credential routes still needs an origin allow-list — `Any` lets any visited page weaponize a leaked token cross-origin. Non-browser clients ignore CORS, so tightening to the app's own webview + loopback origins costs nothing legitimate.
7. **String-formatted query path = injection.** Interpolating a caller id into a PostgREST/SQL query *path* (`?id=eq.{id}`) lets `&`/`=`/`eq.` widen the filter. Validate (UUID parse) at the public boundary before formatting; RLS scopes to tenant, not row, so a widened filter still passes.
8. **`canonicalize().unwrap_or(raw)` is a guard bypass.** A containment check that falls back to the un-normalized path on canonicalize failure — or canonicalizes only one side (Windows `\\?\` prefix mismatch) — silently disables itself. Require canonicalize on *both* sides as a hard error; it resolves `..`/symlinks before the prefix check.
9. **Sign and verify over identical raw bytes.** Verifying a signature by re-serializing a parsed struct (pretty vs compact, dropped unknown fields, reordered keys) breaks honest verification *and* lets unsigned on-disk fields slip past. Capture and verify the exact bytes that were signed.

## What remains

32 criticals across the other themes (see `INDEX.md`). Notable security/trust items still open (High, not in this critical wave): `crypto` symlink-escape in `validate_file_access_path`, `mcp-gateways` JSON-RPC id desync, `settings-byom` BYOM routing dead options, plus the enclave finding #2 (caller never *enforces* the advisory `signature_valid`/`creator_trusted` flags — a natural follow-up to wave 2's fix #5). Next highest-leverage wave per the INDEX plan: **Watermark/cursor & sync data-loss** (sync cursor, notification/webhook watermark-on-failure).
