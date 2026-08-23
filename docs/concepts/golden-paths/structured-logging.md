# Golden path — Structured logging

> Situation node: `backend-runtime/backend-observability/structured-logging` · [situation spine](../situation-spine.md)
> Recurrence **105** · dimensions: **code-quality · security · resilience · cost**.
> Composed 2026-08-14 against `master`. Sweep: **963 `.rs` files** walked; **2,653 `tracing` macro
> calls** parsed by a string/comment-aware argument splitter and classified by shape; **70
> print-family calls** classified by compilation context; **five separate redaction layers** read in
> full; the subscriber, the Sentry client options and the `EnvFilter` default; and the sibling
> `ExecutionLogger`. Corpus counts cite [`shared-facts.json`](../shared-facts.json).
>
> **A large part of this path is measured against RUNNING SOFTWARE.** The operator's real log
> directory (`%APPDATA%/com.personas.desktop/logs/`) was read in full — **2,999 files, 410.5 MB** —
> because the question "is a secret in the log?" cannot be answered from source. It is. Per the
> [model-effort guide](../../development/model-effort-guide.md), *a gate that asserts data is not a
> gate on behaviour*, so the behaviour was observed. **No secret value appears anywhere in this
> document**; every hit is described by site, length and character class only.
>
> A **convergence sweep** ran against `brainiac` (Rust · 148 `.rs`), `personas-cloud` (TS/Py · 48) and
> `personas-web` (Next.js · 1,054). It **confirmed** the central prescription and **inverted the
> brief's priority** (§6).
>
> **The Deviations section is a fix backlog.**

> ## Four of this leaf's stated premises need correcting, and the corrections are the finding
>
> **(1) The `tracing` surface is not where the secrets are.** Six days of the rolling
> `personas.*.log` files were scanned for fifteen credential shapes. **Zero hits, on every pattern.**
> The `tracing` pipeline is clean.
>
> **(2) The secrets are in a second logger nobody documented.** `ExecutionLogger`
> (`engine/src/logger.rs`) writes one file per execution, is not routed through `tracing`, has no
> level, no fields, and **no retention**. It holds **2,991 files / 406.6 MB / 130 days** of history
> next to the six bounded 4 MB rolling files. A scan of it found **real, live credentials**: GitHub
> classic PATs, a Google API key, a GCP service-account private key body, and a Supabase JWT (§7 P0).
>
> **(3) `sanitize_error_message` is 3 of *21* variants, not 22 — and the variant count is the least
> of it.** It is called from exactly one place, `impl Serialize for AppError`
> (`core/src/error.rs:175`), which is the **IPC boundary to the frontend**. Logging uses `Display`,
> not `Serialize`. **No error reaching any log file is sanitized, for any of the 21 variants.**
>
> **(4) The leaf's central question is already mostly won.** **2,118 of 2,653** `tracing` calls
> (**79.8 %**) carry structured fields, and `dbg!` is **extinct** (0 sites). The prescription below is
> correct and the deviation is a real 288-site minority — but the honest headline is that this repo
> logs well and *stores* catastrophically.

## 1 Trigger

- "Add a log line here so we can see what happened"
- "Should this be `info!` or `warn!`?" / "is this worth logging?"
- "I need to find every time X happened for persona Y" / "can we filter the logs by execution id?"
- "Just print it for now" / "I'll add a `println!` to debug this"
- "Is it safe to log this?" / "does this response contain the API key?"
- "Why is there nothing in the log about this?" / "how do I turn on debug logging?"

If you are about to type `tracing::info!(`, `println!(`, `logger.log(`, `format!` inside a log macro,
or you are writing anything to a file under `logs/` — you are in this situation.

**Not this path:** *whether a caught error reaches any telemetry door at all* is
[swallowed-error-telemetry](./swallowed-error-telemetry.md) (client) — this path starts once you have
decided to make a record. *How long a query took* is
[query-latency-instrumentation](./query-latency-instrumentation.md). *Which `AppError` variant to
raise* is [typed-error-contract](./typed-error-contract.md). **This path owns the record itself**:
its level, its shape, and whether it is safe to keep.

## 2 The one way

**Emit every record through `tracing`, with a level chosen from the reader it is for, a message that
is a compile-time constant, and every variable attached as a named field — and sanitize any string
you did not author before it reaches a durable sink.** Write
`tracing::warn!(persona_id = %id, error = %e, "Failed to decrypt model profile")`, never
`tracing::warn!("Failed to decrypt model profile for {}: {}", id, e)`. The two render almost
identically on a terminal and are not remotely the same artefact: the first is one event that
occurred N times with N field-sets, the second is N distinct strings that no filter can group and no
query can select on. Use `%` for `Display` and `?` for `Debug`; name the field for the *thing*
(`persona_id`, `execution_id`, `error`) and never for the *instance*. Pick the level by asking who
needs to read it — `error!` is "a human must act", `warn!` is "degraded but handled", `info!` is the
lifecycle spine, `debug!` is for someone already debugging — and remember that in this app the level
is not cosmetic: `ERROR` becomes a Sentry **event** and `WARN` becomes a Sentry **breadcrumb** that
is uploaded only if an unrelated `ERROR` fires later in the same session
(`logging.rs:76-80`), so an over-used `warn!` costs a bounded, shared buffer that something else
needed. Then, before any string you did not write yourself — a subprocess's stdout, an HTTP body, an
error from a provider, a file the agent read — is written anywhere that outlives the process, pass it
through `sanitize_secrets` (`core/src/utils/sanitization.rs:22`), whose own doc comment says it is
for exactly this. **And then stop:** no `println!`, no second logging system, no per-module log
format, no interpolating a value into a message you could have named.

**Know what you have NOT bought.** A `tracing` record is not durable and not private. It goes to
stdout (dies with the process), to a daily file kept **7 files deep** (`logging.rs:40`), and to
Sentry only at `ERROR`. It is written **verbatim, unsanitized** — none of this repo's five redaction
layers sits on the file path (§7 P1). A field is queryable in principle and this app ships no query
tool, so "queryable" today means "greppable by a human who knows the field name".

### Which clauses are physics, and which are this house

Measured 2026-08-14 against three sibling codebases with no shared logging document.

