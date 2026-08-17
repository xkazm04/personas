# Golden path — Telemetry scrubbing at the egress boundary

> Situation node: `backend-runtime/backend-observability/telemetry-scrubbing` ·
> [situation spine](../situation-spine.md) · recurrence 5 · risk **HIGH** ·
> sides: **server** (refuted — §12.1) · convergence: **converged** (refuted — §12.2) ·
> dimensions: **security · resilience**
> Composed 2026-08-17 against `master` @ `2a874e692`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` files under `src/` and **963** `.rs`
> files under `src-tauri/` (the census walk). Read in full: `src/lib/sentry.ts`,
> `src-tauri/src/main.rs` (`sentry_options` + `mod pii`, lines 77–331),
> `src/lib/silentCatch.ts`, `src/lib/silentFailureTelemetry.ts`,
> `src/lib/utils/crashPersistence.ts`,
> `src/lib/utils/sanitizers/maskSensitive.ts`, `.../sanitizeErrorForDisplay.ts`,
> `src/lib/log.ts`, `ErrorBoundary.tsx`'s report half, `src/main.tsx`,
> `src-tauri/src/mcp_server/{tools,install,mod,auth}.rs`,
> `src-tauri/src/commands/credentials/{query_debug,db_schema}.rs`, and — because
> the answer turned out to live there — the SDK's own
> `@sentry/browser/.../integrations/breadcrumbs.js`, `.../sdk.js` and
> `@sentry/react/.../error.js`.
>
> **Measured by executing, not by reading.**
> 1. A **22-channel scrub matrix**: for every field a Sentry record can carry,
>    the transform that field *actually* receives on the way out was replayed
>    against **20 credential shapes, 7 labelled carriers, 10 PII shapes and 6
>    negative controls**. Fixtures are SHA-256-derived with the literal marker
>    `SYNTHET1C` spliced into the body, so no fixture can collide with a real
>    credential.
> 2. An **end-to-end pipeline replay** of `log.ts` → `console.*` → the SDK's
>    `breadcrumbsIntegration` → the shipping `beforeBreadcrumb` → the shipping
>    `beforeSend`, transcribed verbatim from all four sources. §0 publishes what
>    came out the other side.
> 3. The bearer finding was **cross-checked in a second engine** (CPython `re`
>    against Node `RegExp`, from two separately-typed transliterations). Both
>    agree on all six auth-header forms.
> 4. A **read-only copy** of the operator's live 347 MB `personas.db` (copied
>    with its `-wal`/`-shm`, opened `readonly: true`, the live file never opened
>    for write, **copy deleted afterwards**): 2,570 columns inventoried, 20,269
>    error-bearing values across 117 columns in 77 tables scanned shape-by-shape,
>    all 84 `frontend_crashes` rows, and the four free-text `persona_executions`
>    columns.
> 5. The §9 rule and its positive control were built, counted by two
>    independent implementations, hand-verified 19/19, **fault-injected eight
>    ways plus one real violation written into a real source file and reverted**,
>    validated in a private scratch registry with a filename unique to this
>    composer, then re-extracted from this finished document and re-run:
>    identical. **The full registry was NOT run**, per the doctrine.
>
> **`cargo` was not run.** Every Rust behaviour below is either a static read or
> a **transcription** of `main.rs`'s `mod pii` into the harness — stated as such
> wherever a number depends on it. The Rust `regex` crate has no lookaround and
> none of these patterns use any, so the port is faithful.
>
> **No secret value, prefix, or partial appears anywhere in this document.**
> Every live finding is reported as shape, column, length and count.
>
> **No behaviour was changed by this composition.** §7 is a fix backlog.

---

## 0. The headline

### First, plainly, because it was asked: yes — one channel would carry a credential off this machine today, and it is not Sentry

**`src-tauri/src/mcp_server/tools.rs:1812` `personas_result` selects
`output_data` and `tool_steps` from `persona_executions` and returns them
`to_string_pretty` to whatever MCP client is connected. There is no redaction
anywhere in `src-tauri/src/mcp_server/` — 3,243 lines, 33 tool handlers, 149
`row.get` calls, and `grep -r 'redact\|sanitiz\|scrub'` over the whole module
returns 0.**

Measured on the operator's own database, this morning:

| column | rows | bytes | credential shapes | PII shapes |
| --- | ---: | ---: | --- | --- |
| `persona_executions.tool_steps` | 1,921 | 26,551,823 | **1 GitHub PAT · 7 Google-API-key-shaped · 1 PEM `BEGIN … PRIVATE KEY` header** | 14,736 POSIX home paths · 1,515 `DOMAIN\user` · 1,032 emails |
| `persona_executions.output_data` | 2,058 | 16,228,508 | — | 756 `DOMAIN\user` · 131 POSIX home · 24 emails · 10 Windows user paths |
| `persona_executions.input_data` | 2,188 | 9,800,051 | — | 165 `DOMAIN\user` · 72 POSIX home · 3 emails |

(The 7 Google-shaped matches are the same population
[secret-and-pii-redaction](./secret-and-pii-redaction.md) classified as 4 literal
+ 3 template-adjacent; this is an independent re-measurement of the raw shape
count, not a second classification.)

An MCP tool result is not a local read. It is handed to an agent process which
forwards it to a model provider. **`brainiac` — the one sibling with a
production-grade redactor — redacts at exactly this door
(`crates/brainiac-server/src/mcp.rs:2393`, before truncation, so a secret
straddling the cut is still masked). This repo does not redact there at all.**

**The door is unlocked and currently unopened.** `~/.claude/mcp.json`,
`~/.cursor/mcp.json` and a project `.mcp.json` are all absent on this machine, so
no client is wired today. `mcp_server/install.rs` wires it in one command.

**Everything else is inert here for a reason that is not a control.** Scanning
for a Sentry-DSN-shaped string: **0 in `src-tauri/target/release/personas-desktop.exe`,
0 in the debug exe, 0 across all 1,399 chunks of `dist/assets/`.** `.env` has no
`VITE_SENTRY_DSN`; only `.github/workflows/release.yml:195-196,304-305` supplies
one. And the process holding `engine-leader.lock` (pid 27816, started
2026-08-16T16:39:54Z) matches the **debug** binary's mtime, so
`cfg!(debug_assertions)` is true and `main.rs:82-86` sets `dsn: None`
unconditionally. **The scrubbers on this machine have never had a destination —
which is exactly why the defect in §0.2 could sit there unnoticed.**

The clipboard channel (§7 D3) is live in every build, DSN or not.

### 0.1 — `beforeSend` visits 5 of 14 field families, and the biggest producer of the other 9 has no call site at all

This is the finding that reframes the leaf. `sentry.ts:215-253` and
`main.rs:94-128` are both written as **field enumerations**: they name
`user`, `request`, `message`, `exception.values[].value`, `breadcrumbs[].message`
and stop. Everything a Sentry record can also carry is unvisited.

Executed — the shipping `beforeSend` run over a fully-populated event:

```
message              token:mask  userpath:mask
contexts             token:mask  userpath:LEAK      <- react.componentStack
tags                 token:mask  userpath:mask      <- (values were short ids)
extra                token:LEAK  userpath:mask
request.url          token:LEAK  userpath:mask      <- headers+data deleted, url kept
request.headers      token:mask  userpath:mask      <- deleted
breadcrumbs[].data   token:LEAK  userpath:LEAK
```

| field family | frontend `beforeSend` | Rust `before_send` |
| --- | --- | --- |
| `message` | ✅ `scrubPii` | ✅ `pii::scrub` |
| `exception.values[].value` | ✅ | ✅ |
| `exception.values[].stacktrace` (frames, `vars`) | ✗ | ✗ |
| `breadcrumbs[].message` | ✅ | ✅ |
| **`breadcrumbs[].data`** | **✗** | **✅ key-`retain` + value scrub** |
| `tags` | ✗ | ✗ |
| `contexts` | ✗ | ✗ |
| `extra` | ✗ | ✗ |
| `user.email` / `.ip_address` / `.username` | ✅ deleted | ✅ nulled |
| `user.id` | ✗ | ✗ |
| `request.headers` / `.data` | ✅ deleted | `.data` only |
| `request.url` | ✗ | ✗ |
| `transaction`, `server_name` | ✗ | ✗ |
| **visited / 14** | **5** (2 of them deletions) | **6** |

**The Rust half is strictly better than the frontend half on the one field that
matters most.** `main.rs:120-127` runs `breadcrumb.data.retain(|k,_| !pii::is_sensitive_field(k))`
and scrubs every surviving string value. `sentry.ts:255-260` touches
`breadcrumb.message` and nothing else. Same application, same concept, two
implementations, and the weaker one guards the channel with ~10× the traffic.

**And the traffic is not authored.** `@sentry/browser`'s `breadcrumbsIntegration`
is a **default** integration (`sdk.js` `getDefaultIntegrations`) with
`{console: true, dom: true, fetch: true, history: true, xhr: true}`, and
`sentry.ts:200-261` does not pass an `integrations` array, so all five are live.
Its console handler is:

```js
// @sentry/browser/.../integrations/breadcrumbs.js  _getConsoleBreadcrumbHandler
{ category: "console",
  data: { arguments: handlerData.args, logger: "console" },
  level, message: safeJoin(handlerData.args, " ") }
```

`message` and `data.arguments` are **the same text**. One is scrubbed and one is
not. Replayed with a real `silentCatch` log line:

```
console breadcrumb, after the SHIPPING beforeBreadcrumb
  message carries the token        : false
  message carries the user path    : false
  data.arguments carries the token : true
  data.arguments carries the path  : true
