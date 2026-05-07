# In-App HTTP Service — Browser-Reachable Endpoints

**Status:** Implemented in `src-tauri/src/local_http/` for the Langfuse auto-login flow (Phase 1d). This doc captures the pattern for future re-use.
**Last updated:** 2026-05-07

---

## Why

Some integrations need a URL that the **user's default web browser** can hit but that **isn't owned by the integrated service**. Tauri commands can't be browser-reached (they're IPC, not HTTP). External servers don't fit either — they'd need cloud hosting, auth, and would defeat the local-first design.

Concrete cases that motivated the build:

- **Auto-login bridge.** Langfuse uses NextAuth with HttpOnly session cookies. Only Langfuse can mint that cookie. We can't paste credentials from the desktop into the user's browser. We *can* run a local HTTP endpoint that performs the credentials POST on the user's behalf and lets the browser end up at Langfuse with a valid session.
- **Inbound webhooks.** GitLab, Stripe, GitHub etc. POST to a URL on every event. If we want to react to those without a public cloud relay, the URL has to live on the user's machine.
- **OAuth redirect targets.** Services that require an OAuth flow ship the user back to a `redirect_uri`. If the integration is local-first, that URL needs to be local.
- **Shareable magic links.** Future: a "Share this trace" link the user emails to a teammate that opens Personas with the right context preloaded.

These all share the shape: **127.0.0.1, free port, mountable routers, a nonce store for sensitive endpoints**. So we built the chassis once.

## Architecture

```
src-tauri/src/local_http/
  mod.rs                   ← server bootstrap, port, router registry, nonce store
  langfuse_routes.rs       ← /langfuse/auto-login (Phase 1d)
  ...future...
  gitlab_routes.rs         ← /gitlab/webhooks/<...>
  oauth_routes.rs          ← /oauth/<provider>/callback
```

### Server lifecycle

- One server per process, started in `lib.rs`'s setup hook via `local_http::start()`.
- Bound to `127.0.0.1` on the first free port at-or-above `17400`. Bound only to loopback — not reachable from the LAN.
- Runs for the lifetime of the process; no graceful shutdown surface (the process dies with the user closing the app).

### Router registration

```rust
// In any module, before local_http::start() is called:
local_http::register_router("gitlab", gitlab_routes::router());

// In lib.rs setup, after every prospective router has registered:
local_http::start()?;
```

Registrations after `start()` are dropped with a `tracing::warn!` — call them in setup, not at runtime.

Routes mount at `/<prefix>/...`. A handler at `Router::new().route("/webhook", post(handler))` registered with prefix `gitlab` becomes `http://localhost:<port>/gitlab/webhook`.

### Nonce store

`mint_nonce()` returns a fresh UUID with a 60-second TTL. `consume_nonce(s)` returns `true` exactly once per minted token. Used to gate sensitive endpoints — without a nonce, anyone on the local machine could replay a URL.

### Port lookup

`local_http::port()` returns `Some(u16)` once the server is bound. Tauri commands compose URLs against this — they don't hard-code 17400.

---

## Current consumer: Langfuse auto-login

`GET /langfuse/auto-login?nonce=…&return_to=…`:

1. Consume the nonce.
2. Read host + admin email/password from the keyring.
3. Server-side `GET <host>/api/auth/csrf` to capture both the body's `csrfToken` and the full `next-auth.csrf-token` cookie value.
4. Render HTML with `Set-Cookie: next-auth.csrf-token=...; Domain=localhost; Path=/; SameSite=Lax` and a hidden auto-submitting `<form>` POSTing `csrfToken`/`email`/`password`/`callbackUrl` to `<host>/api/auth/callback/credentials`.
5. Browser submits the form, NextAuth verifies (cookie value == body token, both ours), issues `next-auth.session-token`, redirects to the dashboard or `return_to`.

Two things were load-bearing:

- **Serve from `localhost:<port>`, not `127.0.0.1:<port>`.** Setting `Domain=localhost` from a `127.0.0.1` response is rejected by spec-compliant clients (Domain must match or be a parent of the request host), which silently drops the cookie and breaks the cross-port share.
- **Same-site, different-origin shape.** `localhost:<our-port>` and `localhost:3000` resolve to the same eTLD+1, so SameSite=Lax permits the cross-port form POST. The pattern works for any other localhost-only service we'd integrate with.

---

## Reusability scenarios

### A. GitLab pipeline webhooks (and any other webhook source)

Today, our GitLab integration polls. With `local_http`, GitLab can POST to us instead.

```rust
// gitlab_routes.rs
pub fn router() -> Router {
    Router::new()
        .route("/webhook", post(receive_pipeline_event))
}

async fn receive_pipeline_event(headers: HeaderMap, body: String) -> impl IntoResponse {
    // Validate X-Gitlab-Token against the secret we shared at registration time.
    // Forward the parsed event onto the existing GitLab event bus.
    // Return 200 fast — GitLab retries 5xx and times out aggressively.
}
```

Setup flow:
1. User connects GitLab → we generate a webhook secret + URL `http://localhost:<port>/gitlab/webhook`.
2. Local URL alone isn't reachable from gitlab.com → we'd need a **publicly reachable URL**.
3. Two paths:
   - User runs an exposed tunnel themselves (cloudflared, ngrok, Tailscale Funnel) and pastes the public URL into our settings.
   - We auto-launch a tunnel ourselves (Phase 2 — would need a Cloudflare Quick Tunnels or similar dependency).