| Clause | Warrant | Evidence |
|---|---|---|
| **Variables go in fields, not in the message** | **PHYSICS — independently reinvented, and the sibling is stricter than we are** | `brainiac` is **114 of 123** tracing calls carrying structured fields (**92.7 %**), with only **2** interpolated-only calls in the whole repo. Personas is 2,118/2,653 (**79.8 %**) with 288 interpolated-only. Same language, same crate, no shared doc, same answer — and we are 13 points behind |
| **Redact before the record becomes durable** | **PHYSICS — reinvented in all three siblings, and `brainiac` had this exact incident and fixed it** | `brainiac/crates/brainiac-core/src/redact.rs` — a dedicated module whose header records a real UAT breach (finding **H4, 2026-07-13**): *"a credential pasted into a session became a team-visible memory body and was handed, verbatim, to any agent whose RLS admitted it."* Applied at the **LLM-session boundary** (`pipeline/extract.rs:203`, `server/mcp.rs:2393`) with a test asserting *"the pasted credential must NOT survive into the excerpt"* (`tests/mcp_pg.rs:805`). `personas-cloud`: `sanitizeEnvVars` (`worker/validation.ts:73`), `sanitizePayloadString` (`shared/prompt.ts:104`), `[REDACTED]` on credential fields at the HTTP boundary (`orchestrator/httpApi.ts:678`). `personas-web`: `redactUrl` (`lib/sentry-pii.ts:53`) at telemetry egress |
| **Recall-biased redaction — over-mask rather than miss** | **CONVERGENT once, stated as doctrine** | `brainiac/redact.rs:10-15`: *"deliberately **recall-biased**: a false redaction (masking a non-secret) is cheap; a missed credential is a breach… it is the difference between 'verbatim by default' and 'scrubbed by default', which is the finding."* Personas' `sanitize_secrets` is built the same way; nobody wrote the rationale down here |
| **One chokepoint owns the format** | **PHYSICS in function, house in form** | Everybody built one, nobody built the same one: a `tracing_subscriber` registry (Personas, `brainiac`), an injected pino logger (`personas-cloud`, 194 `logger.<level>(` calls across 18 files, zero raw prints in service code) |
| **A lint/CI gate on log shape** | **LOCAL CALIBRATION — zero reinventions, and it is not even present here** | No sibling gates log shape. Neither does Personas: **no `[lints]` table in any of the 5 `Cargo.toml`, no `clippy.toml`, no `#![deny]` anywhere** (verified). §9 proposes the first one and marks it as manifestation |
| **A second, unstructured log beside the structured one** | **SHARED TRAP, not a licence** | `brainiac` has **112 `eprintln!`** and Personas has `ExecutionLogger`. Convergence here is two codebases making the same mistake. **Do not read this row as permission** |

**Convergence contradicted the brief's priority and I am following the evidence.** The brief framed
structured-vs-interpolated as "the leaf's central question". It is the leaf's central *mechanic*, and
`brainiac` confirms it is physics — but `brainiac` also shows what a mature answer looks like, and
the thing it has that we do not is **a redaction module wired to the LLM-session boundary, with a
test**. That is the gap that is currently leaking. The interpolation gap costs queryability; the
redaction gap costs credentials.

## 3 Mandated primitives

**Exist today — use them:**

- **`tracing::{error,warn,info,debug}!`** with fields first, message last. **2,118 compliant call
  sites.** Prefer the `tracing::` prefix — 2,610 of 2,653 calls use it, so a bare `warn!` reads as an
  import you have to go check.
- **`src-tauri/db/src/backup.rs:107-112` — copy this one.** Three fields (`from`, `to`, `error`), all
  `%`-Display, a constant message that states the consequence
  (`"Pre-migration DB backup failed (non-fatal) — continuing boot without a safety copy"`). Its
  siblings at `:131-135` and `:139-142` show the same shape at `warn!` and `info!`.
- **`core/src/utils/sanitization.rs:22` `sanitize_secrets(&str) -> String`** — the general-purpose
  masker. Handles `Authorization: Bearer/Basic`, ~17 key names in `key: value` / `"key":"value"`
  form, prefixed tokens (`ghp_`/`gho_`/`AKIA`/`sk_live_`/`xox[baprs]-`), and bare bearer tokens. Its
  own doc comment: *"Used before storing untrusted API responses or error messages in plaintext
  columns."* **8+ call sites, every one of them a database write.** This is the primitive the
  execution log needs and does not call.
- **`core/src/crypto.rs:250-260` `SecureString`** — `Debug` and `Display` both render `[REDACTED]`,
  and it deliberately does **not** implement `Serialize` (`:268-270`). `warn!(token = %secret)` is
  physically incapable of leaking it. **The type-over-gate answer, already built.** 64 mentions
  across 5 files.
- **`engine/src/ambient_context.rs:965` `redact_clipboard_content`** / **`:1046`
  `redact_window_title`** — typed masking (`[REDACTED:jwt]`, `[REDACTED:github-token]`, `[email]`),
  idempotent, unit-tested. **Called from one file: their own.**
- **`src/main.rs:156+` `pii::scrub` / `pii::is_sensitive_field`** — the Sentry egress door, wired
  into `before_send` **and** `before_breadcrumb`, scrubbing messages, exception values, breadcrumb
  messages and breadcrumb data values, plus `send_default_pii: false` and a `dsn: None` under
  `debug_assertions`. **The best-defended boundary in the app.**
- **`src-tauri/src/logging.rs:55-90`** — the subscriber. Default filter `info,personas_desktop=debug`
  (see §7 P2 — the debug half is a no-op); stdout + a daily rolling file capped at **7 files**
  (`:40`); `sentry_tracing` maps `WARN`→breadcrumb, `ERROR`→event (`:76-80`). **No `debug_assertions`
  gate: this runs in release exactly as in dev.**
- **`%APPDATA%/com.personas.desktop/logs/personas.<date>.log`** — the ground truth. Six days of it
  answered four questions this document could not have answered from source.

**Do not exist — this path names them:**

- **A sanitizing sink.** Nothing between "a string the app did not author" and "a file on disk".
  `sanitize_secrets` exists and is wired only to DB writes. See *Prefer a type over a gate*.
- **Any retention on the execution log.** `prune_orphan_personas_logs` (`logging.rs:194`) matches
  `personas.*.log` only, and its docstring explicitly lists execution logs among what it *preserves*.
- **Runtime log-level control.** `EnvFilter::try_from_default_env()` reads `RUST_LOG` **once, at
  process start**. There is **no `tracing_subscriber::reload` layer anywhere in the tree** (0 hits),
  so a user hitting a bug cannot raise the level without relaunching with an env var — and no UI
  offers to.
- **Any test asserting a secret does not survive into a log.** `brainiac` has one (`mcp_pg.rs:805`).

## 4 Steps

1. **Decide the level from the reader, and respect what it costs.** `error!` = a human must act
   (Sentry event). `warn!` = degraded but handled (Sentry breadcrumb, shared bounded buffer).
   `info!` = the lifecycle spine. `debug!` = for someone already debugging. Check §7 P2 before
   reaching for `debug!` — it is currently silenced.
