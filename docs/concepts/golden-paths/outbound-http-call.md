# Golden path — the outbound HTTP call

> Situation node: `integrations-security/external-and-host-surfaces/outbound-http-call` ·
> [situation spine](../situation-spine.md) · recurrence 23 · risk **HIGH** ·
> sides **both** · convergence **mixed** ·
> dimensions: **security · resilience · function · cost · code-quality**
> Composed 2026-08-15 against `master` @ `0b9418d32`.
>
> **Sweep size.** All **963** non-generated `.rs` files under `src-tauri/` (exactly
> `rust.files` in [`shared-facts.json`](../shared-facts.json)) and all **4,829**
> `.ts`/`.tsx` files under `src/`. `#[cfg(test)]` was removed by a **brace-matched
> range** with a string/comment-aware scanner, never a line threshold; comments were
> blanked offset-preserving so line numbers survive. Every headline count was taken
> by **two independent implementations** and is reported only where they agreed —
> and where they disagreed, that is reported too (§6, "the vocabulary disagreement").
>
> **Measured by executing, not reading.**
> 1. A **real two-hop HTTP listener** was started on loopback (hop 1 → `302` → hop 2
>    on a different port) and driven with three credential headers, to observe which
>    ones a redirect-following client actually forwards.
> 2. reqwest **0.12.28's own source** was read from the cargo registry — not its
>    docs, not memory — for the three defaults this path turns on:
>    `Config::default` (`src/async_impl/client.rs:299-314`) gives
>    `connect_timeout: None`, `read_timeout: None`, **`timeout: None`**;
>    `redirect_policy: Policy::default()` (`:310`) is `Policy::limited(10)`
>    (`src/redirect.rs:160-165`); and `remove_sensitive_headers`
>    (`src/redirect.rs:239-251`) strips **only** `Authorization`, `Cookie`,
>    `cookie2`, `Proxy-Authorization`, `WWW-Authenticate`. That predicate was then
>    **replayed verbatim in node** against this app's seven real `apply_auth`
>    shapes; the replay and the live listener agree.
> 3. The **CSP `connect-src` source-list matching algorithm** (CSP3 §6.6.2.7) was
>    implemented in node and every frontend `fetch()` target URL was run through the
>    app's actual `tauri.conf.json` policy. That is how the P0 in §7.A was found. No
>    amount of reading `src/` would have found it: the defect is a missing token in
>    a JSON string that no TypeScript file references.
> 4. The operator's live **`personas.db` (347 MB) was copied and opened read-only**
>    to resolve URL provenance from data rather than from code.
>
> **A convergence sweep** ran against `brainiac`, `personas-web`, `personas-cloud`,
> `vibeman` and `ascent` — 5 of 5 reachable, none silent. It is reported in §6
> including the two clauses it refuses to support and the one it inverted.
>
> **NEVER PRINT A SECRET.** No token, key, header value or connection string
> appears anywhere below. The live-listener probe used literal placeholder strings.
> Credential *locations and shapes* are reported; values are not, and none were read.
>
> ### Corrections to the brief, up front
>
> The brief asked seven questions. **Four of them this repo has already answered
> well, and saying so is part of the job** — a path that reports only defects would
> mis-set the reader's priors on where the risk actually is:
>
> - *"Is TLS verification ever disabled?"* — **No. Zero** `danger_accept_invalid_certs`,
>   **zero** `danger_accept_invalid_hostnames`, **zero** `reqwest::blocking`, **zero**
>   `.proxy(`, in 963 files. All five sibling repos are also at zero. **This control
>   needs no golden path; nobody in this fleet has ever reached for it.**
> - *"Is there a timeout on every call?"* — **40 of 44** client constructions carry
>   one. The four that don't are named in §7.C. This is the repo's strongest
>   position and it is stronger than every sibling's.
> - *"Is a non-2xx ever silently treated as success?"* — essentially **no**.
>   124 of 139 `.send().await` sites inspect the status within 1,200 characters; the
>   apparent 20 exceptions collapse to ~7 after hand-audit, because 5 of them route
>   through a `check_response` helper my first matcher could not see. Reported
>   honestly in §7.E rather than inflated.
> - *"Do credentials ride on redirects?"* — **partly, and the boundary is exact.**
>   62 credential attachments use a header name the client strips; **22 use one it
>   does not**. That is §9's gate, and it was found by executing, not by reading.
>
> And the brief's framing needs one correction of its own. It asks *"does the
> frontend make direct network calls at all?"* — it does, **6 sites in 4,829
> files** — but the important finding is not the count. **The frontend's only
> outbound-security control is a string inside `src-tauri/tauri.conf.json` that no
> file in `src/` references, imports, or tests.** It is simultaneously the reason
> the frontend has no SSRF hole *and* the reason a shipped feature has been dead
> for 69 days. That is the two-sided contract, and it is broken in both directions
> at once.
>
> ### Sibling boundaries, settled in prose
>
> [**secret-display-and-transfer**](./secret-display-and-transfer.md) owns *the
> credential at rest and on screen*. **This path owns the credential in flight to a
> host we do not control** — which header carries it, and what happens on hop two.
>
> [**credential-readiness-resolution**](./credential-readiness-resolution.md) owns
> *whether we have a usable credential*. This path owns *where we send it*.
>
> [**headless-model-call**](./headless-model-call.md) owns the **CLI-spawned** model
> call. Its subject spawns a process; this path's subject opens a socket. The
> `http_engine/` BYOM lane (`openai.rs`, `tools.rs`) is a real model call over
> reqwest and belongs to **this** path — that is the seam between them.
>
> [**spawning-a-cli-subprocess**](./spawning-a-cli-subprocess.md) and
> [**cancelling-in-flight-work**](./cancelling-in-flight-work.md) own child-process
> lifetime. A `reqwest` future has no child; its lifetime bound is `.timeout()`.
>
> [**filesystem-boundary**](./filesystem-boundary.md) owns path containment. This
> path owns the URL equivalent — and §6 records that the same author wrote both
> guards in the same function (`desktop_bridges.rs:800-826`).
>
> [**polling-loop**](./polling-loop.md) and
> [**scheduled-trigger-firing**](./scheduled-trigger-firing.md) own *when* a
> repeating call fires. This path owns *the call*.
>
> The **Deviations** section is a fix backlog.

---

## 0. The headline, before anything else

**This repo has a genuinely good outbound-HTTP chokepoint, and 32 of its 44 client
constructions route around it — because the chokepoint is a `LazyLock` you have to
know the name of, and `reqwest::Client::builder()` is always in scope.**

`personas_core` ships four doors:

| Door | `core/src/…` | Timeout | SSRF DNS resolver | Redirect policy | Uses / files |
|---|---|---|---|---|---:|
| `SSRF_SAFE_HTTP` | `http_clients.rs:27` | 30 s | **yes** | **custom: private target = error, cap 5 hops** | 8 / 6 |
| `build_ssrf_safe_client(d)` | `url_safety.rs:268` | **required param** | **yes** | **same** | 8 / 7 |
| `SHARED_HTTP` | `http_clients.rs:17` | 30 s | no | **none → reqwest default: follow 10** | 22 / 11 |
| `HTTP_ALLOW_PRIVATE` | `http_clients.rs:39` | 30 s | **no, by design** | none → follow 10 | 3 / 3 |

Against that, **33 `Client::builder()` chains in 28 files — 30 of them hand-rolled
outside `core`, in 26 files — and 2 bare
`reqwest::Client::new()`**. Counting every expression in the tree that brings a
`reqwest::Client` into existence — 33 builder chains + 2 `Client::new()` + 8
`build_ssrf_safe_client` call sites + the `SSRF_SAFE_HTTP` static = **44**:

- **40 of 44 bound the request in time.** The 4 that don't are §7.C.
- **13 of 44 install the SSRF resolver.** 31 use the system resolver.
- **13 of 44 state a redirect policy.** 31 inherit `Policy::limited(10)` and will
  follow ten hops to any host on earth.
- **0 of 44 disable TLS verification.**
- **0 of 963 files set `read_timeout`.** (The single grep hit,
  `webbuild/devserver.rs:201`, is a `TcpStream`, not HTTP.) `connect_timeout`: **1**
  (`live_roadmap.rs:262`).
- **2 of 144 response-body reads are bounded.** `api_proxy.rs:962` (2 MB) and
  `automation_runner.rs:568` (10 MB), both by looping `resp.chunk()`. The other
  **142** call `.text()` / `.json()` / `.bytes()`, each of which buffers whatever the
  remote host chooses to send, entirely, into the desktop app's memory.

**The security consequence, executed rather than argued.** Of the 149 places this
app attaches a credential to an outbound request, **62 use a header name reqwest
strips on a cross-host redirect and 22 use one it does not**:

```
STRIPPED   Authorization (×31) · bearer_auth/basic_auth (×31)
SURVIVES   x-api-key · X-N8N-API-KEY (×5) · apikey (×8) · PRIVATE-TOKEN
           Circle-Token · xi-api-key (×2) · x-goog-api-key · X-User-Token
           Neon-Connection-String (×2)   ← the Postgres password is IN the header
```

A live two-hop listener confirms it: hop 1 received all three test headers, hop 2
received two. The sharpest instance is `gitlab/client.rs:80` — a **user-supplied
self-hosted GitLab base URL**, on `SHARED_HTTP` (no SSRF resolver, ten-hop follow),
with the personal access token in `PRIVATE-TOKEN`. One `302` and the token is
somewhere else.

**And the frontend half has been failing silently since 2026-06-07.**
`crossrefClient.ts:90` fetches `https://api.crossref.org`. `connect-src` in
`src-tauri/tauri.conf.json` lists twelve sources and **`api.crossref.org` is not
one of them, and never has been in the entire git history.** The DOI lookup in
`AddSourceForm` — mounted in three live panels — cannot succeed, and tells the user
*"The Crossref lookup failed. Try again."* **69 days.** The sibling commit that
added `arxivClient.ts` (`dd844d6e7`, 2026-04-17) added `https://export.arxiv.org`
to the CSP **in the same commit**. The author of the first one knew. The author of
the second one did not, and nothing told them.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically
separated and each clause carries its warrant, so an adopting repo can tell physics
from local calibration. No file path, primitive name or count appears below this
line until the head ends.

