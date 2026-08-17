# Golden path — Secret and PII redaction

> Situation node: `integrations-security/vault-security/secret-and-pii-redaction` ·
> [situation spine](../situation-spine.md) · recurrence 12 · risk **HIGH** ·
> sides: **server** · convergence: **diverged** ·
> dimensions: **security · resilience · code-quality · function**
> Composed 2026-08-16 against `master` @ `bbb1a8864`.
>
> **Sweep size.** 4,829 files under `src` + 963 `.rs` files under `src-tauri`
> (5,782 in the combined census walk). **24 distinct redaction implementations**
> located and read; the **10 that mask a credential or PII value in free text**
> were re-implemented and replayed. On the data side: a **read-only copy** of the
> operator's `personas.db` (347 MB) with **999 text-bearing columns / 2,220,724
> cells scanned value-by-value** for six PII shapes and ten credential shapes.
> Five sibling checkouts read for convergence.
>
> **Measured by execution.** Each redactor was replayed against synthetic tokens
> of **26 real-world credential shapes, 7 labelled carriers, 10 PII shapes and 6
> negative controls** — in **two independent engines** (Node `RegExp` and CPython
> `re`), from two independently-written transliterations. 292 of 294 verdict
> cells agreed; the 2 that did not are resolved in §6. The entropy backstop's
> blind spot was measured over **20,000 random tokens per length**. The census
> rule and its control were validated through the real runner, then re-extracted
> from this finished document and re-run: identical.
>
> `cargo` was not run. **No secret value, prefix, or partial appears anywhere in
> this document.** Every fixture is machine-derived from SHA-256 with the literal
> marker `SYNTHET1C` spliced into its body, so no fixture can collide with a real
> credential. Every live finding is reported as shape, length, column and count.
>
> ---
>
> ## The headline: the redactors are not one control with gaps — they are twenty-four controls that disagree, and the widest hole is not a credential
>
> Yesterday's fix ([column-encryption-at-rest](./column-encryption-at-rest.md),
> commit `1e714f817`) repaired three byte-identical GitHub-prefix regexes and
> extended `redact_execution_fields` from 3 fields to 6. **Both fixes hold — I
> verified them by replay, not by reading** (§12). They were also, measurably,
> the smaller half of the problem.
>
> | | measured |
> | --- | ---: |
> | distinct redaction implementations in the tree | **24** |
> | …that mask a credential or PII value in free text | **10** |
> | …that carry their own credential-shape pattern list | **8** |
> | …that agree with any other on that list | **0** |
> | credential-shape coverage, best redactor (`redact.rs`) | **24 / 26** |
> | credential-shape coverage, **the frontend Sentry scrubber** | **2 / 26** |
> | PII coverage, best redactor (`sanitizeErrorMessage`) | **5 / 10** |
> | PII coverage, `redact.rs` — the one the corpus calls canonical | **0 / 10** |
> | live PII matches in the database | **42,761** |
> | live literal credential values in the database | **6** |
>
> **PII outnumbers credentials in this database by roughly 7,000 : 1, and the
> redactor the corpus prescribes for persistence masks none of it.**
>
> ### 1 — the number that reframes the leaf
>
> Scanning 999 text columns of the live store, value by value:
>
> | shape | matches | top column |
> | --- | ---: | --- |
> | Windows user path (`C:\Users\<name>\…`) | **24,238** | `persona_executions.tool_steps` (15,392) |
> | POSIX home path (`/home/<name>`, `/Users/<name>`) | **15,704** | `persona_executions.tool_steps` (14,764) |
> | email address | **1,194** (86 distinct) | `persona_executions.tool_steps` (1,032) |
> | internal hostname (`*.internal/.local/.corp/.lan`) | **960** | `persona_executions.tool_steps` (629) |
> | Windows `DOMAIN\user` ACL string | **596** | `persona_executions.tool_steps` (326) |
> | IPv4 (non-loopback) | **69** | — |
> | **total PII** | **42,761** | |
> | literal credential values (post-classification) | **6** | `persona_executions.tool_steps` |
>
> **10 distinct OS account names** appear inside `C:\Users\<name>` paths; one of
> them accounts for **24,136 of 24,228** occurrences — it is the operator's own,
> written into the database roughly 24,000 times.
>
> Now hold that against the replay. **`core/src/redact.rs` — the redactor this
> corpus, the commit that fixed the other three, and `redact_execution_fields`
> all point at — masks 0 of 10 PII shapes.** It is a *credential* redactor with a
> module doc that says so. The path that routed all six execution fields into it
> was right about credentials and silent about the 40,000 personal-data matches
> travelling in the same columns. Nothing in this repo has a policy about them.
>
> ### 2 — the redactor that ships data off the machine is the weakest one in the tree
>
> `src/lib/sentry.ts:17` `scrubPii` is the **frontend** Sentry `beforeSend`
> scrubber. It carries three rules — UUID → `[id:xxxxxx]`, URL → scheme+host,
> quoted string → `[redacted]` — and **zero credential patterns**.
>
> Replayed against 26 credential shapes it masks **2**, and both only
> incidentally, because the token happened to sit inside a URL that the
> host-reduction rule truncated. A `ghp_…`, `sk-ant-…`, `AIza…`, JWT or PEM block
> in an exception message goes to Sentry **verbatim** unless it happens to be
> wrapped in quotes.
>
> The corrected pattern set it needs is **in the same repository, in the same
> language, exported from a file 300 lines away** (`maskSensitive.ts:103`), and
> `sentry.ts` does not import it. Yesterday's fix corrected the three copies that
> shared one broken literal; **this is a fourth frontend redactor that never had
> the literal at all**, so it was invisible to a search for the bug.
>
> ### 3 — the Rust Sentry scrubber protects the low-severity channel and not the high one
>
> `src-tauri/src/logging.rs:76-79` installs `sentry_tracing::layer()` with
> `ERROR => EventFilter::Event` and `WARN => EventFilter::Breadcrumb`. Read
> against the crate source (`sentry-tracing 0.34.0`, verified in the vendored
> registry copy, not from memory):
>
> | tracing level | becomes | where the structured fields land | scrubbed by `before_send`? |
> | --- | --- | --- | --- |
> | `warn!(k = %v, "…")` | Breadcrumb (`converters.rs:143`) | `breadcrumb.data` | **YES** — `main.rs:121,125` |
> | `error!(k = %v, "…")` | **Event** (`converters.rs:213`) | **`event.tags`** + **`event.contexts["Rust Tracing Fields"]`** (`converters.rs:155,180`) | **NO** |
>
> `before_send` (`main.rs:94-130`) scrubs `event.user`, `event.request.data`,
> `event.message`, `event.exception.values[].value`, and breadcrumb
> `message`/`data`. It never touches `tags` or `contexts`.
>
> **Measured: 179 `error!` call sites across 79 files carry a structured field**
> (`error!(err = %e, …)` and kin); **24 of them bind a rendered error value.** The
> control — the same shape at `warn!` level — is **916 matches across 262 files**,
> and every one of those *is* scrubbed. The repo built the careful path for the
> channel that carries less and left the channel that carries more open.
>
> This is also a **direct collision between two golden paths in this corpus**:
> [structured-logging](./structured-logging.md)'s `unqueryable-log-record`
> (67 files / 288 matches) exists to move variable content **out of** the message
> and **into** structured fields. In this repo, on ERROR level, that migration
> moves the value from the one field `before_send` scrubs into two it does not.
> Both prescriptions are right; the composition is wrong, and the fix is four
> lines in `before_send`, not a change to either path.
>
> ### 4 — the entropy backstop has a length floor, and it is arithmetic, not tuning
>
> `redact.rs:151` requires `shannon_entropy(tok) >= 4.5` bits/byte with
> `tok.len() >= 20`. Shannon entropy of a length-`n` string is bounded above by
> `log2(n)` — you cannot have more than `n` distinct symbols in `n` characters.
> **So 4.5 is unreachable below `2^4.5 = 22.63` characters, for any alphabet, by
> arithmetic.** The two constants are inconsistent with each other: lengths 20,
> 21 and 22 pass the length gate and fail the entropy gate with probability 1.
>
> Measured over 20,000 uniformly-random alphanumeric tokens per length:
>
> | token length | 16 | 20 | 22 | 24 | 28 | 30 | 32 | 36 | 40 | 48 |
> | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
> | P(caught) | 0% | **0%** | **0%** | 4.6% | 26.9% | 46.2% | 65.6% | 87.6% | 97.4% | 99.9% |
>
> A 24-character random API key — an extremely common shape — is caught **4.8%**
> of the time. A 20-character one, **never**. The backstop is real and it is the
> best in the six-repo fleet (§6 convergence), and it only functions on long
> tokens. **It is a long-token backstop, not a backstop**, and this is the first
> time that has been measured; [column-encryption-at-rest](./column-encryption-at-rest.md)
> §8 Gap 3 calls it "the load-bearing half" without a length qualifier.
>
> ### 5 — the strongest technique in the tree is subtraction, and it is used at 1 of its own 10 call sites
>
> Two functions, written independently, do something no pattern list can:
> **they subtract the literal secret values the process is currently holding,
> before any pattern runs.**
>
> ```rust
> // src-tauri/src/commands/credentials/auto_cred_browser.rs:362
> fn scrub_secrets(text: &str, known: &[String]) -> String {
>     let mut out = text.to_string();
>     for secret in known { if secret.trim().chars().count() >= 6 {
>         out = out.replace(secret.trim(), "[redacted]"); } }
>     crate::utils::sanitization::sanitize_secrets(&out)
> }
> ```
> ```rust
> // src-tauri/src/engine/db_query.rs:151
> for (key, value) in fields {           // the credential fields just decrypted
>     if !value.is_empty() { sanitized = sanitized.replace(value, &format!("[REDACTED:{key}]")); }
> }
> ```
>
> **This needs no prefix taxonomy, no entropy threshold, and no length floor.**
> It catches the 20-character key the sweep cannot see and the provider invented
> next year. Its doc comment states the reason precisely: *"even a high-entropy
> token the regex cannot recognize never reaches a plaintext crash log."*
>
> **And 9 of `scrub_secrets`'s 10 call sites pass `&[]`.** Only
> `auto_cred_browser.rs:1230` supplies the literals. The best answer in the
> repository is switched off at 90% of its own call sites.
>
> ### 6 — nothing redacts on the way OUT
>
> Asked directly: does anything redact on the read path?
>
> | direction | instances |
> | --- | --- |
> | at persistence (on the way in) | `redact_execution_fields` (6 fields, one `UPDATE`), `ExecutionLogger::log`, 3 audit-log writers, `sanitize_ledger_json`, 2 of 17 healthcheck results, `redact_clipboard_content`/`redact_window_title` at capture |
> | at network egress (on the way out) | **1** — `cloud/sync/rows.rs:101`, and it covers **1 of 11** synced tables |
> | at the render layer (a UI choice) | 5 sites — **all 5 have a toggle that selects the raw value instead** (§9) |
> | **at the IPC read boundary** | **0 of 16** commands that return execution free text |
> | at the database read boundary | **0** |
>
> The whole architecture is *redact-on-write*. That is a defensible choice — but
> it means every row written before the write-path was fixed stays leaked
> forever, and it means a second writer that skips the redactor (there is one:
> `create_with_idempotency`, which persists `input_data` with no redaction at all)
> has no downstream net. **`persona_executions.input_data` is redacted by nothing
> on any path, is mirrored into `executions_fts`, and is synced to Supabase.**
>
> ### Sibling boundaries, settled in prose
>
> [**Column encryption at rest**](./column-encryption-at-rest.md) owns the secret
> **in a column** — which column, with or without an IV. **This path owns the
> secret and the personal datum *leaving*** — which sink, through which redactor,
> masking which shapes. Where we overlap on the pattern sets, that path
> established *"does the literal match the shape"* and fixed it; **this path
> establishes what the fixed literals actually cover, that there are eight of
> them and not three, and that credentials were never the dominant term.**
>
> [**Structured logging**](./structured-logging.md) owns the log **record**.
> **Confirmed and extended**: its `sanitize_secrets` prescription is wired at
> `logger.rs:61` and now masks 17/26 shapes rather than 7/20. Its
> `unqueryable-log-record` prescription, however, moves values into the exact
> fields the Sentry scrubber does not clean (§3) — that composition is recorded
> here and the fix belongs to `before_send`, not to either rule.
>
> [**Retention and pruning**](./retention-and-pruning.md) owns what is already on
> disk: **2,999 execution log files / 419 MB**, 20 crash logs, and — measured here
> for the first time — **998 MB of database backups in 9 files**, which are
> verbatim copies of every plaintext column. This path does not re-litigate the
> filesystem; it supplies the reason those files matter, which is that four disk
> sinks exist and one is sanitized.
>
> [**Secret display and transfer**](./secret-display-and-transfer.md) owns the
> clipboard and the deliberate reveal. This path owns the **incidental** escape:
> the crash report, the breadcrumb, the export, the sync row.
>
> The **Deviations** section is a fix backlog.