2. **Write the message as a constant.** If you are reaching for `{}`, you have found a field. The
   message names the *event*; the fields carry the *instance*.
3. **Attach every variable as a named field, before the message.** `%` for `Display`, `?` for
   `Debug`. Reuse the vocabulary already in the tree — `error` (846 uses), `persona_id` (293),
   `session_id` (144), `credential_id` (118), `execution_id` (98), `trigger_id` (86) — because a
   field name only aggregates if it is spelled the same everywhere.
4. **Ask the type-over-gate question before you write the value.** If the thing you are about to log
   is secret material, the answer is not "remember not to log it" — it is `SecureString`, whose
   `Display` is `[REDACTED]`. See below.
5. **If the string is not yours, sanitize it.** Subprocess stdout/stderr, an HTTP response body, a
   provider error, a file the agent read, anything from the WebView — run it through
   `sanitize_secrets` before it reaches a sink that outlives the process. **This is the step this
   repo skips, and it is the one that has actually cost something.**
6. **Do not start a second logger.** If you need a per-entity record, it is still a `tracing` event
   with an entity field. The one exception in this tree (`ExecutionLogger`) is §7 P0.
7. **Stop.** No `println!`. No `format!` inside the macro. No per-module prefix convention. No
   `#[instrument]` added for timing — it does not time (`logging.rs:59-72` never sets
   `with_span_events`; **67 attributes in 7 files**, of which **46 are in `db/src/repos/`**, exactly
   confirming [query-latency-instrumentation](./query-latency-instrumentation.md)'s count).

## 5 Anti-patterns

- **Interpolating a value into the message. 288 sites / 67 files.** `tracing::error!("OAuth callback
  failed: {}", e)` (`commands/infrastructure/auth.rs:472`) instead of
  `error!(error = %e, "OAuth callback failed")`. The failure mode is not verbosity — it is that N
  occurrences become N distinct strings, so nothing can count "how often did OAuth callback fail",
  and nothing can select "the ones for persona X". Worst concentrations: `src/lib.rs` 49,
  `src/engine/background.rs` 33, **`core/src/crypto.rs` 25** — the credential module is the third-worst
  file in the repo for this.
- **Writing an unsanitized foreign string to a durable sink.** `runner/mod.rs:2173`
  `logger.log(&format!("[STDOUT] {}", line.trim()))` — every line of the agent subprocess's stdout,
  verbatim, into a file with no retention, while that subprocess runs with **decrypted service
  credentials injected as environment variables**. This is P0 and it has fired.
- **Encoding the level into the message text.** `logger.log(&format!("[WARN] {msg}"))`
  (`runner/mod.rs:389`), `"[ERROR] {error_msg}"` (`:1737`, `:1973`), `"[ABORT] …"` (`:463`). A level
  that is a string prefix cannot be filtered by a subscriber, cannot route to Sentry, and cannot be
  turned down. There are 118 of these.
- **Two records for one event.** `log_frontend_error` (`src/lib.rs:511-517`) calls
  `logging::webview_log(&level, &message)` — which writes a pre-formatted line **straight to the file
  appender, bypassing the subscriber, the filter and Sentry** — and *then* also emits
  `tracing::<level>!(target: "webview", "{}", message)`. Every frontend diagnostic lands in the
  rolling file twice, once uncontrolled. (Honest scope: only **3** callers, all in `src/lib/debug/`,
  and **305 lines** in six days. Small, but it is the shape.)
- **Collapsing structure back into a string on the way in.** `src/lib/log.ts:16-17`
  `formatMessage` does `` `${message} ${JSON.stringify(context)}` `` — the frontend's "structured
  logger" stringifies its context into the message before `console.*` ever sees it, and
  `freezeDetector.ts:37` does `JSON.stringify(ev)` into the message again on the way to the backend.
  Structure destroyed twice, by the two functions whose names promise to preserve it.
- **A field name that carries the instance.** `warn!(load_persona_abc123 = …)` or a `format!`-built
  table label. The field names the thing; the value carries which one.
- **Assuming a `warn!` is a durable record.** Stdout dies with the process; the file rolls after 7;
  the breadcrumb ships only if an unrelated `ERROR` fires later. Measured in six days of real logs:
  **3,134 WARN lines and 2 ERROR lines** — a ratio of 1,567:1, which means essentially **none** of
  those 3,134 breadcrumbs ever left the machine.
- **`println!` in library code.** Near-extinct here and worth keeping that way (§6).

## 6 Evidence

### What this sweep CLEARED — say this first

**The `tracing`-vs-`println!` question is settled in this repo's favour and should not be re-litigated.**

| | Count | Verdict |
|---|---:|---|
| `dbg!` anywhere in `src-tauri` | **0** | extinct |
| `print!` / `eprint!` | **0** | extinct |
| `println!` / `eprintln!` total | 70 | see split |
| …in `build.rs` (the `cargo:` directive protocol — *required*) | 11 | not logging |
| …inside `#[cfg(test)]` | 20 | legitimate |
| …in binary entrypoints (`main.rs`, `daemon_bin.rs`, `mcp_bin.rs`, `athena_bench_bin.rs`, `mcp_server/install.rs`) | 33 | legitimate — stdout *is* the interface, and most run before a subscriber exists |
| …**in library code** | **6** | and 5 of the 6 are defensible |

The six: three are `ExecutionLogger`'s own I/O-failure path (`engine/src/logger.rs:39,61,68`) where
routing through `tracing` risks recursion into the failing writer; `src/lib.rs:3734` is Tauri failing
to start; `src/logging.rs:294` is inside the **panic hook**, where the subscriber may already be
unusable; `tests/render_plan_fixtures.rs:75` is a fixture generator. **There is no genuine
"someone left a `println!` in" defect in this repo.** A composer arriving at this leaf expecting to
find one should stop looking.

**And the structured-field question is mostly won too.**

| Shape of a `tracing` call | Count | Share |
|---|---:|---:|
| constant message **+ fields** — the target shape | **1,724** | 65.0 % |
| fields, but the message still interpolates | 394 | 14.9 % |
| constant message, no fields (nothing to say) | 247 | 9.3 % |
| **interpolated message, no fields — the deviation** | **288** | **10.9 %** |
| **total** | **2,653** | |

**2,118 calls (79.8 %) carry at least one field**, over 4,282 field arguments. By level: `warn!`
1,269 · `info!` 803 · `debug!` 301 · `error!` 278 · `trace!` 2.

> **Two independent implementations agree exactly.** A paren-matching argument splitter that
> tokenizes Rust strings, raw strings, char literals and both comment forms, and a whole-file regex
> run through the census engine, both report **288 matches across the same 67 files, with zero
> disagreeing files**. Precision on the condition is 288/288.

- **`db/src/backup.rs:107-112` — the site to copy.** Fields first, `%`-Display, constant message
  naming the consequence.
- **`core/src/crypto.rs:250-260`** — `SecureString`'s `Debug`/`Display` → `[REDACTED]`, plus the
  comment at `:268-270` explaining why it has no `Serialize`. Read this before arguing that "don't
  log secrets" needs a lint.
- **`core/src/utils/sanitization.rs:11-14`** — the performance comment that proves this function was
  meant for hot paths: *"`sanitize_secrets` runs on every audit-log write and engine error path (some
  in loops)"*. It was built to be called a lot. It is called 8 times.
