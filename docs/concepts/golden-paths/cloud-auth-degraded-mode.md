# Golden path — Cloud-auth degraded mode

> Situation node: `backend-runtime/command-authorization/cloud-auth-degraded-mode` · [situation spine](../situation-spine.md)
> `sides: both` · recurrence **54** · dimensions: **resilience · security · function · ui · cost**.
> Composed 2026-08-14 against `master` @ `2a874e692` from a ground-truth sweep of all **963**
> `.rs` files under `src-tauri/` (**1,661** `#[tauri::command]` definitions parsed, not grepped —
> the walk independently reproduces every figure in [`shared-facts.json`](../shared-facts.json)),
> the whole identity/cloud corpus (`ipc_auth.rs`, `commands/infrastructure/auth.rs`,
> `.../cloud.rs`, `.../cloud_sync.rs`, `.../gitlab.rs`, `cloud/{client,runner,config}.rs`,
> `cloud/sync/**`, `cloud/remote_commands.rs`, `engine/{oauth_refresh,connector_strategy,api_proxy}.rs`,
> `core/src/error.rs`, `core/src/http_clients.rs`), the 5 `local_http` routers, and the frontend
> half (66 direct cloud-command invoke sites in 5 files, 115 caller occurrences across 20 files,
> `errorRegistry.ts`'s 62 rules, `useTranslatedError.ts`'s 65 rules, `tauriInvoke.ts`, `eventBridge.ts`,
> `authStore.ts`). Convergence checked against `../personas-cloud` and `../brainiac`.
> **No `cargo` command was run** — a PreToolUse guard blocks it and the operator's app is running;
> every claim below is derived by reading and parsing source. `src-tauri/target/**` and
> `.claude/worktrees/**` excluded.
> The **Deviations** section is a fix backlog.

**Adjacent leaves — do not absorb them here.** Choosing a tier at all is
[`ipc-command-authorization`](./ipc-command-authorization.md); product-tier visibility is
[`tier-and-capability-gating`](./tier-and-capability-gating.md); which loading state a fetching
surface renders is [`overview-loading`](../../design/overview-loading.md). **This path owns exactly
one question: what happens, on both sides of the IPC boundary, when the cloud identity behind
`#[requires(cloud)]` is absent, stale, revoked, or unreachable.**

---

## ⚠ Five corrections to the brief that commissioned this path

1. **`CLOUD_COMMANDS` has 50 entries, not 56.** The 56 in `shared-facts.json`
   (`rust.requiresCloud`) is the count of `#[requires(cloud)]` **annotations**, not of list
   entries — the same distinction that made `requiresPrivileged: 168` differ from the list's 184.
   Measured by parsing both: **56 annotations** (35 in `cloud.rs`, 18 in `gitlab.rs`, 2 in
   `cloud/remote_commands.rs`, 1 in `cloud_sync.rs`) against **50 list entries**
   (`ipc_auth.rs:763-822`). The brief's other half is confirmed: `ipc-command-authorization.md`
   recorded 45 entries and 11 unlisted annotations, so **exactly 5 were promoted** and 6 remain.
2. **The enforcement asymmetry is INVERTED for cloud relative to privileged, and the brief
   inherited the privileged intuition.** For `privileged`, the *list* enforces and the annotation
   documents. For `cloud` the **annotation** enforces — `#[requires(cloud)]` prepends
   `require_cloud_auth(&state, "…").await?` as the first statement of the body
   (`macros/src/lib.rs:80-82`) — and the *list* adds the IPC-token check on top. So an annotated
   command missing from `CLOUD_COMMANDS` is **not** silently public; it still refuses without a
   Google session. This is why all 6 unlisted ones behave the opposite of how the code comments
   describe them (§7 A).
3. **REFUTED: no cloud-authenticated capability is reachable through `dev_tools_http.rs`.** The
   31 unconditionally-mounted loopback routes (`dev_tools_http.rs:70-100`, `lib.rs:969-972`) are
   confirmed, but the file contains **zero** occurrences of `cloud`, `gitlab`, `smee`,
   `state.auth`, `access_token` or `require_cloud`. Widening the check: **none of the five
   `local_http` routers** (`lib.rs:945,:950,:958,:965,:969`) references `state.auth`,
   `cloud_client`, or `access_token` — 0 hits each. The stronger positive result:
   **`require_cloud_auth` is the only guard in this app that `test_automation.rs`'s `POST /eval`
   cannot forge**, because it reads server-side `AppState` rather than a caller-supplied header,
   which `window.__IPC_TOKEN` can always supply. The cloud tier is the one tier whose threat model
   survives the webview.
4. **PARTIALLY REFUTED: "offline is handled *nowhere*."** `navigator.onLine` is 0 in `src/`,
   `addEventListener('offline')` is 0, and there is no banner — all confirmed. But two offline
   surfaces do exist: an amber `OFFLINE` pill beside the user's name
   (`AccountSettings.tsx:199-203`, the *only* consumer of `isOffline`) and a `Warn`-status
   "Google Account … (offline mode)" row in the health bundle (`system/health.rs:596-610`). Both
   are destinations the user must already have navigated to. The accurate statement is not
   "offline is unhandled" but **"offline is reported in two places nobody is looking at, and acted
   on in none."**
5. **STALE INHERITED CONTEXT: `ipc-command-authorization.md` §9 items 1 and 2 have since been
   BUILT.** That document proposed extending the drift guard to `async` and replacing
   commented-out omissions with a typed exemption table. Both exist today:
   `every_requires_annotation_is_listed_or_baselined` (`ipc_auth.rs:1156-1213`) walks
   **annotations** rather than call sites, covers sync *and* async, privileged *and* cloud, asserts
   its own instrument first (`found.len() > 150`, `:1164-1169`), and reads a typed
   `DRIFT_BASELINE: &[(&str, &str)]` (`:1076-1111`) whose every entry carries a written reason and
   which "may only shrink" (enforced at `:1198-1212`). That doc's Gaps 1 and 3 and its Deviations
   A/C counts should be re-derived before they are cited again. **The gate exists. What it cannot
   see is this leaf** — §9.

---

## 1. Trigger

- "What happens to this if the user is signed out?" / "…if they're on a plane?"
- "Add a `cloud_*` command" / "call the orchestrator from here"
- "Why did sync silently stop?" / "Why does it say *Synced 0 records* when nothing synced?"
- "The user's session expired and the app didn't notice"
- "Should we retry this? It's returning 401 over and over"
- "Cloud features are unavailable in offline mode" / "Sign in with Google to use cloud features"

If you are about to type `require_cloud_auth`, `#[requires(cloud)]`, `state.auth.read()`,
`access_token.is_none()`, `.is_success()` on a response you attached a credential to,
`AppError::Cloud(format!(…))`, a `match … { None => return }` on a token, or a `tokio::time::interval`
around anything that talks to Supabase — you are in this situation.

---

## 2. The one way

**Decide, before you write the body, which of four outcomes each failure mode gets — refuse,
retry, re-authenticate, or defer — and make the credential's state a *type* the caller can match
on, never a presence test and never a formatted string.** Put `#[requires(cloud)]` on the command
(it is the only guard in the app that enforces independently of a hand-maintained list, and it
reads server-side state so no webview caller can forge it) **and** add the name to
`CLOUD_COMMANDS` so the IPC-token check applies as well. Then, at every HTTP boundary that carried
a credential, **branch on `StatusCode::UNAUTHORIZED` before you format anything**: return the
already-existing `AppError::OAuthRevoked` when the credential was rejected and
`AppError::NetworkOffline` when the transport failed — those two variants are the whole fix,
because each already carries a `kind`, an `ErrorCategory`, a retryability classification
(`tool_outcome.rs:114`) and a matching `errorRegistry` rule that renders correct user copy with
zero frontend changes. Treat an auth rejection as **terminal for the request and a trigger for
exactly one forced re-auth**, never as a retryable transport error: `api_proxy.rs:898-936` is the
shape to copy. A *background loop* may quietly defer when there is no credential; a *command the
user pressed a button to invoke* may not — it must return a typed refusal, and it must never
return `Ok(empty)` for "we could not ask", which is indistinguishable from "there is nothing".
Every transition into or out of a degraded state must emit `AUTH_STATE_CHANGED` with a state the
UI can act on, because a degraded mode nobody is told about is a fail-open bug wearing a warning
label. And never test a credential for presence when the same struct carries an expiry: `is_some()`
answers "did we ever have one", which is not the question.

---

## 3. Mandated primitives

**The guard**

- **`src-tauri/macros/src/lib.rs:57` — `#[requires(cloud)]`.** Prepends
  `crate::ipc_auth::require_cloud_auth(&state, "<fn_name>").await?` as the **first statement** of
  the body (`:80-82`); the command-name literal is derived from the `fn` ident (`:63-64`) so a
  rename cannot desync it. On a sync `fn` it is a compile error with a remedial message (`:83-90`).
  Requires a parameter literally named `state`. **56 uses, all adjacent to `#[tauri::command]`,
  all async, zero misplacements** — measured.