```

**Every `console.*` in the app is a producer.** `src/lib/log.ts:20-41` funnels
all four levels of `log.*` and every `createLogger(...)` into `console.*`.
Measured: **79 direct `console.*` calls in 32 files + 216 `log.*` / `logger.*`
calls in 103 files = 295 console-bound statements, and 98 files construct a
`createLogger`.** None of them is a Sentry call site; no ratchet over
`@sentry/*` usage can see any of them.

`_getFetchBreadcrumbHandler` and `_getXhrBreadcrumbHandler` are worse in kind:
they emit `data: { method, url, status_code }` and **no `message` at all**, so
the hook has literally nothing to scrub on them and the URL — query string
included — ships as written. In this app that channel is small (14 `fetch(`
sites in 10 files; `scripts/check-csp-hosts.mjs` reports **2 frontend fetch
targets across 2 hosts**), which is a property of Tauri, not of the control.

### 0.2 — the frontend redactor prints `[secret]` next to the token it failed to mask

`sanitizeErrorMessage` (`maskSensitive.ts:109`) is the redactor `scrubPii`
composes first, and it is also what `sanitizeCrashString` and
`sanitizeErrorForDisplay` reduce to. Its `INLINE_SECRET_RE` (`:81-82`) lists
`authorization` and `bearer` among the *key* names, with the value group
`([a-zA-Z0-9\-_.~%]+)`. On a real auth header, `authorization` matches first and
the value group binds the literal word **`Bearer`**:

```
IN  : Authorization: Bearer <40-char synthetic token>
OUT : Authorization: [secret] <40-char synthetic token>     <- verbatim
```

Executed in **two engines** (Node `RegExp` and CPython `re`), six forms:

| input | frontend `scrubPii` | Rust `pii::scrub` |
| --- | --- | --- |
| `Bearer <token>` | **LEAK** (no rule matches at all) | mask |
| `Authorization: Bearer <token>` | **LEAK, with `[secret]` printed beside it** | mask |
| `Authorization=Bearer <token>` | **LEAK, same** | mask |
| `proxy-authorization: Bearer <token>` | **LEAK, same** | mask |
| `Basic <token>` | **LEAK** | mask |
| `x-api-key: <token>` | mask | mask |

The Rust side has a dedicated `bearer_re` (`main.rs:190`) applied *after* the
key-value rule, so it masks 6/6. The frontend has no bearer rule and its
key-value rule actively consumes the scheme word.

**This is a composition defect introduced by the fix that closed the previous
one.** Before 2026-08-16, `scrubPii` had no credential rules and this input
leaked *with no marker*. Since the `sanitizeErrorMessage` import
(`sentry.ts:39`), it leaks *with a redaction marker beside it*. The fix did not
create the leak; it made the leak look redacted — in the one channel whose entire
job is to ship data to a third party, and in `persistCrash`, and in every
`sanitizeErrorForDisplay` render.

### 0.3 — the redactor's "I found something" branch exfiltrates what it found

```ts
// src/lib/utils/sanitizers/sanitizeErrorForDisplay.ts:82-87
const redacted = sanitizeErrorMessage(raw);
if (redacted !== raw) {
  // Something was redacted — the original had sensitive content
  logger.error("Error message redacted for UI", { context: context ?? 'error', raw });
}
```

`raw` is the **unsanitized** string, and the condition guarding the write is
*"we just proved this string contains sensitive content"*. `logger.error` is
`console.error` (`log.ts:36-38`), which is §0.1's channel: the formatted line
becomes a breadcrumb whose `message` is scrubbed and whose `data.arguments` is
the same line, unscrubbed — plus the rolling `tracing` file via
`log_frontend_error` (`logging.rs:145-152`), which
[secret-and-pii-redaction](./secret-and-pii-redaction.md) §7 P1 measured as
unsanitized. **Detection is the trigger for disclosure.**

### 0.4 — the two halves disagree about what is sensitive, and only one half acts

`main.rs:296-331` `is_sensitive_field` is this application's **only written
policy** about what must not travel in a telemetry side-field: 13 exact names —
including `execution_id`, `persona_id`, `persona_name`, `credential_id`,
`tool_name`, `connector_name`, `api_url`, `endpoint`, `user_name` — plus 16
substring rules. The Rust hook deletes those keys from `breadcrumb.data`.

The frontend has no equivalent, and writes two of those exact names into fields
nothing filters: `useExecutionScope.ts:31-32` sets `execution_id` and
`persona_id` as **event tags**; `analyticsMiddleware.ts:26` sets `execution_id`
as an **extra**. One half of one application classifies a field name as
must-not-travel; the other half ships it.

### Sibling boundaries, settled in prose

[**secret-and-pii-redaction**](./secret-and-pii-redaction.md) owns **the
redactor** — which shapes a pattern set covers, how many implementations exist
(24), and that PII outnumbers credentials in this database ~7,000 : 1. **This
path owns the boundary those redactors are attached to**: which fields of which
record a hook actually visits, and which producers never pass through one. Its
§3 established that `error!`-level structured fields land in `tags`/`contexts`
unscrubbed on the Rust side; **this path measures the same wall on the frontend,
finds it wider (5 of 14 field families), and finds that the dominant producer is
the SDK's own default instrumentation rather than any call site.** Where we meet
on the pattern sets, that path is authoritative; §0.2 is new because it is about
a *composition* introduced after that path was written.

[**error-boundary**](./error-boundary.md) owns **the boundary as an object** —
placement, keying, reset, and its §7 D6 named the clipboard hole and the
`handled: true` default. Both are confirmed here without re-derivation (§7 D3,
§7 D6); this path supplies what D6 could not: the reason the clipboard is the
*only* egress channel of the crash payload that a `beforeSend` fix will not
also cover.

[**swallowed-error-telemetry**](./swallowed-error-telemetry.md) owns **whether a
caught failure leaves a record**. This path owns **what that record contains
when it leaves the device**. The two compose badly and it is measured: its
prescribed operator door, `silentCatch`, is simultaneously the app's best
telemetry practice and its largest explicit producer of unscrubbed
`breadcrumb.data` — three sites, plus a `log.warn` that becomes a fourth via the
console breadcrumb. Its 10.6%-of-catch-sites-reach-Sentry number is also this
path's biggest caveat: **a scrubber that never runs is not a control, and neither
is a leak that never ships.**

[**structured-logging**](./structured-logging.md) owns **the log record's
shape**. Its `unqueryable-log-record` rule prescribes moving values out of the
message and into structured fields — which, on this boundary, moves them from
the field the hook visits into the fields it does not. That collision was first
recorded by secret-and-pii-redaction §3 for Rust `error!`; **it is measured here
to hold on the frontend too, for a different mechanism** (`data.arguments`), and
the fix is the same four-to-eight lines in the hooks, not a change to either
rule.

[**first-use-consent-gate**](./first-use-consent-gate.md) owns **the opt-in**.
The spine calls this leaf "Telemetry scrubbing *and opt-in*"; the opt-in half is
already written and this path does not re-derive it. One finding is offered
upward rather than kept: **the Rust reporter is not consent-gated at all** (§7
D5), and that path's `consent-bypassing-telemetry-import` rule has
`roots: ["src"]`, so it cannot see it.

[**sql-console**](./sql-console.md) owns **the query doors**, including the
`query_debug.rs` / `execute_db_query` asymmetry the brief primed. Confirmed, not
re-derived — with two corrections offered upward in §12.5.

[**retention-and-pruning**](./retention-and-pruning.md) owns **what is already on
disk**. This path stops at the moment of transmission.

---

## 1 Trigger

- "Where do I attach this so it shows up in Sentry?" / "I'll put it in `extra`
  so it's easier to read in the issue."
- "Add a breadcrumb with the stack so we can debug it later."
- "I'm writing `beforeSend` / `before_send` / a `beforeBreadcrumb` filter."
- "Let's give the user a Copy-report-for-support button."
- "This tool returns the execution output — the client needs the whole thing."
- "The message is already scrubbed, so the event is fine."
- "It's just an id / a duration / a status — there's nothing sensitive in it."
- "Telemetry is off by default, so this is not a problem."

If you are about to type `addBreadcrumb`, `setTag`, `setExtra`, `setExtras`,
`setContext`, `setUser`, `captureException(err, {`, `sentry::add_breadcrumb`,
`beforeSend`, `before_send`, `beforeBreadcrumb`, `copy(`, `writeText(`, a
`serde_json::to_string_pretty` inside a transport module, or a `SELECT` whose
result crosses a process boundary — **you are in this situation.**

**You are also in it, and this is the case everyone misses, if you are writing a
plain `console.log` or a `log.warn`.** In this app that is a Sentry breadcrumb
with an unscrubbed copy of its own message, 295 times over.

**Not this path:** which shapes a pattern list covers is
[secret-and-pii-redaction](./secret-and-pii-redaction.md); whether the user
agreed to telemetry at all is [first-use-consent-gate](./first-use-consent-gate.md);
what a log record's fields should be is [structured-logging](./structured-logging.md);
how long the artifact lives is [retention-and-pruning](./retention-and-pruning.md).

## 2 The one way

**Scrub the record, not a list of its fields — and enumerate the producers you
did not write.** A telemetry hook that names `message`, `exception.value` and
`breadcrumb.message` is not a scrubber; it is a scrubber applied to the three
fields its author happened to think of, and it will be silently wrong the day the
SDK adds a field, an integration is enabled by default, or a colleague reaches
for `setExtra`. **Walk the whole record**: recurse every string value under
`contexts`, `extra`, `tags`, every `breadcrumb.data`, every stack frame's `vars`,
and the URL on `request` — with a depth cap that *redacts* on overflow rather
than passing through, because an unbounded walk on an attacker-shaped object is
its own bug. **Then delete by key before you scrub by value**, using a key list
derived from your own schema rather than imagined — this repo already has one at
`main.rs:296` and the frontend does not import its equivalent. **Do the same on
every other channel that leaves the device**, and enumerate them by asking *where
can this process send bytes* rather than *where did someone call a redactor*: the
error reporter, the clipboard, the export bundle, the cloud sync row, the MCP
tool result, the log file a shipper might one day read. A channel with no
redactor is not a channel someone decided was safe; it is a channel nobody
reviewed. **Verify the scrubber by feeding it real-shaped tokens, not by reading
it** — the strongest redactor in this repo prints its own redaction marker beside
an unmasked bearer token, and no amount of reading found that; one replay did.
**And never let the detection of sensitive content be the thing that writes it
somewhere new** — `sanitizeErrorForDisplay.ts:86` logs the raw string precisely
when it has proved the string is dangerous.

If you must get one thing right first: **the field list is the bug.** Two hooks,
written by different people in different languages in this one app, both
enumerate fields, and between them they miss nine families and agree on none of
the misses.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src-tauri/src/main.rs:296` `pii::is_sensitive_field` | **the app's only written policy on what must not travel in a side field** — 13 exact names + 16 substring rules. Used at `:121` and `:135` to `retain` breadcrumb-data keys. The frontend has no equivalent and needs one |
| `src-tauri/src/main.rs:229` `pii::scrub` | the stronger of the two hooks' passes: UUID → correlation prefix, URL → scheme+host with userinfo stripped, key/value, **bearer/basic**, 9 prefixed classes, base64-blob, quoted-string. Masks 17/20 credential shapes and 6/6 auth headers |
| `src/lib/utils/sanitizers/maskSensitive.ts:109` `sanitizeErrorMessage` | the only PII pass in the tree — paths, IPv4, internal hosts, emails, URL query/fragment stripping with URLs protected behind a placeholder first (`:117-130`). 8/10 PII shapes. **Read §0.2 before trusting it on an auth header** |
| `src/lib/utils/crashPersistence.ts:22` `sanitizeCrashString` | the right *composition* shape: URL query → `[query]`, stack args → `(…)`, then the shared pass. Applied to message **and** stack **and** componentStack before either sink |
| `src/lib/utils/crashPersistence.ts:78` `persistCrash` | the report call. Sanitizes, then writes localStorage **and** SQLite. Measured over all 84 live `frontend_crashes` rows: **0 credential shapes, 0 PII shapes surviving; 117 column-values carry a redaction marker.** It works |
| `src-tauri/src/cloud/sync/rows.rs:72` `redact_secrets` / `:99` `sanitize_event_payload` | the only true network-egress redactor in the tree, and the best JSON walker (substring key match, value-prefix checks, density heuristic, 4 KB bound). Covers 1 of 11 synced tables |
| `src-tauri/src/commands/credentials/query_debug.rs:79` `sanitize_query_result` | result-side redaction: 27 sensitive column names → `[REDACTED]`, values truncated to 200 chars, rows capped at 5, `rows_omitted` reported honestly. Private to one file; see §7 D4 |
| `personas-web/src/lib/sentry-pii.ts:88-195` `scrubData` + `scrubEvent` | **not in this repo, and it is a port of this repo's own file that gained the missing half.** Recurses `contexts`, `extra`, `tags`, `frame.vars` and `breadcrumb.data` with `MAX_SCRUB_DEPTH = 6` that redacts on overflow. This is the reference implementation for §7 D1 — see §6 convergence |
| `scripts/census/` | the ratchet mechanism. §9 |

**Do not exist — this path names them:**

- **A whole-record walk.** Both hooks are field enumerations. 0 of 5 siblings has
  one either (§6) — this is a fleet-wide silence, not permission.
- **Any redaction in `src-tauri/src/mcp_server/`.** 3,243 lines, 33 handlers,
  149 `row.get`, 0 matches for `redact|scrub|sanitiz`.
- **A frontend `is_sensitive_field`.** The Rust list is not exported, not
  mirrored, and not consulted by `beforeSend`.
- **A consent gate on the Rust reporter.** `sentry::init` at `main.rs:28` is
  unconditional; `isTelemetryEnabled()` is a `localStorage` key the Rust process
  cannot read.
- **A test that feeds either hook a real-shaped token.** Zero in this repo, and
  **zero in five siblings** (§6). §0.2 is what that costs.
- **A sanitizer on the clipboard report** (`ErrorBoundary.tsx:113-122`).

## 4 Steps

1. **Enumerate the channels before you write the hook.** Ask *where can this
   process send bytes*, not *where did someone call a redactor*. This app has
   at least ten: Sentry event, Sentry breadcrumb, the crash clipboard, the crash
   export, the cloud-sync row, the MCP tool result, the rolling `tracing` file,
   the WebView console funnel, the crash-log directory, and the IPC response.
   §7 shows which are covered.
2. **List the record's fields from the SDK, not from memory.** Open
   `sentry::protocol::Event` / the `@sentry/core` `Event` type and write down
   every field. Nine families are missing from both hooks here and nobody
   noticed, because both hooks were written from the fields the author had in
   mind.
3. **Walk, don't enumerate.** One recursive value-scrubber over the whole record,
   with a bounded depth that **redacts on overflow**. Port
   `personas-web/src/lib/sentry-pii.ts:88-106`; it is already a port of this
   file.
4. **Delete by key first, using a list derived from your schema.** Reuse
   `pii::is_sensitive_field`; do not invent a second vocabulary. The doctrine's
   warning is measured here — the Rust list and the frontend's absence of one
   disagree about `execution_id` and `persona_id` today.
5. **Enumerate your unauthored producers.** Which SDK integrations are on by
   default? In this app `breadcrumbsIntegration` alone converts 295 log
   statements and every `fetch`/`xhr` into records whose `data` your hook does
   not visit. Either scrub `data` or pass an explicit `integrations` array.
6. **Redact at every other egress door, on the way out.** The `SELECT` that
   feeds an MCP tool result or a sync row is your last boundary. `brainiac`
   redacts *before* truncation so a secret straddling the cut is still masked —
   copy that ordering.
7. **Never make the detection of a secret the trigger for writing it somewhere
   new.** Log the *fact* and the *shape*, never the value.
8. **Prove the scrubber with fixtures, in the file, before you ship it.** Real
   token shapes with synthetic bodies, one fixture per rule, plus a
   meta-assertion that every rule matched at least one fixture
   (`brainiac/crates/brainiac-core/src/redact.rs:135` is the model). Then add the
   assertion nobody in six repos has: **that every field family is either
   scrubbed or named in an explicit allowlist.**
9. **Ask the type-over-gate question now.** The answer is below and it is not a
   newtype.
10. **Then stop.** No second key vocabulary. No per-module mini-scrubber. No
    field enumeration.

## 5 Anti-patterns

- **Writing a hook as a field enumeration.** *Failure mode:* it is correct on the
  day it is written and silently incomplete forever after, because the record
  grows and the list does not. **Measured: 5 of 14 field families visited on the
  frontend, 6 of 14 in Rust, and the two hooks do not agree on which.**
- **Scrubbing `breadcrumb.message` and not `breadcrumb.data`.** *Failure mode:*
  the SDK's own console handler writes the same string into both, so you ship a
  scrubbed and an unscrubbed copy of one line in one record. **Measured: 295
  console-bound log statements; executed — `message` masked, `data.arguments`
  intact, same text.**
- **Assuming the producers are the call sites you can grep.** *Failure mode:*
  the largest producer has no call site. `breadcrumbsIntegration` is a default
  and enables `console`, `dom`, `fetch`, `xhr` and `history`; `fetch`/`xhr`
  breadcrumbs carry **no `message` at all**, so a message-only hook has nothing
  to act on and the URL ships whole.
- **Trusting a redaction marker as evidence of redaction.** *Failure mode:* the
  output reads `Authorization: [secret] <token>` and every reviewer stops at the
  marker. **Measured in two engines: 4 of 6 auth-header forms leak, 3 of them
  with the marker printed beside the surviving token.**
- **Letting the detector write what it detected.** *Failure mode:* the branch
  that fires only when the string is dangerous is the branch that copies it into
  a log. **`sanitizeErrorForDisplay.ts:86`, one site, and it is on the path that
  renders every execution error.**
- **A second, smaller redactor next to a field the hook does not cover.**
  *Failure mode:* the author correctly noticed `extra` is unscrubbed and wrote a
  two-pattern local pass instead of fixing the hook — and the local pass has a
  bug. `useCreateTemplateSnapshot.ts:26-29` uses `(?:…)` and then references
  `$1`, so a matched key is replaced by the literal `"$1"`; executed, it also
  misses `github_token`, camelCase `apiKey`, and every bare token.
- **A transport module with no redactor at all.** *Failure mode:* nobody
  reviewed it, because a module that never called a redactor never appears in a
  search for redactors. **Measured: 0 redaction mentions in 3,243 lines of
  `mcp_server/`.**
- **Two channels for one payload, one sanitized.** *Failure mode:* the
  unsanitized one is usually the one whose purpose is to leave.
  `persistCrash` sanitizes message + stack + componentStack at
  `crashPersistence.ts:88-90`; `handleReport` at `ErrorBoundary.tsx:113-122`
  assembles the same three raw and puts them on the clipboard.
- **Reasoning about a reporter you have never seen send anything.** *Failure
  mode:* no local build has a DSN, so no local run has ever exercised the hook
  end to end, and every defect in it is invisible until a shipped installer finds
  it in the field. **Measured: 0 DSN-shaped strings in the release exe, the debug
  exe, and 1,399 dist chunks.**

## 6 Evidence

**The ONE site to copy: `src-tauri/src/main.rs:115-127`.** It is the only place
in this application where a hook treats a *structured* field as data rather than
as metadata: it deletes breadcrumb-data keys by a named policy
(`is_sensitive_field`), then scrubs the values that survive. Copy the two-step —
**delete by key, then scrub by value** — and copy the fact that the key list is a
named, reviewable function rather than an inline regex.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `src-tauri/src/main.rs:296-331` `is_sensitive_field` | a **named, reviewable key policy** instead of an inline list. It is also the only artifact in the repo that answers "what must not travel?" |
| `src-tauri/src/main.rs:277-292` `redact_url` | reduces a URL to scheme+host **and strips userinfo**, so `user:pass@host` cannot survive. The frontend gets this for free from WHATWG `URL.host`; the Rust one had to be written and was |
| `src/lib/utils/crashPersistence.ts:88-90` | sanitize **message, stack and componentStack** — three fields, one call each, before either sink. The only place in the repo that treats a stack as sensitive |
| `src/lib/utils/crashPersistence.ts:127-129` | the backend write is fire-and-forget with a `silentCatch`, so a telemetry failure can never block crash recovery |
| `src-tauri/src/cloud/sync/rows.rs:28-46` | key matching by **substring**, not equality — the difference between catching `gh_pat_value` and not |
| `src-tauri/src/commands/credentials/query_debug.rs:33-38` | a comment block that states the threat, the CVSS, and the three mitigations. Every egress redactor should carry one |
| `personas-web/src/lib/sentry-pii.ts:88-106` | the whole-record recursion with a depth cap that **redacts on overflow** rather than passing through |
| `brainiac/crates/brainiac-server/src/mcp.rs:2393` | redact **before** truncation, so a secret straddling the cut is still masked |

### The channel matrix — 22 channels, 43 fixtures, executed

Synthetic tokens of real shapes; invented bodies; no value printed. Each cell is
the transform that channel *actually* receives, applied to a carrier sentence and
tested for survival of the fixture's distinguishing body.

| # | channel | scrubbed by | CRED leak | LABELLED leak | PII leak |
| --- | --- | --- | ---: | ---: | ---: |
| F1 | `event.message` | `scrubPii` | 9/20 | 1/7 | 2/10 |
| F2 | `event.exception.values[].value` | `scrubPii` | 9/20 | 1/7 | 2/10 |
| F3 | `event.exception…stacktrace` | — | **20/20** | **7/7** | **10/10** |
| F4 | `event.breadcrumbs[].message` | `scrubPii` | 9/20 | 1/7 | 2/10 |
| **F5** | **`event.breadcrumbs[].data`** | **—** | **20/20** | **7/7** | **10/10** |
| F6 | `event.tags` | — | **20/20** | **7/7** | **10/10** |
| F7 | `event.contexts` (`react.componentStack`) | — | **20/20** | **7/7** | **10/10** |
| F8 | `event.extra` | — | **20/20** | **7/7** | **10/10** |
| F9 | `event.user.id` | — | 20/20 | 7/7 | 10/10 |
| F10 | `event.request.url` | — | **20/20** | **7/7** | **10/10** |
| F11 | standalone breadcrumb `.data` | — | **20/20** | **7/7** | **10/10** |
| **F12** | **clipboard "Copy report for support"** | **—** | **20/20** | **7/7** | **10/10** |
| F13 | `persistCrash` → localStorage + SQLite | `sanitizeCrashString` | 9/20 | 2/7 | 3/10 |
| R1–R3 | Rust `message` / `exception.value` / breadcrumb `message` | `pii::scrub` | 3/20 | **0/7** | 7/10 |
| **R4** | **Rust `breadcrumb.data` values** | **`pii::scrub` + key `retain`** | **3/20** | **0/7** | 7/10 |
| R5–R8 | Rust `tags` / `contexts` / `extra` / `request.url` | — | 20/20 | 7/7 | 10/10 |
| R9 | Rust standalone breadcrumb `.data` | `pii::scrub` | 3/20 | 0/7 | 7/10 |

Negative controls (a false positive destroys diagnostic value): `scrubPii` and
`sanitizeCrashString` **0/6**; `pii::scrub` **2/6** — it destroys a git SHA and a
SHA-256 digest via `base64_blob_re`, which is a defensible bias for a scrubber
and costs the correlation ids an on-call engineer needs.
[secret-and-pii-redaction](./secret-and-pii-redaction.md) §6 D reported 3/6 for
the same function against a different control set; both are right about the same
rule.

**Two accidents worth naming, both found by replay and neither visible by
reading:**

- **`pii::scrub` masks a POSIX home path only by arithmetic.**
  `/home/mkdol/projects/personas/src/lib/sentry` is 42 characters of
  `[A-Za-z0-9/]`, so `base64_blob_re`'s `{32,}` fires and the path becomes
  `[encrypted-blob-redacted]`. `/Users/mkdol/dev/personas/index.ts` is 30 and
  survives intact. Rust has no path rule; this is a length lottery, not a
  control.
- **`scrubPii` masks a Postgres URL password only by the email rule.**
  `postgresql://` does not match either hook's `https?://` URL rule, but
  `<password>@db.example.com` matches `EMAIL_RE`, so the output is
  `postgresql://svcuser:[email]:5432[path]`. The Rust side has no such accident
  and leaks it whole.

### The live store, measured (read-only copy, 2026-08-17, copy deleted)

- **`frontend_crashes`: 84 rows. 0 credential shapes and 0 PII shapes survive;
  117 column-values carry a redaction marker.** `persistCrash` works.
  **That table is also the receipt for §7 D3**: a marker in a persisted row is
  proof the *raw* string held the matched content — and the clipboard button
  copies the raw string.
- **117 error-bearing columns across 77 tables, 20,269 values scanned.** After
  the shipping `scrubPii`: `domain-user` 1,060 of 1,082 survive; `ipv4` 7 of 21;
  `labelled-secret` 1 of 8; everything else 0. After `pii::scrub`: `posix-home`
  184 of 268, `internal-host` 65 of 65, `email` 25 of 43, `win-user-path` 36 of
  38 survive. **Neither pass is a superset of the other, on the operator's real
  data.**
- Top locations are `persona_executions.output_data` / `executions_fts.output_data`
  (527 `DOMAIN\user`, 103 POSIX home, 32 internal hosts, 20 emails each) — the
  column `personas_result` returns verbatim.

### Convergence — five siblings, run 2026-08-17

All five checkouts exist and were opened. Nothing is reported by omission.

| clause | personas-web | brainiac | personas-cloud | vibeman | ascent | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| an error-reporter hook exists | ✔ | **✗ (SDK live, no hook)** | ✗ no SDK | stub, all calls commented out | ✗ no SDK | 1/5 |
| **the hook walks the whole record** | ✗ (named fields + a generic value walker under them) | ✗ | — | — | — | **SILENCE 0/5** |
| visits `contexts` / `extra` / `tags` / `breadcrumb.data` | ✔ all four | ✗ | — | — | — | 1/5 — **and it is our own port** |
| visits `request.url` | **✗** (deletes headers + data, keeps url) | ✗ | — | — | — | **SILENCE 0/5 — identical to ours** |
| **the reporter is consent-gated** | ✗ (analytics gated, Sentry init unconditional) | ✗ (states in writing that no consent is required) | — | env flag | env flag | **SILENCE 0/5** |
| DSN absent ⇒ loud | ✗ silent | ✗ silent (`if (dsn)` guard) | — | **✔ throws** — but guards a stub | — | 0/5 effective |
| a second egress channel for a crash, redacted | **✔ digest / errorId only — nothing to redact** | n/a | n/a | **✗ copies whole scan logs** | **✗ posts alert payloads to a webhook** | 1/3 |
| **a test asserting a field the hook does NOT visit** | ✗ | ✗ | ✗ | ✗ | ✗ | **SILENCE 0/5** |
| a test with a real-shaped credential fixture | ✗ (UUID + email only) | ✔ (storage scrubber) | ✗ | ✗ | ✔ (log scrubber) | 2/5 — **0/5 on the reporter** |

**Four results this document rests on.**

**(a) `personas-web` is a PORT of `src/lib/sentry.ts`, so the cohort is 4, not
5 — and the port is the fix.** The tell is textual, per the doctrine: identical
regex literals (`QUOTED_RE = /'[^']{1,200}'|"[^"]{1,200}"/g`,
`URL_RE = /https?:\/\/[^\s,)}\]]+/g`), the identical marker format
`` `[id:${match.slice(0,6)}]` ``, and the same comment prose in the same order —
*"Strip user fields"*, *"Scrub PII from the event message"*, *"Scrub PII from
exception values"*, *"Scrub PII from breadcrumbs attached to the event"*.
Counting it as an independent reinvention would have turned "one repo does this"
into "one repo does this **and it is our own child**". **The doctrine's inverse
case applies and is the most useful thing in this sweep: the port GAINED what
the original cannot express** — `contexts`, `extra`, `tags`, `frame.vars`,
`breadcrumb.data`, an `EMAIL_RE`, and a depth cap that redacts on overflow. The
reference implementation for §7 D1 is a superset port of the very file that needs
it, sitting in a sibling checkout on this machine. *(The previously-reported
`@dac-cloud/shared` link between `personas-cloud` and `personas-web` no longer
holds; they are independent today.)*

**(b) Nobody in the fleet walks the record. SILENCE 0/5 — and `request.url` is
missed identically by the only two hooks that exist.** Both surviving hooks
delete `request.headers` and `request.data` and then keep the URL, which is
exactly where a query-string token lives. Two independent authors, same
omission, same field. **A 5/5 silence is not permission; it is a fleet-wide blind
spot**, and §7 D1 treats it as one.

**(c) The strongest negative result: the repo with the fleet's best redactor
ships a live Sentry client with no scrubber at all.** `brainiac` initialises
Sentry at three sites (`console/instrumentation-client.ts:9`,
`sentry.server.config.ts:8`, `sentry.edge.config.ts:7`) with **zero**
`beforeSend`/`beforeBreadcrumb`/`sendDefaultPii` — while
`brainiac-core/src/redact.rs` (11 rules, three test functions, idempotence
assertions, a header naming the incident that produced it) is wired to storage
and to MCP serving and never to the reporter. **A production-grade scrubber one
import away from an unscrubbed egress boundary is the same shape as this repo's
`sentry.ts` before 2026-08-16** — which is the second time this exact defect has
been found in this fleet, in a different language, for a different reason.

**(d) 0 of 5 consent-gate the error reporter, and the one repo with a stored
consent value gates the wrong thing.** `personas-web` queues analytics behind
`COOKIE_CONSENT_KEY` (`analytics.ts:11-14,28-45`) while `initSentry()` fires
unconditionally at module import; `brainiac` writes the opposite position down
explicitly (`console/src/analytics/config.ts:10` — *"strictly necessary, so no
consent banner is required"*). Everything else is env-var gating, which is an
operator switch and not a user's. **Personas is the only repo in six with a real
user-facing telemetry opt-in — and it reaches only half of its own app** (§7 D5).

**The clause the oracle would not support.** I expected to prescribe *"gate the
reporter on consent"* as doctrine, because this leaf's own spine name says
"and opt-in". The fleet says nobody does it, and the one repo that stores a
consent answer applies it to counters rather than to crashes. So the honest
prescription is narrower and it is the one in §2: **whatever your consent posture,
the record must be safe to send** — because in four of six codebases there is no
consent to rely on, and in the fifth the reporter does not read it.

## 7 Deviations

Every entry is live on `master` @ `2a874e692`, measured against the operator's
running installation.

> **Second pass — what is upstream of all of this.** Every item below reduces to
> one structural fact, and it is not the pattern lists.
> **Both hooks in this application were written as lists of fields, and neither
> author had an inventory of the record.** That is why nine field families are
> unvisited, why the two hooks disagree about which nine, why the SDK's own
> default integrations produce more unscrubbed bytes than every call site
> combined, why a module author who noticed `extra` was uncovered wrote a
> two-pattern local scrubber instead of fixing the hook, and why an entire
> transport module has no redactor — nobody was ever handed the list of channels
> either. **The fix that closes the most entries below is one whole-record walk,
> called from both hooks, plus an inventory.**

### P0 — the frontend hook visits 5 of 14 field families; the SDK's defaults fill the other 9

| Path | What's wrong |
| --- | --- |
| `src/lib/sentry.ts:215-253` | `beforeSend` scrubs `message`, `exception.values[].value`, `breadcrumbs[].message`; deletes `user.{email,ip_address,username}` and `request.{headers,data}`. **Not `contexts`. Not `tags`. Not `extra`. Not `breadcrumbs[].data`. Not `stacktrace`. Not `request.url`. Not `user.id`.** |
| `src/lib/sentry.ts:255-260` | `beforeBreadcrumb` touches `.message` only — so a `fetch`/`xhr` breadcrumb, which has **no `.message` at all**, is passed through whole. |
| `src/lib/sentry.ts:200-261` | No `integrations` array, so `breadcrumbsIntegration({console,dom,fetch,history,xhr})` is live by default. Its console handler writes `data:{arguments}` carrying the same text as `message`. |
| `src/lib/log.ts:20-41` | Every `log.*` and every `createLogger(...)` level calls `console.*`. **295 console-bound statements across ~130 files.** |
| `@sentry/react/.../error.js:33` | `scope.setContext("react", { componentStack })` — the boundary's most detailed payload lands in the one family the hook does not visit. |

**Fix — port `personas-web/src/lib/sentry-pii.ts`'s `scrubData`/`scrubEvent`
back.** It is a superset port of this exact file (§6 a) and already recurses
`contexts`, `extra`, `tags`, `frame.vars` and `breadcrumb.data` with a
redact-on-overflow depth cap. Add what it also misses — `request.url` — and add a
key-delete pass mirroring `pii::is_sensitive_field`. **One edit covers 295
console producers, all 12 explicit `data:` writes, all 5 extras, all 25
non-literal tags, the `componentStack`, and the fetch/xhr URLs. No ratchet moves
any of them** — which is why §9 gates only the residue.

### P0 — `Authorization: Bearer <token>` survives the frontend redactor, with the redaction marker beside it

| Path | What's wrong |
| --- | --- |
| `src/lib/utils/sanitizers/maskSensitive.ts:81-82` | `INLINE_SECRET_RE` lists `authorization` and `bearer` as key names with the value group `([a-zA-Z0-9\-_.~%]+)`. On `Authorization: Bearer <token>` the leftmost alternative binds `Bearer` as the value; the token is left, and the keyword that would have caught it has been consumed. |
| — | Blast radius: `sentry.ts:39` (`scrubPii`), `crashPersistence.ts:30` (`sanitizeCrashString`), `sanitizeErrorForDisplay.ts:82`. **All four frontend redaction entry points reduce to this function.** |

Executed in two engines: `Bearer <t>`, `Authorization: Bearer <t>`,
`Authorization=Bearer <t>`, `proxy-authorization: Bearer <t>`, `Basic <t>` all
leak; `x-api-key: <t>` masks. The Rust `bearer_re` (`main.rs:190`) masks 6/6.

**Fix — one rule, ordered before `INLINE_SECRET_RE`:** port `bearer_re`
(`/\b(bearer|basic)\s+([A-Za-z0-9\-_.~+/=]+)/gi` → `$1 [secret]`). Ordering is
load-bearing: run it *before* the key/value rule, or the key/value rule will keep
eating the scheme word.

### P0 — the "we found a secret" branch writes the secret to a log

| Path | What's wrong |
| --- | --- |
| `src/lib/utils/sanitizers/sanitizeErrorForDisplay.ts:82-87` | `if (redacted !== raw) logger.error("Error message redacted for UI", { context, raw })` — the **unsanitized** string, logged precisely when the function has proved it contains sensitive content. |

Sinks reached: the console breadcrumb's unscrubbed `data.arguments` (P0 above),
and the rolling `tracing` file via `log_frontend_error` (`logging.rs:145-152`),
which `secret-and-pii-redaction` §7 P1 measured as unsanitized.

**Fix:** log the *fact* — `{ context, changed: true, length: raw.length }` — and
never the value. If a sample is genuinely needed for triage, log `redacted`.

### P1 — the MCP server has no redaction at all

| Path | What's wrong |
| --- | --- |
| `src-tauri/src/mcp_server/tools.rs:1812` `personas_result` | `SELECT id, persona_id, status, output_data, …, tool_steps` → `to_string_pretty` → the client. `tool_steps` holds 1 GitHub PAT, 7 Google-API-key-shaped strings, 1 PEM header and 17k+ PII matches today. |
| `.../tools.rs:1844-1852` `personas_knowledge_search` | three `SELECT *` forms over `execution_knowledge`. |
| `.../tools.rs:1667` | persona `system_prompt` + `structured_prompt` returned whole. |
| `src-tauri/src/mcp_server/**` | **0 matches for `redact|scrub|sanitiz` in 3,243 lines / 33 handlers / 149 `row.get` calls.** |

**Fix:** promote `query_debug.rs:79` `sanitize_query_result` to `pub(crate)` (it
is already written, already tested, already the repo's result-side answer — see
D4 for its precision problem) or apply `cloud/sync/rows.rs:72` `redact_secrets`
to every free-text value on the way out, **before truncation**, per
`brainiac/.../mcp.rs:2393`. Not applied here: this changes what a live surface
returns.

### P1 — one channel for the crash payload is sanitized and the other is the one that leaves

| Path | What's wrong |
| --- | --- |
| `src/features/shared/components/feedback/ErrorBoundary.tsx:113-122` | `handleReport()` joins raw `error.message` + `error.stack` + `errorInfo` and calls `copy(text)`. **No sanitizer.** |
| `src/lib/utils/crashPersistence.ts:88-90` | 60 lines of behaviour away, the same three values go through `sanitizeCrashString` before either sink. |

Confirmed, not re-derived — [error-boundary](./error-boundary.md) §7 D6 executed
this and found the clipboard keeps a query string the persisted row drops. **What
this path adds is the receipt**: all 84 live `frontend_crashes` rows are clean of
credential and PII shapes, and **117 of their column-values carry a redaction
marker** — each marker is proof that the raw string the clipboard button would
have copied contained the matched content.

**Fix:** one call — `sanitizeCrashString(text)` before `copy(text)`.

### P1 — `sanitize_query_result` redacts 130 of the operator's 2,570 live columns, most of them wrongly

| Path | What's wrong |
| --- | --- |
| `src-tauri/src/commands/credentials/query_debug.rs:43-73` | `SENSITIVE_COLUMNS` is **27 entries**, matched by `lower.contains(s)`. |

Run against the live schema: **130 of 2,570 columns (5.1%) would be `[REDACTED]`**,
and the term breakdown shows the substring match is the problem — `token` catches
30 columns, of which `input_tokens` / `output_tokens` are the bulk; `iv` catches
29, including `personas.sensitive` and `credential_fields.is_sensitive`; `hash`
catches 15 `content_hash`/`bundle_hash` columns; `tag` catches 12 `tags` columns;
`auth` catches `research_sources.authors` and
`persona_execution_annotations.author`; `pass` catches `pass_count` and `passed`.

**Fix:** anchor the match on token boundaries (`==` against the segment set
produced by splitting the column name on `_`), which keeps `api_key`,
`access_key`, `encrypted_data` and drops `input_tokens`, `is_sensitive`,
`content_hash`, `tags`, `authors`, `passed`. Owned by
[sql-console](./sql-console.md); recorded here because D2 proposes promoting this
function, and promoting it as-is would export the false positives.

### P2 — the Rust reporter is not consent-gated

| Path | What's wrong |
| --- | --- |
| `src-tauri/src/main.rs:27-28` | `sentry::init(sentry_options())` runs unconditionally at startup. |
| `src/main.tsx:304-307` | The frontend gates on `isTelemetryEnabled()`. |
| `src/lib/telemetryPreference.ts:13-19` | The answer is a `localStorage` key in the WebView. The Rust process has no access to it and never asks. |

So a user who declines telemetry stops the frontend client and not the backend
one; **panics, `tracing::error!` events and Rust breadcrumbs are unaffected by
the only telemetry switch the product offers.** It is inert today only because
`cfg!(debug_assertions)` and the missing DSN make it inert for everyone.

**Fix:** read the preference from `app_settings` (where the Rust side can see
it) and re-check it in `before_send`, returning `None` when telemetry is off —
`Sentry::init` happens before the DB is up, so the gate belongs in the hook, not
at init. Belongs to [first-use-consent-gate](./first-use-consent-gate.md);
offered upward because its census rule has `roots: ["src"]` and cannot see this.

### P2 — a local two-pattern redactor guards `event.extra`, and it has a `$1` bug

| Path | What's wrong |
| --- | --- |
| `src/features/templates/sub_generated/generation/useCreateTemplateSnapshot.ts:26-29` | `.replace(/"(?:api_key\|password\|secret\|token\|authorization)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')` — the group is **non-capturing**, so `$1` is emitted literally and the key name becomes `"$1"`. Executed: `{"api_key":"…"}` → `{"$1":"[redacted]"}`. |
| same | It also misses `github_token`, camelCase `apiKey`, and every bare token — verified by replay. |
| `.../useCreateTemplateSnapshot.ts:47` | Its output goes to `scope.setExtra('result_json_excerpt', excerpt)` — a field `beforeSend` does not visit, which is *why* the local pass exists. |

**Fix:** delete the local pass and call `sanitizeErrorMessage`; the field will be
covered once P0's walk lands.

### P2 — `request.url` and `user.id` survive both hooks

`sentry.ts:222-231` deletes `user.email`, `user.ip_address`, `user.username` and
`request.headers`, `request.data`. `httpContextIntegration` (a default) sets
`event.request.url = location.href`. **Both hooks in this app, and the only two
hooks in the six-repo fleet, delete the headers and keep the URL** (§6 b).

### Structural

- **Every deviation above shipped under a green `npm run check`.** No lint rule,
  test, script or CI job in this repo has any opinion about which fields a
  telemetry hook visits.
- **No test in this repo or in five siblings asserts a field the scrubber does
  not visit.** SILENCE 0/5.
- **`node scripts/secret-scan.mjs` exits 0 with `gitleaks not installed — secret
  scan SKIPPED`.** Confirmed by the §9 calibration; the D9 control has never run
  here.

## 8 Gaps — what the primitives genuinely cannot do

1. **A hook cannot enumerate a record it was not given a schema for.** Both
   `sentry::protocol::Event` and `@sentry/core`'s `Event` are third-party types
   that grow between minor versions, and neither SDK offers a "visit every string
   value" callback. A whole-record walk is therefore hand-written and can drift
   from the type. **The only durable answer is a test that fails when an
   unvisited field family appears** — §9.
2. **The largest producer has no call site.** `breadcrumbsIntegration`'s console,
   fetch, xhr, dom and history handlers construct records inside the SDK. No
   grep, lint rule or census rule in this repository can see them. They are
   reachable only through the hook or by disabling the integration.
3. **A scrubber cannot distinguish a diagnostic id from a personal one.**
   `execution_id` is a correlation key an on-call engineer needs and a per-user
   identifier a privacy review would flag. `pii::is_sensitive_field` deletes it;
   `useExecutionScope.ts:31` ships it. **Both are defensible and nobody has
   written the decision down** — the same unanswered policy question
   [secret-and-pii-redaction](./secret-and-pii-redaction.md) §8.4 names, reached
   from the other end.
4. **Redaction on this boundary is one-way and pre-emptive.** A scrubbed event
   cannot be un-scrubbed when triage needs the detail, and `pii::scrub`'s
   `base64_blob_re` already destroys git SHAs and SHA-256 digests. Every rule
   added to the hook costs correlation, and no mechanism exists to recover it.
5. **The census cannot assert an absence.** "The hook visits every field",
   "`mcp_server/` has no redactor", "no channel is unreviewed" are completeness
   conditions over a set. The replay harness in §6 is the instrument for those
   and it must be **re-run**, not ratcheted.
6. **There is no local destination, so there is no local feedback.** With no DSN
   in any local build, nobody in this repo has ever seen what an event looks like
   after `beforeSend`. Every defect in §7 P0 and P1 is invisible to every local
   workflow — the closest thing to a test is the replay in this document.

## Prefer a type over a gate — the answer for this leaf

Held against all seven qualifications. **The obvious candidate is a `Scrubbed`
newtype the sink demands. It reaches almost nothing here, and the honest answer
is that this leaf's fix is not a type at all — it is one function plus an
inventory.**

**Q1 — a required type carries only what it encodes.** `Scrubbed(String)` encodes
*"a redactor ran"*. The defect in §0.2 is a redactor that ran, produced a
`[secret]` marker, and left the token; the defect in §0.1 is a redactor that ran
on a *sibling field*. Both produce a perfectly valid `Scrubbed`. The type
distinguishes nothing this path is about.

**Q2 — requiredness is orthogonal to closedness.** Making `beforeSend`'s
parameter `Scrubbed<Event>` makes the call required. It does not close the set of
*fields* inside the event, which is the entire condition. Field coverage is not
expressible in either type system: `event.contexts` is
`Record<string, Context>` / `Contexts` — a map, and a map has no per-key type
obligation.

**Q3 — a type nobody constructs constrains nothing.** Counted: **there are
exactly two hook functions in this application** — `sentry.ts:215` and
`main.rs:113`. A newtype protecting two call sites is a comment with ceremony.

**Q4 — a type anyone can construct authenticates nothing.** And the live
analogue is already in the tree: `is_sensitive_field` is a `pub fn` returning
`bool` that any caller may ignore, and the frontend does — not by constructing a
weak value, but by never calling it.

**Q5 — withholding beats requiring — and here it hits the doctrine's fourth
wall.** The thing to withhold is *the ability to put a value in a field the hook
does not visit*. You cannot: `scope.setExtra` and `addBreadcrumb({data})` are
third-party signatures, and **the dominant producer is inside the SDK** (Gap 2).
This is "where types cannot reach" item 4, in its purest form — the value crosses
a **serialization boundary into the SDK's own envelope** before any type of ours
exists. No newtype at our boundary is upstream of that.

**Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is
*shipping an unvisited field*; the answer is *structured telemetry*, which is
correct and which `structured-logging` rightly asks for. Taking away side fields
would break the thing they are for. So the cut is at the hook, not at the call
site — which is precisely why §9 refuses to make the call sites the primary
target.

**Q7 — withholding a requirement only helps when the requirement forced the bad
value.** Nothing forces `setExtra`; authors reach for it because the SDK offers
it and because — measurably, at
`useCreateTemplateSnapshot.ts:26` — one of them noticed `extra` was uncovered and
worked around it locally. Relaxing a signature is inert.

**So the recommended order, and none of it is a type:** (1) the whole-record walk
in both hooks, ported from `personas-web/src/lib/sentry-pii.ts` and extended to
`request.url` — one edit, 295 unauthored producers plus 19 authored ones; (2) the
bearer rule in `sanitizeErrorMessage` — one regex, four channels; (3) delete the
raw log at `sanitizeErrorForDisplay.ts:86` — one line; (4) `sanitizeCrashString`
on the clipboard — one call; (5) a redactor at the MCP door; (6) the consent
re-check in the Rust `before_send`; (7) keep §9's ratchet until (1) lands, then
delete the rule.

**The one thing that *is* structural: an inventory.** Not a type — a list, in the
repo, of every channel that can send bytes off the device and which redactor
guards it. Its absence is why a 3,243-line transport module was written with no
redactor and nobody noticed: **a module that never called a redactor never
appeared in any search for redactors.**

## 9 The missing gate

### The condition, stack-free

> **A value is attached to a telemetry record through a field the record's own
> egress filter does not visit — so it leaves the device exactly as written,
> while a sibling field of the same record is scrubbed.**

The give-away is that the filter is written as a list of field names. Wherever
that is true, the fields nobody thought of are uncovered, and there is no runtime
signal: a scrubbed record and an unscrubbed one look identical from inside the
process, and the only observer is a third party.

**The proxy, for this stack:** a call to `Sentry.addBreadcrumb` carrying a
`data:` property, or to `setExtra`/`setExtras`/`setContext`, or a
`captureException`/`captureMessage` with a second-argument object — the three
JavaScript shapes that put a value somewhere other than `message` or
`exception.value`. It is a proxy, not the condition. An adopting repo must
re-derive one against its own SDK: a Python `scope.set_context`, a Go
`sentry.Scope.SetExtra`, an OTEL `span.SetAttributes`, or — if its reporter is
already a whole-record walk — nothing at all, because the condition would be
absent.

### What this gate deliberately does NOT cover, and why that is stated up front

**The dominant producer of this condition in this repository has no call site.**
`breadcrumbsIntegration` is an SDK default and converts **295 console-bound log
statements plus every `fetch`/`xhr`** into records whose `data` the hook does not
visit. No regex over `src/` can see one of them. **This rule covers 19 authored
matches against a producer population two orders of magnitude larger**, and it is
shipped anyway for one reason: per the contract's *"propose the type change as
the fix and the gate as the ratchet that holds the line until it lands"*, it
stops the authored half growing while §7 P0 is unwritten. **It must be deleted,
not baselined at 0, once the hook walks the record** — at which point every match
becomes correct by construction.

### Existing rules checked first

I read all **149** rules in `scripts/census/rules.json` before authoring and
checked these six by name:

- **`consent-bypassing-telemetry-import`** (`first-use-consent-gate.md`, 19/19,
  `roots: ["src"]`) — **the closest neighbour, and the one to worry about.** It
  matches a direct `@sentry/*` **import** in a file that does not consult
  `isTelemetryEnabled()`. Mine matches a **call expression** and does not look at
  imports. File overlap is real and expected (a file that calls Sentry imports
  Sentry); **match overlap is zero** — no import statement contains
  `addBreadcrumb({…data:`, `setExtra(`, or a two-argument `captureException`.
  The two ask different questions of the same files: *may this ship at all* vs
  *what will it contain if it does*.
- **`render-time-redaction-toggle`** (`secret-and-pii-redaction.md`, 3/5,
  `roots: ["src"]`) — a ternary whose false branch is a sanitizer. Different
  anchor entirely; **its three files (`ExecutionListRow`, `ErrorExplanationCard`,
  `ExecutionDetailContent`) share none of my twelve.**
- **`unqueryable-log-record`** (`structured-logging.md`, 67/288,
  `roots: ["src-tauri"]`) — **adjacent and important**: it prescribes moving
  values into structured fields, which on this boundary is my violating form.
  Disjoint by root and by extension; the interaction is documented in §0.1 and
  §7 P0 rather than gated, and the fix belongs to the hooks.
- **`unverified-clipboard-write`** (`copy-to-clipboard.md`, 22/32) — a clipboard
  write with no verification. Adjacent to §7 D3 but a different condition
  (*did the copy succeed* vs *what was copied*), and I deliberately did **not**
  gate the clipboard: 1 file / 1 match is not a ratchet.
- **`unresettable-error-boundary`** (`error-boundary.md`, 16/25) — a JSX
  attribute list. No shared anchor.
- **`bindingless-catch-on-io`** (`swallowed-error-telemetry.md`, 84/122) — a
  `catch` clause. My anchor is a Sentry call; a catch has none.

**Zero of the 149 existing rules ask which field of a telemetry record a value
lands in.**

### The rule

```json
{
  "id": "unscrubbed-telemetry-side-field",
  "goldenPath": "docs/concepts/golden-paths/telemetry-scrubbing.md",
  "title": "A value is attached to a Sentry record through a field this app's own beforeSend/beforeBreadcrumb never visits, so it leaves the device exactly as written while a sibling field of the same record is scrubbed",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "Sentry\\.addBreadcrumb\\(\\{(?:(?!addBreadcrumb)[\\s\\S]){0,400}?\\bdata\\s*:|\\b(?:Sentry|scope)\\.set(?:Extra|Extras|Context)\\s*\\(|Sentry\\.capture(?:Exception|Message)\\(\\s*[^,)]{1,80},\\s*\\{",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "Three JavaScript shapes that put a value on a Sentry record somewhere other than `message` or `exception.value`: a breadcrumb literal carrying `data:`, a setExtra/setExtras/setContext call, and a captureException/captureMessage whose second argument is an object (tags/extra/contexts). PROXY FOR the stack-free condition: 'a value is attached to a telemetry record through a field the record's own egress filter does not visit, so it leaves the device exactly as written while a sibling field of the same record is scrubbed.' WHY IT IS A DEFECT AND NOT A PREFERENCE, executed rather than reasoned: the shipping beforeSend (src/lib/sentry.ts:215-253) was transcribed verbatim and run over a fully populated event. It visits message, exception.values[].value and breadcrumbs[].message; it deletes user.{email,ip_address,username} and request.{headers,data}. Result per field - message mask, tags mask (short ids only), contexts LEAK (react.componentStack), extra LEAK, request.url LEAK, breadcrumbs[].data LEAK. beforeBreadcrumb (:255-260) touches .message only. So every match below lands in a field nothing scrubs. MEASURED 2026-08-17 at 2a874e692: 12 files / 19 matches, ALL NINETEEN HAND-READ. The five that carry unbounded runtime text are the ones to fix first - src/lib/silentCatch.ts:78,115,143 (data:{stack}, three doors, ~1,659 call sites behind them), src/lib/silentFailureTelemetry.ts:198 (data:summary carrying top[].lastMessage, which is THE SAME STRING silentCatch already shipped scrubbed in its own breadcrumb message minutes earlier), src/lib/personas/templates/templateOverlays.ts:57,300,313 (data:{path, error: err.message}), src/features/templates/sub_generated/generation/useCreateTemplateSnapshot.ts:47 (a model-authored JSON excerpt guarded by a local two-pattern scrubber whose non-capturing group makes its own $1 replacement emit the literal \"$1\"), src/lib/execution/middleware/analyticsMiddleware.ts:26 (execution_id - a key this application's OWN policy at src-tauri/src/main.rs:296 classifies as sensitive and DELETES from breadcrumb data on the Rust side). The remainder carry ids, categories and counts: roadmapItems.ts:40,53, useTranslatedError.ts:44, errorRegistry.ts:696, systemStore.ts:153, storeTypes.ts:118, useOnboardingState.ts:147, useAutoUpdater.ts:127, silentFailureTelemetry.ts:164, useCreateTemplateSnapshot.ts:48. Precision on the STATED condition is 19/19 by construction, verified by executing the hook; the rule asserts coverage, not harm, and its title says so. KNOWN AND DELIBERATE LIMIT: the DOMINANT producer of this condition has no call site at all and this rule cannot see it. @sentry/browser's breadcrumbsIntegration is a DEFAULT integration (sdk.js getDefaultIntegrations) with console/dom/fetch/xhr/history all true, and sentry.ts passes no integrations array; its console handler emits data:{arguments} carrying THE SAME TEXT as message, so all 295 console-bound log statements in this app (79 direct console.* in 32 files plus 216 log.*/logger.* in 103 files, all funnelled through src/lib/log.ts:20-41) produce one scrubbed and one unscrubbed copy of every line, and its fetch/xhr handlers emit data:{method,url,status_code} with NO .message for the hook to act on. LEGAL FIX: make beforeSend walk the whole record. personas-web/src/lib/sentry-pii.ts:88-195 already does exactly this and is a PORT OF THIS REPO'S OWN sentry.ts (identical regex literals, identical comment prose) that gained contexts/extra/tags/frame.vars/breadcrumb.data and a redact-on-overflow depth cap - port it back and add request.url, which both hooks in the six-repo fleet miss identically. DO NOT silence a match by moving the value into the breadcrumb message, by renaming the local variable, or by hoisting the object literal into a const - the first collides with structured-logging.md's unqueryable-log-record prescription and the other two preserve the defect exactly. END OF LIFE: once beforeSend walks the record every match here becomes correct by construction; the runner then fails structurally on zero matches BY DESIGN - DELETE this rule at that point, do not baseline it at 0.",
    "$measured": "2026-08-17 @ 2a874e692 — 4,829 files walked; validated standalone in a scratch registry unique to this composer (rules-telemetry-scrubbing-probe.json), fault-injected 8 ways plus one real violation appended to src/lib/log.ts (12/19 -> 13/20, exit 1, reverted clean), then re-extracted from this finished document and re-run through the real runner: identical. 1.096 s for rule and control together."
  },
  "exclude": [
    {
      "path": "src/lib/sentry.ts",
      "reason": "the hook's own module — its scope.setExtras at :168 carries the session-summary counters beforeSend was written to allow, and a rule that reports the file it tells you to fix is a to-do list rather than a ratchet"
    }
  ],
  "baseline": { "files": 12, "matches": 19 },
  "floor": 3000
}
```

### The positive control (evidence, NOT a gate — carries no baseline)

```json
{
  "id": "unscrubbed-telemetry-side-field-positive-control",
  "goldenPath": "docs/concepts/golden-paths/telemetry-scrubbing.md",
  "title": "POSITIVE CONTROL — not a gate. The same Sentry APIs writing into the fields beforeSend DOES visit: the compliant form the rule must never report.",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "Sentry\\.addBreadcrumb\\(\\{(?:(?!addBreadcrumb)(?!\\bdata\\s*:)[\\s\\S]){0,400}?\\}\\s*\\)|Sentry\\.capture(?:Exception|Message)\\(\\s*[^,){]{1,120}\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "NOT A GATE — the shape-discrimination control for unscrubbed-telemetry-side-field, and it carries no baseline by design. Same root, same extensions, same walk, SAME SENTRY APIS. The only difference is which field the value lands in: the rule requires a `data:` property on the breadcrumb literal or a second-argument object on the capture; the control requires their absence, i.e. a message-only breadcrumb (-> breadcrumbs[].message, scrubbed at sentry.ts:245-251 AND again at :255-260) or a single-argument capture (-> event.message / exception.values[].value, scrubbed at :233 and :237-243). THE TWO POPULATIONS ARE MUTUALLY EXCLUSIVE BY CONSTRUCTION AND PARTITION THE ANCHOR WITH NO REMAINDER: measured 2026-08-17 at 2a874e692, rule 12 files / 19 matches and control 11 files / 22 matches, and 19 + 22 = 41 = the anchor's full raw match population (27 Sentry.addBreadcrumb calls = 12 with data + 15 without; 4 setExtra/setExtras/setContext outside the excluded hook module; 3 two-argument captures; 7 single-argument captures). FIVE FILES APPEAR IN BOTH LISTS AND THAT IS THE POINT — src/stores/storeTypes.ts:118 (setExtra, violating) sits one line above :119 (single-arg captureException, compliant), and useCreateTemplateSnapshot.ts:47,48 sit two lines above :49 — so the discrimination is positional and API-shaped, not file-level, which no file-level heuristic could reproduce. Control files: useAutoUpdater.ts:50,57,84,117 - tourSlice.ts:1110,1119,1173,1195 - useOnboardingState.ts:119,130,142 - roadmapItems.ts:69,137 - useByomSettings.ts:167,185 - main.tsx:115,136 - useCreateTemplateSnapshot.ts:49 - tauriInvoke.ts:471 - labSlice.ts:91 - researchLabSlice.ts:29 - storeTypes.ts:119. KNOWN RECALL LIMIT OF THE CONTROL (not of the rule): three compliant multi-line Sentry.captureMessage calls whose first argument spans lines are matched by neither pattern - alertSlice.ts:124, tourSlice.ts:1124, tourSlice.ts:1200 - so the true compliant population is 25, not 22. The bound `[^,){]{1,120}` was preferred to a multi-line alternative because the obvious comment-tolerant construction is a nested quantifier the doctrine forbids. If this control's count COLLAPSES, the walk or the anchors broke rather than the codebase being fixed; it is expected to RISE as telemetry spreads, which is exactly why it must never be baselined.",
    "$measured": "2026-08-17 @ 2a874e692 — 11 files / 22 matches via the real runner; 19 + 22 = 41 partitions the anchor exactly."
  },
  "floor": 3000
}
```

### Verification of this gate's own preconditions

- **`floor: 3000`** against **4,829** files actually walked under `src`, matching
  the `raw-select` / `render-time-redaction-toggle` / `unverified-clipboard-write`
  precedent for this root — rules over one root must not hold different opinions
  about what "the tree is intact" means.
- **Backtracking checked, not assumed.** The bounded lazy segments are
  `(?:(?!literal)[\s\S]){0,400}?` — a zero-width lookahead followed by exactly
  one character, so the inner group is fixed-width and the construction is
  linear. No nested quantifier, no variable-length lookbehind. **Real-runner wall
  time over 4,829 files: 1.096 s for rule and control together.**
- **Portability warning.** The `(?!…)` lookaheads mean this pattern is **not**
  accepted verbatim by the Rust `regex` crate, unlike
  `render-time-redaction-toggle`. A Rust-side checker would need the unguarded
  `[\s\S]{0,400}?` form; measured, that variant produces the same 12/19 today
  (the guard exists to stop a future `addBreadcrumb` without `data` reaching
  forward into a later call, not to fix a current miscount).
- **Known recall limits, both currently empty and both stated so they are not
  discovered as surprises:** an optional-chained call (`Sentry?.setExtra`) is
  invisible — measured, **0 exist** in `src/` today (the one `?.` hit,
  `CredentialScopeSection.tsx:64`, is an unrelated index access). An
  `addBreadcrumb` whose object literal exceeds 400 characters before its `data:`
  key would be missed — the largest current call is well under.
- **Fault-injected nine ways, every one fires:**

| fault induced | exit | what the runner said |
| --- | ---: | --- |
| pattern replaced with a token matching nothing | **1** | `FAIL … files 0 (base 12) matches 0 (base 19)` |
| `floor` raised to 99999 | **1** | `FAIL … walked 4829, floor 99999` |
| `roots` renamed `src` → `app` | **1** | `FAIL … walked 0` |
| an `exclude` entry pointed at a deleted file | **1** | stale-exemption failure |
| an `exclude` entry with no `reason` | **1** | `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| baseline pinned 1 low (a violation lands) | **1** | `matches 19 (base 18)` |
| baseline pinned high (silent drop) | **1** | `matches 19 (base 40)` |
| a `baseline` added to the positive control | **1** | `a positive control must NOT carry a baseline — it exists to fail` |
| **a real violation (`Sentry.setExtra("probe", s)`) appended to `src/lib/log.ts`** | **1** | `FAIL … files 13 (base 12) matches 20 (base 19)` |

  The last row is the one that matters: an actual violating statement written
  into a real source file moved the count by exactly 1 and failed the gate;
  reverting returned the tree to exit 0 with no residue (`git status --porcelain
  src/lib/log.ts` empty).