- **`src/main.rs:94-143`** — `before_send` **and** `before_breadcrumb`, both scrubbing. The pattern
  the file sink should copy.
- **Six days of `personas.*.log`** — 22,169 lines: 16,093 INFO, 3,134 WARN, **2 ERROR, 0 DEBUG**.
  Cross-check of [query-latency-instrumentation](./query-latency-instrumentation.md)'s routed claim:
  1,444 `Slow DB query detected` + 901 hand-rolled `exceeded 100ms threshold` — **its "2,334 warn
  lines nobody reads" is confirmed** (higher now only because a day has passed).

### Convergence — what three sibling repos did without reading this

- **`brainiac` is ahead of us on both axes of this leaf, and the gap is instructive.** 92.7 %
  structured fields against our 79.8 %; and it owns `brainiac-core/src/redact.rs`, a module whose
  entire reason for existing is the incident we currently have live. Its header is worth quoting
  because it is the argument this document would otherwise have to make from scratch: *"Brainiac
  ingests real transcripts… Neither had any scrubbing (UAT run 2026-07-13, finding H4): a credential
  pasted into a session became a team-visible memory body and was handed, verbatim, to any agent
  whose RLS admitted it. This is the firewall — applied where a raw string crosses into a stored
  memory or an agent-facing payload."* It covers PEM blocks, connection-string passwords, six
  provider prefixes, bearer, JWT, and `key = value` where the key names a secret.
- **And it iterated on it in public.** `redact.rs:56-59` records a *second* fix: *"the module doc
  promised bearer coverage but no rule implemented it, so live bearer credentials pasted into a
  session survived verbatim into a memory body."* `:70-73` records a third: `\btoken\b` cannot match
  the `token` inside `access_token`, *"so the most common OAuth key names slipped through entirely."*
  **Both traps are present in this repo's redaction layers today** — `redact_clipboard_content` has
  no `key = value` rule at all, and `sanitize_secrets`'s `re_pairs` does handle the `access_token`
  case (its alternation lists them explicitly) but has no PEM rule. Free lessons, already paid for.
- **`personas-cloud` reinvented the same clause at a third boundary.** `sanitizeEnvVars`
  (`worker/validation.ts:73`) — sanitizing the environment handed to a worker, which is precisely the
  channel by which Personas' decrypted credentials reach the agent subprocess whose stdout then gets
  logged. It also returns `rejected` alongside `safe`, so the caller learns what was stripped.
- **`personas-web` reinvented it at the telemetry boundary.** `lib/sentry-pii.ts:53 redactUrl`.
  Personas has the analogue (`pii::scrub`) and it is the one door here that is genuinely well built.
- **Nobody gates log shape. Four for four.** No sibling has a lint, a CI check or a test on how a log
  line is constructed. §9's rule is therefore **manifestation, not doctrine**, and an adopting repo
  should re-derive it or skip it.
- **The trap row, stated plainly.** `brainiac` has 112 `eprintln!` calls; Personas has a whole second
  logger. Two codebases independently building an unstructured escape hatch beside their structured
  logger is convergence on a *mistake*. The contract warns that a convergent idiom can be a shared
  trap; this is one.

## 7 Deviations found

### P0 — **SECURITY** — real credentials are on disk, in cleartext, in an unpruned 406 MB log store

**Measured against the operator's live installation, 2026-08-14.** The logs directory holds **2,999
files / 410.5 MB**. Only **6 files / 4.0 MB** are the bounded `personas.*.log` rolling set. The other
**2,991 files / 406.6 MB (99.1 % of the bytes)** are per-execution `<uuid>.log` files written by
`ExecutionLogger`, **oldest 2026-04-06 — 130 days**.

`runner/mod.rs:2173` writes **every line of the agent subprocess's stdout verbatim**
(`logger.log(&format!("[STDOUT] {}", line.trim()))`), capped only at `MAX_OUTPUT_BYTES` = 10 MB
(`:2157`); `:2614` does the same for stderr. The subprocess is the Claude CLI in stream-JSON mode, so
each line is a full `tool_result` / `assistant` / `thinking` block. Nothing sanitizes it.

Scanning all 2,999 files for fifteen credential shapes:

| Shape | rolling `personas.*.log` | execution `<uuid>.log` |
|---|---:|---:|
| GitHub classic PAT (`ghp_` + 36) | **0** | **25 hits / 10 files** |
| Google API key (`AIza` + 35) | **0** | **58 / 13** |
| `Bearer <token>` (47 ch) | **0** | **10 / 5** |
| JWT (208 ch) | **0** | **2 / 1** |
| PEM `PRIVATE KEY` block | **0** | **3 / 1** |
| `*_TOKEN=` / `*_KEY=` / `*_SECRET=` assignment | **0** | **346 / 126** |
| anthropic key · openai key · fine-grained PAT · gh-oauth · gitlab PAT · slack · AWS · URL query token · Authorization header | **0** | **0** |

Verified as real credentials, not prose, by reading the surrounding line with the value masked:

- A `tool_result` returning the contents of a `.env.local`, carrying `GEMINI_API_KEY=AIza…` — written
  **2026-06-26**, still on disk **49 days later**.
- A `tool_result` from a secret scan returning `.gcp/firebase-admin.json`, including the
  base64 body of a GCP service-account **private key**.
- `SUPABASE_ANON_KEY=eyJ…` (208-char JWT) in an env dump.
- `ghp_…` inside a git push response and inside a `Bearer` header echoed by `curl`.

> **The bitterest detail.** In two of these files the model's own `thinking` block — itself persisted
> verbatim — reads *"CRITICAL FINDING: `.env.local` contains a real Google API key"* and *"contains a
> **real private key**… This is a CRITICAL finding."* **The security scan that correctly found the
> secret is the mechanism that copied it into a log with no retention.** Doing the right thing made
> it worse.