- **`src-tauri/src/ipc_auth.rs:566` — `require_cloud_auth`.** The one guard in this repo that
  enforces on its own. Reads `state.auth`, and — this is the part worth copying — it
  **distinguishes two refusals**: `"Cloud features are unavailable in offline mode. Reconnect to
  use this feature."` when `is_offline && user.is_some()` (`:573-581`) versus `"Sign in with
  Google to use cloud features."` when signed out (`:583-586`). It also emits a `tracing::info!`
  with the `user_id` on every success (`:594-599`), which is the only per-user audit trail on the
  cloud surface.
- **`.../ipc_auth.rs:763` — `CLOUD_COMMANDS: &[&str]`, 50 entries.** Membership unions into
  `is_privileged_command` (`:107`), so a listed command also gets the `x-ipc-token` check in
  `wrap_invoke_handler`. All 50 are registered in `generate_handler![]` and all 50 carry the
  annotation — measured, zero drift in that direction.

**The types — all four already exist, and the cloud surface uses none of them**

- **`src-tauri/core/src/error.rs:55` — `AppError::OAuthRevoked(String)`.** `#[error("OAuth grant
  revoked: {0}")]`, `kind: "oauth_revoked"` (`:197`), category `credential_error`. Matched by
  `errorRegistry.ts:570-577` → *"The connection's authorization was revoked. / Reconnect the
  account to grant access again."*
- **`.../error.rs:40` — `AppError::NetworkOffline(String)`.** `kind: "network_offline"` (`:192`),
  category `Network` (`:122`), and classified `Transport` + **retryable** by
  `engine/src/tool_outcome.rs:114`. Matched by `errorRegistry.ts:76-83` → *"You appear to be
  offline. / Check your internet connection and try again."*
- **`src-tauri/src/engine/connector_strategy.rs:513` — `is_revocation_error(body)`.** The
  classifier: `invalid_grant`, `unauthorized_client`, `interaction_required`, `consent_required`,
  `"Token has been expired or revoked"`, `"Token has been revoked"` (`:514-522`). Supabase's
  refresh endpoint returns `invalid_grant` on a dead refresh token, so this function already
  answers the identity path's hardest question and is never called from it.
- **`commands/infrastructure/auth.rs:86` — `AuthStateInner::is_token_expired()`.** Exists.
  Wall-clock rather than `Instant`, with the comment explaining why (`:68-71`: a monotonic deadline
  made an overnight-suspended session look valid). **It has exactly one caller** — `to_response()`
  at `:95`.

**The degraded-mode mechanics**

- **`engine/api_proxy.rs:898-936` — refresh-on-401, retry once, then stop. COPY THIS.** On
  `StatusCode::UNAUTHORIZED` from an OAuth connector it drops the per-credential lock, forces a
  real token exchange **bypassing the local expiry belief**, and retries exactly once; if the
  refresh fails it keeps the original 401 rather than masking it. The comment at `:891-897` states
  the principle this whole leaf turns on: *"an OAuth access_token that the local
  `oauth_token_expires_at` still marks valid can nonetheless be rejected by the provider … that
  staleness is the whole reason we 401'd."*
- **`engine/oauth_refresh.rs:41,:49,:53` — the three constants degraded mode needs.**
  `REFRESH_THRESHOLD_SECS = 900` (renew early), `STALENESS_CEILING_SECS = 604800` — **seven days**,
  past which a token needs re-auth rather than a refresh — and
  `REFRESH_BACKOFF_STEPS = [900, 3600, 14400, 86400]`. Plus the four reactions at
  `:119-138` / `:227-247`: `mark_needs_reauth`, `route_revocation_to_healing`,
  `emit_reauth_required`, `set_refresh_backoff`.
- **`cloud/runner.rs:31-110` — the bounded, backing-off, user-visible poll loop.** Exponential
  backoff from 800 ms capped at 30 s (`:57-65`), a `status: "warning"` event emitted on the *first*
  failure (`:104-113`), a hard stop at 10 consecutive errors with a real message (`:87-102`), and a
  `tracing::info!` when it recovers (`:70-76`). The best degraded-mode implementation in the repo.
- **`commands/infrastructure/auth.rs:815` — `spawn_session_refresh_loop`.** 60 s tick, renews at
  `REFRESH_LEAD_SECS = 300` before expiry, re-checks under `state.refresh_lock` (`:836-847`) so
  Supabase's refresh-token rotation cannot be double-consumed. `refresh_lock` + the
  post-lock re-check (`:723-731`) is the correct concurrency shape; keep it.
- **`event_name::AUTH_STATE_CHANGED`** + its single frontend listener
  (`src/lib/eventBridge.ts:188-224`, priority `critical`, 100 ms debounce). The only channel by
  which the backend can tell the UI its session state changed.
- **`src/features/vault/sub_credentials/components/card/banners/ReauthBanner.tsx`** — the frontend
  re-auth primitive that already exists (for *connectors*): a `role="alert"` banner naming the
  credential, a one-click **Reconnect** deep link (`:169-178`), self-resolution on
  `credential-reauth-resolved` (`:61-67`), and — the part most re-implementations miss —
  **rehydration from the persisted `needs_reauth` flag on mount** (`:78-103`), so a revocation
  discovered while the app was closed still surfaces.
- **`src/lib/tauriInvoke.ts:305` — `invokeWithTimeout`.** The only frontend caller. Note its
  limits: its one retry fires solely on the substring `"IPC authentication failed"` (`:544-555`),
  so no cloud rejection is ever retried, and the 90 s default timeout rejects with a message
  containing `"timed out"`, which *does* match `errorRegistry.ts:85` — so a hung cloud call is
  reported as slowness, never as an outage.

---

## 4. Steps

1. **Name the four failure modes before you write the call**, and give each an outcome:
   *no credential* → typed refusal (a command) or quiet defer (a loop);
   *expired credential* → one forced refresh, then retry once, then refuse;
   *revoked credential* → refuse, persist the fact, tell the user, back off;
   *transport down* → retry with backoff, bounded, and say so on the first failure.
   Four modes, four outcomes. If your answer to two of them is the same code path, you have a
   fail-open bug — that is the whole content of §7.
2. **Annotate `#[requires(cloud)]` on the line directly under `#[tauri::command]`, and add the
   name to `CLOUD_COMMANDS` in the same commit.** The annotation is what enforces; the list adds
   the IPC-token check. If you are deliberately leaving it off the list, add it to `DRIFT_BASELINE`
   (`ipc_auth.rs:1076`) with a reason — **and read §7 A first, because for the cloud tier that
   entry does not do what its neighbours' reasons say it does.**
3. **Never write `access_token.is_none()` as your validity test.** Ask
   `access_token.is_some() && !is_token_expired()` — the exact expression `to_response()` already
   uses at `auth.rs:95`. Presence answers "did we ever have one".
4. **At the HTTP boundary, branch on the status before you format the error.**
   ```rust
   if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
       return Err(AppError::OAuthRevoked(format!("cloud session rejected: {path}")));
   }
   ```
   and map `reqwest` connect/timeout failures to `AppError::NetworkOffline` (the pattern is already
   written at `auth.rs:331-337`). **Stop there — you do not need a new error variant, a new
   registry rule, a new i18n key or a new toast**: both variants already carry a `kind`, a
   category, a retryability classification and a rendering rule. One `if` lights up the whole chain.
5. **In a command, refuse; in a loop, defer — and never confuse them.** A background pass with no
   credential returns quietly (`cloud/sync/mod.rs:410-413` is the correct shape *for a loop*). A
   command must return `Err`, never `Ok(vec![])` — "we could not ask" and "there is nothing" must
   not serialise to the same JSON.
6. **Back off a failing refresh, and stop refreshing past the staleness ceiling.** Copy
   `REFRESH_BACKOFF_STEPS` and `STALENESS_CEILING_SECS` from `oauth_refresh.rs:49,:53` rather than
   re-deriving them. A fixed-interval retry of an auth failure is a lockout risk and a cost leak,
   and it is what the identity loop does today (§7 C1).
7. **Emit `AUTH_STATE_CHANGED` on every degraded-state transition, including the failures.** If
   you clear a token, set `is_offline`, or discover a revocation, the UI must be told in the same
   function. Emitting only on success is why the frontend's `isAuthenticated` can be stale for the
   whole life of a session (§7 D1).
8. **Stop.** No `navigator.onLine` (it reports link state, not reachability). No new error variant.
   No second auth guard inside a helper the command calls. No tier check — the product tier has no
   backend representation and is a different leaf.

### Can the primitive make the wrong call impossible? — answered, and the answer is YES three times

The contract asks this before §9. All three are type changes, none is a gate, and two of the three
are settled by convergence (§Convergence).

- **Make the token unreadable without its expiry. YES, and it is the highest-value change in this
  document.** `AuthStateInner.access_token` is a `pub Option<SecureString>` (`auth.rs:64`), so
  every consumer reaches in and pattern-matches on `Some`/`None`. **Measured: 6 reads outside
  `auth.rs`** — `ipc_auth.rs:490`, `ipc_auth.rs:572`, `cloud/sync/mod.rs:410`,
  `cloud/remote_commands.rs:80`, `cloud.rs:181`, `cloud.rs:241` — and **not one of the six consults
  `is_token_expired()`, whose only caller in the entire tree is `to_response()`.** Make the field
  private and expose exactly one accessor returning a three-state type:
  ```rust
  pub enum Credential<'a> { Live(&'a SecureString), Expired, Absent }
  pub fn credential(&self) -> Credential<'_>   // the ONLY way to reach the token
  ```
  Then "I forgot the expiry check" stops being expressible: a caller must handle `Expired` to get
  at the token, and the compiler enumerates the six sites for you. It also removes the
  "no expiry recorded means valid forever" branch (§5), because the token and its deadline stop
  being two independently-settable fields. This is the shape `FacetedDecisionTable`'s required
  `emptyTitle` gets its 3/3 real copy from (contract, "Prefer a type over a gate") — and it is the
  one clause in this document that **convergence does not support**, which is stated plainly in
  §Convergence rather than buried.