- **Re-extraction check performed.** Both blocks above were pasted back out of
  this finished document into a scratch registry unique to this composer
  (`rules-telemetry-scrubbing-probe.json`) and re-run through the real runner —
  `node scripts/census/run-census.mjs --rules <scratch>/…` — not a
  re-implementation. Identical: **12 files / 19 matches / 4,829 walked / floor
  3000**, and **11 files / 22 matches**, no baseline, no structural problems.
- Do **not** run `npm run census -- --update` against a registry containing the
  positive control; `updateBaselines` dereferences `baseline.files`
  unconditionally.
- **Where it runs:** `npm run census` / `npm run census:check` and the
  `golden-path-census` pre-push job. **Not `ci.yml`**, which is red on 10
  pre-existing failures, so a gate that only runs there runs nowhere.

### The instrument the census cannot be — and this leaf needs it more than the rule

The census ratchets a condition present in a statement. **This leaf's three
largest findings are all absences**: a field family nobody visits, a module with
no redactor, and a scrubber rule that does not exist. None is countable. Specify
them as tests, not as gates:

1. **A field-coverage assertion** (`src/lib/__tests__/sentry-egress.test.ts`).
   Construct one event populating **every** field family — `message`,
   `exception.values[].value`, `.stacktrace.frames[].vars`, `breadcrumbs[]`
   `message` and `data`, `tags`, `contexts`, `extra`, `user`, `request.url`,
   `transaction`, `server_name` — each carrying a distinct synthetic marker. Run
   the **real exported** `beforeSend`. Assert every marker is either gone or its
   field is named in an explicit `DELIBERATELY_UNSCRUBBED` array **with a prose
   reason**. It fails the day the SDK adds a field and the day someone enables an
   integration. **No repo in six has this** (§6, SILENCE 0/5), and it is the only
   instrument that would have caught §0.1.
   *Precondition, so it cannot silently measure nothing:* assert the fixture
   populates ≥ 12 families and that at least one marker was removed — a test that
   scrubs nothing and asserts nothing passes forever.