## 1 Trigger

- "Where do I log / report / export this?" — anything with a `write`, a
  `captureException`, a `to_string_pretty`, or a network POST in it.
- "This error message should tell the user what went wrong." (What *else* does it
  say?)
- "I'm adding a Sentry breadcrumb / tag / context / extra."
- "I need to mask secrets here — I'll write a quick regex."
- "The value is already redacted at write time, so the read path is fine, right?"
- "It's only a file path / a hostname / an email — that's not a secret."
- "I'm backfilling / migrating rows that were written before the redactor existed."

If you are about to type `Regex::new` next to the word `token`, `sanitize`,
`scrub`, `mask`, `[REDACTED]`, `[secret]`, `beforeSend`, `before_breadcrumb`,
`fs::write`, `captureException`, `addBreadcrumb`, `tracing::error!(x = %e`, or a
ternary of the form `showRaw ? raw : mask(raw)` — you are in this situation.

**You are also in it, and this is the case people miss, if you are about to
persist or forward a filesystem path, a hostname, a username, or an email.**
Those are **42,761 of the 42,767** sensitive matches in this database.

**Not this path:** whether the *column* is encrypted is
[column-encryption-at-rest](./column-encryption-at-rest.md); what a log record's
*fields* should be is [structured-logging](./structured-logging.md); how long the
artifact lives is [retention-and-pruning](./retention-and-pruning.md); a
deliberate reveal-and-copy is
[secret-display-and-transfer](./secret-display-and-transfer.md).

## 2 The one way

**Redact at the boundary the value crosses, not at the place it is displayed, and
subtract before you pattern-match.** Before writing any pattern, ask what secrets
this process is *currently holding* — the credential it just decrypted, the token
it just minted, the header it just built — and replace those literals verbatim
first; `auto_cred_browser.rs:362` and `db_query.rs:151` both do this and it is the
only technique in this repo that catches a 20-character key, an unknown provider,
or a value with no recognisable shape. **Then, and only then, run the shared
pattern pass — and use `personas_core::redact::redact_string`, the only one with
correct delimiters for every family plus an entropy sweep; never write a ninth
pattern list.** If you need PII masked as well as credentials — and you almost
always do, because paths, hostnames, usernames and emails outnumber credentials in
this system by three orders of magnitude — you must compose, because **no single
redactor in this tree covers both**: `redact.rs` masks 0 of 10 PII shapes and
`sanitizeErrorMessage` masks 17 of 26 credential shapes. **Apply the pass on the
way out as well as on the way in**, because redact-on-write leaves every
pre-existing row leaked and any second writer uncovered, and because the
`SELECT` that feeds an IPC response, an export bundle or a sync row is the last
place you can still act. **Never make redaction a render-time choice**: a
`showRaw ? raw : mask(raw)` ternary proves the raw value already reached the
renderer, so the mask is cosmetic and the DOM, the devtools, the screenshot and
the clipboard all still hold the original — withhold the raw value from the
payload instead and put it behind a separate, named, audited command. **And when
you fix a redactor, write the backfill in the same change**, because the row
written yesterday is the row that leaks tomorrow.

If you must get one thing right first: **enumerate the sinks, not the shapes.**
There are four durable disk sinks in this app and one of them is sanitized; the
shapes were fixed yesterday and it moved 6 of the 42,767 live matches.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `core/src/redact.rs:97` `redact_string` / `:82` `redact_opt` | **the strongest pattern pass: 24/26 credential shapes, 0/6 false positives.** 8 per-provider classes with correct delimiters, a `Bearer` rule that preserves the prefix, a Shannon-entropy sweep, a kill switch, and substring-only replacement so JSON stays valid |
| `db/src/repos/execution/executions.rs:802` `redact_json_value` | recursive JSON walker: redacts string **values**, leaves **keys** alone, and (`:790`) commits only if the document parses back. The right shape for any JSON column |
| `src/commands/credentials/auto_cred_browser.rs:362` `scrub_secrets(text, known)` | **subtract-then-pattern.** Replaces held literals ≥6 chars verbatim, *then* runs the pattern pass. The only technique here that is not a shape guess |
| `src/engine/db_query.rs:144` `sanitize_error(msg, fields)` | the same idea reached independently, keyed by field name so the marker says *which* credential was removed |
| `core/src/utils/sanitization.rs:22` `sanitize_secrets` | labelled-pair coverage: **7/7** on `api_key = …`, `"token":"…"`, `Authorization: Bearer …`, `password: …`. The only Rust redactor that masks **email**. 19 call sites |
| `src/lib/utils/sanitizers/maskSensitive.ts:109` `sanitizeErrorMessage` | **the only PII redactor in the tree**: file paths, IPv4, internal hostnames, emails, and URL query/fragment stripping with the URL protected from the path rule first (`:118-130`). 5/10 PII, 17/26 credential |
| `src/cloud/sync/rows.rs:72` `redact_secrets` | the best JSON walker: **substring** key matching (catches `gh_pat_value`, which exact-match misses), value-prefix checks, a density heuristic, and a 4 KB bound. **4/10** on the JSON matrix vs `maskSensitiveJson`'s 1/10 |
| `engine/src/ambient_context.rs:965,1046` | capture-time redaction done right — the un-redacted clipboard text and window title **never enter the store**, and it is the only redactor here with a `github_pat_` class |
| `core/src/crypto.rs:221` `SecureString` | zeroize-on-drop, `[REDACTED]` on `Debug`/`Display`, deliberately **not** `Serialize` |
| `scripts/census/` | the ratchet mechanism. §9 |

**Do not exist — this path names them:**

- **A chokepoint.** There are **24** redaction implementations; **10** mask
  credential or PII values; **8** carry a credential-shape list and **no two
  agree**. Six different mask markers are in use (`[REDACTED]`, `[secret]`,
  `[redacted]`, `[email]`, `[credential-redacted]`, `********`).
- **Any redactor that covers credentials AND PII.** Best credential coverage is
  24/26 at 0/10 PII; best PII coverage is 5/10 at 17/26 credential.
- **Any redaction on a read path, an IPC response, or an export bundle.**
- **A backfill for anything already written.** Not for the 1,921 `tool_steps`
  rows, not for the 2,999 log files, not for the 998 MB of backups.
- **A test that would notice a redactor covering nothing.** `brainiac` has one
  (§6); this repo has none, and `sanitization.rs:103` still feeds its matcher
  only shapes it already handles.
- **A written policy on PII.** No file in the tree states which of email / path /
  hostname / username / IP is considered personal data.

## 4 Steps

1. **List the sinks this value can reach before you write the redactor.** Disk
   file, Sentry event, Sentry breadcrumb, IPC response, export bundle, clipboard,
   cloud sync row, database column, projected file in a user's repo. This app has
   at least nine; §7 shows which are covered.
2. **Ask what secrets you are holding right now** and collect them into a
   `&[String]`. Pass them. Do not pass `&[]` — 9 of 10 call sites in this repo do,
   and that is the deviation, not the convention.
