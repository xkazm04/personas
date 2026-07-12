> Context: tauri:engine [2/10]
> Total: 9
> Critical: 0  High: 1  Medium: 6  Low: 2

## 1. Bundle import hard-codes `signature_verified: true` and ignores `expected_bundle_hash` (TOCTOU mitigation not implemented in apply)
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: trust-boundary
- **File**: src-tauri/src/engine/bundle.rs:166-168, 391-508 (esp. 396, 469-476)
- **Scenario**: `apply_import` computes `bundle_hash` (line 396) but never compares it to `options.expected_bundle_hash`, and never calls `verify_against_trusted_key`. Yet `BundleImportOptions.expected_bundle_hash` is documented (lines 166-168) as "the apply step verifies the bundle bytes match this hash before importing (TOCTOU mitigation)" — that check is absent. Every imported persona then gets a provenance row written with `signature_verified: true` **hardcoded** (line 475), regardless of whether the signature was ever checked. `preview_bundle` verifies the signature but its result (`signature_valid`) is never carried into `apply_import`.
- **Root cause**: verification lives only in the preview path; apply trusts its input bytes and stamps provenance optimistically. The `expected_bundle_hash` field was added as the TOCTOU seam but the consuming code was never wired.
- **Impact**: security — a bundle swapped between preview and apply (or applied directly with a forged/absent signature) imports personas that are recorded as cryptographically verified. Provenance becomes success-theater; downstream trust decisions keyed off `signature_verified` are wrong.
- **Fix sketch**: In `apply_import`, if `options.expected_bundle_hash` is set, reject when `bundle_hash != expected`. Re-run `verify_against_trusted_key` and set `signature_verified` from the real result instead of the literal `true` (and optionally refuse import of untrusted/invalid signatures unless the caller opts in). (Caveat: confirm the command layer isn't already gating — but the hardcoded `true` is wrong regardless.)

## 2. Resource-pressure throttle is bypassed on the drain paths
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src-tauri/src/engine/queue.rs:342-347 (`drain_next`), 390-396 (`drain_next_global`), 190-198
- **Scenario**: `admit` gates on all four signals (persona, global, quota, resource) so under host pressure new work is enqueued (line 269-282). But `drain_next` and `drain_next_global` check only `quota_available()` + capacity — neither checks `resource_available()`. When a running execution finishes and the engine calls a drain to fill the freed slot, queued work is promoted **even while `resource_throttled == true`**, piling onto the stressed host the throttle was meant to protect.
- **Root cause**: the quota cooldown was threaded through both admit and drain; the later-added resource gate was only threaded through admit.
- **Impact**: UX / stability — the resource governor's back-pressure is defeated for the steady-state path (slot frees → drain), risking the OOM the gate was designed to prevent.
- **Fix sketch**: add `if !self.resource_available() { return None; }` at the top of both `drain_next` and `drain_next_global`, mirroring the existing `quota_available()` guard.

## 3. Byte-index string slicing panics on multibyte UTF-8 (several sites)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/engine/eval.rs:543-544 and 692; src-tauri/src/engine/chain.rs:459-470 (line 466)
- **Scenario**: `&input.output[..3000]` (eval.rs 543), `&trimmed[..trimmed.len().min(500)]` (eval.rs 692), and `&payload[..payload.len().min(200)]` (chain.rs 466) all slice by **byte** index. If the boundary byte falls inside a multibyte UTF-8 sequence (emoji, CJK, accented text near the cutoff), Rust panics ("byte index N is not a char boundary"). The eval.rs:543 site is on the main LLM-eval prompt-build path (agent output is frequently non-ASCII), not just an error path.
- **Root cause**: raw `[..n]` slicing instead of a char-boundary-safe truncation; the codebase already has `utils::text::truncate_on_char_boundary` and `str_utils::truncate_str` used elsewhere.
- **Impact**: crash — a panic in a spawned task / eval path from ordinary non-ASCII content.
- **Fix sketch**: replace each with `crate::utils::text::truncate_on_char_boundary(s, n)` (or `str_utils::truncate_str`), which the surrounding modules already import.

## 4. Scraper cron `compute_next_run` evaluates in UTC, inconsistent with the app's local-time cron semantics
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/engine/scraper.rs:437-440
- **Scenario**: `compute_next_run` calls `cron::next_fire_time` (UTC matcher). But `cron.rs` documents `next_fire_time_local` as the user-facing semantics — "cron '0 9 * * *' fires at 9:00 **local** time, consistent with how `ActiveWindow::is_active_at()` interprets hours" (cron.rs:582-589). A user configuring a scraper schedule "0 9 * * *" expecting 9am local instead gets 9am UTC; off by the machine's UTC offset (and no DST handling that `next_fire_time_in_zone` provides).
- **Root cause**: scraper scheduling picked the UTC entry point rather than the local/tz-aware one used by the rest of the scheduler surface.
- **Impact**: UX — scheduled scrapes fire at the wrong wall-clock time for any non-UTC user; surprising and hard to diagnose.
- **Fix sketch**: switch to `cron::next_fire_time_local` (or `next_fire_time_in_tz` when the config carries a `timezone`) so scraper cron matches persona/ActiveWindow cron semantics; store the resulting UTC instant as today.

## 5. `retry_failed_members` has no single-flight guard → concurrent retries duplicate personas
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src-tauri/src/engine/team_preset_adopter.rs:207-231 (guarded) vs 580-856 (unguarded)
- **Scenario**: `adopt_preset` wraps itself in `ADOPT_INFLIGHT.guard(preset_id)` precisely because "a double-click … would create two teams and duplicate every persona, since nothing in the path is idempotent" (lines 60-66, 227-231). `retry_failed_members` performs the same non-idempotent adopt loop but takes **no** inflight guard. Its only protection is `role_to_member_id.contains_key(role)` built from a one-time `get_members` read (lines 604-613, 649); two concurrent retries both read the members list before either inserts, both see the role absent, and both adopt — duplicate personas + duplicate team members for the same role.
- **Root cause**: the single-flight guard was added to `adopt_preset` but not mirrored onto the sibling retry entry point.
- **Impact**: data corruption — duplicate personas/members on a double-clicked "Retry N failed" button.
- **Fix sketch**: acquire `ADOPT_INFLIGHT.guard(&format!("{preset_id}:{team_id}"))` at the top of `retry_failed_members` (RAII release on all `?` paths), same pattern as `adopt_preset`.

## 6. api_proxy inline OAuth refresh drops the rotated `refresh_token` (and `expires_in`)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/engine/api_proxy.rs:803-806; src-tauri/src/engine/connector_strategy.rs:19-30, 589-630
- **Scenario**: `ResolvedToken.refresh_token` is documented "Must be persisted to avoid credential death when providers enforce refresh token rotation (RFC 6749 §6)" (connector_strategy.rs:26-29). When a request's locally-stored `access_token` is already expired, `resolve_oauth_token` exchanges the refresh_token inline and returns a new access_token **and possibly a rotated refresh_token**. But `execute_api_request` consumes it as `strategy.resolve_auth_token(...).await?.map(|r| r.token)` (api_proxy.rs:803-806) — discarding both `refresh_token` and `expires_in_secs`, and never persisting them. For rotation-enforcing providers (Google, Microsoft), the next call reuses the now-invalidated refresh_token → `invalid_grant` → credential death, until a human re-auths.
- **Root cause**: only the explicit 401-retry path routes through `force_refresh_single_credential` (which persists); the ordinary "locally expired → inline exchange" path throws the rotation away.
- **Impact**: security/reliability — silent credential death for rotation-enforcing OAuth connectors between background-refresh ticks. (Caveat: the background `oauth_refresh` tick mitigates when it runs first; the gap is the request that races ahead of it.)
- **Fix sketch**: when the inline resolve returns a `refresh_token`/`expires_in_secs`, persist them via the credentials repo under the already-held `oauth_refresh_lock` before using the token — or force all expired-token resolves through the persisting refresh helper.

## 7. Duplicate brace-balanced JSON extractors in ai_healing.rs and design.rs
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/engine/ai_healing.rs:215-263 (`extract_json_objects`) vs src-tauri/src/engine/design.rs:261-330 (`extract_bare_json_with_key` + `find_matching_brace`)
- **Scenario**: Both modules independently implement a string- and escape-aware, brace-depth-tracking scanner that pulls balanced `{...}` objects out of arbitrary LLM text (fences/prose tolerated). `ai_healing` returns all balanced objects; `design` returns the first object matching a discriminant key — but the core brace-matching logic is the same algorithm written twice. Verified by reading both: identical depth/`in_string`/escape handling, differing only in the return shape.
- **Root cause**: two features (healing-fix parsing, design-result parsing) each grew their own extractor for the same "recover JSON from messy LLM output" need.
- **Impact**: maintainability — the same subtle parser (which has already been the subject of bug fixes, e.g. the healing silent-drop) must be kept correct in two places.
- **Fix sketch**: extract a shared `str_utils`/`json_extract` helper exposing `balanced_json_objects(&str) -> Vec<&str>`; have `design::extract_bare_json_with_key` filter that iterator by key and `ai_healing::extract_json_objects` return it directly.

## 8. Repeated `BridgeActionResult` Ok/Err construction and `action_name` derivation across the four desktop bridges
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/engine/desktop_bridges.rs:58-121, 168-300, 434-639, 774-819
- **Scenario**: Each bridge's `execute` fn repeats (a) `let action_name = format!("{:?}", &action).split_whitespace().next().unwrap_or("unknown").to_string();` and (b) a near-identical ~18-line `match result { Ok(output) => BridgeActionResult{success:true,…}, Err(e) => BridgeActionResult{success:false,…} }` differing only in the `bridge:` string literal. Four copies each.
- **Root cause**: the shared result-wrapping shape was never factored into a constructor.
- **Impact**: maintainability — a change to the result envelope (new field, different error formatting) must be edited in four places.
- **Fix sketch**: add `BridgeActionResult::finish(bridge: &str, action: String, duration_ms: u64, result: Result<String, AppError>) -> Self` and a small `first_variant_name(&action)` helper; call from each bridge.

## 9. Dead constructor `ResolvedToken::with_expiry`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/engine/connector_strategy.rs:41-48
- **Scenario**: `ResolvedToken::with_expiry` is `#[allow(dead_code)]` and never called — all real construction goes through `ResolvedToken::plain` or the struct literal in `exchange_oauth_refresh_token`. Grep of the engine shows no call site; the `#[allow(dead_code)]` confirms it's known-unused.
- **Root cause**: builder added speculatively when `expires_in_secs` was introduced; callers ended up using the struct literal instead.
- **Impact**: maintainability — minor cruft; keeps a code path that looks live but isn't.
- **Fix sketch**: delete `with_expiry` (or wire it into `exchange_oauth_refresh_token` in place of the literal so the helper is actually exercised).
