# Ambiguity Audit — Credentials & Keys

> Total: 12 findings (3 critical, 4 high, 4 medium, 1 low)
> Files read: ~25
> Scope: Frontend (TS/React) credential CRUD, hybrid encryption envelope, OAuth flows, healthcheck/rotation hooks, vault status UI, secret import.

## 1. Session public key cached forever — never invalidated when keyring/session changes

- **Severity**: critical
- **Category**: implicit-assumption
- **File**: src/lib/utils/platform/crypto.ts:6-11, 59-104
- **Scenario**: `cachedPublicKey` is a module-level singleton. It is fetched once via `getSessionPublicKey()` and cached for the lifetime of the renderer process. The only call site for `clearCryptoCache()` is `authStore.logout` (authStore.ts:93). If the Rust side rotates the session key (process restart, keyring re-unlock, vault re-key, panic recovery), the frontend keeps encrypting payloads with the **stale** public key, and every IPC decrypt on the backend fails with no clear signal back to the cache.
- **Root cause**: There is no documented assumption about session-key lifetime tying frontend cache to backend key rotation. The "must be called on logout" comment in clearCryptoCache is the *only* documented invariant — but logout is not the only event that mints a new keypair backend-side.
- **Impact**: Silent failure mode. Users see "Failed to encrypt sensitive data for IPC" errors that look transient/network — when really the symmetric envelope is being rejected with a stale RSA pubkey. Especially likely after a Tauri-window reload that doesn't tear down the renderer but does restart the backend keypair, or after a keyring access denial that forces fallback re-init.
- **Fix sketch**:
  - Document the *exact* set of events that invalidate the session key (rust side) and clear `cachedPublicKey` on each.
  - Tag each session pubkey with a fingerprint/version; have `getSessionPublicKey` return `{pem, fingerprint}` and re-import when fingerprint changes.
  - Listen for a `session-key-rotated` Tauri event and call `clearCryptoCache()`.

## 2. `encryptWithSessionKey` failure indistinguishable from generic IPC error

- **Severity**: high
- **Category**: edge-case
- **File**: src/lib/utils/platform/crypto.ts:98-103, src/stores/slices/vault/credentialSlice.ts:73-97
- **Scenario**: `encryptWithSessionKey` wraps every error (PEM parse failure, WebCrypto failure, network error fetching pubkey, missing `window.crypto`) into a single generic `"Failed to encrypt sensitive data for IPC"`. `credentialSlice.createCredential` catches that and surfaces "Failed to create credential" via `reportError`. The user cannot tell whether the *credential value* is the problem or whether their **vault is offline / keyring locked**.
- **Root cause**: No discrimination between recoverable (retry pubkey fetch, retry keyring unlock) and unrecoverable (missing WebCrypto, malformed PEM) failures. The `cause` is preserved on the wrapped Error but never read by callers — both paths just call `reportError`.
- **Impact**: When the OS keyring is denied (e.g., user dismissed macOS Keychain prompt, gnome-keyring not running), the user gets "Failed to create credential" with no actionable fix. They retry → fails again → file a bug.
- **Fix sketch**:
  - Add an error taxonomy: `KeyFetchError` (recoverable), `KeyImportError` (config), `EncryptError` (transient).
  - Surface keyring-denial errors with a banner that includes "open keyring settings" guidance.

## 3. Manual healthcheck race window is 30s but bulk concurrency is 3 — TTL can elapse mid-bulk

- **Severity**: high
- **Category**: magic-number
- **File**: src/features/vault/shared/hooks/health/useBulkHealthcheck.ts:32, 87, 100-125
- **Scenario**: `FRESH_RESULT_TTL_MS = 30_000` defines the freshness window where a recent manual test result is reused instead of re-probing. With `CONCURRENCY = 3` and N credentials, the first credentials checked at t=0 may be re-checked at t=29s by the manual user, then bulk picks them up again at t=31s and re-probes — exactly the race the comment says we're trying to avoid. The 30s value is unjustified relative to typical bulk-run duration.
- **Root cause**: The TTL was picked without measurement. There's no comment explaining why 30s was chosen vs. e.g. "duration of a full bulk run" or "max provider rate-limit window."
- **Impact**: A freshly-tested credential can still be flipped to "transient failure" mid-bulk, exactly the regression the code claims to prevent. The fix is correct in spirit but the constant is brittle.
- **Fix sketch**:
  - Document why 30s (e.g. "longer than median provider request, shorter than rate-limit window").
  - Consider making the TTL = `max(30s, expected bulk duration)` computed dynamically from `credentials.length / CONCURRENCY × avgLatency`.
  - Or: snapshot manual-test timestamps at bulk-start and never re-check anything in that snapshot, regardless of when bulk reaches it.

## 4. Optimistic credential append on create races with concurrent fetch