3. **Then call `redact::redact_string`.** For JSON, `redact_json_value`. For a
   labelled-pair-heavy sink (audit detail, provider error), compose
   `sanitize_secrets` after it — the two cover different halves and neither is a
   superset (§6 matrix).
4. **Add the PII pass explicitly, and say which shapes you chose.** There is no
   Rust PII redactor; `sanitizeErrorMessage`'s five rules
   (`maskSensitive.ts:58-77`) are the reference set to port. If you decide a path
   or hostname is acceptable in this sink, **write that sentence in the code** —
   nobody has, and that is why 24,238 of them are in the database.
5. **Ask the type-over-gate question now**, before §9. The answer is below and it
   is about *what the IPC payload contains*, not about a newtype.
6. **Apply it on the read path too.** The `SELECT` that feeds an IPC response, an
   export or a sync row is your last boundary; treat "already redacted at write"
   as an assumption to test, not a fact — `input_data` disproves it.
7. **Never write `showRaw ? raw : mask(raw)`.** If the raw value must be
   reachable, put it behind a distinct command with its own name and its own
   audit row, and keep it out of the payload every list row already receives.
8. **Write the backfill in the same commit as the redactor fix**, with the
   transaction, the FTS interaction and the dry-run described in §7 P0.
9. **Add a fixture of the real shape, and a meta-assertion that every pattern
   matches at least one fixture.** `brainiac/crates/brainiac-core/src/redact.rs:135`
   exists because a documented rule matched nothing; that is the only test in six
   repos that would catch a dead pattern, and this repo has no equivalent.
10. **Then stop.** No ninth pattern list. No new mask marker. No render-time
    ternary. No `&[]`.

## 5 Anti-patterns

- **Writing a redactor instead of calling one.** *Failure mode:* the tree
  accumulates independent opinions that drift apart silently, and the one wired to
  the sink that ships data off-device turns out to be the weakest.
  **Measured: 24 implementations, 8 credential-shape lists, 0 agreements, 6 mask
  markers.** `src/lib/sentry.ts:17` has three PII rules and no credential rule at
  all, 300 lines from a correct list it does not import.
- **Treating "PII" as a synonym for "credential".** *Failure mode:* the redactor
  is named for secrets, reviewed for secrets, and the 42,761 personal-data matches
  travelling through the same column are never in scope for anyone.
  **Measured: `redact.rs` masks 0/10 PII shapes; nothing in Rust masks a
  filesystem path except `core/src/error.rs:144`, which masks only paths.**
- **Trusting an entropy backstop on short tokens.** *Failure mode:* the heuristic
  is real, is genuinely ahead of every sibling, and is **arithmetically incapable**
  of firing below 23 characters — so it reads as a safety net while a 20-character
  API key passes with probability 1. **Measured: 0% at ≤22 chars, 4.6% at 24,
  46.2% at 30.**
- **Scrubbing the message and forgetting the fields.** *Failure mode:* the
  higher-severity channel is the uncovered one, because `error!` becomes an Event
  (fields → `tags`/`contexts`) while `warn!` becomes a Breadcrumb (fields →
  `data`, which *is* scrubbed). **Measured: 179 error-level structured fields
  across 79 files unscrubbed; 916 warn-level ones across 262 files scrubbed.**
- **`showRaw ? value : sanitize(value)`.** *Failure mode:* the mask is decoration.
  The raw string is already in the IPC payload, the React props, the DOM, the
  devtools and — at `ExecutionDetailContent.tsx:166` — in the clipboard button
  sitting one line above the masked render. **Measured: 5 sites, and they are 5 of
  the 14 total invocations of the frontend sanitizers.**
- **Redacting only on write.** *Failure mode:* every row written before the fix
  stays leaked, and any second writer is uncovered with no net.
  **Measured: 0 of 16 IPC read-path commands redact; `input_data` is redacted by
  nothing on any path and is mirrored into `executions_fts` and synced to
  Supabase.**
- **Passing `&[]` to a subtract-then-pattern helper.** *Failure mode:* you get the
  weaker half of a two-part control and the signature makes it look like you got
  both. **Measured: 9 of 10 `scrub_secrets` call sites.**
- **Shipping the redactor fix without the backfill.** *Failure mode:* the code
  reads as fixed and the data is not. **Measured: `redact_execution_fields` was
  extended on 2026-08-15 and its own doc comment says the backfill "is not done
  here"; 1,921 rows / 26.5 MB dated 2026-06-03 → 2026-06-26 are still unredacted
  today.**
- **A pre-commit secret scan that exits 0 when its scanner is absent.**
  *Failure mode:* manufactured confidence. **Executed:
  `node scripts/secret-scan.mjs` → `"gitleaks not installed — secret scan SKIPPED
  (commit not blocked)"`, exit 0.** The control has never run on this machine, and
  a sibling repo has a live token committed (§6).

## 6 Evidence

**The ONE site to copy: `src-tauri/src/commands/credentials/auto_cred_browser.rs:362`
`scrub_secrets(text, known)`.** It subtracts the literal credential values the
process is holding *before* running the shared pattern pass, so a token no regex
knows is still removed; it delegates the pattern half rather than reimplementing
it; its doc comment states the threat (`"a plaintext crash log, a UI narration
frame, or a persisted procedure row"`); and it degrades honestly to the pattern
pass when the caller has nothing to subtract. Copy it — and unlike 9 of its own
10 call sites, **pass the literals.**

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `core/src/redact.rs:47-79` | per-provider classes with correct delimiters **plus** an entropy backstop; substring-only replacement (`:97-128`) so JSON survives; a documented kill switch |
| `db/src/repos/execution/executions.rs:802` `redact_json_value` | walk values, never keys; **commit only if the document parses back** (`:790`) — a redaction that corrupts the column is worse than the leak |
| `src/engine/db_query.rs:151` | the marker names *which* field was removed (`[REDACTED:api_key]`), so the log stays diagnosable after redaction |
| `src/cloud/sync/rows.rs:28-46` | key matching by **substring** (`k.contains(n)`), not equality — the difference between catching `gh_pat_value` and not |
| `engine/src/ambient_context.rs:460,523` | redact at **capture**, so the raw value never enters the store — the only place in this repo where that is true |
| `maskSensitive.ts:117-130` | protect URLs behind a placeholder before the path rule runs, then restore. The comment records the exact bug that motivated it |
| `engine/src/logger.rs:36-57` | a doc comment that states the measurement, the blast radius, and *"this masks NEW writes only"*. Every redactor should carry one |
| `core/src/crypto.rs:268` | `SecureString` deliberately not `Serialize` — a withheld capability, not a documented rule |

### The replay matrix — 10 redactors, 49 fixtures, two engines

Synthetic tokens of real shapes, correct structure, invented characters. Nothing
below is a real credential and no value is printed.

**A. Unlabelled credential shapes (26)** — the token stands alone in the text.

| | R1 `redact.rs` | R2 `sanitize_secrets` | R3 Sentry (Rust) | **R4 Sentry (frontend)** | R5 `sanitizeErrorMessage` | R6 clipboard |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| masked | **24/26** | 17/26 | 23/26 | **2/26** | 17/26 | 14/26 |

Leaks worth naming: **R1** misses the Postgres-URL password and the basic-auth
userinfo (both are ≤24-char bodies, below the entropy floor). **R2/R5** miss
`github_pat_`, `sk-proj-`, PEM blocks, Notion, Linear, SendGrid and any bare
high-entropy token — they have no entropy pass. **R6** misses Google, Anthropic
and OpenAI entirely. **R4 misses everything with a prefix.**

**B. Labelled carriers (7)** — a recognised key word precedes the secret.

| | R1 | R2 | R3 | R4 | R5 | R6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| masked | 5/7 | **7/7** | **7/7** | 1/7 | 4/7 | 2/7 |

**R1 — the strongest credential redactor — is the second-weakest on labelled
pairs**, because it has no key:value rule: `api_key = <32 chars>` and
`password: <20 chars>` both survive it. **The two sets are complements, not a
ranking**, which is why §2 says compose.

**C. PII shapes (10)**

| shape | R1 | R2 | R3 | R4 | R5 | R6 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| email address | leak | **mask** | leak | leak | **mask** | **mask** |
| Windows path with username | leak | leak | leak | leak | **mask** | leak |
| POSIX home path | leak | leak | **mask** | leak | **mask** | leak |
| IPv4 address | leak | leak | leak | leak | **mask** | leak |
| internal hostname | leak | leak | leak | leak | **mask** | leak |
| **Windows `DOMAIN\user`** | leak | leak | leak | leak | leak | leak |
| **bare OS username** | leak | leak | leak | leak | leak | leak |
| UUID | leak | leak | **mask** | **mask** | leak | leak |
| full URL with path | leak | leak | **mask** | **mask** | leak | leak |
| free text in quotes | leak | leak | **mask** | **mask** | leak | leak |
| **masked / 10** | **0** | **1** | **4** | **3** | **5** | **1** |

**Two shapes are masked by nothing at all: the Windows `DOMAIN\user` ACL string
(596 live matches) and a bare OS username.** `sanitizeErrorMessage`'s path rule
requires a drive letter (`[A-Z]:\\`), so `DOLLARSTORE\mkdol` is not a path to it.

**D. Negative controls (6)** — a `DESTROYED` cell is a false positive.

| | R1 | R2 | R3 | R4 | R5 | R6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| false positives | **0/6** | **0/6** | 3/6 | 1/6 | 1/6 | **0/6** |

R3 destroys a git SHA and a SHA-256 digest (its `base64_blob_re` matches any 32+
alnum run) — an acceptable bias for a Sentry scrubber, but it costs the
correlation IDs an on-call engineer needs.

**E. The two JSON walkers**, on 10 carriers:

| carrier | R7 `maskSensitiveJson` | R8 cloud-sync `redact_secrets` |
| --- | :-: | :-: |
| secret under a recognised key | mask | mask |
| secret under an unrecognised key (`github_token`) | **leak** | mask |
| secret under a compound key (`gh_pat_value`) | **leak** | mask |
| bare token as a whole value | **leak** | mask |
| Google key as a whole value | **leak** | **leak** |
| secret in a nested tool argument | **leak** | **leak** |
| secret in free-text output | **leak** | **leak** |
| secret in an array element | **leak** | **leak** |
| POSIX home path / email (PII) | **leak** | **leak** |
| **masked / 10** | **1** | **4** |

`maskSensitiveJson` uses `^…$` **exact** key matching; `redact_secrets` uses
substring. That one design choice is the whole 1→4 difference, and the newer
function is the better one. **Neither masks a secret embedded inside a string
value**, which is exactly where `tool_steps` keeps them.

### Two independent implementations, and the two cells where they disagreed

294 verdict cells, computed twice — Node `RegExp` and CPython `re`, from two
independently-written transliterations of the six source files. **292 agreed.**
The two that did not were both mine, both in the TypeScript redactors, and both
the same root cause: my Python transliteration used `urlsplit().netloc`, which
**includes** userinfo, where the shipping code uses WHATWG `URL.host`, which
**excludes** it. Verified directly. The Node run is faithful to the shipping code
and is what the tables above report; the disagreement is recorded rather than
averaged, per doctrine.

**One instrument failure, caught and fixed mid-measurement.** The first fixture
generator used an LCG with `state % 62`. An LCG's low bits are periodic, so the
"random" bodies were not flat and their Shannon entropy was depressed —
**`redact.rs` scored 21/26 instead of its true 24/26**, and I would have published
three false leaks against the repo's best module. Switching to SHA-256-derived
bytes and asserting the fixture clears 4.5 bits/byte (measured 4.734) fixed it.
An instrument that makes the subject look worse is as wrong as one that makes it
look better.

### The live store, measured (read-only copy, 2026-08-16)

241 tables, **999 text columns holding data, 2,220,724 cells scanned.**

| | value |
| --- | ---: |
| PII matches, all shapes | **42,761** |
| literal credential values (template-classified) | **6** |
| `persona_executions` rows / with `tool_steps` | 2,188 / **1,921** |
| `tool_steps` total bytes | **26,551,258** |
| `tool_steps` date range | 2026-06-03 → 2026-06-26 |
| distinct emails / occurrences | **86** / 1,194 |
| distinct OS account names in `C:\Users\…` / occurrences | **10** / 24,228 |
| columns carrying a redaction marker (a redactor demonstrably fired) | **22** |

The 6 surviving literal credential values, by shape and location — **no values,
no prefixes**:

| column | shape | length | count |
| --- | --- | ---: | ---: |
| `persona_executions.tool_steps` | Google API key | 39 | **4** |
| `persona_executions.tool_steps` | GitHub PAT | 40 | **1** |
| `persona_executions.tool_steps` | PEM `BEGIN … PRIVATE KEY` header | 27 | **1** |
| `persona_design_reviews.design_result` | Slack / GitHub / Stripe shapes | — | **0 literal, 21 TEMPLATE** |
| `workspace_knowledge.detail_md` | GitHub shape | — | **0 literal, 1 TEMPLATE** |

**All are inside `tool_steps`, all predate the 2026-08-15 fix, and none has been
backfilled.** Any credential matching these shapes should be treated as
compromised and rotated regardless of what the backfill does.

Behavioural probes, executed:

1. **`executions_fts` is an external-content FTS5 mirror** of `input_data`,
   `output_data`, `error_message` — **not** `tool_steps` (`content='persona_executions'`,
   verified from `sqlite_master`). Its `AFTER UPDATE` trigger fires only
   `OF input_data, output_data, error_message`, so a `tool_steps` backfill needs
   no FTS handling and an `output_data` backfill gets it automatically. **This is
   load-bearing for P0 and would have been easy to get wrong in either direction.**
2. **The secret scan has never run.** `node scripts/secret-scan.mjs` → SKIPPED,
   exit 0.
3. **Four durable disk sinks, one sanitized.** `engine/src/logger.rs:61`
   (sanitized) · the rolling `tracing` file at `logging.rs:121-136` (not) · the
   WebView console funnelled into the same file at `logging.rs:145-152` (not) ·
   `crash_logs/` with `RUST_BACKTRACE=full` at `logging.rs:245-299` (not).
4. **998 MB of database backups in 9 files** plus two 2026-06 `cleanbak` copies
   (44 MB, 30 MB) sit beside `personas.db` — verbatim copies of every plaintext
   column, outside every redactor and every retention policy.
5. **391 `toastCatch(` invocations across 207 files; 3 sanitized display sites**
   (0.77%), and all 3 are `showRaw`-bypassable. Two independent counts: 600 total
   mentions vs 391 invocations — the difference is imports, and 391 is the honest
   denominator.
6. **179 error-level structured fields vs 916 warn-level.** The first set reaches
   Sentry unscrubbed; the second is scrubbed.

### Convergence — five siblings, run 2026-08-16

All five checkouts exist and were read. Nothing is reported by omission.

| clause | brainiac | personas-cloud | ascent | vibeman | personas-web | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| a credential redactor exists | ✔ full | **✗ none** | ✔ thin | 2 partial | PII-only | 3/5 |
| **one chokepoint** | **✔ 1 module, 6 sites** | n/a | ✔ 1 (+documented bypass) | ✗ **2 sets, disagreeing, 0 tests** | ✔ 1 | **house convention here — Personas has 24** |
| applied at persistence **and** egress | **✔ both** | egress only | persist only | egress only | egress only | **1/5** |
| **redacts on the way OUT (API/DTO)** | **✔ `mcp.rs:2393`** | **✔ DTO strip** | ✗ | error resp. only | ✗ | **2/5 — and Personas has 1 of 11** |
| PII treated at all | ✗ | ✗ | ✗ | paths + SQL | **✔ most thorough** | 2/5 |
| **IP / hostname / username masked** | ✗ | ✗ | ✗ | ✗ | ✗ | **SILENCE 5/5** |
| **entropy / statistical backstop** | ✗ | ✗ | ✗ | base64-shape only | ✗ | **SILENCE 5/5** |
| error-reporter hook carries credential patterns | **✗ no hook at all** | ✗ | ✗ | commented out | **✗ PII-only** | **0/5** |
| test with real-shaped tokens | **✔ 12 shapes** | ✗ | ✔ 2 shapes | ✗ | PII only | 2/5 |
| **a test that catches a DEAD pattern** | **✔ `redact.rs:135`** | ✗ | ✗ | ✗ | ✗ | **1/5** |

**Four results this document rests on.**

**(a) The single chokepoint is physics where anyone bothered, and Personas is the
outlier by an order of magnitude.** `brainiac` routes everything through
`brainiac_core::redact::redact` at six sites split deliberately across both
directions — persistence (`extract.rs:967`, `:614`, `:203`), log egress
(`extract.rs:750`) and **API egress** (`mcp.rs:2393`, where the excerpt is
redacted *before* truncation so a secret straddling the cut is still masked). Its
cache key is computed over the **redacted** chunk (`extract.rs:555-565`), so the
firewall sits upstream of the cache and a cache hit cannot bypass it. `ascent`
and `personas-web` each have one. `vibeman` has two that disagree and zero tests
for either. **Personas has 24.** The number is not a style difference; it is why
the frontend Sentry scrubber could sit at 2/26 for as long as it has.

**(b) Nobody in the fleet masks an IP address, a hostname or a username —
including Personas — and this is the single most replicated silence in the
sample.** `personas-web` deletes Sentry's structured `user.ip_address` field but
has no IP regex; no repo has a hostname or username rule at all. Meanwhile this
database holds 24,238 Windows user paths, 960 internal hostnames and 596
`DOMAIN\user` strings. **A 5/5 silence is not permission — it is a fleet-wide
blind spot**, and §7 P2 treats it as one.

**(c) Personas is ahead of all five on the entropy backstop, and it must be
reported as ahead rather than as validated — with the new caveat that it does not
reach short tokens.** The nearest sibling mechanism is
`vibeman/src/lib/logger.ts:32`, `^[A-Za-z0-9+/]{40,}={0,2}$`, anchored to a whole
field value so it cannot see a secret inside prose. Every other repo is a pure
prefix allowlist. **Confirming the cost of that: `brainiac`, `ascent`, `vibeman`
and `personas-web` would all fail to redact the exact token class that is
currently committed in `personas-cloud`** — only `brainiac`'s `\bsk-[…]{16,}`
catches it, and only incidentally.

**(d) The strongest negative result: the one repo with no redactor is the one
with a live token in git.** `personas-cloud/worker-debug.log`, **lines 3 and 11**,
**git-tracked in the HEAD tree** (not merely in history), added by commit
`bfcd005e8` on 2026-02-16 with the message `Share`, on a repo whose remote is a
GitHub URL. **Class: Anthropic OAuth access token, `sk-ant-oat` prefix family,
length 109; one distinct value, appearing twice.** It sits as the value of
`ANTHROPIC_API_KEY` inside a serialized `msg.env` dump. The same file embeds
absolute Windows paths carrying an OS account name on lines 6, 7, 14 and 15. The
repo's `.gitignore` has **no `*.log` rule**. No writer for the file exists in the
tree today, so it is a stranded artifact from a removed debug path — invisible to
code review, and it will not be regenerated, only re-leaked. **Reported as
location and shape only; no value, prefix or partial was read or recorded, and
this repository's own `secret-scan` would not have caught it because gitleaks is
not installed.** *(Out of this leaf's scope to fix; the token should be revoked
and the file purged from history.)*

**The clause the oracle refused to support.** I expected to prescribe *"scrub at
the error reporter"* as general doctrine, since that is where a redactor most
obviously belongs. **0 of 5 siblings have an error-reporter hook carrying
credential patterns**, and the two most interesting are opposite failures:
`brainiac` — the fleet's best redactor — initializes Sentry at `main.rs:250-266`
with `..Default::default()` and **no `before_send` at all**, so panics and
`tracing::error!`s ship unscrubbed past a firewall living two crates away; and
`personas-web` has the fleet's most thorough scrubber (message, exception values,
stack-frame vars, contexts, extra, tags, breadcrumbs, with a depth cap that
redacts on overflow) and **zero credential rules**. So the honest prescription is
not "scrub at the reporter" — it is **"the reporter needs the same pass as the
disk sink, and in five of six codebases it has a different one or none."** That is
why §2 leads with *enumerate the sinks*.