> **P1 — physics, and it is the whole subject.** A request to a host you do not
> control is a request whose *reply* an adversary writes. Everything downstream —
> the status, the headers, the redirect target, the body and its length — is
> attacker-chosen input, not data. Every bound you do not state, the remote host
> gets to choose.
>
> **P2 — physics.** Network clients ship unbounded by default because a library
> cannot know your deadline. Therefore *the absence of a timeout is a decision*, and
> it is always the wrong one. Bound the call in **two** independent ways: a total
> deadline (so a slow exchange ends) and an idle/read bound (so a stalled one ends
> without capping a legitimately long transfer). A single total deadline forces you
> to choose between killing slow-but-honest transfers and tolerating a drip-feed.
>
> **P3 — physics, and the most under-appreciated clause here.** *A redirect is a
> second request to a host chosen by the first one.* Every check you performed on
> the URL — scheme, host, allowlist, private-IP — was performed on hop zero, and by
> default the client will make up to ten more without re-running any of them.
> Re-validate every hop or refuse to follow.
>
> **P4 — physics, corollary of P3, and the one that surprises people.** Clients
> strip a *fixed list* of credential header names across a host change. That list
> was written for the web's own auth schemes. A vendor-specific credential header —
> whatever the vendor happened to call it — is not on it and is forwarded verbatim.
> **Naming a credential is therefore a security decision, not a formatting one.**
>
> **P5 — physics.** A response body has no natural size, and the party choosing its
> size is the party you are defending against. Bound bytes *while reading*, not
> after: a length check that runs after the buffer is full has already happened
> too late to prevent the thing it checks for.
>
> **P6 — physics.** If the target URL is influenced by anything a user or a config
> supplies, "the internet" includes your loopback interface, your LAN, and your
> cloud provider's metadata endpoint. A hostname check is not sufficient — the name
> can resolve to a private address, and it can resolve *differently* between the
> check and the connection. The check must happen where the address is known, which
> is at connect time, not at parse time.
>
> **P7 — physics, and the strongest single clause in this document.** *A guard that
> is available is not a guard that is applied.* Where the safe client and the unsafe
> client are both one function call away, and choosing correctly requires knowing
> which is which, the unsafe one wins by default — not through carelessness but
> because it is the one the library's own documentation shows you. **Withhold the
> unguarded construction; do not document a preference for the guarded one.**
>
> **P8 — physics.** Retry only what a retry can fix, and only where a repeat is
> harmless. Transport failures, timeouts, `429` and `5xx` are retryable; the rest of
> `4xx` is a statement about your request that will be equally true next time.
> Retrying a non-idempotent method is a decision about *duplicating an effect on
> someone else's system* and must be made deliberately, per call, not inherited from
> a helper.
>
> **P9 — ergonomics, and it is the two-sided half.** When a *deployment
> configuration* — a content-security policy, an egress firewall, a proxy
> allowlist — decides which hosts your code may reach, that configuration is part of
> the code and must be changed with it. A host added in code and not in the policy
> produces a feature that compiles, type-checks, passes review and can never work;
> and it fails as a generic network error, which is indistinguishable from the
> remote host being down.
>
> **P10 — ergonomics.** A failure mode you did not name arrives as the failure mode
> you did. Timeout, DNS refusal, TLS failure, `401`, `429`, `5xx` and "blocked by
> policy" have six different remedies; collapsing them into one message hands the
> user a retry button for a problem retrying cannot fix.
>
> **Scale condition.** P1–P5 are correctness on the *first* call. P6 and P7 bite the
> moment a second construction site exists. P8 pays the first time a vendor has a
> bad afternoon. P9 pays at the first deploy. P10 pays at the first support ticket.

### Warrant evidence — the five siblings, censused independently

`brainiac` (Rust · 7 client constructions · 12 sends), `personas-web` (Next.js · 3
outbound fetch + 1 SDK), `personas-cloud` (TS orchestrator + Python facade · 6
sites), `vibeman` (Next.js + Tauri · 20 raw + 1 reqwest + 10 SDK), `ascent`
(Next.js · 25 sites). **No repo was silent; all five make outbound calls.**

- **P2 is the most replicated clause in the sweep: reinvented ~15 times across five
  repos, in three languages, with nobody importing anyone.** `brainiac` alone
  derives connect-plus-total timeouts **seven** separate times, and twice writes
  near-identical prose explaining why — `providers/mod.rs:28` *"reqwest applies NO
  default timeout, so a stalled-but-connected upstream … would hang the awaiting
  future forever"* and, in a **different crate**, `confluence.rs:43` — *"reqwest has NO
  default timeout, so a hung Confluence … would make `.send()` never return."* Two
  authors, one repo, no shared helper, same sentence. `ascent` derives it at 7
  sites, `vibeman` in 5 separate modules, `personas-web` once, `personas-cloud`'s
  Python facade once. **Physics.** The *shape* it converges on is the two-number
  form (connect + total): `brainiac` 5 of 6 clients, `personas-cloud`
  `httpx.Timeout(30.0, connect=5.0)`. **This repo has the total on 40 of 44 and the
  connect on 1** — so it has the convergent clause and only half its convergent
  shape.
- **P4 is convergent as an unguarded *defect* in every repo that has custom
  credential headers.** `brainiac`'s Anthropic provider sends `x-api-key` and sets no
  redirect policy; `vibeman`'s Tauri command sends `x-api-key` to a **caller-supplied
  `api_url`** with no timeout, no status check and ten-hop follow
  (`src-tauri/src/commands/ideas_cmds.rs:36-167`); `personas-web`'s two SSE routes
  attach `Authorization` **and** a custom `X-User-Token` before an unvalidated-host
  server-side fetch. **Five repos, zero mitigations, and this repo has 22
  instances.** Nobody has solved P4 anywhere. That is what makes it worth a gate
  rather than a paragraph.
- **P6 does converge — and the convergence is startlingly literal.** Two repos have
  an SSRF predicate: this one (`core/src/url_safety.rs:28`) and `ascent`
  (`src/lib/net/ssrf.ts:17`). Written in different languages, in different years,
  with no shared document, they cover the **same eight unusual ranges**: loopback,
  RFC1918, link-local `169.254.0.0/16` with `169.254.169.254` called out by name,
  **CGNAT `100.64.0.0/10`**, IPv6 ULA `fc00::/7`, IPv6 link-local `fe80::/10`,
  `metadata.google.internal`, and the `.internal` / `.local` suffixes. CGNAT is not
  an obvious range to think of. **Two independent authors thought of it.** Both also
  identified the *rebinding* gap and both closed it at exactly their highest-risk
  site — here a `reqwest::dns::Resolve` impl (`url_safety.rs:209`), there a
  `dns.lookup(host, {all:true})` re-check (`ascent/src/lib/net/logo-fetch.ts:36-37`)
  whose header comment names rebinding as out of scope for the string check. **P6 is
  physics.**
- **…but the *reason* both built it is not, and this inverts a clause I expected to
  assert.** `ascent`'s `ssrf.ts:1-6` records that it exists because **two hand-rolled
  copies had already drifted and left a webhook sink reachable**; this repo's
  `url_safety.rs:10-16` records the identical history — *"formerly duplicated with a
  weaker, redirect-unaware copy in `engine::ssrf_safe_dns`, which has been folded in
  here."* The other three repos have **no SSRF control of any kind** and have never
  had the bug. So: **SSRF defence is universally rediscovered by repos that get bitten
  and universally absent in repos that don't.** Do not prescribe it as hygiene. It is
  the correct answer *and* it is empirically only ever built retroactively — which
  is the argument for putting it in the primitive, where nobody has to rediscover it.
- **P7 is convergent, replicated 5 of 5, and no repo has ever won it.** Every single
  repo built a shared HTTP helper. **Not one got above 68% coverage.**

  | Repo | Chokepoint | Uses | Bypasses | Coverage |
  |---|---|---:|---:|---:|
  | `ascent` | `fetchWithTimeout`/`ghFetch` + `githubAppFetch` | 17 | 8 | **68%** |
  | `brainiac` | `build_http_client()` + `Resilience::send()` | 6 | 6 | **50%** |
  | **Personas** | 4 shared doors | 12 | 32 | **27%** |
  | `vibeman` | `BaseLLMClient.makeRequest` | 12 | 22 | **35%** |
  | `personas-cloud` | (TS: none) | 0 | 3 | **0%** |

  `brainiac`'s number is the load-bearing one and it is a **cost measurement, not an
  agreement**: it reached **7 of 7** timeout coverage with no type enforcement at
  all — pure convention plus a `pub(crate)` shared constructor — and **the
  convention did not survive the crate boundary.** `brainiac-publish` and
  `brainiac-server` cannot reach `build_http_client()` because it is `pub(crate)`,
  so each re-derived the timeouts by hand. **A convention that works perfectly
  inside its module fails at the first boundary it cannot cross.** That is the
  single best argument in this document for the type answer, and it comes from a
  sibling's success, not its failure.
- **P8 converges to a specific *set*, independently, in three repos.** `ascent`
  retries `{403, 429, 500, 502, 503, 504}` (`src/lib/auth.ts:519`); `vibeman` retries
  `{408, 429, 500, 502, 503, 504}` (`src/lib/llm/base-client.ts:205`) — **five of six
  values identical**, arrived at with no contact, and **both wrote a comment
  justifying why the rest of 4xx is excluded.** This repo's set is
  `{timeout, connect-failure, 5xx, 401}` (`automation_runner.rs:350-359`). **`429` is
  not in it** — so a rate-limited webhook is the one transient failure this repo
  declines to retry, and it is the one both siblings singled out. All three retry
  **POST** without a word about idempotency. Physics for the shape, a named gap for
  the contents.
- **P9 is convergent and it is the highest-value transfer in the whole oracle.**
  Three repos, one control, three outcomes. `brainiac`'s console **derives** its CSP
  allowance from the same env var the client is configured from —
  `new URL(dsn).origin` folded into the directive array
  (`console/src/security/csp.ts:63-73`), plus a `CSP_REPORT_ONLY` escape hatch at
  `:187` justified in prose. `personas-web` **hardcodes** its `connect-src` while
  `src/lib/api.ts:48` reads `NEXT_PUBLIC_ORCHESTRATOR_URL`; the two are never
  reconciled and **26 browser call sites are blocked in the default live
  configuration** — and its own `docs/supabase-auth-setup.md:17` records that this
  exact break already happened once, for Supabase, and was patched by adding the
  host. **Personas has the identical bug at one site (Crossref) and got it right at
  another (arXiv) in the very commit that introduced the client.** One sibling solved
  it, one has it at scale, one has it at retail. **P9 is physics and the fix is
  already written down in a repo 200 metres away.**
