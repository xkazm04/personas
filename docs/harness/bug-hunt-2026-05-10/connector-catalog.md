# Bug Hunt — Connector Catalog

> Group: Vault & Credentials
> Files scanned: 14
> Total: 2C / 4H / 5M / 2L = 13 findings

---

## 1. CLI allowlist `path_matches_dir` has no path-boundary check — bypassable via prefix-collision dirs

- **Severity**: critical
- **Category**: validation-gap
- **File**: `src-tauri/src/commands/credentials/auth_detect.rs:208`
- **Scenario**: An attacker installs `gh.exe` at `C:\Program Files Foobar\gh.exe` (or `/usr/binary/aws` on Linux). `which gh` resolves there; `path_matches_dir("C:\\program files foobar\\gh.exe", "C:\\Program Files")` returns true because the lowercased path string starts with the lowercased dir literally — there is no separator boundary check. The hijacked binary is then spawned by `probe_cli_tools` with the user's environment subset.
- **Root cause**: `path_str.to_lowercase().starts_with(&dir.to_lowercase())` (and the non-Windows variant on line 213) treats the allowed directory as a string prefix, not a path prefix. Any directory whose name shares a prefix with an allowlisted dir bypasses the gate.
- **Impact**: PATH-hijacking mitigation that the file's docstring (lines 6-9) explicitly promises is defeated. CLI auth-detection becomes an arbitrary-binary-spawn primitive any time a user runs the AI Setup wizard.
- **Fix sketch**: Compare canonicalized `Path` ancestors, not strings. Build the allowed dir as a `Path` and use `binary_path.ancestors().any(|a| a == allowed_path)`, or at minimum require `path_str` either equals `dir` or starts with `dir + MAIN_SEPARATOR`.

## 2. `seed_builtin_connectors` uses `INSERT OR IGNORE` — connector definitions never refresh after first install

- **Severity**: critical
- **Category**: cache-invalidation
- **File**: `src-tauri/src/db/mod.rs:1110`
- **Scenario**: Ship v1.0 with Stripe builtin (`fields` listing only `secret_key`). v1.1 adds `webhook_secret` to the JSON and regenerates `builtin_connectors.rs`. On v1.1 startup, `INSERT OR IGNORE INTO connector_definitions ... ` skips the existing `builtin-stripe` row entirely. Every existing user keeps the v1.0 schema forever and never sees the new field, while new installs see v1.1.
- **Root cause**: The seed path treats builtin definitions as create-once. The static array in `db/builtin_connectors.rs` is the source of truth, but the DB row wins after any prior install.
- **Impact**: Catalog drifts permanently across releases. Bug-fixes to healthcheck endpoints, scope updates, new fields, corrected docs URLs — none reach existing users. Hard to diagnose because the in-memory definition (TypeScript) and the DB row diverge silently.
- **Fix sketch**: Switch to `INSERT … ON CONFLICT(id) DO UPDATE SET …` for rows where `is_builtin = 1`, gated on a content hash so unchanged rows aren't churned. Preserve `created_at`; refresh `updated_at`. Run `invalidate_connector_cache()` + `refresh_connector_keyword_snapshot` once after seeding completes.