**One sibling technique worth importing wholesale.**
`brainiac/crates/brainiac-core/src/redact.rs:135` `masks_bearer_jwt_and_compound_oauth_keys`
exists because the module doc promised bearer coverage **that no rule
implemented**, and because `\btoken\b` can never match inside `access_token`
(`_` is a word character, so there is no boundary there). It is the only test in
six repositories that can catch a pattern matching nothing. **Personas has no
equivalent and has now shipped that exact class of bug twice** — the `gh[pous]`
literal in three files, and `sentry.ts`'s complete absence of credential rules.

## 7 Deviations

Every entry is live on `master` @ `bbb1a8864`, measured against the operator's
running installation.

> **Second pass — what is upstream of all of this.** Every item below reduces to
> one structural fact, and it is not the one yesterday's commit fixed. **Redaction
> in this repo is authored per-sink by whoever built the sink.** That is why there
> are 24 of them, why the eight credential lists disagree, why the one attached to
> Sentry's frontend has no credential rules, why PII is handled by exactly one
> function in one language, and why nothing exists on any read path — a read path
> has no author who felt responsible for a redactor. The fix that closes the most
> entries below is not a better pattern; it is **one composed pass, exported from
> one module, called at every sink, on both directions.**

### P0 — the backfill for the 2026-08-15 fix is still unwritten, and the data is still there

| Path | What's wrong |
| --- | --- |
| `db/src/repos/execution/executions.rs:766` | The doc comment states it: *"this only protects rows written from now on. The 114 values already persisted need a backfill, which is not done here."* |

**Verified today, 24 hours later:** `tool_steps` still holds **4 Google API keys
(len 39), 1 GitHub PAT (len 40) and 1 PEM private-key header** as literals, across
1,921 rows / **26.5 MB**, dated 2026-06-03 → 2026-06-26. Nine frontend files
render the column; the export bundle carries it; nothing prunes it.

**The backfill, specified safely.** It has three hazards and each has an answer:

1. **`executions_fts` is an external-content FTS5 table** whose `AFTER UPDATE`
   trigger fires only `OF input_data, output_data, error_message`. **A `tool_steps`
   backfill therefore needs no FTS handling at all** — but an `output_data` one
   does, and it gets it automatically *provided the update goes through SQLite
   with the triggers present*. Do not do this with a tool that disables triggers.
2. **Redaction is lossy and irreversible.** Run it as: `BEGIN IMMEDIATE` → for
   each row, `serde_json::from_str` → `redact_json_value` → **`serde_json::to_string`
   and re-parse to `Vec<ToolCallStep>`; skip the row if it does not round-trip**
   (the exact guard `redact_execution_fields:788-793` already uses) → `UPDATE …
   WHERE id = ?` → `COMMIT`. A row that will not round-trip is left alone and
   counted, not silently mangled.
3. **You cannot verify it afterwards without re-reading.** Emit a report: rows
   scanned, rows changed, rows skipped, and a per-shape count of matches
   remaining. **Never log a matched value.** Gate the whole thing behind
   `--dry-run` by default.

Then, and this is the part that is not code: **treat every credential of those
shapes as compromised and rotate it.** The values have been on disk for 50–74
days, in 26.5 MB of column data, in 419 MB of log files and in 998 MB of backups.

### P0 — the frontend Sentry scrubber has no credential patterns

| Path | What's wrong |
| --- | --- |
| `src/lib/sentry.ts:17-29` | `scrubPii` = UUID + URL + quoted-string. **No credential rule of any kind.** Replayed: **2 of 26** credential shapes masked, both incidental. |
| `src/lib/sentry.ts:213,219,227,236` | The four places it is applied — `event.message`, `exception.value`, event-attached breadcrumb `message`, standalone breadcrumb `message`. |
| `src/lib/sentry.ts:234-239` | `beforeBreadcrumb` scrubs `.message` only. `silentCatch.ts:81` and `silentFailureTelemetry.ts:198` attach raw error strings and full stacks under `data`. |

**Fix — one import and one line.** `maskSensitive.ts` already exports the
corrected pattern set as `sanitizeErrorMessage` (17/26 credential, 5/10 PII, 1/6
false positives). Compose it into `scrubPii`:

```ts
import { sanitizeErrorMessage } from '@/lib/utils/sanitizers/maskSensitive';
function scrubPii(input: string): string {
  return sanitizeErrorMessage(input)          // paths, IPs, hosts, emails, credentials
    .replace(UUID_RE, (m) => `[id:${m.slice(0, 6)}]`)
    .replace(URL_RE, …)
    .replace(QUOTED_RE, '[redacted]');
}
```
Then extend `beforeSend`/`beforeBreadcrumb` to walk `breadcrumb.data`, `extra`,
`contexts` and `tags` — `personas-web/src/lib/sentry-pii.ts` already does exactly
this recursion and is the reference to port.

### P0 — `error!`-level structured fields reach Sentry unscrubbed

| Path | What's wrong |
| --- | --- |
| `src-tauri/src/logging.rs:76-79` | `ERROR => EventFilter::Event`, `WARN => EventFilter::Breadcrumb`. |
| `sentry-tracing 0.34.0 converters.rs:155,180,213` | `event_from_event` puts scalar fields in **`event.tags`** and the rest in **`event.contexts["Rust Tracing Fields"]`**. |
| `src-tauri/src/main.rs:94-130` | `before_send` scrubs `user`, `request.data`, `message`, `exception.value`, breadcrumb `message`/`data`. **Not `tags`. Not `contexts`. Not `extra`.** |

**Measured: 179 matches across 79 files** for `error!(field = %v, …)`, of which 24
bind a rendered error. The `warn!` control is 916 across 262 — and every one of
those is scrubbed, because breadcrumbs go through `breadcrumb.data`.

**Fix — four lines in `before_send`:**
```rust
for (_k, v) in event.tags.iter_mut() { *v = pii::scrub(v); }
event.tags.retain(|k, _| !pii::is_sensitive_field(k));
for ctx in event.contexts.values_mut() {
    if let sentry::protocol::Context::Other(map) = ctx {
        map.retain(|k, _| !pii::is_sensitive_field(k));
        for v in map.values_mut() {
            if let sentry::protocol::Value::String(s) = v { *s = pii::scrub(s); }
        }
    }
}
```
**One edit corrects 179 call sites. No ratchet would move a single one** — which
is why §9 declines to gate the call sites and names this instead.

### P1 — PII is masked by one function, in one language, at five of ten shapes

| Path | What's wrong |
| --- | --- |
| `src/lib/utils/sanitizers/maskSensitive.ts:58-77` | The **only** path/IP/hostname redactor in the tree. Frontend-only. 5/10 PII shapes. |
| `src-tauri/core/src/error.rs:144` | The only Rust path masker — paths only, and its class `(?:[A-Z]:\\|/(?:tmp\|var\|home\|Users\|C:))` misses `/root`, `/opt`, `/srv` and UNC paths. |
| `core/src/redact.rs` | 0/10 PII. It is a credential redactor and does not claim otherwise — but `redact_execution_fields` is the only thing standing between model output and the column, so 0/10 is the system's PII policy. |
| — | **No redactor anywhere masks `DOMAIN\user` (596 live) or a bare OS username.** |

**Live cost: 42,761 PII matches**, 24,238 of them Windows user paths carrying the
operator's account name. **Fix:** port the five `maskSensitive.ts` rules into
`core/src/redact.rs` behind a second entry point (`redact_pii_string`), add a
`DOMAIN\user` class, compose both in `redact_execution_fields`, and **write down
which shapes are policy** — a decision that a path is acceptable in a given sink
is fine, but it has to be a decision.

### P1 — five render-time redaction toggles, and they are 5 of 14 total sanitizer invocations

| Path | What's wrong |
| --- | --- |
| `ExecutionListRow.tsx:180,238,245` | `showRaw ? execution.error_message : sanitizeErrorForDisplay(…)` ×2 and `showRaw ? execution.input_data : maskSensitiveJson(…)`. |
| `ExecutionDetailContent.tsx:167` | `showRaw ? execution.output_data : maskSensitiveJson(…)` — **and `:166` is a copy-to-clipboard of `execution.output_data`, raw, unconditionally.** |
| `ErrorExplanationCard.tsx:45` | `showRaw ? errorMessage : sanitizeErrorForDisplay(…)`. |
| toggles | `ExecutionList.tsx:69` + `ExecutionListFilters.tsx:59-70`; `ExecutionDetailContent.tsx:55` + `:112-113`. |

The masking is decoration: the raw string is in the IPC payload, the props, the
DOM and the clipboard regardless. **Fix:** stop sending it. See "Prefer a type
over a gate". §9 ratchets this until that lands.

### P1 — three of four durable disk sinks are unsanitized

| Path | What's wrong |
| --- | --- |
| `src-tauri/src/logging.rs:121-136` | The rolling daily `tracing` file. **2,644 `tracing::*!` sites** feed it; `logging.rs` does not import `sanitize_secrets`. 7-file retention. |
| `src-tauri/src/logging.rs:145-152` | WebView console messages funnelled into the **same** file, via `log_frontend_error` — frontend strings arrive verbatim. |
| `src-tauri/src/logging.rs:245-299` | Crash logs, panic payload plus `RUST_BACKTRACE=full` (forced at `:231`), written raw. **59 of 84 live `frontend_crashes` rows carry a redaction marker**, so the *frontend* crash path is covered and the Rust one is not. |
| `engine/src/logger.rs:61` | The one that **is** covered — and its doc comment (`:36-57`) already diagnosed the exact class for a different file. |

