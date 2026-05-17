# Perf-Optimizer Scan — OAuth, Discovery, Foraging & API Proxy

> Project: Personas (frontend-only)
> Scope: 4 API client files
> Total: 5 findings (0 critical / 2 high / 2 medium / 1 low)

## Scope notes
The 4 API files are thin `invoke` wrappers with no client-side caching or
deduplication layer. Most perf issues live one level up, in the hooks that
call these wrappers (`useOAuthPolling`, `useCredentialForaging`, `CatalogAutoSetup`,
`AutoCredPanel`, `TauriPlaywrightAdapter`). Findings target the wrapper API
surface plus the immediate caller pattern where a wrapper-level change would
fix it cleanly.

## 1. `checkPlaywrightAvailable()` re-runs on every mount of `AutoCredPanel` AND `CatalogAutoSetup` with no cache; result never changes within a session
- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/api/vault/autoCredBrowser.ts:27`
- **Scenario**: User opens the AutoCred wizard. `CatalogAutoSetup` fires
  `checkPlaywrightAvailable()` in `useEffect` (CatalogAutoSetup.tsx:69). It
  then renders `<AutoCredPanel/>`, which fires `checkPlaywrightAvailable()`
  again in its own `useEffect` (AutoCredPanel.tsx:42). Each Tauri IPC round-trip
  spawns a Rust task and (on first call) probes for the Playwright binary.
  In dev StrictMode every effect runs twice, so a single wizard open issues
  4 calls. Re-opening the wizard re-runs all 4.
- **Root cause**: The wrapper returns a fresh `Promise<boolean>` on every
  call. There is no module-level memoization despite the result being a
  process-lifetime constant (Playwright is either installed or not).
- **Impact**: 4× IPC + filesystem probe on every wizard open. Each probe
  forks/execs a subprocess to detect Playwright availability — measurably
  slow on cold cache and over-eager given how often the panel mounts.
- **Fix sketch**: Memoize at the wrapper level:
  ```ts
  let playwrightAvailablePromise: Promise<boolean> | null = null;
  export function checkPlaywrightAvailable(): Promise<boolean> {
    if (!playwrightAvailablePromise) {
      playwrightAvailablePromise = invoke<boolean>('check_auto_cred_playwright_available');
    }
    return playwrightAvailablePromise;
  }
  ```
  Expose a `resetPlaywrightAvailableCache()` for the edge case of users
  installing Playwright mid-session via the in-app installer.

## 2. `importForagedCredential` is awaited sequentially in a `for` loop instead of `Promise.all`
- **Severity**: high
- **Category**: async-coordination
- **File**: `src/api/vault/foraging.ts:15` (called from `useCredentialForaging.ts:102-117`)
- **Scenario**: User runs credential foraging, gets back N credentials
  (browser cookies, CLI tokens, env vars), bulk-selects them, clicks Import.
  The loop awaits each `importForagedCredential` one at a time, even though
  the backend command is independent per ID (writes a row to vault DB).
- **Root cause**: `for (const cred of toImport) { await importForagedCredential(...) }`
  serializes IPC trips. With N credentials and ~30–80 ms IPC + encrypted
  write per call, total time is O(N × latency) instead of O(latency).
- **Impact**: Scales linearly with credential count. With 10 foraged creds
  selected (common after a full system scan) this is 300–800 ms of pointless
  blocking; the user stares at a spinner.
- **Fix sketch**: Either run in parallel:
  ```ts
  const results = await Promise.allSettled(
    toImport.map((cred) =>
      importForagedCredential(cred.id, `${cred.label}${nameSuffix}`, cred.service_type)
        .then((r) => ({ cred, result: r }))
    )
  );
  ```
  …or, if the backend has per-vault contention, add a bulk variant
  `importForagedCredentialsBatch(ids[])` so encryption + DB write happens
  in one Rust task. Streaming `setImportingIds` updates already happen
  per-iteration, so emit them as each `Promise.allSettled` settles.

## 3. `scanCredentialSources()` and `startCredentialNegotiation()` have no `AbortSignal` — orphaned scans on rapid wizard re-mount
- **Severity**: medium
- **Category**: duplicate-call
- **File**: `src/api/vault/foraging.ts:12`, `src/api/vault/negotiator.ts:11`
- **Scenario**: User opens the foraging panel, immediately closes it (or
  the wizard re-mounts due to React StrictMode / parent re-render). The
  in-flight `scan_credential_sources` IPC keeps running on the Rust side
  (browser cookie sniff, CLI keyring scan, env probe — expensive). When
  it resolves, the result is dropped because the hook unmounted, but the
  cost was already paid and the *next* mount kicks off a fresh scan.
- **Root cause**: The wrappers accept no signal, and `invokeWithTimeout`
  has no way to cancel an in-flight Tauri command from the JS side. The
  hook (`useCredentialForaging`) does guard against concurrent calls via
  `scanningRef`, but does **not** abort a pending scan when the component
  unmounts. Same shape applies to `startCredentialNegotiation` — it spawns
  AI planning that runs to completion regardless of caller lifetime.
- **Impact**: Wasted Rust CPU + LLM tokens on every accidental remount,
  and 1–10s of latency on the next legitimate scan. Worse under dev
  StrictMode where every component mounts twice.
- **Fix sketch**: Two options. (a) Add an explicit cancel command pair
  (negotiator already has `cancelCredentialNegotiation()` — add
  `cancelCredentialScan()` and call it from `useCredentialForaging`'s
  cleanup). (b) Plumb `AbortSignal` through `invokeWithTimeout` so the
  wrapper signature becomes
  `scanCredentialSources(signal?: AbortSignal)` and the hook does
  `useEffect(() => { const c = new AbortController(); ...; return () => c.abort(); }, [])`.

## 4. `listOAuthProviders()` has no module-level cache — fetches the same provider catalog every time
- **Severity**: medium
- **Category**: duplicate-call
- **File**: `src/api/vault/oauthGatewayApi.ts:40`
- **Scenario**: Searching the call sites, `listOAuthProviders` is exported
  but invoked from the OAuth picker UI; the provider list (Google, GitHub,
  Microsoft, …) is effectively static for the runtime of the app. Each
  picker open round-trips through Tauri to fetch and JSON-deserialize the
  catalog.
- **Root cause**: No cache + the result is a serialized `OAuthProviderListResult`
  with all provider configs and scope catalogs — non-trivial JSON parse.
  When the picker is mounted inside a modal that re-mounts on every open
  (a common pattern in this codebase per `CatalogAutoSetup` re-rendering),
  the cost repeats.
- **Impact**: Mostly UI snappiness — a 30–60 ms hitch every time the OAuth
  provider picker opens. Compounds with finding #1 when both fire together
  during wizard mount.
- **Fix sketch**: Same memoization pattern as #1:
  ```ts
  let providersPromise: Promise<OAuthProviderListResult> | null = null;
  export const listOAuthProviders = () => {
    if (!providersPromise) {
      providersPromise = invoke<OAuthProviderListResult>('list_oauth_providers');
    }
    return providersPromise;
  };
  export const invalidateOAuthProviders = () => { providersPromise = null; };
  ```
  Invalidate on successful provider add/edit/delete.

## 5. `refreshOAuthToken` has no in-flight dedup — concurrent expiry handlers can fire N parallel refresh storms
- **Severity**: low (today — only called from healthcheck/playground paths; would escalate to critical if used by an API proxy interceptor)
- **Category**: duplicate-call
- **File**: `src/api/vault/oauthGatewayApi.ts:59`
- **Scenario**: Grep shows `refreshOAuthToken` is exported but currently
  has no in-`src/` callers (the runtime token-refresh logic appears to
  live in `src-tauri/`). However, the wrapper as written is shaped to be
  called from many subscribers (playground, healthcheck retry, manual UI
  refresh button). If any caller fans out — e.g. multiple healthcheck
  tabs detect 401 simultaneously — each will independently call
  `refreshOAuthToken` with the same `refreshToken`. Some OAuth providers
  (Google, Microsoft) **rotate the refresh token** on each use, so the
  later requests will fail with `invalid_grant`, blowing away the user's
  credentials.
- **Root cause**: Wrapper is a naked `invoke`. No per-credential keyed
  in-flight promise cache, no debounce, no atomic guard.
- **Impact**: Today: micro (low call volume). If a frontend API proxy
  interceptor is added on top of this wrapper (which the context name
  implies is planned), this becomes a credential-loss bug under any
  burst of concurrent 401s.
- **Fix sketch**: Add an in-flight dedup keyed by `providerId + refreshToken`:
  ```ts
  const inflightRefresh = new Map<string, Promise<OAuthRefreshResult>>();
  export const refreshOAuthToken = (params: {...}) => {
    const key = `${params.providerId}:${params.refreshToken}`;
    const existing = inflightRefresh.get(key);
    if (existing) return existing;
    const p = invoke<OAuthRefreshResult>('refresh_oauth_token', { ... })
      .finally(() => inflightRefresh.delete(key));
    inflightRefresh.set(key, p);
    return p;
  };
  ```
  Also add a short success-cache window (~30 s) keyed on `providerId`
  so an immediately-following caller gets the just-issued access token
  instead of trying to refresh again with the now-rotated refresh token.