## 3. `usePickerFilters` accepts `searchTerm` but never filters by it — search becomes a "clear filters" button

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/vault/sub_catalog/components/picker/usePickerFilters.ts:164`
- **Scenario**: User types "stripe" in the catalog search. `useEffect` at line 166 sees `searchTerm` is non-empty and clears every active filter. Then `filteredConnectors = applyFilters(connectors)` runs with no search predicate. The grid now shows ALL ~120 connectors instead of just Stripe.
- **Root cause**: The hook accepts `searchTerm` (parameter at line 18) only to use it as a side-effect trigger to wipe filters. There is no `result.filter(c => c.label.toLowerCase().includes(searchTerm))` step in `applyFilters`.
- **Impact**: Search box visibly does nothing useful and actively destroys the user's filter context. A user expecting a typeahead gets a haystack.
- **Fix sketch**: Inside `applyFilters`, after the existing filters, add `if (searchTerm?.trim()) { const q = searchTerm.toLowerCase(); result = result.filter(c => c.label.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)); }`. Drop the destructive `useEffect` that nulls all filters.

## 4. Builtin `LOCALAPPDATA\\Programs` is too broad — any user-installed app's `gh.exe` passes the allowlist

- **Severity**: high
- **Category**: validation-gap
- **File**: `src-tauri/src/commands/credentials/auth_detect.rs:108`
- **Scenario**: A malicious npm postinstall, browser extension companion app, or game launcher installs to `%LOCALAPPDATA%\Programs\sketchy-tool\gh.exe`. The CLI allowlist accepts anything under `%LOCALAPPDATA%\Programs` because the path is added wholesale to `user_safe_dirs()`. The hijacked `gh.exe` runs whenever the user enters AI Setup.
- **Root cause**: `user_safe_dirs()` adds parent dirs that span entire ecosystems (`%APPDATA%\npm`, `%LOCALAPPDATA%\Programs`, `%USERPROFILE%\scoop\apps`) instead of narrow per-tool subdirectories. The intent (per the comment on line 96-98) was to cover gcloud / npm-global / flyctl / scoop, but the granularity is wrong.
- **Impact**: PATH-hijacking attack surface that the SAFE_DIRS infrastructure was supposed to close. Combined with finding #1, the allowlist is essentially honor-system on Windows.
- **Fix sketch**: Per-tool allowlist entries must point at a single tool's install dir (e.g. `%APPDATA%\npm\gh-cli`), and resolution must also confirm the binary's filename matches the expected probe (the canonical resolved path's `file_name()` should be `gh.exe`/`gh`, not arbitrary).

## 5. Auth-detect cache is invalidated on OAuth success but not on credential delete or connector unlink

- **Severity**: high
- **Category**: cache-invalidation
- **File**: `src-tauri/src/commands/credentials/oauth.rs:500` and `src-tauri/src/commands/credentials/auth_detect.rs:737`
- **Scenario**: User completes Google OAuth (cache cleared), then later deletes the Google credential. The 5-minute `auth_detect_cache` still reports `google_workspace` as authenticated based on cookies/CLI probes. NegotiatorPanel shows the wizard pre-selecting a connector for which the user has just removed credentials.
- **Root cause**: Only `apply_oauth_outcome` (universal + Google) calls `*auth_detect_cache.lock().await = None`. Credential CRUD in `crud.rs` and connector_unlink paths do not.
- **Impact**: AI Setup wizard mis-reports auth state for up to 5 minutes after credential changes, silently re-creating the very credential the user just deleted.
- **Fix sketch**: Call `invalidate_auth_detect_cache(&state).await` in `delete_credential`, `update_credential` (when service_type changes), and any `set_oauth_status_invalidated` path. Add an integration test that deletes a credential and asserts the next `detect_authenticated_services` call hits CLI probes.

## 6. `generate_oauth_state` falls back to ephemeral random secret silently when keyring read fails

- **Severity**: high
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/credentials/oauth.rs:983` (and verify path 1057)
- **Scenario**: The OS keyring is locked or the entry is corrupted. `get_or_create_oauth_hmac_secret` logs a warning, generates a new random 32-byte secret, attempts a best-effort `set_password`, and returns the new secret. The first OAuth flow generates `state` signed with secret-A. If a second app instance starts before `set_password` completes (or `set_password` fails entirely) and keyring becomes accessible, instance B reads a *different* secret. The callback running in instance A validates state with secret-A — works. But if any persisted state from a previous app session is verified, it now fails permanently because the per-install secret rotated.
- **Root cause**: Best-effort persistence + process-local OnceLock cache means a transient keyring failure permanently rotates the HMAC secret for that install session, invalidating any in-flight OAuth flows started before the rotation. There is no surfaced error.
- **Impact**: Random "OAuth state mismatch — possible CSRF attack" failures that retrying once usually fixes, attributed to the user's network rather than the keyring race. Investigations target nonexistent CSRF.
- **Fix sketch**: If keyring read fails, surface a hard error to the OAuth start command rather than continuing with an ephemeral secret. If a fallback is needed, persist to a config-dir file with `0600` perms and document the security trade-off.

## 7. `connector.color` rendered into inline style as `${connector.color}12` enables CSS escape from un-validated DB content