The interesting half (the local handler) is one router away.

### B. OAuth redirect targets

Plenty of services (Notion, Slack, Linear, Figma, Asana already in the app, Hubspot, …) require an OAuth flow with a fixed `redirect_uri`. Many providers permit `http://localhost:<any-port>/...` as a redirect target for desktop apps.

```rust
// oauth_routes.rs
pub fn router() -> Router {
    Router::new()
        .route("/notion/callback", get(notion_callback))
        .route("/linear/callback", get(linear_callback))
}

async fn notion_callback(Query(q): Query<OAuthQuery>) -> impl IntoResponse {
    // Validate `state` against a nonce we minted before opening the OAuth URL.
    // Exchange `q.code` for tokens server-side.
    // Store tokens in the credential vault.
    // Render a "You can close this tab" HTML page that also dispatches a
    // Tauri event so the open desktop window jumps to the relevant settings.
}
```

The `state` parameter is exactly what `mint_nonce()` is for — we're already binding state to a single-use token with TTL.

### C. Shareable magic links for traces

Hypothetical Path-B feature: "Share this run" produces `https://personas.app/share/<id>`. The recipient (no Personas install) clicks → public Langfuse trace. The recipient (with Personas) clicks → a deep-link handler routes them to the trace inside Personas.

For the Personas-installed case, the OS-level deep-link handler (`personas://trace/<id>`) already runs. But OAuth/magic-link cases benefit from a localhost URL that a user can paste into their browser, especially during onboarding.

### D. Local mock / test endpoints

For tests that need a Langfuse-shaped endpoint without standing up the real stack, we can register a mock router under `/__mock/...` (debug builds only) that the exporter can be pointed at. Faster iteration than booting Docker.

### E. Internal Personas dev tooling

The test-automation HTTP server already lives at port 17320 and was the inspiration for the API shape. As we add more internal tooling that needs to be browser-reachable (for example, an "open Sentry issue in browser" deep-link that needs a one-time auth token), `local_http` is the seam.

---

## Security boundaries

- **Loopback only.** `bind(127.0.0.1)`. Nothing on the LAN can reach the server.
- **Single-use nonces with 60s TTL.** Sensitive endpoints validate via `consume_nonce()`. Replays return 403. Without a nonce, the endpoint should still refuse to do anything dangerous.
- **No CORS by default.** Don't add `Access-Control-Allow-*` headers unless an integration specifically needs cross-origin fetch from the user's browser. Webhooks don't need it (CORS doesn't gate non-browser POSTs). Auto-login uses navigation, also doesn't need CORS.
- **Secrets stay server-side when possible.** The Langfuse auto-login emits the user's admin password into the HTML response. That's acceptable because the response goes only to the user's own loopback browser, but the same isn't true of every endpoint. For a webhook that needs to validate a signing secret, fetch the secret from keyring inside the handler — don't render it.
- **Be careful with `Domain=` on Set-Cookie.** Setting `Domain=localhost` works for cross-port sharing but only when the response is served from a host that matches that domain. We learned this the hard way (Phase 1d live-debug session).
- **Browser navigation doesn't leak the URL to the integrated service.** Langfuse never sees `localhost:<our-port>/langfuse/auto-login` — the browser navigates there, runs our HTML, then navigates to Langfuse with a fresh form POST. The Referer header *might* leak, so don't put real secrets in URL query strings; nonces are fine because they're single-use.

---

## Recipe for adding a new integration

```rust
// 1. Create a new module under src-tauri/src/local_http/
// 2. Define a router function:
pub fn router() -> Router {
    Router::new()
        .route("/some-endpoint", get(handle_some))
        .route("/another", post(handle_another))
}

// 3. Register it in lib.rs setup BEFORE local_http::start():
local_http::register_router("my-integration", my_routes::router());

// 4. Build URLs against the live port:
let port = local_http::port().ok_or(...)?;
let url = format!("http://localhost:{port}/my-integration/some-endpoint");

// 5. For sensitive endpoints, gate with a nonce:
let nonce = local_http::mint_nonce();
let url = format!("http://localhost:{port}/my-integration/secret?nonce={nonce}");

// In the handler:
if !local_http::consume_nonce(&query.nonce) {
    return (StatusCode::FORBIDDEN, "Invalid or expired link").into_response();
}
```

For testability, expose a `#[cfg(feature = "test-automation")]` Tauri command that returns the URL string instead of opening a browser, so the regression suite can drive the flow with curl.

---

## Future ideas worth considering

- **Per-route signed tokens** rather than opaque nonces. Some integrations need URL-bearer tokens that survive longer than a click (webhook secrets, magic links shared by email). Add an HMAC-signed token type alongside the in-memory nonce.
- **Persistent webhook secrets in keyring.** Each integration declares its secret name; `local_http` exposes a helper to fetch + verify HMAC headers.
- **Tunnel orchestration.** Phase 2 idea: an optional managed Cloudflare Quick Tunnel for receiving webhooks without the user setting up tunnels themselves. Same `local_http` server stays the upstream; the tunnel just relays.
- **Status page.** `GET /` returns a small JSON with `{ "service": "personas-local-http", "registered_routers": [...] }` for sanity-checking from the user's browser without exposing implementation details.
- **Rate-limited routes.** A token bucket per IP-and-path would harden any endpoint that does work with secrets in the loop.
