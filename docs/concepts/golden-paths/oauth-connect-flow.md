# Golden path — connecting a third-party account (the OAuth connect flow)

> Situation node: `integrations-security/credential-capture/oauth-connect-flow` ·
> [situation spine](../situation-spine.md) · recurrence 8 · risk **HIGH** ·
> sides **client** (spine label; **see §12.1 — the leaf is two-sided and predominantly
> server**) · convergence **CONVERGED** (spine label; **see §12.2 — it does not hold**) ·
> dimensions: **security · function · resilience · ui · code-quality**
> Composed 2026-08-16 against `master` @ `7b42f9333`.
>
> **Sweep.** The whole flow read end to end: `commands/credentials/oauth.rs` (2,579 lines —
> consent-URL construction, the loopback callback server, HMAC state, PKCE, the 12-entry
> provider registry, OIDC discovery, session redemption), `engine/oauth_refresh.rs` (1,149),
> `engine/connector_strategy.rs` (the resolve/refresh strategies), `engine/runner/credentials.rs`
> (a third, independent token exchange), `commands/infrastructure/auth.rs` (the two in-app
> consent popups), `core/src/models/credential_ledger.rs`, `commands/infrastructure/cloud.rs`,
> `commands/credentials/crud.rs`, plus the frontend flow: `hooks/design/oauth/*`,
> `features/vault/shared/hooks/useCredentialOAuth.ts` / `useGoogleOAuth.ts`,
> `sub_credentials/components/forms/OAuthSection.tsx` / `OAuthProgressRing.tsx`,
> `sub_credentials/components/card/banners/ReauthBanner.tsx`,
> `sub_credentials/manager/useCatalogHandlers.ts`. Census walk: **963** non-generated `.rs`
> files (the runner's own `walked`, matching [`shared-facts.json`](../shared-facts.json)).
> Data: **read-only copies** of the operator's `personas.db` (347 MB) and `personas_data.db`
> (17.5 MB), copied 2026-08-16.
>
> **Measured by executing, not reading.** Every headline number below came from running
> something against the copies:
> 1. **The `oauth_token_metrics` table was replayed in full** — 466 rows — and each
>    "successful refresh" was joined to the interval since the previous one. The two
>    populations separate perfectly (§0), which is what proves the mechanism.
> 2. **A second, independent implementation** re-derived the same split from a *different
>    table written by a different statement* (`credential_audit_log.detail` prose), and the
>    two agree **exactly** on their overlap — 171 / 30 — while disagreeing on the
>    denominator for a reason that is itself a finding (§6).
> 3. The two live OAuth credentials were run through the refresh engine's own predicates by
>    hand, which is how the *silent terminal state* (§0.3) was found.
> 4. The §9 rule was validated in a private scratch registry with a filename unique to this
>    composer, its counts reproduced by a second engine (ripgrep's Rust `regex` vs the
>    runner's Node `RegExp`), all 16 matches hand-opened, then **re-extracted from this
>    finished document and re-run**: identical. The full registry was **not** run.
>
> `cargo` was **not** run. **No OAuth flow was started, no consent URL was opened, no
> credential was transmitted, and no secret value, prefix or partial appears below.** Token
> material is reported as shape, length and count only. The two timestamp values printed
> verbatim are `is_sensitive = 0`, `iv = ''` expiry stamps, not credential material.
>
> ### Sibling boundaries, settled in prose
>
> [**connection-health-check**](./connection-health-check.md) owns *"does this credential
> work"* — the probe, its verdict, its age. **This path owns how the credential got here and
> how it stays alive**: consent, callback, exchange, storage, refresh, revocation. Where we
> meet is `needs_reauth` and the refresh ledger. That path measured the *health* half of the
> untyped metadata blob; this path measures the *OAuth-lifecycle* half and supplies the rule
> that ratchets both (§9). **One correction upward:** that path names two writers of the
> health ledger; there is a **third**, and it lives in this leaf —
> `engine/runner/credentials.rs:861-868` patches `healthcheck_last_success = true` after a
> successful *token refresh*, with no probe of the connector's API. A health verdict
> manufactured by a token exchange is `unverifiable` wearing the boolean `true`.
>
> [**column-encryption-at-rest**](./column-encryption-at-rest.md) owns the secret at rest.
> **Confirmed and extended:** all 4 OAuth token rows in the live vault are `is_sensitive = 1`
> with a distinct 12-byte IV; the two `oauth_token_expires_at` rows and the two `scopes` rows
> are deliberately plaintext. What this path adds is a fifth column that path did not scan —
> `oauth_token_metrics.error_message`, which stores the **verbatim provider error body** for
> every failed refresh (112 live rows), routed through `sanitize_secrets`, the redactor that
> path measured as leaking 13 of 20 real token shapes.
>
> [**external-url-opening**](./external-url-opening.md) owns the door. **Confirmed and
> refined:** the credential consent flow does **not** use a dead affordance — it calls
> `openExternalUrl`, one of the two wired doors (§0.1). The dead `CloudOAuthPanel` links are
> *cloud-account* OAuth, a different flow. What this path adds is what that URL contains
> (`client_id`, `state`, `code_challenge`) and that `system/mod.rs:26` logs it whole.
>
> [**ipc-session-token-race**](./ipc-session-token-race.md) owns what the IPC token
> authorises. **This path owns the fact that the token is written into a page this app does
> not control** — `js_init_script` is registered on an app-level plugin, and the two consent
> popups are `WebviewUrl::External` (§7.F).
>
> [**timeout-tiering**](./timeout-tiering.md) owns named deadlines. This leaf contributes
> the sharpest live instance: **three timeouts govern one flow, in two languages, and the
> shortest one is the one nobody reasoned about** (§7.D).
>
> [**outbound-http-call**](./outbound-http-call.md) owns the socket. The token endpoint is on
> the **bad** side of that census — `SHARED_HTTP`, not `SSRF_SAFE_HTTP` (§7.B).
>
> The **Deviations** section is a fix backlog.

---

## 0. The headline

**This app performs a proactive OAuth refresh every hour, and three quarters of them do not
talk to the provider.** They return the token already in hand, stamp a fabricated expiry an
hour into the future, increment the refresh counter, clear the revocation flag, and log
success. The credential's real access token dies 45 minutes before the ledger says it will.

Then, when the grant finally does die for real, the same engine stops looking at the
credential altogether — not because it gave up, but because the fabricated expiry it wrote
has drifted past a staleness ceiling — and the only surface that would tell the user is a
banner on one page they may never open.

Both halves were measured, not read.

### 0.1 — First, the good news, because it is load-bearing

The *capture* half of this flow is the strongest security code in the territory, and saying
so is what makes the rest a **lifecycle** problem rather than a **protocol** problem.

| property | measured | verdict |
|---|---|---|
| `state` generated | `{nonce}.{ts}.{hmac}`, HMAC-SHA256 under a **per-install keyring secret** (`oauth.rs:1239`, `:1167`) | ✔ |
| `state` verified on callback | **twice** — echo-compare against the per-session value **and** `verify_oauth_state` HMAC with `ct_eq` + a freshness window (`oauth.rs:284-301`) | ✔ |
| a forged/stale callback consumes the flow | **no** — it gets the failure page and the loop keeps waiting, bounded by `MAX_OAUTH_CALLBACK_ATTEMPTS = 32` (`:216-224`) | ✔ best-in-class |
| PKCE (Google) | **always**, S256, verifier from `OsRng`, *alongside* the client_secret, with the rationale written down (`oauth.rs:831-834`) | ✔ |
| tokens crossing IPC | **never.** The renderer gets `has_access_token` / `has_refresh_token` booleans and an opaque `oauth_session_ref`; `redeem_oauth_session_into_fields` redeems server-side (`:1511-1515`, `:1572`) | ✔ |
| tokens at rest | 4 of 4 rows `is_sensitive = 1`, distinct 12-byte IVs | ✔ |
| the consent URL reaches the browser | `sanitizeExternalUrl` → `openExternalUrl` → the wired door (`useOAuthPolling.ts:212-219`) | ✔ |
| callback task panics | caught (`AssertUnwindSafe` + `catch_unwind`) so the session cannot wedge at `pending` (`:659-712`) | ✔ |
| rotated refresh_token persisted under the lock, with commit retry | ✔ (`oauth_refresh.rs:296-380`), with a comment naming the bricking it prevents | ✔ |

**So the answer to the brief's first question — "the consent links are dead, so how does a
user actually connect today?" — is that the credential flow never used them.**
`useOAuthPolling.ts:219` calls `openExternalUrl(safeAuthUrl)`, a wired door, and only falls
back to `window.open` if that throws (§12.3). The dead links the sweep found are
`CloudOAuthPanel`'s, and that is *cloud-account* OAuth — a different command
(`cloud_oauth_authorize`), a different flow, and the one place in the tree that opens a
remote-supplied URL with no validation at all (`cloud.rs:824`, §7.G).

Three real connects exist in this installation's audit log, all on 2026-05-25/26, and the
consent round-trip took **16.7 s, 8.8 s and 10.1 s**. The capture path works.

### 0.2 — The refresh that does not refresh

Two predicates read the same expiry and disagree over a 900-second band:

| | file:line | predicate | conclusion at *remaining = 900 s* |
|---|---|---|---|
| the tick decides to refresh | `oauth_refresh.rs:171-176` | `remaining <= REFRESH_THRESHOLD_SECS` (900) | **refresh** |
| the resolver decides to exchange | `connector_strategy.rs:600-604` | `now >= expires_at` | **don't — hand back the stored token** |

The resolver wins, because it is the one that talks to the provider. It returns
`ResolvedToken::plain(existing_access_token)` with `expires_in_secs: None`. Control returns
to `refresh_single_credential_inner`, which cannot tell "the provider gave me no lifetime"
from "the provider was never asked":

```rust
// src-tauri/src/engine/oauth_refresh.rs:571-582
let expiry_secs_for_field = resolved.expires_in_secs.unwrap_or(DEFAULT_FALLBACK_LIFETIME_SECS) as i64;
let expires_at_rfc3339 = (chrono::Utc::now() + chrono::Duration::seconds(expiry_secs_for_field)).to_rfc3339();
let used_fallback = resolved.expires_in_secs.is_none();
```

It then writes the **same** access token back, stamps `oauth_token_expires_at = now + 3600`
into *both* stores, increments `oauth_refresh_count`, **clears `needs_reauth`**, records a
metric with `success = 1`, and returns
`"Token refreshed successfully (refresh #N, expires in 3600s)"`.

**The signature this leaves in the data is unambiguous, and it is the proof.** A token minted
with a 3,600 s lifetime is "refreshed" at 3,600 − 900 = **2,700 s**, and the fabricated stamp
resets the clock, so the next one lands 2,700 s later. Replaying all 354 successful refreshes
in the live database and bucketing them by the interval since the previous one:

| | n | min | **median interval** | max | in the 40–55 min band |
|---|---:|---:|---:|---:|---|
| `used_fallback = 1` (no provider call) | **265** | 76 s | **2,700 s** | 3,541 s | **261 of 265** |
| `used_fallback = 0` (a real exchange) | **87** | 253 s | 6,079 s / 7,800 s | 1,302,884 s | **0 of 87** |

**Disjoint.** Not correlated — disjoint. Every fallback refresh is the 45-minute tick; no real
exchange is. **265 of 354 successful refreshes (74.9%) made no network request and renewed
nothing**, and on this installation that is 219 of gmail's 279 and 48 of google_calendar's 75.

The consequence is a **45-minute window in every hour** during which the ledger asserts a
valid token and the provider holds an expired one. Inside that window every persona run
resolves the dead token and 401s; only `api_proxy.rs:904`'s force-refresh (which strips
`access_token` first, so the resolver *has* to exchange) heals it, one request at a time. The
health probe does **not** force, so it takes the dead token and records a failure — a false
negative manufactured by the refresher.

The app's own metric names the defect. `used_fallback` was built to measure "the provider
omitted `expires_in`". It has been reporting **"we did not ask the provider"** for 466 rows
and nobody read it that way, because the audit line it writes says the same thing in prose —
*"Proactive refresh (count: 279, fallback 3600s, no provider expires_in)"* — and prose that
says *refresh* is not read as *no refresh*.

### 0.3 — And when the grant really dies, the engine stops looking

Both OAuth credentials in this vault are revoked. The provider said so, in as many words, on
**90 separate occasions**:

```
oauth_token_metrics.error_message  (112 failure rows; 90 of this shape)
  "OAuth grant revoked: Google grant revoked: Google token refresh failed (400 Bad Request):
   {\n  \"error\": \"invalid_grant\",\n  \"error_description\": \"Token has been expired or revoked.\"\n}"
```

The code handled it correctly each time — `is_revocation_error` → `AppError::OAuthRevoked` →
`mark_needs_reauth` + `route_revocation_to_healing` + `emit_reauth_required` + exponential
backoff. And then this happened:

| | google_calendar | gmail |
|---|---:|---:|
| last successful refresh | 2026-05-10 | 2026-06-02 |
| `needs_reauth` set at | 2026-05-17 | 2026-06-09 |
| `oauth_refresh_backoff_until` | 2026-05-18 | 2026-06-10 |
| …**stale by** (at composition) | **90 days** | **67 days** |
| `oauth_refresh_fail_count` | 21 | 49 |
| failed attempts actually recorded in `oauth_token_metrics` | **29** | **83** |
| `remaining = expires_at − now` | **−97.9 days** | **−74.9 days** |
| `remaining >= −STALENESS_CEILING_SECS` (−7 days)? | **NO** | **NO** |

`STALENESS_CEILING_SECS = 604800` (`oauth_refresh.rs:49`) gates **both** the periodic tick
(`:174`) and the startup sweep (`:88`). Once a credential's stamped expiry is more than seven
days in the past, **neither loop considers it again — ever.** google_calendar crossed that
line on 2026-05-18 and gmail on 2026-06-10, each exactly one day after its final backoff
expired. Since then: zero refresh attempts, zero metrics rows, zero events, zero log lines.

**So the brief's "unbounded retry" is the opposite of what is happening.** The retries stopped
77 and 67 days ago. The credential is not being hammered; it is in a **silent terminal
state**, and nothing in the system models "terminal". `emit_reauth_required` fired once, into
a webview that may not have been open, and will never fire again. There is no re-emission on
launch and no periodic re-assertion — only `ReauthBanner`'s mount-time hydration from the
persisted flag, and that banner renders in exactly one place: `CredentialManager.tsx:82`, the
Vault page.

The durable escalation that was supposed to catch this did not fire either.
`route_revocation_to_healing` opens a `persona_healing_issues` row per dependent persona,
tagged `source = OAUTH_HEALING_SOURCE`. Live: **205 healing rows, `source` NULL on all 205.**
It has produced nothing, because it early-returns when the dependent set is empty and
`credential_dependent_persona_ids` finds no persona whose `design_context.credentialLinks`
names these ids.

**Net: a revoked Google grant has been dead for 91 days, is flagged in a JSON blob that one
React component reads, and the machine has stopped asking.**

### 0.4 — And the retries that *did* happen ignored the backoff that was written for them

Before the ceiling caught them, the two credentials absorbed 112 failed exchanges. The
backoff steps are `[900, 3600, 14400, 86400]` — capped at 24 h — and both credentials were
past `fail_count = 20` well before the end. So there should have been at most one attempt per
day. Measured, per day:

```
gmail  2026-06-07  8      gmail  2026-06-08  16      gmail  2026-06-09  6
gmail  2026-05-12  13     google_calendar 2026-05-12  13
```

**16 failed refreshes in one day against a declared 24-hour backoff.** The cause is
countable: `is_in_refresh_backoff()` has **exactly one call site in 963 Rust files**
(`oauth_refresh.rs:202`, the periodic tick). Six paths can trigger a real token exchange:

| entry point | consults the backoff |
|---|---|
| `oauth_refresh.rs:217` periodic tick | **✔ — the only one** |
| `oauth_refresh.rs:111` startup sweep | ✘ — and it *writes* the backoff it never reads |
| `connector_strategy.rs:396` / `:637` `resolve_oauth_token` (reached by **every API call** and **every health probe**) | ✘ |
| `api_proxy.rs:904` force-refresh on 401 | ✘ (defensible — the provider just refused) |
| `rotation.rs:185` manual rotate | ✘ |
| `crud.rs:129`/`:210` `spawn_connect_seed` | ✘ (correct — this *is* the reconnect) |

And the two counters of the same event disagree accordingly: `oauth_token_metrics` recorded
**112** failures; the ledger's `oauth_refresh_fail_count` sums to **70**. The 42-row gap is
exactly the failures that arrived through a door that does not write the ledger, because
`set_refresh_backoff` is called from **2** of the 6 paths.

### 0.5 — The set of providers you can connect is not the set you can renew

| list | where | length |
|---|---|---:|
| providers you can **authorize** | `PROVIDER_REGISTRY` (`oauth.rs:866-987`) | **12** — microsoft, github, slack, atlassian, salesforce, discord, spotify, linear, notion, linkedin, reddit, ramp |
| strategies that can **refresh** | `init_registry()` (`connector_strategy.rs:288-310`) | **2** — `google-oauth` (+ a `gmail` alias) and `microsoft-oauth` |
| a **third** token-endpoint table | `runner/credentials.rs:637-659` | **4** — google\*, microsoft, slack, github |

Nothing relates the three. A credential minted for LinkedIn, Reddit, Ramp, Slack, Discord,
Notion, Linear, Spotify, Salesforce or Atlassian falls through `registry.get()` to
`DefaultStrategy`, which overrides only `rotate` — so `is_oauth` and `resolve_auth_token` are
the **trait defaults**:

```rust
// src-tauri/src/engine/connector_strategy.rs:58-73  (the ConnectorStrategy trait)
fn is_oauth(&self, fields: &HashMap<String, String>) -> bool { fields.contains_key("refresh_token") }
async fn resolve_auth_token(&self, _m: Option<&str>, fields: &HashMap<String,String>)
    -> Result<Option<ResolvedToken>, AppError> { Ok(find_auth_token(fields).map(ResolvedToken::plain)) }
```

`is_oauth` says **true** (there is a `refresh_token`), so the guard at
`oauth_refresh.rs:536` lets it through; `resolve_auth_token` then returns the stored
`access_token` verbatim, with no expiry. **The 0.2 defect is not an edge case for these ten
providers — it is the only behaviour they have.** Their tokens are never renewed, and the
ledger reports a fresh hour-long lifetime forever. Three such connectors exist in the live
catalog today (`linkedin`, `reddit`, `ramp`, all `auth_type: oauth` with a registry-valid
`oauth_provider_id`); **0 of the 3 have a refresh strategy**, and none has been connected
here, so the class is armed and unexercised.

The force path fails differently and worse: `force_refresh_single_credential` deletes
`access_token` from the field map first, `find_auth_token` then finds nothing (`refresh_token`
is not in its `TOKEN_KEYS` list), `resolve_auth_token` returns `Ok(None)`, and the caller
raises `AppError::Internal("Strategy returned no token after refresh")` — not `OAuthRevoked`,
so **no `needs_reauth`, no event, no banner**, just a backoff and a message that names
nothing.

### 0.6 — Nobody ever revokes anything at the provider

`revoke` appears 40 times in the Rust tree: broker consumer keys, inbound API keys, paired
devices, desktop approvals, GitLab credentials. **Zero calls to any OAuth revocation
endpoint.** There is no `revocation_endpoint`, no `/revoke`, no `token_type_hint` anywhere in
`src-tauri` or `src`. `delete_credential` (`crud.rs:256`) removes the row and cascades the
fields; the grant stays live at Google, Microsoft, Slack and every other provider until the
user goes and finds it in the provider's own account settings. `OidcDiscovery`
(`oauth.rs:997-1003`) deserialises only `authorization_endpoint` and `token_endpoint` — the
`revocation_endpoint` the provider advertises is discarded at parse time.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no file path,
primitive name or count, and each clause carries its warrant so an adopting repo can tell
physics from local calibration.

> **P1 — physics, and it is the whole subject.** *A connection is not a value you obtain; it
> is a relationship you must keep alive.* The consent screen is one moment; the grant then
> lives for months, decaying, and can be ended unilaterally by the other party at any time
> without telling you. Design for the lifetime, not the handshake — every hour spent on the
> handshake and none on the lifetime buys a flow that works beautifully once.
>
> **P2 — physics, and the clause this leaf exists to state.** *A renewal you did not perform
> is not a renewal.* If the authority did not answer, you learned nothing, and writing a new
> expiry is manufacturing evidence. **The absence of a lifetime from the provider and a
> default lifetime of your own must never occupy the same field**, because every consumer
> downstream reads that field as something the provider said.
>
> **P3 — physics, corollary of P2.** *Two components that read the same clock must share the
> same predicate.* If one says "act when less than N remains" and the other says "act when
> it has already elapsed", there is a window of width N in which the first calls the second
> and the second declines — and the caller cannot see the decline, because a decline and a
> success have the same shape. The bug is invisible at both sites and only exists between
> them.
>
> **P4 — physics, and it is the one that costs the most.** *A retry budget is only as strong
> as its least disciplined caller.* Backoff written by one path and read by one path, while
> five others can trigger the same expensive operation, is not a budget — it is a comment.
> Count the entry points before you trust the ceiling, and put the check where the operation
> is, not where one of its callers is.
>
> **P5 — physics.** *A permanent failure needs a terminal state, and a terminal state needs a
> keeper.* "Stop retrying" and "stop caring" are different decisions. A system that drops a
> dead connection out of its loops has not resolved it — it has forgotten it, and forgetting
> looks identical to healthy from every angle except the user's. Whatever surface reports the
> failure must be driven by durable state and must re-assert itself, because the one event
> you fired arrived while nobody was looking.
>
> **P6 — physics, and it inverts a neighbour's clause on purpose.** *At the protocol level a
> refresh grant that is expired and one that is revoked are the same answer,* and the
> remedy — send the human back to the consent screen — is identical. So **collapse the
> state and do not collapse the copy**: it is correct to have one "needs re-authorization"
> condition, and dishonest for the message to assert which of the two happened when the
> provider refused to say.
>
> **P7 — physics.** *A flow's timeout is the shortest one any participant holds.* A consent
> round-trip crosses a UI, a transport, a browser, a human and a provider, and each layer
> tends to grow its own deadline. The user experiences the minimum. Where the shortest
> deadline is also the one furthest from the code that reasons about the flow, it will be the
> one nobody tuned — and it will fail as *"try again"* on a flow that was about to succeed,
> which is the most expensive false failure available, because it costs a second grant.
>
> **P8 — security, and it is the clause a careful team gets exactly backwards.** *Harden the
> endpoint you cannot vouch for, not the one you can.* Discovery documents, provider
> registries and caller-supplied endpoints are three different trust levels, and effort flows
> naturally to the one that looks most like a protocol. The caller-supplied URL is the one
> that receives your client secret and an authorization code, and it is the one no one
> validates, because it has no specification to check it against.
>
> **P9 — security.** *The consent page is, by definition, the one page in your product you do
> not control.* Anything your host injects into every page it renders — a token, a bridge, an
> automation hook — is injected into that one too. Enumerate what your shell hands to a
> webview *before* you point a webview at somebody else's origin, and prefer the system
> browser, which hands them nothing.
>
> **P10 — security and ergonomics together.** *Disconnect must mean disconnect.* Deleting
> your copy of a token ends your access and not theirs; the grant survives at the provider,
> invisible to the user who just clicked Remove. If the provider publishes a revocation
> endpoint, calling it is part of delete — and if you do not call it, say so in the UI,
> because the user's mental model is the opposite.
>
> **P11 — ergonomics.** *Every fact this machinery learns should be reachable from the object
> it describes.* Expiry, refresh count, failure count, backoff and revocation are the entire
> observable state of a connection; storing them where nothing renders them means the only
> available diagnosis is "it stopped working". A connection card that shows a name and a green
> dot has hidden the whole subject.
>
> **Scale condition.** P2, P3 and P8 are correctness on the *first* credential. P7 bites the
> first slow consent (enterprise SSO, MFA). P4 and P5 bite the first revocation. P1, P10 and
> P11 bite the first time a connection outlives the session that made it — which is always.
> P6 bites the first time you write the failure message. P9 bites the day you decide to keep
> the consent screen inside your app.

### Warrant evidence — the five siblings, censused 2026-08-16

`personas-web` (Next.js · 1,054 files), `brainiac` (Rust workspace + Next.js console · 559),
`personas-cloud` (TS orchestrator + Python facade · 48), `vibeman` (Next.js **+ Tauri** ·
2,053), `ascent` (Next.js + GitHub App · 892). **All five checkouts exist and were read.
Nothing below is reported by omission**, and the two results this document leans on hardest
were re-opened by hand rather than taken from the sweep.

**Only two of the five own an authorization-code flow at all** — `personas-cloud`
(`packages/orchestrator/src/oauth.ts`) and `ascent` (`src/lib/auth.ts` + two callbacks).
`personas-web` delegates to the Supabase SDK (and, because `createClient` is called with no
options, lands on `flowType: 'implicit'` — no code exchange exists there at all); `brainiac`
delegates to a Firebase popup and uses the JWT-bearer grant for Vertex; `vibeman` has none.
**So every denominator below that says "of 5" is really "of 2 that could have had it", and
that is stated per row rather than hidden in an average.**

| clause | personas-web | brainiac | personas-cloud | vibeman | ascent | verdict |
|---|---|---|---|---|---|---|
| `state` generated **and** verified | SDK | n/a | ✔ `oauth.ts:40` / `:89-102` | n/a | ✔ `auth.ts:462` / `callback/route.ts:81` | **2 of 2** |
| …and the state is **signed / HMAC'd** | — | — | ✘ in-process `Map` | — | ✘ unsigned cookie, beside an HMAC'd session cookie | **0 of 2 — Personas is alone** |
| PKCE | ✘ (implicit) | ✘ | **✔ S256** | ✘ | ✘ in the hand-rolled flow; SDK-only in the other | **1 of 2** |
| **P8** endpoint you cannot vouch for is validated | n/a | ✘ env URLs unvalidated | hardcoded consts | **✘ caller-supplied URL, `new URL()`-parse only** (`remote/setup/route.ts:41-48`) | hardcoded + **origin allow-list** `auth.ts:407-412` | **convergent DEFECT 2 of 2** |
| **P2** a renewal proves it happened | n/a | n/a | ✔ by structure — one code path | n/a | n/a (no refresh token) | **SILENT — see (b)** |
| **P3** one predicate for "due" | n/a | n/a | **unrepresentable** — one decision site | n/a | n/a | **SILENT — see (b)** |
| **P4** the retry guard has one reader **and** one caller | n/a | n/a | **✘ mutex bypassed** by `httpApi.ts:1534` | n/a | ✘ `withBackoff` is a shared per-call helper | **convergent DEFECT 2 of 2** |
| **P5** terminal state with a durable keeper | ✘ synthetic | ✘ | ✘ process memory only | ✘ | **✔ DB-backed** `signin-gate.ts:38-56` → `SignInNotice.tsx:29` | **1 of 5** |
| **P6** state collapsed, copy honest | n/a | n/a | ✘ `isExpired` is clock-only | n/a | **✘ inverted** — `revoked` → `"expired"` (`auth.ts:268`) | **0 of 2, in opposite directions** |
| **P10** disconnect calls the provider's revoke | ✘ | ✘ | ✘ `clearTokens()` only | ✘ | ✘ | **0 of 5** |
| **P9** a consent page rendered in the app's own shell | ✘ redirect | ✘ SDK popup | ✘ copy/paste | n/a | ✘ redirect | **0 of 5 — Personas is alone** |
| **P11** a real connection age reaches a pixel | ✘ synthetic `expiresAt: null` | ✘ | ✘ | ✘ | ✔ session expiry only | **1 of 5** |

**Five results this document rests on.**

**(a) The `CONVERGED` label held only for the half of the subject that has an RFC, and the
split is exactly the seam P1 names.** The handshake clauses have warrant — two of two repos
with a flow generate *and* verify state, one implements PKCE, three of four hardcode their
endpoints. **Every lifecycle clause is silent, unanimous-as-a-defect, or inverted.** That is
not a marginal miss: it is the whole reason this path leads with P1. **The label should read
`mixed`.** (This is the fourth `CONVERGED` in the campaign to fail under measurement, and the
failure mode is the same each time — the label describes the part of the subject with a
specification.)

**(b) P2 and P3 have no external warrant, and the reason is structural rather than an
oversight.** `personas-cloud` is the only sibling with a proactive refresh (a 30-minute
`setInterval` at `index.ts:124-127` plus a lazy per-batch check at `dispatcher.ts:1311`), and
in it **there is exactly one function that can renew** — `refreshAccessToken`, which always
performs a real HTTP exchange and stores `expiresAt` from the provider's own response
(`oauth.ts:141`). It cannot decline, so there is nothing to mistake for a renewal, and P3's
900-second band is **unrepresentable** there. Personas' defect exists because it inserted a
*resolver* between the scheduler and the exchange, with its own opinion about freshness. **The
warrant for P2/P3 is therefore "one repo made it impossible by not splitting the decision",
which is evidence for the shape of the fix and not for the prevalence of the bug. Adopt them
as strongly-reasoned and externally untested.**

**(c) P4 is convergent, and it converges as a *defect*, which is the strongest form.** In
`personas-cloud`, `getValidAccessToken()` funnels every caller through a `refreshPromise`
mutex whose doc comment says it exists so a rotating refresh token is not lost by
*"permanently breaking the token chain"* (`oauth.ts:222-247`) — and `handleOAuthRefresh` at
`httpApi.ts:1534` calls `oauth.refreshAccessToken()` **directly**, around the guard, from an
HTTP route. **One reader of the guard, two callers of the operation.** Personas has one reader
and six. `ascent`'s `withBackoff` (`auth.ts:529`) is likewise a shared helper each caller
opts into rather than a chokepoint. **Two independent codebases, no shared document, both
wrote the guard and then wrote a path around it** — I re-opened both files to confirm, because
this is the corpus's "cost and failure are better evidence than agreement" pattern and it is
what makes P4 physics rather than local taste.

**(d) P6 is confirmed by two failures in opposite directions, which is better evidence than
agreement would have been.** `ascent` owns what
[connection-health-check](./connection-health-check.md) called *"the best design in the
six-repo sample"* — a genuine three-valued `VersionVerdict = "valid" | "revoked" | "unknown"`
— **and collapses it at the door**: `auth.ts:268` is `if (verdict === "revoked") return
{ session: null, status: "expired" }`, forwarded by `signin-gate.ts:52` and rendered by
`SignInNotice.tsx:29-38` as *"Your session expired"*. A revoked session is deliberately told
it merely expired. Personas does the mirror image: `invalid_grant` — which the provider
explicitly labels *"expired **or** revoked"* — is rendered as *"access was revoked"*
(`ReauthBanner.tsx:155`). **Two repos, one refusing to say "revoked", the other refusing to
say "we don't know", and neither willing to render the ambiguity the protocol actually
returned.** That symmetry is why §8.1 is a Gap and P6 is a clause about copy, not about state.

**(e) Two absences that are unanimous, and one where Personas is alone.** `invalid_grant` — or
any provider-specific grant-is-dead token — appears in **zero of the five** repos; I
re-verified this myself across all five trees rather than trusting the sweep, because it is
the single fact that makes §0.3 a fleet-wide gap rather than a local bug. **No repo anywhere
calls a provider's revocation endpoint on disconnect** (P10, 0 of 5); every "disconnect" in
this fleet deletes a local copy and leaves a live grant. And **Personas is the only repo that
renders a consent page inside its own shell** (P9) — the other four hand the user to a browser
or to an SDK popup, so none of them could have discovered that an app-level init script
reaches a third-party origin. Report P9 as untested and Personas as uniquely exposed.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "let users connect their Google / Slack / GitHub account"
- "add OAuth for &lt;provider&gt;" · "we need a **Connect** button"
- "where do we put the callback?" · "what redirect URI do I register?"
- "the token expired, just refresh it"
- "it worked yesterday and now everything 401s"
- "add a **Disconnect** button"
- "why does it say connected when it isn't?"

**If you are about to write** `authorization_code`, `code_challenge`, `code_verifier`,
`redirect_uri`, `grant_type`, `refresh_token`, `client_secret`, a `state` parameter, a
callback listener, an `expires_in` parse, an `unwrap_or(3600)`, a `needs_reauth` flag, a
provider registry entry, or a retry/backoff around a token endpoint — **you are in this
situation.**

**You are also in it, and this is the case everyone misses, when you are about to add a
provider to a list.** There are three provider lists in this repo (§0.5) and adding to one is
the normal way to ship a connector that can never be renewed.

**And you are in it if you are about to render a connection's status.** The state you are
about to hide is this path's output (§7.E).

**Not this path:** whether the credential currently works is
[connection-health-check](./connection-health-check.md); whether the ciphertext is safe is
[column-encryption-at-rest](./column-encryption-at-rest.md); how the consent URL reaches a
browser is [external-url-opening](./external-url-opening.md); whether a persona may *run* is
[credential-readiness-resolution](./credential-readiness-resolution.md); the app's own
sign-in (`login_with_google`, Supabase) shares the machinery and is a different subject —
except for §7.F, which is about both.

---

## 2. The one way

**Treat the connection as a subscription with an owner, not as a token you fetched.** Build
the capture half exactly as `start_google_credential_oauth` already does — a loopback
listener on `127.0.0.1:0`, PKCE S256 alongside the client secret, an HMAC-signed `state`
verified on the callback *twice* (echo **and** signature) with stray hits answered and
skipped rather than consuming the flow, tokens sealed server-side and handed to the renderer
only as an opaque session ref — and **do not write a second one**; there are already three
token-exchange implementations and three provider tables in this repo and they disagree.
**Then spend the rest of your effort on the lifetime, which is where every live defect is.**
Make the renewal path *prove* it renewed: `expires_in_secs: Option<u64>` must never meet
`unwrap_or(3600)` — if the provider said nothing, either you did not ask (a bug: fix the
predicate) or the provider genuinely omits it (a fact: store it as *unknown-lifetime*, not as
3600). **Give the tick and the resolver one predicate, not two** — today
`remaining <= 900` and `now >= expires_at` disagree over a 900-second band and three quarters
of this installation's refreshes fall in it. **Put the backoff check inside the operation**,
not inside one of its six callers, and make the same helper that writes `fail_count` be the
one that reads it. **When the provider says `invalid_grant`, record it once through a single
helper that does all four things** — `mark_needs_reauth`, demote the health verdict, open the
durable issue, emit the event — and **never let a dead credential fall out of the loop
silently**: a staleness ceiling must transition it to a terminal, *re-asserting* state, not
drop it. **Store every lifecycle fact through the typed record** (`CredentialLedger`, and its
`record_oauth_refresh()` which already does the whole patch and has zero callers), never as
`patch.insert("oauth_…")` — that is how one expiry came to live in two stores with no single
writer. **Validate a caller-supplied token endpoint as hard as a discovered one** — the OIDC
path enforces HTTPS, rejects private IPs and binds the host to the issuer; the `custom` path
enforces nothing and defaults PKCE off. **Send the user to the system browser, never to an
in-app webview**, because your shell injects into every webview it owns and the consent page
is somebody else's origin. **Call the provider's revocation endpoint on disconnect** — it is
in the discovery document you already fetch and throw away. And **render what you know**:
expiry, last refresh, failure count and revocation are stored today and reach zero pixels.

If you must get one thing right first: **make the refresh prove itself.** Everything else in
§0 is downstream of a function that reports success without having asked.

---

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
|---|---|
| `commands/credentials/oauth.rs:531` `start_google_credential_oauth` | **the reference capture flow.** Loopback bind, PKCE, HMAC state, panic-captured task, audit trail, session-ref handoff |
| `oauth.rs:192` `run_oauth_callback_server(listener, ttl, expected_state, exchange)` | the callback loop. Absolute deadline, per-hit rejection that does **not** consume the flow, first-valid-state-wins, 32-hit junk budget, 32 KB request cap |
| `oauth.rs:1239` `generate_oauth_state` / `:1285` `verify_oauth_state` | `{nonce}.{ts}.{hmac}` under a per-install keyring secret; `Valid \| Expired{age} \| Invalid`, constant-time compare, and `Expired` distinguished from `Invalid` so the user gets "took too long", not a CSRF warning |
| `oauth.rs:1149` `generate_pkce_pair()` | 32 `OsRng` bytes → verifier + S256 challenge. The verifier is a `SecureString` and never leaves the process |
| `oauth.rs:446` `ensure_valid_clock()` | fails loudly on a pre-epoch clock. Its comment records the bug it prevents: every flow rejected as "took too long" |
| `oauth.rs:468` `parse_expires_in(value)` | **lenient `expires_in` parse** — numeric *or* numeric-string. Its doc comment is the best statement of P2 in the tree: a string `"3600"` silently became the fallback and produced "the silent daily-401 pattern" |
| `oauth.rs:116` `token_endpoint_request(url, params, label)` | the single form-POST + status-check + JSON-parse chokepoint, whose errors carry status **and** a `sanitize_secrets`-ed body (`:86-107`) so the raw provider body cannot reach a log |
| `oauth.rs:1572` `redeem_oauth_session_into_fields(ref, fields, consume)` | server-side redemption. Enforces expiry even when the throttled sweep has not run; `consume` starts a 120 s grace so one consent can provision several credentials |
| `oauth.rs:1006` `validate_issuer_url` / `:1073` `validate_endpoint_domain` / `:1058` `is_same_or_subdomain` | **the endpoint-trust primitives, and they are good.** HTTPS-only, localhost and private/CGN/link-local rejection, and endpoint-host binding to the issuer with a written rationale. Applied to 1 of the 3 endpoint sources (§7.A) |
| `core/src/models/credential_ledger.rs:68` `CredentialLedger` | the typed record for every lifecycle fact. `#[ts(export)]`, `serde(default)`, a `custom` catch-all, and `parse` vs **`try_parse`** with a doc comment explaining that the lossy form must never be used read-modify-write |
| `…/credential_ledger.rs:268` `record_oauth_refresh(expires_at, predicted)` | **the one to reach for, and it has ZERO callers.** Increments the count, stamps `last_refresh_at` and `predicted_lifetime_secs`, and calls `clear_needs_reauth()` — the entire patch that `oauth_refresh.rs:588-607` writes by hand as six string keys |
| `…/credential_ledger.rs:234` `increment_refresh_backoff(steps)` / `:250` `clear_refresh_backoff` / `:256` `mark_needs_reauth` / `:224` `is_in_refresh_backoff` | the typed backoff/revocation surface |
| `db/…/credentials.rs:795` `increment_refresh_backoff_atomic` | read-increment-write **in one transaction**, so a startup sweep racing the tick cannot clobber `fail_count`. The right shape; see §7.C for what bypasses it |
| `oauth_refresh.rs:296` `persist_resolved_token` | persists a **provider-rotated** refresh_token under the caller's lock, with 3 commit retries, and a doc comment explaining that dropping a rotation bricks the credential (RFC 6749 §6) |
| `oauth_refresh.rs:405` `spawn_connect_seed` | forces one refresh right after a (re)connect so the expiry metadata is current, with the daily-401 it prevents written down |
| `oauth_refresh.rs:862` `route_revocation_to_healing` | the durable escalation: a deduped `persona_healing_issues` row per dependent persona, keyed by a `[credential:<id>]` marker. **0 rows produced live** (§7.E) |
| `oauth_refresh.rs:960` `emit_reauth_required` / `:940` `emit_reauth_resolved` | typed Tauri events + an OS notification |
| `connector_strategy.rs:513` `is_revocation_error(body)` | six indicators incl. `invalid_grant`, `unauthorized_client`, `consent_required`. Correct, and correctly documented as "retrying will never succeed" |
| `src/lib/credentials/parseCredentialLedger.ts` | the frontend read door for the ledger. **3 call sites in 2 files** |
| `hooks/design/oauth/useOAuthPolling.ts:61` `useOAuthPolling` | the generic consent-and-poll hook: AbortController + a generation counter for stale microtasks, a re-entry ref against double-click, `sanitizeExternalUrl` before the door, and values held in a **ref** rather than state *"to prevent exposure via React DevTools, Sentry error serialization, and error boundaries"* |
| `sub_credentials/components/card/banners/ReauthBanner.tsx:78-103` | mount-time hydration from the persisted `needs_reauth` flag, added because the event fires before the webview mounts. **The only durable revocation surface in the product** |

**Do not exist — this path names them:**

- **Any assertion that a refresh talked to the provider.** `used_fallback` records it and
  nothing branches on it.
- **Any terminal state.** Past the 7-day ceiling a credential is neither retried nor marked
  dead; it is absent from both loops.
- **Any re-assertion of a revocation.** One event, once, and then durable state that one
  component on one page reads.
- **Any provider-side revocation call.** Zero, tree-wide.
- **Any validation of a caller-supplied `authorize_url` / `token_url`.**
- **Any single writer for `oauth_token_expires_at`**, which exists in `credential_fields`
  *and* in the metadata blob and is written by three different functions.
- **Any relationship between the three provider tables.**
- **Any UI for expiry, refresh count, fail count or backoff.** Four stored facts, zero pixels.

---

## 4. Steps

1. **Before anything: find out whether you can renew what you are about to capture.** Open
   the refresh-strategy table, not the authorize table. If your provider is not in it, you are
   not adding OAuth — you are adding a credential that dies in an hour and lies about it.
   **This step is worth ten providers here.**
2. **Capture through the existing flow.** `start_oauth` for a registry provider,
   `start_google_credential_oauth` for Google. Do not write a listener, a state generator or a
   token exchange; there are three of each already.
3. **PKCE on, always.** Alongside the client secret, not instead of it. If your branch
   defaults it off (`use_pkce.unwrap_or(false)`, `oauth.rs:1712-1719`), fix the default before you
   use the branch.
4. **Validate every endpoint you did not compile in.** `validate_issuer_url` +
   `validate_endpoint_domain` exist and are good. An `authorize_url`/`token_url` from a
   caller, a connector definition or a model gets the *same* treatment as a discovery
   document, or more.
5. **Redeem server-side.** `oauth_session_ref` → `redeem_oauth_session_into_fields`. No token
   material crosses IPC, ever. This is already true; keep it true.
6. **Make the renewal prove itself.** One predicate for "needs renewing", shared by the
   scheduler and the resolver. If the resolver declines, that is not a refresh — return a
   distinct outcome and do not stamp an expiry.
7. **Never `unwrap_or` a lifetime into the field consumers read.** Ask the type question here
   (below); the answer is a three-armed outcome, and it is cheap.
8. **Put the backoff check inside the exchange.** One function decides "am I allowed to ask
   this provider again", and every caller goes through it. Today: 1 reader, 6 callers.
9. **Record a revocation once, through one helper**, and give it a terminal state that
   re-asserts. A ceiling that drops a credential out of the loop must first move it to
   `dead`, and something must keep telling the user.
10. **Write lifecycle facts through `CredentialLedger`.** `record_oauth_refresh()` already
    exists and already clears `needs_reauth` atomically. Never `patch.insert("oauth_…")`.
11. **Revoke on disconnect.** Parse `revocation_endpoint` out of the discovery document you
    already fetch, POST the refresh token to it, and only then delete the row. If you cannot,
    say so in the confirm dialog.
12. **Render what you stored.** Provider, scopes, connected-at, expires-at, last refresh,
    failure count, revoked-since. All seven exist in the database today.
13. **And then stop.** Do not add a fourth token exchange, a third staleness constant, a
    second session map, or a per-feature copy of the ledger keys.

### Can the type make the wrong call impossible? — asked before §9

**Yes, and unusually cleanly, for the headline defect.** Held against the seven
qualifications:

The dangerous value is `ResolvedToken { token, expires_in_secs: Option<u64>, refresh_token }`
returned from *two* situations that the type cannot tell apart: **"I exchanged, and the
provider gave no lifetime"** and **"I did not exchange."** One caller,
`refresh_single_credential_inner`, must distinguish them and cannot, so it `unwrap_or`s and
fabricates.

- **Q5 (withholding beats requiring) — this is the fix, and it is small.** Do not return a
  token that means two things. Split the resolver's return into
  `enum TokenOutcome { Reused { token }, Exchanged { token, expires_in: Option<u64>, refresh_token } }`.
  `Reused` **has no expiry field to unwrap**, so the refresher physically cannot stamp one;
  the fabricating line becomes unreachable and every one of the 265 fake refreshes becomes a
  compile error at the one site that produced them.
- **Q6 (withhold the dangerous freedom, not the answer).** Correct: `Reused` still hands back
  the token, which is what `api_proxy` and the health probe want. What is withheld is the
  *claim about the future*.
- **Q3 (a type nobody constructs constrains nothing).** `ResolvedToken` has 8 construction
  sites, all in `connector_strategy.rs`, all enumerable — this passes. And the live warning is
  right beside it: `CredentialLedger::record_oauth_refresh()` **already** encodes the correct
  patch and has **zero callers**, exactly as `HealthProbeState` did in the neighbouring path.
  Shipping a type is not adopting it; **the string-keyed alternative must be removed, which is
  what §9 ratchets.**
- **Q1 (a type carries only what it encodes) — the honest limit.** `TokenOutcome` closes the
  fabrication. It does **not** close the predicate disagreement (§0.2's 900-second band) —
  after the change the tick would call the resolver, get `Reused`, and correctly do nothing,
  which is *better* (no fabricated expiry) but still means the proactive refresh never fires.
  **The predicate must be unified as a separate edit**, and pretending the type covers it is
  the mistake this qualification exists to prevent.
- **Q7 (withholding a requirement is inert when the caller supplies the bad value
  voluntarily).** Applies to the ledger half: making `oauth_token_expires_at` a required field
  changes nothing, because the writer supplies a value it computed. The fix there is to delete
  the hand-written patch, not to constrain it — which is §9.

**Where the type cannot reach.** The client credentials that authenticate every refresh come
from `resolve_credentials: fn() -> Result<(String, String), AppError>` — a **zero-argument
function pointer that reads environment variables** (`connector_strategy.rs:592`, applied at `:453` / `:487`,
`google_oauth.rs:112`). This is the doctrine's third unreachable case verbatim: *an ambient
environment variable*, and a value that never crosses a parameter. Its consequence is
concrete and unfixable by any signature: `resolve_google_oauth_client_credentials`
(`oauth.rs:766-788`) explicitly supports a **user-provided** `client_id`/`client_secret` at
connect time and labels the credential `"user_provided"` — and the refresh path has no way to
reach that pair, so it presents the *app-managed* client to the token endpoint and receives
`invalid_grant` forever. **A credential connected with your own OAuth app cannot be
refreshed, by construction.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`expires_in.unwrap_or(3600)`** | Folds "the provider was not asked" into "the provider said an hour". **4 sites** (`oauth_refresh.rs:573`, `:581`, `runner/credentials.rs:837`, `auth.rs:931`), one of which has a comment saying it "mirrors" the constant instead of importing it. **Measured cost: 265 of 354 refreshes on this install are fabrications, and the real token dies 45 minutes before the stamp.** |
| **Two components, one clock, two predicates** | `remaining <= 900` (scheduler) vs `now >= expires_at` (resolver). Neither site is wrong on its own. The 900-second band between them is where the whole defect lives, and no test at either site can see it. |
| **A backoff with one reader and six writers of the operation it guards** | `is_in_refresh_backoff()` — **1 call site in 963 files**. Live result: 16 failed exchanges in one day against a declared 24-hour backoff, and two counters of the same event that disagree by 42 (112 vs 70). |
| **A staleness ceiling with no terminal state** | Past 7 days the credential leaves both loops. Not retried, not marked dead, not re-reported. **Live: two grants dead 91 and 74 days, zero signals since.** "Stopped retrying" and "stopped caring" got the same implementation. |
| **A revocation announced by one event and remembered by one flag** | `emit_reauth_required` fires once; `needs_reauth` has **one** frontend consumer (`ReauthBanner`) rendered in **one** place (`CredentialManager.tsx:82`). Close the app during the sweep and open any page except the Vault and the product is silent. |
| **A durable escalation gated on a dependents query** | `route_revocation_to_healing` early-returns when the credential has no linked persona. **205 healing rows live, `source` NULL on all 205 — it has never produced one.** The escalation exists, is correct, and has never run. |
| **Validating the endpoint you were given a spec for and not the one you were handed** | `validate_endpoint_domain`'s own comment names the threat — *"prevents a tampered discovery response from redirecting authorization codes or client secrets to attacker-controlled servers"* — and the `custom` branch (`oauth.rs:1712-1719`) applies none of it, plus `use_pkce.unwrap_or(false)`. |
| **Enumerating providers in more than one place** | Three tables: 12 / 2 / 4. Google's token URL is spelled **3 times**, Microsoft's 3, Slack's 2, GitHub's 2. Adding to the authorize list is the ordinary way to ship a connector that can never be renewed. |
| **A trait default that answers "yes" to a capability question** | `is_oauth(fields) = fields.contains_key("refresh_token")` returns **true** for every provider with no refresh strategy, so the guard passes and the default `resolve_auth_token` hands back the stale token. A default that says "no" here would have turned ten silent failures into one loud one. |
| **`patch.insert("oauth_…", …)` beside a typed ledger** | 16 sites, 6 files (§9). It is why `oauth_token_expires_at` exists in two stores that already disagree on 2 of 2 live rows, why `oauth_refresh_fail_count` is reset to `0` by one path and to `None` by another, and why `record_oauth_refresh()` has zero callers. |
| **A key with one writer and no reader** | `oauth_token_lifetime_secs` — written once (`runner/credentials.rs:845`), read nowhere, present on both live credentials at **3599**, sitting beside `oauth_predicted_lifetime_secs = 3600` in the same JSON object. Two numbers for one quantity, from two paths, neither reconciled. |
| **Deleting your copy and calling it disconnect** | Zero revocation calls tree-wide; `revocation_endpoint` is discarded at OIDC parse time. The user clicks Remove and the grant stays live at the provider forever. |
| **A frontend timeout shorter than the backend's** | 180 s vs 600 s. The UI says *"authorization timed out. Please try again"* to a flow that is still live, discards the session id that would have redeemed it, and the user's retry orphans the first grant at the provider. |
| **Deriving UI state by substring-matching your own English message** | `OAuthSection.tsx:27` — `pollingMessage?.message?.includes('consent page opened')` against a literal built in `useOAuthPolling.ts:236`. In a 14-locale app, translating the message breaks the progress ring; the reason it has not broken is that the message was never translated. |
| **An audit trail keyed on the wrong entity** | `oauth_initiated` / `oauth_completed` / `oauth_failed` put the **session id** in `credential_audit_log.credential_id`. **6 of 6 live rows; 0 of 3 distinct ids join to `persona_credentials`.** The only record of how a credential was created cannot be joined to it. |
| **Pointing your own webview at somebody else's origin** | Two `WebviewUrl::External` consent popups (`auth.rs:447`, `:574`) receive `window.__IPC_TOKEN` from an **app-level** `js_init_script` plugin (`lib.rs:590-594`). |

---

## 6. Evidence

### The one site to copy — `oauth.rs:192-336` `run_oauth_callback_server`

It is the best-reasoned function in this territory and every property is deliberate: an
**absolute** deadline so junk hits cannot extend the wait; each `accept()` bounded by the time
*remaining*; a 32 KB request cap that rejects rather than blocks; a **two-part** state check
(echo-compare against this session's value **and** HMAC verification of the untrusted echoed
value); a failure that is *non-consuming* — a stray or forged hit gets the error page,
increments a bounded budget, and the loop keeps waiting for the real callback; first-valid-
state-wins so a later valid hit cannot race; and `Expired` distinguished from `Invalid` so a
slow enterprise SSO produces *"took too long"* rather than a CSRF accusation. The comments at
`:185-191` and `:277-283` explain each choice. **Copy the whole shape, including the
comments.**

Second site to copy, for the *write* half: **`oauth_refresh.rs:296-380` `persist_resolved_token`** —
a provider-rotated refresh token persisted under the caller's lock, in one transaction, with
round-trip verification and three commit retries, because *"the provider has ALREADY
invalidated the old refresh_token the moment it returned the new one"*.

### Supporting exemplars

| site | the property to copy |
|---|---|
| `oauth.rs:458-473` `parse_expires_in` | a lenient parse **with the bug it fixes written down**: a string `"3600"` fell to `as_u64() → None` → the 3600 fallback → "the silent daily-401 pattern". This is P2 stated correctly, three files away from where P2 is violated |
| `oauth.rs:440-457` `ensure_valid_clock` | fail loudly on an absurd clock rather than mint a state that instantly fails its own freshness check and blame the user |
| `oauth.rs:86-107` `token_endpoint_error` | sanitizes the provider body at **one chokepoint**, with the reason: a failed token response can echo the submitted `client_secret`/`refresh_token` or issue fresh material inside an error envelope |
| `oauth.rs:1222-1232` | two windows (600 s session, 900 s state) whose *relationship* is argued in prose — the grace margin exists so a slow-but-legitimate SSO is never read as a forgery. The model to follow; §7.D is what happens to the third window, which lives in TypeScript |
| `oauth.rs:1073-1105` `validate_endpoint_domain` | issuer-anchored host binding that avoids needing a public-suffix list, with worked examples in the doc comment including the adversarial ones |
| `oauth.rs:45-52` | a *grace* window after redemption, because one consent legitimately provisions several credentials (Google Workspace). Lifecycle nuance captured as a constant with a paragraph |
| `useOAuthPolling.ts:67-71` | credential values in a **ref**, not state — *"to prevent exposure via React DevTools, Sentry error serialization, and error boundaries"* |
| `useOAuthPolling.ts:91-94` | a generation counter beside the AbortController, for stale microtasks that survive `abort()` |
| `ReauthBanner.tsx:69-77` | mount-time hydration from durable state, added after a smoke test found *"three genuinely revoked credentials, empty banner"* — the single best instance of P5 in the repo, and the reason §0.3 is a 91-day silence rather than a total one |
| `oauth.rs:1932-1940` | the retired `refresh_oauth_token` command, deleted **with a tombstone comment** explaining it was the only IPC surface accepting a raw refresh token and had no caller. This is how to remove a door |

### The refresh engine, replayed (read-only copy, 2026-08-16)

| | value |
|---|---:|
| credentials | **25** |
| …OAuth (carry a `refresh_token`) | **2** — gmail, google_calendar |
| …both flagged `needs_reauth = true` | **2**, stamped 2026-05-17 and 2026-06-09 |
| `oauth_token_metrics` rows | **466** (2026-05-03 → 2026-06-09) |
| …`success = 1` / `success = 0` | **354 / 112** |
| …`used_fallback = 1` (no provider round-trip) | **267** (265 of them successes) |
| failures carrying `invalid_grant` | **90** |
| failures that were transport errors | **22** |
| ledger `oauth_refresh_fail_count`, summed | **70** — vs **112** metric failures |
| `oauth_initiated` / `oauth_completed` / `oauth_failed` in the audit log | **3 / 3 / 0** |
| consent round-trip durations, all three | **16.7 s, 8.8 s, 10.1 s** |
| OAuth audit rows whose `credential_id` joins `persona_credentials` | **0 of 6** |
| `persona_healing_issues` rows / rows with `source` set | **205 / 0** |
| connector definitions | **134**, of which **18** are OAuth-shaped: **6** google, **3** universal (`linkedin`, `reddit`, `ramp`), 9 other |
| universal connectors whose `oauth_provider_id` is in `PROVIDER_REGISTRY` | **3 of 3** ✔ |
| …that have a **refresh strategy** | **0 of 3** |
| `oauth_token_expires_at` copies that disagree | **2 of 2** — by **17.6 µs** and **20.0 µs** |

### The 45-minute signature, measured two ways

**Implementation A — `oauth_token_metrics.used_fallback`, joined to the interval since the
previous success row.** Perfect separation (table in §0.2): fallback median **2,700 s**, 261
of 265 in the 40–55 min band; real exchanges **0 of 87** in that band.

**Implementation B — a different table, written by a different statement.**
`credential_audit_log.detail` is free prose composed at `oauth_refresh.rs:775-783`; classifying
on `"fallback \d+s, no provider expires_in"` vs `"provider TTL: \d+s"` re-derives the split
with no reference to the metrics table.

```
window 2026-05-25 → 2026-06-02, gmail
  A (oauth_token_metrics.used_fallback):   171 fallback  /  30 real
  B (credential_audit_log.detail prose):   171 fallback  /  30 real
  per-day counts, 9 consecutive days:      15/15  27/27  26/26  14/14  28/28  25/25  26/26  26/26  14/14
```

**Exact agreement on the overlap — and a disagreement on the denominator that is itself a
finding.** A covers 354 successes; B covers 202. The gap is not a matcher bug: the audit log's
oldest surviving row is **2026-05-19**, so `credential_audit_log` is pruned and
`oauth_token_metrics` is not. **The two durable records of the same event have different
retention, and only one of them is joinable to a credential** (§0's audit finding). That
belongs to [retention-and-pruning](./retention-and-pruning.md); it is reported here because it
is the reason two honest implementations produced different totals.

### The three provider tables, enumerated

```
authorize          oauth.rs:866-987      12  microsoft github slack atlassian salesforce discord
                                             spotify linear notion linkedin reddit ramp
refresh (strategy) connector_strategy.rs:288  2  google-oauth (+gmail alias), microsoft-oauth
refresh (runtime)  runner/credentials.rs:637  4  google*, microsoft, slack, github
```

Google's token URL appears at `oauth.rs:836`, `connector_strategy.rs:452` and
`runner/credentials.rs:642`; Microsoft's at `oauth.rs:871`, `connector_strategy.rs:486`,
`runner/credentials.rs:644`; Slack's and GitHub's twice each. `runner/credentials.rs:667` is a
**fourth** HTTP token exchange that does not delegate to `token_endpoint_request`, and
therefore never builds a `TokenEndpointError`, never reaches `is_revocation_error`, never sets
backoff and never marks `needs_reauth` — its `_ =>` arm at `:647` merely logs *"OAuth refresh
skipped: connector not in the known token-endpoint list"* and returns `None`.

### The frontend half, in full

| | count |
|---|---:|
| components that render **any** OAuth lifecycle state | **1** — `ReauthBanner` |
| places that component is rendered | **1** — `CredentialManager.tsx:82` (the Vault page) |
| frontend readers of `needs_reauth` | **1** (`ReauthBanner.tsx:80`) |
| frontend readers of `oauth_token_expires_at` / `oauth_refresh_backoff_until` / `oauth_refresh_fail_count` that reach a pixel | **0 / 0 / 0** — all three are in the ts-rs binding (`CredentialLedger.ts:17`) and in `parseCredentialLedger`'s empty shape, and nothing renders them |
| `parseCredentialLedger` call sites | **3, in 2 files** |
| raw `JSON.parse(<x>.metadata)` call sites | **7, in 6 files** — including `ReauthBanner.tsx:90`, ten lines below its own typed read, because `source` has no typed field |
| user-facing OAuth flow messages built in TS | **7**, all hardcoded English (`useOAuthPolling.ts:135,153,160,169,196,236,254`) |
| …of which one is **parsed** to derive UI state | **1** (`OAuthSection.tsx:27`) |
| existing i18n keys for this surface in `en.json` | `vault.forms.authorizing_with`, `vault.forms.oauth_consent_hint`, `vault.forms.authorization_complete`, `vault.body.authorize_hint` … — **they exist and the hook does not use them** |

---

## 7. Deviations

> **Second pass — what is upstream of all of it.** Every item below is a consequence of one
> structural fact: **this codebase models the connection as a token it holds, not as a grant
> the provider holds.** Everything the *provider* owns — whether it renewed anything, whether
> the grant is alive, when it really expires, whether it has been revoked — is either
> inferred, defaulted, or discarded, while everything *we* own — counts, stamps, flags — is
> recorded meticulously. `used_fallback` is the perfect miniature: the app tracks, in a
> dedicated column, the fact that the provider told it nothing, and then writes the number it
> made up into the field everyone reads. **The fix is not fourteen fixes; it is to make every
> lifecycle write require provider evidence, and §"Can the type make the wrong call
> impossible?" is how.**

### 7.A — P0: the endpoint nobody vouches for is the one nobody validates

| Path | What's wrong |
|---|---|
| `commands/credentials/oauth.rs:1712-1719` | the `custom` branch takes `authorize_url` and `token_url` **verbatim** — no scheme check, no private-IP check, no host binding — and sets `use_pkce.unwrap_or(false)`. |
| `oauth.rs:1698-1711` (contrast) | the OIDC branch runs `validate_issuer_url` (HTTPS + localhost + private/CGN/link-local rejection) **and** `validate_endpoint_domain` on **both** discovered endpoints. |
| `oauth.rs:866-987` (contrast) | the registry branch uses compiled-in `&'static str` literals. |

Three ways to name a token endpoint; **the two that cannot be attacker-chosen are hardened and
the one that can is not.** The client secret and the authorization code are POSTed to whatever
that string says. `validate_endpoint_domain`'s own doc comment names exactly this threat.

**Live reachability is the mitigating fact and it must be stated:** the `custom` branch has
**zero frontend callers.** `useCatalogHandlers.ts:126-131` and the design orchestrator pass
only `providerId`/`clientId`/`clientSecret`/`scopes`; `authorizeUrl`, `tokenUrl` and
`oidcIssuer` are declared on `StartOAuthParams` (`oauth.rs` → `bindings/StartOAuthParams.ts`)
and set by nobody. A connector whose `oauth_provider_id` is not in the registry therefore gets
`AppError::Validation("Unknown provider…")` rather than an unvalidated flow. The branch is
**armed and unreachable** — the mirror image of
[external-url-opening](./external-url-opening.md)'s finding that the best-designed door there
has never run.

**Fix:** route all three branches through one `resolve_endpoints()` that ends in
`validate_endpoint_domain`, and change `use_pkce.unwrap_or(false)` to `unwrap_or(true)`.

### 7.B — P0: the token exchange takes the non-SSRF client and the default redirect policy

`token_endpoint_request` (`oauth.rs:121`) and `discover_oidc` (`:1114`) both use
`crate::SHARED_HTTP` — `reqwest::Client::builder().timeout(30s).build()`
(`core/src/http_clients.rs:17-22`) — **not** `SSRF_SAFE_HTTP` and not
`build_ssrf_safe_client`, which the health probe takes and which carries a hop-revalidating
redirect policy. `runner/credentials.rs:667` does the same.

Two consequences. (1) The DNS-time private-IP rejection that `validate_issuer_url` performs
*textually* is not enforced at *connect* time, so a hostname that resolves to a private address
is reached. (2) reqwest's default redirect policy follows up to 10 hops with no
per-hop revalidation, and the payload here is a form body containing `client_secret`,
`refresh_token` and `code`. [outbound-http-call](./outbound-http-call.md)'s
`redirect-portable-credential-header` rule keys on **headers**; a secret in the **body** is
invisible to it.

**Fix:** `SSRF_SAFE_HTTP` at all three sites, with an explicit `redirect::Policy::none()` for
token endpoints — an OAuth token endpoint has no legitimate reason to redirect.

### 7.C — P0: the refresh that renews nothing, and the ceiling that forgets

| Path | Defect |
|---|---|
| `engine/oauth_refresh.rs:571-582` | `resolved.expires_in_secs.unwrap_or(DEFAULT_FALLBACK_LIFETIME_SECS)` — fabricates an hour when the resolver never asked. |
| `engine/connector_strategy.rs:600-604` | returns the stored token when `now < expires_at`; the caller cannot distinguish this from an exchange. |
| `engine/oauth_refresh.rs:171-176`, `:88-96` | `remaining <= 900` — a different predicate over the same value. |
| `engine/oauth_refresh.rs:49`, used at `:95` and `:175` | `STALENESS_CEILING_SECS` silently removes a credential from **both** loops with no state change. |
| `engine/oauth_refresh.rs:202` | the only `is_in_refresh_backoff()` reader, against 6 exchange entry points. |

**Fix, in four parts.**

```rust
// 1. Make "I did not exchange" unrepresentable as "I renewed" (see §4's type answer).
pub enum TokenOutcome {
    Reused    { token: String },                                      // no expiry field exists
    Exchanged { token: String, expires_in: Option<u64>, refresh_token: Option<String> },
}

// 2. One predicate, shared. Delete REFRESH_THRESHOLD_SECS from the tick and let the
//    resolver own "is this due", with the same 900s margin on BOTH sides:
//    fn needs_exchange(expires_at) -> bool { remaining(expires_at) <= REFRESH_THRESHOLD_SECS }

// 3. Backoff inside the operation, not inside one caller:
//    refresh_single_credential_inner() early-returns Err(AppError::RefreshBackedOff)
//    when ledger.is_in_refresh_backoff() && !force.

// 4. A terminal state instead of a silent drop, at oauth_refresh.rs:174:
//    remaining < -STALENESS_CEILING_SECS  =>  mark_grant_dead(pool, cred)  // NEW
//    which sets needs_reauth (idempotent), stamps `grant_dead_at`, and re-emits
//    CREDENTIAL_REAUTH_REQUIRED on a bounded cadence so the surface can rediscover it.
```

Part 1 alone turns all 265 fabricated refreshes on this installation into a compile error at
one site. Part 4 alone would have kept two 91-day-dead credentials visible.

### 7.D — P1: three deadlines, two languages, and the shortest one is the one nobody argued about

| deadline | where | value |
|---|---|---:|
| frontend poll cap | `useOAuthPolling.ts:117` — `MAX_POLL_ATTEMPTS = 120` × 1500 ms | **180 s** |
| callback-server / session TTL | `oauth.rs:42` | **600 s** |
| state freshness window | `oauth.rs:1232` — `TTL + 5 min`, with a paragraph of rationale | **900 s** |
| start-call timeout | `useOAuthPolling.ts:188` | 12 s |
| token-endpoint timeout | `oauth.rs:126` | 15 s |
| OIDC discovery timeout | `oauth.rs:1116` | 10 s |

At 180 s the frontend sets `setSessionId(null)`, shows *"authorization timed out. Please try
again."*, and **discards the only handle that could redeem the session**. The backend flow
stays live for another 420 s, will complete, will write `oauth_completed`, and will hold valid
tokens that are then evicted unredeemed. The user's retry mints a **second** grant at the
provider; the first is orphaned and, per §0.6, will never be revoked.

The three real connects here took 16.7 s, 8.8 s and 10.1 s, which is why nobody has hit it —
but enterprise SSO plus MFA plus an account chooser routinely exceeds three minutes, and
`oauth.rs:1226-1231` is a written argument about exactly that scenario, made between the two
constants that live in the *other* language.

There is a second-order effect: the poll effect is gated on `isDocumentVisible`
(`useOAuthPolling.ts:105`) and `attempts` re-initialises to 0 on re-entry, so the 180 s budget
is measured in *visible* time and is nondeterministic across window managers.

**Fix:** derive the frontend cap from the backend TTL (return `session_ttl_secs` in
`OAuthStartResult` and compute `MAX_POLL_ATTEMPTS` from it), and on timeout keep the session
id so a late `success` can still be redeemed.

### 7.E — P1: four stored facts, zero pixels; one flag, one component, one page

`oauth_token_expires_at`, `oauth_refresh_count`, `oauth_refresh_fail_count` and
`oauth_refresh_backoff_until` are typed fields on `CredentialLedger`, exported through ts-rs
into `CredentialLedger.ts:17`, parsed by `parseCredentialLedger` — and rendered **nowhere**.
`needs_reauth` reaches exactly one component, mounted in exactly one route. The user-visible
answer to *"is this connection healthy?"* is therefore a green dot from a different subsystem
plus, if they happen to open the Vault, a warning bar.

And `route_revocation_to_healing` — the durable, deduped, severity-graded escalation designed
to fix precisely this — has produced **0 of 205** live healing rows, because
`credential_dependent_persona_ids` returns empty and the function early-returns.

**Fix:** (1) render expiry + last-refresh + fail-count on the credential card
(`RelativeTime` + `Numeric` already exist); (2) surface `needs_reauth` in app chrome, not only
in the Vault; (3) make `route_revocation_to_healing` open a **workspace-level** issue when the
dependent set is empty, since "nothing depends on it yet" is not "nobody cares".

### 7.F — P1: the consent page is somebody else's origin and it gets our IPC token

`lib.rs:590-594` registers `js_init_script(ipc_auth_script)` on an **app-level Tauri plugin**,
so it runs in **every** webview the app creates. `ipc_auth.rs:703` does
`window.__IPC_TOKEN = _t;`. `auth.rs:447` and `:574` create `WebviewUrl::External` windows
pointed at a Supabase authorize URL that immediately 302s to `accounts.google.com`.

The window is labelled `"oauth"` and `capabilities/default.json` scopes permissions to
`"windows": ["main"]`, so that page cannot `invoke` — an **authorization** control, correctly
noted by [external-url-opening](./external-url-opening.md) §3. It is not a **secrecy**
control: the privileged session token is a readable global on a third-party page, and
`on_navigation` returns `true` for every URL except `personas://auth/callback`, so the popup
will follow the provider anywhere and carry the token with it. The second popup additionally
carries the Supabase `anon_key` in its own URL (`auth.rs:557`).

**Fix:** move `js_init_script` off the app-level plugin onto the main `WebviewWindowBuilder`,
or — better, and it is what the credential flow already does — **use the system browser**.
`useOAuthPolling` proves the loopback flow needs no in-app webview at all.

### 7.G — P2: `cloud.rs:824` — the remaining unguarded open

```rust
let _ = open::that(&resp.auth_url);          // commands/infrastructure/cloud.rs:824
tracing::info!("Opened browser for cloud OAuth authorization");
```

A URL from a remote HTTP response, no `Url::parse`, no scheme check, error discarded — and
then a log line asserting success that the discarded error contradicts. The `cmd.exe` half was
addressed 2026-08-16 by the Cargo feature; **the validation half and the swallowed error are
still here.** [external-url-opening](./external-url-opening.md) §7.C owns the launcher; what
belongs to this leaf is that this is the **cloud OAuth consent redirect**, and a user who
clicks Connect and sees nothing has no way to distinguish a refused URL from a missing
browser.

`CloudOAuthPanel.tsx:48` and `:209` are the two dead `target="_blank"` consent links in that
same panel (that path's census baseline).

### 7.H — P2: the ledger written by string key, in two shapes that disagree

The §9 rule's 16 matches. Two live consequences worth naming:

1. **`oauth_refresh_fail_count` has two "reset" values.** `cli_capture.rs:875` writes
   `Number(0)`; `CredentialLedger::clear_refresh_backoff()` writes `None`, and
   `#[serde(skip_serializing_if = "Option::is_none")]` then *drops the key*. Any reader that
   asks `meta.get("oauth_refresh_fail_count").is_some()` sees two different worlds.
2. **`record_oauth_refresh()` has zero callers** while `oauth_refresh.rs:588-607` writes the
   same six fields as string keys — including `patch.insert("needs_reauth", Null)`, which is
   what `clear_needs_reauth()` (also zero external callers) exists to do. `merge_oauth` is
   likewise uncalled. **The typed record is complete, correct, and bypassed.**

### 7.I — P2: the flow's own English, and what depends on it

`useOAuthPolling.ts` composes seven user-facing messages in hardcoded English (`:135`, `:153`,
`:160`, `:169`, `:196`, `:236`, `:254`), rendered as visible text by
`OAuthProgressRing.tsx:154-165`, in a 14-language app whose `en.json` already contains
`vault.forms.authorizing_with`, `vault.forms.oauth_consent_hint` and
`vault.forms.authorization_complete`. `OAuthSection.tsx:48` (`Authentication`) and
`:73` (`'Authorize with Google'`) are hardcoded too.

**And one of those literals is load-bearing:** `OAuthSection.tsx:27` derives the progress-ring
phase with `pollingMessage?.message?.includes('consent page opened')`. Translating the string
at `useOAuthPolling.ts:236` silently breaks the ring. **The i18n debt is currently protecting a
control-flow bug**, which is the only reason it has not fired.

### 7.J — P3: three smaller ones

1. **The connect audit trail cannot be joined to what it created.**
   `apply_oauth_outcome` passes `session_id` as the audit row's `credential_id` and the
   *connector* name as `credential_name` (`oauth.rs:1454-1462`). 6 of 6 live rows; 0 of 3 ids
   resolve. Worse, the whole `audit_log::insert` sits **inside** `if let Some(s) =
   sessions.get_mut(session_id)`, so a callback arriving after the 600 s eviction records
   nothing at all — success or failure.
2. **The OAuth session map is process-memory only.** `OAUTH_SESSIONS: OnceLock<Mutex<HashMap<..>>>`
   (`oauth.rs:1381`), 50-entry cap, 10-minute TTL. An app restart mid-consent loses the flow
   with no durable trace, and the callback listener dies with it while the provider still
   holds a live grant. Cross-reference
   [process-global-command-state](./process-global-command-state.md).
3. **The revocation classifier is a substring scan of the provider's prose.**
   `is_revocation_error` (`connector_strategy.rs:513-527`) lowercases the body and looks for
   six indicators including the English sentence `"Token has been expired or revoked"`. It is
   correct today and it is the same shape as `extract_http_status`'s scan for `"HTTP "` that
   [connection-health-check](./connection-health-check.md) §6 measured as never firing. Match
   on the JSON `error` field, not on the body.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **`invalid_grant` is inherently ambiguous and no design fixes that.** RFC 6749 §5.2 uses one
   code for "expired, revoked, malformed, or issued to another client", and Google's own text
   is literally *"Token has been expired or revoked"*. **P6 is written the way it is because of
   this gap:** collapse the state, never the copy. `ReauthBanner.tsx:155` currently renders
   *"access was revoked"* for all of them, which asserts more than the provider said.
2. **A refresh token has no observable lifetime.** Providers do not publish one; Google's
   expire on 6 months of disuse, on password change, on scope change, on a 50-token-per-client
   limit. No amount of engineering lets this app predict a revocation — which is exactly why P5
   (a terminal state with a keeper) is the load-bearing clause and prediction is not.
3. **A successful refresh proves the grant is alive, not that the scope is sufficient.**
   `scopes` is captured at connect (both live credentials carry a plaintext `scopes` row, 151
   and 188 chars) and read back by nothing. A token that can read a calendar and not write one
   passes everything this path prescribes. Shared with
   [connection-health-check](./connection-health-check.md) §8.3.
4. **The client credentials cannot reach the refresh path.**
   `resolve_credentials: fn() -> Result<(String,String)>` is a zero-argument function pointer
   over environment variables. Fixing it means changing the trait signature to accept the
   credential's own fields — a real change, not a gap in principle, but it is genuinely
   outside what any *caller-side* type discipline can do (doctrine, "where types cannot reach",
   case 3).
5. **The census cannot see any of §0.** Every headline finding is an **absence** — a call that
   is not made, a predicate that does not match its twin, a state that does not exist, a
   revocation endpoint nobody invokes. Per the doctrine the census ratchets things *present*;
   §9 gates a different, countable thing and says so.
6. **Nothing detects a fabricated expiry from inside a single process.** The 45-minute
   signature is only visible by *joining a metric row to the interval since the previous one* —
   i.e. across time, in the database. No unit test, no type and no lint can see it at either
   site, and the instrument that found it (`used_fallback`) already existed and was already
   being written. **The gap is not measurement; it is that nobody asked the data a question.**

---

## 9. The missing gate

### The condition, stack-free

> **A record's fields are addressed by name-as-data rather than through the type that owns
> them, so two writers of the same fact can disagree and nothing relates them.**

This is the countable residue of §0. It is *not* the headline defect — the headline defect is
an absence and cannot be counted (§8.5). It is the mechanism that let the headline defect
spread: one expiry in two stores, one counter reset to two different values, and a typed
method that does the whole job correctly sitting at zero callers while its string-keyed
equivalent runs every hour.

**The proxy, for this stack:** a `CredentialLedger` field name appearing as a **quoted string
literal** anywhere in the Rust tree outside the type's own module.

### Existing rules checked first

I read all **116** rules in `scripts/census/rules.json` before authoring, and checked these six
by name:

- **`unverifiable-probe-read-as-verified`** (`connection-health-check.md`, 9/9) — the nearest
  neighbour by subject. `roots: ["src"]`, `.ts/.tsx`, keys on a **comparison operand**. Mine is
  `roots: ["src-tauri"]`, `.rs`, keys on a **string literal**. **Zero file overlap and zero
  match overlap by construction** (different languages).
- **`settings-key-declared-outside-registry`** (`app-settings-store.md`, 8/10) — the closest
  *shape*: a key name spelled outside the registry that owns it. Different anchor
  (`const …_KEY: &str =` **declarations**, not usages), different registry, disjoint literals.
  Confirmed no overlapping match. It is the strongest precedent that this class of rule works
  here, and its golden path records two live features permanently disabled by the same
  mechanism.
- **`secret-as-bare-string-field`** (`secret-display-and-transfer.md`, 10/12) — Rust struct
  *fields*, not literals. No overlap.
- **`deferred-read-then-write`** (`transaction-boundary.md`, 10/12) — same roots and extension,
  and the ledger writers are transaction sites, so I checked directly: its anchor is
  `.transaction()` followed by a literal `SELECT`; **none of my 16 matches is inside its
  pattern's span**, and its 12 are in migration/repo code that contains none of my literals.
- **`model-struct-without-rename-all`** / **`bigint-binding-field`**
  (`persisted-model-struct.md`, 40/198 and 142/294) — both key on `#[derive]`/type
  declarations. `CredentialLedger` is *matched* by neither concern. No overlap.
- **`untyped-command-payload`** (`new-ipc-command.md`, 40/104) — IPC parameter shapes, not
  record fields. No overlap.

**No existing rule looks at a persisted record's field names.** The corpus gates declarations,
call sites, types and statements; the string that addresses a field is data, and — as
`column-encryption-at-rest` found for regex bodies — no rule in the corpus reads data.

### Where it runs

`npm run census:check`, which is a step of **`npm run check`** — the script the PR self-review
ritual in `.claude/CLAUDE.md` requires green before a branch leaves the box, and which the
`golden-path-census` pre-push job also runs. **Deliberately not CI-only:** per the brief's
calibration, `ci.yml` is red on 10 pre-existing Rust failures, and a gate that only runs there
runs nowhere.

**How it fails loudly if its own precondition is absent** — inherited from the runner, not
re-derived: the run **fails** when the walk sees fewer than `floor: 900` files (measured
**963**, matching `shared-facts.json`'s `rust.files`), when the rule matches zero files
anywhere, when an `exclude` entry goes stale, when the count rises, **and when it drops without
the baseline moving**. I verified the last one by accident: my first baseline said 7 files, the
runner reported 6, and it refused the run with a `[drift] files dropped 7 -> 6` failure rather
than passing quietly. Surviving counts print on success.

### The signal, and its precision

**16 matches in 6 files, all sixteen hand-opened. Precision 16/16.** Two sub-classes, both
violating and both with a legal fix:

| site | key | typed alternative |
|---|---|---|
| `oauth_refresh.rs:590,594,598` | `oauth_refresh_count`, `oauth_last_refresh_at`, `oauth_predicted_lifetime_secs` | `record_oauth_refresh()` — **0 callers** |
| `oauth_refresh.rs:606,607` | `needs_reauth`, `needs_reauth_at` → `Null` | `clear_needs_reauth()` — 0 external callers |
| `cli_capture.rs:875,879` | `oauth_refresh_fail_count` → `Number(0)`, `oauth_refresh_backoff_until` → `Null` | `clear_refresh_backoff()` — **and note it writes `None`, not `0`** |
| `cli_capture.rs:884,885` | `needs_reauth`, `needs_reauth_at` | `clear_needs_reauth()` |
| `rotation.rs:306,369,1429` | `anomaly_tolerance`, `healthcheck_results`, `oauth_last_refresh_at` (reads) | `ledger.resolve_tolerance()`, `.healthcheck_results`, `.oauth_last_refresh_at` |
| `runner/credentials.rs:862,866` | `healthcheck_last_success`, `healthcheck_last_success_at` | typed fields exist |
| `db/…/credentials.rs:870`, `healthcheck.rs:629` | `healthcheck_last_tested_at`, `healthcheck_last_state` | **no typed field** — these land in the `custom` catch-all; the legal fix is to *add* the field, which is [connection-health-check](./connection-health-check.md) §7.E's own prescription |

The second sub-class is why the rule is scoped to the whole ledger rather than to the OAuth
keys alone (which would be 10/3): the two halves are one condition with one fix, the
health half was already named as a gap by the neighbouring path and shipped no gate for it, and
a rule that stops at the leaf boundary would leave the *worse* sub-class — a fact that is not
in the type at all — uncounted.

`oauth_token_expires_at` is **deliberately excluded from the pattern**, and its exclusion is
the finding it protects: that key names a `credential_fields` **row** as well as a ledger
field, so its 9 further occurrences are a mix of two stores and including them would drop
precision to 13/25 (52%). *The one key that is ambiguous in the pattern is the one key that is
ambiguous in the system* — and it is the one that already disagrees with itself on 2 of 2 live
rows.

### The positive control — it partitions the anchor

The anchor is "code that reaches credential-ledger state". The violating half addresses it by
string; the compliant half goes through the typed record. **They are disjoint by construction**
(a `CredentialLedger` method call contains no quoted field name) and together they are the
whole surface.

```
  rule                                                     files  base  matches  base  walked  floor
  OK  ledger-field-addressed-by-string-key                     6     6       16    16     963    900
  OK  ledger-field-addressed-by-string-key-positive-control    4     —       24     —     963    900
```

**24 compliant vs 16 violating — a 1.5:1 partition, not a ratio against an unrelated
population.** The decisive file is `src-tauri/db/src/repos/resources/credentials.rs`, which
contributes **5 control matches and 1 rule match**: the repository layer that *owns* the ledger
parses it typed (`CredentialLedger::try_parse` ×3, `increment_refresh_backoff`,
`CredentialLedger::parse`) and reaches for a string key exactly once, for the one key that has
no typed field. If the rule were keying on "credential vocabulary" rather than on
name-as-data, that file would light up as the worst offender in the tree instead of the best
citizen.

```json
{
  "id": "ledger-field-addressed-by-string-key",
  "goldenPath": "docs/concepts/golden-paths/oauth-connect-flow.md",
  "title": "A credential-ledger field is read or written by string key instead of through the typed record that owns it — so two writers of the same fact can disagree and nothing relates them.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\"(?:oauth_refresh_count|oauth_last_refresh_at|oauth_predicted_lifetime_secs|oauth_refresh_backoff_until|oauth_refresh_fail_count|needs_reauth|needs_reauth_at|healthcheck_last_state|healthcheck_last_success|healthcheck_last_success_at|healthcheck_last_tested_at|healthcheck_results|usage_count|last_used_at|anomaly_score|anomaly_tolerance)\"",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A CredentialLedger field name spelled as a quoted string literal outside the module that declares it — i.e. the credential's OAuth/health/usage ledger addressed as data rather than through the typed record. PROXY FOR the stack-free condition: a record's fields are addressed by name-as-data rather than through the type that owns them, so two writers of the same fact can disagree and nothing relates them. LEGAL DESTINATION: personas_core::models::CredentialLedger (core/src/models/credential_ledger.rs:68) plus cred_repo::update_ledger(pool, id, |l| ...) — the typed methods record_oauth_refresh (:268), clear_needs_reauth (:262), mark_needs_reauth (:256), clear_refresh_backoff (:250), increment_refresh_backoff (:234), is_in_refresh_backoff (:224), resolve_tolerance (:202) already exist. MEASURED 2026-08-16 at 7b42f9333: 6 files / 16 matches, ALL SIXTEEN HAND-OPENED, precision 16/16, and the control below reports 24 compliant matches in 4 files (a 1.5:1 partition of the same anchor, disjoint by construction). WHY IT IS A DEFECT AND NOT STYLE: (a) record_oauth_refresh() writes exactly the six fields that oauth_refresh.rs:588-607 writes by hand and it has ZERO callers in 963 .rs files, so the typed record is complete, correct and bypassed; (b) two paths that both mean 'reset the failure counter' write DIFFERENT VALUES - cli_capture.rs:875 writes Number(0) while clear_refresh_backoff() writes None, and serde(skip_serializing_if=Option::is_none) then drops the key, so a reader asking .is_some() sees two different worlds; (c) the same habit put oauth_token_expires_at in TWO stores (a credential_fields row AND the metadata blob) written by three different functions with no single writer - measured on the operator's live vault, the two copies already disagree on 2 of 2 OAuth credentials, by 17.6us and 20.0us. NOTE THE DELIBERATE OMISSION of oauth_token_expires_at from this pattern: that literal names a credential_fields ROW as well as a ledger field, so including it adds 9 matches of mixed provenance and drops precision from 16/16 to 13/25. The one key too ambiguous for the pattern is the one key too ambiguous for the system. TWO SUB-CLASSES, both violating, different legal fixes: 12 matches name a field that EXISTS on CredentialLedger (fix: call the typed method), 4 name a key that does NOT (healthcheck_last_state, healthcheck_last_tested_at - they land in the flattened `custom` map; fix: add the typed field, which is connection-health-check.md 7.E's own prescription). PRECONDITION (must be re-derived per repo): this repo carries a per-entity JSON ledger as a serde struct with snake_case fields and a #[serde(flatten)] catch-all, and writes patches as serde_json::Map with &str keys. A repo whose ledger is columns, or whose keys are enum variants, has the same condition wearing markup this pattern cannot see. DO NOT silence a match by building the key from a constant or by splitting the literal - both preserve the defect and hide it; the honest fix always goes through the type.",
    "$measured": "2026-08-16 @ 7b42f9333 — 963 .rs files walked; validated standalone in a scratch registry unique to this composer, counts reproduced independently by ripgrep's Rust regex engine, then re-extracted from this finished document and re-run: identical. Runtime 0.39 s for both rules."
  },
  "exclude": [
    {
      "path": "src-tauri/core/src/models/credential_ledger.rs",
      "reason": "the type itself — its serde attributes and doc comments legitimately spell every field name, and one method body (record_oauth_refresh) calls another by name. Excluding the file rather than pattern-matching around it keeps the rule readable, at the stated cost that a stray string-keyed write added INSIDE the ledger module would be invisible."
    }
  ],
  "baseline": { "files": 6, "matches": 16 },
  "floor": 900
}
```

```json
{
  "id": "ledger-field-addressed-by-string-key-positive-control",
  "goldenPath": "docs/concepts/golden-paths/oauth-connect-flow.md",
  "title": "POSITIVE CONTROL — not a gate. The same credential ledger reached through the typed record: the compliant half of the anchor, which this rule must never report.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "update_ledger\\s*\\(|CredentialLedger::(?:parse|try_parse)\\s*\\(|\\.\\s*(?:merge_health|merge_oauth|merge_usage|mark_needs_reauth|clear_needs_reauth|clear_refresh_backoff|increment_refresh_backoff|record_oauth_refresh|record_usage|resolve_tolerance|oauth_expires_at|is_in_refresh_backoff)\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "NOT A GATE — carries no baseline by design. Same roots, same extension, same 963-file walk, pointed at the COMPLIANT half of the identical anchor: the credential ledger reached through cred_repo::update_ledger or through a CredentialLedger method. Disjoint from the rule BY CONSTRUCTION — a method call contains no quoted field name. MEASURED 2026-08-16 at 7b42f9333: 4 files / 24 matches against the rule's 6 / 16. The decisive file is src-tauri/db/src/repos/resources/credentials.rs, which contributes 5 CONTROL matches (CredentialLedger::try_parse x3, increment_refresh_backoff, CredentialLedger::parse) and exactly 1 rule match, for the one key that has no typed field — so the rule is discriminating on name-as-data and not on credential vocabulary; a vocabulary-keyed rule would report the repository layer that owns the ledger as the worst offender in the tree. Run both together whenever the rule's pattern is edited: if this control collapses, the walk or the anchors broke rather than the codebase being fixed. It is expected to RISE as the 16 violations are converted, which is exactly why it must never be baselined.",
    "$measured": "2026-08-16 @ 7b42f9333 — 4 files / 24 matches via the real runner; commentMatchesSkipped 0 for both rules, so the runner's counts equal a raw scan's."
  },
  "exclude": [
    {
      "path": "src-tauri/core/src/models/credential_ledger.rs",
      "reason": "the type itself — excluded on both rules so the two counts are taken over an identical file set and the partition is arithmetic, not an artefact of different walks."
    }
  ],
  "floor": 900
}
```

### Verification of this gate's own preconditions

- **Backtracking checked, not assumed.** Both patterns are a single flat alternation of
  literals inside one non-capturing group, with one `\s*` in the control. **No nested
  quantifier, no alternation inside a quantifier, no lookbehind.** Real-runner wall time over
  963 files: **0.39 s for both rules together.**
- **`floor: 900` against 963 walked**, matching `deferred-read-then-write`'s precedent for this
  root — several rules over one root must not hold different opinions about what "the tree is
  intact" means.
- **`commentMatchesSkipped: 0` on both**, so `ignoreCommentLines` is currently inert and the
  runner's counts equal a raw scan's. It is kept because the legal fix involves writing prose
  *about* these keys, and a doc comment must not resurrect the count.
- **Two engines agree exactly.** Ripgrep (the Rust `regex` crate, which the app links) and the
  runner's Node `RegExp` both return 16 in 6 files and 24 in 4 files after the exclude. The
  one initial disagreement was **my own miscount of the file list**, not the engines' — and the
  runner caught it by failing the drift check rather than passing quietly.
- **Re-extraction check performed.** Both blocks above were pasted back out of this finished
  document into `rules-oauth-connect-flow-probe.json` in the scratchpad (filename unique to this
  composer) and re-run through the real runner —
  `node scripts/census/run-census.mjs --rules <scratch>/…`, not a re-implementation. Identical:
  **6 / 16 / 963 / floor 900** and **4 / 24**, no baseline on the control, no structural
  problems, exit 0.
- **The full registry was NOT run**, per the doctrine. The orchestrator runs it on merge.
- **This rule can and should reach zero.** When it does, the runner fails structurally on a
  zero-match rule **by design** — **delete it then, do not baseline it at 0.** The 12 matches
  with a typed alternative are one commit; the 4 without need a field added first.

### What this gate does NOT catch, named per the contract's fifth failure mode

It ratchets *how* the ledger is addressed. It says **nothing** about whether what is written is
true — and §0 is entirely about writes that are false. A codebase in which all 16 sites go
through `record_oauth_refresh()` still fabricates 265 expiries an hour, because
`record_oauth_refresh(expires_at, predicted)` takes the fabricated numbers as parameters.
**The gate on the destination's defaults is the `TokenOutcome` split in §4, and it is not a
ratchet — it is one enum.** Ship both, and ship that one first.

---

## 12. Corrections to the brief

The brief made eight priming claims. **Three were correct, three were the wrong frame, one
inverted under measurement, and one is a label that does not hold.**

1. **"sides = client" — the spine under-describes this leaf by a wide margin.** The client half
   is a button, a progress ring and a warning banner: three components, one of which is the
   only OAuth surface in the product. **Every finding in §0 is server-side.** The document is
   written two-sided with the contract stated in §7's second-pass note. If the spine is edited,
   this leaf is `twoSided: true` with the weight on `server`.

2. **"convergence = CONVERGED" — it does not hold, and this is now the fourth CONVERGED label
   in this campaign to fail.** See the Warrant block. The capture half converges strongly (P8,
   P9 and the state/PKCE mechanics are reinvented wherever a real flow exists); **the lifecycle
   half — P1, P2, P3, P4, P5, P10 — is silent or diverged across the fleet.** The honest label
   is `mixed`, and the split is exactly along the handshake/lifetime seam that P1 names. Treat
   the CONVERGED label as what it was: a claim about the part of the subject that has a
   specification.

3. **"The consent links are dead — so how does a user actually complete a connect today?"
   Wrong premise for this leaf, and the answer matters.** The **credential** consent flow has
   never used a dead affordance: `useOAuthPolling.ts:212-219` sanitizes and then calls
   `openExternalUrl`, a wired door. The dead links are `CloudOAuthPanel.tsx:48` and `:209`,
   which belong to *cloud-account* OAuth (`cloud_oauth_authorize`), a different command and a
   different subject. The `window.open` at `useOAuthPolling.ts:225` is a `catch` fallback that
   is unreachable-by-suppression, and its error message — *"Please allow popups or external
   browser open"* — is browser advice in an app with no popup blocker. Three real connects
   completed here in 16.7 s, 8.8 s and 10.1 s. **The connect flow works; the connection does
   not last.**

4. **"`cloud.rs:824` — a URL from a remote HTTP response, zero validation, error discarded."
   Confirmed verbatim, and one detail worth adding:** the very next line logs *"Opened browser
   for cloud OAuth authorization"* unconditionally, so the log asserts the success the
   discarded `Result` may be contradicting. §7.G.

5. **"`oauth_token_expires_at`, `oauth_refresh_backoff_until` and `needs_reauth` live in an
   unencrypted metadata JSON blob." Confirmed, and the interesting part is one layer down.**
   They are not loose keys — they are typed fields on `CredentialLedger`, ts-rs-exported, with
   typed accessors. **The defect is that the typed record is bypassed** (16 sites, §9), which is
   also why `oauth_token_expires_at` additionally exists as a `credential_fields` row and the
   two copies already disagree on 2 of 2 live credentials.

6. **"A run that gets a 401 and an `invalid_grant` writes one log line while the background
   refresher writes all three." Confirmed — and superseded by a larger asymmetry.** The
   background refresher's three writes are real and this installation carries their evidence 90
   days later. But the refresher **also** stops: past the 7-day staleness ceiling it drops the
   credential from both loops with no state change, no event and no further attempt, and both
   live credentials crossed that line 77 and 67 days ago. **The path that records is also the
   path that forgets.** The `api_proxy` gap is a missing write; this is a missing *state*, and
   it is worse because nothing anywhere models it.

7. **"The refresh ledger is an unbounded retry." Inverted under measurement, and the inversion
   is the finding.** The retries are not unbounded — they stopped 77 and 67 days ago, and the
   thing that stopped them was neither the backoff nor `needs_reauth` but an incidental
   staleness ceiling comparing *now* against a **fabricated** expiry. The brief's *mechanism* is
   nonetheless real and measured: `is_in_refresh_backoff()` has **1 reader against 6 exchange
   entry points**, and the live consequence is 16 failed exchanges in a single day against a
   declared 24-hour backoff, plus two counters of the same event that disagree by 42 (112 vs
   70). **"A loop that never reads the flag" is right about the flag and wrong about the loop:
   `needs_reauth` is indeed never consulted, and it would not have mattered, because the loop
   had already stopped running.**

8. **"Two OAuth popups are `WebviewUrl::External`, and `js_init_script` reaches every webview
   unconditionally." Confirmed, both halves, and the composition is sharper than either.**
   `lib.rs:590-594` registers the script on an **app-level plugin**, and `ipc_auth.rs:703`
   writes `window.__IPC_TOKEN`. So the privileged session token is a readable global on
   `accounts.google.com`. The capability scoping that
   [external-url-opening](./external-url-opening.md) correctly identified stops that page from
   *invoking* — it does not stop it from *reading*. §7.F.

**And the four brief questions, answered.**
*What is the full happy path today?* — §0.1: browser-based loopback, PKCE, HMAC state, server-
side redemption. It is good.
*Where does `state` come from and is it verified?* — a per-install keyring HMAC over
`{nonce}.{timestamp}`, verified **twice** on the callback (session echo **and** signature),
with a stale-but-authentic state distinguished from a forged one. The best state handling in
the six-repo sample.
*Is PKCE used?* — always for Google, per-provider for the registry (7 of 12 declare support),
and **off by default on the one branch that accepts a caller-supplied endpoint** (§7.A).
*What happens on a callback that never arrives?* — the listener holds for 600 s and the session
is evicted, but **the frontend gives up at 180 s**, discards the session ref, and tells the user
to try again — orphaning a grant that will never be revoked (§7.D, §0.6).
*Is a revoked grant distinguishable from an expired one anywhere in the UI?* — **No, and it
should not be** (§8.1: the protocol refuses to say). What is a defect is the opposite: the one
surface that exists asserts *"access was revoked"* for every case, including the ones where the
provider said *"expired **or** revoked"*, and the four other paths that learn the same fact
(`api_proxy`, `tool_runner`, the health probe, `runner/credentials.rs`) never set the flag at
all — so the honest answer to *"can the user tell?"* is that most of the time the user is not
told anything.