2. **A credential-fixture assertion for `scrubPii` / `sanitizeErrorMessage`**, in
   the `brainiac/crates/brainiac-core/src/redact.rs:135` shape: one real-shaped
   token per rule, **plus a meta-assertion that every rule matched at least one
   fixture**. Include the six auth-header forms from §0.2 — that is the test
   that turns a one-line regex fix into a permanent one.
3. **A channel inventory** (`docs/concepts/egress-channels.md` or a JSON
   manifest) listing every way this process can send bytes off the device and
   which redactor guards each, with a check script asserting the named redactor
   is still imported by the named module. This is the `check-csp-hosts.mjs`
   shape, and it is the only thing that would have surfaced a 3,243-line
   transport module with no redactor.

### Gates I rejected, with numbers

| candidate | violating | compliant control | why rejected |
| --- | ---: | ---: | --- |
| **`setTag` with a non-literal value** | 6 files / 25 | 2 files / 5 (literal-valued) | **14 of the 25 are in `sentry.ts` itself** and carry section/tab/action names — hard-coded product vocabulary with nothing personal in it. A gate whose majority is `setTag('feature.section', section)` fires on correct content, which the contract calls worse than no gate. The genuinely bad subset (`execution_id`, `persona_id`) is 6 matches and is better expressed as §7 P0's key-delete pass. |
| **the `console.*` / `log.*` population** | 130 files / 295 | — | The largest number in the document and an unusable gate: `log.*` is the repo's sanctioned logger and `console.*` is what it calls. The rule would fire on 295 correct call sites to express a defect that lives entirely in `beforeBreadcrumb`. **One edit corrects all 295 and no ratchet would move a single one** — the contract's fifth failure mode. Carried as §7 P0. |
| **a raw stack or `componentStack` handed to a clipboard/export sink** | **1 file / 1** (`ErrorBoundary.tsx:113`) | — | The right *condition* and an unshippable *gate*: only 14 files in `src/` touch `.stack` at all and exactly one hands it to an egress sink. A one-match ratchet cannot distinguish a fix from a refactor. Carried as §7 D3, where [error-boundary](./error-boundary.md) already owns it. |
| **a free-text DB column named in a `SELECT` inside an off-device transport module** | **1 file / 3** (`mcp_server/tools.rs`) | 45 files / 92 (the same columns in ordinary repo code, correctly) | The honest expression of §7 D2, and it fails on population: the whole condition lives in one file, so the count would move on any edit to that file and on nothing else. The condition is really *"this module imports no redactor"* — a **file-level absence**, which the census cannot express by construction. Carried as §7 D2 and as instrument 3 above. |
| **a mask-marker literal in a `replace` call** | — | — | Not re-measured: [secret-and-pii-redaction](./secret-and-pii-redaction.md) §9 rejected this exact candidate with numbers (its matches are the sanctioned redactors themselves). Recorded so a third composer does not spend the measurement again. |