- **Severity**: high
- **Category**: edge-case
- **File**: src/stores/slices/vault/credentialSlice.ts:86-92, 99-119
- **Scenario**: `createCredential` appends the returned credential to the list. `updateCredential` replaces in-place. If a `fetchCredentials()` is in-flight when create resolves, the fetch's `set({ credentials, ... })` (line 65) overwrites the optimistic append, **dropping** the just-created credential — until the next fetch.
- **Root cause**: There is no ordering / generation token between `fetchCredentials` (full replace) and the optimistic mutators (append/replace). The "optimistic: …" comments justify the *good* path but ignore the interleaving with `init()` (useCredentialManagerState.ts:103-112) which fires at mount and on connector-definition changes.
- **Impact**: User creates a credential → switches view rapidly → fetch races → credential disappears from list until next reload. Particularly likely with the daily auto-test (`useCredentialManagerState.ts:115-129`) firing fetch during a busy session.
- **Fix sketch**:
  - Track an in-flight fetch token; ignore fetch results if a newer mutation has been applied locally.
  - Or: `fetchCredentials` should merge by id, not replace whole-list.
  - Document the optimistic-update contract explicitly in storeTypes.

## 5. `parse1PasswordOutput` silently drops fields labelled `"username"` — undocumented filter

- **Severity**: medium
- **Category**: undocumented-decision
- **File**: src/features/vault/sub_credentials/components/import/importTypes.ts:206
- **Scenario**: `if (field.value && field.label !== 'username')` silently filters out any 1Password field whose label is exactly `"username"`. There is no comment explaining why. Some integrations (e.g. SMTP creds, S3 access keys) legitimately store a username/access-key id that the user expects to import.
- **Root cause**: The reasoning ("usernames aren't secrets so don't import") was never written down. The literal-string `"username"` is also locale-fragile and case-sensitive.
- **Impact**: Users importing from 1Password get partial credentials (password but not username); they're left wondering whether the import is broken or 1Password is broken.
- **Fix sketch**:
  - Add a comment explaining the filter or remove it.
  - At minimum, surface filtered count in `errors` so users see "Skipped 5 username fields."
  - Use case-insensitive comparison.

## 6. `.env` parser silently skips entries with empty values, and merges multi-line values incorrectly

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/vault/sub_credentials/components/import/importTypes.ts:163-190
- **Scenario**: `parseEnvFile` splits by `\n`, processes each line independently, and only pushes the secret `if (key && value)`. A `.env` line like `PRIVATE_KEY="-----BEGIN ...\n...\n-----END ..."` (genuine multi-line PEM) is broken into separate lines, all of which become invalid (no `=`). A line like `OPTIONAL_VAR=` (intentionally empty) is silently dropped.
- **Root cause**: Naive parser; no support for multi-line quoted values or escape sequences. No documentation of what subset of `.env` is supported.
- **Impact**: PEM keys, JSON blobs, multi-line tokens fail to import without explicit error. User believes import succeeded but the credential is missing fields.
- **Fix sketch**:
  - Document the supported `.env` subset (single-line values only).
  - Detect quoted values that don't close on the same line and emit an explicit error.
  - Optionally support `dotenv`-spec multi-line via an opt-in flag.