- **P5 does NOT converge, and this repo is the only one that solved it.** Outbound
  response-body bounds: `brainiac` 0, `personas-web` 0, `personas-cloud` 0,
  `vibeman` 0, `ascent` 1 of 25. **Personas 2 of 144** — and its two are the only
  *streaming* ones in the fleet, capping bytes as they arrive rather than after.
  `personas-web` makes the asymmetry legible: it owns a complete bounded reader with
  a `content-length` fast path **and** a chunked-encoding streaming fallback
  (`src/lib/server/request.ts:102-115`), applied at four **inbound** routes with
  4–10 KiB caps, and never once pointed at an outbound response. The oracle's own
  phrasing is the finding: *"the mental model is 'bound what strangers send me,' and
  an upstream is not modelled as a stranger."* **P5 is a real, five-repo blind
  spot** — which means an adopting repo should treat it as a proposal with strong
  reasoning and weak external warrant, and should copy `api_proxy.rs:957-968` rather
  than invent.
- **P3 barely converges: explicit redirect policies are 13/44 here, 1/25 in
  `ascent`, 0 in `brainiac`, 0 in `vibeman`, 0 in `personas-cloud`** (whose Python
  half gets it free — `httpx` defaults to *not* following, which is the only
  safe-by-default client in the fleet and is safe by accident). **Personas leads this
  dimension by a wide margin and is still at 30%.**
- **A convergent *defect* worth more than any agreement.** This repo's
  `url_safety.rs:264-267` states the rule in bold prose: *"Client construction
  failure is fail-closed: it panics rather than silently falling back to a stock
  `reqwest::Client` with the system DNS resolver and no redirect protection, which
  would be a silent, total loss of SSRF protection for every caller."* And
  `triggers.rs:447-453` builds the SSRF-safe client with `.unwrap_or_default()` —
  which returns exactly that stock client. **The doctrine and its violation are in
  the same repository.** `brainiac` does the same thing three times
  (`unwrap_or_else(|_| reqwest::Client::new())` at `providers/mod.rs:49`,
  `lighttrack.rs:67`, `analytics.rs:98`) directly beneath its own comment warning
  about the no-timeout default. **Two codebases, no contact, same fail-open
  fallback, both immediately below their own written warning.** If a mechanism can be
  defeated by an `unwrap_or_default()`, it will be.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "call the vendor's API" · "hit their REST endpoint" · "fetch the catalog / the
  release feed / the update manifest"
- "deliver the webhook" · "POST to the user's URL" · "let the user paste a link and
  we'll fetch it"
- "exchange the OAuth code" · "refresh the token"
- "download the model / the binary / the icon"
- "probe whether their instance is up"
- "just `fetch()` it from the component, it's simpler than a Tauri command"
- **If you are about to write `reqwest::Client::builder()`, `reqwest::Client::new()`,
  `.send().await`, or `fetch(` — you are in this situation.**
- If you are about to add a caller to `SSRF_SAFE_HTTP`, `SHARED_HTTP`,
  `HTTP_ALLOW_PRIVATE` or `build_ssrf_safe_client`, you are in this situation and
  most of it is already handled.
- If you are about to add a **new hostname** to any string that becomes a URL from
  the frontend, you are in this situation *and you must also edit
  `src-tauri/tauri.conf.json`* — see §2 and §7.A.

**Not this path:** spawning the Claude CLI is
[headless-model-call](./headless-model-call.md); reading a local file is
[filesystem-boundary](./filesystem-boundary.md); the *inbound* management-API and
webhook-receiver surfaces are [ipc-command-authorization](./ipc-command-authorization.md)'s
and [command-input-validation](./command-input-validation.md)'s; `convertFileSrc()`
+ `fetch(asset:…)` is a local asset read, not an outbound call.

---

## 2. The one way

**Take a client from `personas_core::http_clients` — never construct one — and pick
it by asking one question: can anything a user or a config supplies influence the
host?** If yes, that is `SSRF_SAFE_HTTP` (or `build_ssrf_safe_client(timeout)` when
you need a different deadline), which gives you the private-IP-rejecting DNS
resolver at *connect* time, closing the rebinding window a string check cannot, plus
a redirect policy that re-validates every hop and stops at five. If the connector's
own metadata declares `allow_private_network` — three of 134 do — that is the *only*
legitimate reason to reach for `HTTP_ALLOW_PRIVATE`, and the gate on it belongs in
`api_proxy`, not at your call site. If the host is a compile-time literal you wrote
yourself, `SHARED_HTTP` is correct, and you should say so in a comment the way
`desktop_bridges.rs:800-809` does, because the next reader cannot tell a deliberate
choice from an unconsidered one. **Then attach the credential under `Authorization`
if the vendor allows it at all** — that is the one name the client knows to strip
across a host change — and **if the vendor demands its own header name, disable
redirects on that request's client** (`.redirect(reqwest::redirect::Policy::none())`,
exactly as `share_link.rs:259` and `triggers.rs:447` already do), because otherwise
the credential is one attacker-authored `302` away from a host you never validated.
**Bound the reply in bytes as well as in time**: loop `resp.chunk()` with a running
total and stop at a cap, the way `api_proxy.rs:957-968` does — `.text()` and
`.json()` hand the remote host a blank cheque against your heap, and a length check
after `await resp.text()` runs after the damage. **Read the status before the body,
always, and turn it into a typed distinction** — `401` means re-auth, `429` means
back off, `5xx` means retry, the rest of `4xx` means the request was wrong — because
a message that says only "failed" hands the user a retry button for a problem
retrying cannot fix. **Retry only transport failures, timeouts, `429` and `5xx`,
bounded with exponential backoff, and decide explicitly whether repeating this
method is safe on someone else's system.** And if the call is being made from the
frontend, **stop, and go through Rust instead** — there are six `fetch()` sites in
4,829 files and half of them are wrong; if you genuinely must, the host has to be
added to `connect-src` in `src-tauri/tauri.conf.json` **in the same commit**, or the
feature ships dead.

---

## 3. Mandated primitives

**Exist today — use them:**

- **`core/src/http_clients.rs:27` — `SSRF_SAFE_HTTP`** — the default answer. One
  process-wide `LazyLock<reqwest::Client>`; `reqwest::Client` is `Arc`-backed so
  cloning shares one connection pool, TLS session cache and DNS cache. 30 s total
  timeout, SSRF resolver, hop-revalidating redirect policy. **8 uses in 6 files.**
- **`core/src/url_safety.rs:268` — `build_ssrf_safe_client(timeout: Duration)`** —
  the same client with a deadline you choose. **`timeout` is a required positional
  parameter**: you cannot construct this client without naming one. **8 production
  call sites in 7 files.** Its doc comment at `:252-267` is the best explanation of
  the redirect hazard anywhere in the tree and should be read before §7 is fixed.
- **`core/src/url_safety.rs:209` — `impl reqwest::dns::Resolve for SsrfSafeDnsResolver`** —
  the mechanism. It rejects a hostname if **any** resolved address is private, at
  connect time, which is the only place the address is knowable. This is what makes
  a hostname check non-bypassable by DNS rebinding (CWE-367).
- **`core/src/url_safety.rs:28` — `is_private_ip(IpAddr)`** — the single strongest
  predicate in the engine: loopback, RFC1918, link-local, unspecified, broadcast,
  CGNAT `100.64/10`, the three TEST-NETs, `169.254.169.254` by name, IPv6 loopback /
  ULA / link-local, and **v4-mapped-v6 recursion**. Other modules delegate here
  precisely so the historical divergent copies cannot reopen a bypass. Independently
  reinvented, range for range, in `ascent`.
- **`core/src/url_safety.rs:115` — `validate_url_safety(&str)`** — the *parse-time*
  half: an http/https-only scheme check, a blocked-hostname list, an IP-literal
  check, and a **fail-closed** DNS resolution (a lookup failure blocks). **8
  production call sites in 7 files.** It is TOCTOU-vulnerable on its own and says so;
  pair it with the resolver, never substitute it.
- **`core/src/url_safety.rs:185` — `is_url_target_private(&url::Url)`** — the
  no-DNS, synchronous variant, existing specifically so a
  `redirect::Policy::custom` callback can re-check a hop whose `Location` carries a
  raw IP literal and therefore skips DNS entirely.
- **`src/engine/api_proxy.rs:657` — `execute_api_request`** — **the reference
  implementation, and the one site to copy.** See §6.
- **`src/engine/automation_runner.rs:76-107`** — the only retry loop in the HTTP
  surface: bounded by `retry_count.clamp(1,5)`, exponential backoff capped at 30 s,
  a typed retryable predicate, and an auth re-resolve on `401` before the next
  attempt. Copy the shape; fix the set (§7.G).
- **`src/engine/api_proxy.rs:957-968` · `src/engine/automation_runner.rs:565-575`** —
  the only two bounded body reads in the tree. `resp.chunk()` in a loop with a
  running total. **Two lines of structure that make the remote host's size choice
  irrelevant.**
- **`src/engine/share_link.rs:254-262` · `src/commands/tools/triggers.rs:444-455`** —
  the two `redirect::Policy::none()` precedents, each with a comment naming the exact
  hazard. `share_link.rs`: *"a malicious LAN host that passes `is_safe_share_host`
  could otherwise 302 the request to an arbitrary internal/external target that was
  never itself validated (the redirect hop bypasses the host check above)."*
- **`src-tauri/tauri.conf.json` → `app.security.csp` / `devCsp`** — the frontend's
  entire outbound policy. **Treat it as source.** Twelve `connect-src` sources in
  production, sixteen in dev. Note `tauri.lite.conf.json` and
  `tauri.stable.conf.json` carry no `app.security` block and therefore inherit it;
  `tauri.android.conf.json` overrides it with a **different, narrower** list.

**Do not exist — this path names them:**

- **A client factory that takes a deadline and a trust level and returns the right
  client.** There is a factory for one of the four doors and constants for the other
  three, so "I need a 300 s timeout" forces a hand-rolled builder and silently drops
  the resolver and the redirect policy with it. This is upstream of most of §7.
- **Any check that a host reachable from `src/` is in `connect-src`.** §9 specifies
  it; it is ~30 lines and would have caught the P0.
- **Any type that distinguishes "a URL we authored" from "a URL someone gave us."**
  Both are `String`. See "Prefer a type over a gate".
- **A read/idle timeout anywhere.** `reqwest::ClientBuilder::read_timeout` exists,
  resets on each successful read, and is the correct instrument for a streaming
  download. Zero uses.