- **Severity**: medium
- **Category**: xss
- **File**: `src/features/vault/sub_catalog/components/picker/ConnectorCard.tsx:135-138`
- **Scenario**: A connector definition is created via `create_connector` (privileged, but the path is still admin-mutable) with `color = "red; background-image: url(http://evil/track?x="`. React's inline-style serialization for unknown CSS strings will pass it through as `backgroundColor: "red; background-image: url(http://evil/track?x=12"`. Modern React DOMs reject most CSS injection in style objects, but the trailing `12`/`25` concatenation produces unpredictable values. At minimum, `color` is rendered without validation; at worst, a future renderer (or SSR) admits the string into `style="..."`. ThemedConnectorIcon (`backgroundColor: adjustedColor`) at `ConnectorMeta.tsx:394` is the same pattern.
- **Root cause**: `connector.color` arrives from the SQLite row through `parseConn` and is passed verbatim to inline style. There is no `^#[0-9A-Fa-f]{6}$` whitelist, even though `hexLuminance` already assumes hex format.
- **Impact**: Tracking-pixel beacons or theme corruption from a tampered DB row, breaking the "local-first, no outbound traffic" invariant.
- **Fix sketch**: Add `function safeHex(c: string | null | undefined): string { return /^#[0-9A-Fa-f]{6}$/.test(c ?? '') ? c! : '#6B7280'; }` and pipe `connector.color` through it everywhere it reaches inline style. Reject invalid colors at `parseConnectorDefinition` so bad values can't enter the store.

## 8. `useRecipeIndicators` fetches once and never refreshes — recipe-reuse badges go stale on every save

- **Severity**: medium
- **Category**: stale-closure
- **File**: `src/features/vault/sub_catalog/components/picker/useRecipeIndicators.ts:18`
- **Scenario**: User opens the catalog (recipes fetched, all badges show count=2). User adds a new GitHub credential, returning to the catalog. The "used N times" badge on the GitHub card still says 2 — the hook's `useEffect` has empty deps and runs only on mount.
- **Root cause**: No subscription to `useVaultStore.credentials` length, no refetch on `pendingCatalogCategoryFilter` consumption, no event bus tie-in.
- **Impact**: Badge count drifts further from reality the longer the catalog stays open; user trusts the wrong "freshness" signal when picking which recipe to reuse.
- **Fix sketch**: Add `[useVaultStore((s) => s.credentials.length)]` to the effect, or expose a `refresh` from the hook that `CatalogPage` calls after `createCredential`.

## 9. Cookie-probe LIKE pattern `%domain` produces false positives for hosts containing the suffix as a substring

- **Severity**: medium
- **Category**: edge-case
- **File**: `src-tauri/src/commands/credentials/auth_detect.rs:633-634`
- **Scenario**: `domain` is `.linear.app`. Pattern `%.linear.app` will match `host_key = "x.linear.app.attacker.com"` if Chrome ever stores such a value (a malicious site could set a cookie with that domain via subdomain takeover or cookie-tossing). The probe then concludes "logged in to Linear" and the wizard pre-selects the Linear connector, surfacing a fake identity to the user.
- **Root cause**: The trailing `.com.attacker.com` style host_keys aren't structurally validated. SQL `LIKE` only enforces the suffix presence, not that the host_key is exactly the domain or a leading subdomain.
- **Impact**: False-positive auth detection that pre-selects the wrong connector in AI Setup. Low likelihood but plausible against Chrome cookie databases that include marketing/redirect domains.
- **Fix sketch**: Replace `LIKE ?1` with explicit equality + suffix-with-dot match: `WHERE host_key = ?1 OR host_key LIKE '%.' || ?1` and feed `domain` *without* the leading dot.

## 10. `MAX_OAUTH_SESSIONS=50` evicted-while-pending sessions return "session not found", masking real OAuth failures

