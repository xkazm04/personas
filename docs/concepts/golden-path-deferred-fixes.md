# Deferred fixes — found, measured, deliberately not applied

Defects the golden-path campaign found and **did not fix**, because applying
them would change how the app behaves while the operator is using it. Each is
measured, each names its site, and each says what the fix would change.

**This list exists so the campaign can keep moving without touching the running
app.** Standing rule, set by the operator 2026-08-16: *no destructive applies —
note the gap instead.* A fix belongs here, not in a commit, whenever it would
alter runtime behaviour, delete data, or change what a surface shows during use.

Ordered by consequence.

---

## 1. A failed key read regenerates the key and destroys the vault

**`src-tauri/core/src/crypto.rs:629`**

```rust
if let Ok(Some(existing)) = load_local_fallback_key() { … }
// …falls through to: mint a fresh key and overwrite master.key
```

The `if let Ok(…)` discards `Err` from **five distinct causes** — I/O failure,
base64 failure, DPAPI-unprotect failure, wrong key length, unauthenticated legacy
format. Any of them regenerates the key and overwrites `master.key`.

**Live exposure: 5,008 encrypted values**, unrecoverable. `master.key` is 358
bytes, written once on 2026-04-04 and untouched for 134 days while the app logged
9,431 decrypts. There are **997 MB of automatic ciphertext backups and zero
backups of the key**.

**0 of 5 sibling repos do this.**

**Why not applied:** the correct fix refuses to start rather than regenerating —
trading availability for durability at boot. A transient read failure would then
block startup. That is a judgement about which failure the operator prefers, not
a bug fix.

**Shape of the fix:** match on the `Err` explicitly; on a read failure, propagate
rather than mint. Optionally: never overwrite an existing `master.key`, even when
minting, so a bad read is recoverable.

**Related, same file, same decision:** `crypto.rs:588-596` and `:605-608` return
`Ok` without the keychain holding the key (a `set_password` failure is only a
`warn!`), and both record `KeySource::Keychain` — which the UI renders as
*"Master key in OS Keychain — protected by your OS login"*, one line below an
`info!` saying the key came from the file.

---

## 2. Credentials reach the terminal view and the clipboard unmasked

**`src-tauri/src/engine/runner/mod.rs:2179-2188`** (emit), with
**`src/features/agents/sub_executions/components/runner/ExecutionTerminal.tsx:42`**
and **`src/features/agents/executionPlayer/ExecutionMiniPlayer.tsx:62`** (copy).

`display_text` is derived from the **raw** line at `:2176`. The
`sanitize_secrets` call at `:2173` masks only the logger's own copy. **12
`ExecutionOutputEvent` construction sites, 12 unredacted**, and
`src-tauri/src/background_job.rs` has no redaction at all, covering 19 more
streams.

The *read* command masks (`commands/execution/executions.rs:658,703,716`) with a
nine-line comment naming **the copy button** as the reachable path — and the copy
button reads the unmasked live buffer.

**Reconstructed from the log corpus: 15,363 credential- and PII-shaped matches
reached the live view** — 8,379 Windows user paths, 6,230 POSIX home paths, 698
emails, 44 labelled assignments, 9 Google-API-shaped, 2 GitHub-PAT-shaped, 1 PEM
header. A lower bound; the files have been masked on write since 2026-08-14.

**Why not applied:** two chokepoint edits fix every stream, and both change what
the operator sees on a surface they watch live while debugging. Masking can hide
the thing you are debugging.

**Shape of the fix:** redact `display_text` at the emit site and the line pushed
into the ring — two edits covering all 31 streams. Consider a per-session
"show raw" affordance so debugging keeps its escape hatch.

---

## 2b. A consent modal re-grants telemetry that the user refused

**`src/features/onboarding/.../FirstUseConsentModal.tsx:142` and `:149`**

The modal re-opens whenever `CONSENT_VERSION` is bumped, initialises its
telemetry checkbox with `useState(true)` — **never reading
`isTelemetryEnabled()`** — and writes that value on Accept.

Replayed across 8 scenarios x 3 storage modes: a user who opted out and then
upgrades goes from `telemetry_enabled = "false"` to `"true"` **on one click of a
button labelled Accept**.

**It has shipped twice.** `CONSENT_VERSION` went `'1'` -> `'2'` (2026-04-04) and
`'2'` -> `'3'` (2026-04-17, commit subject: *"fix wrong GitHub source link"*).
**A hyperlink correction re-granted telemetry consent for everyone who had
refused it.**