- **Any integrity check on a downloaded binary or model.** Zero `sha256`/checksum
  verification adjacent to any of the seven `bytes_stream()` sites.

---

## 4. Steps

1. **Ask where the host comes from, and write the answer down.** A literal you
   typed; a user-entered credential field; a connector's `base_url`; a redirect
   `Location`; a value from the database. The first is safe, the rest are not, and
   nothing in the type system will remind you which one you have. If it is not the
   first, the answer to step 2 is `SSRF_SAFE_HTTP`.
2. **Take the client; do not build one.** `personas_core::http_clients::SSRF_SAFE_HTTP`
   for anything user-influenced, `SHARED_HTTP` for a literal host you wrote, and if
   you believe you need a different timeout use
   `url_safety::build_ssrf_safe_client(d)` — **which is the only door that lets you
   choose a deadline without also silently opting out of the resolver and the
   redirect policy.** If you find yourself typing `Client::builder()`, read §7.B
   first: 32 sites believed they needed to, and 31 of them dropped a guarantee.
3. **Never `.unwrap_or_default()` a client build.** `Client::default()` is
   `Client::new()`: no timeout, system DNS, ten-hop follow. Fail closed —
   `.expect(...)` — the way `http_clients.rs:21` and `url_safety.rs:283` do, and the
   way `triggers.rs:453` does not.
4. **Name the credential's header.** If the vendor accepts `Authorization`, use
   `bearer_auth` / `basic_auth` and you are done: it is stripped across a host
   change. **If the vendor demands its own header name, you have just made the
   credential redirect-portable, and you must disable redirects on that client.**
   This is the step 22 call sites skip.
5. **Ask the type-over-gate question now**, before §9. The answer for this leaf is
   below, and the obvious candidate is not it.
6. **Bound the reply in bytes.** `while let Some(chunk) = resp.chunk().await?` with a
   running total and a `truncated` flag. `.text()` / `.json()` are acceptable only
   when you are willing to state that the remote host may choose your allocation
   size. A `if text.len() > MAX` after `await resp.text()` is not a bound; the bytes
   are already resident.
7. **Read the status before the body, and discriminate.** `401` → re-auth; `429` →
   back off (and read `Retry-After`); `5xx` → retry; other `4xx` → the request was
   wrong. Do not recover the status by substring-matching a formatted message the way
   `automation_runner.rs:353-357` must, because the layer above it threw the number
   away — see [typed-error-contract](./typed-error-contract.md).
8. **Retry only the transient set, bounded, with backoff — and say whether the
   method is safe to repeat.** One sentence in a comment. Both convergent siblings
   retry POST silently and so does this repo.
9. **If any part of this runs in the webview, add the host to
   `connect-src` in `src-tauri/tauri.conf.json` in the same commit**, in **both**
   `csp` and `devCsp` (they are separate strings and they already disagree), and
   check whether `tauri.android.conf.json` needs it too. Then reconsider whether the
   call belongs in the webview at all — see §7.A.
10. **And then stop.** Connection pooling, TLS, DNS caching, the redirect walk and
    the sensitive-header strip are the client's job. Do not re-derive them; 31
    constructions did and 31 lost something.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`reqwest::Client::builder()` at a call site** | You get the deadline you asked for and silently decline the SSRF resolver and the redirect policy, because those are opt-in and the timeout is the only one you were thinking about. **31 of 33 builder chains have exactly this shape.** |
| **`reqwest::Client::new()`** | Every default at once: **no timeout**, system DNS, ten-hop follow. There is no case in this app where it is right. `mcp_server/tools.rs:684`, `:1477`. |
| **`.build().unwrap_or_default()`** | Fails **open** into the stock client — the precise outcome `url_safety.rs:264-267` says it panics to avoid. `triggers.rs:447`. `brainiac` does it three times. |
| **A credential under a vendor-specific header name, on a redirect-following client** | Cross-host `302` and the credential goes with it; the client strips only `Authorization`/`Cookie`/`Proxy-Authorization`/`WWW-Authenticate`. **22 sites.** Verified with a live two-hop listener. |
| **A whole connection string in a header** | `db_query.rs:1428`, `:1471` put the Postgres connection string — password included — in `Neon-Connection-String`, and derive the destination host *from that same string*. |
| **Validating the URL and then handing it to a client with the system resolver** | The name you checked and the address you connect to are resolved twice; between them an attacker's DNS can change the answer. The repo names this (CWE-367) at `mcp_tools.rs:1409` and fixes it there; `polling.rs:264` is safe only because its caller happens to pass an SSRF-safe client built 200 lines away in another file. |
| **`await resp.text()` then `if len > MAX`** | The cap runs after the buffer is full. `useUrlImport.ts:51-58` (5 MB), `ascent`'s `exposure.ts:44-45` (6 MB). The check reports the problem it was supposed to prevent. |
| **`.json::<T>()` on an error response** | A `500` HTML page fails to deserialize into `T`, so the user is told the response was malformed rather than that they are unauthorised. `drive.rs:224`, `:248`, `:400`, `:420`, `:650` — five Google Drive calls, none of which reads the status. |
| **A total timeout as the only bound on a streaming download** | 20 minutes at any rate is 20 minutes of bytes. `read_timeout` — which resets per successful read and therefore detects a *stall* without capping an honest slow transfer — is used **zero** times. |
| **Downloading an executable or a model with no integrity check** | Seven `bytes_stream()` sites, zero checksums. `stt/downloader.rs:143` writes a `.partial`, renames it, and loads it. |
| **A `fetch()` in a React component to a new host** | Compiles, type-checks, reviews clean, and is refused by the webview at runtime as a generic network error. **69 days for `api.crossref.org`.** |
| **Telling the user "failed, try again"** | `AddSourceForm.tsx:46` says exactly this for a condition that no number of retries can change. |

---

## 6. Evidence

### The one site to copy: `src/engine/api_proxy.rs:657` — `execute_api_request`

It is the only place in 963 files where **every** obligation in §2 is discharged in
one function, and it is the only outbound response in the fleet of five repos that
is bounded while it is read:

- **Trust decision is data-driven, not per-call judgement.** `allow_private` comes
  from the connector definition's metadata (`:711`); the SSRF checks and the client
  choice both branch on it (`:717-724`, `:835-838`) — so "may this connector reach
  localhost?" is answered once, in the catalog, for all call sites. **Live: 3 of 134
  connector definitions declare it — `langfuse`, `langsmith`, `tracklight`, all
  inherently self-hosted.** A scoped relaxation that stayed scoped.
- **Request body capped before the send** (`:819-826`, 10 MB) and **header names
  validated** (`:816`).
- **Response body streamed with a running cap and a `truncated` flag**
  (`:957-968`, 2 MB): *"Read in chunks so we never buffer more than the limit, even
  if the upstream sends a multi-gigabyte response."*
- **`.without_url()` on both send errors** (`:884`, `:922`) — *"dynamic base URLs
  can embed a secret in the path (e.g. `https://api.telegram.org/bot{token}`), and
  `reqwest::Error`'s `Display` would leak it."* This is a secret-hygiene control
  that exists nowhere else in the fleet, and it is exactly right.
- **One conditional retry, on `401`, for OAuth only** (`:917`), with a forced token
  exchange and an explicit lock hand-off to avoid re-entrant deadlock (`:900-903`).
  Bounded by construction: it is an `if`, not a loop.
- Plus a per-credential token-bucket rate limit (`:773`) and runtime scope
  enforcement (`:735-771`).

The one thing it does not do is step 4: `strategy.apply_auth` (`:868`) may attach
`Circle-Token` or `x-api-key`, and `SSRF_SAFE_HTTP` follows public redirects for
five hops. §7.D.

### The client census, exactly

Every expression in `src-tauri` that produces a `reqwest::Client`, `#[cfg(test)]`
excluded by brace-matched range:

| | n | timeout | ssrf resolver | redirect policy | user-agent |
|---|---:|---:|---:|---:|---:|
| `Client::builder()` chains | **33** | 31 | 4 | 4 | 4 |
| `reqwest::Client::new()` | **2** | 0 | 0 | 0 | 0 |
| `build_ssrf_safe_client(d)` call sites | **8** | 8 | 8 | 8 | 8 |
| `SSRF_SAFE_HTTP` static | **1** | 1 | 1 | 1 | 1 |
| **total** | **44** | **40** | **13** | **13** | **13** |

Three of the 33 builder chains live in `core` and *are* the shared doors
(`http_clients.rs:18`, `:40`, `url_safety.rs:269`). **The other 30, plus the 2
`Client::new()`, are 32 call-site constructions across 26 files** — the P7 number.

### Where the credential rides — executed twice, two mechanisms, same answer

reqwest 0.12.28 `src/redirect.rs:239-251`, read from the registry and replayed
verbatim in node, against this app's seven real `ConnectorStrategy::apply_auth`
shapes:

| `apply_auth` | `connector_strategy.rs` | header | cross-host `302` |
|---|---|---|---|
| `bearer_auth(tok)` (the default, all connectors) | `:78` | `Authorization` | **stripped** |
| ClickUp raw `Authorization` | `:688` | `Authorization` | **stripped** |
| Atlassian Basic | `:779` | `Authorization` | **stripped** |
| Langfuse Basic | `:820` | `Authorization` | **stripped** |
| CircleCI | `:676` | `Circle-Token` | **SURVIVES** |
| LangSmith | `:839` | `x-api-key` | **SURVIVES** |
| Buffer | `:660` | *(URL query param)* | n/a — but it is in the vendor's access log, and in `reqwest::Error`'s `Display` unless `.without_url()` is used |

Controls, from the same replay: `https://host/x` → `http://host/x` is **stripped**
(443 ≠ 80, so a scheme downgrade counts as cross-host — correct); same host, same
scheme, different path **survives** (correct, and it is what makes the strip usable
at all).

The live listener agrees: with hop 1 on one loopback port `302`-ing to hop 2 on
another, hop 1 saw `authorization`, `x-api-key`, `circle-token`; **hop 2 saw
`x-api-key` and `circle-token`.** Two of three.

Whole-tree partition of the anchor population, both implementations agreeing
exactly:

```
149  credential-capable attachments
 ├─  62  compliant  — bearer_auth/basic_auth (31) + .header("Authorization"…) (31)
 ├─  22  violating  — a credential under a name the client does not strip   ← §9
 └─  65  neither    — Content-Type, Accept, User-Agent, Notion-Version, …
```

### The vocabulary disagreement — two implementations, and the one that was wrong