**The general limit worth restating, and it is sharper here than anywhere else in
the corpus: the census can only see code someone in this repository wrote.** The
dominant producer of this leaf's condition is a default integration inside a
third-party SDK, activated by *not* passing an option. There is no statement to
match, no import to key on, and no file to exclude. Only running the thing finds
it — which is how every headline in this document was found.

## 12 Corrections to the brief

The brief primed eight leads and two labels. **Six leads survive, one is an
important half-truth, one is owned elsewhere, and both labels fail.**

**12.1 — `sides: "server"` is wrong, and this is the fourth spine leaf to be
corrected on `sides`.** The doctrine records three leaves whose `sides: "client"`
was contradicted by their own measurement, each finding the headline defect on
the server. **This one inverts that.** The two hooks are one per side, but the
measured surface is not symmetric: the frontend hook visits **5 of 14** field
families and the Rust hook **6 of 14**, and the Rust hook is **strictly better on
the field that matters most** (`breadcrumb.data`, which it deletes-by-key and
scrubs while the frontend ignores it entirely). The producer counts follow: 89
Sentry API occurrences across 21 TypeScript files, versus **10 `sentry::`
mentions in 963 `.rs` files, of which exactly one is a telemetry write**
(`core/src/trace.rs:291`) and **zero** are `set_tag`/`set_extra`/`set_context`.
The census rule that survived has `roots: ["src"]`. The spine's own
`twoSided: true` is the accurate half; `sides` should read `both`, and if forced
to one, `client`.