- **Severity**: medium
- **Category**: race-condition
- **File**: `src-tauri/src/commands/credentials/oauth.rs:1119-1136`
- **Scenario**: User starts an OAuth flow, opens 51 more (e.g. testing many connectors). The original session is evicted by `evict_oldest_sessions`. The user completes consent in the browser; the callback handler at `apply_oauth_outcome` does `sessions.get_mut(session_id)` which returns `None` — the success/error is silently dropped (no `else` branch). Frontend polling sees `OAuthSessionStatus::NotFound` and reports "session not found or expired" even though OAuth succeeded.
- **Root cause**: Eviction is by created-at age, not by reference count. `apply_oauth_outcome` has no fallback when the session is gone.
- **Impact**: Lost tokens (if the access_token was returned by the provider), audit log says `oauth_failed` for a successful flow, user retries and creates duplicate connector grants.
- **Fix sketch**: When evicting, prefer sessions whose status is already terminal; never evict a `Pending` session unless the cap is exceeded by pending sessions alone (in which case start_oauth should refuse new flows with a clear error). Always log a warning when `apply_oauth_outcome` finds the session missing.

## 11. `cleanup_oauth_sessions` runs only when `start_*` is called — terminal sessions linger when no one starts a new flow

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src-tauri/src/commands/credentials/oauth.rs:388, 1314`
- **Scenario**: User completes one OAuth flow at app start, then never opens AI Setup again. The session row stays in `OAUTH_SESSIONS` until the next `start_oauth` invocation (could be hours/days). `get_session_status` removes terminal rows, but only the *requested* row, and only if the frontend keeps polling it. If the polling component unmounts after success (which `useOAuthPolling` does at line 141 by clearing `sessionId`), `get_session_status` is never called for that ID again.
- **Root cause**: Throttled cleanup is gated on `start_*` traffic. Stable installations leak slowly.
- **Impact**: Long-running app instances accumulate session rows that hold encrypted tokens past their useful life. ZeroizeOnDrop only fires on `HashMap::remove`.
- **Fix sketch**: Spawn a background task in `setup` that calls `cleanup_oauth_sessions` every 60s, or always run cleanup at the top of `get_session_status`.

## 12. AutoCred log dedup compares typed `BrowserLogEntry.message` strings — adversarial near-duplicates fool the prefix heuristic

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/vault/sub_catalog/components/autoCred/helpers/useAutoCredSession.ts:130-137`
- **Scenario**: A misbehaving Playwright MCP emits `"Clicked button"`, then `"Clicked button (retry)"` (24-byte difference). `longer.length - shorter.length` is 11, so the dedup heuristic does NOT trigger; both lines stay. But emit `"Clicked"` then `"Clicked!"` — diff=1, replaces the original with `"Clicked!"`. A flaky log stream produces an unpredictable mix of replacement vs. append, making the audit log unreliable.
- **Root cause**: 5-byte-difference threshold is arbitrary; using prefix matching across log entries treats data as similar that shouldn't be coalesced.
- **Impact**: Lost diagnostic context in AutoCred sessions; harder to debug failed automated credential extraction.
- **Fix sketch**: Drop the prefix-merge branch entirely; only collapse exact duplicates (`lastMsg === newMsg && last.type === entry.type`). Or, if collapsing is desired, do it server-side in Claude's stream-json parser, not in client-side React state.

## 13. `useOAuthPolling` resumes polling on tab visibility change — but `sessionId` may now be terminal and already consumed

- **Severity**: low
- **Category**: race-condition
- **File**: `src/hooks/design/oauth/useOAuthPolling.ts:102-178`
- **Scenario**: User starts OAuth, switches to the browser to consent, returns to Personas. Effect at line 102 had cleanup-fired at visibility=false, leaving `sessionId` set. On visibility=true a NEW polling generation starts and calls `pollFn`. By the time the call lands, the previous `get_session_status` (issued before tab-switch) had already returned `success` and removed the session — Rust returns `NotFound`. The new poll loop reports "OAuth authorization failed."
- **Root cause**: `get_session_status` removes terminal sessions on read (oauth.rs:1247). Two pollers can race when the visibility deps re-trigger the effect. The frontend doesn't debounce visibility transitions.
- **Impact**: Sporadic "OAuth failed" toasts on successful flows when users tab away during consent. Retrying works.
- **Fix sketch**: Don't include `isDocumentVisible` as an effect dep; instead pause the in-flight `setTimeout` chain via `controller.signal` and resume on visibility, without abandoning generation. Or have the backend keep the terminal row for a short grace window after first read.