The fix that landed on `ExecutionLogger::log` is one line. It has not been applied
to the three sinks beside it. **Live: 419 MB of execution logs, 20 crash logs, and
998 MB of database backups** — all outside every redactor.

### P2 — one of eleven cloud-sync tables is redacted, and `input_data` is redacted by nothing anywhere

| Path | What's wrong |
| --- | --- |
| `src/cloud/sync/rows.rs:101` | `sanitize_event_payload` — the repo's **only** true network-egress redactor. Covers `persona_events.payload`. |
| `rows.rs:457,461,468,471,705,707` | The other ten synced tables go out verbatim: persona `system_prompt`/`structured_prompt`/`design_context`, message `content`/`metadata`, memory `content`, review `context_data`/`suggested_actions`/`reviewer_notes`, knowledge `pattern_data`. |
| `db/src/repos/execution/executions.rs` create path | **`input_data` is never redacted** — `redact_execution_fields` runs on the `UPDATE`, `input_data` is written by `create_with_idempotency`. It is then mirrored into `executions_fts` and synced. |

`persona_memories.content` alone carries **6,108 Windows user paths, 223 POSIX
home paths, 203 `DOMAIN\user` strings and 32 emails** across 6,535 rows, and syncs
off-device. **Fix:** `redact_secrets` is written, tested (`rows.rs:848-875`) and
four lines from covering the rest. Apply it to every free-text column in
`*_COLS`, and add a redaction call to the create path.

### P2 — `maskSensitiveJson` uses exact key matching where its sibling uses substring

`maskSensitive.ts:11` anchors `^…$`; `rows.rs:31` uses `k.contains(n)`. **Measured:
1/10 vs 4/10** on the same carriers. `github_token`, `gh_pat_value` and any bare
token value pass the frontend walker untouched. **Fix:** one-line change to
substring matching, plus a value-shape check — `redact_secrets` is the model.

### P2 — the entropy backstop's two constants contradict each other

`redact.rs:133` admits tokens of `len >= 20`; `:151` requires `>= 4.5` bits/byte,
which is arithmetically impossible below 22.63 characters. **Lengths 20–22 are a
dead band.** **Fix:** either lower the threshold on a length curve
(`4.5 * min(1, len/32)` or similar), or raise `MIN_LEN` to 23 and stop implying
coverage that does not exist — and in either case document that the sweep is a
*long-token* backstop, which is what makes step 2's subtraction mandatory rather
than optional.

### P3 — `scrub_secrets` receives `&[]` at 9 of 10 call sites

`auto_cred_browser.rs:335,912,973,991,1000,1012,1305,1358` pass `&[]`; only
`:1230` passes `&secret_literals`. The signature makes the weaker call look
complete. **Fix:** thread the held literals through, or split the function so the
no-literals form has a different, honest name.

### P3 — `sanitize_ledger_json` still fails open

`credentials.rs:642` returns the **unsanitized** metadata when masking breaks the
JSON. Carried from [column-encryption-at-rest](./column-encryption-at-rest.md) P3
and unfixed. `redact_string` cannot break surrounding JSON (`redact.rs:94-96`) and
`redact_json_value` re-parses before committing — either removes the reason the
fallback exists.

### P3 — the secret scan has never run on this machine

`scripts/secret-scan.mjs:23` prints `"gitleaks not installed — secret scan SKIPPED
(commit not blocked)"` and exits 0. **Executed today: exit 0.** The census
runner's own header (`run-census.mjs:22`) cites this file as a canonical example
of a gate that no-ops, and it is still wired into `lefthook.yml:26` as the D9
control. A sibling repo has a live token committed (§6 d) — this is what the
control was for. **Fix:** fail the hook when the scanner is absent, or vendor a
minimal shape scan so absence is not silence.

### Structural

- **Every deviation above shipped under a green `npm run check`.** No lint rule,
  test, script or CI job in this repo has any opinion about which sinks are
  redacted, whether a redactor covers the shapes it names, or whether PII is
  masked at all.
- **`sanitization.rs:103`'s unit test still feeds the matcher only inputs it
  already handles** — three labelled pairs, an email, and one prefixed token.
  Post-fix it would pass identically if `AIza`, `sk-ant-` and the JWT class were
  deleted again.
- **`ci.yml` has never passed — 0 successes in 260 all-time runs.** Nothing in §9
  depends on it.

## 8 Gaps — what the primitives genuinely cannot do

1. **No pattern can know next year's credential format.** Every prefix list in
   six repositories is a snapshot. The entropy sweep is the intended answer and
   §"headline 4" measures its ceiling: it cannot see short tokens. **Subtraction
   is the only technique with no such horizon**, and it only works where the
   process is holding the literal — which excludes every sink downstream of a
   subprocess.
2. **Redaction is lossy and irreversible, so it can only be applied where you are
   certain.** `redact.rs` is deliberately applied at persistence, not at stream
   emission, so the live terminal still shows the user their own output. That is
   correct, and it means every new persistence or egress site is a fresh decision
   no type can make. It is why the count is 24 and not 1.
3. **Two of the three biggest sinks are third-party types.** The rolling file
   sink is `tracing_appender`'s writer; the Sentry sink is
   `sentry::protocol::Event`. No newtype of ours appears in either signature, so
   the "make the sink refuse an unredacted string" answer reaches exactly one of
   the four disk sinks.
4. **A redactor cannot distinguish the operator's own data from a third party's.**
   24,238 Windows user paths carry the operator's account name on their own
   machine — arguably harmless locally, and unambiguously personal data the
   moment the row syncs, exports, or reaches Sentry. **This is a policy question,
   not a technical one**, and the absence of anyone having answered it is the
   actual gap.
5. **The census cannot assert an absence.** "Every sink is redacted", "no column
   holds an unmasked path", "this scrubber covers the shapes it names" are
   completeness conditions. The replay harness in §6 is the instrument for those
   and it must be **re-run**, not ratcheted.
6. **A regex cannot be tested by a regex.** The only thing that catches a rule
   matching nothing is a fixture of the real shape plus a meta-assertion that
   every pattern matched something. That is a test-design gap, and
   `brainiac/redact.rs:135` is the one instance of it in six repos.

## Prefer a type over a gate — the answer for this leaf

Held against all seven qualifications. **The obvious candidate is a `Redacted`
newtype that sinks demand. My answer is that it reaches one sink of four, and the
type that actually helps is a smaller, meaner one: the IPC payload should not
contain the raw string at all.**

**Q1 — a required type carries only what it encodes.** `Redacted(String)` encodes
*"someone called a redactor"*. It does not encode *which* redactor, and that is
the whole defect here: `scrubPii` and `redact_string` both produce a redacted
string, and one covers 2/26 while the other covers 24/26. A type that both
satisfy distinguishes nothing. Test it against this document: it prevents none of
P0 (frontend Sentry has *a* redactor), none of P1-PII, none of the entropy floor,
none of the backfill.

**Q2 — requiredness is orthogonal to closedness.** Making a sink's parameter
`Redacted` makes it *required*. It does not close the set of things that can
produce a `Redacted` — which, with 24 producers, is the live problem. The
closedness fix is deleting producers, and no signature does that.

**Q3 — a type nobody constructs constrains nothing.** Counted: `redact_string`
has **6** production call sites in 963 Rust files, all inside one function.
`sanitize_secrets` has 19. The construction surface for a `Redacted` newtype is
tiny — but **the sinks are the problem, not the constructors**, and two of the
four disk sinks take third-party writer types (Gap 3). The type reaches
`ExecutionLogger::log` and nothing else.

**Q4 — a type anyone can construct authenticates nothing.** `Redacted(pub String)`
is a comment. And the live analogue is instructive: `scrub_secrets(text, known)`
accepts `&[]` for `known` at 9 of 10 sites, so the *parameter* that carries the
strong half of the control is satisfiable with nothing. A required parameter you
can satisfy with an empty value is not a constraint.

**Q5 — withholding beats requiring.** This is where the real answer is.
`PersonaExecution` today hands the frontend `tool_steps`, `output_data`,
`input_data`, `error_message` and `execution_config` as plain strings, and the
frontend *chooses* whether to mask. **Stop sending the raw text.** If the IPC
payload carries only the redacted string, `showRaw ? raw : mask(raw)` is not a bad
choice — it is unwriteable, because `raw` does not exist in that scope. All 5
sites in P1 vanish, and so does the DOM copy, the devtools copy, the React
DevTools copy and the raw clipboard write at `ExecutionDetailContent.tsx:166`.

**Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is
*the raw string arriving in the payload that populates every list row*. The
**answer** is the operator's legitimate need to debug their own run, and taking
that away breaks the feature — Q6's exact warning. So the cut is: the list/detail
payload carries redacted text only, and rawness moves behind a **separate,
explicitly-named command** (`get_execution_raw`) with its own audit row. That is
the same split `brainiac` reached at `mcp.rs:2393` — redact on the way out of the
API, and make the unredacted form a different, deliberate act.

**Q7 — withholding a requirement only helps when the requirement forced the bad
value.** ✔, and it keeps the scope honest. Nobody is *forced* to render the raw
string; the components ask for it voluntarily because it is sitting in the props.
So relaxing a signature is inert, and the construction of the ambiguous state —
a payload holding both a redacted and an unredacted rendering of the same field —
is what must be withheld. That is a DTO change, not a newtype.

**And the honest limit, which is P0 and P1-PII.** No type reaches the frontend
Sentry scrubber's missing patterns, the four unscrubbed Sentry event fields, the
entropy floor, the 42,761 PII matches, or the 1,921 rows already on disk. Those
are content, arithmetic, policy and data. **Recommended, in order:** (1) the four
lines in `before_send` — one edit, 179 call sites; (2) the one import in
`sentry.ts` — one edit, the whole off-device channel; (3) the backfill per P0;
(4) `redact_pii_string` and a written PII policy; (5) the DTO change above; (6)
keep §9's ratchet until (5) lands, then delete the rule.

## 9 The missing gate

### The condition, stack-free