My first scanner found **20**; the census pattern found **22**. Both were run over
the same 963 files with the same comment handling. The gap is
`Neon-Connection-String` ×2: the first scanner's credential-noun vocabulary was
`api.key|token|auth|secret|private|circle|admin.key|x-user`, and a *connection
string* contains none of those words. **A 9% undercount produced entirely by the
list of nouns I thought of**, on the two matches that carry the most sensitive value
in the set — a database password. Recorded because the lesson generalises: when a
signal is a vocabulary rather than a shape, its recall is bounded by the author's
imagination, and the misses cluster on the unusual cases, which are the interesting
ones. Two implementations agreeing is not soundness; here they disagreed and the
disagreement was the finding.

### URL provenance, from live data

`personas.db` copied read-only, 241 tables, queried without opening the live file:

- **`connector_definitions`: 134 rows, 134 with metadata, 3 with
  `allow_private_network: true`.** The `HTTP_ALLOW_PRIVATE` blast radius is
  2.2% of the catalog and every one of them is a self-hosted-by-nature tool.
- **`persona_credentials`: 25 rows across 23 service types.** Every field is inside
  `encrypted_data`/`iv` — the `base_url` a connector talks to genuinely is a
  decrypted-at-runtime user value, which is exactly why the SSRF question is live
  rather than theoretical. **No plaintext secret was found anywhere; none was read.**
- **Stored outbound URLs across every url-shaped column: 15, four distinct hosts**
  (`github.com` ×10, `smee.io` ×2, `cdn.simpleicons.org` ×2,
  `news.ycombinator.com` ×1). **Zero private/loopback, zero plain-`http`.**
- **`persona_triggers`: 351 rows — 189 event_listener, 68 manual, 55 chain, 32
  schedule, 7 polling.** All **7** polling triggers have `config = {cron, timezone}`
  and **no `url` key at all**; one is enabled. So `polling.rs:252`'s
  `"Polling trigger missing 'url' in config"` warn branch fires on 100% of this
  installation's polling triggers, and `validate_url_safety` at `:264` — the SSRF
  guard on the only *user-typed* URL the scheduler will ever fetch — **has never
  executed here.** The guard is correct and untested by use.

  That is downstream of a type: `TriggerConfig::Polling { url: Option<String>, … }`
  (`core/src/models/trigger.rs:291-298`) makes "a polling trigger that polls
  nothing" representable, and 7 of 7 live rows are exactly that.

### The frontend half, in full

**Six `fetch(` call sites in 4,829 files.** (The other 43 grep hits are the word
"fetch" in comments, `refetch()` identifiers, `useLanguagePrefetch`, and one code
sample rendered as a string at `ApiPlayground.tsx:41`.)

| Site | Target | Timeout | Reachable under prod CSP? |
|---|---|---|---|
| `arxivClient.ts:80` | `export.arxiv.org` | `AbortController` + 15 s, merged with the caller's signal | **yes** — added in the same commit |
| `crossrefClient.ts:90` | `api.crossref.org` | same shape, 15 s | **NO** — §7.A |
| `useUrlImport.ts:46` | **any URL the user types** | `AbortSignal.timeout(15_000)` | only `github.com`, `raw.githubusercontent.com`, `gist.githubusercontent.com` |
| `managementApiAuth.ts:43` | `http://127.0.0.1:9420` | none | **NO** — and it has **zero callers** |
| `streamHarness.ts:65` | `stream-test.localhost` | none | dev only (in `devCsp`, not `csp`) — correct |
| `useAudioWaveform.ts:43` | `convertFileSrc(path)` → `asset:` | none | yes — a local asset read, not outbound |

**Zero of the six consults any allowlist, private-IP check, or scheme check written
in TypeScript.** A grep of `src/` for `allowlist|allowedHost|169.254|connect-src`
returns matches about connector scopes, SQL tables and skill installers — nothing
about network egress. The control exists and it is a JSON string in another
directory.

**And that control is doing real work**, which is the part that would be easy to
miss: `useUrlImport` accepts `^https?://.+` (`n8nUploadTypes.ts:54`) and then
rewrites GitHub blob/gist URLs to their raw hosts (`:41-52`). Those three raw hosts
are in `connect-src`. **Everything else — including `http://127.0.0.1:9420/api/proxy/1`,
`http://169.254.169.254/latest/meta-data/` and `http://192.168.1.1/admin` — is
refused by the webview.** Replayed through a node implementation of CSP3 §6.6.2.7
against the real policy; the matcher's instrument check (arXiv must ALLOW, Crossref
must BLOCK) passes, so it is discriminating rather than uniformly refusing.

So the frontend has no SSRF hole **and nobody decided that.** It is a property of a
deploy config that the code cannot see, cannot test, and — as §7.A shows — cannot
stay in sync with.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Nearly every defect below
> reduces to one omission: **there is no factory that takes a deadline.** The four
> shared doors are three fixed-30-second constants and one helper. The moment a
> caller needs 5 s (a health probe), 300 s (a local LLM), 20 min (a model download)
> or none (an SSE long-poll), the shared surface has no answer, so they type
> `Client::builder().timeout(X)` — and in doing so silently decline the DNS
> resolver and the redirect policy that had nothing to do with the deadline they
> came for. **Thirty-one of the 33 builder chains are a timeout choice that dragged
> two security decisions along with it.** Give `http_clients` a
> `client(ClientProfile)` factory and most of this list becomes unrepresentable
> rather than fixed.

### 7.A — P0: a shipped feature has been blocked by the app's own CSP for 69 days

| Path | What's wrong |
|---|---|
| `src/features/plugins/research-lab/sub_literature/crossrefClient.ts:90` | `fetch('https://api.crossref.org/works/…')` from the webview. |
| `src-tauri/tauri.conf.json` → `app.security.csp` | `connect-src` lists 12 sources. `api.crossref.org` is not among them. Nor is it in `devCsp` (16 sources). Nor in `tauri.android.conf.json`. |
| `src/features/plugins/research-lab/sub_literature/AddSourceForm.tsx:58` | The only caller — mounted from `LiteratureSearchPanel.tsx:221`, `…Atelier.tsx:168` and `…Workbench.tsx:228`. Three live surfaces. |
| `AddSourceForm.tsx:46` | The CSP refusal surfaces as `TypeError: Failed to fetch` → `CrossrefLookupError('network')` → **"The Crossref lookup failed. Try again."** |

**Archaeology.** `crossrefClient.ts` was added 2026-06-07 in `a75f9d919`. `git log
-S"crossref" -- src-tauri/tauri.conf.json` returns **nothing, ever**. The sibling
client, `arxivClient.ts`, was added 2026-04-17 in `dd844d6e7` — **the same commit
that added `https://export.arxiv.org` to `connect-src`.** The knowledge existed in
this repo, in this feature folder, seven weeks earlier, and did not transfer.

**Dead for 69 days.** Nothing catches it: there is no test that renders
`AddSourceForm` against the real policy, the CSP is not parsed by any script, and
`npm run check` has no opinion about `tauri.conf.json`.

**Fix:** add `https://api.crossref.org` to `connect-src` in both `csp` and `devCsp`
(and decide about Android). **Better fix:** move the lookup behind a Tauri command
so the frontend stops making cross-origin calls at all — Crossref rate-limits
anonymous clients and the Rust side already has `SSRF_SAFE_HTTP`, retry and
bounded-body machinery the webview cannot reach.

*(This is `personas-web`'s bug, at retail instead of wholesale — there,
`NEXT_PUBLIC_ORCHESTRATOR_URL` is absent from `connect-src` and **26** browser call
sites are blocked in the default configuration. And `brainiac`'s console has
already built the general fix: derive the CSP allowance from the same value the
client reads, `console/src/security/csp.ts:63-73`.)*

### 7.B — P0: 32 client constructions bypass the shared doors, and 31 of them lose a guarantee

**32 call-site constructions in 27 files** (30 `Client::builder()` chains outside
`core`, plus 2 `Client::new()`), against **12 uses of the safe doors**. Grouped by
what each dropped:

| Dropped | n | Sites |
|---|---:|---|
| SSRF resolver **and** redirect policy | **28** | `desktop_bridges.rs:828` · `gallery.rs:47` · `persona_icon_gen.rs:181` · `mcp_tools.rs:41` · `cloud.rs:385`, `:454` · `setup.rs:266`, `:324` · `live_roadmap.rs:261` · `radio.rs:223` · `connector_use.rs:160` · `stt/downloader.rs:125` · `stt/installer.rs:110` · `kokoro_installer.rs:96` · `tts/pocket.rs:254`, `:444` · `pocket_installer.rs:91` · `discord_poller.rs:384`, `:481` · `http_engine/openai.rs:92` · `http_engine/tools.rs:38` · `platforms/github.rs:72` · `platforms/zapier.rs:12` · `slack_poller.rs:912` · `mcp_server/tools.rs:183` · `drive.rs:195` · `mcp_server/tools.rs:684`, `:1477` |
| SSRF resolver only (has a redirect policy) | 1 | `share_link.rs:259` |
| redirect policy only (has the resolver) | 1 | `smee_relay.rs:272` |
| nothing — fully guarded | 2 | `twin.rs:1751` · `triggers.rs:447` (but see 7.C) |

**Most of the 28 talk to a compile-time literal host and are, today, correct
content.** That is precisely why this is a Gap and a refactor rather than §9's gate:
a rule that fired on all 28 would fire on `github.rs` sending a token to
`api.github.com`, and **a gate that fires on correct content is worse than no gate**
(§9 declines it with numbers). The ones that are *not* correct content are 7.D.

**One is a documented, correct exception and is the model for the rest.**
`desktop_bridges.rs:800-809`: *"Deliberately NOT routed through
`build_ssrf_safe_client`. `base_url` below is a literal `https://127.0.0.1:{port}` …
An SSRF-safe client's private-IP-blocking DNS resolver would reject this very
loopback target and break every Obsidian bridge call, for no additional protection
since the host can't be redirected off-loopback by anything this function accepts as
input."* Nine lines that make a bypass auditable. **It is the only one of 32.**

### 7.C — P1: four clients have no time bound at all, and one long-poll is right