- **Make the auth/transport split a type at the HTTP boundary. YES, and the types already exist** —
  `AppError::OAuthRevoked` and `AppError::NetworkOffline`. This one needs no new type at all, only
  the discipline of step 4; the census rule in §9 is the ratchet that holds it while the 17 sites
  are worked down. The reason it is a *type* answer and not a gate answer is that
  `tool_outcome.rs:114` already routes on the variant: classifying correctly makes retry behaviour
  correct downstream **for free**, and classifying as `AppError::Cloud(String)` makes it wrong for
  free.
- **Make "we could not ask" unrepresentable as "there is nothing". YES.**
  `remote_command_list_pending` returns `Ok(vec![])` when there is no token
  (`cloud/remote_commands.rs:194-197`). Returning `Result<Vec<RemoteCommand>, AppError>` and
  actually erroring is the one-line version; the durable version is that any cloud *command*
  returning a collection must be unable to construct the empty-success value on the no-credential
  path. Two of its three siblings in the same file already do this correctly (`:235-237`, `:316-318`).

---

## 5. Anti-patterns

- **Treating a token's presence as its validity.** `require_cloud_auth` checks
  `auth.access_token.is_none()` (`ipc_auth.rs:572`) and nothing else, so an **expired** JWT passes
  every one of the 56 cloud guards and fails 30 ms later at the HTTP layer as an opaque string.
  The struct it reads carries `token_expires_at` and an `is_token_expired()` method four lines
  away. This is the single defect from which most of §7 descends — and `personas-cloud` reinvented
  it exactly, in the same product: `/health` reports `hasSubscription: oauth.hasTokens()`
  (`httpApi.ts:1589`), which is `this.tokens !== null` (`oauth.ts:272-274`), so the orchestrator
  reports healthy with a token its own dispatcher is already failing on.
- **Letting "no expiry recorded" mean "not expired".** `is_token_expired()` returns `false` for
  `token_expires_at: None` (`auth.rs:87-90`), so a token with no recorded expiry is valid forever.
  The four assignment sites always set both fields together, so this is an invariant held by
  convention rather than by type — but `test_to_response_authenticated` (`auth.rs:1107-1128`)
  constructs exactly that state and asserts `is_authenticated`, which **codifies the fail-open in a
  passing test**. `personas-cloud` has the identical branch — `if (payload.exp && payload.exp * 1000 < Date.now())` (`auth.ts:79`) — a JWT with no `exp` claim never expires, inside an
  otherwise strictly fail-closed verifier. Two independent implementations, same short-circuit.
- **Collapsing a credential rejection and an outage into one error string.** `AppError::Cloud(format!("… {status} {body}"))` is the repo's default and it destroys the only
  information the caller needs: a 401 must trigger re-auth and must **not** be retried; a 503 must
  be retried and must **not** trigger re-auth. 17 sites do this (§9 census rule), including the
  identity session's own refresh.
- **Retrying an auth failure on a fixed interval, forever.** `spawn_session_refresh_loop`
  (`auth.rs:815-855`) wakes every 60 s and re-attempts a refresh whenever the token is within
  5 minutes of expiry. On a permanently-dead refresh token the `Err` branch is a bare
  `tracing::warn!` (`:851`) that clears nothing and backs off nothing, so the loop hammers Supabase
  every 60 s for the life of the process. Its sibling `oauth_refresh.rs` faced the identical
  situation and wrote a four-step backoff for it (`:53`).
- **Returning `Ok(empty)` when you could not ask.** `remote_command_list_pending`
  (`remote_commands.rs:194-197`) renders as "no pending remote commands" when the truth is "no
  session". An empty success is the most expensive kind of fail-open, because it looks like an
  answer.
- **Changing degraded state without emitting an event.** `do_token_refresh`'s failure branch
  (`auth.rs:781-805`) emits `AUTH_STATE_CHANGED` **only** on the network-error-with-cached-profile
  path. Every other failure — a revoked refresh token, a 400, a keyring error — returns `Err` with
  no event, so the frontend's `isAuthenticated` stays `true` for the rest of the session.
- **Documenting a tier in a comment instead of asserting it.** Three comments in this surface are
  factually false today: `ipc_auth.rs:761-762` says `cloud_get_config` / `cloud_status` /
  `gitlab_get_config` "are public to allow startup without auth" (they carry `#[requires(cloud)]`
  and refuse); `cloud.rs:1380-1384` and the `CLOUD_COMMANDS` smee block say `smee_relay_delete`
  "Stays in `PRIVILEGED_COMMANDS_SET`" (it is in neither list). A comment cannot drift-check itself.
- **Reaching for `#[requires(auth)]` on a cloud-adjacent command.** Confirmed unchanged:
  `require_auth` (`ipc_auth.rs:537-539`) and `require_auth_sync` (`:477-479`) are unconditional
  `Ok(())`. `smee_relay_delete` and `smee_relay_list` call it and are gated by nothing.
- **Assuming the async `require_privileged` protects a cloud-adjacent command.** Also confirmed
  unchanged: after startup it can only return `Ok(())` (`:547-561`). `remote_command_list_pending`
  and `cloud_sync_status` carry it, are in no list, and have zero enforcement.
- **Leaving a stale credential in a long-lived client.** `CloudClient::set_user_token`
  (`cloud/client.rs:399`) has exactly **four** callers: `logout` (`auth.rs:688`, clears),
  `do_token_refresh` (`:774`), `handle_auth_callback` (`:975`), and the two connect paths
  (`cloud.rs:183,:243`). The offline transition at `auth.rs:795` clears
  `auth.access_token` but **never** clears the client's, so `require_cloud_auth` refuses new calls
  while an already-running `run_cloud_execution` keeps sending the dead JWT.
- **Aborting a token rotation on a keyring write failure.** `do_token_refresh` does
  `store_refresh_token(&token_resp.refresh_token)?` (`auth.rs:755`). Supabase has *already*
  rotated server-side at that point, so a `?` here discards a valid new token and leaves an invalid
  old one — permanent session death. `try_restore_session` handles the identical call with
  `if let Err(e) = … { warn }` (`:1015-1017`), and `oauth_refresh.rs:610-612` wraps the equivalent
  connector write in a transaction *specifically* to prevent "credential death".
- **Building offline detection on `navigator.onLine`.** It reports link-layer state, not
  reachability, and would be a fifth source of truth alongside `is_offline`,
  `is_offline_authenticated`, `cloudError` and the health bundle. The authoritative signal already
  exists and is backend-side; route the UI to it.

---

## 6. Evidence

**Adoption of the guard itself is excellent and should not be disturbed.** 56 `#[requires(cloud)]`
annotations, 100% adjacent to `#[tauri::command]`, 100% async (the macro makes sync a compile
error), 0 misplaced, 0 unregistered, 0 list entries without an annotation, 50 of 56 also listed and
the remaining 6 all recorded in `DRIFT_BASELINE`. **The hole is not in the guard. It is in
everything the guard hands off to.**

- **`engine/api_proxy.rs:898-936` — `execute_api_request`'s refresh-on-401. Copy this one.** The
  only place in the repo that treats a 401 as *information* rather than as a failure: force-refresh
  bypassing the local expiry belief, retry exactly once, preserve the original 401 if the refresh
  fails. Every clause of §2 is in these 38 lines.
- `engine/oauth_refresh.rs:117-139` (startup sweep) and `:223-247` (periodic tick) — the four
  reactions to a typed revocation, written twice, identically, on purpose: mark, route to healing,
  emit to the UI, back off. The identity path performs zero of the four.
- `engine/connector_strategy.rs:546-561` — where an untyped provider error becomes
  `AppError::OAuthRevoked`. Nine lines. This is the whole of step 4 in the connector world.
- `cloud/runner.rs:57-113` — bounded backoff + a `warning` event on the first failure + a terminal
  message naming the cause. The template for any polling loop that talks to the cloud.
- `ipc_auth.rs:566-599` — `require_cloud_auth`, and specifically its **two-refusal split**:
  offline-with-profile and signed-out get different messages. It is the only place in the app that
  models degraded identity as more than a boolean, and it is one `is_token_expired()` call away
  from modelling it correctly.
- `commands/infrastructure/auth.rs:706-734` — `refresh_session`'s lock discipline: acquire
  `refresh_lock`, then **re-check expiry under the lock** because a previous holder may already
  have refreshed. The comment (`:707-711`) explains that Supabase rotates on every use, so two
  concurrent refreshes would consume the same token. Correct, and the loop at `:836-847` repeats it.