Second replay result: on a storage-hostile profile the refusal evaporates
entirely — `telemetryPreference.ts:17`'s `catch` returns `true` — and the modal
re-asks forever, silently.

Supporting measurements: `isTelemetryEnabled()` has **2 call sites in 4,829
files**, against **21 direct `@sentry/*` importers of which 21 emit and 1
consults it**. There is 1 `Sentry.init` and **0 `Sentry.close`**, so withdrawing
consent mid-session tears down nothing.

**Why not applied:** the fix changes what the modal shows and what a live
consent surface does. It is small — read the stored preference into the
initialiser — but it is the operator's call.

**Shape of the fix:** initialise from `isTelemetryEnabled()`; make the storage
read fail *closed* rather than returning `true` from its `catch`; and add a
`Sentry.close()` on withdrawal.

---

## 2c. A delete confirmation understates what it deletes by 65x

**`src/features/overview/sub_memories/components/MemoriesPageDense.tsx:388`**

The dialog reads *"This permanently deletes all **100** memories"*. The 100 is
`memories.length` — the **page size** (`memorySlice.ts:112` fetches with
`limit = 100`). `delete_all_memories` runs
`DELETE FROM persona_memories WHERE tier != 'core'` — **6,535 rows**.

The true total is destructured in the *same component* at `:57` and rendered in
its own header at `:194`. Three numbers for one question, 194 lines apart.

Two aggravating facts: there are **0 core-tier rows**, so the exemption protects
nothing; and this is the one of three memory-delete doors that **leaves the 5,158
KNN vectors behind** (`db/src/repos/core/memories.rs:1052`).

**Why not applied:** changing what a destructive confirmation says is a change to
a live surface, and the right number depends on whether the exemption should
stay.

**Shape of the fix:** render `memoriesTotal`, already in scope at `:57`.

---

## 2d. A public command returns live cloud tokens in plaintext

**`src-tauri/…/cli_capture.rs:818`** — `cli_capture_run`

Absent from both `PRIVILEGED_COMMANDS` (192) and `CLOUD_COMMANDS` (50), and its
in-body `require_auth` is the documented no-op. It returns the live `gh` /
`gcloud` / `aws` token in plaintext.

**0 production UI callers** — the only caller is the test-automation bridge. So
the exposure is latent, and closing it costs nothing a user would notice.

**Why not applied:** it is an authorization change, which is the operator's call
under the standing rule — and it is entangled with deferred item 4, since the
in-body guard it would rely on cannot fail.

---

## 3. `export_credentials` exports nothing and reports success

**`src-tauri/…/data_portability.rs:9560,:9582,:9604-9661`**

All 134 connector definitions are builtin; 23 of 23 credential service-types
match a builtin name; the `continue` at `:9582` therefore skips **all 25
credentials**. The envelope is still derived, encrypted and written. There is no
empty check. The return type is `Result<bool>` meaning "the user picked a path",
and the UI renders success.

Its twin `build_encrypted_credentials` (`:9347`), 200 lines away in the same
file, is the same loop without the filter and emits **25 credentials / 42
fields**.

**Why not applied:** deciding which of the two behaviours is correct is a product
question — whether a portable bundle should carry builtin-connector credentials
at all.

---

## 4. The whole-vault export has one authorization statement and it cannot fail

**`src-tauri/src/ipc_auth.rs`** (the list) and the eight commands commented out of
`PRIVILEGED_COMMANDS`.

`export_credentials` (doc: *"Export all credential secrets"*),
`import_credentials`, `export_full`, `import_portability_bundle(_from_path)` and
`execute_api_request` are commented **out** of the privileged list, each citing a
monkey-patch race, each relying on the in-body guard as compensation.

`require_privileged` checks a `OnceLock` set above the Tauri builder, so **its
`Err` branch is dead**. It is the sole authorization on 86 commands.

**Why not applied:** re-listing them is a behavioural change whose correctness
depends on whether the race they cite is real — and the fourth enforcement layer
those comments rely on **never installs** (proved: the property descriptor is
non-writable and non-configurable, so the patch throws and the outer catch
returns success). The two questions are entangled and need a decision, not a
patch.

---

## 5. An unauthenticated loopback route spawns a billed subprocess

**`src-tauri/src/commands/infrastructure/dev_tools_http.rs:468-510`**, mounted at
`src-tauri/src/lib.rs:987-990`.

`POST /dev-tools/scan-codebase` and `POST /dev-tools/projects` take **no
credential** and reach `spawn_headless_claude` with `exec_dir` set from a
caller-supplied `root_path`. Only check between them: `root_dir.is_dir()`.
Verified live: `GET /dev-tools/projects` returns 200 with no credential, while
`:9420/api/personas` returns 401 in the same probe.