| Path | Why it matters |
|---|---|
| `src/mcp_server/tools.rs:684` `scrape_bridge` | `reqwest::Client::new()` inside `rt.block_on` on a **current-thread runtime**, from an MCP tool handler. A hung bridge blocks that tool forever, with no cancel. |
| `src/mcp_server/tools.rs:1477` `bridge_proxy` | Same shape. This one forwards an agent's connector request. |
| `src/commands/obsidian_brain/drive.rs:195` `drive_client` | `Client::builder().default_headers(headers).build()` — **no `.timeout()`**. Serves all **10** Google Drive calls in the file, each carrying the OAuth bearer token. A stalled Google connection hangs the sync with no deadline. |
| `src/engine/smee_relay.rs:272` | **Correct.** An SSE long-poll must not carry a total deadline; a total timeout would kill a healthy stream on schedule. **The right fix here is `read_timeout`, which the repo uses zero times** — it would end a *stalled* relay without capping a healthy one. |

### 7.D — P1: 22 credentials are attached under a header the client will forward across hosts

Full list, all 22 hand-opened, every one on a client that follows redirects:

| Path | Header | Client | Host provenance |
|---|---|---|---|
| `gitlab/client.rs:80` | `PRIVATE-TOKEN` | `SHARED_HTTP` (follow 10, system DNS) | **user-supplied self-hosted GitLab `base_url`** |
| `platforms/n8n.rs:141,171,199,243,278` | `X-N8N-API-KEY` | `SHARED_HTTP` | **user-supplied `base_url`**; scheme-checked at `:103-109`, **no private-IP check** |
| `engine/db_query.rs:1428,1471` | `Neon-Connection-String` | `SSRF_SAFE_HTTP` (follow 5, public only) | host is `extract_pg_host(connection_string)` — **derived from the credential itself** |
| `engine/db_query.rs:1021,1107` | `apikey` | `SSRF_SAFE_HTTP` | Supabase project URL from the credential |
| `connector_strategy.rs:676` | `Circle-Token` | api_proxy's client | credential `base_url` |
| `connector_strategy.rs:839` | `x-api-key` | api_proxy's client | credential `base_url` |
| `cloud/sync/client.rs:73,99,125,150` | `apikey` | `SHARED_HTTP` | cloud endpoint |
| `commands/infrastructure/auth.rs:298,326` | `apikey` | `SHARED_HTTP` | cloud endpoint |
| `cloud/client.rs:416` | `X-User-Token` | `SHARED_HTTP` | cloud endpoint |
| `commands/ocr/mod.rs:249` | `x-goog-api-key` | `SHARED_HTTP` | literal Google host |
| `connector_use.rs:1219,1277` | `xi-api-key` | local builder | literal ElevenLabs host |

`SSRF_SAFE_HTTP`'s custom policy blocks a redirect to a **private** target and caps
at five hops — it does **not** block a redirect to another public host, which is the
exfiltration path. **Fix:** `.redirect(reqwest::redirect::Policy::none())` on the
client for any request carrying a non-`Authorization` credential, exactly as
`share_link.rs:259` and `triggers.rs:449` already do; where a vendor genuinely needs
redirects, re-attach the credential per hop instead of letting the client carry it.

### 7.E — P1: five Google Drive calls read the body without reading the status

Of 139 `.send().await`, **20 have no status token within 1,200 characters** (15 at
2,000). Hand-audit collapses that:

- **`platforms/n8n.rs:142,172,201,245,280` — 5 false positives.** They call
  `Self::check_response(resp, ctx)` (`n8n.rs:76-88`), which does
  `if !resp.status().is_success()`. **My matcher could not see a helper**, which is
  the same class of error `automation_runner.rs:353` commits at runtime for a
  different reason. Reported rather than counted.
- **`drive.rs:224, :248, :400, :420, :650` — 5 true positives.** `resp.json().await`
  straight into a typed struct. A Drive `401`/`403` returns a JSON error object that
  fails to deserialize into `DriveFileList`, so an authorisation problem reaches the
  user as *"invalid response shape"*. Combined with 7.C, this file has the tree's
  only no-timeout client **and** its only unguarded status handling.
- The remainder (`gallery.rs:160`, `persona_icon_gen.rs:239`, `:279`, `cloud.rs:391`,
  `setup.rs:333`, `desktop_bridges.rs:841`, `:884`, `slack_poller.rs:452`, `:1007`,
  `mcp_server/tools.rs:194`) were opened; most check further away than the window or
  legitimately do not care. **The honest figure is ~7 sites, in ~3 files.** This
  document does not claim 20.

### 7.F — P1: 142 of 144 response reads are unbounded, and 7 downloads have no integrity check

`.text()` 85 · `.json()` 52 · `.bytes()` 7 = **144 body reads**. Exactly **2** are
bounded (`api_proxy.rs:962` 2 MB, `automation_runner.rs:568` 10 MB, both by looping
`resp.chunk()`).

The seven `bytes_stream()` sites are the ones that write to disk, and none of them
caps bytes: `ollama.rs:193`, `persona_icon_gen.rs:426`, `setup.rs:289`,
`stt/downloader.rs:171`, `tts/sherpa_engine.rs:92`, `http_engine/openai.rs:125`,
`smee_relay.rs:322`. Four call `content_length()` — **for the progress bar, never as
a bound** (`persona_icon_gen.rs:417`, `setup.rs:277`, `downloader.rs:161`,
`sherpa_engine.rs:84`). `stt/downloader.rs:169-192` counts `downloaded` and never
compares it to anything; the only ceiling is `DOWNLOAD_TIMEOUT = 20 min` (`:31`),
which at any realistic link speed is not a size bound.

**And there is no integrity check on any of them.** Zero `sha256`/checksum near the
model and binary downloaders. `stt/downloader.rs:122` builds
`{HF_BASE}/ggml-{model_id}.bin` from a curated catalog — good provenance for the
*name*, none for the *bytes*. The file is renamed off `.partial` and loaded.

### 7.G — P2: the one retry loop omits the one status both siblings singled out

`automation_runner.rs:76-107` is well built: bounded (`retry_count.clamp(1,5)`),
exponential backoff capped at 30 s, auth re-resolve on `401` before the next
attempt, and warnings recorded per attempt. Two gaps:

1. **`is_retryable_error` (`:350-359`) is `{timeout, connect-failure, 5xx, 401}` —
   `429` is missing.** `ascent` and `vibeman` independently converged on sets that
   both contain `429`, and both wrote a comment about it. A rate-limited webhook is
   the textbook transient failure and this is the one it declines to retry.
2. **It decides by substring-matching a formatted message** —
   `msg.contains("timed out")`, `extract_http_status(msg)`. The status was known at
   `invoke_webhook` and thrown away into `AppError::Execution(String)`. See
   [typed-error-contract](./typed-error-contract.md) and the existing
   `undiscriminated-credential-rejection` census rule, which counts the same class.

Everywhere else: **zero retries.** Of 8 loops containing a `.send()`, all 8 are
pagination, tool-iteration, chunking or polling — none is a retry.

### 7.H — P2: the SSRF-safe client can be built fail-open, 300 lines from the comment forbidding it

`triggers.rs:447-453` builds a client with `.timeout(5s)`, `Policy::none()` **and**
`SsrfSafeDnsResolver` — then `.unwrap_or_default()`. On a builder failure that
becomes `reqwest::Client::default()` = `Client::new()`: **no timeout, system DNS,
ten-hop follow** — all three guarantees gone silently, on the code path whose whole
purpose is to safely probe a URL the user just typed.

`url_safety.rs:264-267` already forbids this in prose: *"it panics rather than
silently falling back to a stock `reqwest::Client` … which would be a silent, total
loss of SSRF protection for every caller of this function."* Six other client builds
use `.expect(...)`. **This is the only fail-open one — and `brainiac` has three,
each directly under its own written warning about the same default.**

Fix: `.expect("SSRF-safe validation client")`, or route through
`build_ssrf_safe_client(Duration::from_secs(5))` and add `Policy::none()` there.

### 7.I — P2: `managementFetch` is a dead credential-bearing fetch that the CSP also blocks

> **RESOLVED — `src/api/system/managementApiAuth.ts` no longer exists.** It was deleted in
> `e611c326d` (golden-paths batch 26) under the standing "a helper with zero consumers whose
> signature is the defect" allowance. The analysis below describes the tree before that
> commit and is kept for the reasoning, not as a live citation. Note what the sequence
> actually was: this path *named* the dead credential-bearing fetch, and a later batch
> removed it — the corpus closing one of its own findings.

`src/api/system/managementApiAuth.ts:35-44` mints a system bearer token and
`fetch`es `http://127.0.0.1:9420`. **Zero callers.** And `127.0.0.1:9420` is not in
`connect-src` in either `csp` or `devCsp` (`devCsp` allows `http://localhost:*`,
which does **not** match the literal `127.0.0.1` — CSP host-sources compare
hostnames, not addresses). So it is dead twice over, and it is the shape a future
author would copy. Delete it, or move it behind a Tauri command.

### 7.J — What this path CLEARED

Four things the brief or the obvious reading predicts, which the measurement refutes:

- **"TLS verification is disabled somewhere."** No. Zero, across 963 files and all
  five siblings. Do not spend a gate here.
- **"Non-2xx is silently treated as success."** Essentially no — 2 chained
  `send→body` forms exist in the whole tree and one of them has
  `.error_for_status()`. The real figure is ~7 sites in ~3 files (7.E), concentrated
  in one Drive module rather than diffuse.
- **"The frontend has an SSRF hole because a user types a URL into `useUrlImport`."**
  No — the CSP refuses everything except three GitHub hosts. But the code does not
  know that, its error copy promises "any valid HTTP/HTTPS URL", and the protection
  is one JSON edit away from evaporating. **Correct outcome, absent mechanism.**
- **"Timeouts are the problem."** No. 40 of 44 — the best in the fleet of five. The
  problems are redirects, response size, and the fact that the timeout is the reason
  people leave the safe door.

---

## 8. Gaps in the primitive

1. **`http_clients` has no factory that takes a deadline.** Three fixed 30 s
   constants plus one SSRF-only helper. Every caller needing a different timeout must
   hand-roll, and hand-rolling silently drops two unrelated guarantees. **This is
   upstream of 7.B, 7.C and 7.H.** The fix is one function:
   `pub fn client(profile: ClientProfile) -> reqwest::Client`, where `ClientProfile`
   names the trust level *and* the deadline together.
2. **`reqwest` cannot be told that a header is sensitive.** `remove_sensitive_headers`
   is a hardcoded list; there is no builder hook to extend it. So P4 has no
   library-level answer and must be handled by disabling redirects — which is a
   bigger hammer than the problem, and blocks vendors that legitimately redirect.