**12.2 — `convergence: converged` FAILS. This is the twelfth tested label and the
twelfth failure, and it fails in two of the known ways at once — plus a
sharpening.**
- **Failure mode "the fleet converged on not having the problem."** Three of five
  siblings have no error-reporter surface at all (`personas-cloud`, `ascent`, and
  `vibeman` whose provider is a class with every SDK call commented out), so
  their agreement is with an empty set.
- **Failure mode "the fleet converged on the disease."** Of the two that do have
  a live Sentry client, one — `brainiac` — has **no hook whatsoever**, while
  holding the fleet's best redactor two crates away. And the two hooks that exist
  in six codebases **both** delete `request.headers` and **both** keep
  `request.url`. Perfect agreement on an omission.
- **The sharpening, which is new: the single apparent corroborator is our own
  child, and it is ahead of us.** `personas-web/src/lib/sentry-pii.ts` is a port
  of `src/lib/sentry.ts` — identical regex literals, identical marker format,
  identical comment prose in the same order. Counted naively that is "1 of 5
  repos scrubs `contexts`/`extra`/`tags`/`breadcrumb.data`"; counted honestly the
  independent cohort is **4** and the answer is **0 of 4**. The doctrine's
  inverse rule then pays for itself: **a port that gained something the original
  cannot express is strong evidence for the missing thing**, and §7 P0's fix is
  simply to take our own code back.