**Why no existing gate saw this:** the repo's `scripts/secret-scan.mjs` scans the *repository*; these
files are in `%APPDATA%`. `.gitignore` is irrelevant. Sentry never sees them. And
`LogDirectoryStats` (`logging.rs:413-436`) sums **every file in the directory** into `log_bytes`
while reporting `tracing_log_retention: 7` beside it — so the diagnostics surface tells the user
"retention: 7 files" next to a number derived from 2,999.

**Fix, in order, smallest first:**
1. **One line:** call `sanitize_secrets` inside `ExecutionLogger::log` (`engine/src/logger.rs:33`), so
   no call site can bypass it. Covers all 118 sites and every future one.
2. **Retention:** extend `prune_orphan_personas_logs` (or add a sibling) to bound `<uuid>.log` by
   age and total bytes. It currently *preserves* them by design.
3. **Remediate what exists:** the 406 MB on this machine contains live credentials; the affected
   tokens should be treated as disclosed and rotated, independent of any code change.

### P1 — five redaction layers, none on the path that leaked

The repo does **not** lack a redaction culture. It has five layers, all real, most tested:

| Layer | Guards | Coverage |
|---|---|---|
| `pii::scrub` + `is_sensitive_field` (`main.rs:156+`) | Sentry egress — events, exceptions, breadcrumb messages **and** breadcrumb data | thorough |
| `sanitize_secrets` (`core/src/utils/sanitization.rs:22`) | DB writes — audit_log, settings_audit_log, credentials, healthcheck_ledger | 8 call sites |
| `sanitize_error_message` (`core/src/error.rs:144`) | IPC `Serialize` → frontend | **paths only, 3 of 21 variants** |
| `redact_clipboard_content` / `redact_window_title` (`ambient_context.rs:965,1046`) | ambient capture window | **0 callers outside its own file** |
| `SecureString` `Debug`/`Display` → `[REDACTED]` (`crypto.rs:250-260`) | anything formatted | **5 files** |

**Every one of them guards a boundary where data leaves the machine or crosses to the UI. Not one
guards the boundary where data is written to a file** — which is the only boundary that has actually
leaked. That inversion is the structural finding of this leaf, and it is upstream of P0: the fix is
not "add redaction", it is "point the redaction you already have at the sink you already have".

Two specific consequences worth naming:
- **Logging bypasses `sanitize_error_message` entirely.** It is reachable only from
  `impl Serialize for AppError` (`error.rs:175`). `tracing::error!(error = %e)` uses `Display`. So the
  file gets the raw message, for all 21 variants — including `AuthorizationRequired`, whose `Display`
  (`error.rs:74`) embeds a full `authorize_url`.
- **`SecureString` is essentially unadopted.** 26 constructions across 4 files, against 1,661 Tauri
  commands ([`shared-facts.json`](../shared-facts.json)) and an entire vault subsystem.

### P2 — the default filter enables debug logging for a crate that emits none

`logging.rs:57` — `EnvFilter::new("info,personas_desktop=debug")`. But `src-tauri/Cargo.toml:26-27`
declares `[lib] name = "app_lib"`, so **`personas_desktop` is the target root of `src/main.rs` alone**;
everything else compiles as `app_lib`, `personas_core`, `personas_db` or `personas_engine`.

| Crate (tracing target root) | `debug!` calls |
|---|---:|
| `app_lib` (`src-tauri/src`) | 205 |
| `personas_engine` | 57 |
| `personas_db` | 34 |
| `personas_core` | 5 |
| **`personas_desktop` (`main.rs` — the only thing the directive matches)** | **0** |