## 7. Rotation interval default of 90/1 days hardcoded with no policy basis

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/vault/sub_credentials/components/features/RotationPolicyControls.tsx:41
- **Scenario**: `initialDays={rotationStatus.rotation_interval_days ?? (isOAuth ? 1 : 90)}`. OAuth credentials default to **1 day**, API keys default to **90 days**. No reference to a security policy, NIST guideline, or product decision.
- **Root cause**: Defaults invented inline. 1 day for OAuth is aggressive (most providers' refresh-tokens last weeks); 90 days for API keys is conservative but the choice was never recorded.
- **Impact**: Future contributor who tweaks defaults without context may unintentionally weaken security posture or trigger user-visible re-auth churn.
- **Fix sketch**:
  - Move both constants into a documented module (`ROTATION_DEFAULTS = { oauth: 1, apiKey: 90 }`) with a comment citing the rationale.
  - Allow per-connector overrides via connector metadata.

## 8. `useUndoDelete` swallows event-count fetch errors and ships unverified UI

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/vault/shared/hooks/useUndoDelete.ts:22-30
- **Scenario**: When `listCredentialEvents` fails (network, IPC error, backend unavailable), the dialog opens with `eventCount: 0, eventCountVerified: false`. The dialog renders an "unverified_warning" subtitle, but the user can still proceed and delete — possibly losing N events they didn't realize existed.
- **Root cause**: The decision to allow proceeding through unverified state isn't documented. Users may interpret the warning as "we're being cautious," not as "we couldn't check, you might lose data."
- **Impact**: Silent data loss possible — credential delete cascades to events server-side; if the user proceeds based on a bogus 0 count, they may delete N alerts/events they expected to preserve.
- **Fix sketch**:
  - Disable the confirm button when `eventCountVerified === false`, with a "Retry count" action.
  - Or: document explicitly that proceeding deletes any associated events regardless of the displayed count.

## 9. `clientSecret` "redacted" via destructure-and-discard but kept in pendingValuesRef

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/features/vault/shared/hooks/useCredentialOAuth.ts:26-62
- **Scenario**: The comment claims `pendingValuesRef` avoids exposing `client_secret` "via React DevTools, Sentry, and error boundary serialization." But `pendingValuesRef.current = values` (line 68) **stores the entire values object including `client_secret`**. The destructure at line 42 only filters secret out from the *outgoing* `credentialData` — not from the ref itself. Refs ARE inspectable in React DevTools.
- **Root cause**: Misunderstanding of what refs hide. They're not React state, but they're absolutely visible to DevTools, breakpoints, error-boundary `componentDidCatch(error, info)` payloads (if components serialize their refs), and any code that closes over the hook's return value.
- **Impact**: False sense of security. A future contributor reads the comment, assumes secrets are sanitized, and adds a Sentry call that captures the ref. Or DevTools opens and the secret is visible during demo/debug. The fix path is unclear because the comment is technically false but plausibly persuasive.
- **Fix sketch**:
  - Either remove `client_secret` from the ref immediately after `googleOAuth.startConsent` is called, since it's only needed once during OAuth start.
  - Or explicitly nullify it: `pendingValuesRef.current = { ...values, client_secret: '' }` and restore from a more-protected store right before send.
  - Update the comment to reflect reality.

## 10. `migratePlaintextCredentials` failure path lies about what happened

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/vault/sub_credentials/components/card/badges/VaultStatusBadge.tsx:35-48, 164-173
- **Scenario**: On migration error: `setMigrationResult({ migrated: 0, failed: vault.plaintext })`. This claims **all** plaintext credentials failed, but the actual failure could be a partial success the backend already committed (e.g. it migrated 3 of 5, then errored on row 4). The user-facing toast "Encrypted 0, failed N" is wrong.
- **Root cause**: The catch block fabricates a result from stale `vault.plaintext` rather than calling `refreshVaultStatus()` to get the real post-error state.
- **Impact**: User sees "0 migrated", may click again — duplicate runs are likely safe but the messaging gaslights them into thinking nothing happened. Actual migrated count is hidden until manual refresh.
- **Fix sketch**:
  - Always `await refreshVaultStatus()` in the catch, and compute `migrated = before.plaintext - after.plaintext`.
  - Display "Partial: encrypted M of N, failed K. Try again or restart."

## 11. `parseAnomalyFromMetadata` typed loosely — schema drift goes undetected

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/vault/shared/hooks/health/useRemediationEvaluator.ts:42-51, 76-82
- **Scenario**: Metadata is parsed as `{ anomaly_score?: { remediation: string } }`. If the backend changes the field name, adds a discriminator, or moves the data into a sub-object, the fast-path silently degrades — `embeddedRemediation` is undefined, `getRotationStatus` is never called for that credential, and remediation actions silently stop firing.
- **Root cause**: No runtime validation, no schema version check, no fallback to "always fetch full status." Skip-if-healthy is an optimization but the failure mode is "skip everything, look fine."
- **Impact**: A backend metadata refactor causes the entire remediation loop to no-op without any error signal. Auto-rotate/auto-disable just stop happening — exactly the safety net the user is depending on.
- **Fix sketch**:
  - Validate parsed shape with Zod or a hand-written guard; log on validation miss.
  - Fall back to `getRotationStatus` when metadata is missing or unrecognized (slower but safe).
  - Document the metadata schema version expectation.

## 12. 60-second rotation ticker drifts during tab background; "Due now" can lag for hours

- **Severity**: low
- **Category**: edge-case
- **File**: src/features/vault/shared/hooks/useRotationTicker.ts:18-21, 55-64
- **Scenario**: `setInterval(..., 60_000)` is throttled aggressively when the Tauri window is in background. When the user returns, "Due now" countdowns may show stale values until the next 60s tick. `formatCountdown` is pure and recomputes correctly, but only fires on tick.
- **Root cause**: No `visibilitychange` listener forcing an immediate recompute. The shared-ticker pattern is good, but the implicit assumption ("60s of staleness is fine") doesn't hold when the app backgrounds for an hour and a rotation deadline elapses in that window.
- **Impact**: User opens the app expecting to see "Due now" for an expired credential, sees "12h left" briefly, gets confused. Not a security issue (rotation is backend-driven) but UX surprise.
- **Fix sketch**:
  - Subscribe to `document.visibilitychange` and call `tickerCache.notify()` on `visible`.
  - Optionally drop tick to 30s or align to wall-clock minute boundaries.