**12.3 — "`event.contexts.react.componentStack` is unscrubbed by `beforeSend`" —
CONFIRMED, and it is one of nine, not one.** Verified at the source
(`@sentry/react/.../error.js:33` `scope.setContext("react", { componentStack })`)
and by executing the hook. But framing it as *the* gap understates the shape of
the defect: `contexts` is unvisited, and so are `tags`, `extra`,
`breadcrumbs[].data`, `stacktrace`, `request.url`, `user.id`, `transaction` and
`server_name`. **The bug is not a missing field; it is that the hook is a field
list.** The same read also turned up a second path for the component stack that
the brief did not name: `captureReactException` sets
`errorBoundaryError.stack = componentStack` and links it as `error.cause`, so
`linkedErrors` puts a second exception in `event.exception.values[]` whose
*message* is scrubbed and whose *stacktrace* is not.

**12.4 — "the Copy-report button puts raw `message` + `stack` + `componentStack`
on the clipboard while `persistCrash` sanitizes the identical payload" —
CONFIRMED, and already published.** [error-boundary](./error-boundary.md) §7 D6
executed this on 2026-08-16. Rather than re-derive it I measured the thing that
document could not: **all 84 live `frontend_crashes` rows are clean of every
credential and PII shape, and 117 of their column-values carry a redaction
marker.** Each marker is a receipt proving the raw string held the matched
content — so the clipboard button has been handing out un-redacted copies of
content the sibling call demonstrably found and removed, 117 times over.