- `commands/infrastructure/auth.rs:1035-1053` — `try_restore_session`'s failure branch: network
  error → offline with cached profile; **anything else → `clear_tokens()`**. A genuine fail-closed
  default, and the counter-example that makes `do_token_refresh`'s handling of the same failure
  (§7 C2) indefensible rather than merely unfinished.
- `src/features/vault/.../banners/ReauthBanner.tsx:78-103` — rehydrating a re-auth prompt from
  persisted state on mount, with the comment recording the 2026-07-17 smoke test that motivated it.
  This is what "tell the user their credential died" looks like when it is done. It exists for
  connectors and has no identity-session equivalent.
- `lib.rs:1795-1801` — `try_restore_session` is **spawned**, not awaited, during setup. The app
  boots fully with the network down. Cleared claim, and a deliberate local-first property worth
  protecting.

---

## 7. Deviations found

**Five categories, 22 individually-addressable items.** All ship green under `npm run check`
(incl. `census:check`, `check:contracts`, `tsc --noEmit`, `eslint src/`) and under the Rust drift
guard at `ipc_auth.rs:1156`, which passes while every item below is true.

### A. Six read-only commands are documented as Public and are the exact opposite — 6

The `CLOUD_COMMANDS` header comment (`ipc_auth.rs:761-762`) states: *"Read-only config/status
checks (cloud_get_config, cloud_status, gitlab_get_config) are public to allow startup without
auth."* `DRIFT_BASELINE` (`:1087-1092`) repeats the reasoning per entry — `"read-only config
read"`, `"read-only status"`, `"read-only diagnostic"`, `"read-only listing"`.

**All six carry `#[requires(cloud)]`, so the macro injects `require_cloud_auth` into the body and
they refuse without a Google session.** Omitting them from the list removed the *IPC-token* check,
not the OAuth check — correction 2. The exemption was recorded against the privileged tier's
semantics and applied to the cloud tier's.

| Command | Site | Why it matters |
|---|---|---|
| `cloud_diagnose` | `cloud.rs:301` | **The worst one.** It is the connection-troubleshooting tool — DNS, TCP, TLS, HTTP, API-compat, step by step (`:309-548`) — and it refuses to run unless the cloud identity already works. The tool for "why can't I connect" requires being connected. |
| `cloud_status` | `cloud.rs:554` | Queries orchestrator health. Unavailable exactly when you need it. |
| `cloud_get_config` | `cloud.rs:284` | Reads local config + `is_connected`. Called first by `cloudInitialize` (`cloudSlice.ts:154`). Only survives startup because the slice short-circuits on `!isAuthenticated` (`:151`). |
| `gitlab_get_config` | `gitlab.rs:157` | Same shape. |
| `gitlab_deployment_status` | `gitlab.rs:446` | Same shape. |
| `list_deployment_history_all` | `gitlab.rs:1223` | Same shape. |

Fix by deciding which layer the exemption belongs to: either drop the annotation (making them
genuinely public and matching the comment) or list them (making them fully gated and fixing the
comment). Do not leave a third state that neither the comment nor the baseline describes.

### B. Four commands on the cloud surface have zero enforcement — 4

Neither list, and an annotation that is a documented no-op:

| Command | Site | Annotation | Reality |
|---|---|---|---|
| `remote_command_list_pending` | `cloud/remote_commands.rs:191` | `#[requires(privileged)]`, async | `require_privileged` returns `Ok(())` post-startup. Lists another device's pending remote-execution approvals. |
| `cloud_sync_status` | `cloud_sync.rs:26` | `#[requires(privileged)]`, async | Same. Local read; low severity. |
| `smee_relay_delete` | `cloud.rs:1386` | none; body calls `require_auth` | `require_auth` is unconditional `Ok(())` (`ipc_auth.rs:537-539`). Deletes a relay row **and its cron schedule**. Its own doc comment (`cloud.rs:1380-1384`) asserts it *"Stays in `PRIVILEGED_COMMANDS_SET`"* — **measured: it is in neither list.** |
| `smee_relay_list` | `cloud.rs:1319` | none; body calls `require_auth` | Read-only; the false comment is the defect. |

### C. The identity refresh path — six defects the connector refresh path already solved — 6

Both paths refresh an OAuth token on a timer. They are in the same repo, ~1,000 lines apart, and
they agree on nothing.

| | Connector path (`engine/oauth_refresh.rs`) | Identity path (`commands/infrastructure/auth.rs`) |
|---|---|---|
| Revocation typed? | `AppError::OAuthRevoked` via `is_revocation_error` (`connector_strategy.rs:513,:554`) | **No.** Any non-2xx → `AppError::Auth(format!("Token refresh returned {status}: {body}"))` (`:342-344`) |
| Backoff on failure? | `REFRESH_BACKOFF_STEPS` 15 m→1 h→4 h→24 h (`:53`, `set_refresh_backoff` `:795`) | **No.** 60 s tick, forever (`:820-853`) |
| Staleness ceiling? | 7 days, past which re-auth not refresh (`:49`) | **No.** |
| User told? | `emit_reauth_required` → `ReauthBanner` with a Reconnect button | **No.** No event, no banner, no toast |
| Persisted? | `mark_needs_reauth` + `route_revocation_to_healing` (`:126-127`) | **No.** State is in-memory only |

**C1 — the retry loop.** `spawn_session_refresh_loop` (`:815-855`): once the token is within
5 minutes of expiry and the refresh keeps failing, `near_expiry` stays true forever and the loop
re-attempts every 60 s with a `tracing::warn!` and nothing else (`:849-852`). Against a revoked
refresh token that is ~1,440 requests/day to Supabase's auth endpoint from an app the user believes
is idle. A revoked-grant failure is exactly the class `oauth_refresh.rs:53` exists to back off.

**C2 — the same failure, two opposite handlings, 250 lines apart.** `try_restore_session`
(`:1035-1053`) treats a non-network refresh failure as terminal and calls `clear_tokens()`.
`do_token_refresh` (`:781-805`) treats it as transient: returns `Err`, clears nothing, emits
nothing, leaves the dead refresh token in the keyring and the expired access token in memory.
Startup fails closed; steady-state fails open.

**C3 — the offline transition is one-way.** `do_token_refresh`'s NetworkOffline branch sets
`is_offline = true` and `access_token = None` (`:789-796`). The refresh loop's precondition is
`access_token.is_some()` (`:827`). **Once offline, `near_expiry` can never again be true, so
nothing ever retries.** `refresh_session` — the command that would recover it — has **zero
frontend call sites** (it exists only in `commandNames.generated.ts:1279`). Recovery from offline
mode requires an app restart or a manual re-login. Measured, not inferred.

**C4 — the rotation abort.** `store_refresh_token(&token_resp.refresh_token)?` (`:755`). See §5.

**C5 — `is_offline` is never cleared except by a successful refresh.** There is no reachability
probe, no `online` listener, and no user-facing "retry connection" affordance anywhere in the app.

**C6 — an unset expiry reads as "never expires", and a passing test says so.** `is_token_expired()`
maps `token_expires_at: None` to `false` (`auth.rs:87-90`). All four assignment sites set token and
expiry together, so no live path reaches the state today — but nothing in the type prevents it, and
`test_to_response_authenticated` (`:1107-1128`) builds `access_token: Some(_)` with
`token_expires_at: None` and asserts `is_authenticated`. A test that pins the fail-open is worse
than no test, because it makes the correct fix look like a regression.

### D. The frontend cannot see, say, or react to any of it — 4

**D1 — nothing observes the session after startup.** `get_auth_state` is invoked at exactly one
site (`authStore.ts:40`, inside `initialize()`), called once at `App.tsx:222`. It is not polled.
The `auth-state-changed` listener (`eventBridge.ts:188-224`) has **one** conditional branch — the
*login* edge (`payload.is_authenticated && !prev.isAuthenticated`). The **expiry/logout edge is not
handled at all**: no redirect, no modal, no toast, no `clearCryptoCache()`. Combined with C2 (no
event on refresh failure), the frontend's `isAuthenticated` can remain `true` for the entire life
of a process whose backend has already given up.

**D2 — neither backend refusal string matches any error rule, in either registry.** Evaluated
against all 62 `ERROR_RULES` (`errorRegistry.ts:60-614`) and all 65 `ERROR_KEY_MAP` entries
(`useTranslatedError.ts:66-158`): `"Sign in with Google to use cloud features."` and `"Cloud
features are unavailable in offline mode. Reconnect to use this feature."` match **nothing**.
Note the near-miss: the offline rule keys on `/NetworkOffline|Network offline:/`
(`errorRegistry.ts:77`) and the phrase *"in offline mode"* satisfies neither alternative. Both land
in `GENERIC_FALLBACK` with `category: 'unclassified'` (`:620-624`), which makes
`ToastContainer.tsx:77-78` fall through to the **raw Rust sentence**, with no suggestion line and
no action button. A caller that passes a `customMessage` to `toastCatch` **discards the reason
entirely** (`silentCatch.ts:130-134`) — which is what `CloudSyncCard.tsx:105` does.
**The two registry rules that would render this correctly already exist and are unreachable:**
`'OAuth grant revoked'` (`:570`) and the offline rule (`:77`). Step 4 connects them.