> **A redactor is invoked as one branch of a conditional whose other branch is the
> unredacted value — so the redaction is a presentation choice made after the
> value has already crossed the boundary, not a boundary the value had to cross.**

The give-away is that both forms are in scope at the same point. Wherever that is
true, the mask is cosmetic: the raw value is already in the payload, the render
tree, the memory dump, the devtools inspector and anything that copies from them.
There is no runtime signal — a redactor that is switched off and a redactor with
nothing to redact produce visually similar output, and the toggle is a *feature*,
so it survives review.

**The proxy, for this stack:** a JavaScript ternary whose false-branch is a call
to one of this app's sanitizers. It is a proxy, not the condition — an adopting
repo should re-derive one against its own idiom (a Rust `if verbose { raw } else
{ redact(raw) }`, a template `{% if %}`, a feature flag read beside the mask).

### Existing rules checked first

I read all **98** rules in `scripts/census/rules.json` before authoring, and
checked these six by name:

- **`secret-as-bare-string-field`** (`secret-display-and-transfer.md`, 10 files /
  12, `roots: ["src-tauri"]`) — a `pub` struct field with a secret noun typed
  `String`. At-rest and Rust-only; mine is TypeScript and keys on a call
  expression. **Zero overlap by root and by extension.**
- **`settings-key-holding-secret`** (`app-settings-store.md`, 1/3,
  `roots: ["src-tauri/db/src"]`) — a const declaration. Disjoint.
- **`redirect-portable-credential-header`** (`outbound-http-call.md`, 9/22) — an
  outbound request header. In-flight, Rust, no overlap.
- **`unqueryable-log-record`** (`structured-logging.md`, 67/288) — a `tracing!`
  macro interpolating into its message. **Adjacent and important**: my §7 P0
  shows its prescribed *fix* moves values into `event.tags`/`contexts`. Zero
  match overlap (no `tracing!` call contains a ternary over a sanitizer), and the
  interaction is documented in prose rather than gated.
- **`raw-error-as-toast-message`** (`toasts.md`, 12/20) and
  **`unresolved-error-as-inline-copy`** (`error-message-resolution.md`, 87/123) —
  both key on a raw-error *expression* in argument-one position. Mine keys on the
  presence of a **sanitizer call** in ternary-false position. Different anchors;
  I checked the file lists and found **no shared file**.

**Zero of the 98 existing rules look at whether a redactor was applied
conditionally.** Every one gates a call site, a declaration, a type or a
statement's arguments; none asks whether a safety transform was optional.

### The rule

```json
{
  "id": "render-time-redaction-toggle",
  "goldenPath": "docs/concepts/golden-paths/secret-and-pii-redaction.md",
  "title": "A redactor is applied in a ternary whose other branch is the raw value — so the redaction is a render-layer choice a UI control can switch off, not a boundary the value had to cross.",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\?\\s*[A-Za-z_$][\\w$.?]{0,60}\\s*:\\s*(?:sanitizeErrorForDisplay|sanitizeErrorMessage|maskSensitiveJson|redactObject|scrubPii)\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A ternary whose FALSE branch calls one of this app's redaction functions and whose TRUE branch is a plain identifier or member expression — i.e. the unredacted value. PROXY FOR the stack-free condition: 'a redactor is invoked as one branch of a conditional whose other branch is the raw value, so the redaction is a presentation choice made after the value already crossed the boundary.' MEASURED 2026-08-16 at bbb1a8864: 3 files / 5 matches, ALL FIVE HAND-READ (precision 5/5) — src/features/agents/sub_executions/components/list/ExecutionListRow.tsx:180,238,245 (showRaw ? execution.error_message : sanitizeErrorForDisplay(...) twice, and showRaw ? execution.input_data : maskSensitiveJson(...)); src/features/agents/sub_executions/detail/ErrorExplanationCard.tsx:45; src/features/shared/components/modals/ExecutionDetailModal/ExecutionDetailContent.tsx:167 (showRaw ? execution.output_data : maskSensitiveJson(...)). The two toggles that drive them are ExecutionList.tsx:69 + ExecutionListFilters.tsx:59-70 and ExecutionDetailContent.tsx:55 + :112-113. WHY IT IS A DEFECT AND NOT A PREFERENCE: for the ternary to typecheck, the raw string must already be in scope at the render layer — so it is in the IPC response, in the React props, in the DOM, in the devtools inspector, and at ExecutionDetailContent.tsx:166 it is ALSO handed to a copy-to-clipboard button one line above the masked render. The mask is decoration over a value that already crossed every boundary that mattered. These 5 matches are 5 of the 14 total invocations of this app's frontend sanitizers — more than a third of all frontend redaction is switchable off by a button. LEGAL FIX: stop sending the raw text. Make the IPC payload carry only the redacted string and move rawness behind a separate, explicitly-named, audited command; then the ternary is not a bad choice, it is unwriteable, because the raw value does not exist in that scope. brainiac reached the same cut independently at crates/brainiac-server/src/mcp.rs:2393, redacting a source excerpt BEFORE truncation on the way out of the API. DO NOT silence a match by hoisting the ternary into a variable, by moving the condition into the sanitizer's own arguments, or by renaming the sanitizer — all three preserve the defect exactly and merely hide it from this signal; the honest fix always removes the raw value from the scope. END OF LIFE: this rule is designed to reach zero. When it does, the runner fails structurally on zero matches BY DESIGN — DELETE the rule then, do not baseline it at 0.",
    "$measured": "2026-08-16 @ bbb1a8864 — 4,829 files walked; validated standalone in a scratch registry unique to this composer, then re-extracted from this finished document and re-run through the real runner: 3/5 both times; 0.672 s for rule + control together."
  },
  "baseline": { "files": 3, "matches": 5 },
  "floor": 3000
}
```

### The positive control (evidence, NOT a gate — carries no baseline)

```json
{
  "id": "render-time-redaction-toggle-positive-control",
  "goldenPath": "docs/concepts/golden-paths/secret-and-pii-redaction.md",
  "title": "POSITIVE CONTROL — not a gate. The same redaction functions invoked UNCONDITIONALLY, the compliant form the rule must never report.",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:=|\\(|\\{|return|,|^)\\s*(?:sanitizeErrorForDisplay|sanitizeErrorMessage|maskSensitiveJson|redactObject|scrubPii)\\s*\\(",
    "flags": "gm",
    "ignoreCommentLines": true,
    "description": "NOT A GATE — the shape-discrimination control for render-time-redaction-toggle, and it carries no baseline by design. Same root, same extensions, same file walk, SAME FIVE FUNCTION NAMES; the only difference is the syntactic position of the call. The rule requires the call to be the FALSE BRANCH of a ternary (preceded by `? <expr> :`); the control requires it to be preceded by an assignment, an open paren, an open brace, `return`, a comma, or line start. THE TWO POPULATIONS ARE MUTUALLY EXCLUSIVE BY CONSTRUCTION and, measured, share ZERO FILES — not merely zero matches. MEASURED 2026-08-16 at bbb1a8864: 5 files / 9 matches versus the rule's 3 / 5. Control files: src/lib/sentry.ts:213,219,227,236 (four unconditional scrubPii calls in beforeSend/beforeBreadcrumb — note this file is the compliant form STRUCTURALLY while being the weakest redactor in the tree by coverage, which is precisely the point: this control discriminates on WHETHER redaction is optional, not on whether it is any good, and the two questions must not be conflated), src/lib/utils/sanitizers/maskSensitive.ts:28,44 (redactObject recursion and its entry call), src/lib/utils/crashPersistence.ts:30, src/lib/utils/sanitizers/sanitizeCloudReview.ts:55, src/lib/utils/sanitizers/sanitizeErrorForDisplay.ts:82. If the rule were keying on the sanitizer NAMES rather than on the conditional position it would light up all five of these files too and report the app's entire redaction layer as violating; it reports none of them. Run both together whenever the rule's pattern is edited: if this control's count collapses, the walk or the anchors broke rather than the codebase being fixed. It is expected to RISE as redaction spreads, which is exactly why it must never be baselined.",
    "$measured": "2026-08-16 @ bbb1a8864 — 5 files / 9 matches via the real runner; 0 file-level overlap with the rule."
  },
  "floor": 3000
}
```

### Verification of this gate's own preconditions

- **`floor: 3000`** against **4,829** files actually walked under `src`, matching
  the `raw-select` / `unverified-clipboard-write` precedent for this root — rules
  over one root must not hold different opinions about what "the tree is intact"
  means. A typo'd root walks 0 files and trips both `floor` and the zero-match
  structural failure.
- **Backtracking checked, not assumed.** The pattern is one bounded character
  class with a `{0,60}` quantifier, one alternation of literal names, no nested
  quantifier, no lookaround, no variable-length lookbehind. **Real-runner wall
  time over 4,829 files: 0.672 s for rule and control together.**
- **Portable to a Rust-side checker**, unlike the previous batch's `(?!_)` — this
  signal uses no lookaround, so the `regex` crate accepts it verbatim.
- **The rule must reach zero and then be DELETED**, not baselined at 0. The census
  cannot express "must be zero", and a rule pinned at 0 can never fail. The DTO
  change in "Prefer a type over a gate" removes all 5 matches at once.
- **Re-extraction check performed.** Both blocks above were pasted back out of
  this finished document into a scratch registry unique to this composer
  (`rules-secret-and-pii-redaction-probe.json`) and re-run through the real
  runner — `node scripts/census/run-census.mjs --rules <scratch>/…` — not a
  re-implementation. Identical: **3 files / 5 matches / 4,829 walked / floor
  3000**, and **5 files / 9 matches**, no baseline, no structural problems.
- **No `exclude` entries.** All 5 matches are true positives, so there is no
  legitimate exemption and no stale suppression can accumulate.
- Do **not** run `npm run census -- --update` against a registry containing the
  positive control; `updateBaselines` dereferences `baseline.files`
  unconditionally.
- **Where it runs:** `npm run census` / `npm run census:check`, which are part of
  the local gate chain. **Not CI** — `ci.yml` has never passed in 260 all-time
  runs, so a gate that only runs there runs nowhere.