**All 301 `debug!` calls fall under the global `info` directive and are silenced.** Ground truth
agrees: six days of real logs contain **0 DEBUG lines**. The directive names a crate that predates
the workspace extraction, `logging.rs:54` documents the intent (*"Default level: INFO, override via
RUST_LOG"*), and the effect is a debug channel that has never once emitted. **Fix:**
`info,app_lib=debug,personas_core=debug,personas_db=debug,personas_engine=debug`, or simply
`personas=debug` if the crates are renamed to a shared prefix.

### P3 — level discipline is inverted, and it costs a shared buffer

`warn!` is the **most-used level in the codebase** (1,269 sites, more than `info!`'s 803) and by far
the most-emitted at runtime (**3,134 lines vs 2 ERROR in six days**). Because `WARN`→breadcrumb and a
breadcrumb only uploads if an `ERROR` fires later in the same session, and because ERROR fires twice
per six days, **the breadcrumb channel is ~100 % noise that never ships**. When an ERROR *does* fire,
its breadcrumb trail is dominated by slow-query warnings ([query-latency-instrumentation](./query-latency-instrumentation.md)
§7 P0 measured 871 of them from four hand-rolled `if` statements) rather than by anything explaining
the error. This is not an argument from warning volume about lint severity — it is an argument that a
level in this app has a *runtime cost to a bounded shared resource*, and the codebase spends it as if
it were free.

### P4 — no gate of any kind on the Rust side, confirming the routed claim

[swallowed-error-telemetry](./swallowed-error-telemetry.md) routed here the claim that
`cargo clippy -- -D warnings` is *structurally* blind to `let _ = …`. **Confirmed, and the blindness
is broader than that.** Verified: **no `[lints]` table in any of the 5 `Cargo.toml` files, no
`clippy.toml` anywhere, no `#![deny]` / `#![warn]` / `#![forbid]` in any `.rs` file.** `-D warnings`
promotes lints that are already warn-by-default; `let_underscore_must_use` and
`let_underscore_untyped` are **allow**-by-default and cannot be promoted by it, so `let _ =` — the
language's sanctioned suppression of `unused_must_use` — passes silently. Independent re-count at
HEAD: **1,149 `let _ =` sites across 250 files** (their 1,128/249 with a slightly tighter whitespace
rule — the two reconcile). Nothing in this repo's Rust toolchain has an opinion about log shape,
log volume, or log content either.

### P5 — the interpolated-message deviation, by file

288 sites / 67 files. The concentration matters more than the total:

| File | Sites |
|---|---:|
| `src/lib.rs` | 49 |
| `src/engine/background.rs` | 33 |
| **`core/src/crypto.rs`** | **25** |
| `src/commands/infrastructure/dev_tools/competitions.rs` | 13 |
| `engine/src/p2p/mdns.rs` | 10 |
| `engine/src/test_runner.rs` | 9 |
| `db/src/migrations/helpers.rs` | 8 |
| `db/src/repos/execution/metrics.rs`, `src/engine/mod.rs` | 7 each |
| …58 more files | 127 |

Like [query-latency-instrumentation](./query-latency-instrumentation.md)'s coverage gap, **this is
file-shaped, not author-shaped**: `backup.rs` is 100 % compliant and `crypto.rs` is 25 sites deep in
the deviation, in the same crate. `crypto.rs` being third-worst is the one to fix first — not because
it leaks (its interpolations are error values and IDs, not secrets; checked) but because it is the
file a future reader will copy from when writing credential code.

### Boundary with the adjacent leaves — settled explicitly

- **[`swallowed-error-telemetry`](./swallowed-error-telemetry.md)** (1,875, `sides: client`) owns
  *whether a caught failure reaches any door at all*. This path starts one step later: **you have
  decided to make a record; what does the record look like and is it safe to keep.** Non-overlap
  test: a `catch (err) { silentCatch('x')(err) }` is 100 % compliant with that path and says nothing
  about this one; a perfectly-shaped `tracing::warn!(error = %e, "…")` that writes a token into an
  unpruned file is 100 % compliant with this path's *shape* rule and 0 % with its *safety* rule. It
  routed the Rust `let _ =` half here; §7 P4 answers it, and the `emit`/repo-write remediation itself
  belongs to whoever owns event emission — this path's contribution is the confirmed finding that
  **no gate exists that could ever see it**.
- **[`query-latency-instrumentation`](./query-latency-instrumentation.md)** (`data-persistence`) owns
  *how long something took and where that number goes*. This path owns *what a log record is made
  of*. They meet at `logging.rs`, which both had to read: its §8 Gap 5 ("no sink is durable enough")
  and this path's P0 ("one sink is far too durable") are **the same defect measured from opposite
  ends** — the app has exactly one bounded sink and one unbounded one, and they are the wrong way
  round. Its 46 `#[instrument]` count is independently confirmed here (67 repo-wide, 46 in
  `db/src/repos/`).
- **[`typed-error-contract`](./typed-error-contract.md)** owns which `AppError` variant carries what.
  This path owns whether that variant's `Display` output is safe to write down (§7 P1: today, no).
- **[`boot-migration-step`](./boot-migration-step.md)** owns whether a failing DDL step aborts boot.

## 8 Gaps in the primitive

1. **`ExecutionLogger` has no level, no fields, no redaction and no retention** — four separate gaps
   in an 80-line file. It is not a bad implementation of a logger; it is a good implementation of a
   file appender being used as a logger.
2. **`tracing`'s file layer has no `before_write` hook.** Sentry has `before_send` *and*
   `before_breadcrumb` and this repo uses both. `tracing_subscriber::fmt` offers no equivalent, so
   sanitizing the file sink means either a custom `Layer`, a wrapping `MakeWriter`, or sanitizing at
   the call site. **The `MakeWriter` route is the cheap one and it is already half-built**:
   `DeferredFileMakeWriter` (`logging.rs:180-187`) is exactly the interception point.
3. **`sanitize_secrets` has no PEM rule.** `brainiac/redact.rs:40-43` has one, and a PEM private key
   is the highest-value single artefact found in the log store. Conversely `redact_clipboard_content`
   has no `key = value` rule, which `sanitize_secrets` and `brainiac` both have. **Neither of this
   repo's two maskers is a superset of the other**, and there is no reason for two.
4. **`SecureString` cannot be used for a value that must also be serialized.** Deliberate
   (`crypto.rs:268-270`) and correct, but it means any secret that crosses IPC drops back to `String`
   at the boundary and loses its redaction for the rest of its life. A `SecureString` that serializes
   as `[REDACTED]` unless explicitly exposed would extend the guarantee downstream.
5. **The log level cannot be changed without a relaunch.** No `reload::Layer` (0 hits). A user
   reporting an intermittent bug cannot be asked to "turn on debug logging" through the UI.
6. **No sink distinguishes "safe to keep" from "safe to show once".** Everything a `tracing` macro
   emits goes to all three sinks. There is no way to say "this line is useful on stdout during
   development and must never reach the 7-day file".
7. **`#[instrument]` implies timing and provides none.** 67 attributes; `with_span_events` is never
   set. Carried from [query-latency-instrumentation](./query-latency-instrumentation.md) §8 because
   it is equally a *log-shape* trap: it looks like instrumentation to every reader.
8. **Nothing joins a log line to the execution that caused it.** The rolling file has no
   `execution_id`; the execution file has no level. The two records of the same incident cannot be
   correlated, and each is missing exactly what the other has.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md) this must be answered explicitly, above §9.

**The answer is YES for the security half and NO for the shape half, and both halves matter.**

**Where a type wins outright — the secret.** `SecureString` (`crypto.rs:250-260`) already makes
"accidentally log this secret" **unrepresentable**: `%` calls `Display`, `?` calls `Debug`, both emit
`[REDACTED]`, and there is no `Serialize` to leak it sideways. This is the same construction
`brainiac` reached for at its own boundary, and it is the strongest instrument in this document.
**Do not write a gate that greps for `token` near a log macro — adopt the type.** The migration is
mechanical: every field of a credential struct that holds secret material becomes `SecureString`, and
the 288-site interpolation problem stops being a security question entirely, because an interpolated
`SecureString` prints `[REDACTED]` too.

**Where a *chokepoint* wins, which is the P0 fix.** The 406 MB leak is not fixable by any per-site
discipline, because the offending value is `line.trim()` from a subprocess — it has no type of its
own and never will. The fix is to move the sanitizer inside the sink so the call site cannot reach
past it:

```rust
// engine/src/logger.rs — the only way anything reaches an execution log file
pub fn log(&mut self, msg: &str) {
    if let Some(ref mut w) = self.writer {
        let msg = personas_core::utils::sanitization::sanitize_secrets(msg); // ← the whole fix
        let timestamp = chrono::Utc::now().to_rfc3339();
        …
    }
}
```

**One line, one file, 118 call sites, every future call site, and it cannot be forgotten.** It is the
same construction as `before_breadcrumb` in `main.rs:131` and the same construction `brainiac` chose
for `redact::redact`. The mirror change for the `tracing` file sink is `DeferredFileWriter::write`
(`logging.rs:161`), which is already the single funnel every file-bound record passes through — and
the `MakeWriter` indirection means it needs no change anywhere else.

**Why a gate is still proposed below.** Neither type fixes the 288 interpolated messages. That
condition is genuinely per-site, genuinely a judgement-free mechanical edit, has 2,118 compliant
examples in the same tree, and **cannot be closed by one commit** — which is exactly the profile the
contract says a census ratchet is for. So: **the type is the fix for the leak; the gate is the ratchet
for the shape.** They do not compete.

**Where neither reaches.** *Whether the chosen level is the right level* is judgement (§7 P3).
*Whether anyone ever reads the log* is not expressible either — see §9's refusals.

## 9 The missing gate

### The semantic conditions, stated first

Three, each stack-free:

> **(A)** A log record's whole identifying content is baked into a per-occurrence message string, so
> N occurrences of one event become N distinct strings that can be neither grouped nor filtered.
> **(B)** A string the application did not author is written to a sink that outlives the process,
> without passing through redaction.
> **(C)** A durable record store grows without bound, so the cost of (B) compounds forever.

Per the [portability test](../research/portability-test.md), what follows is **one repo's proxy for
(A)**. An adopting repo inherits the three sentences and re-derives its own signal against its own
logging API — and a repo whose logger takes only a formatted string has (A) designed *in* and needs a
different instrument entirely.

### What is gated, and what is refused

**(A) is countable at 288 with 288/288 precision and is gated below.** **(B) and (C) are refused**,
with the checker that *can* express each one named instead of a bad regex shipped — and in both cases
the honest answer is that they need a **one-line code change**, not a counter. Checked first that no
existing rule covers this: all **37** rules in `scripts/census/rules.json` were read; none keys on a
logging macro, a `println!`, or log content.

### The one census rule — `unqueryable-log-record`

**Publish-only; do NOT edit `scripts/census/rules.json` — the orchestrator merges this block.**

```json
{"rules":[
  {
    "id": "unqueryable-log-record",
    "goldenPath": "docs/concepts/golden-paths/structured-logging.md",
    "title": "A log record's whole identifying content is baked into a per-occurrence message string, so it can neither be grouped nor filtered",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "\\b(?:tracing::)?(?:error|warn|info|debug|trace)!\\s*\\(\\s*(?:(?:target|name|parent)\\s*:\\s*\"[^\"\\n]*\"\\s*,\\s*)?\"(?:[^\"\\\\\\n]|\\\\[^\\n]){0,300}?\\{(?!\\{)[^{}\"\\n]{0,40}\\}",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a tracing macro whose FIRST argument is the message string (so no structured field precedes it) and whose message contains a format placeholder, meaning the record's variable content is interpolated into the message text rather than attached as a field. PROXY FOR the stack-free condition: a log record's whole identifying content is baked into a per-occurrence string, so N occurrences of one event become N distinct messages that can be neither grouped by event nor filtered by value. Measured 2026-08-14 at HEAD: 288 matches across 67 of 963 .rs files. TWO INDEPENDENT IMPLEMENTATIONS RECONCILE EXACTLY - this regex and a paren-matching argument splitter that tokenizes strings/comments and classifies each call's arguments both report 288 matches in the same 67 files with ZERO disagreeing files, so precision on the condition is 288/288. The compliant sibling form is used 2,118 times in the same tree (1,724 with a constant message plus fields, 394 with fields but a still-interpolated message), so this is a minority deviation from an established in-repo convention, not a migration. The optional (target|name|parent): prefix is load-bearing: without it the pattern misses exactly 5 sites, all of them tracing's pseudo-arguments (src/lib.rs:514-516 is the WebView console bridge re-emitting every frontend console line as a fully opaque \"{}\" passthrough; src/engine/mcp_tools.rs:2108 does the same for MCP server stderr). The fill class excludes the double-quote and the newline so a match can never run past the end of its own string literal into surrounding code - the cost is a false NEGATIVE for a placeholder sitting on a backslash-continued second line, which makes the count a floor rather than an estimate. {{ is excluded by the negative lookahead because an escaped literal brace is not interpolation. Zero matches sit in a test or build.rs file, so no exclude entry exists and no stale exemption can accumulate. PRECONDITION (must be re-derived per repo): this repo logs through the tracing crate, whose macros take structured key-value fields BEFORE the message, so 'field or no field' is a positional property a regex can see. A repo using a logger whose call is log.warn({persona_id}, 'msg') or logger.warn('msg', {ctx}) has the SAME condition wearing markup where position carries no meaning, and this pattern scores ZERO against it while the condition is present - personas-cloud is exactly that repo (194 pino-style logger.<level>( calls, zero tracing macros). A repo whose logger accepts only a formatted string has the condition designed in and needs a different instrument entirely. LEGAL FIX: move each interpolated value out of the message and into a field, leaving the message a constant - tracing::warn!(\"Failed to store master key: {}\", e) becomes tracing::warn!(error = %e, \"Failed to store master key\"). Use % for Display and ? for Debug. src-tauri/db/src/backup.rs:107 is the shape to copy. Do NOT silence a match by deleting the log call, and do NOT silence it by moving the interpolation into a format! argument - both trade this condition for a worse one."
    },
    "baseline": { "files": 84, "matches": 284 },
    "floor": 700
  }
]}
```

**Validated standalone before publishing** (own rules file, filename unique to this composer, never
against `rules.json`):

```
  rule                    files   base  matches   base  walked  floor
  OK   unqueryable-log-record     67     67      288    288     963    700

  census OK — 1 rule(s), 963 file-visits, 288 surviving violation(s) across 67 file(s).
```

`963 walked` is every `.rs` file under `src-tauri`, matching `rust.files` in
[`shared-facts.json`](../shared-facts.json) exactly. `floor: 700` sits well below it — tight enough
that a crate reorganisation fails loudly, loose enough to survive a crate being split out.
`commentMatchesSkipped` is **0**, so the multiline comment-rewind path (`lib/engine.mjs:192-211`) is
never exercised by this rule; every match also *starts* at a macro name, which is never on a
comment-only line.

**No `exclude` entries.** Zero matches occur in `#[cfg(test)]` modules, `tests/` or `build.rs`, so no
legitimate file-level exemption exists and a stale exemption cannot accumulate.

### Fault injection — because a gate that cannot fail is not a gate

Each row is a single-field mutation of the validated rule, run with `--check` against the real tree.

| Induced fault | Exit | Message |
|---|---:|---|
| baseline, unmutated | **0** | `census OK — 288 surviving violation(s) across 67 file(s)` |
| pattern matches nothing | **1** | `[structural] matched zero files anywhere` |
| `floor` above the walk (99999) | **1** | `walked 963 files but floor is 99999. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| root renamed `src-tauri` → `src-tauri-x` | **1** | `walked 0 files but floor is 700` |
| extension `.rs` → `.zzz` | **1** | `walked 0 files but floor is 700` |
| baseline pinned 1 low (287) | **1** | `matches rose 287 -> 288 (+1)` |
| baseline pinned high (400) | **1** | `matches dropped 400 -> 288 (-112) without the baseline moving` |
| baseline files pinned low (40) | **1** | `files rose 40 -> 67 (+27)` |
| `exclude` pointing at a deleted file | **1** | `exclude "…" matched no file. The exemption is stale` |
| `exclude` with a too-short `reason` | **1** | `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| **POSITIVE CONTROL — pattern inverted to the COMPLIANT form** | **1** | `files rose 67 -> 336 (+269)` |
| matcher narrowed by one clause (drops the 5 `target:` sites) | **1** | `files dropped 67 -> 66 (-1) without the baseline moving` |

### The positive control, in full — and a discrimination fixture

**The inverted-pattern control.** Re-pointing the same rule at the *compliant* construction
(`macro!(ident = …`) moves the count from 67 files to **336** and **fails**. A matcher that merely
matched "anything log-shaped" would be insensitive to which side of the convention it was aimed at;
this one is not.

**A stronger control, because the inverted-pattern one only proves sensitivity to breadth.** A
synthetic fixture was built in a scratch root (never in the repo) containing *only* compliant forms —
three field-carrying calls including a `target:`-prefixed one, plus one constant-message call:

```
compliant forms only (4 calls, 0 violations) -> exit 1: [structural] matched zero files anywhere
+ 3 violating calls, baseline 3/1            -> exit 0: 3 surviving violation(s) across 1 file(s)
+ 1 more violation, baseline still 3/1       -> exit 1: [drift] matches rose 3 -> 4 (+1)
  rebaselined to 4/1                         -> exit 0: 4 surviving violation(s)
```

**The matcher scores exactly zero against a file of correct code, and moves by exactly one per
violation.** That is discrimination, not matching.

> **Why no violation was written into a real source file.** The precedent set by
> [swallowed-error-telemetry](./swallowed-error-telemetry.md) §9 is to append a real violation to a
> real file and watch the count move by 1. **That was deliberately not done here.** At composition
> time `tauri dev` was live on this checkout (`:1420`, `:17320`, two `cargo.exe` and seven `rustc.exe`
> processes), so touching any `.rs` file under `src-tauri/` would have triggered a rebuild in another
> session's watcher — the hazard this composition was explicitly constrained against. The synthetic
> fixture plus the ±1 baseline rows above cover the same claim without that cost, and the fixture is
> the better instrument anyway because it also proves the *negative* case.

> **A tooling note that cost real time and will cost the next composer the same.** On this Windows
> machine, passing a regex to a script through **bash argv silently mangles the backslashes** (MSYS
> path/escape conversion — the same class of bug the repo already documents for `MSYS_NO_PATHCONV`).
> The identical pattern scored **283** via argv and **288** from a `String.raw` literal in a file.
> **Always put a census pattern in a file; never pass it on a command line here.**

### What this does NOT gate, and why — three refusals

1. **(B) "an unsanitized foreign string reaches a durable sink" is NOT gated, and this is the single
   most important refusal in the document.** It is the P0 condition, so refusing looks wrong until you
   ask what a rule would key on. The offending expression is `logger.log(&format!("[STDOUT] {}",
   line.trim()))` — a *string variable*. "Is this string foreign?" is a taint question, and taint
   requires dataflow that a content regex cannot express. Both naive proxies were measured and
   rejected: keying on `logger.log(` matches **118** sites of which **all 118 become correct the
   moment one line lands in `ExecutionLogger::log`**, so the rule would count correct code as
   violations and expire in a single commit (the exact failure
   [query-latency-instrumentation](./query-latency-instrumentation.md) §9 refusal 2 identified);
   keying on `format!` inside a log call matches ~700 sites at perhaps 5 % precision. **The checker
   that CAN express it is a test, and `brainiac` has already written it** — `tests/mcp_pg.rs:805`
   asserts a pasted credential does not survive into an excerpt. The Personas analogue is a
   `#[test]` in `personas-engine`: build an `ExecutionLogger` over a `tempdir`, feed it a line
   containing a synthetic `ghp_` token, read the file back, assert the token is absent and
   `[secret]` present. That is **behaviour, not shape**; it fails loudly because passing requires the
   masking to genuinely happen; and it is the regression guard for the one-line fix. **Mark honestly:
   it does not exist today, and no repo in this fleet except `brainiac` has one.**
2. **(C) "the log store grows without bound" is not a content condition at all.** It is a property of
   a directory at runtime — 2,991 files, 406.6 MB, 130 days — and no static analysis of source can
   see it. A rule keying on `RollingFileAppender` or `max_log_files` would match the *correct*
   retention code and pin at 1 forever, which the runner rightly treats as a gate that can never
   fail. **The instrument that fits is a runtime assertion the app already has the data for**:
   `log_directory_stats` (`logging.rs:413`) already computes total bytes and file count, and already
   reports `tracing_log_retention` beside them. It should compare them and surface a warning when the
   directory exceeds what the declared retention could possibly produce — turning an existing,
   already-wired diagnostics struct into a self-check. That is a **five-line change to a function
   that already runs**, and it is worth more than any rule I could write.
3. **Level choice is not gated.** No machine can decide whether a given event deserves `warn!` or
   `info!`. §7 P3 makes the argument with six days of runtime evidence (3,134 WARN, 2 ERROR) rather
   than a count of call sites, which is the stronger instrument. **No argument is made anywhere in
   this document from warning volume to lint severity** — `npm run check` runs `eslint src/` with no
   `--max-warnings` and the pre-commit hook runs `--quiet`, so a warn-level rule enforces nothing at
   either gate at any count. The census rule enforces; a lint rule would not. The one place volume
   *is* argued is P0/P3, and it is **log** volume in running software.

**How the rule fails loudly when its own precondition is absent** is inherited from the runner and
demonstrated in the fault table: a zero-match run fails structurally rather than reporting a clean
tree; a walk below `floor` fails with *"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; a drop
without a baseline update fails; and the surviving count prints on success, so a green build log
distinguishes a clean run from one that checked nothing.

### A note for any repo adopting this path

Take §2, §5 and the *intent* of §9. **Do not take the census rule** — it keys on `tracing`'s
fields-before-message calling convention, which is a property of one crate in one language, and it
scores zero against a `logger.warn('msg', {ctx})` API while the condition is present at full scale.
**Do take the redaction clause without modification**: it is the one thing all three sibling repos
reinvented independently, one of them after a real breach, and it is the clause this repo currently
fails. If you adopt exactly one sentence from this document, adopt *"sanitize inside the sink, not at
the call site."*

## See also

- [Swallowed error telemetry](./swallowed-error-telemetry.md) — whether a failure reaches any door at
  all; routed the Rust `let _ =` measurement here (§7 P4 confirms it).
- [Query latency instrumentation](./query-latency-instrumentation.md) — the same `logging.rs` read
  from the other end; its Gap 5 and this path's P0 are one defect measured from opposite directions.
- [Typed error contract](./typed-error-contract.md) — what an error *is*; §7 P1 covers whether its
  `Display` is safe to write down.
- [Boot migration step](./boot-migration-step.md) — the DDL half of the discarded-`Result` surface.