The module header's reasoning has true premises and a false conclusion: *a tier
is a fact about a token; a population is a fact about a bind address.* Any local
process, and any web page the operator visits, can POST to `127.0.0.1`.

**Why not applied:** authentication would break how the bridge is invoked from a
terminal today.

**Shape of the fix, cheapest first:** reject requests carrying a browser `Origin`
/ `Sec-Fetch-Site` header (closes the web-page vector, leaves `curl` working);
or require the same bearer token `:9420` already validates; or gate the router
behind a feature flag as the test bridge already is.

---

## 6. Retention deletes nothing, and turning it on removes ~6,700 rows

**`events::cleanup`** (status allowlist names `Completed`, which has 0 live rows,
and omits `Delivered`, which has 4,941) and **`cleanup_old_executions`**
(`min_keep_per_persona=50` × 59 personas = a floor of 2,950 against a 2,188-row
table, so every persona takes the skip branch).

**Why not applied:** the first run deletes roughly 4,941 event rows and 1,776
execution rows.

**Prerequisite already shipped:** `idx_tas_execution`, without which that first
run is a ~26-second app-wide write stall (measured: 26,016 ms → 1,066 ms).

Related and unfixed: **54% of the 331 MB database is recoverable freelist** — a
VACUUM measured 6.3 s and produced 153 MB — and `VACUUM` appears nowhere in the
tree except a guard rejecting `VACUUM INTO`.

---

## 6b. A bare Enter starts a billable run, and key-repeat multiplies it

**`src/features/agents/sub_executions/libs/useRunnerExecution.ts:119-145`**

An unmodified **`Enter`** with nothing focused calls `executePersona()`
(`:112`). No modifier, no confirmation, no cost shown. Replayed in jsdom against
the transcribed handler: **1 press = 1 billable run; 5 key-repeats = 5 runs.**
`e.repeat` is never consulted, and the only guard is `isExecuting`, which is
React state and therefore one frame late.

**Why not applied:** a `e.repeat` guard is strictly protective, but it changes
how a live surface responds to the keyboard, which is the operator's call under
the no-behaviour-change rule.

**Shape of the fix:** bail on `event.repeat`; consider requiring a modifier, and
move the in-flight guard to a ref so it is not a frame behind.

**Context that makes it worse:** the app's keyboard ownership registry is
structurally unable to win — `document` precedes `window` in the bubble path, so
a raw `document` listener beats every rank including the highest the app uses.
Measured: 72 of 90 global bindings are registered outside the registry, one
`Ctrl+K` fires 3 actions, `?` opens 2 help overlays, and `exclusive: true`
suppresses 0 of 2 raw listeners.

---

## 7. Smaller, same rule

- **`fleet_set_live_slots`** has no clamp and **no `require_auth`**, and the
  frontend re-pushes `0` — which means *unlimited* — on every Fleet refresh.
- **The 37 NULL `next_trigger_at` rows** are still NULL. New damage is fixed;
  reviving the existing schedules needs a repair sweep.
- **114 credential-shaped values already persisted in `tool_steps`** are not
  backfilled. The write path is fixed; the history is not. A backfill is
  specified in `secret-and-pii-redaction.md` §7 (BEGIN IMMEDIATE, per-row
  round-trip guard, dry-run default) and needs the affected credentials rotated
  regardless.
- **`persona_tombstones` has no writer**, so no local delete has ever
  propagated. Enabling sync without it resurrects rows.

---

## What *was* applied, and what it changes at runtime

For completeness, since "no destructive applies" is now the rule. None of these
delete data; several do change behaviour, all in the conservative direction:

| change | runtime effect |
| --- | --- |
| capacity refusals `Validation` → `RateLimited` | callers now retry what they previously treated as permanent |
| `eventBridge` batches awaited in sequence | slower, bounded listener registration at startup |
| `NewCompetitionModal` passes no width | fewer concurrent CLI children on that path |
| cloud reconnect bounded at 20 attempts | stops an endless 60-second retry loop; surfaces a terminal error |
| `open` gains `shellexecute-on-windows` | URLs no longer pass through `cmd.exe` |
| workspace mutations reconverge on both branches | one extra read after a failed write |
| migration drop/re-add pair removed | ~186 ms and two table rewrites saved per launch |
| `logging::add_file_layer` moved above `db_init` | migrations are now logged |

The Rust ones are compile-verified by CI but **not runtime-verified** — cargo is
unavailable in the campaign's session.