**D3 — `translateCloudError` writes `[object Object]` into user-visible state.**
`deployTarget.ts:59` does `String(err).toLowerCase()`, but Tauri rejects with a plain object
(`src/lib/types/tauriError.ts:44-53`), so no pattern matches and the fallback at `:73` stores the
literal string `[object Object]` — surfaced at `CloudDeployPanel.tsx:67`. It feeds **17**
`cloudError` assignments in `cloudSlice.ts`; `translateGitLabError` (`:98`) has the same defect
across **36** `gitlabSlice.ts` sites. The unit tests only ever pass strings
(`deployTarget.test.ts:18,33,49`).

**D4 — "Sync now" reports success on a failed pass.** `CloudSyncCard.tsx:96-109` awaits
`cloudSyncNow()` and, on any `Ok`, unconditionally fires a **success** toast
(*"Synced {count} records"*). Because `cloud_sync_now` returns `Ok(status)` whenever
`require_cloud_auth` passed — even when all 12 upsert calls 401'd — a green toast and a red
error panel render from the same object in the same frame. Compounding it, the whole error region
is inside `{enabled && (…)}` (`:176`), so when the toggle is off a stored `lastError` is
**unrenderable**, and the per-table errors sit inside a section collapsed by default (`:38`).

### E. Silent no-ops and empty successes on the cloud surface — 2 (+1 correct)

Three functions in two files answer "no token" three different ways:

| Site | Behaviour | Verdict |
|---|---|---|
| `cloud/sync/mod.rs:408-414` | `None => return` — the pass no-ops | **Correct for a loop.** Documented at `:397-399` as "nothing to do, not an error" |
| `cloud/remote_commands.rs:128-131` | `None => return Ok(())` — background poll no-ops | Correct for a loop |
| `cloud/remote_commands.rs:194-197` | `None => return Ok(vec![])` — **a command** returns empty success | **Fail-open.** §5 |

And the fail-open that survives the guard: because `require_cloud_auth` never checks expiry, an
expired JWT reaches `run_sync_once`, `SyncClient` 401s on the device heartbeat plus all 11
`SYNC_TABLES` entries (`sync/mod.rs:57-69`) plus every pending tombstone delete, each failure is captured
into `LastTable.error` by the fault-isolation wrapper (`sync/mod.rs:226-235`), and
`cloud_sync_now` returns **`Ok`**. The fault isolation is good design — it is what stops one
table's failure stranding the others' cursors — but it converts a total auth failure into a
successful call whose payload nobody checks (D4). Meanwhile the loop retries every 45 s
(`:450`), so a dead session produces at least 12 rejected requests every 45 seconds indefinitely.

---

## 8. Gaps in the primitive

1. **`require_cloud_auth` cannot see expiry without an ownership change.** It reads
   `state.auth.access_token`, a public field on a struct whose expiry lives in a sibling field and
   whose only expiry-aware method is `to_response()`. Fixing the guard alone leaves the other five
   consumers wrong; the fix is the accessor type in §4, not a line in the guard.
2. **The macro can inject a guard but cannot classify the failure.** `#[requires(cloud)]` produces
   one refusal shape for the whole surface. It has no vocabulary for "expired, retry after
   refresh" versus "revoked, re-authenticate" versus "offline, defer", so every command inherits
   the coarsest of the three.
3. **There is no refresh-on-401 for the identity token.** `api_proxy.rs:898` implements it for
   *connector* credentials by calling `force_refresh_single_credential`. The identity equivalent
   would be `do_token_refresh` — which exists, takes the lock correctly, and has no caller on any
   401 path.
4. **`AppError` has no variant for "the credential is stale but recoverable".** `OAuthRevoked` is
   terminal, `NetworkOffline` is transport. A 401 that one refresh would fix is neither, and today
   it is `AppError::Cloud(String)`. `AuthorizationRequired { authorize_url }` (`error.rs:76-80`)
   is the closest existing shape and is scoped to MCP tools.
5. **`CloudClient` owns a token it cannot refresh.** It holds `user_token: RwLock<Option<String>>`
   and is pushed to from four places, none of which is a failure path. It cannot ask for a refresh
   and nothing tells it its token died (§5).
6. **The census runner cannot express "must be zero".** The most important assertion in this leaf
   — *no consumer of the identity token may read it without consulting its expiry* — is a
   must-never-happen with 0 legitimate instances, and a rule baselined at 0 is a gate that can
   never fail (`engine.mjs:264-273` refuses it by design). §9 item 2 specifies the test instead.
7. **`DRIFT_BASELINE`'s reason field is prose, so it cannot encode which layer an exemption
   applies to.** All six cloud entries say "read-only", which is a true statement about the command
   and a false implication about its gating (§7 A). A typed reason
   (`enum Exempt { ListOnly(&'static str), Public(&'static str) }`) would have made the category
   unrepresentable.
8. **Nothing can enumerate what degrades.** There is no function, test, or doc that answers "which
   of the 1,585 registered commands stop working when the user is signed out". The answer is
   derivable (56 annotations + 50 list entries) and nothing derives it.

---

## 9. The missing gate

Every deviation above ships green under `npm run check` **and** under the Rust drift guard at
`ipc_auth.rs:1156`, which is a genuinely good gate — it walks annotations rather than call sites,
covers both tiers and both `fn` shapes, asserts its own instrument before its result, and reads a
typed shrink-only baseline. **It is not missing and it is not broken. It answers "is this command
listed", and every defect in this leaf lives strictly downstream of that question.** Four items,
cheapest first: one census rule, one Rust test for the must-be-zero condition, one Vitest case for
the cross-language contract, and one refusal.

### 1. Census rule — `undiscriminated-credential-rejection`

**The condition (stack-free):** *an authenticated remote call folds every failure into one untyped
error, so neither the caller nor the user can distinguish an expired or revoked credential
(re-authenticate; do not retry) from an outage (retry with backoff; do not re-authenticate).*

**The proxy in this repo:** a credential is attached to a `reqwest` builder and, within the next
1,200 characters and with **no** `401` / `UNAUTHORIZED` / `is_client_error` / `status.as_u16()`
discrimination in between, the failure path constructs `AppError::<Variant>(format!("…{status}…"))`
— the status survives only as text.

**PRECONDITION, and an adopting repo must re-derive its own.** This keys on Rust's reqwest builder
idiom *plus* this repo's `AppError(format!)` construction. A repo whose HTTP layer already returns
a typed status (`raise_for_status`, a `Result<Response, HttpError>` with a `.status` field), or
whose errors are structs rather than format strings, scores **zero** here while the condition is
present at full scale.

**Checked against the existing registry first.** `scripts/census/rules.json` holds **56** rules.
The two nearest neighbours share a language and a root and nothing else:
`build-gated-ipc-entrypoint` keys on `#[cfg(…)]` immediately preceding a `commands::` entry inside
`generate_handler![]`; `blind-identity-write` keys on a repository `UPDATE`/`DELETE … WHERE id = ?`
whose row count is discarded, and is rooted at `src-tauri/db/src/repos`. Neither pattern shares a
token with this one. `undeclared-tier-branch`, named as adjacent in the brief, is TypeScript in
`src/` — no overlap of root, extension or signal.

```json
{
  "rules": [
    {
      "id": "undiscriminated-credential-rejection",
      "goldenPath": "docs/concepts/golden-paths/cloud-auth-degraded-mode.md",
      "title": "A remote call that carried a credential folds its non-2xx into an untyped message string, so no caller can tell \"the credential was rejected, re-authenticate\" from \"the service is down, retry\"",
      "roots": ["src-tauri/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "(?:\\.bearer_auth\\(|\\.header\\(\\s*(?:&?\"(?:[Aa]uthorization|apikey|PRIVATE-TOKEN|X-User-Token|x-api-key|X-Api-Key)\"|k\\s*,))(?:(?!\\.bearer_auth\\(|UNAUTHORIZED|\\b401\\b|is_client_error|\\.as_u16\\(\\))[\\s\\S]){0,1200}?AppError::\\w+\\(\\s*format!\\(\\s*\"[^\"\\r\\n]*\\{status\\}",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A credential is attached to an outbound request (bearer_auth / an Authorization|apikey|PRIVATE-TOKEN|X-User-Token|x-api-key header / a header rendered from credential fields) and, within the next 1200 characters and WITHOUT any 401 / UNAUTHORIZED / is_client_error / status.as_u16() discrimination in between, the failure path constructs AppError::<Variant>(format!(\"...{status}...\")) - i.e. the one datum that says whether the credential was rejected survives only as text inside a message. PROXY FOR the stack-free condition: an authenticated remote call collapses every failure mode into one untyped error, so neither the caller nor the user can distinguish an expired/revoked credential (re-authenticate, do not retry) from an outage (retry with backoff, do not re-authenticate). PRECONDITION AND ADOPTION NOTE: this proxy keys on Rust's reqwest builder idiom plus this repo's AppError(format!) construction. A repo whose HTTP layer already returns a typed status (Python's requests.raise_for_status, a Result<Response, HttpError> with a status field) or whose errors are structs rather than format! strings scores ZERO here while the condition is present at full scale - re-derive the proxy against the local HTTP client and error type. MEASURED 2026-08-14: 17 matches across 6 files, all 6 credentialed surfaces (engine/db_query.rs Supabase+Convex introspection 8; cloud/sync/client.rs, the whole PostgREST writer, 4; commands/infrastructure/auth.rs 2 - fetch_user_profile AND refresh_access_token, i.e. the identity session's own refresh; commands/core/persona_icon_gen.rs 1; engine/kpi_binding.rs 1; gitlab/client.rs 1). Zero false-positive FILES. KNOWN FALSE NEGATIVE, declared: cloud/client.rs - the CloudClient serving all 30 cloud_* commands - attaches its credential in authed() and checks status in send_json()/send_ok() via .error_for_status(), two functions apart, so no forward-anchored text matcher can join them; that site is covered by the test in section 9 item 2, not by this rule. Deliberately does NOT match a site that branches on 401 first (engine/api_proxy.rs, notifications.rs, companion/jobs/connector_use.rs) - those are the correct shape."
      },
      "baseline": { "files": 6, "matches": 17 },
      "floor": 500
    }
  ]
}
```