3. **A `redirect::Policy` cannot see the request's headers.** The `Attempt` callback
   gets the URL and the previous chain, not the credential — so a policy cannot
   decide "strip this header and continue". Re-attaching per hop means driving the
   redirect manually, which nothing in this tree does.
4. **`read_timeout` and `timeout` are not composable in `build_ssrf_safe_client`.**
   Its signature takes one `Duration` and applies it as the total. A streaming
   consumer needs the idle bound and gets the wrong instrument, which is why
   `smee_relay.rs` opted out of the helper entirely.
5. **`reqwest` has no response-size limit.** `.text()`/`.json()` are unbounded by
   construction; bounding requires giving them up for a `chunk()` loop, which means
   giving up `serde` integration too. **That trade is why 142 sites took the
   unbounded path**, and it is why the fix must be a shared helper
   (`read_bounded(resp, max) -> Result<Vec<u8>>`), not a rule telling 142 call sites
   to write a loop.
6. **The CSP is unreachable from the code it governs.** It lives in
   `src-tauri/tauri.conf.json`, is consumed by Tauri at build time, and no TypeScript
   module can import it, assert against it, or test with it. There are also **three**
   copies that must agree (`csp`, `devCsp`, `tauri.android.conf.json`) and they
   already disagree by four sources. **`brainiac` shows the only known fix — compute
   the directive from the same values the client reads** — and it requires a
   framework that builds its headers in JS, which Tauri does not.
7. **A `String` cannot say where it came from.** Nothing distinguishes a literal you
   typed from a decrypted credential field from a redirect `Location`. See below.
8. **Nothing in CI, lint, or test has any opinion about outbound HTTP.** Every
   deviation above shipped under a green `npm run check`. There is no census rule for
   any of it today — `unpinned-billing-account-spawn` and `unbound-child-lifetime`
   both anchor on `Command::new`, which is a different subject entirely.

---

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md), answered against all seven
qualifications this corpus has earned.

**The obvious candidate is a `Url` newtype that carries provenance —
`enum Target { Literal(Url), UserSupplied(Url) }` — so an unsafe client cannot
accept an untrusted target. My answer is: do not build it. Build
`ClientProfile` instead, and delete the ability to construct a bare client.**

**Q1 — a required type carries only what it actually encodes.** A provenance
newtype encodes *where the string came from*, and nothing else. Test it against this
document's defects: it does not prevent the missing timeout (7.C), the unbounded
body (7.F), the redirect-portable credential (7.D), the fail-open build (7.H), the
absent `429` (7.G), or the CSP drift (7.A). It addresses one class — the wrong
client for an untrusted host — which produced **zero** live defects here, because
the four sites with genuinely user-supplied hosts (`n8n`, `gitlab`, `db_query`,
`api_proxy`) are precisely the ones whose authors were paying attention. **The
provenance type solves the problem people already solve.**

**Q2 — requiredness is orthogonal to closedness.** `build_ssrf_safe_client(timeout)`
already makes the timeout a **required positional parameter**, and it achieves
**8/8** — a perfect record. That is the proof the mechanism works. It is also the
proof it is not sufficient: 32 constructions never call it, so a required parameter
on a function nobody is obliged to call constrains nothing.

**Q3 — a type nobody constructs constrains nothing.** This is where the provenance
newtype dies. To make `Target` load-bearing you must thread it through
`ConnectorStrategy::apply_auth`, `execute_api_request`, every `platforms/*` client,
and `TriggerConfig`. And it **cannot reach two of the most important cases**:
`db_query.rs:1415` derives its host from *inside a connection string* with
`extract_pg_host`, and `polling.rs`'s URL arrives as `Option<String>` out of a JSON
blob in SQLite. A type cannot reach a value that lives inside a string literal or a
serialized column — the same limit a previous path recorded for SQL and env vars.

**Q4 — a type anyone can construct authenticates nothing.** `Target::Literal(url)`
compiles anywhere. To be worth anything the constructor must be private and the only
public door a `const`-taking builder — at which point you have built a lot of
machinery to re-express something the *client choice* already expresses.

**Q5 — withholding beats requiring.** Here is the move. The reason 32 sites
hand-roll is that `reqwest::Client::builder()` is in scope in every file that needs
a deadline. **It does not have to be.** `reqwest` is a direct dependency of exactly
**three** of the workspace's five crates — `src-tauri/Cargo.toml:153`,
`core/Cargo.toml:68`, `engine/Cargo.toml:70` (`db` and `macros` do not have it).
**Delete it from the app crate and from `engine`, keep it only in `core`, and
re-export the *types* without the *constructor*:**

```rust
// core/src/http_clients.rs
pub use reqwest::{Response, RequestBuilder, Method, StatusCode, Url, header};
// deliberately NOT re-exported: reqwest::Client, reqwest::ClientBuilder
pub fn client(profile: ClientProfile) -> reqwest::Client { … }
```

Then `Client::builder()` **does not compile** outside `core`. Not "is linted", not
"is discouraged" — does not resolve. Every one of the 32 sites is forced to name a
`ClientProfile`, and every profile carries a deadline, a resolver decision and a
redirect decision **as one indivisible choice**, because the reason people separated
them was that the deadline was the only one on the signature.

**Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is
*assembling a client*, not *choosing a timeout*. So `ClientProfile` must let callers
say `Download { total: Duration, idle: Duration }`, `Probe { total: Duration }`,
`Stream { idle: Duration }` and `SelfHostedAllowed`. Withhold the builder; hand back
every legitimate configuration. If the profile enum cannot express what
`smee_relay.rs` or `mcp_server/tools.rs` needs, the profile is wrong and they will
route around it — which is exactly how the current four constants failed.

**Q7 (earned 2026-08-15) — withholding a requirement only helps when the requirement
was forcing the bad value; where the caller supplies the bad value voluntarily, you
must withhold the *construction*.** This leaf is the clean case for it. **Nothing
requires anyone to write `Client::builder()`** — 32 authors chose it, voluntarily,
because it was the documented way to get a timeout. Relaxing or tightening any
signature is therefore inert. **The only intervention that reaches a voluntary
choice is removing the thing chosen**, and here removing it is a two-line
`Cargo.toml` edit per crate rather than a refactor — which is why this is the rare
case where the structural fix is *cheaper* than the gate it replaces.

**The in-repo control that settles it.** Three constructors exist side by side:

| Door | Posture | Sites | Timeout | SSRF | Redirect |
|---|---|---:|---:|---:|---:|
| `build_ssrf_safe_client(d)` | **required parameter**, no opt-out | 8 | **8/8** | **8/8** | **8/8** |
| `SHARED_HTTP` / `HTTP_ALLOW_PRIVATE` | a constant you must know the name of | 25 | 25/25 | 0/25 | 0/25 |
| `Client::builder()` | **available to everyone** | 33 | 31/33 | 4/33 | 4/33 |

Requiring scores 8/8 on all three axes. A named constant scores 25/25 on the axis it
bakes in and 0/25 on the two it does not mention. The open door scores 94/12/12.
**Same repo, same authors, same week.** And `brainiac` supplies the external
replication with a *cost*: it hit 7/7 by convention with a `pub(crate)` constructor,
and the convention broke at the first crate boundary it could not cross — two
sibling crates re-derived the timeouts by hand. **A convention holds exactly as far
as its visibility modifier reaches.** Make the modifier the mechanism.

**Recommended, in order:** (1) add `ClientProfile` + `client()` to
`core::http_clients` and a `read_bounded()` helper beside it; (2) migrate the 32
constructions; (3) drop `reqwest` from `src-tauri/Cargo.toml` and
`engine/Cargo.toml` — at which point §7.B and §7.C become unrepresentable; (4) keep
§9's ratchet until (3) lands, because it gates the one class a profile alone does
not fix.

---

## 9. The missing gate

### The semantic conditions, stated first

Per the [portability test](../research/portability-test.md), what follows are **one
repo's proxies**. An adopting repo inherits the sentences and re-derives its own
signals.

> **(A)** A credential is attached to an outbound request under a name the HTTP
> client does not recognise as sensitive, on a client that follows redirects — so a
> reply written by the remote host can carry the credential to a host that was never
> validated.
>
> **(B)** An HTTP client is assembled at a call site rather than obtained from the
> system's one client factory, so the call site independently decides — usually by
> omission — its timeout, its name-resolution policy and its redirect policy.
>
> **(C)** A response body of unknown, remote-chosen size is buffered in full before
> any bound is applied.
>
> **(D)** A host appears in application code but not in the deployment policy that
> decides which hosts the application may reach, so the call is refused at runtime
> and reported as a network failure.

### What is gated, what is refused — with numbers

**(A) is gated below. (B), (C) and (D) are refused, each with the checker that
*can* express it specified instead of a bad regex shipped.**

**Why (B) is refused, with the counts.** The signal is trivial —
`Client::builder()|Client::new()` outside `core` — and returns **32 matches in 26
files** against **12** compliant uses. But **most of the 32 are correct content
today**: `platforms/github.rs:72` builds a 30 s client for the literal
`api.github.com`, and installing an SSRF resolver there would buy nothing.
Hand-classifying the 32 by host provenance gives **~26 literal-host and ~6
user-influenced**, so a rule on (B) would run at roughly **19% precision** and
report the data layer as broken. **A gate that fires on correct content is worse
than no gate**, and (B) is a *refactor* (the `ClientProfile` migration above), after
which the same signal becomes 100%-precise and can be added then. Declined
deliberately; the numbers are published so the next composer does not re-litigate.

**Why (C) is refused.** The signal `.text()|.json()|.bytes()` returns **144
matches**, and the receiver's type — `reqwest::Response` vs `String` vs `File` vs a
Tauri IPC payload — is not recoverable from a single-file regex. Anchoring on a
chained `send().await…text()` catches only **2** of the 144 because this codebase
binds the response to a variable first. **Neither precision nor recall is
acceptable.** The right mechanism is a shared `read_bounded(resp, max)` helper
(Gap 5) plus a Clippy `disallowed_methods` entry naming
`reqwest::Response::{text,json,bytes}` — Clippy resolves the receiver's type, which
is exactly the fact the regex cannot see. That is a real, cheap gate; it just is not
a census rule.

**Why (D) is refused as a census rule and specified as a script instead.** "Every
host reachable from `src/` appears in `connect-src`" is a **must-be-complete**
condition, and the census engine counts occurrences of a bad shape. The defect is an
*absence* — one missing token in a JSON string — and there is no bad shape to count.
The right mechanism is ~30 lines:

> **`scripts/check-csp-hosts.mjs`** — parse `connect-src` out of `csp` and `devCsp`
> in `src-tauri/tauri.conf.json`; walk `src/**/*.{ts,tsx}` for absolute
> `https?://host` literals that appear within a `fetch(` argument expression; run
> each through CSP3 §6.6.2.7 source-list matching against `'self' =
> http://tauri.localhost`; **fail on any host the policy would refuse.**
> **Assert the instrument before the result** — the parser must find ≥8 sources in
> each directive and the matcher must ALLOW `https://export.arxiv.org` and BLOCK
> `https://example.invalid`, or the script exits non-zero as broken rather than
> green as clean. Run today, it fails on `api.crossref.org`. That is the same
> assert-the-instrument shape [foreign-key-policy](./foreign-key-policy.md) §3 built
> for the dangling-parent case, and this composer used exactly this matcher to find
> the P0.

### The one census rule — `redirect-portable-credential-header`

Keys on a **header-name string literal** attached to a request builder, where the
name contains a credential noun and is **not** one of the five names
`reqwest::redirect::remove_sensitive_headers` strips on a cross-host hop.

**Measured 2026-08-15 at `0b9418d32`: 22 matches across 9 files.** Two independent
implementations — the real census runner and a hand-written matcher reusing the
engine's own `walkFiles` + `isCommentOnlyLine` — returned **22/9** and **22/9**.
**All 22 were opened and confirmed** (§7.D lists every one with its client and its
host provenance); every one is on a client that follows redirects. **Precision
22/22.**

Recall caveat, published because it was a real miss: a third implementation with a
different credential-noun vocabulary returned **20** — it omitted
`connection-string` and therefore missed the two `Neon-Connection-String` sites,
which carry a database password. **A vocabulary-based signal's recall is bounded by
the author's word list, and the misses cluster on the unusual cases.** If a new
vendor invents a new noun, extend the alternation.

**Positive control — a partition, not a number.** The same anchor pointed at the
COMPLIANT form (`bearer_auth`/`basic_auth`, or `.header("Authorization"|"Cookie"|
"Cookie2"|"Proxy-Authorization"|"WWW-Authenticate", …)`) returns **62 matches across
16 files**. Together the two rules partition the anchor's whole population exactly:
**149 credential-capable attachments = 22 violating + 62 compliant + 65
non-credential headers** (`Content-Type` 20, `Accept` 13, `User-Agent` 8,
`Notion-Version` 5, `Prefer` 4, `X-GitHub-Api-Version` 2, …). If the control's count
ever collapses, the anchor is broken rather than the codebase fixed.

No variable-length lookbehind; one forward scan with a fixed-alternation negative
lookahead. Runtime well under a second over 963 files.

```json
{"rules":[
  {
    "id": "redirect-portable-credential-header",
    "goldenPath": "docs/concepts/golden-paths/outbound-http-call.md",
    "title": "A credential attached to an outbound request under a header name the HTTP client does not know is sensitive, so it survives a cross-host redirect",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "\\.\\s*header\\s*\\(\\s*\"(?!authorization\"|cookie2?\"|proxy-authorization\"|www-authenticate\")[a-z0-9-]{0,30}(?:api[-_]?key|token|secret|password|passwd|connection-string)[a-z0-9-]{0,20}\"\\s*,",
      "flags": "gi",
      "ignoreCommentLines": true,
      "description": "a credential-bearing header attached to an outbound reqwest request under a name OUTSIDE the fixed set the client strips across a host change. PROXY FOR the stack-free condition: a credential is attached to an outbound request under a name the HTTP client does not recognise as sensitive, on a client that follows redirects, so a reply written by the remote host can carry the credential to a host that was never validated. THE MECHANISM, READ FROM THE DEPENDENCY'S SOURCE AND THEN EXECUTED: reqwest 0.12.28 src/redirect.rs:239-251 removes exactly AUTHORIZATION, COOKIE, cookie2, PROXY_AUTHORIZATION and WWW_AUTHENTICATE when `next.host_str() != previous.host_str() || next.port_or_known_default() != previous.port_or_known_default()`, and NOTHING ELSE; src/async_impl/client.rs:310 defaults redirect_policy to Policy::default() = Policy::limited(10) (src/redirect.rs:160-165), so an unconfigured client follows ten hops. VERIFIED TWICE, INDEPENDENTLY, 2026-08-15: (1) that predicate replayed verbatim in node against this app's seven real ConnectorStrategy::apply_auth shapes says four Authorization-family shapes are stripped and Circle-Token (connector_strategy.rs:676) and x-api-key (:839) survive; (2) a REAL two-hop listener on loopback (hop 1 -302-> hop 2 on a different port) driven with three credential headers saw all three at hop 1 and x-api-key + circle-token at hop 2. MEASURED at 0b9418d32: 22 matches / 9 files, ALL TWENTY-TWO OPENED AND CONFIRMED (precision 22/22), every one on a client that follows redirects - gitlab/client.rs:80 PRIVATE-TOKEN on a user-supplied self-hosted base_url via SHARED_HTTP (no SSRF resolver, follow 10); platforms/n8n.rs:141,171,199,243,278 X-N8N-API-KEY, likewise user-supplied base_url; engine/db_query.rs:1428,1471 Neon-Connection-String, which is the whole Postgres connection string INCLUDING THE PASSWORD, sent to a host derived from that same string; db_query.rs:1021,1107 apikey; connector_strategy.rs:676,839; cloud/sync/client.rs:73,99,125,150 and infrastructure/auth.rs:298,326 apikey; cloud/client.rs:416 X-User-Token; ocr/mod.rs:249 x-goog-api-key; connector_use.rs:1219,1277 xi-api-key. NOTE that SSRF_SAFE_HTTP does not clear this: its custom policy (url_safety.rs:273-281) refuses a redirect to a PRIVATE target and caps at 5 hops, but a redirect to another PUBLIC host is followed and the header goes with it. RECALL CAVEAT, published because it was a real miss: an earlier implementation with the vocabulary api.key|token|auth|secret|private|circle|admin.key|x-user returned 20, omitting connection-string and therefore missing the two highest-value matches. A vocabulary-based signal's recall is bounded by the author's word list; extend the alternation when a vendor invents a new noun. LEGAL FIX, in order: (1) use bearer_auth/basic_auth, or .header(\"Authorization\", ..), whenever the vendor accepts it - the client then strips it for you and the count drops; (2) where the vendor demands its own name, add .redirect(reqwest::redirect::Policy::none()) to that client, exactly as share_link.rs:259 and triggers.rs:449 already do, both with a comment naming this hazard; (3) if the vendor legitimately redirects, drive the redirect manually and re-attach per hop - a redirect::Policy callback cannot see the request headers, so it cannot strip for you (see the golden path's Gap 3). DO NOT 'fix' this by renaming the header to something the regex misses. END OF LIFE: this rule is designed to reach zero. When it does, the runner fails structurally on zero matches, by design - DELETE the rule then, do not baseline it at 0."
    },
    "baseline": { "files": 9, "matches": 22 },
    "floor": 900
  },
  {
    "id": "redirect-portable-credential-header-positive-control",
    "goldenPath": "docs/concepts/golden-paths/outbound-http-call.md",
    "title": "POSITIVE CONTROL for redirect-portable-credential-header — the same anchor pointed at the credential headers the client DOES strip",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "\\.\\s*(?:bearer_auth|basic_auth)\\s*\\(|\\.\\s*header\\s*\\(\\s*\"(?:authorization|cookie2?|proxy-authorization|www-authenticate)\"\\s*,",
      "flags": "gi",
      "ignoreCommentLines": true,
      "description": "NOT A GATE - a control, and it carries no baseline by design. Same anchor (a credential attached to an outbound reqwest request), same roots, same extensions, pointed at the COMPLIANT shape: a credential under one of the five names reqwest strips on a cross-host redirect. Measured 2026-08-15 at 0b9418d32: 62 matches across 16 files - 31 bearer_auth/basic_auth calls and 31 explicit .header(\"Authorization\", ..) - versus the rule's 22 across 9. TOGETHER THE TWO RULES PARTITION THE ANCHOR'S ENTIRE POPULATION: 149 credential-capable attachments = 22 violating + 62 compliant + 65 non-credential headers (Content-Type 20, Accept 13, User-Agent 8, Notion-Version 5, Prefer 4, X-GitHub-Api-Version 2, and the rest). That partition is the evidence the rule discriminates on the header NAME and not on the act of attaching a header at all - if it were keying on `.header(` it would match here too and report the whole connector layer as violating. Run both together whenever the rule's pattern is edited: if this control's count collapses, the anchor was broken, not the codebase fixed. It is expected to RISE as sites migrate from a vendor header to Authorization, which is exactly why it must never be baselined."
    },
    "floor": 900
  }
]}
```

**No `exclude` entries.** Every one of the 22 is a genuine instance; there is no
legitimate file-level exemption, so no stale suppression can accumulate. A site that
gains `Policy::none()` stops being a defect but keeps matching — that is the rule's
one honest weakness, and it is why the fix order above puts "use `Authorization`"
first: that fix moves the count.

**`floor: 900`** matches every other `src-tauri`-rooted rule deliberately; several
rules over one root must not hold several opinions about what "the Rust tree is
intact" means. The walk reports **963**, exactly `rust.files` in
[`shared-facts.json`](../shared-facts.json).

**On severity.** The census mechanism's own semantics are the severity: drift is
fatal under `npm run census:check`, reporting-only under `npm run census`. No
argument from warning volume is offered or would be valid — `npm run check` runs
`eslint src/` with no `--max-warnings` and pre-commit runs `--quiet
--max-warnings 99999`, so a warn-level rule enforces nothing at either gate at any
count. This rule is a **ratchet held until the `ClientProfile` migration lands**;
the fix is in "Prefer a type over a gate", and the P0-catching instrument is the CSP
script specified above, not this.

### Validated standalone, before publishing

Both rules were written to a scratchpad registry with a filename unique to this
composer (`rules-outbound-http-call-probe.json`) and run through the **real
runner** — `node scripts/census/run-census.mjs --rules <scratch>/…` — not a
re-implementation. Results: `redirect-portable-credential-header` **9 files / 22
matches / 963 walked / floor 900**; the positive control **16 files / 62 matches**,
no baseline, no structural problems. A **second, independent** matcher reusing the
engine's own `walkFiles` and `isCommentOnlyLine` returned the identical 22/9 and
62/16, and printed every match for hand-verification. The JSON block above was then
**re-extracted from this finished document, re-parsed, and re-run** to confirm the
published rule is the validated rule.