### Gates I rejected, with numbers

| candidate | violating | compliant control | why rejected |
| --- | ---: | ---: | --- |
| **ERROR-level tracing macro with a structured field** (`error!(k = %v`) | **79 files / 179** | 262 files / 916 (`warn!`, whose fields ARE scrubbed) | The cleanest *measurement* in this document and the **worst gate**. It fires on exactly the shape [structured-logging](./structured-logging.md)'s `unqueryable-log-record` (67/288) tells you to write — so shipping it would put two rules in the corpus in direct opposition, and the "compliant" form under one is the violation under the other. Worse, it is the contract's fifth failure mode inverted: **the defect is not at the 179 call sites, it is the four missing lines in `before_send`.** One edit corrects all 179 and no ratchet would move a single one. Carried as §7 P0 instead. |
| **a mask-marker literal in a `replace` call** (`"[REDACTED]"`, `"[secret]"`, …) | 4 files / 7 (Rust), 3 files / 8 (TS) | — | The intended reading is "you are writing an Nth redactor", and the measured matches are **the sanctioned redactors themselves** (`sanitization.rs:72,92`, `main.rs:263,272`, `maskSensitive.ts:133-140`). A gate that reports the modules this path tells you to use is a to-do list, not a ratchet, and its positive control would be empty. The genuine condition — *"this pattern set duplicates one that already exists"* — is a relationship between two files and cannot live in the census. |
| **any credential-prefix literal** (`ghp_`, `sk-ant-`, `AIza`, `AKIA`, `xox[`) | 12 files / 57 | — | Fires on connector catalogues, fixtures and doc constants alongside real pattern sets; hand-sampling put precision well under 50%. Also ~100% file overlap with the retired `delimiterless-credential-prefix-class` territory. |
| **`toastCatch(` with no `sanitizeErrorForDisplay` nearby** | 391 invocations / 207 files | 3 | The largest number in the document (0.77% coverage) and an unusable gate: `toastCatch` is the *prescribed* error door in `CLAUDE.md`, so the rule would fire on 391 correct call sites to express a policy that does not exist yet. **A gate that fires on correct content is worse than no gate.** The honest instrument is a decision about whether user-facing error text should be sanitized by default — carried as §7 P1 and as the `sanitizeErrorForDisplay` default, not as a ratchet. |

The general limit worth restating: **the census can ratchet a condition present in
a statement, and can say nothing about a condition that is a relationship** —
between a redactor and the sinks it does not reach, between a pattern list and the
tokens it must match, between a scrubbed field and its unscrubbed sibling on the
same event. Every headline in this document is one of those, and each was found by
**executing something**: replaying ten redactors against 49 shapes in two engines,
scanning 2.2 million cells for what is actually in them, and running one
20,000-trial simulation that turned "there is an entropy backstop" into "the
entropy backstop cannot fire below 23 characters."

## 12 Corrections to the brief

The brief primed eight leads. **Six survive, one is materially understated, and
one needed a correction I could only make by re-running the measurement.** All
eight were tested rather than assumed.

**1. "All three copies of the broken prefix regex were fixed on 2026-08-15 —
measure what they cover NOW." — CONFIRMED, and the fix is real.** All three files
(`core/src/utils/sanitization.rs:66`, `src/main.rs:213`,
`src/lib/utils/sanitizers/maskSensitive.ts:102`) now carry the corrected
nine-class alternation with `gh[pousr]_`, `sk-ant-`, `AIza` and the JWT triple.
Replayed in two engines: all five GitHub prefixes, Google, Anthropic, OpenAI,
Slack and JWT now mask. **But the fix's own claim of "13 masked / 13" was measured
against 13 shapes; against 26 the same patterns reach 17.** The three still miss
`github_pat_`, `sk-proj-`, PEM blocks, Notion, Linear, SendGrid and every bare
high-entropy token, because they copied `redact.rs`'s **prefix list** and not its
**entropy sweep**. And **the fix found three copies because it searched for the
broken literal — so it could not find the fourth redactor, `src/lib/sentry.ts`,
which never had the literal and has no credential rules at all.** That is the
sharpest lesson available here: *a search keyed on the bug cannot find the code
that never had it.*

**2. "`redact_execution_fields` was extended to all 6 fields including a recursive
JSON walker; 114 values were NOT backfilled." — CONFIRMED on both halves, with a
correction to the count.** The extension is live at `executions.rs:767-800` and
the walker (`:802`) correctly redacts values, leaves keys, and re-parses before
committing. The backfill is still unwritten, verified 24 hours later against the
running installation. **My own template-vs-literal classification puts the
surviving high-confidence literals at 6, not 9** — 4 Google keys (len 39, not 7),
1 GitHub PAT (len 40), 1 PEM header — because 3 of the 7 Google-shaped matches sit
within 60 characters of template markers. The 104 labelled `key = value`
assignments are a separate, softer population I did not re-classify.
**P0 specifies the backfill, including the `executions_fts` interaction that would
have been easy to get wrong in either direction.**

**3. "2,991 execution log files, 406.6 MB, contain credential shapes; nothing
prunes or sanitizes what is on disk." — CONFIRMED and larger.** Measured today:
**2,999 files / 419 MB**, plus 20 crash logs and — not in the brief —
**998 MB of database backups across 9 files**, which are verbatim copies of every
plaintext column and sit outside every redactor and every retention policy. I did
not re-scan the log contents; those belong to
[retention-and-pruning](./retention-and-pruning.md).

**4. "`sanitize_ledger_json` returns the raw metadata when masking breaks the
JSON." — CONFIRMED, unchanged at `credentials.rs:642`.** Carried as P3.

**5. "There are at least five disagreeing definitions of the Slack token class."
— UNDERSTATED, and the framing was too narrow.** There are **three** surviving
Slack classes (`xox[baprs]-` in four files, `xox[bpoa]-` in `ambient_context.rs`,
bare `xox` prefix-match in `cloud/sync/rows.rs`) — but Slack is the least of it.
**There are 24 redaction implementations, 10 of which mask credential or PII
values, 8 of which carry their own credential-shape list, and no two of the 8
agree on anything measured.** Six different mask markers are in use. Counting
Slack classes measures a symptom; the population count is the finding.

**6. "`core/src/redact.rs:151` has a Shannon-entropy backstop no sibling repo
has." — CONFIRMED on both halves, and now qualified for the first time.** The 5/5
sibling silence is real (§6 c). And the backstop **cannot fire below 23 characters
by arithmetic** — `log2(n) < 4.5` for `n < 22.63` — with measured catch rates of
0% at 20 chars, 4.6% at 24 and 46.2% at 30. It is a long-token backstop. This does
not diminish the convergence result; it changes what the corpus should claim for
it, and it is why §2 leads with subtraction rather than with the sweep.

**7. "The pre-commit `gitleaks` hook prints SKIPPED and exits 0." — CONFIRMED by
execution**, not by reading: `node scripts/secret-scan.mjs` → exit 0, control
never ran.

**8. "A sibling repo has a plaintext Anthropic OAuth token committed in a tracked
`.log` file." — CONFIRMED, and worse than framed.**
`personas-cloud/worker-debug.log` lines 3 and 11, **git-tracked in HEAD**, added
by `bfcd005e8` (2026-02-16, message `Share`), remote on GitHub, `sk-ant-oat`
class, 109 characters, one value appearing twice, sitting as `ANTHROPIC_API_KEY`
inside a serialized `msg.env` dump; lines 6/7/14/15 also carry absolute Windows
paths with an OS account name; the repo's `.gitignore` has no `*.log` rule. The
brief called it "out of scope but relevant to convergence" — **it is the strongest
convergence result in the document**, because `personas-cloud` is the one sibling
of five with no redactor at all, and because four of the five fleet redactors
would not have masked that token class anyway.

**Three corrections to my own work, all earned by measurement.**

**(a) My first instrument understated the repo's best module by three shapes.**
The fixture generator used an LCG with `state % 62`; an LCG's low bits are
periodic, so the "random" bodies had depressed Shannon entropy and `redact.rs`
scored **21/26** instead of **24/26**. I would have published three false leaks
against the one module this path tells you to use. Switching to SHA-256-derived
bytes and asserting the fixture clears 4.5 bits/byte (measured 4.734) fixed it.
**An instrument that makes the subject look worse is exactly as broken as one that
flatters it**, and only the doctrine's "assert the instrument" rule caught it.

**(b) My two implementations disagreed on 2 of 294 cells and I nearly averaged
them.** Both were mine: Python's `urlsplit().netloc` **includes** userinfo where
WHATWG `URL.host` **excludes** it, so my Python R4/R5 leaked a basic-auth password
the shipping code masks. The JS run is faithful; the Python one was a
transliteration bug. **Agreement on 292 cells was not what made the result
trustworthy — chasing the 2 was.**

**(c) I expected the headline to be "the redactors still miss credentials." It is
not.** The 2026-08-15 fix genuinely closed most of the credential gap, and the
scan that proved it also returned **42,761 PII matches against 6 literal
credential values** — a ratio nobody in six repositories has ever measured,
because nobody in six repositories masks a hostname or a username. I only know
that because I scanned for PII shapes alongside credential shapes; a composer who
had scanned only for what the brief named would have written "the fix worked,
minor gaps remain" and missed the actual subject of the leaf by three orders of
magnitude.

**And one correction offered upward to the corpus.** [structured-logging](./structured-logging.md)'s
`unqueryable-log-record` prescribes moving variable content out of a `tracing!`
message and into structured fields. In *this* stack that migration is safe at
`warn!` and unsafe at `error!`, because `sentry-tracing` turns the former into a
breadcrumb (whose `data` `before_send` scrubs) and the latter into an Event (whose
`tags` and `contexts` it does not). **Two individually-correct golden paths can
compose into a defect, and nothing in the contract currently asks a composer to
check the neighbours' prescriptions against their own.** The doctrine's
"compose across dimensions" rule covers the dimensions *within* a path; this is
the same hazard *between* paths, and it is worth a line.