**Counts verified through two independent implementations before baselining, and they disagreed.**
The census regex reports **17 matches / 6 files**; a separately written line-oriented state machine
(walk forward from each credential-attachment line on a 1,200-character budget, accumulating a
window, breaking on any discrimination token) reports **19 / 6**. The delta reconciles exactly:

- **+3 in impl-2** — three requests attach *two* credential headers (`apikey` **and**
  `Authorization`) on consecutive lines: `db_query.rs:1021/1022`, `:1107/1108`, `auth.rs:298/299`.
  `exec` consumes the whole span, so the census counts one match per *collapse site*; impl-2 counts
  one per *attachment line*.
- **−1 in impl-2** — at `db_query.rs:2153` the intervening block is a 6-line multi-line string
  literal, so impl-2's character budget expires before reaching the error at `:2177` while the
  regex's `{0,1200}` does not.

19 − 3 + 1 = 17, and both implementations agree on **6 files** and on the same **17 distinct
collapse sites**. Recording the disagreement matters more than the number: the first version of
impl-2 returned **0/0**, because it tested each line in isolation and every one of these errors is
written as `AppError::X(format!(` on one line and the string on the next. A single-implementation
composition would have baselined a broken matcher at whatever it happened to find.

**Precision, measured against the real tree.** All 6 matching files are credentialed surfaces:
zero false-positive files. A broader variant of this signal (anchored on `.is_success()` instead of
on the credential) finds **32 matches / 10 files** — higher recall, but 3 of those files
(`gallery.rs`, which sends no auth header at all; `pocket.rs`, a loopback TTS sidecar; `twin.rs`,
arbitrary-URL ingest) carry no credential, so a 401 is not a possible outcome and flagging them
would be firing on correct content. The narrow signal is the one shipped.

**Shape discrimination, proven rather than asserted.** The negative-discrimination clause is
**inert on the current tree** — deleting the `UNAUTHORIZED|401|is_client_error|as_u16` stop-tokens
changes the result by exactly 0 files and 0 matches, because no site currently both discriminates a
401 *and* then folds `{status}`. It is a **forward** guarantee, and it was verified directly rather
than by inspection: inserting the §4 step-4 fix (a `StatusCode::UNAUTHORIZED` branch returning
`AppError::OAuthRevoked`) into `cloud/sync/client.rs`'s `upsert()` drops that file from **4 → 3**.
And the five files that already do the right thing score **0** each: `engine/api_proxy.rs`,
`notifications.rs`, `companion/jobs/connector_use.rs`, `engine/oauth_refresh.rs`,
`engine/connector_strategy.rs`. The rule keys on the absence of discrimination, not on the presence
of HTTP.

**No `exclude` entries.** Every candidate exemption would be a whole-file exclusion of a file that
contains other credentialed calls, which is how an allowlist becomes a hiding place.

**Fault injection against the real tree**
(`node scripts/census/run-census.mjs --check --rules <file>`), from a scratchpad file named
`census-clouddeg-7c21.json` unique to this composition:

| Fault | Exit | What it printed |
|---|---|---|
| clean run | **0** | `OK undiscriminated-credential-rejection 6 6 17 17 564 500` — surviving counts printed |
| matcher matches nothing (`NoSuchCloudAuthTokenZZQ`) | **1** | `[structural] matched zero files anywhere…` + both `[drift] dropped 6 → 0` / `17 → 0` |
| floor above walk (`floor: 9000`) | **1** | `[structural] walked 564 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (`roots` → `src-tauri/src/cloud`) | **1** | `[structural] walked 9 … floor is 500` + `files 6→1`, `matches 17→4` |
| count rises (baseline lowered to 4/9) | **1** | `[drift] matches rose 9 → 17 (+8)` |
| renamed root (`src-tauri/srcc`) | **1** | `walked 0 files but floor is 500` + `matched zero files anywhere` + both drops |
| count drops (baseline raised to 9/30) | **1** | `[drift] matches dropped 30 → 17 (-13) without the baseline moving` |
| stale `exclude` | **1** | `[structural] exclude "…" matched no file. The exemption is stale…` |
| `exclude` with a 9-char `reason` | **1** | schema refusal before any scan: `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |

All nine behave as the contract requires. Wall clock for the full run: **0.98 s** over 564 files —
the pattern is forward-anchored with a tempered-greedy body and contains no lookbehind.

#### Positive control — `cloud-auth-degraded-mode-positive-control`

Published **without a `baseline` and with a `positive-control` id suffix so the registry merge
skips it. Do not merge this into `rules.json`.** It gates nothing. It matches the one thing this
leaf cannot be wrong about — the cloud tier annotation itself — so a validation run can prove the
walker reached the command tree at all, which every other assertion here silently depends on.

```json
{
  "rules": [
    {
      "id": "cloud-auth-degraded-mode-positive-control",
      "goldenPath": "docs/concepts/golden-paths/cloud-auth-degraded-mode.md",
      "title": "POSITIVE CONTROL — not a gate. The cloud tier annotation itself.",
      "roots": ["src-tauri/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "#\\[requires\\(cloud\\)\\]",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "POSITIVE CONTROL — the merger must SKIP this entry (no baseline, `positive-control` id suffix). Matches the `#[requires(cloud)]` attribute wherever it appears in src-tauri/src. Measured 2026-08-14: 57 matches across 5 files — 56 real annotations (cloud.rs 35, gitlab.rs 18, remote_commands.rs 2, cloud_sync.rs 1, independently reproducing shared-facts.json's rust.requiresCloud) plus 1 non-comment occurrence inside the drift-guard test's own scanner at ipc_auth.rs:1129, which is the string the guard searches for. That 57-vs-56 gap is the control's whole point: it demonstrates that a text matcher over this tree counts the DETECTOR as well as the detected, which is exactly the kind of one-off a rule baselined without a second implementation inherits silently. Validated locally WITH a temporary baseline of {files:5, matches:57} (the runner's validateRule requires one); baselining it at 4/56 exits 1 with `files rose 4 -> 5` and `matches rose 56 -> 57`, and renaming its root to src-tauri/srcc exits 1 with `walked 0 files but floor is 500`."
      },
      "floor": 500
    }
  ]
}
```

**Both populations and their overlap.** The gate rule matches **17 sites in 6 files**
(`engine/db_query.rs`, `cloud/sync/client.rs`, `commands/infrastructure/auth.rs`,
`commands/core/persona_icon_gen.rs`, `engine/kpi_binding.rs`, `gitlab/client.rs`); the positive
control matches **57 sites in 5 files** (`commands/infrastructure/cloud.rs`,
`commands/infrastructure/gitlab.rs`, `cloud/remote_commands.rs`,
`commands/infrastructure/cloud_sync.rs`, `ipc_auth.rs`). **The two populations are fully
disjoint — zero shared files and therefore zero shared matches.** Note the near-miss pairs that
make this a real result rather than a coincidence: `gitlab.rs` (18 annotations, 0 gate matches)
against `gitlab/client.rs` (0 annotations, 1 gate match), and `cloud.rs` (35 annotations, 0 gate
matches) against `cloud/sync/client.rs` (0 annotations, 4 gate matches). That disjointness is
itself a finding, and it is the structural reason §9 needs both halves: **the commands that declare
the cloud tier and the code that actually talks to the cloud live in different files, so no gate
keyed on the annotation — including the existing drift guard at `ipc_auth.rs:1156` — can ever
observe how a call behaves when the identity fails.**

### 2. The must-be-zero assertion, as a Rust test (~30 lines, in `commands/infrastructure/auth.rs`)

The census engine refuses a rule baselined at zero, correctly (`engine.mjs:264-273`). This leaf's
sharpest condition has zero legitimate instances, so it needs a test:

> **No consumer of `AuthStateInner::access_token` may read it without consulting its expiry.**

Implement it the way `ipc_auth.rs:1113` already implements a source walk — scan `src/` for reads of
`.access_token` outside `auth.rs`, and assert each is within a span that also mentions
`is_token_expired` or `token_expires_at`. **Today it fails on all six**
(`ipc_auth.rs:490,:572`, `cloud/sync/mod.rs:410`, `cloud/remote_commands.rs:80`, `cloud.rs:181,:241`),
so seed it with an explicit six-entry shrink-only baseline in the shape of `DRIFT_BASELINE`, and
delete the test the day the accessor type in §4 lands — at which point the compiler enforces it and
the test is redundant. **That is the correct end state: the gate is scaffolding for a type change,
not a substitute for one.**

**How it fails loudly if its own precondition is absent** — copy the shape from `ipc_auth.rs:1164`,
which this repo already treats as the model:
`assert!(reads_found >= 6, "expected at least 6 access_token reads, found {} — the source walk is broken, not the codebase suddenly correct")`, plus
`assert!(!files_scanned.is_empty())`. A walk that parses to nothing must not read as compliance.

In the same test module, add the two assertions the census rule cannot reach:

- **`cloud/client.rs` must not use bare `.error_for_status()`.** It is the declared false negative:
  the `CloudClient` serving 30 `cloud_*` commands attaches its credential in `authed()` (`:409-420`)
  and checks status in `send_json`/`send_ok` (`:423-445`), two functions apart. Assert that
  `send_json` and `send_ok` contain `StatusCode::UNAUTHORIZED`.
- **Every `#[requires(cloud)]` command's own doc comment must not claim it is public.** The six
  §7 A commands are the live failure. Cheaper alternative: assert
  `DRIFT_BASELINE.iter().filter(|(n, _)| CLOUD_ANNOTATED.contains(n)).count() == 0` once §7 A is
  resolved, which makes the wrong-layer exemption unrepresentable rather than merely counted.