**12.5 — "`query_debug.rs:79` redacts 21 sensitive columns; `execute_db_query`
returns rows verbatim" — the asymmetry is CONFIRMED and is already
[sql-console](./sql-console.md)'s, but the number is wrong in both places.**
`SENSITIVE_COLUMNS` (`query_debug.rs:43-73`) has **27** entries, not 21;
`sql-console.md` states 21 in at least four places and the brief inherited it.
And the 27 are matched by `lower.contains(s)`, which on the operator's live
schema would `[REDACTED]` **130 of 2,570 columns (5.1%)** — including 30 columns
via `token` (mostly `input_tokens`/`output_tokens`), 29 via `iv` (including
`personas.sensitive` and `credential_fields.is_sensitive`), 15 via `hash`, 12 via
`tag`, and `research_sources.authors` via `auth`. Both corrections matter beyond
bookkeeping, because §7 D2 proposes promoting this function to the MCP door and
promoting it as written would export the false positives. Recorded as §7 D4.

**12.6 — "only 10.6% of catch sites produce a Sentry event, and 760 try/catch
bodies reach no error door at all; a scrubber that never runs is not a control" —
CONFIRMED as stated and it cuts the other way too.** It is the correct caution
against overstating this leaf, and I have applied it: the frontend Sentry client
on this machine has **no DSN in any local build** and the running process is a
**debug** build, so the Rust client is `None` by `cfg!(debug_assertions)`.
**Neither hook has ever sent anything from this checkout.** But the inverse is the
more useful reading and it is why §0.2 existed undetected: *a leak that never
ships is also never observed.* The absence of a local destination is precisely
what let a redactor print `[secret]` beside an unmasked bearer token without
anyone noticing.

**12.7 — the leaf is named "Telemetry scrubbing **and opt-in**", and the opt-in
half is already owned.** [first-use-consent-gate](./first-use-consent-gate.md)
was composed on 2026-08-16 and owns where the answer lives, what absent means,
and the `consent-bypassing-telemetry-import` rule (19/19). I did not re-derive
it. One finding is offered upward instead: **its rule has `roots: ["src"]` and
therefore cannot see that the Rust reporter is not consent-gated at all** —
`main.rs:27-28` initialises unconditionally and `isTelemetryEnabled()` is a
WebView `localStorage` key the Rust process cannot read (§7 D5). A user who
declines telemetry silences half the application.

**Two corrections to my own work, both earned by measurement.**

**(a) My first fault-injection test proved nothing and reported success.** I
appended `(globalThis as any).Sentry?.setExtra("probe","x")` to a real file to
verify the rule catches a new violation. The count did not move, exit stayed 0,
and for a moment that read as "the rule is stable". It was my *probe* that was
wrong — optional chaining (`Sentry?.setExtra`) does not match `Sentry\.set…`.
Rewritten as a plain call, the count went 12/19 → 13/20 and the gate failed
correctly. **An instrument that fails to fire looks exactly like a codebase that
is clean**, which is the failure mode this whole section of the doctrine exists
for, committed while testing for it. The near-miss is now published as a stated
recall limit (0 optional-chained Sentry calls exist today) rather than as a
silent assumption.

**(b) I expected the headline to be "the scrubber misses shapes." It is not.**
The shapes are largely fixed — `scrubPii` masks 11 of 20 credential shapes and 8
of 10 PII shapes, which is a different repository from the 2/26 of two days ago.
The finding is that **the record has fourteen field families and the hook visits
five**, and that the biggest producer of the other nine is an SDK default with no
call site anywhere in this repository. A composer who had replayed only the
*redactors* — which is what the brief's leads pointed at, and what the adjacent
path had already done well — would have written "the fix held, minor gaps remain"
and missed the boundary entirely. **The redactor was the wrong unit of analysis;
the record was the right one.**

**And one correction offered upward to the corpus.**
[secret-and-pii-redaction](./secret-and-pii-redaction.md) §3 established that
`error!`-level structured fields land in `event.tags` / `event.contexts`
unscrubbed on the Rust side, and concluded that following
[structured-logging](./structured-logging.md)'s prescription moves data from a
redacted field into two unredacted ones. **That is true on the frontend as well,
by a completely different mechanism, and neither path could have predicted it
from the other:** here the migration is not authored at all — the SDK's default
`breadcrumbsIntegration` copies every `console.*` line into `data.arguments`
beside the `message` it scrubs. **Two individually-correct golden paths composed
into a defect on one runtime, and the same defect appeared on the other runtime
with no author involved.** The general lesson for §6 of the doctrine: checking
your prescription against your neighbours' is necessary and not sufficient — you
must also check it against the defaults of every library in the path.