### 3. Vitest case for the cross-language contract (~15 lines)

`ipc_auth.rs:576-586` owns two rejection literals and `errorRegistry.ts` matches neither (§7 D2).
Read both literals out of `src-tauri/src/ipc_auth.rs` **at test time** and assert
`resolveError(literal).category !== 'unclassified'` for each. Reading the Rust source rather than
duplicating the strings is the load-bearing part: it fails when the backend message changes, which
is the direction this contract actually breaks. Add the matching rules **above** the generic
`'Forbidden'` rule — `resolveError` returns the first match (`errorRegistry.ts:640-654`) and
ordering is behaviour. In the same change fix `translateCloudError` /`translateGitLabError`
(§7 D3) to read `err.error` off the envelope rather than `String(err)`, and add an envelope-shaped
case to `deployTarget.test.ts`, whose three existing cases pass only strings.

### 4. REFUSED — a gate on "a degraded state was entered without emitting an event"

This is the second-highest-value condition in the leaf (§7 C2, D1: the frontend can believe it is
signed in for the whole life of a dead session) and neither the census runner nor an ESLint rule
can host it. Measured, in ascending order of fatality:

1. **It is a property of a control-flow path, not of a token.** The defect is that *one* of
   `do_token_refresh`'s three exit paths emits `AUTH_STATE_CHANGED` and the other two do not. A
   text matcher sees a file that contains `app.emit(event_name::AUTH_STATE_CHANGED, …)` — which is
   true, and useless.
2. **The negative is what matters and a census rule counts positives.** A rule matching "a function
   that writes `auth.is_offline` without an `emit`" would need the absence of a token inside a
   function body whose extent the engine does not model.
3. **The receiving half is in another language.** Even a perfect Rust-side gate would not catch
   D1, where the event *is* emitted and the listener has no branch for the edge. That is a property
   of `eventBridge.ts:188-224`'s conditional, and any regex for "an if-statement that handles one
   polarity of a boolean" flags every guard clause in the codebase.
4. **The correct fix removes the condition rather than detecting it.** Make `AuthStateInner`'s
   mutations go through one `fn transition(&mut self, next: AuthPhase, app: &AppHandle)` that emits
   as its last statement. Then "changed state without telling anyone" is unrepresentable, and there
   is nothing left to gate — the §4 answer again.

**Specify instead** a Vitest case beside item 3 that asserts `eventBridge`'s `auth-state-changed`
handler dispatches on **both** edges: feed it a `prev.isAuthenticated: true` → `payload.is_authenticated: false` transition and assert an observable consequence
(`clearCryptoCache` called, or a session-expired action dispatched). That converts "detect the
missing branch" into "the branch is the only way the reducer type-checks".

### On severity, if any of this ships as an ESLint rule

Ship it at `"error"`. **Not because warnings drown in a large baseline** — the baseline is 1,135
(`shared-facts.json`) and the volume argument is unavailable at any count. The count-independent
argument is the only one that holds: `npm run check` runs `eslint src/` with **no
`--max-warnings`**, and the pre-commit hook runs `--quiet --max-warnings 99999`, where `--quiet`
discards warnings before they can be counted. **A warn-level rule enforces nothing at either gate,
by construction.**

---

## Convergence — four shared traps, one clause refuted, one clause adopted verbatim

Checked against **`../personas-cloud`** (the Node orchestrator + FastAPI facade that is this repo's
literal server counterpart — 58 authenticated routes, one central gate) and **`../brainiac`** (Rust
workspace, Postgres RLS, MCP server, Next.js console). The oracle read both at every auth boundary.
It **inverted one of this document's own prescriptions**, which is recorded first.

### ⚠ The clause with no trace anywhere — reported against my own §2

**§2 and §4 prescribe making the auth/transport split a *type*. That clause is NOT convergent.**
Measured: **no typed error or enum distinguishing "no token" / "expired token" / "revoked grant" /
"network unreachable" / "server error" exists in either sibling repo.** Per the contract, a clause
with no trace anywhere else should be suspected of being local calibration, so here is the honest
accounting of what support does and does not exist:

- **The nearest thing in either repo, and it is exact but tiny.**
  `brainiac/console/src/lib/key-guard.ts:43-46` —
  `export interface GuardFailure { status: 400 | 403 | 502; error: string }` — a closed literal
  union where **502 means "I could not reach the thing that would tell me whether you are
  authorized" and 403 means "you are not authorized"**. `assertOrgMember` returns 502 on a roster
  read failure (`:81`) and 403 on genuine non-membership (`:84`), with the reasoning written down
  (`:87-88`): *"An upstream outage must not degrade into 'skip the check' — that is the shape of
  every authorization bypass worth having."* **That is precisely this leaf's distinction,
  independently reinvented — once, in a TypeScript interface, on one proxy route.**
- **Two adjacent supports, both real.** `brainiac/crates/brainiac-server/src/onboard.rs:308-319`
  makes `"expired"` a first-class answer distinct from `"denied"` and from 404 `"unknown device
  code"`, matching over the `(status, expired)` product with an explicit impossible-state arm — the
  best model of credential lifecycle in the corpus, and stringly-typed on both sides.
  `brainiac/crates/brainiac-server/src/mcp.rs:85-95`'s `ToolError` **is** a genuine three-arm type
  — but the oracle establishes it splits *blame and disclosure* (`InvalidParams` / `Rejected`,
  safe to show / `Internal`, logged and redacted), **not cause, and it has no auth arm**: auth
  failures return `RpcError` at `mcp.rs:717-723` before a `ToolError` can be constructed. Do not
  cite it as the same invention; it is a neighbouring one.
- **What this means for §4.** Keep the type answer, but hold it at the confidence it has earned:
  it is supported by one exact micro-precedent and by the cost of its absence measured in three
  codebases, not by independent rediscovery at scale. **Mark it a house convention with external
  corroboration, not physics.** The *other* half of §4 — "use the variant that already exists" —
  needs no external support at all, since `AppError::OAuthRevoked` and `AppError::NetworkOffline`
  are already compiled into this binary with rendering rules attached.

### Physics — one clause independently rediscovered, and it is §2's retry rule

- **"An auth failure is terminal. Retry transport, never credentials."** Written down once, as
  policy, in `brainiac/crates/brainiac-gateway/src/resilience.rs:216-222`: retryable is transport
  errors, 429 and 5xx; *"Permanent (auth, validation) — do not retry"* bails immediately. The
  circuit breaker still counts it (`:220`), so a wrong key trips the circuit after 5 calls rather
  than being retried forever. Backoff is exponential with jitter, 3 attempts, 500 ms base, 8 s cap
  (`:30-38`, `:229-234`). **This is exactly §2's clause and §7 C1's fix, and it is the only
  degraded-mode policy in the corpus that is stated as a policy rather than emerging per-site.**
- **The write/read asymmetry, and this is the clause worth adopting verbatim.**
  `brainiac/console/src/lib/demo-fallback.ts:11-13`:
  > *"Deliberate exception: reviews. It is a write surface (approve / reject / resolve), so a
  > fabricated queue wired to real actions would be dangerous. It does NOT use this helper — it
  > hard-stops with `<ApiOffline />` instead."*

  **Reads may degrade to a flagged fallback; writes must hard-stop.** That single rule indicts
  §7 D4 and §7 E directly: `cloud_sync_now` is a *write* that degrades to `Ok(status)`, and
  `remote_command_list_pending` is a read that degrades to an *unflagged* empty. brainiac's read
  path carries the flag in the type — `DemoResult<T> { data: T; live: boolean }`
  (`demo-fallback.ts:16-20`) — and every page rendering `live: false` **must** render a
  `<DemoBanner/>` (`:5-9`), with the offline state named in the UI as the literal word "offline"
  (`NavDashboard.tsx:143`), an amber dot (`:89`), and a `title="API unreachable"` (`:136`).
  Personas has no `live` flag, no banner, and no hard-stop.
- **A fail-closed default for an unclassified capability, and the cleanest before/after pair in the
  corpus.** `brainiac/crates/brainiac-server/src/mcp.rs:246-248` maps an unrecognised MCP tool to
  `"admin"` — *"so a future tool cannot slip in ungated by accident"* — and the ordering makes it
  real: the scope gate at `:717-723` runs **before** the tool-name match at `:725-744`, so a tool
  whose author forgot to classify it is unreachable by every key except admin. The mirror image is
  `personas-cloud/packages/orchestrator/src/httpApi.ts:437`, `admin?: boolean` — **optional,
  defaulting to non-admin**, so a route added without the flag is reachable by every authenticated
  user (3 of 58 routes set it). Same decision, opposite directions, and brainiac also documents the
  cost of *its* direction going wrong (`auth.rs:79-96`: scopes enforced on endpoints but absent
  from the mintable vocabulary, so callers escalated to `admin`). **A permissive default leaks; a
  restrictive default locks people out loudly — and only one of those is recoverable.**

### Four shared traps — convergent idioms that are warnings, not licences

Each is present in **all three** codebases, which per the contract is the strongest possible
evidence that a prescription is universal — here, evidence that the *defect* is.

1. **Auth failure and network failure collapse into one message at the outermost boundary.**
   Personas: `AppError::Cloud(format!("… {status} …"))`, 17 sites (§9). `personas-cloud`:
   `resolveClaudeToken` returns `string | null` for **five** distinct causes (`oauth.ts:163,:184,:211,:230`),
   `validateAndExtractContext` returns `null` for **eight** (`auth.ts:58,:68,:75,:79,:81,:84,:87,:148`)
   and every one renders as the literal `{ error: 'Unauthorized' }` (`httpApi.ts:1372`); the fusion is
   visible in one string at `dispatcher.ts:1272` — `'No Claude token available (OAuth expired or
   not configured)'`. `brainiac`: `main.rs:1981` and `:1987` print
   `"brainiac: preflight unavailable ({}) — continuing"` for a 401, a 500, a timeout and a dead
   server alike. **And both siblings already manufacture the distinction and then throw it away** —
   `brainiac/console/src/lib/api.ts` mints `ApiError(0)` for transport, `ApiError(504)` for timeout
   and `ApiError(status)` for HTTP (`:110,:112,:130`), which `demo-fallback.ts:32`'s bare
   `catch (e)` immediately flattens to one boolean. Its comment (`:32-39`) names 401, 403 and 500
   as three different operator actions, logs them so they stay diagnosable, and files the UI
   distinction as follow-up. **That is the honest version of this trap, and it is the model for how
   to record it when you cannot fix it today.**
2. **An auth failure is retried in a loop.** Personas: the identity refresh loop re-attempts every
   60 s forever with no backoff (§7 C1). `personas-cloud`, twice — `dispatcher.ts:1271-1273` requeues
   a missing/expired OAuth token 5× with backoff through a `requeueOrFail(item, reason: string)`
   whose `reason` is **never inspected**, so a revoked grant burns the same 155 s as a busy worker;
   and worse, `worker/src/connection.ts:188-202` special-cases exactly one close code (4409,
   duplicate id) with the comment *"Do not auto-reconnect as it would loop"* — while `1008 'Invalid
   worker token'` falls through to `scheduleReconnect()` and **reconnects every 30 s, forever, with
   the same rejected token.** `brainiac`: the stateless guard hook re-sends an empty or bad
   `BRAINIAC_API_TOKEN` on **every Edit/Write the agent performs** (`main.rs:1940,:1971-1990`).
   Three codebases, one bug, and the correct policy written down in one of them
   (`resilience.rs:216-222`) and applied to none of their own credential paths.
3. **Health reports credential *presence* as credential *validity*.** Personas'
   `require_cloud_auth` (`ipc_auth.rs:572`) and `personas-cloud`'s
   `hasSubscription: oauth.hasTokens()` → `this.tokens !== null` (`httpApi.ts:1589`,
   `oauth.ts:272-274`) are the same expression in two languages: an orchestrator whose dispatcher is
   failing every job reports `{status: 'ok', hasSubscription: true}`. (`personas-cloud`'s facade is
   worse still — `facade/routers/health.py:8-10` returns `ok` **without contacting the orchestrator
   at all**.) The `exp` short-circuit is the same trap one level down: `auth.ts:79`'s
   `if (payload.exp && …)` and Personas' `is_token_expired()`'s `None => false` (`auth.rs:89`) both
   decide that an unstated deadline means no deadline.
4. **A degraded dependency is represented by a stub with the same type as the working one.**
   Personas: `run_sync_once` returns `()` whether it synced or found no token
   (`sync/mod.rs:402-414`), and `cloud_sync_now` returns `Ok(status)` either way.
   `personas-cloud`: `createNoopKafkaClient` (`kafka.ts:311-325`) returns the full `KafkaClient`
   interface whose `produce()` **resolves successfully** after a `logger.debug` — below the default
   log level — where the real client returns a promise that can reject; its `producer: {} as Producer`
   is an empty object behind a type assertion, so `kafka.producer.send(...)` is a runtime
   `TypeError` with a green typecheck. `brainiac`: `env::var("BRAINIAC_API_TOKEN").unwrap_or_default()`
   (`main.rs:1940`) turns an absent secret into `""`, the same `String` type as a real token,
   carried all the way to `bearer_auth`. **None of the three has a `readOnly(): never` or any
   uninhabited-return refusal.** The trap is always the same: same type, empty value, so no caller
   is forced to decide.

### Corrections to inherited premises about the siblings

- **"`personas-cloud` accepts client-supplied ids at 3 endpoints with validation on none" — PARTLY
  REFUTED.** Measured: **2** endpoints accept a client id, and one of them validates.
  `POST /api/personas` (`httpApi.ts:540-579`) takes `body.id || nanoid()` at `:556` **but
  cross-checks tenancy at `:550-553`** (403 if the id belongs to another project) and strips
  `projectId` from the body for non-admins at `:545`. Only `POST /api/tool-definitions`
  (`httpApi.ts:633-655`) is genuinely unchecked — no ownership call, no `projectId` field at all,
  so any authenticated user can overwrite any tool definition including `isBuiltin: true` with an
  arbitrary `scriptPath`. `POST /api/credentials` (`:663`) overwrites the tenant from the token and
  is safe. And no code path anywhere in `personas-cloud` mints or trusts a user id from a body or
  header: `RequestContext.projectId` comes only from a fully verified `jwt.sub` (`auth.ts:155-159`).
- **The sibling's real client-identity hazard is elsewhere, and it matters to this repo.**
  `personas-cloud/facade/` has **no authentication of any kind** across all 16 Python files, and
  `facade/routers/shared_events.py` does not proxy — its three endpoints call Supabase directly
  through a client built with the **RLS-bypassing service-role key**
  (`facade/services/supabase_client.py:13`). Personas' entire cloud-sync isolation model rests on
  *"scoped server-side by Row-Level Security on `auth.uid()`"* (`cloud/sync/mod.rs:4-6`). RLS is the
  desktop half's only tenancy control, and a service-role path in the counterpart deployment is
  outside it. Not this leaf's fix to make, but this leaf's assumption to stop making silently.
- **`brainiac` tokens have no expiry at all.** `migrations/0003_api_tokens.sql` has no `expires_at`
  column; `tokens.rs:41-49` resolves on `revoked_at IS NULL`. So its managed tokens are immortal
  until revoked, and a revoked token is indistinguishable from a nonexistent one (`Ok(None)` →
  `401 "unknown token"`). It therefore cannot corroborate anything about *staleness* — only about
  absence. When citing it, cite the default arm and the retry policy, not the lifecycle.

### The result that inverts the brief's framing

**The brief asks whether degraded mode fails closed, fails open, queues, or silently no-ops, as if
one policy had been chosen. Measured, this repo has chosen all four — inside a single module — and
so has the counterpart server.** `cloud/remote_commands.rs` answers "no token" three different ways
in 190 lines (`Ok(())` at `:130`, `Ok(vec![])` at `:196`, `Err(AppError::Auth)` at `:237` and
`:318`) and `cloud/sync/mod.rs:413` adds a fourth shape for the same question; `personas-cloud`
retries an auth rejection in one component and permanently fails it in another. **The defect is not
that the wrong policy was picked. It is that no policy was ever picked**, so each site picked
locally and the choices are invisible to one another. That is why §2 is a classification step
rather than a rule and why §4 step 1 comes before any code.

**And the deeper inversion, which is local to this repo and needs no oracle:** Personas already
solved this leaf once, correctly, for a *different* credential. The connector-OAuth path has typed
revocation (`connector_strategy.rs:554`), a seven-day staleness ceiling (`oauth_refresh.rs:49`),
four-step backoff (`:53`), refresh-on-401-retry-once (`api_proxy.rs:898-936`), persisted
`needs_reauth`, healing routing, and a self-hydrating re-auth banner. The identity session that
gates all 56 cloud commands has **none of the seven**. A clause reinvented in a sibling repo is
physics; a clause reinvented **in the same repo, better, for a neighbouring credential, and never
applied to the more important one** is something else — it is proof that the doctrine was never
written down anywhere the second author would read it. That, more than any count above, is what
this document is for.

