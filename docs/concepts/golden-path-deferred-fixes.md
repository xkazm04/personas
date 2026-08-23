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

> ## ⚠ The live-data baseline behind these numbers was deleted on 2026-08-17
>
> The operator authorized a purge of all personas and triggers. It ran, and the
> declared `ON DELETE CASCADE` graph took **20,342 rows across 25 tables** with
> it — including **all 78 personas, all 351 triggers, all 6,535 memories, all
> 2,188 executions and all 5,720 tool-usage rows**. `PRAGMA foreign_key_check`
> went from 1,030 violations to **0**, because the violating rows were themselves
> in the cascade set.
>
> **Every live count in this register and in the corpus was true when measured
> and is now historical.** They are not withdrawn — a defect is not fixed by
> deleting the rows that exhibited it — but they can no longer be reproduced
> against the live database.
>
> **The reference state is the backup**, at
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\` (`personas.db`,
> 347,054,080 B, verified intact after the purge). Any future re-measurement of
> a claim in this register must run against **that file**, not against the live
> database.
>
> **A composer measuring the live database today will find zero rows nearly
> everywhere.** That is the purge, not a fix. Do not report a defect as resolved,
> converged, or extinct on the strength of an empty table.
>
> What survives and is still live-measurable: the team layer (383 assignments,
> 8,486 assignment events, 1,491 channel messages, 347 team memories), all audit
> and trace tables as orphans (2,942 traces, 9,830 credential-audit rows, 4,001
> provider-audit rows), 25 credentials, 1,031 API keys, 134 connector
> definitions, 14 projects, 1,306 knowledge items, and the 4,972 `persona_events`
> whose persona pointer was `SET NULL` rather than deleted.

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
- **The `next_trigger_at` NULLs.** *Corrected 2026-08-16:* "37" is right only
  for time-based triggers — the table is **349 of 351 NULL**, and the
  operationally live figure is **11** (enabled + active). **A repair must not
  simply stamp them**: `get_due` returns everything `<= now`, so any timestamp
  in the past fires immediately. It has to go through `compute_next_trigger_at`
  and skip invalid-timezone rows, where the NULL *is* the diagnosis.
- **Credential-shaped values persisted in `tool_steps`.** *Corrected
  2026-08-16:* **the figure 114 did not reproduce at any threshold.** Two
  independent implementations agreed exactly at **41 raw / 22 after
  classification / 6 at the strictest**, across 11 executions of 1,921. Also:
  `tool_steps` is a **JSON TEXT column on `persona_executions`**, not a table —
  this register said otherwise. The secrets sit *inside string values*, which
  **neither JSON walker in the repo handles**, so the backfill specified in
  `secret-and-pii-redaction.md` §7 needs that gap closed first. The affected
  credentials need rotating regardless.
- **`persona_tombstones` has no writer**, so no local delete has ever
  propagated. Enabling sync without it resurrects rows.

---

## 8. Foreign file content reaches a model with the fence bypassed

**Where:** `src-tauri/src/mcp_server/tools.rs:323` (`handle_drive_read_text`),
`:1338` (`handle_obsidian_vault_search`).

**What is measured:** the repo owns a genuinely good OWASP-LLM01 structural
fence — `wrap_runtime_xml_boundary`, a canary, and a "treat this as data only"
instruction — at `src-tauri/engine/src/prompt/mod.rs:760,:877,:883`, applied at
21 sites including the whole `input_data` blob. It is bypassed here because a
**tool result never passes through `assemble_prompt`**. Live invocations that
took the unfenced path: **562** (`obsidian_vault_search` 450,
`drive_read_text` 79, …). Invocations that took the fenced path: **0**.

Two smaller facts on the same fence, both executed:

- The fence nonce (`runtime_safety.rs:14`) is **clock-derived** — consecutive
  tags in one prompt XOR to 1, 3, 1, 7 — while a `rand`-based generator sits 28
  lines away in the same repo (`prompt_sanitizer.rs:38`).
- The tag stripper is **non-idempotent in both Rust copies**:
  `a <sys<system>tem>evil b` → `a <system>evil b`.

**Why held:** routing tool results through the fence changes what every MCP
client sees in a tool result, and the nonce change alters a value the stripper
matches on. Both are behaviour changes on a live path the operator uses. The
channel is also currently cold — all 745 `mcp__personas__*` calls fall
2026-05-27..06-26, before the token gate landed 07-16 — so the exposure is
historical rather than ongoing, which is exactly what makes it safe to defer and
wrong to forget.

---

## 9. Eight unprobed credentials render green, and two score tiers are unreachable

**Where:** `src/features/.../credentialHealthScore.ts:37-67`;
`src-tauri/.../rotation.rs:269-274`.

**What is measured:** the composite is 0.4 healthcheck / 0.4 anomaly / 0.2
rotation. `healthcheckScore` returns **50** for unverified and carries a
five-line comment recording the incident that hardened it. Its two neighbours
three and eight lines below return **100** on no data (`// no data = assume
healthy`). Against the live DB: `credential_events` has 0 rows, so anomaly=100
for **25 of 25**; 0 rotation policies are enabled, so rotation=100 for **25 of
25**. **60% of every credential's score is a constant**, the floor is 60, and
`degraded` and `critical` — 2 of 4 tiers — are **structurally unreachable**.
Two credentials with a *failed* probe render amber 60. Eight that nothing has
ever successfully probed render **green 80**.

`rotation.rs:269-272` computes `data_stale` (**true on 25/25**) and `:274`
decides `Healthy` without consulting it.

**The fix, not applied:** return `null` from a sub-score with no data and
renormalize over the dimensions that reported — the shape `renorm_composite`
already uses elsewhere in this repo, and which `computeLeaderboard` uses
correctly while `computeCompositeHealth` pre-defaults its inputs and fabricates
five dimensions. **Why held:** eight credentials would change colour on a
dashboard the operator reads.

---

## 10. A trust badge compares a 0–100 score against 0.5

**Where:** `src/features/.../personaStats.ts:204`.

**What is measured:** the predicate is `trust_score < 0.5` against a **0–100**
scale. The 59 measured scores span **79.6–100**, so the badge has **zero
possible true positives**. All 7 firings today (19 after a refresh) are
never-measured personas — and `useStudioComposer.ts:74` **drops those personas
from the Trigger Studio**.

Same question, two answers 70 points apart: `compute_trust_score` returns
**0.0** (floor) where `computeCompositeHealth` returns **70/100**, for **19 of
78 personas (24%)**.

**Why held:** this is a one-character-class fix with a real payoff — personas
return to the Trigger Studio — but that *is* a live-surface change, and the
right repair is the absence-handling one in item 9, not a rescaled constant.
Recommended as the first item to apply once the operator gives a window.

> **Sharpened 2026-08-16 by `selective-per-item-verdicts`.** The picker
> exclusion is **three** predicates, not one, and the real cost is **38 of 78
> personas (49%) silently absent** — not 19. The `< 0.5` comparison is confirmed
> as a **unit bug** (the column is 0–100, minimum real value 58.5), so it fires
> only for the rows sitting at exactly 0. It is also the **only** threshold
> comparison of its kind in 4,829 files, which is why nothing else caught it.

---

## 11. Persona evolution runs on weights that contradict the declared ones

**Where:** `src-tauri/.../fitness_driver.rs:337-341`.

**What is measured:** the driver uses `(0.3, 0.4, 0.3)` for the same three
metrics that `SCORE_WEIGHTS` declares as `(0.4, 0.4, 0.2)`. Nothing asserts the
two agree; no sibling repo asserts a weight sum either, except `ascent`.

**Why held:** changing the weights changes which personas the evolution loop
selects. That is a decision about the operator's own fleet, not a bug fix.

**Adjacent, same file family:** `compositeHealthScore.ts:375-379` renders the
uptime bar **per-persona for activity and fleet-wide for health** — **173 of 403
cells (42.9%)** show the wrong day-status, and because `degraded` days count as
up, a 29% daily failure rate renders as 100% uptime.

---

## 12. One error boundary for the whole content area, and it does not forget

**Where:** `PersonasPage.tsx:403-406`; `ErrorBoundary.tsx:98-122,:135-137`;
`main.tsx:190`.

**What is measured:** **46 boundary declarations in 18 files; `key`/`resetKeys`
on 0 of 46.** Executed in jsdom against a transcription of `renderSectionRoute`:
crash section A, navigate to a **healthy** section B → B never renders and the
latched card **retitles itself** with B's name. The name is re-read from props
at render while `componentDidCatch` persisted the crash under the old name, so
**the screen and the crash log name different components, and the crash log is
right.** `key={section}` recovers it in one line.

Three more on the same component:

- **"Go to Dashboard" does nothing at 13 of 34 sites.** It calls
  `onGoHome?.()` then `onReset()`; with `onGoHome` undefined nothing throws, so
  the navigating `catch` never runs. Executed: renders 3→5→7 across both
  clicks, location unchanged. **7 of the operator's 84 real crashes landed
  there.**
- **"Copy report for support" puts raw `message` + `stack` + `componentStack`
  on the clipboard**, while `persistCrash` sanitizes the identical payload 60
  lines above. The unredacted copy is the one meant to leave the machine.
- **`main.tsx:190`** passes a `fallback` to `Sentry.withErrorBoundary` without
  `handled`, so every white-screen is filed as `handled: true` and
  crash-free-sessions cannot move.

**Live data:** **84 frontend crashes** 2026-05-25 → 08-14; 60 via a boundary,
**24 (29%) via `window.onerror`/`unhandledrejection` with no UI at all**. **0 of
46 declarations emit a Sentry event.**

**Why held:** adding `key={section}` changes remount behaviour on every route
change in the app's main content area. It is one line and almost certainly
right — `personas-web` and `ascent` each hit this bug independently and each
shipped a fix — but "almost certainly right" on the surface the operator uses
all day is exactly what this register is for.

---

## 13. A persona-sourced event name is rejected by its own door

**Where:** `src-tauri/src/engine/dispatch.rs:309`.

**What is measured:** `source_type: format!("persona:{}", ctx.persona_name)` is
unsanitised. Replaying `is_safe_type_string` (`events.rs:27`) against the **78
live personas: 77 produce a value the door rejects**. `persona_action` has **0
rows ever**. The sibling `match` arm 65 lines below (`:357-369`) already
computes `safe_name`, with a comment explaining why.

**Why held:** the fix makes 77 personas start publishing an event type that has
never been published. That is a new event stream on a live bus, not a repair.

---

## 14. The app kills the process 60 seconds after the terminal starts waiting for you

**Where:** `src-tauri/.../stale.rs:1182` (`DOZE_AFTER_SECS = 60`);
`src/features/.../fleetAttention.ts:103`; `FleetTerminalOverlay.tsx:260`.

**What is measured:** the doze sweep is **always on, with no toggle**, and it
targets `Stale`/`AwaitingInput`. `needsLiveAttention()` is
`state === 'awaiting_input'` — **the exact predicate the grid uses to mount a
live, focusable terminal.** So the condition that makes the app show you a
usable terminal is the condition that makes it free the process behind it, 60
seconds later.

At t=61s the output ring still replays, the cursor still blinks
(`cursorBlink: true`), and every keystroke returns
`Err("session writer dropped")` into `silentCatch`. The only visual delta is a
`w-3 h-3` moon glyph in the tile header. `fleetTerminalManager.ts` has **17
`silentCatch` and 0 `toastCatch`** — while the app's *own* writes to the same
PTY all use `toastCatch`.

**Why held:** raising or gating `DOZE_AFTER_SECS` changes how long the operator's
Fleet children stay resident, which is a resource decision about their machine.
The cheap half — routing `fleetTerminalManager`'s keystroke/paste/resize
failures to `toastCatch` like every other writer to the same PTY — is a live
surface change on a path they use daily.

**Same file family, same rule:**

- **`registry.rs:750-851` returns `Ok` before the submit confirms**, and
  `useFleetOverlayActions.ts:148-153` raises a success toast on it.
- **A paste ending in a blank line submits itself**, plus a Right-arrow and a
  second Enter on retry; **2 of 3 Windows paste routes bypass bracketed paste**
  (`fleetTerminalManager.ts:240`, `commands.rs:91`).
- **`persist.rs:165-166` restores every session at `120×32`**, discarding stored
  dimensions, and `registry.rs:888-889` writes stored dims before the
  master-exists check.
- **`FleetTerminalPane.tsx:43`** hard-codes `bg-[#0a0a0c]` against a shipped
  `LIGHT_THEME` (9 sites).

---

## 15. Arbitrary stdin to a permission-skipping child is a Public-tier command

**Where:** the Fleet IPC surface — **37 of 38 commands are Public tier.**

**What is measured:** the one privileged command is `fleet_remove_session`.
`fleet_write_input` — which writes arbitrary stdin to a child spawned with
`--dangerously-skip-permissions` (12 spawn sites pass that flag, one of them
inside `build_cli_args`, referenced at 75 sites) — is **not** privileged.
Destroying a session is guarded; driving one is not.

**Also on disk:** **6 `fleet-mcp-*` temp dirs created, 0 removed by the app.**
Windows itself deleted 4 token files at 04:49 on two consecutive days, 7.2–7.9
days after creation, leaving all 6 directories behind. The surviving tokens are
**dead** (the registry is a process-memory `OnceLock`), but the **ACL carries two
non-owner Modify ACEs**. `fleet_sessions` holds 0 rows while 26 sessions ran in
5 days; what actually survives is **2.55 GB in `~/.claude/projects`**, owned by
Claude Code rather than this app.

**Why held:** re-listing a command as privileged is exactly the class the runbook
names — a security control whose current setting may be deliberate, on a
transport the operator drives from a terminal. Changing it could break their own
workflow mid-session.

---

## 16. Four correct performance gates that execute in zero places

**Where:** `src-tauri/src/commands/fleet/bench.rs`, comment at `:42-46`.

**What is measured:** this is the best-designed gate instrument found in the
repo — four *relative-invariant* performance gates, which is the shape that
survives a machine change. Its own comment routes them to CI because of a
`0xC0000139` loader failure. **That failure's fix is documented in this repo's
own `CLAUDE.md` and shipped as `npm run test:rust`.** Meanwhile CI is red,
lefthook runs no Rust test, and `npm run check` runs no Rust test.

**Why held:** wiring them in is a gate change, not a behaviour change, and is
safe — but it needs one `cargo` run to confirm the manifest fix actually clears
the loader error on this machine, and `cargo` is unavailable in this campaign's
session. Filed here rather than guessed at.

---

## 17. A batch review apply is all-or-nothing, and a crash halfway is unrecoverable

**Where:** `src-tauri/src/commands/core/memories.rs:874`, status flip at `:901`.

**What is measured:** `apply(proposal_id)` archives every entry in a proposal or
none. Replayed verbatim against the operator's real 11-entry proposal: apply
touches **11 of 11 and archives 52 memories**; discard touches 0 of 11; **there
is no third call.** A crash before entry 5 leaves `status='applied'`, **33
memories archived, 6 never run, and nothing recording which** — and because the
status flips *before* the loop, the CAS refuses the retry. The `errors:
Vec<String>` it accumulates has no consumer.

The command also has **zero UI**: its four wrappers appear in 3 of 4,829 files
(the api module and two bindings), none of them in `features`, `stores`, or
`hooks`.

**Why held:** repairing this means changing when the status flips and adding
per-entry progress — a write-path change to the memory archive, which is the
operator's own data. The correct shape is already in the same database:
`dev_ideas` stores the identical concept as **N rows** and carries a rejection
reason on **23 of 24 rejections (96%)**, against **0 of 208** for the JSON-array
shape.

---

## 18. Rejecting two items makes the other six unapprovable

**Where:** `MessageDetailModal.tsx:858-859,:949`; `ReviewFocusFlow.tsx:181-185`;
`ReviewDetailPanel.tsx:319-336`; `AthenaVerdictCard.tsx:111`.

**What is measured:** the app renders per-item review controls, collects
per-item verdicts, and then stores **one status for the batch**. Live: **258
per-item verdicts across three stores, 0 recoverable as per-item facts.**

- `MessageDetailModal` holds `useState<Record<string, DecisionVerdict>>` next to
  an `onApprove: () => void` — the verdicts are **discarded entirely**. Approve
  is `disabled` when any child is rejected, so **rejecting 2 of 8 means you
  cannot approve the other 6.**
- `ReviewFocusFlow` **derives** the batch verdict as `anyAccepted ? approve :
  reject`. One accept out of eight approves the batch — and
  `manual_reviews.rs:337-357` then writes a team `decision` memory at
  **importance 7** recording that outcome. A correct learning loop over a lossy
  verdict amplifies the loss.
- `ReviewDetailPanel` flattens the verdict map into a `"Decisions:\n+ label"`
  string in `reviewer_notes`, stripping ids and omitting undecided items.
- `AthenaVerdictCard.tsx:111` sends `reason: i.reason` for flipped items, so an
  accept→reject flip persists **Athena's argument for accepting** as the
  rejection reason.

**Also expired, not just lossy:** `companion_approval` holds **8 batches / 50
verdicts**, all `pending`, and replaying `load_pending`'s freshness predicate
shows **8 of 8 past the 24h consent window** — permanently unappliable.
`persona_memory_review_proposal` holds 4 proposals / 24 entries, all
`pending_review` with `decided_at` NULL, aged **37–98 days**.

**Why held:** every one of these is a live review surface the operator uses, and
the repair is a storage-shape change (N rows, not a JSON array in a `TEXT`
column) rather than a patch. Worth noting that the fleet is **ahead** here:
across 9 sibling review surfaces, **9 of 9 store N rows**, **0 have an
all-or-nothing batch-apply endpoint**, and **0 of 4 flip a batch status before
the loop.**

---

## 19. The locale catalogs are perfect and the app still renders English

**Where:** `useTranslation.ts:234-240`; `check-route-sections.mjs:115`;
`LlmCallsTable.tsx:219`; `lefthook.yml:78`.

**What is measured:** **19,112 keys × 13 locales — 0 missing, 0 extra, 0
untranslated**, 65/65 error-registry prefixes, every check green. Three
absences ship underneath that, and none of them is a translation gap:

1. **Delivery ≠ catalog — 26 (section, route) pairs, 17 sections, 121 files.**
   The `t` Proxy deliberately does not load on access (a render-storm fix) and
   `check-route-sections.mjs:115` asserts **union** membership, not *route*
   membership. Sharpest case: `home`, the default landing route, declares
   `cockpit` (**2 keys**) while `CockpitPanel.tsx:141` reads `t.overview.cockpit`
   (**86 keys**, translated in every locale, never fetched). It is
   **order-dependent** — visiting Overview once makes it evaporate, so manual QA
   cannot reproduce it.
2. **Domain ≠ catalog — 36 missing token arms across 10 of 24 categories, 13 of
   them live.** `generating` and `pending` fire on essentially every run.
   `severity.warning` renders a correctly-coloured amber chip whose text is the
   literal word `warning`. `thinking.xhigh` renders raw at `LlmCallsTable.tsx:219`
   — the exact line `i18n-string-authoring.md` §6 names as "the one site to
   copy" — while the same concept *is* translated in 14 locales under
   `models.effort_xhigh`.
3. **`t.kpis.measurement_source`: 5 arms against a 6-arm CHECK with a live
   writer** (`repos/dev_tools.rs:7100` inserts `'ai-compose'`).

**The physics, and why a stricter check cannot help:** every completeness gate
here compares the locale catalogs **to each other**. That is a *symmetry* check,
so an absence punched identically through all 14 catalogs is invisible **by
construction**. Replicated: all three repos in the fleet that gate locale-vs-locale
parity are carrying a live enum-vs-catalog gap right now, and all three boards
are green.

**Why held:** adding 36 token arms means running the translate pipeline across 13
locales — a large generated diff on the operator's source of truth, and not
something to do inside a doc campaign. The delivery gap needs a change to
`routeSections.ts` that alters what preloads on the landing route.

**One free gate change, recommended and not applied:** `lefthook.yml:78` runs
the *default* (warn-only) coverage mode on pre-push, as does CI. Strict mode is
reached only by the pre-commit hook, and only when a commit stages
`src/i18n/locales/*.json` — so the edit that *creates* an incompleteness
(widening a SQL CHECK or a Rust enum) runs no i18n gate at all. Switching that
one word costs nothing today, because the strict check passes at 0/0. Held only
because it changes what can block a commit.

---

## 20. Triggers you switched off are still dispatchable

**Where:** `src-tauri/.../triggers.rs:1590` (`get_due`); the
`persona_triggers.status` backfill in the migration chain.

**What is measured:** `status` was added `NOT NULL DEFAULT 'active'` and
backfilled from `enabled`. **5 of 10 production INSERT sites omit `status`**, so
the DEFAULT fills it — and `get_due` dispatches on `status`, **never on
`enabled`**. Live drift: **26 rows** where `enabled = 0` and `status = 'active'`.
Zero drift the other way.

**The repair is narrow and the obvious version is wrong:** rebuilding `status`
from `enabled` wholesale **flattens `paused` and `errored` into `active`**. Only
the `enabled = 0 AND status = 'active'` predicate is safe.

> **Corrected 2026-08-17 by
> [trigger-wiring-surface](./golden-paths/trigger-wiring-surface.md): the
> hypothesis in this entry was the wrong half.** **Every writer keeps `enabled`
> and `status` in sync** — the 26 drifted rows carry a `datetime('now')`
> formatting that **no Rust path in this repo produces**, so they were not
> written by the app's own toggle. The defect is on the **read** side and it is
> three-way: the badge reads `enabled`, `get_due` and `get_enabled_by_type` read
> `status`, and `ParsedTrigger::is_eligible` reads **neither**. A consequence
> this entry missed entirely: **7 disabled subscriptions are no-ops, because the
> paired listener still delivers.**

**The structural fix, which is not a data change:** drop the `DEFAULT` and give
the pair one constructor. *A `NOT NULL` column with a constant `DEFAULT` is not
a required field — it is an optional field with a hidden answer.* The repo has
already run the controlled experiment: `set_status` withholds the boolean and is
**1 of 1 correct**; `set_enabled` hands back both and is correct by discipline;
the 10 raw INSERTs permit either and are **5 of 10 wrong**.

**Why held:** one schema edit plus five call sites, on the dispatch path of the
operator's live triggers.

---

## 21. The always-injected memory tier is empty, because its backfill tested a scale that does not exist

**Where:** the `persona_memories.tier = 'core'` backfill; contract at
`helpers.rs:426-447`.

**What is measured:** the backfill selects `WHERE importance >= 8` against an
importance scale the schema's own trigger enforces as **1..=5**. Live maximum is
5. Result: **0 of 6,535 memories are in `core`** — the tier that is always
injected into a prompt is empty, and **1,259 rows sit at max importance** with
nowhere to go.

**Why held:** choosing the real threshold is a decision about which memories the
operator wants injected into every prompt. That is theirs, not a bug fix.

**Adjacent, same chain:** the migration chain does **~10 ms of row-normalization
on every launch and changes 0 rows** — eleven unconditional statements, 9.6 ms
warm / 33.7 ms first-touch. **122 `run_step`s and exactly one can tell whether
its rows are correct**; 113 guard on schema shape, and **54 of the 67
row-rewriting statements sit outside any `run_step` at all**. Cost was the wrong
instrument for finding these: they are cheap *and* wrong, which is precisely why
nothing surfaced them.

---

## 22. Two connector vocabularies, and every live label normalizes differently

**Where:** `src/features/.../connectorRunnability.ts:31` vs
`src-tauri/.../connector_readiness.rs:232`.

**What is measured:** `ROLE_SYNONYMS` has **25 keys** against the server's
**21**. The server deliberately dropped `codebase | source_code | vcs | git →
source_control` — and recorded that decision **in its own file only**. Result:
**5 of 5 distinct connector labels across 154 live persona-connector pairs
normalize differently on the two sides**, and `Codebase` is declared by **63 of
78 personas**.

The client's `BUILTIN_LOCAL_CONNECTORS` also hardcodes 4 names against a server
`classify_connector` that derives **6** `ZeroConfig` entries from row metadata
(`codebases` and `operations_database` are missed), and the client has no
concept of the server's `GlobalProbe` class at all.

**Why held:** reconciling the vocabularies changes which connectors the app
considers ready — a live gating decision on 63 of 78 personas.

**Latent sibling, worth recording before it wakes:** `triggerArmState.ts:72`
tests day membership *before* the overnight branch, where
`core/src/models/trigger.rs:196-208` does not. **31,878 of 35,052 (90.9%)
representable overnight windows disagree on at least one minute** —
`days=[Mon] 22:00→06:00` reads *sleeping* at Tue 02:00 and *armed* at Mon 02:00,
both backwards. **0 of 351 live triggers configure a window**, so nothing is
wrong today; the first one that does will be wrong 90% of the time.

---

## 23. Two of your credentials expired months ago and the app renders them amber

**Where:** `src-tauri/.../rotation.rs:482`, `:755`; `credentialHealthScore.ts:57`;
`AnomalyScorePanel.tsx:6-17`; `credentials.rs:464-467` vs `crud.rs:271`.

**Live exposure, stated plainly:** **`gmail` and `google_calendar`** hold OAuth
grants that expired **75 and 98 days ago**. `needs_reauth` has been `true` since
2026-06-09 and 2026-05-17, their backoff windows expired 68 and 91 days ago,
they carry **49 and 21 consecutive refresh failures**, and the last successful
refresh for either was **2026-06-02**. Their rotation policies are disabled and
**67 days past due**, and the UI offers no control to re-enable one. They render
**amber, not red** — and **20 of their 60 points come from the disabling
itself.** (Shape and location only; no value was read or printed.)

**Why the app cannot act:**

- **`rotate` replaces nothing.** It runs a healthcheck and, on success, stamps
  `last_rotated_at = now`. The secret is byte-identical afterwards. There is **no
  revoke verb for a credential the app holds** — six commands revoke grants the
  app *issues*, zero revoke one it *holds* — so the only operation against a
  held credential is `delete`.
- **6 of the 11 `rotation_type` values the engine can supply are rejected by the
  database.** `credential_rotation_history` CHECKs a different closed set from
  `credential_rotation_policies.policy_type`; the intersection is **two words**.
  `oauth_keepalive` — the only type the app auto-provisions, and the type of
  both live policy rows — is one of the six.
- **All 11 `record_rotation` call sites are `let _ =`**, so that rejection has
  been invisible since the constraint was written. Replayed: the history INSERT
  is refused, discarded, and `mark_rotated` stamps *rotated today, next due
  tomorrow* anyway.
- **Disabling a rotation policy RAISES the health score by +20**, because
  `Remediation::Disable` sets `policy_enabled: false` and `rotationSubScore`
  then returns 100. Eight lines above it, `healthcheckScore` answers the
  identical question correctly, with the incident in its comment.
- **Delete truncates the audit ledger** — `credentials.rs:464-467` runs before
  `crud.rs:271` writes the delete row. Measured: **391.4 surviving rows per
  living credential, 1.3 per deleted one.**
- **21 of 25 credentials exceed the app's own 90-day default. 0 policies
  enabled. 0 rotations ever.**

**Why held:** every repair here touches the operator's real credentials, and
re-enabling a rotation policy would start acting on them. **The two expired
Google grants need re-authorising by hand** — that is the action, and it is
theirs.

**Worth knowing:** the fleet's answer to "how do you rotate" is *"you don't; you
mint and revoke."* `brainiac` and `ascent` independently implement the lifecycle
as `create`/`list`/`revoke`/`resolve` **with no update verb at all**. Personas is
the only repo that built the verb the others declined to build, and built it
hollow.

---

## 24. Every run in the app's history records zero tokens (~~and $0~~ — see correction)

> **CORRECTED 2026-08-17 — the $0 half of this entry is FALSE, and the entry falsified
> itself in its own text.** Measured against the pre-purge backup by the
> `billing-account-auth` composer: `cost_usd` is populated in **1,970 of 2,188 rows,
> summing to $2,036.2571**. The "$2,036.26 of actual spend" this entry cites *as the
> uncaptured amount* **is that column's own sum** — the number was read out of the
> ledger that was being called empty. `llm_spend.rs:100-101` reads `usage.input_tokens`
> and populates 85 of 89 rows.
>
> **The token half stands and is the real defect.** `input_tokens`/`output_tokens` are
> 0 on 2,188 of 2,188 rows, while `cache_read_tokens` carries 585 — because the cache
> reads have a `usage`-first fallback six lines below and the token reads do not. Every
> consequence below that depends on *tokens* (the `Some(0)` write, the 0-of-90,813
> spans, "0 tokens" in `TraceSummary`, the dead `CostBreakdownBar`) is unaffected.
>
> The lesson is the entry's shape, not its arithmetic: **a headline that generalises
> two findings into one ("$0 *and* zero tokens") inherits the weaker one's truth value
> and hides that it did.** Written down in the doctrine.

**Where:** `src-tauri/engine/src/parser.rs:340-341`.

**What is measured:** the parser reads `total_input_tokens` /
`total_output_tokens` from the **top level** of the CLI `result` line. Against
**314 real result lines** in the operator's own transcripts, those fields are
present **0 of 314 times**. `usage.input_tokens` is present **314 of 314**. The
two cache fields six lines below (`:347-350`) already consult `usage` first —
and they carry **648,406,049** and **26,029,682** tokens.

The consequence chain, each link measured: `persona_executions.input_tokens =
output_tokens = 0` on **2,188 of 2,188 rows**, against **$2,036.26** of actual
spend → `runner/mod.rs:2908-2912` writes `Some(0)` → **0 of 90,813 spans carry a
token value** → `TraceSummary.tsx:61` has rendered "0 tokens" for every run in
the app's history → `TraceSummary.tsx:90` gates `CostBreakdownBar` off, so that
component — 91 lines and 8 strings translated into 14 locales — **has never
rendered.**

`parser.rs:1105`'s own fixture supplies the field the real producer omits, so
the test is green.

**Why held:** it is a one-field-name fix, and it changes what every cost surface
in the app displays, immediately, for the operator who is watching them. It is
also the single highest-value item in this register: it restores a spend figure
that is currently $0 against two thousand dollars of real usage.

**Same instrument, same rule:**

- **`runner/mod.rs:2527`** formats a span name as
  `format!("Protocol: {:?}", std::mem::discriminant(&protocol_msg))` —
  **15,603 spans (17.2%)** are named `Discriminant(N)` and render raw. The
  variant names are matched three lines below at `:2545-2556`.
- **Coverage inverts with need:** completed runs **1,928 of 1,928** traced;
  failed **132 of 238**; incomplete **0 of 20**. All 126 misses are out-of-band
  deaths (74 app restarts, 20 panics, 12 ceiling kills, 20 zombie sweeps),
  because the trace lives in a `Mutex<SpanStore>` until `finalize()` — and
  **three of the four `traces::save` calls are `let _ =`, on exactly the failure
  paths.**
- **880 of 2,942 trace rows (29.9%) name an execution that no longer exists.** A
  foreign key is not the fix: `persona_tool_usage` *has* `ON DELETE CASCADE` and
  orphaned 980 rows anyway.

  > **Cause established 2026-08-17 by
  > [derived-index-sync](./golden-paths/derived-index-sync.md), by attaching the
  > June 3 backup — and the two numbers have DIFFERENT causes.** The 980 is a
  > bulk cliff: `clean-env.cjs:73` sets `foreign_keys = OFF`, so a wipe orphaned
  > rows straight through a declared `CASCADE`, and **672 of the 980 were already
  > orphans inside that backup**. The script was fixed on 2026-08-14; **the data
  > was not** — all 1,030 are still there, and 14 of 24 child tables remain absent
  > from its hand-maintained list. The 880 is continuous, FK-less accumulation.
  > Total dangling execution references: **6,880**, of which
  > `PRAGMA foreign_key_check` can see **1,030**. Adding a `REFERENCES` clause
  > fixes neither.

**The tree itself is sound and worth saying so:** 90,813 spans across 2,942
traces with **0 dangling parents, 0 self-parents, 0 parse failures, 0 negative
durations**, exactly one root per trace, and three independent tables agreeing
on **1,919 of 1,919** executions. The instrument is good; every number written
onto it is zero.

---

## 25. A model-supplied string can reach `DROP TABLE`, and the approval that guarded it is switched off

**Where:** `src-tauri/.../connector_use.rs:1443-1469`
(`personas_database.execute_mutation`); `approval_autopilot.rs:10-49`;
`connectors.rs:215-223`.

**What is measured:** the guard on a model-supplied statement is
`lower.starts_with(v)` over `["create","insert","update","delete","drop",
"alter","replace"]` plus `!contains(';')`, then `conn.execute(trimmed, [])`.
**No row cap, no timeout, no busy-timeout, no cancellation, no audit row** — and
`drop` and `alter` are in the *permitted* verb list.

Its stated safety argument was the approval gate. The sibling capability's own
comment at `connectors.rs:215-223` reasons about prompt injection and concludes
*"Requiring approval puts a human in front of the raw query."* On 2026-08-10
`approval_autopilot.rs` removed the human for every `use_connector` write under
autonomous mode — and this install's `app_settings` has
**`companion_autonomous_mode = "true"`**. Nothing pointed the capability at the
change that dissolved its own argument.

**So: a model-supplied string reaches a write statement with nothing human
between.** It is **latent today** — 0 `use_connector` rows across 120 approvals,
0 `db_query:execute` audit rows, 0 saved queries. The path has never run.

**Scope, corrected:** it reaches `personas_data.db` (68 tables, **0 encrypted
columns**, 1,779 conversation turns), *not* the credential database. The only
thing separating them is one hand-written `ATTACH` deny-list with **zero
tests** — and a read-only handle was measured still able to attach and read a
second file.

**Why held:** the runbook names this class exactly — a security control whose
current setting may be deliberate. Autonomous mode is a feature the operator
turned on. **The decision is theirs**, and it is the one item in this register
worth deciding sooner rather than later.

**The narrower fix, if any is wanted:** open the model's lane on a **read-only
pool** (`OpenFlags::SQLITE_OPEN_READ_ONLY`). Measured: it refuses DELETE, DROP,
INSERT, UPDATE, CREATE, CREATE TRIGGER, VACUUM, ANALYZE and journal-mode changes
**including the ones the classifier gets wrong** — and unlike `PRAGMA query_only
= ON`, it cannot be turned off from inside a statement.

**The human console, by contrast, is the best in six codebases** and is worth
not disturbing: a tokenizing classifier, stacked-statement refusal, an
`ATTACH`/`DETACH`/`VACUUM INTO` deny-list that survives separator tricks, and
500 rows / 8 MB / 60 s with interrupt-and-await.

**Smaller items on the same surface:** `validate_ddl_only` (`db_query.rs:410`)
has zero call sites and admits `CREATE TRIGGER … BEGIN DELETE …; END` — deferred
DML through a DDL allowlist. `classify_db_query` (`db_schema.rs:164`) is
registered, privileged, typed, and has **zero callers**, while `safeModeUtils.ts`
re-implements it and diverges on 2 of 47. `query_debug.rs:79` redacts 21
sensitive columns; `execute_db_query` — **including the lane where a model wrote
the SQL** — returns rows verbatim. `MutationConfirmBanner.tsx:41` truncates the
statement it is asking you to approve at **200 characters**. And
`ConsoleTab.tsx:35` destructures the query hook **without `cancelQuery`**, so
the full cancellation stack that exists end-to-end is unreachable from the
primary console.

---

## 26. 168 of 194 review decisions were made by a machine, and every surface says a human made them

**Where:** `reviewHelpers.ts:79-80` vs `subscription.rs:2041,2045`;
`AutoResolvedBadge.tsx:16-33`; `manual_reviews.rs:347,583`.

**What is measured:** of the **194** human-review decisions on this install,
**168 (86.6%)** were resolved automatically. The badge built to expose exactly
that — `AutoResolvedBadge`, whose docstring reads *"so the silent bypass of the
human queue is no longer invisible in the UI"* — fires on **0 of 168**. The
matcher tests `/\bauto_triage\b/`; the writer emits `auto-triaged`. A hyphen and
a tense.

`persona_manual_reviews` **has no actor column at all**, so the machine-vs-human
bit is inferred from `reviewer_notes` — a free-text field the human it holds
accountable can also write.

**Downstream, into the ledger the fleet reads back:** **186 of 236** human-review
team memories say *"Human approved the review …"* **and** contain
`auto-triaged`, at **importance 7**.

**Why held:** correcting the matcher makes a badge appear on 168 historical rows
at once, changing what the operator sees across every review surface. The
durable repair is an **actor column**, which is a schema change. And a type
cannot help: `persona_events` fuses id and name with `format!` into a `TEXT`
column, so both *inside a SQL string* and *inside a serialized blob* apply. **A
type can close the vocabulary you render; it cannot supply an identity nobody
recorded.**

**Eight more surfaces, each with what a reader is misled about:**

| | where | misled about |
| --- | --- | --- |
| D2 | `EventLogList.tsx:198-217` | **who fired it** — the slug sliced out of `source_type` resolves **0 of 4,166** times and maps 4,118 rows onto **7 distinct persona ids**, while `source_id` holds the true id and resolves 4,166/4,166. The failure branch renders the slug in `font-mono`, styled as a database id. |
| D3 | `AuditLogTable.tsx:106` | **what happened** — the "Detail" column holds the *actor* on **5,883 of 9,803 rows (60.0%)** and the detail on 3,906. Never both. |
| D4 | `ByomAuditLog.tsx:63,:118` | **when** — a surface labelled "Compliance trail" whose "Time" column is a **duration**; `created_at` is rendered nowhere; 50 of 4,001 rows shown with no scope notice. |
| D5 | `SettingsHistoryTab.tsx:207`, `GitOpsVersionHistory.tsx:297` | **whether anyone was recorded** — a NULL actor makes the badge *vanish* rather than render "—". Actor is NULL on 14 of 15 rows. **All 3 siblings render an unknown actor as a state; none lets the element disappear. This is the sweep's only unanimous result, and Personas is behind it.** |
| D6 | `ApiKeyAuditDrawer.tsx:1-6` | its own docstring promises a **persona** column that is never rendered. |
| D7 | `team_assignments.rs:362` + 140 more sites | **the order it happened** — clock-ordered reads with no tiebreaker against live tie rates of **87.6% / 97.7% / 98.2% / 67.4%**, driven by 60 tables defaulting to `datetime('now')`. The correct form is 30 lines away in the same file. |
| D8 | `fleet_decisions.rs:123`; `tool_execution_audit_log`, `persona_change_log`, `deployment_history` | **whether it was ever recorded** — "no entries yet" and "never wired" render as the same sentence. Two comments call `fleet_decisions` "the authoritative audit trail" and **nothing reads it**; `fleet_sessions` has 0 rows so **0 of 36 session ids resolve**. |
| D9 | `credential_audit_log.operation` | one concept, two tokens — `oauth_token_refreshed` (201) and `credential_oauth_refreshed` (1). |

**Cleared, and worth recording so nobody re-opens them:** the UTC-naive→local
skew is **already fixed** at `formatters.ts:30`, covering 8,899 rows; the event
colour and icon maps are exhaustive **by compile error**, being
`Record<PersonaEventStatus, …>`; `SettingsHistoryTab` is the best audit view in
the repo; and **Personas is alone in the fleet (0 of 5) in storing an actor as a
stable id plus a name snapshot** — `ascent` stores a mutable GitHub login, so a
rename rewrites its history.

---

## 27. Ctrl-C on `npm run dev` can delete 793 tracked files

**Where:** `scripts/i18n/split-locales.mjs:56`.

**What is measured:** the script `rmSync`s `src/i18n/section-locales/` **before**
the write loop. Executed against a scratch copy: killed at READY+320 ms, **the
directory does not exist** and all 793 tracked JSON files are gone. An
uninterrupted run takes 2,760 ms — so the 60-second codegen watchdog is *not*
the trigger. **A Ctrl-C on `npm run dev` in that window is.**

Recovery is `git checkout` and the loss is bounded, so this is a papercut
rather than a disaster — but it is worth knowing, because the same `rmSync` also
makes the file's own `writeIfChanged` guard **dead for 793 of its 794 calls**.
`renameSync` appears **0 times across all 150 tooling files**; write-to-temp-then-
rename is the standard fix and nothing in this repo uses it.

**Why held:** it is a real fix to a real hazard, but it is a change to the
codegen path the operator runs every time they start the app, and a botched
version of it is worse than the hazard.

---

## 28. Five generators are wired into nothing, and four of them are stale right now

**Where:** `scripts/docs/gen-tour-anchors.mjs`; `src-tauri/tauri.android.conf.json`;
`.claude/codebase-context.md`; `docs/refactor/catalog-curation.md`.

**What is measured:** **19 generators, 14 registered, 5 wired into nothing. All
1,617 committed artifacts of the registered 14 are byte-fresh; 4 of the 5
unregistered ones are stale.** Every generator was executed into an
`fs`-interception harness and diffed against the committed bytes — **1,823
FRESH, 6 STALE, 32 unmeasurable** out of 1,861.

**Registration is the whole variable.** Same headers, same blind `writeFileSync`,
same absence of a drift check on both sides of the line. The rival hypothesis
was tested and predicts nothing: a compare-before-write guard gives 1 fresh with
a dead guard, 1 fresh with a live guard, 1 fresh with `--check`, and 1 **stale**
with `--check`. Registration predicts freshness **14/14 vs 1/4**.

**The sharpest instance is a loop that punishes the model for the generator's
staleness.** `gen-tour-anchors.mjs` is registered nowhere and both its artifacts
are stale: **127 anchors present in the tree are absent from the allow-list**
(101 testids + 26 prefixes), and 4 in the list no longer exist. That list is
**enforced** at `companion/tours.rs:98` **and spliced into the composition prompt**
at `tours.rs:331` — so the model is told the 127 do not exist, and is then
rejected for not using them.

**Also measured:** `tauri.android.conf.json` sets
`beforeBuildCommand: "npx vite build"`, four directories from the
`vite.config.ts:46-49` comment warning against exactly that — **0 of 14 codegen
tasks run on the Android profile.** `.claude/codebase-context.md` is stale at
**64,787 bytes against 448,823**, because its input `context-map.json` is now
written by a different tool on a different trigger.
`scripts/skills/scan-agents-to-skills.mjs:403-405` skips existing outputs unless
`--force`, so its staleness is **structurally unreachable**.

**Why held:** regenerating a stale artifact is a large mechanical diff on files
the operator's tooling reads, and the tour-anchor regeneration in particular
changes what the composition model is allowed to emit. The registration fix
itself is small and safe, but it should land with the regeneration, not before
it.

**Two answers worth importing, both from siblings:** `brainiac`'s
`committed_document_is_current` check runs **as a unit test rather than a
workflow step** — and gets a fourth property right that a port would miss, being
**EOL-insensitive**, which matters here because git smudges to CRLF. And
`ascent` has **zero** committed generated artifacts at all, because
`prisma generate` runs on `postinstall` into `node_modules`. **2 of 4 siblings
landed on "don't commit it"**, and Personas reaches that state for exactly one
artifact — the only one whose freshness is *guaranteed* rather than asserted.

---

## 29. A model rewrites the prompt after you have seen the preview

**Where:** `ChronologyAdoptionView.tsx:1190-1220` → `template_adopt.rs:2075`;
`build_sessions.rs:2626`.

**What is measured:** the adoption view fires `adjustAdoptionDraft(sessionId)`
from a `useEffect` **while the preview is on screen**. That command runs a
**600-second Claude rewrite** over `build_sessions.agent_ir`, and
`promote_build_draft` then re-reads that row. **Nothing re-hydrates the
client** — and **no adoption surface renders `system_prompt` at all**; its only
occurrence in the 1,900-line view is the placeholder
`"You are a helpful AI assistant."`.

The command returns `AdoptionAdjustResult { adjusted, divergence, model, note }`
— a type referenced in **1 of 4,829 files** (its own wrapper) — and the call site
**discards it**. The evidence that the artifact changed is computed and thrown
away.

**Preview versus written, replayed over 10 real promotions:** **19 previewed
triggers → 44 written (2.3×)**; **37 previewed subscriptions → 31 written.** It
errs in both directions, and nothing reconciles the counts.

**The discriminator, which the framing "regenerated / re-fetched / mutated"
would have missed:** two sibling repos regenerate on apply *safely*, because
their regeneration is explicitly model-free. **The question is whether a model
runs between the render and the write.**

**Why held:** removing the mid-preview rewrite changes what adoption produces,
and re-hydrating the client changes what the operator sees mid-flow. This is the
flagship authoring path.

---

## 30. 24 surfaces write model-authored artifacts; 4 record that a model wrote them

**Where:** `db/src/repos/dev_tools.rs:1254-1261` (`goal_summary`);
`TeamSynthesisPanel.tsx:28` → `team_synthesis.rs:581,619`;
`useCreateTemplateActions.ts:89`; `TrainingStudio.tsx:111,:160`.

**What is measured:** across the whole schema — **78 personas (at least 73
model-drafted) with `trust_origin='builtin'` on 77; 351 triggers, 44 of them
from an LLM IR, recording nothing; 16 goals** whose provenance is a prose
footer. Against that, the two tables that added **one column** answer the
question completely: `dev_ideas.model` at **214 of 236**, and
`workspace_knowledge.provenance` at **1,304 of 1,306**, with exactly 2 human.

**And where provenance does exist, the read path removes it.**
`goal_summary()` replayed over all 188 `dev_goals`: **16 of 16 model-derived
goals stripped**, including **both rows queued right now** — 2 of 2
model-authored, 0 of 2 showing it.

**Six "generate is apply" surfaces have no gate at all.** `TeamSynthesisPanel`
creates a team **and N live personas** from one prompt with no preview step.

**Two smaller ones worth not losing:** `useCreateTemplateActions.ts:89`
**silently discards the user's edits** on the snapshot-recovery path — `updateDraft`
writes `draft` while the save reads `designResultJson`. And
`TrainingStudio.tsx:111` computes `aiDrafted: true`, then `:160` persists the
record without it.

**Why held:** adding provenance is a schema change on 20 tables, and **no
backfill can recover what was never recorded** — which is exactly why it belongs
in this register rather than being deferred silently.

**Convergence is unusually clear here, on a measured cohort of 3 (not 5):**
provenance on the applied artifact is **physics, 3 of 3** — `brainiac` has a DB
trigger *refusing* adoption without an origin; `vibeman` has `DbIdea.model`;
`ascent` has `Scan.engineProvider`. **Personas is 4 of 24.** The sharpest line in
the sweep is a *fixed* bug in `ascent`: *"Apply the repo we actually PREVIEWED,
never whatever the dropdown reads now… would land content the user never
reviewed."*

---

## 31. "Delete 77 agents" touches 15,958 rows across 20 tables

**Where:** `PersonaOverviewActions.tsx:113`; `storage.rs:99` +
`StorageUsageSection.tsx:81`; `skill_files.rs:1054`.

**What is measured**, replayed against read-only copies of the live DBs — the
two largest measured **twice**, by child-count subquery and by an actual
`DELETE` on a throwaway copy with `PRAGMA foreign_keys = ON`, agreeing per
table:

| the button says | the action touches | ratio |
| --- | --- | --- |
| **Delete 77 agents** | **15,958 rows across 20 tables** — every one of your 6,535 memories and all 2,188 executions | **207×** |
| **Remove 2,188 finished runs** | 2,188 + **5,015 cascade rows in 4 tables** + 4,376 FTS + 944 nulled | **3.29×** |
| deletes all **100** memories | **6,535** | 65× (already item 2c) |
| Skills install: **16 files removed** | **0** — `copy_dir_recursive` cannot delete | — |
| "Export Credentials" → **"Exported!"** | **0 of 25** written | — |

**The finding that generalises, and it is not the numbers.** The brief asked
whether preview and action share a code path. The repo's **best-engineered**
preview shares the *literal SQL string* — one `where_clause` variable feeding
both the `COUNT` and the `DELETE` — and is still wrong by 3.29×. **Sharing the
predicate is not sharing the effect.** A count preview cannot see a cascade.

**Denominator:** 1,585 commands · 104 mutating · 19 preview doors · 5 paired ·
**1** carrying a state token · **0 of 69 confirmation strings naming a
cascade.**

**Why held:** every fix here changes a confirmation dialog on a destructive
action — the exact surface where a wrong change is worst. `storage.rs:99` also
has a dry-run mode with **zero callers** that could be wired instead of
rewriting the count.

**Two siblings are ahead and say how:** `brainiac` computes its preview
*through the enforcement path* (`scoped_tx`), which makes divergence
unrepresentable; `ascent` states cascade and downstream effects in the copy and
**pins the wording with a test**. Personas is alone in six repos in having a
preview *token* (`apply_bundle_import`'s `preview_id` + mandatory hash) — the
mechanism exists and covers one door.

---

## 32. 1,356 of 1,585 commands are Public, and the tier tracks which folder the file is in

**Where:** `ipc_auth.rs`; `executions.rs:420` + `engine/src/prompt/cli_args.rs:107`;
`oauth.rs:595-597`; `management_api.rs:386-392`.

**What is measured — asked versus used, on all four grant surfaces:**

| surface | asked | used |
| --- | ---: | ---: |
| IPC tier | **229 of 1,585 gated (14.4%)** | nothing measures what a command exercises |
| persona tool grants | **210 edges** | **9 ever exercised — 4.3%** |
| management-API keys | 1,029 keys, 2 scope sets | **1** recorded request |
| `BrokerGrant` (records *which* grant authorized a use) | 3 arms, correct, unit-tested | **0 rows**, against **9,431** decrypt audit rows naming no grant |
| OAuth `credential_fields.scopes` | 9 scope strings | **0 production readers** |

**The discriminator was raced against its rivals before publication.** Module
membership predicts the privileged tier at **9.77×** (75.3% vs 7.7%); the best
behavioural marker reaches 4.71×; **spawning a subprocess predicts it at 0.99×
— the base rate.** The tier tracks which folder the file is in, not what the
command can do. Fleet confirms it by hand: 38 commands, 1 gated, and that one
deletes a registry row.

**Named, since you asked for it:** the live `google_calendar` grant holds
**`https://www.googleapis.com/auth/calendar.events`** — a *write* scope — and no
named site in the tree writes a calendar event (one endpoint, a GET). But the
generic proxy at `api_proxy.rs:551` reaches **any path under the connector base
with a caller-supplied method**, so the scope is the capability surface and the
endpoint list is decoration. That is why the *grant* is what would need
narrowing, not the endpoint list.

**Also:** selecting Gmail alone requests **6 scopes across 3 Google products**.
`oauth.rs:595-597` does `scopes.extend(extra_scopes)` under a comment 200 lines
above asserting the server list is *"the single source of truth"* and the
frontend *"delegates scope selection to the backend"* — it does not;
`workspaceProviders.ts:32-79` keeps its own list and asks for `drive` where the
server default asks for `drive.file`.

**The tool grant is decorative in the execution lane:** the persona's tool list
is rendered into the *prompt*, and the spawn gets `--dangerously-skip-permissions`
and never sees it. `--allowedTools` exists at 2 sites, neither an execution
lane. `http_request` is granted to **61 of 78 personas with 0 invocations**;
`Bash` accounts for **29,303 uses (77.3% of all tool use)** and has no grantable
edge at all.

**Why held:** re-tiering commands, narrowing an OAuth grant, or requiring
`--allowedTools` all change what the operator's app is permitted to do
mid-session. The runbook names this class explicitly.

**One gate is ready and deliberately not wired.** A prototype extension to
`check-command-contract.mjs` (Rule 5, three directions, with preconditions
modelled on the repo's own) was built and run: it is **red today (exit 1)** on
five allowlist entries naming commands that are not registered
(`github_create_patch_release`, `openapi_parse_from_url`,
`openapi_parse_from_content`, `openapi_generate_connector`, `create_execution`),
and exits 1 on all four induced faults. **Wiring it would turn `npm run check`
red immediately**, which is a workflow change, not a fix. The prototype is in
the session scratchpad.

**Adjacent, and the reason the gate matters:** `ipc_auth.rs` has **23 commands
declaring a tier nothing enforces** (all async ⇒ zero enforcement) and **33
enforcing one nothing declares.** The test that would catch this exists at
`:1149-1211`, runs nowhere, and its `DRIFT_BASELINE` is **set-equal to the drift
set in both directions** — zero headroom, and it omits the direction that is red
today.

---

## 33. 21 of 21 tab strips ship a dangling `aria-controls`

**Where:** `SegmentedTabs.tsx:124,:41,:176-182` vs `PanelTabBar.tsx:86`;
`DraftEditStep.tsx:129`; `PrototypeTabs.tsx`, `TwinVariantTabs.tsx`.

**What is measured:** two tab-strip primitives sit in one folder, differ on one
line, and score **2/2 versus 0/21**. `PanelTabBar` **withholds**
`aria-controls` unless the caller passes `idPrefix` — both its callers passed it
and built a real `role="tabpanel"`. `SegmentedTabs` emits `aria-controls`
**unconditionally**, at a `useId()`-derived prefix **the caller cannot obtain**,
so all 21 call sites ship a dangling reference — and
`segmentedTabPanelProps`, the helper that would resolve it, has **zero
consumers**. Same repo, same folder, same authors, same concept: the corpus's
cleanest in-repo controlled experiment for *withholding beats requiring*.

`role="tabpanel"` appears **4 times in the entire tree** against 34 tab strips.

**A keyboard trap, and it is the only one in six repos:**
`DraftEditStep.tsx:129` uses a roving `tabIndex` with **no arrow-key handler**,
leaving **2 of 3 tabs unreachable from the keyboard.** Four sibling repos have
zero.

**Executed in jsdom, one tab round trip:** a half-typed draft is **destroyed**
and the fetch **re-issued** — while **`scrollTop = 640` survives**. The content
resets and the scroll does not, which is exactly backwards, and inverts three of
the four things the brief expected to leak.

**Two A/B switchers are still shipping**, both self-labelled *"throwaway
scaffolding"*, born 2026-04-25 — **114 days**, 3 render sites — and
`TwinVariantTabs` has since grown `localStorage` persistence.

**The fix is four characters** and is not applied: make `idPrefix` **required**
on `SegmentedTabs`. Its current default is not a neutral fallback — it is a value
that makes the correct completion *impossible*. Necessary and not sufficient:
`DecisionModeTabs.tsx:61` already passes `idPrefix` and still has no panel,
which is why the census rule gates the **panel**, not the prop.

**Why held:** requiring a prop is a compile break at 21 sites, and each needs a
real panel written to go with it.

---

## 34. An MCP tool result would hand a model your GitHub token

**Where:** `src-tauri/src/mcp_server/tools.rs:1812` (`personas_result`), and
`:1667`, `:1844-1852`.

**What is measured:** `personas_result` selects `output_data` **and
`tool_steps`** from `persona_executions` and returns them `to_string_pretty` to
the connected MCP client — which forwards tool results to a model provider.
Searching the whole module for a redactor returns **0 hits across 3,243 lines,
33 handlers and 149 `row.get` calls.**

What is in `tool_steps` on this machine, measured on a read-only copy: **1,921
rows / 26.5 MB**, containing **1 GitHub PAT, 7 Google-API-key-shaped strings, 1
PEM `BEGIN … PRIVATE KEY` header**, plus 14,736 POSIX home paths, 1,515
`DOMAIN\user` strings and 1,032 email addresses.

**The door is unlocked and currently unopened.** No `~/.claude/mcp.json`,
`~/.cursor/mcp.json`, or project `.mcp.json` exists here, so nothing is
connected. `brainiac` redacts at exactly this door (`mcp.rs:2393`).

**Why held:** adding redaction changes what every MCP tool result contains — and
the operator may be relying on that content. But this is the **first item in
this register where a credential would actually leave the machine**, so it
belongs near the top of any fix list.

**The structural reason it happened, which generalises:** *a module that never
called a redactor never appeared in any search for redactors.* Every audit of
this repo's redaction has enumerated the redactors and traced their callers. A
3,243-line transport with zero redactors is invisible to that method. The fix is
an **inventory of egress channels**, not a better regex.

---

## 35. Sentry's scrubber visits 5 of 14 field families, and the biggest producer has no call site

**Where:** `src/lib/sentry.ts:215-260`;
`src/lib/utils/sanitizers/maskSensitive.ts:81-82`;
`sanitizeErrorForDisplay.ts:86`.

**What is measured:** `beforeSend` visits **5 of 14 field families** (2 of the 5
are deletions); the Rust hook visits 6 — **and they disagree on which.** Rust
scrubs `breadcrumb.data`; the frontend does not.

**The dominant producer has no call site at all.** `breadcrumbsIntegration` is an
SDK *default* — `console`, `dom`, `fetch`, `xhr`, `history` all on, because
`sentry.ts` passes no `integrations` array. Its console handler emits
`data: { arguments }` carrying **the same text as `message`**, so all **295
console-bound log statements** (79 direct `console.*` in 32 files + 216
`log.*`/`logger.*` in 103 files) ship **one scrubbed and one unscrubbed copy of
every line**. `fetch`/`xhr` breadcrumbs carry no `.message` at all.

**A redaction marker printed beside the surviving secret.** `INLINE_SECRET_RE`
lists `authorization` in its keyword alternation and captures
`([a-zA-Z0-9\-_.~%]+)` after the separator — so for `Authorization: Bearer
eyJ…` it binds **`Bearer`** as the value and emits `Authorization: [secret]
eyJ…`. **4 of 6 auth-header forms leak**, cross-checked in Node `RegExp` and
CPython `re`. Rust's `bearer_re` masks 6 of 6.

**This is in a file the campaign edited, and the campaign's fix did not cover
it.** Commit `1e714f817` corrected the *token-prefix* regex directly below this
one and left `INLINE_SECRET_RE` untouched. That is this corpus's own doctrine
biting its author: *fixing every instance of a defect is not the same as
covering every place that needs the behaviour.* The leak predates the fix; what
the fix did not do is make the adjacent rule correct.

**And detection triggers disclosure:** `sanitizeErrorForDisplay.ts:86` — the "we
found a secret" branch **logs the raw string**.

**Inert on this machine today, and not because of a control:** there are **0
DSN-shaped strings** in the release exe, the debug exe, or all 1,399 `dist`
chunks; the running process matches the **debug** binary, so
`cfg!(debug_assertions)` forces `dsn: None`. Only the release workflow supplies
a DSN. **The clipboard channel is live in every build.**

**Why held:** every change here alters what leaves the machine or what a
developer sees in a console, and the correct fix is a whole-record walk plus an
egress inventory rather than another pattern.

**The convergence result is unusually pointed:** the single sibling that appeared
to corroborate our scrubber is **our own child** — `personas-web/src/lib/sentry-pii.ts`
is a textual port of `sentry.ts`, identical regex literals and comment prose. On
a cohort of 4 independent siblings the honest count is **0 of 4**. But the port
**gained** coverage of `contexts`, `extra`, `tags`, `frame.vars` and
`breadcrumb.data`, plus a redact-on-overflow depth cap — so **the fix here is
taking our own code back.**

---

## 36. The pairing surface guards unpair and leaves confirm unarmed

**Where:** `IncomingPairingPanel.tsx:72-80`; `FleetSettingsPage.tsx:213`;
`companion/remote_jobs.rs:29`; `core/src/models/identity.rs:52`.

**First, the reassuring measurement**, because it was asked for: **no
cross-device pairing material on this machine is readable by another account.**
`personas.db` — which holds `owned_devices`, `local_identity` and `app_settings`
— carries a **single ACE: your account, FullControl**. The Ed25519 private key
lives in the OS keyring, not on disk. The `fleet-mcp-*` temp dirs do carry two
non-owner Modify ACEs inherited from `%LOCALAPPDATA%\Temp`, but **four of six
are empty** and the two survivors hold one 206-byte `mcp.json` whose only
credential is a loopback MCP session token. **No device token, peer key, or
group anchor has ever been written to a temp directory.**

**Everything on this leaf is latent.** Five trust anchors, five schemes, all
empty: `owned_devices` 0 · `remote_jobs` 0 · `trusted_peers` 0 ·
`discovered_peers` 0 · `fleet_companion_devices` absent from the 32-row
`app_settings`. Nothing has ever been paired by any of seven ceremonies.

**Which is exactly why it is here.** The defects worth recording:

- **The repo guards its destructive action and not its trust-granting one.**
  `IncomingPairingPanel`'s confirm is an **unarmed primary button**, while
  `RemoteApprovalPrompt` and `PairApprovalModal` both arm at 450 ms — and
  **unpair** sits behind a two-step confirm.
- **`import.meta.env.DEV` gates the pairing panel *and the revoke button with
  it*** (`FleetSettingsPage.tsx:213`), and the revoke `silentCatch`es its own
  failure.
- **A comment names a bound that was deleted.** `companion/remote_jobs.rs:29`
  cites `AUTOAPPROVE_ALLOWLIST` as a live constraint: **10 mentions across 6
  files, 0 declarations**, removed 2026-08-10. `second-transport-exposure` §7.H
  reported this on 2026-08-16 and it is **still open**.
- **`identity.rs:52` says the `Manual→Verified` handshake "is not yet wired."
  It shipped**, as `protocol.rs` v2. Nothing connected the two.
- **Revocation does not reach an in-flight session.** `forget_owned_device` is a
  bare `DELETE`; `disconnect_peer` is uncalled; `REMOTE_TURN_TIMEOUT` is 27
  minutes; and `mdns.rs:82` caches trust for 30 s while
  `invalidate_trusted_peer_cache()` has **no caller on the revoke path**.
- **`device_group_id` is HKDF'd into an AES-256 key and is also plaintext** in
  two tables, returned by a Public IPC command, serialized to the client on
  every device row, and sent in `PairRequest` **before the human confirms**.
  Latent only because `SyncKey::derive` has zero callers.

**Why held:** arming a confirm button, ungating a revoke control, and deleting a
dead allowlist reference are all small — but they change a trust ceremony on a
feature the operator has never used, and the correct order is to fix the
ceremony *before* the first pairing, not during one.

**The strange structural fact worth keeping:** **102 of the tree's 394 `nonce`
mentions live inside `p2p/`** — and P2P is behind a cargo feature that is **not
in the running binary**. The running debug build contains **0** occurrences of
the handshake protocol strings, the QUIC bind message, and `_personas._tcp`; the
release build contains 1, 1, 1, 12 and 247 `quinn`. **The app's entire freshness
apparatus lives in the transport that isn't there**, and every reachable trust
path has zero verifier-contributed freshness except the cloud ceremony.

**Cleared, and recorded as cleared:** `remote_command_reject` now carries the
device filter its sibling documents as essential (`remote_commands.rs:377`).
`second-transport-exposure` §7.I is corrected in place.

---

## 37. One unlabelled checkbox above a 25-row page selects 78 — or 1,306

**Where:** `PersonaOverviewPage.tsx:180-182,:307-309`; `DataGrid` header control
at `:257-277`; `KnowledgeTree.tsx:197-204`.

**What is measured**, executed three ways on the operator's own data:

| surface | rows the user can **see** | ids the action receives | |
| --- | ---: | ---: | --- |
| **Agents → All Personas**, one click on the header checkbox | **25** | **78** selected → **77** sent to `bulk_delete_personas` | **3.12×** |
| **Knowledge Library**, same click, standing inside one branch | 25 on the page / 107 in the branch | **1,306** | **52.2×** |
| **Overview → Reviews**, three scrolled pages then one row verdict | 40 after reload | **120** iterated, **40** called, **80 silently reported approved** | — |

**Nothing here is a count bug.** Every number rendered is arithmetically
correct about the thing it names. The defect is that **the number and the action
are computed from two different derivations of one selection, and only one of
them was ever reconciled with reality.**

The Agents control is a bare 16-pixel `<div onClick>` with a tick inside — **no
label, no count, no `role`, no `aria-checked`, no text of any kind** — sitting
directly above a body that is `data.slice((page-1)*25, …)`. Its `onSelectAll` is
`new Set(filteredData.map(p => p.id))`: the whole filtered set, every page.

**And those are the same 77 ids** that item 31 measured as **15,958 rows across
20 tables**. Put the two findings together and the sentence is: *a control with
no text on it, whose scope is 3.12× what is visible, is the front door to the
largest destructive operation in the product.*

**Why held:** labelling the control and reconciling the two derivations both
change a destructive front door mid-use. This is the item where a careless fix
is worse than the defect.

---

## 38. The trending shelf is sorted by a counter that is zero for 90% of installs

**Where:** `db/src/repos/communication/reviews.rs:607-645`;
`commands/design/template_adopt.rs:604`.

**What is measured:** `increment_adoption_count` bumps a counter and writes an
audit row in one transaction, both keyed on `test_case_name` — **the display
name**. Its two callers disagree about what they pass: one passes the display
name, the other passes the **slug**, from a variable whose own tracing field one
line above reads `template_id = %template_name`.

Replayed over all **160** real adoptions on this install:

- **144 (90.0%) would match zero rows** — a silent no-op, `.ok()` swallowing the
  miss.
- The **same 144** have `adoption_log.source_review_id` NULL — *the app's own
  record of the miss*, written 59 days ago by different code than my replay,
  which rules out "the catalog changed since".
- The nine templates the operator adopted **17 times each** — `code-reviewer`,
  `docs-steward`, `release-manager`, `security-sentinel`, `solution-architect` —
  all read **`adoption_count = 0`**.
- Of the 16 that *did* resolve, **7 now read 0 again** with `last_adopted_at`
  NULL.
- Total `adoption_count` across all 113 seed rows today: **9**.

`TrendingCarousel` sorts by `adoption_count DESC`. **The shelf is ordered by a
number that is zero for 90% of what was installed.**

**Also on this leaf:** of nine shipped catalogs, **two record which version an
installed copy came from** — one writes the answer into a file nothing reads,
the other writes the same constant into all 316 rows. And **22 stale skill
directories sit in `src-tauri/resources/skills` right now**, retired 2026-08-04,
already copied into `target/debug/skills` and mapped into the installer.

**Why held:** correcting the key changes what the gallery shows and would make
counters jump on 144 historical adoptions.

---

## 39. Three loopback ports, 116 routes, 82 needing no credential

**Where:** enumerated from the OS, read-only, during composition.

**What is listening on this machine right now**, all one process:

```
127.0.0.1:9420    webhook + management + pairing      34 routes
127.0.0.1:17400   local_http (5 nested routers)       36 routes
127.0.0.1:17320   test-automation bridge              46 routes
                                                     ---
                                                     116 routes
```

**82 of the 116 require no credential of any kind. One body-size limit exists in
the whole application and it covers three of the 116. One audit table exists and
it holds one row, written thirteen months ago to a route that no longer
exists.**

`local_http` on :17400 carries **zero `.layer(` calls** on the listener or on any
router mounted into it — no auth, no CORS, no body limit, no timeout, no audit.
There is no single place a fix could be applied.

**The finding that changes how this surface can ever be audited:** which of two
route tables port 9420 serves **is decided by a startup race**.
`background.rs:869-888` calls `start_webhook_server_with_management` when
`try_state::<Arc<AppState>>()` resolves and silently falls back to
`start_webhook_server` — **3 routes instead of 34** — when it does not. Nothing
logs which one you got; the only observable difference is that `/api/personas`
answers **404 instead of 401**. **The route table is not a property of the
source, it is a property of a particular boot.** No static artifact can be
correct about this port.

**A version that is wrong by a major release:** `test_automation.rs:939` answers
`"version":"0.2.0"` while the app is **1.1.0** in `tauri.conf.json`,
`package.json` and `Cargo.toml` alike. The correct mechanism —
`env!("CARGO_PKG_VERSION")` — is **already used twice in this tree**, on two MCP
`initialize` handlers. The identity answer exists on two routes; the three routes
whose whole job is identity type it in by hand.

**Why held:** adding auth or a body cap to a live loopback transport the operator
drives from a terminal is the runbook's named class. The version constant is a
one-line fix and is the safest thing here.

---

## 40. Nine tile positions show a number that is not true, across ≥7,318 renders

**Where:** `SLADashboard.tsx:138`; `TraceSummary.tsx:63`;
`useObservabilityData.ts:98`; `inspectorShared.tsx:40-41`.

**What is measured — the population first:** **299 metric-tile render sites in 71
files, resolving to 68 distinct component definitions under 45 names.** `Stat`
alone names 12 different components; `StatCard` names 6. Plus **52 hand-rolled
inline tiles** in 45 files. Adoption swings **6.1× on the denominator** —
22.7% against card-shaped tile sites, **3.7%** for the one catalogued primitive
against every labelled number on a card.

**Nine tile positions are showing a false number right now, across at least
7,318 individual renders**, because the token columns are permanently zero (item
24). **585 of those executions carry cache tokens > 0** — positive proof the
traffic happened.

**The discriminator, raced against its rival and inverted.** The expected cause
was call-site carelessness; only **10 of 299** sites use `?? 0`. The structural
cause: **of 81 `label / value` contracts, 6 (7.4%) can express "not measured" —
and neither designated primitive is among them.** `StatCard.value: ReactNode`
renders `null` as *nothing*; `KpiTile` does `<Numeric>{value ?? ''}</Numeric>` →
an empty string.

**The guard is per-tile, not per-grid, found twice independently.**
`SLADashboard.tsx:74-88` guards the Success-rate tile with a seven-line comment
— *"a red 0.0% falsely screams total failure when the truth is no data"* — and
renders `"—"`. **The Avg-latency tile beside it renders `"0ms"`** at the default
30-day window. `TraceSummary.tsx:52` guards Cost → `-`; twelve lines down, `:63`
renders Tokens as `0` on **2,942 of 2,942**. And `useObservabilityData.ts:98`
returns `'0'` for an unmeasured success rate, **rendered green**, thirteen lines
above a comment refusing to fabricate a *delta* on exactly those grounds.

**The type experiment is already in the repo, one folder apart:**
`KpiTrend.invertColor` is **required** → 4/4 correct polarity;
`StatCard.delta.direction` is permitted → hardcoded up-is-green at every site.

**Why held:** every change here alters a number on a dashboard the operator
reads. The real fix is item 24, upstream.

**Cleared, and worth recording:** the two cost tiles **agree exactly** on
2,062/2,062 paired runs — `SUM(cost_usd)` is **$2,036.26** and is *correct*.
Only tokens are zero. `Numeric` is not the defect. `computeTrends` correctly
refuses to fabricate deltas.

---

## 41. 370 items are waiting on you and the badge can see 56

**Where:** `db/src/repos/dev_tools.rs:1352-1375` (`pending_counts`);
`db/src/repos/execution/healing.rs:1571`; `src/engine/background.rs:815-836` +
`manual_reviews.rs:542-600,:578`; `db/src/audit_incidents_promoter.rs:38-44`.

**What is measured**, replaying `pending_counts` verbatim against the live DB:

```
badge sees:  goal_acceptance 2 · manual_reviews 0 · ideas 54 · practices 0
             · policy_proposals 0 · promotion_proposals 0            =  56
unregistered: healing 179 · incidents 99 · kpis 21 · memory proposals 4
             · approvals 8 · backlog 3                               = 314  (84.9%)
```

**Two of the badge's six entries name tables that have never held a row.** The
registry is a third dead, and the dead third is the third somebody remembered to
add.

| queue | waiting | oldest | has a human ever drained it? |
| --- | ---: | ---: | --- |
| `persona_healing_issues` | **179** | 82 d | **never — 0 of 205**; all 26 resolutions `auto_fixed=1`, mean 247 s |
| `audit_incidents` | **99** | 74 d | **never acknowledged** — `acknowledged_at` NULL on **164 of 164** |
| `dev_ideas` | 54 | **131 d** | yes — 182 decided, **96% of rejections carry a reason** |
| `dev_kpis` | 21 | 66 d | yes — 44 decided |
| `companion_approval` | 8 | 6 d | **65 of 106 resolved within 2 s**, 59 within 1 s, min 0 |
| memory proposals | 4 | **98 d** | **never** — `decided_at` NULL on 4/4 |
| backlog items | 3 | 79 d | **never** — `reminded_count` 0 on all three |

**The two queues sitting at zero are the two the badge can see.** Visibility and
drain are the same variable.

**The sharpest finding is a composition defect, not a bug.** Auto-triage refuses
high/critical **by policy** — `subscription.rs:1893-1895` says *"HIGH/critical
severity is left for a human"*. `gc_stale_pending` does not read severity at
all. So the 7-day sweep inherits exactly the population the other policy
protected:

```
severity taken by each door:   low  medium  high  critical
  auto-triage (T+60min)         49      93     6         0
  gc_stale_pending  (T+7d)       2       1    17         0   <- 85% HIGH
  human                          2       3    17         4
```

**17 of the 20 swept rows were `high`, and 13 carry a parked `assignment_id`** —
thirteen team assignments still sitting at `awaiting_review`. **Two
individually-correct policies compose into a third nobody wrote.** All 148
auto-triages fired at ≥60 minutes, **51 of them inside the first tick after
it**: the human's window is one hour.

**Smaller, same rule:**

- `INSERT OR IGNORE` on `UNIQUE (persona_id, execution_id)` means healing dedups
  an **execution**, not a problem: **179 open rows carry 4 distinct titles**
  ("Transient process failure" ×107).
- `gc_stale_pending` writes `'resolved'` as a **raw SQL string literal**,
  bypassing both `ManualReviewStatus` and `validate_transition`.
- **Dead columns with no writer:** `workspace_knowledge.superseded_by` 0/1,306 ·
  `dev_ideas.verify_state` 0/236 · `dev_ideas.dedup_key` 22/236 ·
  `companion_backlog_item.reminded_count` 0/3.
- **`workspace_knowledge.confidence` does not discriminate**: adopted mean
  **0.797**, rejected mean **0.779**. Populated on 1,304 rows and predicts
  nothing about the outcome.
- **No rejection-reason column on `workspace_knowledge`** — 118 rejections, 0
  reasons — and **no producer anywhere reads `dev_ideas.rejection_reason`**, so
  "rejection is knowledge" is unimplemented on both sides.

**Why held:** every item changes a schema, a live surface, or resolves rows.

**The type that would close the largest piece, not applied:** add `AgedOut` to
`ManualReviewStatus` and take the raw string away. The memory writer's `match`
stops compiling until somebody decides whether ageing out should teach the model
anything (**today it does**), and `react_to_review_decision`'s `Approved |
Resolved` gate stops compiling until somebody decides whether ageing out resumes
the assignment (**it must, or the 13 stay parked**). It also makes 20 of the 168
machine decisions in item 26 derivable **without a new column**.

**The fleet's best idea, worth importing:** `brainiac` surfaces the oldest item's
age against a 48-hour SLO and **halts publishing when the queue stalls** —
*"Silence beats confident staleness."* It also carries the only stated failure
direction in the fleet for this leaf: *"A queue nobody works turns the whole
intake into theatre — and the proposers keep filing."*

---

## 42. The asset protocol publishes the vault key and the database to the WebView

**Where:** `tauri.conf.json` `assetProtocol.scope`; `protocol/asset.rs:29-120`;
`useYouTubePlayer.ts:61-65`; `tauri.conf.json:15` (`withGlobalTauri`).

**What is measured:** `assetProtocol.scope` includes `$APPDATA/**` —
`%APPDATA%\com.personas.desktop` — which holds **`master.key` (358 B)**,
`personas.db` (347 MB), `personas_data.db`, two full database backups, `logs/`
and `crash_logs/`. `connect-src` lists `asset:` and `http(s)://asset.localhost`
in **both** policies, and the handler opens any scope-allowed absolute path with
`Range` support and `Access-Control-Allow-Origin`. **No capability, no token, no
audit** — the asset protocol appears in none of the manifest's 15 namespaces.
All **8** `convertFileSrc` call sites read named subdirectories; **none needs
`$APPDATA`.**

> **Two corrections, 2026-08-17, by [`media-viewer.md`](./golden-paths/media-viewer.md)
> §12.1.** (1) This line read *"All **16** `convertFileSrc` sites"*. Measured twice
> independently: **16 is the occurrence count — 8 calls + 6 import bindings + 2 comment
> mentions — across 6 files, not 7.** (2) More importantly, **the call-site count does
> not bound the exposure and should not be read as doing so.** `convertFileSrc` is
> `window.__TAURI_INTERNALS__.convertFileSrc(filePath, protocol)`
> (`@tauri-apps/api/core.js:234-236`) — a synchronous string formatter with no IPC, no
> scope consultation and no validation. The handler serves the scope to anything in the
> renderer that can form a URL.
>
> **And one addition that makes the narrowing more urgent, not less.** In every
> **release** build the managed drive root is `app_data_dir()/drive`
> (`commands/drive.rs:355-359`), i.e. **inside** `$APPDATA/**`. So `drive_read`'s
> resolver — `resolve_safe`, which refuses absolute paths and `..`, canonicalises against
> symlinks and caps reads at 50 MB — is proving containment within a directory this scope
> publishes wholesale. `resolve_and_guard` (`path_safety.rs:244-251`) explicitly *blocks*
> the app-data directory; `assetProtocol.scope` explicitly *allows* it. The proposed
> `$APPDATA/drive/**` replacement is therefore not cosmetic: it is what makes
> `resolve_safe` mean something. (Debug builds put the root at `.dev-drive/`, outside the
> scope — so the dev build does not exhibit this and the release build does.)

**And there is a live third-party origin inside that document.**
`useYouTubePlayer.ts:61-65` appends `<script src="https://www.youtube.com/iframe_api">`
to the **top-level** `document.head`. That origin gets `window.__TAURI__`,
`window.__IPC_TOKEN`, all 1,585 app commands, and `fetch('http://asset.localhost/…')`.
`withGlobalTauri: true` was added for a hidden `radio` WebviewWindow **that no
longer exists**, and `window.__TAURI__` has **0 occurrences in 4,829 `src/`
files.**

**Why held:** narrowing `assetProtocol.scope` or flipping `withGlobalTauri`
changes what the WebView may load — the runbook's named out-of-bounds class.
Both are small and both are strongly indicated.

---

## 43. The dev CSP is never applied, and the gate this campaign added validates it

**Where:** `tauri.conf.json` `devCsp`; `scripts/check-csp-hosts.mjs:139-141`.

**What is measured:** `PROXY_DEV_SERVER = cfg!(all(dev, mobile))`, and `csp()`
is only reached through `get_asset` → the `tauri://` protocol. **In desktop dev
the webview navigates straight to Vite, which emits no CSP header, and
`index.html` has no `<meta>` fallback.** Confirmed from build outputs already on
disk: 10× `cargo:dev=true` under `target/debug`, `cargo:dev=false` under
`target/release`. So `npm run tauri:dev:lite` runs with **no policy at all** —
not a permissive one. `devCsp` is live on exactly one configuration,
`tauri android dev`, and the Android config declares none, so it inherits the
desktop string verbatim.

**This is an audit of this campaign's own work.** `check-csp-hosts.mjs` — a gate
I added and wired into `npm run check` — **fails the build when a fetch host is
missing from `devCsp`**, enforcing an allowlist that governs nothing on the
platform the operator develops on. The gate is not wrong about hosts; it is
pointed at the inert half of a two-policy split.

**Related, and it inverts a supposition of mine:** the packaged `connect-src`
contains **no loopback host at all**, so from a packaged build the 116 loopback
routes of item 39 are unreachable by `fetch` — an undocumented real control. In
dev they are reachable **because there is no policy**, not because the policy
allows one. And CSP matches host strings, so `http://localhost:*` would never
have matched `http://127.0.0.1:17400` — the spelling all 8 of this repo's own
address literals use.

**Why held:** deleting `devCsp` so `csp()` falls back is one line and the
strongest fix in that document. It changes what the WebView may load.

**Also measured:** two capability files grant **120 of Tauri's 193** plugin
commands to one window, and Tauri's ACL gates **0 of this app's 1,585** IPC
commands because `src-tauri/permissions/` does not exist. `capabilities/mobile.json`
has **no `windows` clause**, so 112 commands reach every Android window present
and future. **6 of 15** desktop entries and **5 of 9** mobile entries contribute
nothing. `check:tauri-configs` reads **3 of 5** config files and **1 of 3**
authored CSP strings — and **the only banned-token hit in the repository is in
the one file it does not open.** A **fifth, git-tracked** Tauri config
(`.tauri-scraper-dev.conf.json`) enables the 46-route test-automation bridge and
is referenced by no script, doc, CI job or hook. A **fourth** version string
lives at `gen/android/.../tauri.conf.json`: **0.1.6**, against 1.1.0 everywhere
else.

---

## 44. A persona is 17% of its own prompt

**Where:** `runner/mod.rs:973,1014,1042,1062,1065,1089`;
`prepared_run_cache.rs:93-136`; `MEMORY_SYSTEM_PREAMBLE`.

**What is measured**, by transcribing `assemble_prompt_with_skills` into a
harness and replaying it over **1,433 reconstructed production prompts
(107,020,554 bytes actually sent)**, calibrated against the byte count the
runner writes into its own logs:

| source | share |
| --- | ---: |
| **appended by the runner after `assemble_prompt` returns** | **44.54%** |
| static text compiled into the binary | 34.36% |
| **persona-authored text** | **10.75%** |
| input data (fenced) | 6.16% |
| everything else | 3.80% |

Median real prompt **68,462 bytes**; **26,722 bytes are byte-identical on every
execution**. The transcription reproduces `assemble_prompt` byte-for-byte — 0 of
1,433 overshoot, and the 2 executions that took no runner append reconstruct
with a delta of **exactly 0**.

**The 44.54% is appended below the security canary, below `## EXECUTE NOW`, and
outside the reach of the fence, which is `pub(super)`.** Eight append sites.
**1,031 of 6,535 memory rows (15.8%) already contain a triple-backtick fence**
injected raw — latent, but durable, because a memory is re-injected forever.

**The memory budget drops 93% of what it selects.** 3,767 of 4,052 candidates
discarded; **1.5% of candidate bytes survive**; **2,456 memories (37.6%)
individually exceed the entire 6,000-character budget.** The "N omitted" log
line appears in **0 of 2,982 logs**. And `prepared_run_cache.rs` is a **second
memory renderer with no budget at all**, whose cache key omits `name`,
`description` and `parameters` — rename a persona and get the old prompt for
five minutes.

**Nothing records what was sent.** 0 rows anywhere; 2,942 `prompt_assembly`
spans whose only metadata key is `is_resume`; `chat_session_context.system_prompt_hash`
exists on a table with 0 rows. **0 of 78 personas assemble byte-identically
twice**, and memory selection drifts for 5 of 59 personas over 7 days with zero
data change.

**Two things the prompt says that are false:** `MEMORY_SYSTEM_PREAMBLE` (1,785
bytes, in 100% of prompts) tells the model its memories live in a table named
`memories` — **which does not exist** — with tiers `working → active`, omitting
`core` and `archive`. And `FANOUT_DIRECTIVE` promises `--max-budget-usd` bounds
cost, which **0 of 78** personas set. Separately, **27 of 78 personas ship
unresolved `{{placeholders}}`**.

**Why held:** every item changes what is sent to a model on the operator's live
personas.

---

## 45. A table primitive decides whether to window from a number that defaults to zero

**Where:** `UnifiedTable.tsx:446,:523,:674`; `DataGrid.tsx:155,:227-231`;
`MemoriesPageDense.tsx:356`; `LlmCallsTable.tsx:178,:315`.

**What is measured:** `rowHeight = 0` and `const useVirtual = rowHeight > 0`, so
omitting the prop maps **every row into the DOM**. **12 of 22 call sites never
pass it.** Executed in jsdom over real row counts:

| rows | `rowHeight` omitted | `rowHeight=40` | ratio |
| ---: | --- | --- | ---: |
| 100 (Memories as it ships) | 99 ms / 801 elements | 29 ms / 186 | 3× |
| 500 (Memories while searching) | 510 ms / 4,001 | 29 / 186 | 17× |
| **6,535 (every memory)** | **4,463 ms / 52,281 elements** | 29 / 186 | **155×** |
| 9,803 (whole audit log) | 4,517 ms / 49,016 | 23 / 117 | 201× |

The windowed branch mounts **23 rows at every N**. Element counts are exact; the
milliseconds are jsdom's, with no layout and no paint, so they are a **lower
bound**.

**The worst real list is `MemoriesPageDense` over 6,535 rows** — the largest
user-facing collection, and the only surface whose windowing was *removed on
purpose*.

**Three props are accepted, typed, and silently inert without `rowHeight`:**
`scrollRestoreKey`, `onEndReached`, `groupBy`.

**And windowing does not touch the second defect.** `LlmCallsTable` passes
`rowHeight` and is still wrong: it sorts **client-side over the loaded window**.
Replayed on 2,188 real executions sorted by cost descending, the top row reads
**$2.53** at page 1 and **$3.76** at the client's 500-row ceiling, against a
corpus max of **$7.16** — **0 of the true top 10 are present at any page.** On
append, **50 of 50 rendered rows move**; the control with no sort moves 0.

**The fix is a default, not a type:** default `rowHeight` to the density's row
height and `pageSize` to 25, the way `FacetedDecisionTable.tsx:105` already
does. One line per primitive, reaching all 12 sites with no call-site edit —
**and the census rule should then be deleted, not baselined at 0.**

**Why held:** it changes how every table in the app renders.

**Also:** `CredentialIntelligence.tsx:48` fetches 500 audit rows for a
credential holding **3,813**, and the tab label reads "500" — the cleanest proof
that bounding the render and disclosing the corpus are separate obligations.
**27 of 54** `.slice(0,N).map()` files disclose nothing at all, including the
command palette silently dropping search matches.

---

## 46. A removed tab name in localStorage crashes Settings on every launch

**Where:** `SettingsPage.tsx:74`; `devToolsProjectSlice.ts:98-105`;
`UnifiedTable.tsx:44-61,:478-486`.

**What is measured:** `tabComponents[tab]` with **no fallback**. A persisted
`settingsTab` outside its current union renders `undefined` and React throws
*"Element type is invalid… got: undefined"* — and **nothing rewrites the stored
value, so it re-crashes on boot 2 and boot 3**. `SettingsTab` really did lose
`quality-gates` and `config`. `TriggersPage.tsx:118` is the identical construct
with `?? DEFAULT` and degrades correctly.

**The population behind it:** **51 members have been removed from the 18
view-state unions across 156 revisions, and 27 of those removals were from the
10 unions persisted across restart.** There are **five** hand-written repair
arms.

**Why this is the doctrine's build boundary from the other side:** a persisted
value's **writer and reader are different builds of the same program**. No type
spans them — the type the writer used may not exist when the reader runs — and
the JSON round trip strips what little was left. The compiler is satisfied at
both ends.

**Why held:** the fix is a fallback plus a rewrite-on-repair, and a wrong version
of it silently discards a setting the operator chose. **If Settings ever fails
to open, this is the first thing to check** — clearing `settingsTab` from
localStorage recovers it.

**Two more that persist and shouldn't:**

- **`devToolsProjectSlice.ts:98-105`** never reconciles `activeProjectId` on
  fetch, so **46 production files can act on a ghost id**. The server already
  performs that check, and its frontend door `getActiveProject` has **zero call
  sites.**
- **`UnifiedTable.tsx:44-61`** — a persisted sort key naming a deleted column
  silently unsorts **and is rewritten to disk on every mount**, so it never
  self-heals.

**Memories that hide data from you:** `monitorCollapsedGroups`,
`homeHiddenSections`, `collapsedSourceKinds` and `incidents:collapsed-groups`
are **never pruned** — a group that vanishes and later returns comes back
**collapsed**, on a choice made months ago that is no longer visible anywhere.

**Work the app loses:** **58 of 119 `<textarea>` files have no home for the text
beyond `useState`** — no backend door, no storage write. Personas is
nevertheless *ahead* of the whole fleet here: draft persistence has 7 hits
across six repos and all seven are ours.

**And the scroll inversion has a structural cause, not a tab cause.** A scroll
offset lives on a DOM node whose lifetime is set by CSS layout; everything else
lives in a component whose lifetime is set by a conditional. So the offset
survives *any* swap under a shared scroller and the content survives *none* —
**520 scroll-container occurrences against 3 explicit resets**, one of which is
inside the primitive itself. The repo's own `useScrollRestoration` fixes it in
both directions and is used at **4 sites, only 3 of which pass a key**.

**A primed lead of mine inverted, worth recording:** the loading doctrine's
module-scoped cache was generalised to 14 named sites — **81 module caches
exist, 80 hold fetched data and 0 hold view state.** "Keep the data warm" was
adopted; "keep the view" was not. Those surfaces now paint instantly into a
panel that is scrolled wrong and re-collapsed.

---

## 47. A backfill destroyed the evidence that would have shown whether it worked

**Where:** `incremental.rs:5771-5772`; `lib.rs:1092`; `memories.rs:2016-2021`;
`reviews.rs:1880`.

**What is measured:** **14 backfill operations. Eight are buttons the user can
press. Exactly one can tell its caller it finished — and that one has never
run.** 3 of 14 are bounded, 1 is chunked, **0 write down that they ran**. There
is no ledger, and `PRAGMA user_version` is 0 in both databases.

**`backfill_lab_tool_calls` destroyed its own evidence.** It calls the fill and
then `drop_legacy_tool_calls_columns` — **not in one transaction**,
unconditionally, through twelve `let _ = ddl_step`. Its guard is
`SELECT COUNT(*) FROM lab_tool_calls > 0`, **a latch that closes on the first
row**. Live: 259 rows, 58/58 arena results covered, 1 orphan — and the source
columns are gone, so **completeness is now unanswerable in principle.**

The correct shape is **7,400 lines earlier in the same file**:
`clear_legacy_credential_blobs` destroys only after proving every key is
present, and `assert_credential_blob_invariant` re-checks on every boot. Both
shapes, one repo.

**The chunked backfill terminates on the value a total outage returns.**
`Ok(0) => break`, against a counter that counts successes only and warns
per-row failures uncounted. Live it *has* converged (5,158/5,158, id-exact, 0
orphan) — which is the good outcome **and the outcome a dead embedder is
indistinguishable from.** Its sibling one directory away returns
`ReembedResult { embedded, skipped, available }` and separates all three.

**One backfill re-reads 417,798 rows on every launch after convergence** —
391.91 ms per batch × 81 batches = 31.7 s of re-scanning, and **392 ms every
launch thereafter**, which is 40× the entire migration chain's unconditional
set.

**`reviews.rs:1880` has never run: 113 of 113.** Its receipt is discarded at
`useGalleryActions.ts:220`. `scheduler.rs` computes `skipped_duplicate` and
drops it at the boundary. `SetupPanel.tsx:98-100` raises a success toast on a
four-way zero.

**Why held:** running or repairing a backfill is the one class of change that is
unrecoverable, and several of these need a decision about what "complete" means
before they can be fixed.

**What is genuinely good here, and worth not breaking:** **13 of 14 are
re-runnable, 12 of them by querying the destination.** That is an unforced
convention with no counterpart in the fleet. And `backfill_schedule` is the
repo's complete answer — a cap probed at +1, a version CAS claimed *before* any
read, destination-derived dedup, a mid-pass ceiling that halts, and a receipt
carrying `failures`, `capped` and the enqueued fire times. **0 of 4,972 events
carry `backfill_slot`, and 0 of 351 triggers configure `max_backfill`, so it has
never had a candidate.** The best instrument in the leaf has never fired —
the same anti-correlation between guard quality and usage the corpus has now
measured on four leaves.

**The fleet's one lead worth importing:** `brainiac` is the only repo where an
incomplete fill makes a **reader refuse** — born-incomplete, drain, flip
`is_active`, and both serving doors bail. Against that, three near-universal
omissions: **0 of 5 claim a bulk pass**, **0 of 5 gate a destroy on
proven-complete**, and **0 of 5 distinguish "0 already done" from "0 nothing
matched".**

---

## 48. Chain Studio hides 38 of your 78 personas and blames your search box

**Where:** `useStudioComposer.ts:74`; `StudioRails.tsx:74,:165-167,:179,:221-223`;
`StudioOptionCards.tsx:71-75`; `CommandPalette.tsx:229,:235,:251,:260`.

**What is measured**, replayed in a jsdom harness against the live DB: **78
personas in the table, 40 reach the DOM. 38 hidden (48.7%), and nothing on
screen says so** — `setup 29 · low_trust 7 · disabled 2`. Driving the picker
once per persona with that persona's **exact name** in its own search box:
**38 of 78 return `No targets match "…"`**. Eight distinct names can never be
found by any query. **The one sentence the surface says about emptiness names
the query, and the query is not the cause.**

**The predicate is editorial, not constitutive** — a paused persona is a
perfectly valid chain target, and `commitLink` would succeed.

**And the 40 that do show cannot be told apart.** Your data has **nine persona
names each occurring exactly seven times, once per team**. The Studio rail
renders icon + name; the command palette renders name + team. Same collection:

| | Studio rail | Command palette |
| --- | ---: | ---: |
| rows offered | **40** | 78 |
| distinct visible labels | **16** | 78 |
| **not uniquely identified** | **28 (70.0%)** | **0** |

All four colliding groups share a *description* too, so the hover tooltip cannot
break the tie either.

**Across 55 picker surfaces: 28 narrow their options, 18 disclose nothing, and
exactly 1 publishes a number from which you could tell what is missing.**
Onboarding — the first picker a user ever sees — fetches 12 and shows **3**. The
command palette's caps discard **42,733 results across 807 realistic queries**;
494 of those queries lose results, and the worst single letter discards 370.
`GitHubRepoSelector` fetches `per_page=100`, so repo 101 is unreachable **and
the search box only filters the fetched page**. `StationPicker` removes hidden
stations from the list **while they are still playing**.

**Three that write a bad value rather than hide a good one:**
`CanvasShell.tsx:878` was reported as **dispatching a fleet job with an empty label** for a deleted group — **refuted 2026-08-17 by [node-canvas](./golden-paths/node-canvas.md): the fallback label resolves and the payload is captured by value.** It is a real match of the picker pattern and not a live defect; `SlackBridgePickers.tsx:101` writes a dangling channel id with a
**null name** into saved config; and `PersonaSelector.tsx:86-91` renders a
deleted persona as **"All personas"** — the widest possible scope from the
narrowest possible cause.

**Why held:** every fix changes what a chooser offers, and the blocker is
structural — **no shared primitive can express a disabled option with a reason**,
so the right prescription has nowhere to land until that one primitive edit
happens.

**The exemplar is in the same folder as the worst picker:**
`AddPersonaModal.tsx:82-83,:138,:232-262` computes `${availableCount} available`
in the component that renders the list, excludes only constitutively, groups by
team with per-group counts, and ships a **two-armed** empty state.

**A correction to my own primed lead, worth keeping:** the `trust_score < 0.5`
unit bug is real and **currently inert**. The minimum is **0**, not 58.5 — 58.5
is the minimum *non-zero* — and the distribution is bimodal with nothing between
0.5 and 50, so `< 0.5` and a correct `< 50` select the **identical 7 rows**.
`'Low trust'` actually means *"never scored"*.

---

## 49. Pause and resume are wired to a value the database rejects

**Where:** `team_assignment_orchestrator.rs:538`;
`commands/teams/assignments.rs:196`; `core/src/models/team_assignment.rs:31,:63`.

**What is measured:** the orchestrator writes the literal `"paused"`, and
`team_assignments`' CHECK constraint **does not permit it**. Replaying the exact
`UPDATE` against an in-memory database built from the live DDL: **rejected.**

So the whole feature is dead — `pause_assignment`, `resume_team_assignment`'s
`!= "paused"` precondition, the tick loop's paused-exit, **two IPC commands, a
store slice and two rendered buttons.** **0 of 8,486 ledger events is
`status_paused`.**

**The type that makes this unrepresentable already exists and is wired to
nothing.** `TeamAssignmentStatus` and `TeamAssignmentStepStatus` are closed
enums with `as_str()` and `is_terminal()`, ts-rs-exported, whose variants match
the live CHECK allowlists **exactly** — and they have **0 consumers across 963
Rust and 4,828 TypeScript files**. The orchestrator hand-rolls
`fn terminal_step_status(s: &str)` and passes **21 bare literals**.

**Why held:** correcting it turns on a feature that has never run.

**Adjacent, measured on the same engine:** one counter serving two caps (53
steps, 33 of them already `done`); **149 of 326 retries (45.7%) never counted**;
**357 of 1,301 attempts (27.4%) unreachable** because the attempt pointer is
overwritten — the widest step duration reads **87.32 hours**; a cancel recorded
as `"failed"`; and **22 of 36 durable job stores have never held a row**,
including `chain_stop_reasons` (0 rows against **727** chain firings, because
its write is gated on a `chain_trace_id` present on 3 of 2,942 traces).

**Reconstruction succeeded, and that is the good news.** One real assignment —
4 steps, 106 events, **9 auto-resume rounds over 9h57m** — recovered completely
from three tables, including every transition, failure and cascade. It has been
stuck at `awaiting_review` for **68 days**, and an `athena_review_resolution` at
minute 94 named the real cause. Nothing reads it.

**Two answers worth importing:** `brainiac`'s `failed`/`dead` split with
claim-time reaping, and `ascent`'s lease instead of a reaper.

---

## 50. 37 fields declared sensitive render as visible controls

**Where:** `credentials.rs:104-108`; the connector field declarations;
`McpToolInputForm.tsx:26,:41`; `ToolDetail.tsx:63`.

**What is measured:** **`sensitive` is set on 184 of 196 live connector field
declarations. It decides encryption at rest in Rust — and it appears in no
TypeScript type and in no renderer.** **37 declared-sensitive fields render as
visible controls.** The app's own connector form rebuilds 7 keys and **cannot
emit the flag at all**, so a field created through the UI cannot say it is
secret.

**Thirteen field-declaration formats, no two agreeing.** Of the nine with a
closed control-kind vocabulary, **0 of 36 pairs are identical** and 8 pairs are
fully disjoint. The identifier is `key` ×6, `id` ×4, `name` ×2, and an object
key ×1. **Exactly one format's union is generated** — `ParamType`, ts-rs from
Rust — and it is the only renderer that cannot drift.

**The declaration and the renderers disagree in both directions.**
`AdoptionQuestion` declares 3 types; one renderer renders 8 and another renders
3, with five tokens existing in neither the type nor the other renderer — and
the Rust binding types the questions `any`.

**8 of 11 payloads from the MCP tool form are rejected by the schema that
rendered the form.** Over 123 real schemas: **123 `enum`s become free-text
inputs, 123 `format`s are ignored, and 369 `required` marks produce 0
enforcement** — the submit gate is `disabled={executing}`. And all 162 parsed
`persona_tool_definitions.input_schema` rows are **byte-identical**
`{"type":"object","properties":{},"additionalProperties":true}`.

**Hostile input, executed:** `properties: 'a,b,c'` renders **five inputs
labelled 0–4**; `properties: {a: null}` throws uncaught.

**Why held:** honouring `sensitive` in the renderers changes what is displayed
for 37 live credential fields, and enforcing `required` changes whether a form
can be submitted. Both are right and both are live-surface changes.

**Two corrections to my own brief, worth keeping.** `deny_unknown_fields` is the
**wrong instrument here** — no format in this leaf has a closed key set to
enforce. And `Record<string, …>` widening *is* present in the form layer, but on
the **declaration**, not the values; the value bags disarm nothing.

**The composer disproved one of its own predictions** — a `key`/`name` collision
it expected to be live is latent, 0 instances — and its masking instrument
produced a clean false result until an assertion killed it, which is what
surfaced the `sensitive` gap.

---

## 51. All 78 personas run at one model and one effort, and the UI shows neither

**Where:** `runner/mod.rs:352`; `config_merge.rs:45-56`;
`PersonaConfigPanel.tsx:13-19,:227-233`; `cli_args.rs:300-303`;
`athena_reaction.rs:551-554`; `compareHelpers.ts:22-24`.

**What is measured:** the app offers **3 model tiers × 4 effort levels**.
Replayed over your 78 live personas, **all 78 resolve to one cell:
`claude-sonnet-4-6 @ medium`.** 74 arrive there by falling through a six-layer
cascade into a hardcoded constant; 4 name the same value the constant would
give. **Five of the six layers have never held a value** — `global_model_profile`
absent from a 32-row `app_settings`, `default_model_profile` NULL on 8/8 teams,
`model_profile` NULL on 74/78, 0 routing rules, `model_preference` NULL on
316/316. Effort is set on **0 of 78**, and `thinking_level` holds **one distinct
value across 1,004 populated rows**.

**The floor works, and the cross-tab proves it.** Every run with
`model_profile = null` used `claude-opus-4-8[1m]` — **141 of 141** — costing
**$193.24 over 152 rows in 37 hours**, and stopping dead on 2026-06-14, the day
the floor landed. **569 executions since, 100% sonnet.**

**But the UI shows neither value.** The Configuration tab has **no effort row at
all** — `EffectiveModelConfig` has no `effort` field, so effort has **1**
resolution layer where model has 6. And for 74 personas the Model cell renders
`--`, with a header comment explaining that as *"the accurate state for personas
that inherit the CLI default"* — **which stopped being true on 2026-06-14.** The
panel models the cascade and not the terminal constant, so it describes a fixed
leak as still leaking.

**Three places the effort is silently wrong, not merely absent:**

- `cli_args.rs:300-303` — the resume builder pins `DEFAULT_EFFORT` and emits **no
  `--model`**, while its comment claims it *"keeps continued sessions on the same
  effort policy as their initial run"*. Its signature takes only a session id, so
  it cannot.
- `athena_reaction.rs:551-554` — the replayed argv contains **`--effort medium …
  --effort low`**, twice. An assertion that `effort_count == 1` exists *inside*
  the builder, one frame below the violation.
- `oneshot.rs:171-189` — all 8 `call_claude_text` callers drop their tier's
  bench-chosen effort, and `MICRO`/`ASIDE` document `None` as *the model's
  default (high)*, so the omission lands **above** the chosen level.

**A 1,000× unit error in a price comparison:** `compareHelpers.ts:22-24` states
per-**million** prices as `/1K`, and **two of the three numbers are wrong at
source**; `pricing.ts:8-10` re-types the same two errors.

**Why held:** wiring effort through changes what every persona actually runs at
and what it costs.

**The app's own defaults contradict its own bench, narrowly.**
`BUILD_TURN_EFFORT = "xhigh"` was set with no reference to the only measurement
in the repo — which found quality *inverting* above medium on long-form work.
The honest scope: that bench's build arm was descoped as invalid, so the finding
is that two defaults were chosen without consulting the one measurement, not
that they are provably wrong. `provider/claude.rs:232-235` already records the
question as open, in writing.

**Personas is ahead of the entire fleet on one thing:** **0 of 5 siblings record
the effort a run used.** `ascent` has the knob *and* a six-read-site recording
layer, and they never meet. Two more 0-of-5 silences: nobody carries model and
effort as one value (`TurnTier` is the only such type anywhere), and nobody
names the effort default.

**And a correction to a correction of mine.** I recorded that `thinking.xhigh`
renders raw *while the same concept is translated in all 14 locales under
`models.effort_xhigh`*. **That escape hatch is itself broken** — `models.effort_xhigh`
is the raw token in **en, ko and vi**, and `"Xhigh"` in `id`. English is the
source of truth, so it is broken for the default-locale user. The root cause is
the more useful half: when `en = "xhigh"` and `ko = "xhigh"`, the untranslated
check reads the match as a deliberate do-not-translate term. **A locale check
cannot tell a missing translation from a proper noun, and a machine token is
shaped like one.**

---

## 52. One Disconnect in Trigger Studio deletes every listener in the capability

**Where:** `delete_subscription` / `update_subscription` — they address
`persona_triggers` by `(persona_id, use_case_id)`.

**What is measured**, by running the real `buildEventRows` over live data: **46
subscription cables map to 77 listener deletions.** 26 of the 46 delete more
than they name; worst case **five**. And **49 of 102 subscription *edits* would
clobber another listener's `listen_event_type`** — 71 rows.

**Why held:** it is a data-loss defect on a surface the operator uses, and the
fix is a key change on a delete path — the class where a wrong repair is worse
than the defect.

---

## 53. 325 triggers badge `armed`; 104 can ever fire

**Where:** `buildTriggerConfig.ts:75`; the `persona_triggers` CHECK; `design.rs:339`.

**What is measured:** of your **351** triggers, **104 can ever fire
unattended — and the UI badges 325 of them `armed`.** 98 rows read `armed` and
can never fire. `get_due` returns **0 rows**, and **0 even with the time bound
removed entirely**. **0 of 2,188 executions carry a `trigger_id`.**

**Four of the ten trigger types the surface offers cannot be stored.** Lifting
the live `CREATE TABLE` into an in-memory database and attempting one INSERT per
type: `file_watcher`, `clipboard`, `app_focus` and `composite` all fail the CHECK
constraint — and the fresh-install schema is identical, so this is not
machine-specific. **All six quick templates target a rejected type**, and no
error-registry rule matches a CHECK failure, so what the user sees is
*"Something went wrong. Try again."*

**Six vocabularies for one closed set**, at arities 10 / 10 / 10 / 8 / 6 / 4 —
and `design.rs:339` flags `event_listener`, which is **189 of 351 live rows**, as
*"Unknown trigger type"*.

**The form writes 23 config keys; the engine reads 8.** Thirteen belong to
unstorable types; two are stored and read by nothing. `config.endpoint` is
written where `TriggerConfig::Polling` declares `url` — and the readers that *do*
accept `endpoint` are the SSRF guard and the Test tab, **which reports
"Reachable"**. `config.event_id` and `config.rate_limit` (four numbers and an
"Active" badge) have no reader at all; `recordTriggerFiring` has **0 call
sites**.

**Why held:** widening the CHECK turns on four trigger types that have never
existed; narrowing the menu removes six templates the operator may be using.
Either is a product decision.

**The convergence result is the sharpest of the batch:** *where a scheduler
stores a next-run timestamp beside an enabled boolean, the timestamp quietly
becomes the real switch* — **2 of 3 siblings inverted the same way**.
`brainiac`'s disable leaves `next_run_at` armed, so a disabled sweep **fires once
more**, and its test covers enable→armed and never disable→disarmed.

---

## 54. Every table shaped to hold an alarm's identity holds zero rows

**Where:** `healing.rs:185` + `fk_hygiene.rs:523`; `alert_evaluator.rs:241,:274`;
`alertSlice.ts:431-442`; `notifications.rs:1543`; `engine/mod.rs:2777`.

**What is measured:** every table in the database shaped to hold an alarm
*identity* — a problem key, an occurrence counter, a first/last-seen pair —
**holds zero rows**: `healing_knowledge`, `automation_suggestions`,
`schedule_missed_runs`, `circuit_breaker_state`, `alert_rules`, `fired_alerts`,
`budget_alert_rules`, `notification_subscriptions`. **Every table holding live
alarms is keyed on the occurrence.** `fired_alerts` — the table named for this —
has no dedup key, no counter, no last-fired and no resolution state, and has
never held a row, so the app's one restart-proof cooldown has never executed.

**Replayed over the same 205 healing rows:**

| suppression | kept | suppressed |
| --- | ---: | --- |
| **deployed** `UNIQUE(persona_id, execution_id)` | 205 | **0 (0.0%)** |
| cooldown 1 h on the problem | 175 | 14.6% |
| cooldown 7 days | 110 | 46.3% — *and it erases the evidence* |
| **identity** `(persona, title)` | **93** | **54.6% — and it loses nothing** |

**Identity strictly dominates a cooldown at every window.** A cooldown is not a
weaker dedupe; it is what you reach for when you failed to find an identity. And
the repo's careful title normalizer produces **the same 75 groups as the raw
title** on the queue that needs help — so the defect is *which columns the index
names*, not string matching.

**Two alert evaluators exist**, one in Rust and one in the frontend, racing on
check-then-act with different snapshots — and the client one **cannot compute
`cost_spike` at all**. Three suppression ledgers are **one-way latches with no
expiry**: suppression until process exit, then it fires again.

**Why held:** changing a dedup key changes which alarms you see.

**The sentence that ties it together** is already in the source
(`cli_mcp_config.rs:97-100`): *"There is no occurrence counter on the incident
spine itself, so we count here."* **The only escalate-on-repetition in six
codebases had to keep its counter in a process-global — the exact anti-pattern
its own leaf's census rule ratchets — because the durable table has no column
for it. One integer column closes both ends.**

**Two corrections to my own register, both making this repo look better than I
recorded.** `dev_ideas.dedup_key` at 22 of 236 is a **temporal cut, not a
coverage gap** — all 214 unkeyed rows predate 2026-06-13 and all 22 keyed rows
postdate 2026-07-27. And the rejection **exclusion set is read**, through a live
production chain; only the reason *string* is unread. This repo already ships
`REJECTED_DEDUP_WINDOW_DAYS = 90` with `brainiac`'s own phrasing.

---

## 55. 64 credential bindings would fail to resolve right now

> **RE-VERIFIED 2026-08-17 — still open, and the missing side is the opposite one.**
> Backup against live: `personas` **78 → 1**, `persona_credentials` **25 → 25**,
> `connector_definitions` **134 → 134**. The purge removed personas and left every
> credential and connector standing, so the binding that fails to resolve is missing its
> **persona**, not its credential. The parse defect itself is untouched code and the next
> persona created re-enters it. **Do not read the changed row counts as a fix** — this is
> the same trap the corpus has now recorded four times today. The Gmail grant named below
> is still live and now 76 days expired (measured 75 one day earlier; the two agree).

**Where:** `core/src/models/persona.rs:711,:458,:485`;
`engine/runner/credentials.rs:455-480`; `connector_readiness.rs:263`.

**What is measured:** a slot binding here is **a key in a JSON object in a TEXT
column**, and the app's own typed reader of that column **fails on 63 of your 78
personas**. `parse_design_context` errors at `connectorPipeline[0]` — the live
data is **154 bare strings** where a struct array is declared, **0 of 154
satisfying** — then falls to a legacy branch looking for `credential_links`
(snake) where the data writes `credentialLinks` (camel). Every binding in the
same envelope dies with it.

**117 declared slots across 73 personas; 4 carry an explicit binding (3.4%).**
The other 113 are guessed. **63 of 63 codebase pins are lost at parse**, and **18
of those 63 point at a project that no longer exists**.

**Nine sites bind by taking element zero of a candidate set.** There are 3
credentials of type `codebase`, and **69 of 117 slots all resolve to the newest
one** — so adding a fourth silently re-points all 69.

**Direct answer: 64 live bindings would fail to resolve right now, and no
surface says so.** Readiness is decoupled from the binding *by construction* —
`has_dev_project` asks whether **any** of 14 active projects exists, never
*which*, so the verdict cannot fail while the binding is wrong. Separately, **24
of 78 personas have a persisted `setup_status` that disagrees with a live
recompute** (22 over-block, 2 under-block), and **29 personas are blocked with 1
`SetupBlocker` row in the entire database.**

**One that is worth naming individually:** `Product Scout (4)` carries an
explicit, correct, non-dangling `email` binding — pointing at the Gmail grant
that **expired 75 days ago**. The server refuses it, the client shows it
satisfied, **and the runtime injects it.**

**Why held:** re-binding touches real credentials.

**A correction to a claim inside a shipped census rule.** The
`comment-kept-cross-language-mirror` rule's description quotes *"5 of 5 distinct
connector labels on 154 live persona-connector pairs normalize differently"*.
That figure measures `design_context.connectorPipeline` — a display-label array
**the normalizer is never called with**. The corpus the resolvers actually see
is 117 pairs / 11 labels, of which **1 of 11** normalizes differently, and that
one is unreachable on both sides. The vocabulary split is real and the rule's
condition is unaffected; the quantification was of the wrong corpus. **Corrected
in the document and in `rules.json` together**, so the two do not drift.

---

## 56. Twenty-one derived structures, one is checked

**Where:** `db/src/lib.rs:646-649` and `:409`; `companion/brain/backlog.rs:100`,
`cockpit.rs:52`; `repos/execution/tool_usage.rs:118-126`.

**What is measured:** **21 derived structures across your two databases. One is
checked.** Of the twenty that are not, **eight are measurably diverged**, one has
no writer at all, and the largest is 99.97% padding.

**The whole reconciliation surface is `executions_fts_drift` — and its un-fixed
twin is 209 lines away in the same file.** `lib.rs:646-649` guards the
`kb_chunks_fts` backfill with `SELECT COUNT(*) FROM kb_chunks_fts` — which, on an
external-content table, returns `kb_chunks` — and compares with `<`. **The
condition is `chunk_count < chunk_count`: false at every size, forever.** It
carries the exact defect its neighbour's comment documents having fixed, *plus*
the `<`-versus-`!=` one that comment separately warns about. Harmless only
because both tables are empty today.

**The controlled experiment, and it is the cleanest in the corpus:** the 24 FTS
writes in the tree partition **exactly 12/12** into trigger-declared versus
hand-written, in **disjoint files** — and the partition predicts the divergence.
`executions_fts` is 2,188/2,188 id-exact; `companion_fts` is 1,550/1,554, and
the 4 missing are exactly the kinds written by producers that forgot. **Only 6 of
11 `INSERT INTO companion_node` sites index the node.** On the shipped non-`ml`
build that index is the *only* retrieval lane, so those nodes are **unreachable
by any means**.

**A dashboard reading a diverged rollup:** `tool_usage.rs:118-126` shows **35
tools against 27 real, +13.3% invocations, and 8 of 25 phantom days.**

**Why held:** rebuilding an index or deleting orphans is a data change.

**Two corrections to my own claims, both of which made me wrong in the direction
of alarm.** The composer measured a **41× divergence that does not exist** —
`workspace_knowledge.evidence_count` is harvester-supplied *prevalence*, not a
count of its evidence table. **A `<child>_count` column is not necessarily a
count of `<child>`.** And its own first `sla_daily` pass reported "276 of 500
day-rows disagree" and **agreed with its thesis**; replayed at the machine's real
UTC offset it is **403 of 403 buckets exact**. `sla_daily` is the exemplar, not a
deviation. **Every wrong offset produces a plausible disagreement.**

**The strongest convergence result in the batch, 5 for 5:** every repo in the
fleet establishes a reconciliation-and-disclosure standard **while fixing one
incident, and never generalises it.** That is why the right instrument here is a
registry rather than a better check.

**Personas is ahead** on the boot drift check (no sibling has one) and on the
only place in the fleet where a would-be desync **fails the operation**. It is
**behind** `brainiac` on `GENERATED ALWAYS AS … STORED` FTS columns, which cannot
drift at all.

---

## 57. Two canvases: the reachable one runs nothing, the executed one has no UI

**Where:** `deriveScene.ts:76-96` vs `portfolio.rs:381-382,:425-426`;
`CanvasShell.tsx:340-345,:436,:472-479`; `GroupLayer.tsx:224`;
`team_handoff.rs:203-214`.

**What is measured:** this repo has two node-and-edge canvases. **The one you can
reach draws edges nothing executes and validates nothing. The one whose edges the
engine really does compile has had no UI since 2026-05-23** — 28 of its 29 files
are unreachable from `main.tsx`/`App.tsx`, while **55 of its 70 edges are still
compiled into every `chain` trigger in your database.**

**Executed against your real scene, the reachable canvas renders 14 nodes and 0
edges**, for two independent reasons: `deriveEdges` keys against project *ids*
while the producer writes *names* — **0 of 41 similarity rows resolve, 41 of 41
resolve by name** — and the `0.5` threshold sits against a corpus **maximum of
0.07**. Neither is distinguishable on screen from "these projects are
unrelated".

**What you can draw that the engine cannot run:** 4 edge types render as 4
strokes; the engine distinguishes **2** — `parallel` is byte-identical to
`sequential`. **All 70 live edges carry a hand-written label, and `label` occurs
0 times in the compiler.** **15 of 70 drawn edges (21.4%) have no runtime
effect.** 14 nodes have in-degree > 1, and the wiring makes them an **OR-join,
not a join** — which independently confirms the earlier measurement that **0 of
1,488 orchestration steps has more than one dependency.** Three layers disagree
about one arrow and no surface reports it.

**Three interaction defects, all executed:**

- **The connect gesture accepts duplicates and cycles.** Over all 14 real
  islands, twice: 364 links from 182 pairs, **182 of 182 duplicates**, cycle
  reachable. Self-edges are prevented *incidentally*, not checked.
- **Undo is not the inverse of Tidy.** Coordinates restore exactly — and pinned
  islands go **8 → 14**, after which a second Tidy can move **0 of 14**. Undo
  converts derived positions into user pins, and pins are what Tidy may not
  move. **There is no unpin affordance.**
- **Group delete fires on `pointerdown`** — no confirmation, no undo, not
  abortable — in the same directory where a *reversible* action uses
  `ConfirmDialog`.

**Why held:** every one changes an editing surface mid-use.

**A correction to an earlier register entry:** `CanvasShell.tsx:878` is
confirmed as a **pattern match and refuted as a live defect** — the fallback
label resolves and the payload is captured by value. That sharpens what an
`entity-picker` match *means*, and I recorded it as live in item 48.

**The one instrument worth building**, specified rather than shipped: an
orphan-module inventory over the resolved import graph. ~60 lines, and its
absence is why **28 files, ~2,300 lines and a graph library survived three months
of green `npm run check`.**

---

## 58. The backfill receipt collapses four different zeros into one

**Where:** `src-tauri/src/commands/execution/scheduler.rs:94-107` (`BackfillResult`),
`:221` (the population, computed and dropped), `:229,247,318` (`skipped_duplicate`,
computed and logged), `src/features/schedules/libs/useScheduleActions.ts:283-295`
(the consumer).

**What is measured:** `BackfillResult` carries `slots_enqueued`, `capped`,
`slot_times` and `failures`. It does **not** carry the window's population
(`slots.len()` before truncation, known at `:221`) or the number of slots skipped
as already-published (`skipped_duplicate`, incremented at `:247` and delivered
only to `tracing::info!` at `:318`). The UI branches on `slotsEnqueued > 0` and
otherwise renders one message — so *"nothing was due"*, *"all 47 were already
replayed"* and *"every slot was refused by a ceiling"* are the same sentence with
opposite next actions.

The `skipped_duplicate` half is already on record as
[`backfill-migration`](./golden-paths/backfill-migration.md) §7 D6. The
*population* half is new, and it matters because the same document's
`unfinishable-backfill-receipt` rule cites this struct as its **exemplar of the
compliant shape** — one field short of committing the defect the rule names.

**Fix:** `pub slots_in_window: u32` + `pub skipped_duplicate: u32`, one
construction site (`:323-331`), one `export_bindings` regen, one UI branch.

**Why held:** it changes an IPC contract and a live toast.

---

## 59. Three replay anchors, two truncation directions, one boolean

**Where:** `src-tauri/core/src/scheduler.rs:181-242` (`compute_slots_in_range`,
interval arm at `:231-237`); `src-tauri/src/engine/background.rs:2292-2354`
(`compute_missed_backfill_slots`) and `:2678-2681` (the drain);
`src-tauri/src/commands/execution/scheduler.rs:221-224` (the truncate);
`src/features/schedules/libs/useCronPreview.ts:226-250`
(`generateIntervalFireTimes`).

**What is measured:** the same interval cadence is walked from **three different
anchors** — `last_triggered_at` (auto catch-up), the **user's window `start`**
(on-demand replay), and `next_trigger_at` (the calendar, and the engine itself
via `next_interval_at`). For cron they converge; for interval the on-demand
replay publishes slots at a phase the engine has never used.

And the two bounded paths drop **opposite ends** of an over-long gap:
`slots.truncate(100)` on an ascending vector keeps the **oldest** 100;
`missed.drain(..(len - extras))` keeps the **newest**. Both report the same
`capped: bool`, and neither states a direction. A user who opens the app after a
week away and presses *Run backfill* on an hourly job replays the **week-old**
hundred and drops the sixty-eight nearest to now.

**Fix:** `phase_anchor: Option<DateTime<Utc>>` as an explicit parameter of
`compute_slots_in_range` (the compiler visits both call sites), and a named
direction on the bound (`keep_newest` / `keep_oldest`) rather than a `Vec` method
deciding it.

**Why held:** it changes which slots a live replay publishes.

---

## 60. The replay apparatus cannot be reached, and its idempotence depends on which branch built the payload

**Where:** `src-tauri/src/engine/background.rs:2614-2789` (the auto-catch-up
branch), `:2575-2592` and `:2855-2858` (the miss ledger);
`src/features/triggers/sub_triggers/TriggerAddForm.tsx:225` and
`configs/buildTriggerConfig.ts:62-66` (the authoring control);
`src-tauri/src/commands/execution/scheduler.rs:277-279` +
`src-tauri/db/src/repos/communication/events.rs:539-548` (the dedup key).

**What is measured**, against the 2026-08-17 purge backup (351 triggers —
historical, not reproducible against the live database):

- **0 of 351 triggers set `max_backfill`.** `backfill_cap > 1` has never been
  true, so the ~175-line auto-catch-up branch has never executed. The control
  that sets it is rendered **only in cron mode** while the writer emits it for
  both, so an interval schedule is silently pinned to fire-once.
- **`schedule_missed_runs` holds 0 rows** and `schedule.missed.offline` appears
  0 times in 4,972 `persona_events`. `record_and_emit_missed_runs` runs *after*
  the `mark_triggered` CAS, so every reason a schedule accumulates misses —
  disabled persona, over budget, outside the active window, unparseable zone — is
  also a reason the miss is never recorded. **You only learn what you missed at
  the moment you stop missing it.**
- The on-demand replay's dedup reads `backfill_slot` + `fired_at` **out of the
  event payload**, and those keys exist only in the *synthesized* payload. A
  trigger carrying an explicit `config.payload` takes the other branch and is
  invisible to the dedup — every press republishes every slot. Latent today
  (**0 of 351 triggers set `config.payload`**), live the first time one does.

**Fix:** render the `max_backfill` control in both modes; record misses on the
skip paths as well as the fire path; and move the dedup key out of the payload
into a `slot_at` column with a `UNIQUE(source_id, slot_at)` partial index — which
also deletes a full decrypt of the trigger's event history on every press.

**Why held:** the first two change a live authoring surface and write rows; the
third is a schema migration.

---

## 61. A calendar day with no zone: 36 of 46 runs plotted under the wrong day on the operator's own machine

**Where:** `src/features/schedules/components/ScheduleRowHistoryPanel.tsx:157-186`
(`bucketByDay`); `src/lib/types/timeRange.ts:33-40`; and 16 further sites — the
full inventory is the `zoneless-day-bucket` census rule
(15 files / 18 matches).

**What is measured, by replaying the function verbatim** against the operator's
50 real executions at three host offsets:

| host | buckets mis-labelled | runs under a label that is not their local day | runs dropped |
|---|---|---|---|
| `UTC` | 0 of 14 | 0 of 50 | 0 |
| `Europe/Prague` (UTC+2) | 14 of 14 | **36 of 46** | **4 of 50** |
| `Asia/Tokyo` (UTC+9) | 14 of 14 | 36 of 46 | 4 of 50 |

`bucketByDay` builds its axis from **host-local midnight** (`:161`), keys the
buckets by **UTC date** (`:165`), and labels them back in **host-local**
(`:166`). Identical code, identical data, exactly correct on the machine a CI job
runs on. `timeRange.ts:33` holds the same split-brain in a shared helper, so a
"calendar month" range starts a day early on any positive offset.

Separately, the calendar itself places every fire in the **viewer's** zone
(`ev.time.getHours()`, `dayKey`) while the schedule's own `agent.timezone` — used
correctly to compute the instant — is never rendered; the chip beside the cron
expression shows the **app display preference** instead. Across 4,801 client
files, `timeZone:` is passed to a formatter in **3**.

**Fix:** a `dayKeyIn(instant, timeZone)` / `hourIn(instant, timeZone)` helper over
`Intl.DateTimeFormat`, with `timeZone` **required and undefaulted**, then migrate
the 18 sites; and render the schedule's zone on the calendar axis.

**Why held:** adding the helper is safe; migrating the call sites changes what
several live charts show.

---

## 62. The release tag is pushed before any installer exists — 11 tags, 0 releases

**Where:** `.github/workflows/release.yml:146-154` (the `version` job's
"Commit and tag" step) and `:208` (`build: needs: [version, frontend]`).

**What is measured** (Actions API + `git tag` + Releases API, 2026-08-17):

| | |
| --- | ---: |
| tags on `origin` | **11** |
| GitHub Releases published | **0** |
| `release.yml` runs all-time | 30 |
| …concluded `success` | **0** |

Per-job outcome of the most recent run (`2026-07-16`, the run that produced tag
`v1.1.0`): `bump-version` **success**, `frontend` **success**, all **four**
platform `build` legs **failure**, `updater-manifest` skipped. The version bump
reached `master` and the tag reached `origin`; nothing was built. Eight of the
eleven tags were authored by `github-actions[bot]`. The workflow's own header
comment says this left "5 tags … with zero releases behind them"; it is now 11.

The consequence is not cosmetic: `tauri.conf.json:61-65` points every installed
copy's updater at `releases/latest/download/latest.json`, and the release list is
empty.

**Fix:** move commit + tag + `git push --tags` into a final job that
`needs: build`, and pass the computed version to the platform jobs as a job
output rather than as a committed file. Where Tauri forces the version into the
working tree before the bundle is built (`CARGO_PKG_VERSION` is embedded), write
it to a detached candidate ref that is never pushed until every leg has produced
an artifact.

**Why held:** it changes what the release workflow does to `origin`, and the
operator may want to cut a release by hand before the reorder lands.

---

## 63. `ci-gate` validates one commit and the pipeline builds another

**Where:** `.github/workflows/release.yml:43-70` (`ci-gate`, queries
`?head_sha=${{ github.sha }}`) versus `:85-90` (the `version` job checks out
`ref: master`) and `:156-171` (`resolve`).

On a `workflow_dispatch` from a ref that is not `master`'s tip — or when `master`
advances between dispatch and execution — the commit whose CI conclusion was
checked is **not** the commit that gets tagged and built. On the
`pull_request: types: [closed]` path the gap is structural: `github.sha` is the
merge-test commit and the checkout is `master`.

Note this is currently masked by a larger problem (item 62's sibling finding:
`ci.yml` has concluded `success` **0 times in 324 runs**, so `ci-gate` cannot
pass at all on the publish path). The ref hole becomes live the moment `ci.yml`
goes green.

**Fix:** resolve the SHA once inside `ci-gate`, emit it as a job output, and have
`version` check that SHA out explicitly instead of `master`.

**Why held:** it changes which commit a release is built from.

---

## 64. The bundled resource directory is a superset of its declaration — 22 undeclared skills

**Where:** `scripts/sync-system-skills.mjs:40-50`;
`tauri.conf.json:129-131` (`"resources": {"resources/skills": "skills"}`);
`src-tauri/.gitignore:24-25`.

**What is measured** on this checkout, by two independent implementations (node
`readdirSync` set-difference; `comm -13` over two sorted `ls` outputs):

| | count |
| --- | ---: |
| system skills declared (Rust `SYSTEM_SKILLS`) | 5 |
| system skills declared (JS `SYSTEM_SKILLS`) | 5 |
| directories present in `src-tauri/resources/skills` | **27** |
| **undeclared directories that would be bundled** | **22** |
| bytes declared / undeclared | 145,620 / **87,391** (37.5% of the payload) |

The 22 are the single-lens `scan-*` skills retired 2026-08-04. The sync script
does `rmSync(dst); cpSync(src, dst)` **per declared name**, so nothing removes an
entry whose name has left the list; it then logs `mirrored 5/5 system skill(s)`,
which reads as complete. The destination is gitignored (`resources/skills/*` with
`!resources/skills/.gitkeep`, 1 tracked file), so the surplus produces **no diff
and no untracked file** — the same blindness that let 29 orphan ts-rs bindings
accumulate.

**Fix:** `rmSync(dstRoot, {recursive: true, force: true})` before the copy loop,
so the destination is rebuilt from the declaration on every run. Plus the
inventory assertion specified in
[`bundling-native-assets` §9](./golden-paths/bundling-native-assets.md).

**Why held:** the first run deletes files from the operator's working tree, and
the app resolves system skills from that directory at runtime
(`skill_files.rs:265-291`) — a mid-session sweep would change what a running app
can dispatch.

---

## 65. The canvas resolves an agent's action target against a ten-day-old cache, and accepts two projects that no longer exist

**Path:** [`canvas-state-persistence`](./golden-paths/canvas-state-persistence.md) §7.1 / §7.2 ·
**Files:** `src-tauri/src/companion/canvas.rs:641-666`, `:327-345`

`resolve_scene_slug` validates a project slug against the **published snapshot**
(`mastermind.scene.v1`) rather than `dev_projects`, deliberately — `:636-637`:
*"Validating against the same snapshot she read keeps the vocabulary closed."*
That is right about hallucination and silent about staleness. Replayed against
the operator's own database (2026-08-17 purge backup **and** the live file,
identical): the snapshot was last written **2026-08-07T08:29:23.228Z**,
`freshness_note` renders **"published 248 hours ago"**, it carries **14
projects of which 2 no longer have a `dev_projects` row**
(`ai-bookkeeper`, `ai-paralegal`), and both are **ACCEPTED** by
`resolve_scene_slug` while `resolve_canvas_target` in the same module
**REFUSES** them.

**Fix:** (a) a `SCENE_STALE_AFTER_HOURS` constant, with `load_scene` returning
`None` past it so every surface falls through to the honest `no_scene_line()` it
already has; (b) a `dev_projects` existence probe in `resolve_scene_slug` before
it returns `Ok(p.slug)`, refusing with the same "name real alternatives" shape
the miss branch already uses. Structurally better: have `resolve_scene_slug`
return the same `CanvasTarget` as `resolve_canvas_target`, so the compiler
forbids a snapshot-resolved slug reaching an action door.

**Why held:** changes what Athena will answer and which `compose_canvas_panel`
calls succeed, while the operator is using her. A horizon that is too short
silently blanks the canvas digest out of the system prompt.

---

## 66. Nothing has ever deleted a canvas layout entry — 2 of 8 saved positions point at deleted projects

**Path:** [`canvas-state-persistence`](./golden-paths/canvas-state-persistence.md) §7.3 / §7.4 ·
**Files:** `src/features/teams/sub_mastermind/lib/layoutStore.ts`, `LinkLayer.tsx:26`

Measured twice, by two implementations sharing no code (one parses the JSON
document and walks its keys; one never parses it and differences UUID-shaped
tokens out of the raw `TEXT` against the id list) — they agree exactly:
**8 persisted positions, 2 dangling (25%)**. Not a consequence of the purge;
`dev_projects` was never in the cascade. `savePositions` has no per-key delete,
`saveHidden` can only remove a slug the user can still see, and nothing anywhere
reconciles the document against `dev_projects`. `LinkLayer.tsx:26` renders an
unresolvable link as `null`, which also hides the label pill that is the only way
to open its editor — replayed: 1 link with a dead endpoint → 0 rendered, 1
retained forever.

**Fix:** reconcile on hydrate, once the live entity list is available — prune
dead ids and write the pruned document back. Copy
`ascent/src/components/launch/mergeStars.ts:11-18` including its guard: an
**empty** authoritative list means the fetch failed, not that everything was
deleted, so no-op rather than prune.

**Why held:** the first run **deletes rows** from the operator's persisted layout.
If the entity list is momentarily empty or partially loaded, it deletes the board.

---

## 67. A finished background turn discards 80% of the chat history the user paged in

**Path:** [`streaming-chat-transcript`](./golden-paths/streaming-chat-transcript.md) §7.1 / §7.2 ·
**Files:** `src/features/plugins/companion/companionStore.ts:808`,
`chat/athenaChatStream.ts:158-162`, `chat/athenaChatSend.ts:103-111`,
`chat/AthenaChatProposals.tsx:40-41`

`setMessages: (messages) => set({ messages })` is a bare whole-list assignment,
and five call sites feed it `companionListRecentMessages(50, …)`. Executed
against the real reducers: open (50 rows) → four "load earlier" pages (250) →
**one finished backend turn → 50**. **200 of 250 rows discarded (80.0%)**, on a
turn the user never requested. The store already has the merge half —
`prependMessages` (`:811-818`) dedupes by id. `personas-web/src/stores/`
`eventStore.ts:91-117` fixed exactly this and its comment names the failure.

Separately, the same handler tears the streaming bubble down (`:148`, `:151`)
**before** fetching its replacement (`:158`), whose only failure arm is
`.catch(silentCatch(…))` — so a failed refetch makes the turn disappear with no
bubble, no row and no error. The user-send path is the control: it has a real
`catch` calling `setSendError`.

**Fix:** replace `setMessages` with `mergeMessages(incoming)` (dedupe by id,
preserve locally-known rows, sort, **cap** — the cap is not optional; without it
the fix converts data loss into an unbounded array) plus an explicit
`resetMessages()` for the two sites that legitimately want a clean slate. Deleting
`setMessages` from the store interface makes the clobber **not compile**.

**Why held:** changes what the transcript shows on every turn while the operator
is talking to Athena, and a merge with a wrong key duplicates or drops bubbles in
the surface she is watching.

---

## 68. Two loading states in the chat transcript, and the canvas cold-load, render literally nothing

**Path:** [`streaming-chat-transcript`](./golden-paths/streaming-chat-transcript.md) §7.3 ·
[`canvas-state-persistence`](./golden-paths/canvas-state-persistence.md) §7.5 ·
**Files:** `chat/AthenaChatBody.tsx:116-120`, `:121-126`,
`src/features/teams/sub_mastermind/MastermindPage.tsx:860`

`feedback/LoadingSpinner` returns `null` without a `label` and an `sr-only`
`<span role="status">` with one (`LoadingSpinner.tsx:12-21`). The transcript's
"an earlier page is in flight" indicator is `<LoadingSpinner size="sm" />` inside
a wrapper carrying **`aria-hidden="true"`**, so it is invisible to sighted users
*and* would suppress the `sr-only` escape hatch even if a label were added. The
Mastermind canvas's entire cold-load branch is `<LoadingSpinner label={…} />` —
a blank bordered rectangle for the whole hydrate + first-passport window, with
two i18n keys naming a state nobody can see.

**Fix:** a geometry-matched ghost under the permanent chrome per
[`page-loading`](./golden-paths/page-loading.md). Population-wide this is the
152 + 4 standalone sites [`inline-busy-state`](./golden-paths/inline-busy-state.md)
`:157` already assigns to `page-loading`'s leaf.

**Why held:** changes what a live surface shows.

---

## 69. Reload during first-run onboarding closes every door back into the flow

[`first-run-onboarding`](./golden-paths/first-run-onboarding.md) §7.A.
`onboardingStepCompleted` is persisted (`systemStore.ts:85`) while
`onboardingActive` and `onboardingStep` are not (`onboardingSlice.ts:160-161`).
A reload is not a dismiss, so `onboardingDismissedAtStep` stays `null`; the
footer replay icon needs it non-null (`DesktopFooter.tsx:466`), the Home CTA
needs `personas.length === 0` (`WelcomeGetStarted.tsx:41`), and step 4 of 5
(`adopt`) creates a persona. Complete four steps, reload, and the flow is
unreachable from all three entry points with its progress intact on disk.

**Fix:** add `onboardingActive` + `onboardingStep` to `systemStore`'s
`partialize`; widen `canResume` to
`!completed && (dismissedAtStep != null || anyStepCompleted)`.
**Why held:** changes what a live surface shows, on next launch, for the operator.

---

## 70. 14 locales, and the only code that reads the OS locale is the crash screen

[`first-run-onboarding`](./golden-paths/first-run-onboarding.md) §7.F.
`navigator.language` occurs exactly twice in 4,397 production files, both in
`main.tsx` serving `ERROR_BOUNDARY_COPY` (`:56-75`). The app-locale initializer
is `language: 'en'` (`i18nStore.ts:103`), and
`preloadPersistedLocaleBeforeMount()` returns at `main.tsx:175` when the
persisted locale is `en` — which on a first run it always is, so the 1.2 s
section-preload race never starts on the run that needs it. A first-run
non-English user gets English until they find a picker labelled in English.

**Fix:** in `readPersistedLocale()`, when `personas-i18n-storage` is absent,
narrow `navigator.language` through the existing `isLocaleCode` and return it.
**Why held:** changes the language every existing user's app opens in.

---

## 71. The app does not record which tour you were in

[`guided-tour-step`](./golden-paths/guided-tour-step.md) §7.A.
`PersistedTourState` (`tourSlice.ts:1143-1153`) has a per-tour map and no
active-tour pointer; hydration hardcodes `getting-started` (`:1318`, `:1379`).
Replayed against a synthetic blob: a user at step 6 of the 9-step
`teams-orchestration` tour, after a reload, lands on `getting-started` step 0
with zero progress carried, while the Teams record sits unread in
`guided-tour-state`. `TourLauncher` cannot recover it either (`:25` only ever
launches `getting-started`/`-simple`).

**Fix:** add `activeTourId` to `PersistedTourState`, bump `TOUR_STATE_VERSION`
4 → 5. **Why held:** the version bump discards every user's existing tour
progress, and the pointer changes what the footer launcher opens.

---

## 72. The tour-anchor generator is blind to three authoring forms, and running it today narrows the allow-list

[`guided-tour-step`](./golden-paths/guided-tour-step.md) §7.B.
`gen-tour-anchors.mjs`'s six regexes require an anchor in attribute position, so
they cannot see a `const` map value (`ObsidianBrainPage.tsx:33-38`), a ternary
arm (`DailyGoalsModal.tsx:140`), or an aliased prop
(`StudioChatInput.tsx:172` — `inputTestId`, whose capital `T` defeats the
`testId="…"` regex). Measured: the manifest is **127 behind** (101 testids + 26
prefixes, reproducing `client-rule-mirroring` §7 D5 exactly) **and 4 ahead** —
`daily-goals-create`, `studio-chat-input`, `companion-strip-`, `mm-category-`
are committed and no longer derivable. Live cost: the whole Obsidian Brain
tour's six panel anchors are absent from the manifest, so
`dynamicTours.ts:144` refuses any Athena-composed tour that names one.

**Fix:** teach the generator the three forms, add `--check`, regenerate both
artifacts. **Why held:** regenerating changes what Athena is permitted to
compose, in both directions, and the removal half is a silent narrowing —
it wants a human reading the diff.

---

## 73. Nothing verifies that a commit landed, and `git commit --only` is prescribed 9 times after being measured unsound

[`parallel-session-coordination`](./golden-paths/parallel-session-coordination.md) §0, §7 D1, §9.

Executed in a throwaway `git init` repo with **no hooks and no concurrency**: `git commit -- <p>`
and `git commit --only <p>` both commit the **working tree**, not the index (Q1/Q2), so a
sibling's *unstaged* edits to a file in your pathspec ride in under your message. They do scope
the file *set* correctly (Q3) — which is what makes them convincing. An isolated
`GIT_INDEX_FILE` scopes the set, takes the staged content, and survives a sibling `git add`
landing mid-flight (Q4/Q5). `git diff --cached --stat` before `git commit` is a TOCTOU check:
the guard read 1 file and the commit shipped 2 (Q6).

Three things are owed and none is applied:

1. **`.claude/CLAUDE.md:277`** attributes the pathspec failure to *"lefthook's partial-commit
   handling"* and concludes *"there is no reliable pathspec-scoping incantation"*. The mechanism
   is plain git and the conclusion is too strong — the correct statement is that no *pathspec*
   form is reliable and `GIT_INDEX_FILE` is. **Why held:** CLAUDE.md is loaded into every session
   in this repo; rewriting it mid-campaign changes what running composers believe.
2. **Nine prescriptions of the defeated form** across `perfect/SKILL.md:206,226,335,398`,
   `code-review:29`, `guide-sync:47`, `prototype:55`, `sentry:59`, `mvp/state/calibration.md:11`
   — four of which claim `--only` *"bypasses the shared index entirely"* and one of which calls
   it *"safe by construction"*. Ratcheted by the `defeated-pathspec-commit` census rule at
   **6 files / 11 matches** so the count cannot rise while the text is corrected.
3. **A `post-commit` readback**, specified in §9 (three lines comparing `git log -1 --format=%s`
   against the subject the caller passed). `lefthook.yml` has no `post-commit` hook and **zero of
   53 skill documents** instruct a readback, against 26 `git commit` instructions. **Why held:**
   installing a hook changes what happens every time the operator types `git commit`. Note also
   that a `post-commit` hook's exit code is ignored by git, so this is a loud **detector**, never
   a gate.

The working answer is already in the repo — `.claude/mvp/calibration.md:54` — where
it has held for four consecutive runs across eight concurrent builders in five repositories. It
never travelled because a per-run calibration log is not where anyone looks for a project rule.

---

## 74. `npm run test` reports a pass rate over a denominator that can shrink silently — 11 files, 153 tests

[`frontend-test-lane`](./golden-paths/frontend-test-lane.md) §0, §7 D0, §9.

Executed: the default lane's `include` claims **402** files; the JSON run report accounts for
**391**; the eleven in the gap carry **153 `it`/`test` calls** and the run's entire stdout for
533 seconds was two jsdom canvas warnings. Re-run directly, four of them together produce
`[vitest-pool]: Failed to start forks worker` after 60 s (`Test Files no tests`, exit 1); one run
alone passes 11/11 in 67.69 s, of which **environment 24.17 s + import 26.79 s + setup 12.55 s =
94%** and tests are 3.23 s. Same fixed per-file cost puts eight files' *first* `it()` at
3.32–3.37 s against the framework's 5,000 ms default — the lane holding 3,738 tests is the only
one of five that sets no `testTimeout`, while the 7-test and 6-test lanes each set 30,000 ms.

Related and separate: `vitest.integration.config.ts` **cannot load its own config** —
`src/test/integration/` does not exist, so `npm run test:integration:cli` exits 1 without running
anything; it is on no hook and in no workflow. And of five lanes, only `test:evals` (six files)
is on a git hook at all; the 3,738-test lane runs in CI only.

**Fix:** (a) a claimed-vs-executed reconciliation in CI beside `npm run test` — four lines, and
it converts a shrinking denominator into a named list; (b) `scripts/check-test-lanes.mjs` on
pre-push (loads every `vitest*.config.ts`, asserts non-empty and pairwise-disjoint includes and
an explicit `testTimeout`, with an exit-2 guard if it finds fewer than 3 configs); (c) hoist the
module import into `beforeAll` so transform is charged to `hookTimeout`, *then* set an explicit
`testTimeout`. **Why held:** (a) and (b) add gates to CI and pre-push, and (c) changes the
suite's timing characteristics under the operator's own hooks. Raising `testTimeout` alone would
delete the only visible symptom and is explicitly not the fix.

---

## 75. Three of the five buckets under `src/features/shared/` are governed and documented by nothing

[`shared-component-boundary`](./golden-paths/shared-component-boundary.md) §0, §7 D2/D3/D4, §9.

`.claude/CLAUDE.md:141-159` offers three destinations for a new component — the catalog,
`shared/chrome/`, or the owning feature. The tree has **five** buckets. `shared/glyph/` is **50
files with 9 restricted-shape imports across 8 of them** (`@/stores/themeStore`,
`@/features/agents/…`, `@/features/templates/…`, `@/features/vault/…`), and it is in no
documentation, no catalog, and outside `eslint.config.js:172`'s `files:` glob; `shared/dispatch/`
and `shared/charts/` are in the same position. **If the boundary rule's glob covered
`src/features/shared/**` minus `chrome/`, its anchor would be 22 sites, not 13.**

Three smaller items in the same territory:

- **`.claude/CLAUDE.md:146` says "~115 primitives"; the generated `CATALOG.md` says 128.** A
  generated count and a hand-maintained count of the same set, with no gate.
- **8 of 128 catalog rows carry a fragment of the component's own source as its description** —
  `useShakeError | the .`, `useAsyncFieldValidation | link .`,
  `EstimatedProgressBar | if (progress < 75) return 'hsl(var(primary) / 0.`. Fixed per row by a
  `@catalog` JSDoc tag plus `npm run gen:catalog`.
- **The rule's `@/stores/*` + `@/stores/**` globs cannot match the bare barrel `@/stores`.**
  Measured: zero barrel imports in the catalog today, so this is a latent hole with a two-line
  fix — but the barrel form is dominant elsewhere (10 of 10 plugin shells), so the first one
  written in a primitive would be invisible to ESLint. The published census rule already catches
  it, at an unchanged baseline.

**Why held:** all four are edits to `.claude/CLAUDE.md`, `eslint.config.js` or eight source
files, in a checkout five concurrent composers have loaded; the CLAUDE.md and lint-config edits
in particular change what every running session and the operator's editor believe.

---

## 76. `verify_document` verifies against the key printed inside the file it is checking

**From:** [`document-signing`](./golden-paths/document-signing.md) §0, §7.A, §7.B.

`src/commands/signing/mod.rs:196-198` calls
`identity::verify_signature(&sidecar.signer.public_key, &file_bytes, &sidecar.signature)`.
Both arguments come from `input.sidecar_json`, pasted into a textarea
(`DriveVerifyDialog.tsx:132-139`). There is no call to
`peer_id_from_public_key_b64` (which `identity.rs:81-86` documents as **MUST**
for untrusted pairs) and no `get_trusted_peer` lookup. A forged sidecar made with
a fresh keypair returns `valid: true`, and `DriveVerifyDialog.tsx:213-217` renders
the sidecar's own `display_name` next to a green "Valid signature".

Measured: **5 verification call sites; this is the only one that neither binds
id↔key nor consults the trust store.** `bundle.rs:571-599` ignores the embedded
key entirely and verifies against the stored one; `enclave.rs:222-244` binds and
then checks `trusted_peers`; `p2p/protocol.rs:277-303` binds and hard-rejects.
`enclave.rs:222-228`'s comment enumerates three siblings that do this check — and
does not mention this one.

**Fix:** (a) bind `peer_id_from_public_key_b64(sidecar.signer.public_key)` against
`sidecar.signer.peer_id`; (b) look the id up in `trusted_peers`, honour
`is_revoked()`, verify against the **stored** key; (c) add a `signer_trusted`
field to `VerifyDocumentResult` — the sibling verifiers both return two booleans
and this one returns one, so the UI has no vocabulary for "valid but unknown".

**Why held:** changes what a security surface reports. Fixing (a)+(b) without (c)
turns today's false green into a permanent red, because `trusted_peers` holds
**0 rows** and there is no adoption path from a sidecar (§8.3) — so this must land
as one coherent change, with the UI state and an adopt-this-key step, not as a
one-line patch.

---

## 77. Two sensitive-path denylists miss the Windows location they name, and guard the wrong door

**From:** [`document-signing`](./golden-paths/document-signing.md) §7.D, §7.E, §7.F.

Two findings against `path_safety.rs:45-75` / `src/api/signing/index.ts:63-80`:

1. **Both miss `%APPDATA%\gcloud\application_default_credentials.json`** — the
   real Windows location of the credentials the list names. Only the POSIX
   `~/.config/gcloud/` spelling is enumerated, in a codebase whose build
   documentation is Windows-first.
2. **`is_sensitive_credential_path` is applied to `sign_document` and not to
   `read_sidecar_file` / `write_sidecar_file`** (`mod.rs:301`, `:313`) — and
   `sign_document` returns only a hash and a signature, while `read_sidecar_file`
   returns the file's contents. The denylist guards the door that leaks least.

Both read/write doors *are* meaningfully constrained — `.json` only, and
`resolve_and_guard` canonicalises then blocks system prefixes, the app-data
directory (so `master.key` and `personas.db` are out of reach) and anything
outside `$HOME`. The residue is arbitrary `.json` read/write under the user's home,
including `~/.claude/settings.json`.

Also measured, and **not** a defect to fix: a 22-fixture differential test of the
two mirrored lists found **7 disagreements, all of them Rust-broader**. There is
no fixture TS blocks and Rust allows. The drift is safe today — by luck, since
nothing tests the parity claim at `path_safety.rs:39-40`.

**Why held:** a security control whose current scope may be deliberate; widening
a denylist can refuse files the operator legitimately signs.

---

## 78. The nine signing commands do not exist in the default dev build, and the UI does not know

**From:** [`document-signing`](./golden-paths/document-signing.md) §7.H.

`commands/mod.rs:18` and nine `#[cfg(feature = "p2p")]` attributes at
`lib.rs:2708-2726` gate the whole signing surface behind `p2p`, which is in
`desktop-full` only (`Cargo.toml:61-62`). `tauri:build:lite` / `tauri:dev:lite`
build `desktop` — and `.claude/CLAUDE.md` says *"Default to `tauri:dev:lite` for
daily work."*

The frontend has **no capability guard**: `useSigning` and all three dialogs in
`src/features/plugins/drive/signing/` render unconditionally, so in a lite build
the buttons are present and every `invoke` fails with an unknown-command error.
Shipped installers use `tauri.conf.json` → `desktop-full`, so production is
unaffected.

**Fix:** surface the compiled feature set to the renderer and gate the signing
entry points on it, the way other optional surfaces are gated.

**Why held:** changes what a live surface shows.

---

## 79. The billing-account control is a 3-name denylist over a ≥17-name namespace

**From:** [`billing-account-auth`](./golden-paths/billing-account-auth.md) §0, §7.A, §7.B.

`CLI_SUBSCRIPTION_RESERVED_ENV` (`engine/src/cli_process.rs:36-40`) holds
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`. The documented
credential-resolution order for the Claude CLI continues past those three:
`ANTHROPIC_PROFILE` (selects a different org/workspace, and outranks the layer
below it), the five Workload-Identity-Federation variables, and
`ANTHROPIC_CONFIG_DIR` (which chooses *which profile store on disk* is read) —
plus the Bedrock/Vertex switches, which move billing to another vendor entirely.

**Measured: 14 such names, 0 occurrences across every `.rs`, `.ts`, `.tsx`,
`.mjs`, `.json`, `.toml` and `.md` file in the repository.** Any of them present
in the environment the app inherited at launch reaches every spawned child
untouched. The three that *are* listed are the three that produce a visible
symptom ("Credit balance is too low"); the ones that silently bill a different
valid account produce none.

Second half: the vault-injection guard at `engine/runner/credentials.rs:904`
checks the composed env **name** against the same list, but a vault credential's
field key is operator-chosen free-form text. The repo's own test pins this —
`credentials.rs:1187-1188`, *"A sibling non-reserved field still injects — the
guard is selective."*

**Fix:** derive the list from the vendor's documented resolution order with a
dated provenance comment (§8.5), and convert the injection guard from a denylist
to an allowlist of names a credential may bind to.

**Why held:** changes what the app strips from the operator's own environment,
and could break a deliberate local setup. This is explicitly the runbook's
"security control whose current setting may be deliberate".

---

## 80. Six spawn sites bill an unpinned account, three behind a loop that looks like the guard

**From:** [`billing-account-auth`](./golden-paths/billing-account-auth.md) §0.1, §0.2, §7.C.

Hand-verified, each opened: `artist/mod.rs:676`, `standards_scan.rs:225`,
`revitalize.rs:249`, `project_tracking/consolidator.rs:354`, `ocr/mod.rs:579`,
`ocr/mod.rs:596` spawn the Claude CLI without `force_subscription_auth` or a
`CLI_SUBSCRIPTION_RESERVED_ENV` loop.

**Three of them run `for key in &cli_args.env_removals { cmd.env_remove(key); }`**
— which strips `CLAUDECODE`, `CLAUDE_CODE` and three `DISABLE_PROMPT_CACHING*`
names (`cli_args.rs:184-199`) and **no auth variable at all.** A reviewer looking
for "does this strip the environment" finds a strip loop.

Separately, `src/companion/athena_reaction.rs` calls `force_subscription_auth` at
`:567` and applies `env_overrides` at `:579-580` — inverting the contract stated
at `cli_process.rs:44` (*"Call AFTER applying any env overrides so nothing can
re-introduce them"*). **Latent, not live**: no `ANTHROPIC_*` override is emitted
today, so nothing is currently re-introduced. The next override added makes it
live silently. Two independent implementations found this site and only this site.

**Fix:** route all six through `spawn_headless_claude` — whose own comment
(`cli_process.rs:305-310`) already claims it *"closes that gap for every caller,
with no opt-out"* — and move the strip inside the constructor so ordering cannot
be got wrong (see that path's §9.1).

**Why held:** touches the money path on six live code paths at once.

---

## 81. Token counts are zero in 2,188 of 2,188 executions — and this corrects item 24

**From:** [`billing-account-auth`](./golden-paths/billing-account-auth.md) §7.D, §12.1.

Measured against `purge-backup-2026-08-17/personas.db`:

| column | rows > 0 | of |
|---|---:|---:|
| `cost_usd` | **1,970** | 2,188 |
| `cache_read_tokens` | **585** | 2,188 |
| `input_tokens` | **0** | 2,188 |
| `output_tokens` | **0** | 2,188 |

`SUM(cost_usd)` = **$2,036.2571**.

**This overturns item 24's headline.** That entry records *"every run records
$0"* and cites "$2,036.26 of actual spend" as the figure the ledger failed to
capture. The $2,036.26 **is the sum of the ledger column itself** — cost is
recorded, in 1,970 of 2,188 rows. The broken half is tokens.

The cause is six lines of `engine/src/parser.rs`: `total_cost_usd` (`:339`),
`total_input_tokens` (`:340`) and `total_output_tokens` (`:341`) are read
top-level with no `usage` fallback, while the cache-token reads immediately below
(`:346-370`) consult `usage` first — and those are the ones with data. **Within a
single struct literal, the fields that consult `usage` are populated and the
fields that do not are zero.**

Confirmed by a second parser of the same event:
`db/src/repos/llm_spend.rs:100-101` reads `usage.input_tokens` and its table has
**85 of 89 rows populated**.

**Fix:** give `:340-341` the same `usage`-first fallback the cache fields already
have.

**Why held:** one line per field and non-destructive, but it changes what a live
cost surface displays while the operator is watching it. Also note the
consequence while it is unfixed: any spend ceiling denominated in **tokens**
compares against zero on every row and can never fire (cost-denominated ceilings
are unaffected).

---

## 82. `custom/enforce-base-modal` is warn-level, scores 0/8 precision and 0/19 recall, and `CLAUDE.md` calls it "enforced"

**From:** [`modal-stacking`](./golden-paths/modal-stacking.md) §0, §7 D1/D3/D6, §12.1.

Four separate defects, none applied:

- **Severity.** `eslint.config.js:95` sets the rule to `"warn"`, so per doctrine §3 it enforces
  nothing at either gate. `.claude/CLAUDE.md`'s reuse table describes it as *"(enforced by
  `custom/enforce-base-modal`)"* on the row for `fixed inset-0` modal backdrop. **Held because I
  am not permitted to edit `CLAUDE.md`; recorded here so the next session with that authority can
  correct the word and the claim together.**
- **The signal is anti-correlated with the defect.** The rule anchors on `role="dialog"`
  (`eslint-rules/enforce-base-modal.cjs:63-73`). Executed over its entire anchor population (the
  16 files containing that attribute): **8 reports, and all 8 opened by hand are anchored popovers
  or an inline notice** — `FindingBadge.tsx:210`, `WarningBadge.tsx:107`, `DataLinksPopover.tsx:80`,
  `DeployPopover.tsx:55`, `ImprovePopover.tsx:91`, `StandardsScan.tsx:111`,
  `passportWidgets.tsx:187`, `DemoNotice.tsx:23`. Converting any of them to `BaseModal` would be a
  regression. Meanwhile the **19 files that do hand-paint a full-viewport modal backdrop carry zero
  `role="dialog"`**, so recall is 0. Replacing the signal changes what every running editor reports.
- **Satisfied by an import, not by use.** `importsBaseModal` accepts any import source *containing*
  the substring `BaseModal`, and accepts `source === '@/features/shared'` — a barrel import of
  anything (`:40-48`). A file can import `BaseModal`, never render it, hand-roll a dialog, and pass.
- **`BaseModal`'s `containerClassName` silently discards the depth-derived z-index.**
  `style={containerClassName ? undefined : { zIndex: overlayZIndex }}` (`lib/ui/BaseModal.tsx:278`).
  All 8 call sites noticed and wrote a z-index by hand; the values do not compose — `z-40` is
  *below* `Z_INDEX_BASE` (50), `TemplateDetailModal.tsx:145` passes `absolute` rather than `fixed`,
  and `FirstUseConsentModal.tsx:158` / `ResourcePicker.tsx:187` both pass `z-[9999]`.

**Fix:** (a) merge the computed `zIndex` into `style` unconditionally instead of replacing it;
(b) replace the rule's signal with the published census signal (`fixed inset-0` + dimming paint in
the same class string) or retire the rule in favour of the census rule alone; (c) correct the
`CLAUDE.md` row. Related and larger: `portal: boolean` should become a closed `layer` union so
`Z_INDEX_BASE` (50) and `Z_INDEX_PORTAL_BASE` (10000) stop being reachable only as a pair — three
overlays (`TestReportModal.tsx:68`, `ComposerPickerShell.tsx:89`, `ucPreviewModal.tsx:21`) exist
solely to escape that gap and each names the constant in a comment.

**Why held:** (a) changes what 8 live modals paint; (b) changes what every running session's editor
reports; (c) is a `CLAUDE.md` edit this session is not authorised to make.

---

## 83. Five doors send OS notifications, 52 of 57 sites are hardcoded English, and the coverage gate counts its own source

**From:** [`desktop-notification`](./golden-paths/desktop-notification.md) §0, §7 D2/D4/D6/D10, §8 G2/G3.

- **`lib/harness/verifier.ts:74-83`** — `notificationCoverageGate()` is
  `grep -rn "notifyProcessComplete" src/ … | wc -l`, `required: false`. The pipe replaces grep's
  exit code, and the pattern counts **prose**: of 13 current matches, 8 are feature-list strings in
  `lib/harness/scenario-parser.ts:359-415`, one is the gate's own `command` string, one is the
  helper's `export function` line, one is an import — **1 real call site out of 13**. Because two
  counted mentions live in the gate's own file, the number **cannot reach zero** even if every
  caller is deleted.
- **`lib/utils/platform/osNotification.ts`** — a fifth notification door using the raw Web
  `Notification` API, bypassing the Tauri capability allowlist (`capabilities/default.json:13-16`
  covers only the plugin). Three silent `return`s (`:18`, `:21`, `:23`), zero error doors, and
  **all 6 call sites `void` the promise**. Two of the six are the user-facing half of credential
  remediation (`remediationExecutor.ts:54`, `:70`). Its `requestNotificationPermission()` export
  (`:9-14`) has **zero callers**.
- **`send_app_notification` cannot report failure.** `notifications.rs:1161-1163` returns `()`,
  `send` logs `tracing::warn!` and drops (`:1543-1547`), and the wrapper is `invoke<void>`
  (`api/system/system.ts:113`). A denied notification and a delivered one are the same value at
  every layer, so no caller can fall back.
- **`usePipelineNotifications.ts:86-99`** requests OS permission on mount, before any pipeline has
  finished, and caches the result in a ref that is never re-read — a later grant is invisible until
  remount.
- **31 Rust send sites cannot be localized where they are.** `src-tauri/src/notifications.rs` has
  zero matches for `locale`/`i18n`/`translat`; 24 of 31 titles are bare English literals and the
  other 7 are `format!` templates with English skeletons.

**Fix:** (a) delete `requestNotificationPermission()` (zero consumers) and route the six
`sendOsNotification` callers to `notifyProcessComplete`, which writes the in-app record
*outside* its `try` and therefore needs no failure signal; (b) widen `send_app_notification` to
`Result<(), AppError>`; (c) replace the harness gate with the published census rule; (d) the
structural item — emit a key + params from Rust and resolve in the frontend listener, so the 31
backend notifications become localizable at all.

**Why held:** (a) and (b) change behaviour and a public IPC signature across 22 call sites;
(d) is an architecture change; (c) touches a harness file other sessions read. The only change
this campaign's rules would authorise — deleting the zero-consumer
`requestNotificationPermission()` — is held because it shares a file with six live call sites in a
checkout five composers have loaded.

---

## 84. Three persona version-history mechanisms; the declared-canonical one is dead, the best one has no foreign key and is not in the orphan sweep

Found by [`definition-version-history`](./golden-paths/definition-version-history.md).
All counts from `purge-backup-2026-08-17/personas.db` unless stated.

**(a) `persona_versions` is a fully built, structurally unreachable subsystem.**
`incremental.rs:1963` created it under *"replaces prompt-only versioning"*, with a
child table, a one-shot `INSERT OR IGNORE` backfill guarded by
`if !has_persona_versions`, a 110-line repo module (`db/src/repos/lab/versions.rs`,
3 `pub fn`), a core model (`core/src/models/lab.rs:644`), a ts-rs binding exported
at `src/lib/bindings/index.ts:640`, and an entry in the boot orphan scrub
(`db/src/lib.rs:460`). **Zero call sites, zero binding importers, zero rows in
both databases.** Meanwhile all five production writers still write
`persona_prompt_versions`, which gained five columns *after* the replacement
shipped. Because the backfill is one-shot, the two tables can never converge.

*The fix:* delete `db/src/repos/lab/versions.rs`, the `pub mod versions;` at
`db/src/repos/lab/mod.rs:11`, `PersonaVersion` and its binding, and the
`"persona_versions"` entry in `ORPHAN_TABLES`. Leave both tables — they are empty
and dropping a table is destructive.
*Why held:* removing a `#[derive(TS)] #[ts(export)]` model changes what
`export_bindings` emits, and cargo is unavailable in the campaign's session. This
is a zero-consumer deletion in spirit but not one the session can verify.

**(b) `persona_change_log.persona_id` has no foreign key and is absent from the
boot orphan sweep.** `incremental.rs:1215` declares it `TEXT NOT NULL` with no
`REFERENCES`; `cleanup_orphan_rows`' `ORPHAN_TABLES` (`db/src/lib.rs:437-448`)
lists twelve tables and does not include it — while it *does* include
`persona_versions`, which has never held a row. The purge on 2026-08-17 produced
no orphans only because `persona_change_log` was empty: its writer landed
2026-07-27 and the newest `personas.updated_at` anywhere is 2026-07-14, so **no
persona has been updated since the writer existed.**
*The fix:* decide the policy (cascade like `persona_prompt_versions`, or survive
and get swept) and implement one of them.
*Why held:* adding the FK is a table rebuild; adding the table to `ORPHAN_TABLES`
is a boot-time `DELETE` — both are destructive first runs.

**(c) `personas::update` writes the version row on its own connection, before the
validation that can reject the edit.** `db/src/repos/core/personas.rs:935` calls
`create_prompt_version_if_changed(pool, …)` — its own connection, its own
`BEGIN IMMEDIATE`/`COMMIT` (`metrics.rs:99,122`) — and eight `validate_*` calls,
two encryption calls and a lifecycle parse sit between it and the `UPDATE` at
`:1178`. Any of them returning `Err` leaves a committed version of a value the
persona never took. The same function does it correctly 250 lines later
(`write_diff(&tx, …)`, `:1186`).
*Why held:* moving the write into the transaction changes when history is written
for every persona edit.

**(d) The only diff-gated door reads one of the two payload columns.**
`create_prompt_version_if_changed` compares `structured_prompt` only, and its
caller gates the whole call on `if let Some(ref new_sp) = input.structured_prompt`
(`personas.rs:929`). Since the client sends the diff, a system-prompt-only edit
never reaches the writer. Evidence: **16 of 25 rows have `system_prompt IS NULL`**,
0 have `structured_prompt IS NULL`, and one writer (`lab.rs:632`) inserts the
literal `NULL` into that column.
*Why held:* widening the gate changes how many version rows a save produces.

**(e) Twelve tables declare a per-parent sequence column with no constraint.**
Ratcheted by the census rule `unconstrained-sequence-column` (12 matches / 4
files, hand-verified 10/12) rather than fixed — adding `UNIQUE(persona_id,
version_number)` to `persona_prompt_versions` is a table rebuild.

---

## 85. The trigger "Test fire" button takes a different, shorter, more privileged path than a real fire — and `trigger_id` is NULL in 2,188 of 2,188 executions

Found by [`manual-test-fire`](./golden-paths/manual-test-fire.md).

**(a) The two paths diverge.** A real fire publishes an event
(`engine/background.rs:2906`, `source_type: "trigger"`, `source_id:
Some(trigger.id)`) which the event bus turns into a run. The Test-fire button
(`TriggerDetailDrawer.tsx:84` → `useTriggerOperations.ts:131`) calls
`executePersona(pid, triggerId)` directly. The manual path therefore skips
`mark_triggered`, the `unattended_mode == "approval"` hold
(`background.rs:2878-2903`), the `unattended_mode == "dry_run"` →
`is_simulation` conversion (`background.rs:1552-1570`), the trigger rate-limit
key, the active-hours window, `synthesize_trigger_fired_payload`, and the event
fan-out. **Pressing "Test fire" on an approval-mode trigger runs it**, where the
schedule would have held it for a human.

**(b) The event bus discards the trigger id it is holding.** At
`background.rs:1561` and `:1572` both `exec_repo::create*` calls pass
`trigger_id: None` — three lines after `event.source_id` was read and resolved to
a trigger to decide `dry_run`. `persona_executions.trigger_id` is declared
`REFERENCES persona_triggers(id) ON DELETE SET NULL` and is **NULL in 2,188 of
2,188 rows** across an install that held 351 triggers. `listExecutionsByTrigger`
— the trigger drawer's own Activity panel — reads exactly that column.

**(c) `is_simulation` is set by no test control a user presses.**
`execute_persona` passes `false` (`executions.rs:169`); five callers pass `true`
and none is a saved-automation test button. **0 of 2,188 rows carry the flag**, so
the three `COALESCE(is_simulation, 0) = 0` metric exclusions, the
`ExecutionList.tsx:133,137` filter and the `ExecutionListRow.tsx:77` badge have
never had an input.

*Why held:* every one of (a)–(c) changes what a live surface shows or what a live
control does while the operator is using it.

**(d) The idempotency key on the repo's most-used spawn door is per-attempt.**
`src/api/agents/executions.ts:68` — `idempotencyKey ?? crypto.randomUUID()` — with
a comment asserting it provides "self-dedup against a concurrent duplicate
(double-click, double-fire, React re-invoke)". A fresh UUID cannot collide, so
both the client in-flight map (`tauriInvoke.ts:336`) and the server's
`get_by_idempotency_key` pre-check are inert. Of 20 call sites, one passes an
explicit key and it passes a UUID too (`chatSlice.ts:244`). This inverts
[`idempotent-invocation`](./golden-paths/idempotent-invocation.md) §2 at the
single door that most needs it.
*Why held:* deriving a real key changes dedup behaviour on the live run path —
including, deliberately, refusing a second run the operator may currently expect
to get.

**(e) `test_automation_webhook` skips the `is_runnable()` gate its production twin
applies.** `automations.rs:164` checks it before `invoke_automation`; `:214`
calls the same function without it, and fires a real outbound webhook.

---

## 86. `feedback/LoadingSpinner` renders `null` and is used as a control's busy state at 68 sites in 50 files

Found by [`manual-test-fire`](./golden-paths/manual-test-fire.md) §9 while
gating its own headline control.

`{flag ? <LoadingSpinner .../> : <Icon .../>}` makes the icon vanish and puts
nothing in its place — the shim emits only an `sr-only` `role="status"`, and only
when passed a `label`, which none of these 68 sites does. Measured over `src/`
(4,801 files): **68 violating sites in 50 files**, against **66 compliant
`Button`/`AsyncButton` `loading` props in 52 files** — the repo is at roughly
50/50 on one concern. The broader anchor is **247 `<LoadingSpinner` renders across
178 files**. Two independent implementations disagreed in both directions (68 vs
65; 4 multi-line-formatted sites invisible to a line matcher, 1 fragment-wrapped
site invisible to the JSX matcher), so the true population is **at least 69**.

The structural fix is Q5 — **delete the shim**, which makes the bad state
unspellable. *Why held:* 178 files across every feature area, in a checkout
several composers have loaded, and the sites that pass a `label` do provide a
screen-reader announcement that a naive deletion would remove. Ratcheted by the
census rule `null-spinner-busy-state` until the retirement lands.

`CATALOG.md`'s `LoadingSpinner` row still describes it as *"Canonical loading
spinner… Use for any full-element loading state"*, and that text is hardcoded in
the `CURATED` map at `scripts/docs/gen-shared-catalog.mjs:56`, so regenerating the
catalog will not fix it — as `CLAUDE.md` already notes.

---

## 90. `AppError::RateLimited` cannot carry the retry-after it is handed, so 8 of 12 sites format it into English

From [`rate-limiting`](./golden-paths/rate-limiting.md) §7.E / §9.2.
`RateLimiter::check` returns `Err(retry_after_secs)` — a correct sliding-window
figure computed from the oldest in-window timestamp. Of its **7** call sites,
**one** (`management_api.rs:544-549`) puts that number where a machine can read
it (`header::RETRY_AFTER`); five interpolate it into a sentence and one
(`smee_relay.rs:526`) calls `.is_err()` and drops both the number and the event.
`AppError::RateLimited(String)` is the reason: the only field available is prose,
so **8 of 12 construction sites reach for `format!`, and 0 of 12 carry a
structured retry-after**. The single frontend consumer,
`src/lib/utils/apiError.ts:112`, therefore hardcodes `5000` ms.

**The fix (not applied — a 12-site type change across the IPC boundary):** make it
a struct variant, `RateLimited { message: String, retry_after_secs: Option<u64> }`.
`RateLimited("…".into())` then stops compiling at all 12 sites and each author
must answer the question while holding the number. `core/src/error.rs:160-215`
gains one `serialize_field`; `apiError.ts:112` becomes
`err.retry_after_secs ?? 5000`. Held against the doctrine's seven qualifications
in that path's §9.2 — Q2 is why the field must stay `Option` (the six
mutual-exclusion sites have no meaningful retry-after) and Q5 is why the fix is
withholding the free-text constructor rather than adding a field beside it.

**Companion, same edit window:** a third variant. Today `RateLimited` names three
different refusals — **5 frequency, 1 capacity, 6 mutual exclusion** — a direct
arithmetic consequence of commit `17d059b1f`, which correctly applied
[`admission-control`](./golden-paths/admission-control.md) §7.A's prescription.
The prescription was right; its price is that `ErrorCategory::RateLimit` now
covers two disjoint populations and `healing.rs:303-324` tells an operator to
*"reduce execution frequency or upgrade your plan"* when they clicked a button
twice. `InflightGuard` already exists as the primitive; only the error kind is
missing.

## 91. The trigger rate-limit form writes a policy no code on either side reads

From [`rate-limiting`](./golden-paths/rate-limiting.md) §7.A / §7.B.
`RateLimitControls.tsx` is a shipped, user-reachable form (TriggerListItem →
`TriggerDetailDrawer.tsx:45`) persisting
`{ max_per_window, window_seconds, max_concurrent, cooldown_seconds }` into a
trigger's `config`. **Rust readers: zero** — `"rate_limit"` as a config key
appears in none of 963 `.rs` files, and `core/src/models/trigger.rs`, the sole
parser of trigger config, contains no `rate` / `throttl` / `cooldown` /
`concurren` identifier at all. **TypeScript enforcer: zero callers** —
`recordTriggerFiring` (`triggerSlice.ts:198`) and `recordTriggerComplete`
(`:257`) are never invoked in 4,829 files.

Consequence: `triggerRateLimits` is permanently `{}`, so the **`rate-limits` tab**
(`TriggersPage.tsx:151` → `RateLimitDashboard.tsx`) renders three counters —
running, queued, throttled — that are structurally zero, and a throttle bar
that is structurally 0 %. The one non-zero number counts triggers whose *config*
carries a limit. **The surface reports configuration and calls it throttling.**

**Not applied**: wiring the server side changes what a live surface does *and*
requires answering a question this leaf deliberately does not own — whether a
throttled scheduled fire is **dropped or deferred**, which is
`admission-control`'s. Deleting the dead client-side limiter is the cheap half
and is also deferred, because `RateLimitDashboard` would then need an honest
empty state rather than a silent zero.

## 92. 135 connectors, one rate limit: `rate_limit_rpm` is read and never written

From [`rate-limiting`](./golden-paths/rate-limiting.md) §7.D.
`api_proxy.rs:251` parses `rate_limit_rpm` out of connector metadata and falls
back to `DEFAULT_RATE_LIMIT = 60`. **The string `rate_limit_rpm` occurs exactly
twice in the tree — lines 250 and 254 of `api_proxy.rs`, i.e. the reader and its
docstring.** Zero of the 135 `BuiltinConnector` seed rows declare it, so every
credential in the app shares one 60 req/min bucket.

Nine of those seeds state a real limit in the `llm_usage_hint` prose shipped to
the model. The two that matter: **arXiv** documents *"max 1 request per 3 seconds.
arXiv will block IPs that exceed this"* (20/min) and **Semantic Scholar**
documents 100 req/5 min without a key (20/min). The default is **3× more
permissive than a documented policy whose stated penalty is an IP block.**

**Not applied**: a seed change alters what the running app enforces against live
third parties. The fix is nine `"rate_limit_rpm": N` entries, and the check that
keeps it true is specified in that path's §9.3 — a script over
`builtin_connectors.rs` that flags a connector documenting a rate without
declaring one, **with an exit-2 floor at 120 parsed metadata blobs**, because the
JSON parse already reaches 134 of 135 rows and a delimiter change would silently
drop more.

## 93. A 429 from the TTS sidecar is reported as the user's mistake

From [`rate-limiting`](./golden-paths/rate-limiting.md) §7.H. One line.
`src/companion/tts/pocket.rs:473-478` recognises HTTP 429 from the local Pocket
TTS service and returns
`AppError::Validation("Pocket TTS service is at capacity (queue full) — try again in a moment")`.
`Validation` → `ErrorCategory::Validation` → severity **Low**
(`error_taxonomy.rs:399`), `is_failover_eligible` **false**, `retryable` **false**
(`tool_outcome.rs:113`). The minted message contains none of `rate limit` /
`too many requests` / `quota exceeded` / `usage limit` / `429`, so the string
ladder at `error_taxonomy.rs:151-158` cannot recover the classification either.
The module's own header (`pocket.rs:21`) says the service *"replies 429 under
overload, so no client-side semaphore is needed"* — the design is deliberate and
the type contradicts it. Same class as item 90's companion and as
`admission-control` §7.A. **Not applied** because it changes a retry decision at
runtime; it is otherwise a one-token edit.

## 94. `cap_with_log` — the helper that makes a truncation attributable — has one caller in 963 files

From [`engine-caps-and-ceilings`](./golden-paths/engine-caps-and-ceilings.md)
§7.A. `personas_core::limits::cap_with_log(label, requested, cap)`
(`core/src/limits.rs:75`) clips a value and emits a `tracing::debug!` naming which
cap fired and by how much. It is unit-tested, it lives in the crate every other
crate depends on, and it is called at **`src/engine/background.rs:2607` and
nowhere else**. Against it: ~440 ceiling applications by other means — 199
`.take(<literal>)`, 99 `.take(<NAMED>)`, 17 `.truncate(…)`, 8 `.chunks(…)`,
144 SQL `LIMIT <literal>`. A log macro appears within four lines of **2 of 304**
anonymous applications.

**Not applied**: 440 call sites is a campaign, not an edit, and a `debug!` per
site is a log-volume decision the operator should make. The census rule
`magic-collection-ceiling` (baseline 53 matches / 34 files, positive control
51 / 32) ratchets the anonymous half so the population stops growing meanwhile.

## 95. Four multi-row reads pick their survivors by rowid

From [`engine-caps-and-ceilings`](./golden-paths/engine-caps-and-ceilings.md)
§7.E. Of 323 `LIMIT` clauses inside `SELECT … FROM` literals, **223 of the 228
multi-row ones carry an `ORDER BY` (97.8 %)** — this repo is close to perfect on
this axis. The five that do not: `memories.rs:1937` (an arbitrary N archived
memories), `digest.rs:382` (an arbitrary 10 of the broken credentials),
`skill_files.rs:195` and `companion/prompt.rs:902` (**the same
`SELECT … FROM dev_projects LIMIT 5` written twice in two modules, one of them
feeding the companion's prompt** — a user with six projects has one the companion
cannot see, and which one depends on insertion order), and `dispatch.rs:785`,
which is correct by design (an ambiguity probe: *is there more than one match*).

**Not applied**: adding an `ORDER BY` changes which rows a live surface and a live
prompt receive. Four one-line edits, each needing a decision about what "the top
5 projects" should mean.

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

**A second applied change has been audited and found pointed at the wrong
half.** `scripts/check-csp-hosts.mjs`, added by this campaign and wired into
`npm run check`, fails the build when a frontend fetch host is missing from
`devCsp` — and **`devCsp` is never applied on desktop** (item 43). The gate is
correct about hosts and is enforcing an allowlist that governs nothing on the
platform the operator develops on. It cost two false starts to get the host
extraction right, and none of that work established that the policy it guards is
live. **Verify the artifact is load-bearing before hardening it.**

**One applied change has since been audited and found incomplete.** Commit
`1e714f817` corrected the credential **token-prefix** regex — measured as
masking 2 of 13 real token shapes before and 13 of 13 after, with 0 false
positives, across four copies. That result stands. What it did not do is examine
`INLINE_SECRET_RE`, the rule **directly above it in the same file**, which binds
`Bearer` as the value of an `Authorization` header and therefore prints
`[secret]` beside a surviving token — see item 35. The campaign's own doctrine
predicted this exact miss and the campaign made it anyway: **a search for the
broken literal finds every copy of that literal and nothing else.**

---

## 87. A cell grid's coordinate is destroyed one layer above the renderer, and five of fourteen rosters have no zero-state

**From:** [`matrix-and-cell-grid`](./golden-paths/matrix-and-cell-grid.md) §7-A/§7-D/§7-I,
[`member-roster`](./golden-paths/member-roster.md) §7-E.

- **`src-tauri`-free, frontend-only.** `db/src/repos/…` untouched by every item here.
- **`overview/sub_health/libs/compositeHealthScore.ts:44,375-384`** — `dailyStatuses: DayStatus[]`
  drops the `date` its own input type declares at `:314` and its own doc comment names at `:312`.
  Widen to `Array<{ date: string; status: DayStatus }>`, pad with the real missing dates instead
  of `unshift('no-data')`, then key `StatusPageView.tsx:145` by `d.date`. One producer, one
  consumer, two test references — a two-site widening that removes the position-keying, the
  interior-gap misalignment and the meaningless `"Day N"` label at once. **Not applied: it
  changes what the status page renders in every row.**
- **`overview/sub_health/components/StatusPageView.tsx:166-175,190`** — six hardcoded English
  strings (`"Success Rate"`, `"Latency (p95)"`, `"Cost Anomalies"`, `` `${n} detected` ``,
  `` `${n} open` ``, `` `Day ${index+1}: …` ``) plus a `DebtText` marker, in a 14-locale app. The
  `title=` at `:190` is also the strip's only readout and is keyboard-unreachable.
- **`plugins/dev-tools/sub_skills/registry/RegistryHeatmap.tsx`** — the model exposes `loading`
  (`registryTypes.ts:68`) and **neither the heatmap nor `RegistryTab` renders anything for it**,
  so the workspace matrix cold-loads as a bare frame. Also `:144` and `:161` use `animate-pulse`
  as a busy state on a control the user just pressed; `buttons/Button loading` is the mandated
  form.
- **Five roster surfaces call `.map` over members with no length guard and no empty state** —
  `TeamStudioSplitVariant.tsx:186`, `BlueprintPreview.tsx:44`, `PresetPreviewModal.tsx:133`,
  `PresetProcessBlueprint.tsx:53`, `PresetQuestionnaireForm.tsx:134`. Three more render nothing
  at all (`JudgePanel.tsx:94`, `ConversationSidebar.tsx:136`, `TeamList.tsx:443`). **As of the
  2026-08-17 purge every one of the app's 8 teams has zero members**
  (`persona_team_members` 64 → 0, `persona_id … ON DELETE CASCADE`), so this is now the *default*
  state, not an edge case. `PresetPreviewModal.tsx:124` renders a heading counter reading
  `(0/0)` above nothing.
- **`overview/sub_certification/components/JudgePanel.tsx:97`** — `key={… ?? Math.random()}`, the
  only `Math.random()` React key in 2,083 `.tsx` files. `JudgePersona` declares both fallback
  fields nullable, so the row remounts on every parent render. The fix is not a better key: a
  verdict with neither a persona id nor a role should render as one aggregate row.
- **`teams/sub_teamWorkspace/BlueprintPreview.tsx:46,60,75`** (+ `useAutoTeam.ts:260`) — the key
  is `` `${member.persona_id}-${i}` `` and both mutations take the index, so removing member 0
  changes every following row's key and remounts the role `<input>` mid-edit. `BlueprintMember`
  already carries `persona_id`.
- **`teams/sub_teamWorkspace/teamStudio/boardShared.tsx:89`** — `PersonaChip` returns `null` for
  an absent persona, so each of the **1,488** `team_assignment_steps` rows whose
  `assigned_persona_id` the purge set to NULL now renders with no actor at all. The only real
  fallback in the tree is `team_synthesis.rs:918-920`'s `"(persona removed)"`, which is a
  hardcoded English literal minted behind IPC and therefore outside the i18n system — it needs a
  `status_tokens` token resolved client-side.
- **`resources/teams.rs:381-384`** — the comment describes a `UNIQUE(team_id, persona_id)`
  constraint that the schema does not declare; the hand-rolled `SELECT EXISTS` guard is a
  read-then-write race. Measured 0 duplicates in 64 pre-purge rows. **A schema change; not
  applied.**

## 88. Ordering keys: a manufactured tie, a half-composite cursor, and two comparators that never return zero

**From:** [`chronological-feed`](./golden-paths/chronological-feed.md) §7-A/B/C/D/E/G, §10.

- **`fleet/monitor/channels/mergedFeed.tsx:42`** — sorts the channel items on `at` alone while
  its sibling `useLensFeed.ts:67` sorts the *same items* on `(at, id)` and documents why.
  Measured against the 2026-08-17 backup, **45.2% of `team_channel_messages` rows share their
  `at` with another row (worst tie 7)**, so within a tied second the live overlay's order — and
  which items survive the `LIVE_FEED_WINDOW = 600` cut — is decided by the order the user's teams
  happen to be listed in. One `|| b.item.id.localeCompare(a.item.id)`. **Not applied: it changes
  what a live surface shows while the operator is watching it.**
- **`db/src/repos/communication/events.rs:1319`** — `search()` orders `(created_at DESC, id DESC)`
  at `:1335` and bounds with a **timestamp-only** `where_lte("created_at", until)`. That is the
  Event Log's "load older" path. The composite form exists 100 lines away at
  `get_recent_after:439`. Latent today (`persona_events` ties at 0.0% raw) and not latent for any
  consumer that truncates the key.
- **`src/commands/teams/team_channel.rs:174-176,242-244,299-301,361-363`** — the cursor predicate
  applies `strftime(…)` to the column, so no index on `created_at` can serve it and every page is
  a scan. Correct semantics, non-sargable shape.
- **`plugins/twin/sub_channels/ContactThread.tsx:49`** and **`SentReplies.tsx:47`** —
  `(a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)` never returns 0, which is not a consistent
  total order. The compliant three-way form is already in the tree at `sceneStore.ts:69`.
  `twin_communications` holds 0 rows, so no user has seen it.
- **`fleet/monitor/channels/conversationModel.ts:39-41`** — `dayKeyOf` is `at.slice(0,10)`, a
  **UTC** calendar day, while `dayLabel` (`:45-53`) computes **local** midnight. At UTC+2 the day
  separator lands at 02:00 local and the first two hours of each local day are filed under the
  previous day's header. `grouping.ts:34-39` (`timeGroupKey`) already computes local boundaries
  and is used by three other feeds.
- **`overview/sub_activity/components/GlobalExecutionList.tsx:161`** — returns unsorted by default
  and defers to the SQL `ORDER BY e.created_at DESC`, while the sticky day headers bucket on
  `started_at || created_at` (`:264`). Rows whose two timestamps straddle a bucket boundary land
  under the wrong header.
- **`messages.rs:60`** and **`executions.rs:253`** — `OFFSET` paging on `created_at` alone. Latent
  at 0.0–0.1% on the operator's data because those writers use nanosecond `to_rfc3339()`; the fix
  is `, id DESC` before considering a move to the keyset form at `manual_reviews.rs:632-676`.
  **A query change; not applied.**
- **`teams/sub_teamMemory/components/timeline/MemoryTimeline.tsx:132`** —
  `` key={`manual-${i}`} `` over an array built by interleaving and then reversing, so inserting a
  run group above renumbers every manual group below it.

---

## 96. `npm run clean:worktrees` finds 19.79 GB of app-created worktrees and prints "Nothing to remove"

> Numbers 96–98 were appended by the wave-2026-08-17-B composer in one atomic append.
> If a sibling composer claimed the same numbers concurrently, renumber — the entries
> are self-contained and order-independent.

Three directories sit in `.claude/worktrees/` on the operator's machine — `athena-dev-515e976a`
(5.34 GB), `athena-dev-afc86f6c` (5.44 GB), `athena-dev-fe5c433a` (9.00 GB). All three were created
by the **app**, not by a CLI session: `dev_mode::create_dev_worktree`
(`src-tauri/src/companion/dev_mode.rs:662-673`). None is registered in `git worktree list
--porcelain`; none has a `.git` file.

Measured 2026-08-17 by running the GC twice:

```
node scripts/worktree-gc.mjs                    →  0 removable · reclaims ~0.00 GB · "Nothing to remove."
node scripts/worktree-gc.mjs --include-orphans  →  3 removable · reclaims ~19.79 GB
```

`package.json:81` maps `clean:worktrees` to the first form. `removable` (`worktree-gc.mjs:200`)
requires `dirty === 0 && merged && age > DAYS`, and an orphan has `dirty === null` and
`merged === null`, so it can only be reclaimed through the separate `INCLUDE_ORPHANS` branch
(`:188-195`, gated at `:43`).

**Root cause:** `dev_mode::prune_worktree` (`:920-928`) runs `git worktree remove <path>` **without
`--force`**, which git refuses for a worktree holding untracked files — and every one of these holds
`node_modules`. The failure is swallowed. A later `git worktree prune` (`worktree-gc.mjs:283`, or
`scripts/test/longitudinal.mjs:66`, which runs one unconditionally) drops the registry entry, and the
directory becomes an orphan. **Four of the five `worktree remove` sites in the tree already pass
`--force`** (`approval_exec_dev.rs:861-864`, `workspace.rs:405-408`, `:422-426`, `:684-687`); the one
on the success path does not.

**Fix, not applied:** (a) `--force` in `prune_worktree`, and surface its failure rather than
discarding it; (b) make `--include-orphans` the default in `scripts/worktree-gc.mjs` with an
`--exclude-orphans` opt-out. Both change what a destructive script does, so both are deferred.
Detail: [`agent-workspace-isolation.md`](./golden-paths/agent-workspace-isolation.md) §0, §7.1, §7.2.

---

## 97. `CliProcessDriver` declares it owns a temp directory and has no `Drop` — one call site leaks on 100% of runs

`src-tauri/engine/src/cli_process.rs:529-547` — `spawn_temp` creates `%TEMP%/<prefix>-<uuid>` and
sets `owns_exec_dir: true`. The only code honouring that flag is `cleanup_dir()` (`:700-705`),
reachable from `finish()` (`:708-712`) or an explicit call. `kill()` does not call it. `?` does not
call it. **There is no `Drop` impl** (all 25 `impl Drop for` sites in `src-tauri/` enumerated; no
child-owning struct has one).

Measured: **14 construction sites; 9 reach an early return before any cleanup** (census rule
`leaked-owned-exec-dir`, 7 files / 9 matches, precision 9/9 hand-verified). One of them —
`src-tauri/engine/src/cli_capabilities.rs:68` — calls `driver.kill().await` at `:72` and `:97` and
**never** calls `finish()` or `cleanup_dir()` on any path.

Confirmed on disk, 2026-08-17, by enumerating all 87,149 `%TEMP%` entries and bucketing by creator
prefix: `personas-capprobe-*` = **132 directories**; every other owning-driver prefix
(`personas-auto-triage`, `personas-llm-eval`, `personas-test-coord`, `personas-test-exec`,
`build-cap`, `build-prose`, `build-clarify`, `build-test`, `test-summary`,
`personas-genome-critique`, `personas-assignment-match`, `personas-assignment-decompose`) = **0**.
One site out of fourteen leaks, and it leaks every time.

**Fix, not applied:** `impl Drop for CliProcessDriver { fn drop(&mut self) { self.cleanup_dir(); } }`.
`cleanup_dir` is already `&self`, `owns_exec_dir`-guarded and idempotent. The repo has the pattern
twice already (`build_session/runner.rs:109-146` `SessionExecDir`; `cli_mcp_config.rs:348-351`
`SidecarScrubGuard`) and neither has ever appeared on disk. Deferred because a `Drop` impl changes
what runs when a live app's handles go out of scope. Interim, lower-risk half: add
`driver.cleanup_dir()` after the `kill()` at `cli_capabilities.rs:97`.
Detail: [`agent-workspace-isolation.md`](./golden-paths/agent-workspace-isolation.md) §7.4, §7.5, §9.1.

---

## 98. Boot recovery declares 74 executions failed without ever asking whether the process is alive — and there is nothing it could ask with

`src-tauri/src/engine/mod.rs:703-733`. `recover_stale_executions` takes every `running` row and writes
`status: Failed, error_message: "App restarted while execution was running"`. There is no liveness
check in the loop.

Measured against the 2026-08-17 purge backup: **74 of 2,188 executions** carry that marker (3.4%).
*(Historical — those rows were deleted from the live database by the authorized purge on 2026-08-17;
the reference file is `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`.)*

There is nothing it could check with, and that is the deeper defect. Interrogating **all 244 tables**
with `PRAGMA table_info` finds exactly **one** column holding an OS process id —
`build_sessions.cli_pid` (`db/src/migrations/schema.rs:1489`) — with **12 rows and 0 non-null**; its
three writers (`build_session/mod.rs:196`, `runner.rs:1921`, `events.rs:80`) all write `None` or
`Some(None)`, and no site in 963 `.rs` files writes a real pid into it. `fleet_sessions` has no pid
column at all (`incremental.rs:6603-6631`) and rehydration restores `child_pid: None`
(`fleet/persist.rs:174`). Every other process registry is in memory.

Meanwhile the children survive: `tokio::process::Child` does not kill on drop (this repo says so at
`companion/brain/oneshot.rs:52-53` and `commands/fleet/external.rs:189-190`), no child-owning struct
has a `Drop`, only **17 of 112** OS-command construction sites set `kill_on_drop(true)`, and the app's
sole exit hook (`lib.rs:3755-3763`) stops Bun dev servers and nothing else. So a row can say `Failed`
while its `claude` child is still running, still writing to the workspace, still spending tokens.

And PID reuse is unguarded where a pid *is* used: **`start_time()` and `run_time()` appear zero times
in 963 `.rs` files**, and of the four `sysinfo` process lookups in the tree, three act on the process
(`.kill()`, `.is_some()`) without reading a single identity field and **zero** read one first
(`fleet/headless.rs:67`, `fleet/process_scan.rs:133`, `dev_tools/competitions.rs:990`). The strongest
identity check in the codebase is on the **frontend**
(`FleetProcessScanner.tsx:65-75`: `p.pid === pid && p.cmd === target.cmd && p.cwd === target.cwd`).

**Fix, not applied:** (a) `recover_stale_executions` writes an *unproven* state with a
`state_reason` a human can act on, rather than `Failed` — the shape `fleet/persist.rs:263-299`
already uses; (b) `kill_on_drop(true)` on the child-owning spawn sites that are not deliberately
outliving the app; (c) register the five uncovered registries with the `RunEvent::Exit` hook;
(d) either populate `build_sessions.cli_pid` with a `(pid, start_time)` identity or drop the column;
(e) a CI check asserting no `*pid*` column exists without a sibling freshness column (it would report
exactly one finding today); (f) correct the stale `sysinfo` comment at `Cargo.toml:136-138`, which
says the app "never enumerate[s] processes" while `process_scan.rs:60-62` enumerates the whole table.
The repo already wrote the correct doctrine once, with its reasoning, at
`src-tauri/src/daemon/lock.rs:29-32`: *"No PID-based liveness check. Heartbeat freshness is the sole
liveness indicator."* Nothing else follows it.
Detail: [`os-process-reconciliation.md`](./golden-paths/os-process-reconciliation.md) §0, §7.1-§7.7, §9.

## 89. `cargo deny` — MERGED INTO #106, with two additions and one denominator correction

**Superseded by [#106](#106-cargo-deny-check-has-never-rendered-a-verdict--the-engine-floats-the-policy-is-frozen-and-the-fleet-already-has-the-fix)**, which owns this fix and carries the fuller
account. Recorded here rather than deleted because the two were measured **independently,
hours apart, by two composers in the same wave** — same file, same line
(`deny.toml:19:17`), same value (`unmaintained = "warn"`), same tool version (cargo-deny
**v0.20.2**), same diagnosis of `--locked` pinning the lockfile and not the version, same
observation that `audit.yml` never gets there. **Two artifacts arriving at one set of
numbers by different routes is what verification looks like**, and it is worth more than
either entry alone.

Three things this pass adds:

1. **The `audit.yml` step would report success even if it ran.** `audit.yml:44` is
   `cargo deny check 2>&1 | tee security-results/cargo-deny.txt`, and the step has no
   `shell:` key — so it runs under GitHub's default `/usr/bin/bash -e {0}`, **without
   `pipefail`**, and `tee`'s exit status becomes the step's. Verified from the `shell:`
   lines in that job's own log, where the repo's plain `run:` steps show `-e {0}` and only
   the `dtolnay/rust-toolchain` composite (which sets `shell: bash`) shows
   `-e -o pipefail`. So the fix in #106 must **also** remove the pipe or add
   `set -o pipefail`; otherwise repairing `deny.toml` converts a red gate into a green one
   that still checks nothing. *(Note the near-miss: the general rule "a pipe erases the
   exit code" is **false for a step that sets `shell: bash`** and true for one that does
   not. The condition is the shell, and the shell is not visible at the pipe.)*
2. **The documentation asserts the gate works.** `docs/development/build.md:212` lists
   `cargo-deny` among the CI gates with no qualification. Corrected in this pass
   (documentation only).
3. **Denominator correction to #106.** It states the `audit.yml` step is `skipped` on
   **"23 of 23 lifetime"** runs. Measured step-by-step across all 23: the workflow has 23
   runs, **all `failure`** — but the cargo-deny step **exists in only 18 of them**
   (2026-04-20 onward) and is `skipped` in **all 18**; the 5 runs from 2026-03-16 to
   2026-04-13 have no such step at all (verified by listing their step names). The
   conclusion is unchanged — a step that does not exist also renders no verdict — but
   *"skipped 23 of 23"* is not what the API says, and a later reader auditing the claim
   would find 5 runs that contradict it. **Same conclusion, different denominator, two
   independent implementations: report the disagreement rather than the prettier number.**

## 99. CI compiles the 331,560-line `app_lib` crate and never runs or lints it — every Rust step fails fast at `personas-db`

**Where:** `.github/workflows/ci.yml:298` (`cargo test --workspace … --features desktop`),
`:306` (`cargo clippy --workspace … -- -D warnings`).

Step-level from run `32025966929`, Windows leg, 2026-08-17 (same shape on Linux):
`cargo test` ran `personas_core` (**760 passed / 0 failed**) then `personas_db`
(**808 passed / 10 failed**, 1,571 s) and stopped — cargo's default fail-fast.
`personas-desktop (lib test)` **compiled** (the log carries its *"generated 159 warnings"*
summary) and was **never executed**. `cargo clippy` died at `personas-db` with **3
`clippy::sort_by_key` errors**, so `personas-engine` and `personas-desktop` were never
linted either.

By crate: `personas-desktop` 564 files / **331,560 lines / 63.2%** of the Rust — tested by
nothing, linted by nothing; `personas-engine` 129 / 61,184 / 11.7% — not reached.

This also **retires the standing diagnosis of the job's redness.** The prescription in
[`adding-a-ci-gate.md`](./golden-paths/adding-a-ci-gate.md) attributes it to the keyring
`unwrap()` and prescribes `PERSONAS_ALLOW_FALLBACK_KEY: "1"`. **That fix has landed**
(`ci.yml:235`, `:356`) and the job is still red for three independent reasons, none of them
the keyring: 10 genuine `personas-db` test failures, 3 clippy errors, and #89.

**Fix (not applied — the 10 failures are real code and `--no-fail-fast` changes exit
semantics for every consumer):** fix the 10 `personas-db` tests and 3 clippy findings
first; then split clippy and cargo-deny into their own jobs (already prescribed) **and**
add `--no-fail-fast` to the test step so one crate's failure stops reporting the other four
as unknown. Consider a per-crate matrix leg, which also parallelises the 1,571 s wall.

Detail: [`local-build-troubleshooting.md`](./golden-paths/local-build-troubleshooting.md) §7.B ·
[`crate-layering.md`](./golden-paths/crate-layering.md) §7.A.

## 100. The ORT architecture sniffer is correct only because of COFF member ordering, and its three failure arms all block `tauri dev`

**Where:** `scripts/ensure-ort-cache.mjs:144-172` (`sniffLibArchitecture`), consumed at
`:334`, `:370` and `:430-433`.

The function reads the machine word of the **first non-metadata member** of the COFF
archive. Parsed byte by byte on the live cache
(`%LOCALAPPDATA%\ort.pyke.io\dfbin\aarch64-pc-windows-msvc\C09BFF…27DE\onnxruntime\lib\onnxruntime.lib`,
2,124 B): **7 members — 2 linker metadata (`/`), 3 long-form objects reporting `0xAA64`,
and 2 short-form import members** (SIG1 `0x0000`, SIG2 `0xFFFF`, machine field `0x0`). It
returns `arm64` because MSVC's `lib.exe` emitted the long-form members first. Replaying the
shipped algorithm confirms it: `arm64`.

If a future archiver emits a short-import member first, the sniffer returns
`unknown-0x0000`, which is `!== expectedMachine` at all three call sites: it invalidates a
valid sentinel (`:359`), wipes and re-downloads a correct 321 MB cache (`:369-377`), and
then **`fatal()`s at `:431-433` on the freshly correct library** — so the guard that
protects `npm run tauri:dev` becomes the thing that blocks it, on a machine whose cache was
never wrong.

**Fix (not applied — build tooling whose first run touches a cache `tauri dev` depends
on):** skip short-import members explicitly (`w0 === 0x0000 && w1 === 0xFFFF`), then read
the first long-form member; or scan **all** object members and require unanimity, returning
a distinct `mixed` verdict if they disagree. Either is ~6 lines. The unanimity form is
strictly better because it would also detect a genuinely mixed archive, which is the exact
upstream defect this script exists for.

Detail: [`local-build-troubleshooting.md`](./golden-paths/local-build-troubleshooting.md) §0.4, §6.

## 101. 98.6% of the vendored ONNX Runtime cache is debug symbols nothing links against

**Where:** `scripts/ensure-ort-cache.mjs:422` — `copyTree(innerLibDir, libDir(target))`.

The script copies Microsoft's entire `lib/` directory out of the release zip. On disk:
`onnxruntime.pdb` **317,247,488 B**, `onnxruntime_providers_shared.pdb` 405,504 B,
against `onnxruntime.dll` 11,785,760 B, `onnxruntime.lib` **2,124 B** and
`onnxruntime_providers_shared.{dll,lib}` 23,338 B. **317.7 MB of 321.8 MB is two `.pdb`
files** — MSVC debug symbols for a prebuilt DLL, on every developer machine, re-downloaded
in full after every `npm run clean:ort`.

**Fix (not applied):** filter `.pdb` in the `copyTree` call (a predicate argument, ~3
lines), and note it in the sentinel so an existing fat cache is recognised rather than
silently kept. `npm run clean:ort` then costs ~12 MB to restore instead of ~322 MB.

Detail: [`local-build-troubleshooting.md`](./golden-paths/local-build-troubleshooting.md) §7.F.

## 102. Two materialized Tauri configs on disk describe a program that stopped existing 161 days ago

**Where:** `src-tauri/gen/android/app/src/main/assets/tauri.conf.json` and
`src-tauri/gen/android/app/build/intermediates/assets/universalDebug/mergeUniversalDebugAssets/tauri.conf.json`
(both untracked; `git ls-files src-tauri/gen` = 40 files, neither among them).

They are the output of a `tauri android` run on **2026-03-09** — a full deep merge of
`tauri.conf.json` + `tauri.android.conf.json` + Tauri's own defaults, **87 leaf paths**
against the canonical config's 43. **A materialized merge is indistinguishable from a
source of truth**: same schema, same shape, strictly more complete. Measured against HEAD:
`version` `0.1.6` vs `1.1.0`; `app.withGlobalTauri` `false` vs **`true`** (added
2026-05-09); `app.security.assetProtocol` `{scope: [], enable: false}` vs a 7-entry scope
with `enable: true` (added 2026-04-15); `bundle.resources` absent (added 2026-07-26);
`nsis.customLanguageFiles` absent (added 2026-04-09); `devCsp` a March policy. The canonical
config has **30 commits** since. Reconstructing the canonical file at `7d6e67ad0` reproduces
the merged content exactly, which is what dates it.

Consequence already in the corpus:
[`tauri-permissions-and-csp.md`](./golden-paths/tauri-permissions-and-csp.md) reads this
artifact as *"the empirical proof of the platform merge"* and counts its `csp`/`devCsp`
pair among 7 live CSP surfaces. The **merge mechanism** it demonstrates is sound; the
**values** are not live, and re-running `tauri android` would produce four different
strings.

**Fix (not applied — an Android toolchain may hold the directory, and deleting build output
is a runtime-affecting action):** remove `src-tauri/gen/android/**/tauri.conf.json` as part
of a `clean:android` rung, and add an assertion that no script or document reads a config
under `gen/`. The general rule — *a generated full materialization must carry its own
provenance or be treated as unreadable* — is the reusable part.

Detail: [`tauri-config-variants.md`](./golden-paths/tauri-config-variants.md) §0, §7.A.

## 103. `check-tauri-configs.mjs` reads 3 of 5 tracked configs because its input set is a hardcoded literal

**Where:** `scripts/check-tauri-configs.mjs:17-18`, `:21-24`.

`CANONICAL` + `OVERLAYS` are three string literals, so all five assertions in the file
(JSON parse, `$schema` parity, overlay-key surface, cargo-feature existence, CSP
script-directive ban) run over three files. `tauri.android.conf.json` and
`.tauri-scraper-dev.conf.json` are never opened, and two further configurations are
generated at launch (`scripts/dev/tauri-dev-test.mjs:27-36`,
`scripts/test/launch-isolated.mjs:154-170`) — **5 tracked files, 7 configurations, 3
examined.** `docs/development/build.md:21` and `:46` repeat the number three.

The fix is a **type, not a gate**: discover configs by reading the directory and filtering
on the `tauri*.conf.json` shape, classify into canonical / profile / platform, and give each
class its own `ALLOWED_OVERLAY_KEYS`. That makes an unexamined config unrepresentable. It
cannot be a flat widening of the existing allowlist: `tauri.android.conf.json` legitimately
overrides 5 keys outside it and **illegitimately** overrides `beforeBuildCommand` (to
`npx vite build`, which runs 0 of 14 codegen tasks) — so `beforeBuildCommand` must be on no
allowlist. Add an exit-2 precondition when fewer than 4 configs are discovered.

**Not applied** — it is a security-relevant gate whose first run fails the tree (the
android config's `'unsafe-eval'` and its missing `$schema` both trip existing assertions),
and the same enumeration is prescribed from the security side by
[`tauri-permissions-and-csp.md`](./golden-paths/tauri-permissions-and-csp.md) §9. Landing it
once, for both reasons, is better than landing it twice.

Detail: [`tauri-config-variants.md`](./golden-paths/tauri-config-variants.md) §7.B, §9.

## 104. The host-triple drift detector runs only on the dev path, and the error it detects is a build error

**Where:** `scripts/run-codegen.mjs:78-79` — `host-check` is in the `predev` preset and not
in `prebuild`.

`tauri.conf.json:9-10` wires `beforeDevCommand: "npm run dev"` (→ `predev`) and
`beforeBuildCommand: "npm run build"` (→ `prebuild`). So `scripts/check-build-cache.mjs` —
whose entire purpose is to catch the contamination that produces
`lld-link: error: machine type x64 conflicts with arm64` — never runs on `npm run build`,
`npm run tauri:build`, `tauri:build:lite`, `tauri:build:stable`, or any of the three tier
bundles. **A link error only happens during a link.** `docs/development/build.md:84`
documents the asymmetry, so it is deliberate; it is simply on the wrong side. Cost of the
fix: one `rustc -vV` per build.

Smaller, same file: `build.md:98-100` says the marker is written *"after each successful
run"* of the build. It is written at `check-build-cache.mjs:66`, **before** cargo starts —
so it records *the host the last `predev` saw*, not *the host of the last successful build*.
The guard still holds (a drifting run exits 1 at `:62` without writing), but a reader
debugging a contaminated tree will reason from the wrong meaning.

**Not applied** — adding a task to `prebuild` changes whether `npm run build` can fail, and
a false positive would block every build on the machine.

Detail: [`local-build-troubleshooting.md`](./golden-paths/local-build-troubleshooting.md) §7.E.

## 105. Both Stop hooks are dead: a tool result is shaped exactly like the human message they stop at

**From:** [`documentation-sync`](./golden-paths/documentation-sync.md) §0, §7.A.

`scripts/docs/check-doc-sync.mjs:95-108` and `scripts/docs/check-golden-path-touch.mjs:81-95`
carry byte-equivalent transcript walks. Both break on
`evt.type === 'user' && evt.message?.role === 'user'`, described in their own comments as
"the most recent user message". **A tool result is recorded as exactly that shape**: across
the 100 transcripts in `~/.claude/projects/C--Users-mkdol-dolla-personas/`, **18,908 of
20,322** such events (93.0%) are tool results and only **1,414** are human messages. Every
`Edit` is immediately followed by its own `tool_result`, so the walk hits a boundary before
it reaches a single `tool_use`.

Executed, not read — replayed over every turn of every transcript, and the hook itself
invoked on twelve of them:

| | |
|---|---:|
| turns (delimited by genuine human messages) | 1,414 |
| turns that edited >=1 file | **477** |
| ...in which the hook's walk saw >=1 edit | **0** (0.00%) |
| file-edits in those turns | **2,367** |
| ...visible to the hook | **0** (0.00%) |
| direct invocation on 12 real transcripts (up to 209 edits each) | **exit 0, 12 of 12** |

`:117`'s `if (edited.size === 0) process.exit(0)` is therefore not one of two silent-pass
paths (as [`adding-a-ci-gate`](./golden-paths/adding-a-ci-gate.md) §7 P10 records) — it is
**the** path, on every turn, since the three-target hook landed in `d584207f7` on
2026-05-16. The doc-sync reminder and the golden-path-touch reminder have both never fired.

The fix is one clause in each file — treat the event as a boundary only when its content is
not a tool result:

```js
if (evt.type === 'user' && evt.message?.role === 'user') {
  const c = evt.message.content;
  if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) continue;
  break;
}
```

**Not applied.** It converts two hooks that have never spoken into two hooks that speak on
most turns, immediately, inside the operator's live sessions — including this campaign's
own, where `check-golden-path-touch.mjs` would begin nagging every composer. That is a
change to what a live surface shows while the operator is watching it. Fix it deliberately,
with the noise expected.

Two companions in the same document, both cheap once the above lands and both requiring a
judgement call rather than a mechanical edit: the satisfaction conditions at
`:120`/`:121`/`:125` are directory prefixes while the message names an exact file
(**45.7% precision** over 761 real co-edit commits), and `feature-doc-map.json` covers
**2,883 of 4,304** source files (**33.0% unmapped**), which no check measures.

## 106. `cargo deny check` has never rendered a verdict — the engine floats, the policy is frozen, and the fleet already has the fix

**From:** [`supply-chain-policy`](./golden-paths/supply-chain-policy.md) §0, §7.A, §12.3.

`src-tauri/deny.toml` has one commit (`4c42aacb0`, 2026-04-09) and has never been edited.
`.github/workflows/ci.yml:310` installs the policy engine with
`cargo install cargo-deny --locked` — **`--locked` pins cargo-deny's own lockfile, not its
version** — so the runner fetches whatever is current. On 2026-08-17 that is **v0.20.2**,
and it refuses the config:

```
error[unexpected-value]: expected '["all", "workspace", "transitive", "none"]'
   |- src-tauri/deny.toml:19:17
19 | unmaintained = "warn"
[ERROR] failed to deserialize config from 'src-tauri/deny.toml'
Process completed with exit code 1
```

Elapsed from the step's `##[endgroup]` to the error, from the log timestamps of job
`95375460599`: **21 ms**, across **0 of 1,010** packages. Before `if: always()` landed in
`6cd8a87f0` (2026-08-13) the step was `skipped` instead — sampled at 2026-04-27, 07-07,
07-13, 07-17, 07-24, 07-29, 08-04 and 08-10: `skipped`, 8 of 8, all three platforms. The
weekly path is shut too: `audit.yml`'s cargo-deny step is `skipped` on **23 of 23** lifetime
runs, because `scripts/security-audit.sh` fails first and nothing there is `if: always()`.

**Do not hand-edit the policy — port it.** `../brainiac/deny.toml` (written 2026-07-30,
refined 2026-08-05, same author, four months later) answers every defect here: `[graph]`
declares `all-features = true` and `exclude-dev = false`; `unmaintained = "all"` is the
modern enum; `yanked = "deny"`; the `ignore` list carries a dated per-advisory entry with a
reachability analysis and a removal condition; the license allow-list is annotated
crate-by-crate and marked "derived from `cargo deny list`, not from a template"; `[bans]`
names two real crate bans with reasons. Its workflow installs cargo-deny as a prebuilt
binary and — the part that matters most here — **runs `npm audit` off `package-lock.json`
with no `npm ci` at all**, which is exactly what would have kept this repo's weekly audit
alive through the lockfile desync. `brainiac`'s security workflow is 39 runs, **12 green**;
this repo's two supply-chain paths are 350 runs, **0 green**.

**Not applied.** `yanked = "warn"` vs `"deny"` and `vulnerability = "deny"` are policy
decisions that may be deliberate, and repairing the config turns a check that examines
nothing into one that will report real findings across 1,010 crates during a working day.
It should be repaired *and expected to be red* on first run — `deny.toml`'s own header in
brainiac says it: *"this file describes the dependency tree as it ACTUALLY is. It is not a
place to make a red check green."*

Two adjacent items from the same document, both also unapplied: the lockfile carries **one**
git source (`pumper-core` @ `rev 7e13f31`) against a policy of
`unknown-git = "deny", allow-git = []`, and whether the check would even see it depends on a
feature resolution `[graph]` never declares (`default = []`, 38 `optional = true` across four
manifests). And `src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties` names
`gradle-8.14.3-bin.zip` with **no `distributionSha256Sum`**, beside a tracked 59,203-byte
`gradle-wrapper.jar` whose sha256
(`e996d452d2645e70c01c11143ca2d3742734a28da2bf61f25c82bdc288c9e637`) is recorded nowhere in
the repository — adding the pin changes whether an Android build starts.

## 107. The bundle budget fails at 6.33x, has never been observed, and 60 MB of source maps carrying full TypeScript ship inside every installer

**From:** [`bundle-size-budget`](./golden-paths/bundle-size-budget.md) §0, §7.A, §7.B.

`node scripts/check-bundle-budget.mjs` at `cc27be561`, run directly and its exit code read
without a pipe: **exit 1**. Total **31,642.1 KB** against the 5,000 KB ceiling declared at
`scripts/lib/bundle-budget.mjs:12` — **6.33x** — plus three chunks over the 850 KB per-chunk
ceiling (`vendor-three` 1,008.7, `index` 913.9, `en` 896.6). The ratchet file
`scripts/bundle-baseline.json` is timestamped **2026-03-14** at `totalKB: 4720`: five months
and 6.7x behind. Nobody has seen this, because `ci.yml` is **327 runs, 0 successes** and the
budget step's `dist/` never exists there.

Two things must be decided together, which is why this is a note and not a fix:

1. **The metric is wrong in both directions.** **793 of the 1,400 chunks — 16,869.5 KB,
   53.3% of the total — are per-locale catalogs** (13 locales x 61 sections), of which a
   user loads at most one; roughly **49.2%** of the budgeted number is bytes no single user
   can fetch, and the May 2026 section-locale split (a genuine improvement) is most of what
   pushed the gate over. Meanwhile the gate reads `dist/assets/*.js` only and therefore
   observes **28.4%** of `dist/` — missing 60,623.3 KB of `.map`, 865.6 KB of `.css`,
   1,944.0 KB of `.png` and 16,414.0 KB elsewhere, against a directory total of
   **111,489.1 KB across 3,133 files** (two implementations, `fs.statSync` and PowerShell
   `Measure-Object`, agreeing to 0.1 KB).
2. **The source maps ship.** `vite.config.ts:84` `sourcemap: "hidden"` emits them;
   `tauri.conf.json` sets `frontendDist: "../dist"`; there is no `.taurignore`; and
   `tauri-codegen-2.6.2/src/embedded_assets.rs:127-140` walks the tree filtering
   **directories only** ("compress all files encountered"). Each map carries
   `sourcesContent` — the `index` map alone holds **302 sources and 2,268,612 bytes** of
   original TypeScript. `release.yml:365-370` uploads them to Sentry and never deletes them.
   **`../personas-web/next.config.ts:113-117` already does the right thing**, with the
   reason in the comment: `sourcemaps: { deleteSourcemapsAfterUpload: true }` —
   *"Delete source maps after upload so they don't ship to the client"*. Port that, or emit
   maps outside `frontendDist`.

**Not applied.** Both halves change what the shipped installer contains, and re-baselining is
a decision about what the ceiling should mean rather than an edit. Two smaller companions
from the same document: `binary-size-report.mjs:121` exempts the `.exe` from the 100 MB
budget while the local release binary is **144,254,976 B (137.6 MB)**, and `.baseline/` has
never been created so every size delta renders as `—`; and `npm run check:assets` reports
**12,831 KB -> 3,849 KB (70%)** of free PNG savings while being wired into no workflow, no
hook and not `npm run check`.

---

## 108. One purge orphaned 100% of the vector store, and nothing in the tree can find an orphan

**Where:** `src-tauri/db/src/repos/core/memories.rs:1638-1660` (`spawn_delete_memory_embeddings`),
`:1928` (`gc_archived_memory_embeddings`), `:2008` (`backfill_memory_embeddings`);
`src-tauri/db/src/migrations/schema.rs:525`;
`src-tauri/src/commands/credentials/vector_kb.rs:1410-1516` (`reconcile_orphaned_kb_records`).

**What is measured** (2026-08-17, against the purge backup and the live files,
two independent implementations in exact agreement — a cross-`ATTACH` SQL join
and a bespoke JS `Set` difference):

| | `persona_memories` | vectors | orphan vectors |
| --- | ---: | ---: | ---: |
| pre-purge (`purge-backup-2026-08-17/personas.db`) | 6,535 | 5,158 | **0** |
| post-purge (live) | **0** | **5,158** | **5,158 (100%)** |

`personas_data.db` is **byte-identical** in the backup and live (17,502,208 B):
the purge never touched it. A third check — comparing the vector id *sets* —
confirms all 5,158 ids are present in both, so no cleanup ran late.

**Why it happened, and it is structural rather than an oversight.**
`persona_memories.persona_id REFERENCES personas(id) ON DELETE CASCADE` is
enforced by SQLite *inside `personas.db`*. The vector's key,
`persona_memory_embedding_meta.memory_id`, is a bare `TEXT` column in
`personas_data.db`. A cascade is a database-engine feature; it stops at the
file. Of the **8 doors that delete a memory**, 3 call the vector companion
(`batch_delete`, `merge`, the archive path) and 5 do not — including the
`crud_delete!` macro, `delete_non_code`/`delete_all`, the `fk_hygiene`
migration, and the FK cascade, which *cannot*.

**And no sweep runs in the direction that would find it.** Every reconciliation
here is relational → vector: `gc_archived_memory_embeddings` enumerates
`tier = 'archive'` rows in the main DB, `backfill_memory_embeddings` enumerates
memories. `reconcile_orphaned_kb_records` — the one bidirectional reconciler —
compares two *relational* tables (`knowledge_bases` ↔ `persona_credentials`) and
only ever touches the vector store via `drop_index(kb_id)` for a `kb_id` it read
off a relational row. **No code in 963 `.rs` files enumerates the vector store
and asks whether each vector still has a parent.** An orphan is by definition
absent from the relational side, so a relational-first sweep cannot see one.

**The cleanup is behind a cargo feature; the data is not.**
`delete_memory_embeddings`, `gc_archived_memory_embeddings`,
`spawn_delete_memory_embeddings` and `reconcile_orphaned_kb_records` are all
`#[cfg(feature = "ml")]`. `npm run tauri:dev:lite` — the documented daily
default — builds `desktop`. **In a lite build the app cannot delete a single
vector, ever, and the boot reconciler does not run.** Tree-wide: 230 cleanup
function declarations, **3** behind a cargo feature, all 3 these.

**Cost, not correctness.** `memories.rs:1639` says an orphan is *"inert for
recall"*, and for correctness it is (KNN ids are lifted from the authoritative
table; a missing row drops out — `memory_recall.rs:343-346`). But the KNN
`LIMIT k` is applied **before** the intersection, and `k` is sized against live
candidates (`k = candidates.len()*4, min 128`), never against the orphan
population. Recall degrades in proportion to orphan share, silently, with no
error anywhere.

**Why held:** the fix's first run **deletes rows** — 5,158 of them on this
machine. Standing rule.

**The safe first step, which deletes nothing:** count both sides at boot and log
the difference *even when it is zero*. `reconcile_orphaned_kb_records:1513` logs
only when `cleaned > 0` and has therefore never printed a line here — a
reconciler whose only output is silence is indistinguishable from one that never
ran.

**The sibling did not take the exception.** `brainiac/migrations/0001_init.sql:104-109`
declares `memory_embeddings.memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE`
— same logical relationship, same database, real foreign key. Orphaning is
unrepresentable there, which is why that repo has no reconciler, no GC sweep and
no feature gate. One independent witness, and it inverts our practice.

Detail: [`vector-kb-ingestion.md`](./golden-paths/vector-kb-ingestion.md) §0, §7.1-7.2, §12.2.

---

## 109. A blank form fires a fabricated URL at somebody else's API, on your credential

**Where:** `src/features/vault/shared/playground/RequestBuilder.tsx:50`
(`resolved.replace('{'+key+'}', encodeURIComponent(val || key))`), `:40-58`,
`:37`; `src/features/vault/shared/playground/BuilderParams.tsx:93-98`;
`src/lib/credentials/catalogApiEndpoints.ts`.

**What is measured** (2026-08-17; the catalog counted two ways — a textual
constructor count and an evaluation of the module — in exact agreement):

- The baked catalog holds **71 connectors / 472 endpoints / 504 parameters**
  (248 `path`, 256 `query`), of which **309 declare `required: true`**.
- `ApiParameter.required` and `ApiParameter.schema_type` are read in **exactly
  one file** — `EndpointRow.tsx:108`/`:110-111`, a read-only detail panel — and
  in **zero** files that build a request. The fire button
  (`RequestBuilder.tsx:85-92`) is `disabled={isSending || !path.trim()}`.
- Replaying `RequestBuilder`'s own `resolvedPath` verbatim against the real
  catalog: **209 of 209** endpoints with a path parameter turn a blank-but-
  touched form into a syntactically valid, entirely fabricated URL.
  `/{project}/_apis/pipelines` fires as `/project/_apis/pipelines`.
- 61 query parameters declared `required: true` ship with empty values
  (`api-version=`), because `resolvedPath` filters on `q.key.trim()` only.
- `schema_type` is `"string"` on **504 of 504** parameters — the constructor
  defaults it and no call site overrides it, so the declared type carries zero
  bits.
- `request_body.schema_json` is `null` on **120 of 120** catalog endpoints, so
  `RequestBuilder.tsx:37`'s body prefill is dead for the catalog; for a
  user-imported OpenAPI spec it prefills the **schema** as if it were the
  payload.

**Why this is worse than a validation gap.** The request succeeds
syntactically and fails semantically, against a third party, with the user's
stored credential attached. A 404 from `/repos/owner/repo` is indistinguishable
from a real 404, so the user debugs the API instead of the form.

**Why held:** deleting the `|| key` fallback and adding a `missingRequired`
term to the fire button's `disabled` changes what a live surface does while the
operator is using it — a request that fires today would stop firing. Standing
rule. The change is small and correct; it should be the first item applied when
the campaign resumes destructive applies.

Detail: [`external-operation-explorer.md`](./golden-paths/external-operation-explorer.md) §0, §7.1-7.4.

---

## 110. One of two OCR backends can be cancelled, and the reason the other one needs it is written in the first one's comment

**Where:** `src-tauri/src/commands/ocr/mod.rs:476` (`run_claude_ocr`), `:182`
(`run_gemini_ocr`), `:37-50` (the cancellation registry),
`src/features/plugins/drive/ocr/DriveOcrDrawer.tsx:100-102`, `:110-113`;
`src-tauri/src/lib.rs:2726-2731`.

**What is measured** (2026-08-17):

- **`operation_id` is a parameter on 2 of 4 OCR entry points** — both Gemini
  commands have it, neither Claude command does. `cancelInFlight()` in the
  drawer therefore does nothing on the Claude path, and `run_claude_ocr` retains
  no child handle, sets no `kill_on_drop`, and runs `wait_with_output()` to
  completion. The Gemini path's own comment states the motive: *"instead of
  silently paying for a Gemini call whose result we'll throw away."*
- **Cancellation is detected by substring-matching an English string.**
  `DriveOcrDrawer.tsx:112`: `if (!msg.includes("OCR cancelled"))`. Producer is
  `AppError::Internal("OCR cancelled".into())`. Reword the Rust string and a
  deliberate user cancel starts raising an error toast, in a 14-locale app.
- **All 8 OCR commands are unauthenticated at both layers.** `grep -n ocr
  src-tauri/src/ipc_auth.rs` returns nothing (none is in `PRIVILEGED_COMMANDS`),
  and the in-body guard is `require_auth_sync`, which is
  `Ok(())` (`ipc_auth.rs:477-479`). `ocr_with_gemini` takes
  **`api_key: String` from the renderer**. Mitigating: the frontend has zero
  call sites for `ocr_with_gemini`/`ocr_with_claude` — only the two
  `ocr_drive_file_*` wrappers, which resolve the key server-side from the vault.
- **3 of 8 commands are unreachable.** `list_ocr_documents` (`:658`),
  `get_ocr_document` (`:664`), `delete_ocr_document` (`:673`) carry
  `#[tauri::command]` and appear in neither `generate_handler!` (`lib.rs:2726-2731`
  registers five) nor `commandNames.generated.ts`. Their repository layer is
  fully written. **Every OCR run writes an `ocr_documents` row nothing can read.**
- **An empty extraction is stored as a success.** Gemini via
  `.unwrap_or_default()` on the candidates chain (`:286-294`), Claude via
  `String::from_utf8_lossy(&output.stdout).trim()` on an exit-0 run with no
  stdout. `GeminiCandidate` (`:104-107`) does not deserialize `finishReason`, so
  a `SAFETY` block, a `RECITATION` block and a `MAX_TOKENS` truncation are all
  indistinguishable from an empty page.
- **`ocr_documents` holds 0 rows in the purge backup**, and that table was not in
  the purge cascade. The surface has never run — which is why none of the above
  has been shaken out.

**Why held:** wiring cancellation to the Claude path means killing a spawned
child, and registering the three CRUD commands changes the IPC surface. Both
change runtime behaviour. Standing rule.

Detail: [`ocr-extraction.md`](./golden-paths/ocr-extraction.md) §0, §7.1-7.4, §7.9.

---

## 111. A corrupt MCP config is replaced by `{}` and written back over the user's file, destroying every other registered server

**Where:** `src-tauri/src/mcp_server/install.rs:85-110`.

**What is measured** (2026-08-17):

- `:86` — `serde_json::from_str(&content).unwrap_or(serde_json::json!({}))`.
  A target client's config (`claude_desktop_config.json` and equivalents) that
  fails to parse for **any** reason — a trailing comma, a half-written file, a
  BOM, a disk hiccup — becomes an empty object.
- `:92-101` — the `personas` entry is inserted into that empty object.
- `:109` — `std::fs::write(&config_path, json)` **overwrites the user's file**
  with the result. Every other MCP server they had registered is gone. No error,
  no prompt, no backup, no `.bak`.
- The correct branch already exists directly beside it: `:87` handles *"the file
  is absent"* with the same `{}` and is right to. Nothing distinguishes absent
  from unreadable.
- This is one of **55 sites** in 42 of 963 `.rs` files where
  `serde_json::from_str` is followed immediately by `.unwrap_or_default()` or
  `.unwrap_or(…)`, against 147 that propagate. `brainiac` — same author, 46
  `from_str` sites — has **zero**.

**Why held:** the fix changes whether the installer runs (it must refuse), which
is "anything that changes whether the app starts" adjacent, and it touches a file
outside the app's own data directory. Standing rule: note, do not apply.

**Fix when unheld:** `serde_json::from_str(&content).map_err(|e| …)?` and report
*"your MCP config at `<path>` is not valid JSON; fix it or move it aside"*.
Write to a temp file and rename, so a crash mid-write cannot truncate it either.

Detail: [`raw-json-editor.md`](./golden-paths/raw-json-editor.md) §7 D1, §9.

---

## 112. The trigger test panel tells the user their invalid payload "will be sent as a raw string". It is not sent at all — in 14 languages

**Where:** `src/i18n/locales/en.json` → `triggers.test_payload_invalid_json`,
rendered at `src/features/triggers/sub_test/TestTab.tsx:328`.

**What is measured** (2026-08-17):

- The string reads *"Payload is not valid JSON — it will be sent as a raw
  string."*
- `TestTab.tsx:196-201`: `isInvalidJson` is computed from `JSON.parse(payload)`
  and folded into `canFire = !!activeEventType && hasPersona && !isTesting &&
  !isInvalidJson`. `:335` — `disabled={!canFire}`.
- `:203-208` adds a second refusal in the handler, with a comment naming the
  incident it prevents (*"users saw a green 'event published' with empty input"*).
- So the payload is refused twice and never sent. **The copy describes the
  behaviour the comment says was removed.** It is present and wrong in all 13
  non-English locales too (the catalogs are at 0 gaps).

**Why held:** correcting one `en.json` key requires the full
`translate-extract` → per-locale subagent → `translate-merge` pipeline to keep
`npm run check:i18n:strict` green, and it changes what a live surface shows while
the operator is using the app. Standing rule.

**Fix when unheld:** replace with *"Payload is not valid JSON — fix it before
firing."* (`t.agents.tool_runner.invalid_json` already says exactly this for the
same condition on a sibling surface, so the wording is settled), then run the
translation pipeline for the one key.

Detail: [`raw-json-editor.md`](./golden-paths/raw-json-editor.md) §7 D7, §5 G.

---

## 113. An installer is downloaded with no digest and no length check, then executed — once with `sudo`

**Where:** `src-tauri/src/commands/infrastructure/setup.rs:256-315` (`download_file`),
consumed at `:458-495` (Windows) and `:583-621` (macOS); version resolved at `:322-350`.

**What is measured** (2026-08-17):

- `download_file` streams the body to `%TEMP%\personas-setup\<filename>` with **no
  staging name and no rename**, and returns the path.
- `total_size` is read from `response.content_length()` (`:277`) and used **only** to
  compute a progress percentage (`:301`). It is never compared against `downloaded`.
- **No sha256, no signature, no content-type check.** `grep -niE
  'sha256|checksum|digest' src-tauri/src/commands/infrastructure/setup.rs` returns
  nothing.
- The returned path is then executed: `msiexec /i <msi_path> /qn /norestart` (`:487-495`)
  and `sudo installer -pkg <pkg_path> -target /` (`:614-621`).
- The URL is not a fixed constant — the version comes from a runtime fetch of
  `https://nodejs.org/dist/index.json` (`:322-350`), so the filename varies per run.
- nodejs.org publishes `SHASUMS256.txt` beside every release. Nothing fetches it.

A connection that drops at 90% yields a truncated MSI that is handed to the OS installer.
Transport is HTTPS to `nodejs.org`, and that is the only control in the path.

**Why held:** adding a verification step that can fail changes whether the operator's
setup flow succeeds. Standing rule.

Detail: [`local-model-install.md`](./golden-paths/local-model-install.md) §7.A.

---

## 114. Athena's two "exclusive" audio channels overlap, and the clip left speaking is the stale one

**Where:** `src/features/plugins/companion/chat/athenaChatAudio.ts:62-119`;
`src/features/plugins/companion/voicePlayback.ts:41-78`;
`src/features/plugins/companion/chat/athenaChatVoice.ts:126-141`.

**What is measured** (2026-08-17): both channel implementations were transcribed verbatim
into a Node harness with instrumented fakes for `HTMLAudioElement` and
`URL.createObjectURL`, and executed:

| scenario | max concurrent clips | live at end |
|---|---:|---|
| A finishes, then B requested | 1 | — |
| **two `playMain` inside the synthesis window** | **2** | **2** |
| **two `playProgress` inside the synthesis window** | **2** | **2** |
| progress in flight, reply lands (`pendingPlayback` set) | 0 | 0 |
| **unmount during synthesis** | 1 | **1** |

- Exclusivity is enforced by pausing an `HTMLAudioElement` held in a ref. **The element
  does not exist during synthesis**, so `stopMain()`, `stopProgress()` and the unmount
  cleanup (`:116-119`) are all no-ops against an in-flight request.
- Ordering inverts: the **later** request resolves first and plays; the **earlier** one
  then starts on top of it. Because the finally-guard is
  `if (mainUrlRef.current !== url) return;`, the element still making sound is the one
  whose blob URL is never revoked and whose handle nothing holds.
- **1 of 4 continuations in the file re-checks after its await** — `playProgress`'s
  `pendingPlayback` test (`:70`), which is why the cross-channel scenario passes.
- `athenaChatVoice.ts:126-140` dispatches `playProgress(beat)` in a `for` loop with **no
  await**, so two `PROGRESS:` lines in one streaming tick always land in the same window.
- The file's own header states the opposite: *"Two exclusive audio channels, so Athena
  can never talk over herself."*

**The correct implementation is already in this repo**, calling the same two functions:
`src/features/onboarding/components/useTourNarration.ts` takes a monotonic token
(`:96`), re-checks it before constructing the element (`:101`), and bumps it in all three
teardown paths (`:153`, `:166`, `:174`). Driven through the identical harness and the
identical five scenarios: **0 overlaps, 0 teardown scenarios leaving audio live.**

**Why held:** changes when and whether Athena speaks, on a surface in daily use.

Detail: [`voice-input-and-playback.md`](./golden-paths/voice-input-and-playback.md) §0, §7.A-7.B.

---

## 115. Three of four microphone surfaces discard the permission error, and the two most-used ones erase it

**Where:** `src/features/plugins/companion/useHoldToTalk.ts` (whole file);
`orb/AthenaOrbLayer.tsx:49`; `CompanionFooterIcon.tsx:123`; `orb/OrbQuickInputBar.tsx:42`;
`Composer.tsx:322-350`; `useDictation.ts:115-117, :145-149`;
`useLocalDictation.ts:217-224, :284-290`.

**What is measured** (2026-08-17): four surfaces can arm the microphone.

| surface | hook | renders `error`? |
|---|---|---|
| `Composer.tsx` (panel composer mic) | `useSpeechInput` | **yes** — amber tint + `title={t.plugins.companion.dictate_error}` |
| `orb/OrbQuickInputBar.tsx` | `useSpeechInput` | no |
| `orb/AthenaOrbLayer.tsx` (floating orb) | `useHoldToTalk` | **cannot** |
| `CompanionFooterIcon.tsx` (footer mic) | `useHoldToTalk` | **cannot** |

- The string `error` appears **0 times** in `useHoldToTalk.ts`; the `HoldToTalk` interface
  has no such member, so its two consumers cannot reach the field.
- `useHoldToTalk.stop()` (`:65-73`) takes its `else` branch precisely when the mic never
  went live — the permission-denied case — and calls `dictation.reset()`, which sets
  `error` to `null` in both engines (`useDictation.ts:148`, `useLocalDictation.ts:289`).
  **The orb path does not merely fail to show the error; it clears it.**
- Sentry reach splits by engine, and the **default** engine is the worse half:
  `useLocalDictation` calls `silentCatch('useLocalDictation.start.getUserMedia')` (`:218`);
  `useDictation`'s `r.onerror` (`:115-117`) calls only `setError`, so a browser-engine
  `not-allowed` reaches **no error door at all**.

User-visible result: press and hold the orb, deny the microphone, and nothing happens,
nothing is said, and nothing is recorded anywhere.

**Why held:** rendering an error changes a live surface. **The safe half is applicable
separately** — widening `HoldToTalk` to expose `error` is additive and type-only, and
would let a later change render it without touching behaviour.

Detail: [`voice-input-and-playback.md`](./golden-paths/voice-input-and-playback.md) §7.C.

---

## 116. The whisper installer pins a `win-x64` asset, on a host whose compiler reports `aarch64`

**Where:** `src-tauri/src/companion/stt/installer.rs:33-51`, `:66`;
contrast `src-tauri/src/companion/tts/sherpa_engine.rs:204-214`, `:269-283`.

**What is measured** (2026-08-17):

- `stt/installer.rs`'s `ENGINE_ARCHIVE_URL` is the literal
  `…/v1.9.2/whisper-bin-x64.zip`, gated only on `cfg!(target_os = "windows")`.
- Its own header comment says it mirrors the Kokoro installer *"exactly … the pinned
  asset below is a win-x64 build"* — **and that is no longer true of the Kokoro
  installer.** `sherpa_engine.rs:211-214` selects `win-arm64` or `win-x64` from
  `cfg(target_arch)`, with a unit test (`:269-283`) asserting the URL matches the
  compiled target and a comment stating that the shell's `PROCESSOR_ARCHITECTURE` is
  untrustworthy under emulation.
- On this machine both halves of that comment are demonstrable: `rustc -vV` reports host
  **`aarch64-pc-windows-msvc`**, while the shell reports
  **`PROCESSOR_ARCHITECTURE=AMD64`**.
- `~/.personas/companion-stt` does not exist here, so the button has never been clicked
  on this host.

So "Install Whisper" on an arm64 build fetches an x64 binary, which runs under emulation
without any surface saying so. Same defect class as the ORT case in
[`bundling-native-assets.md`](./golden-paths/bundling-native-assets.md) — *a vendored
artifact's declared architecture is a claim, not a fact* — except here the claim is the
app's own and it is simply wrong.

**Why held:** changes what an install button downloads.

Detail: [`local-model-install.md`](./golden-paths/local-model-install.md) §7.C.

---

## 117. A failed install leaves an engine that every readiness check calls installed

**Where:** `src-tauri/src/companion/tts/sherpa_engine.rs:128-202` (`extract_selected`),
`:222-262` (`extract_engine`); `src-tauri/src/companion/stt/installer.rs:166-214`;
readiness predicates at `tts/kokoro.rs:81-95`, `:135-140`, `tts/pocket.rs:104-107`,
`stt/downloader.rs:78`.

**What is measured** (2026-08-17):

- All three extractors unpack **entry by entry directly into the live bin/model
  directory**. There is no staging directory and no directory swap.
- Each has a sentinel check (`found_exe` / `found_sentinel` / `extracted == 0`) that runs
  **after** the loop. An archive whose exe unpacks first and whose DLL fails midway
  returns `Err`, the UI shows `Failed`, and the exe is on disk.
- **Every readiness predicate in the stack is existence, never validity**:
  `candidate.is_file()`, `p.model.is_file() && p.voices.is_file() && p.tokens.is_file() &&
  p.espeak_data.is_dir()`, `MODEL_FILES.iter().all(|f| dir.join(f).is_file())`,
  `model_path(id).map(|p| p.is_file())`. Not one reads a byte. A 325,630,829-byte
  `model.onnx` and a zero-byte `model.onnx` produce the same answer.
- The installers' own post-install verification (*"never report success on a
  half-extracted tree"*, `kokoro_installer.rs:150-161`) calls these same predicates — so
  it verifies that extraction created paths, which is what extraction does.
- Related, same file, different mechanism: `stt/downloader.rs`'s truncation guard is
  `if let Some(expected) = total { … }` (`:206-212`), so it is **skipped whenever the
  response is chunked and carries no `Content-Length`** — the exact case the comment
  above it (`:201-205`) says it exists to prevent.

**The repo already contains the right shape**, applied to the one artifact it does not
download: `tts/pocket.rs::import_voice` (`:133-161`) caps the size, **verifies the format
claim by reading the bytes** (`&wav_bytes[0..4] != b"RIFF" || &wav_bytes[8..12] != b"WAVE"`),
then writes `.partial` and renames.

**Why held:** stage-then-swap changes the install flow, and making readiness mean
"verified" changes whether an already-installed engine is reported available at next
launch.

Detail: [`local-model-install.md`](./golden-paths/local-model-install.md) §7.B, §7.D, §7.G.

---

## 118. The transport engine's one rule is broken by its largest consumer

**Where:** `src/features/plugins/artist/sub_media_studio/CompositionPreview.tsx:58-59`;
contract at `hooks/useTimelinePlayback.ts:3-12`; compliant siblings at
`BeatSidebar.tsx:39-45`, `PlaybackControls.tsx:41`, `TimelinePanel.tsx:208`.

**What is measured** (2026-08-17): `useTimelinePlayback` keeps the 60 Hz clock in a ref
and fans out via `subscribe(cb)` precisely so consumers do not put it in React state. Its
docstring: *"storing it in state would trigger a full re-render on every rAF tick (≈60/s),
which made the original media studio unusably laggy … Each consumer then decides whether
to touch the DOM directly … or call a local `setState` scoped just to itself."*

Four subscribers. Three comply. The fourth is
`useEffect(() => engine.subscribe(setCurrentTime), [engine])` — **the raw clock piped
into component state, in the one component that renders the `<video>`, every `<audio>`,
the image-overlay map and the text-overlay map.** Eight `useMemo`s derive from it
(`:92`, `:99`, `:106`, `:112`, `:249`, `:309`, `:317`, `:354`). The engine exists to
prevent this line, and its largest consumer is the line.

**Why held:** the fix is a real refactor of a live surface (split the timecode readout
into its own subscriber; drive `<video>.currentTime` and opacity imperatively — `:164-168`
already writes `style.opacity` that way and shows the shape), not a one-line change.

**A type would close it permanently:** add
`subscribeDerived<T>(select: (t: number) => T, cb: (v: T) => void)`, which calls back only
on a change of the selected value. `engine.subscribe(setCurrentTime)` then becomes
unspellable without writing an identity selector, which is visible in review in a way the
current call is not.

Detail: [`media-viewer.md`](./golden-paths/media-viewer.md) §7.C, §9.

---

## 119. The undo has 229 before-images on disk and no command that can address one of them

**Where:** `src-tauri/db/src/journal.rs:27-29` (the nullable stamp),
`src-tauri/db/src/repos/execution/change_journal.rs:216`, `:261` (both readers,
`WHERE execution_id = ?1`), `src-tauri/src/commands/execution/journal.rs:37`
(`undo_execution(execution_id)` — the only write door),
`src-tauri/db/src/attribution.rs:44-52`.

**What is measured** (2026-08-17, both the purge backup and the live file):

- `change_journal` holds **228 rows pre-purge / 229 post-purge**. Rows with
  `execution_id IS NOT NULL`: **0 in both**. `COUNT(DISTINCT execution_id)`:
  **0**. Rows ever marked `undone` or `conflict`: **0**.
- Every read and the single write filter on `execution_id = ?1`, so a row whose
  stamp is NULL is unreachable from the entire IPC surface. The app is paying
  the capture cost and the 14-day retention cost for a ledger with no reader.
- The design *intends* to capture user writes — `RETENTION_DAYS_UNATTRIBUTED`
  exists specifically to keep them (`journal.rs:279-280`) and `is_foreign_write`
  models them as first-class (`change_journal.rs:125-127`). Capture and conflict
  detection both know about user writes; only the addressing does not.
- Not a regression: the Reversible Agent shipped **2026-07-30** (`048fa452f`)
  and the last execution on this install ran **2026-06-26**, so
  `attribution::with_execution` (`engine/mod.rs:366`, the only production
  setter) has never wrapped a run here. `ThreadAttributionGuard` has **0**
  production callers across 963 `.rs` files.

**The fix:** close the key rather than requiring it — replace
`execution_id: Option<String>` with a `WriteScope` enum
(`Execution(id) | UserAction(id) | System(&'static str) | Foreign`), and land it
**together** with a door keyed on the scope (`undo_scope(scope)`, and
`get_execution_data_diff` generalised the same way). Half of this change is
worse than none: a scope enum behind an execution-only door is the `<Numeric>`
mistake — routing callers to a primitive that is still wrong by default.

**Why held:** it changes the shape of a persisted column and adds an IPC
command. Standing rule.

Detail: [`undo-persisted-operation.md`](./golden-paths/undo-persisted-operation.md) §0, §7 D1, §9.

---

## 120. The reversibility ledger can silently become incomplete and nothing ever checks

**Where:** `src-tauri/db/src/journal.rs:81-104` (`JOURNAL_DROPPED`,
`note_journal_drop`, `journal_dropped_count`), `:287-318`
(`spawn_journal_writer`), `:422-437` (`prune_journal`).

**What is measured** (2026-08-17):

- `journal_dropped_count()` is a `pub fn` with **zero callers** outside its own
  module — no command, no metric, no health panel. The counter's own warn text
  calls a drop *"a permanent gap in the reversibility ledger for that row"*, and
  the only place that sentence can appear is a log file.
- The undo receipt (`UndoExecutionResult`) reports `undone`, `conflicts` and
  `skipped_already_processed` — and cannot report `never_captured`, because the
  count lives in a static the repo layer cannot see.
- A boot-time precondition assertion after `prune_journal` — *"if
  `COUNT(*) FROM change_journal` > 0 then the count of addressable rows must be
  > 0, else `tracing::error!`"* — would have fired every day since 2026-07-30
  and costs one query per launch. It also fails loudly when its own
  precondition (a non-empty journal) is absent, which is the property §9 of the
  contract requires and a census ratchet cannot provide here (the number it
  would ratchet is already 0).

**Why held:** it adds an error-level log at boot, which changes runtime
behaviour. Standing rule.

Detail: [`undo-persisted-operation.md`](./golden-paths/undo-persisted-operation.md) §7 D7, §9.

---

## 121. The incidents inbox stores the failure mode and cannot group by it

**Where:** `src/features/overview/sub_incidents/libs/groupIncidents.ts:5`
(`IncidentGroupMode = 'agent' | 'severity' | 'source' | 'none'`), `:43-55`
(`bucketFor`), `:57-63` (the docstring),
`src/features/overview/sub_incidents/components/IncidentsInbox.tsx:75-81`
(`groupModeLabel`), `src-tauri/db/src/migrations/incremental.rs:2686-2689` (the
indexes).

**What is measured** (2026-08-17, purge backup):

- `audit_incidents.kind` is populated on **164 of 164** rows with **8 distinct
  values**: `blocked_dependency` 66, `external` 56, `review_blocker` 20,
  `team_member_failing` 11, `config` 7, `ambiguous_requirement` 2,
  `missing_credential` 1, `fleet_stall` 1. Among the **99 open** rows it is the
  most discriminating column (35 / 30 / 20 / 7 / 6 / 1).
- It is offered as **no** grouping lens. The docstring claims `source` answers
  *"what kind of thing is failing?"* — but `source_table` names the **producer**
  (`execution_error`, `persona_blocker`, `team_assignments`, `circuit_breaker`,
  `fleet`, `review_dispatch`), not the failure.
- The spine's own words for this leaf are *"clustering terminally failed events
  by failure mode"*. The missing lens is the only one that does that.
- There is **no index on `kind`** — `idx_ai_status`, `idx_ai_persona`,
  `idx_ai_severity` and `idx_ai_source` exist. The schema records the same
  omission the UI does.

**The fix:** four lines plus a key — `'kind'` in the union, a `case 'kind'` arm
in `bucketFor`, a label resolver, an `en.json` token (then the 13-locale
pipeline). Optionally an index on `(kind, status)`.

**Why held:** it changes what a live surface shows while the operator is using
it. Standing rule.

Detail: [`dead-letter-triage.md`](./golden-paths/dead-letter-triage.md) §7 D5, §8.4.

---

## 122. Seven promotion doors are behind an env var set nowhere, and 77 qualifying failures never reached a human

**Where:** `src-tauri/db/src/audit_incidents_promoter.rs:40-45` (`PROMOTION_ENV`
+ `fn enabled()`), and the seven promoters at `:75`, `:104`, `:144`, `:179`,
`:212`, `:248`, `:282`.

**What is measured** (2026-08-17, purge backup):

- `PERSONAS_INCIDENTS_PROMOTION` appears in **21** places in the tree — one
  `pub const`, one comparison, seven "No-op unless…" comments on the calling
  repos, four golden paths, a `DESIGN.md`, and a 2026-06-09 audit that already
  reported this. **Zero** of the 21 set it.
- Replaying each promoter's own predicate against its own source table:
  `persona_healing_issues` **72**, `policy_events` **5**, `credential_audit_log`
  **0 of 9,830**, `healing_audit_log` **0 of 27**, `provider_audit_log` **0 of
  4,001**, `fired_alerts` 0, `tool_execution_audit_log` 0 — **77 qualifying
  rows**, and `SELECT COUNT(*) FROM audit_incidents WHERE source_table IN (<the
  seven>)` = **0**.
- Two of the predicates cannot match *even if the gate opens*:
  `promote_credential_audit` searches `operation` for `failure|error|denied`,
  and the entire live vocabulary is `decrypt` (9,458),
  `oauth_token_refreshed` (201), `healthcheck` (145), `delete`, `create`,
  `oauth_completed`, `oauth_initiated`, `update`, `field_update`,
  `credential_oauth_refreshed` — **none containing any of the three words**.
  `promote_healing_audit` requires `ends_with("_error")`; the one genuine
  failure row is `ai_heal_parse_failed`.
- All 164 existing incidents came in through the **eight** direct
  `audit_incidents::promote` call sites in `src-tauri/src/**`, which are not
  gated. Three of those eight discard the promotion's own result with
  `let _ =` (`engine/mod.rs:3257`, `commands/design/reviews.rs:1415`,
  `companion/athena_reaction.rs:1306`) — including the circuit-breaker site,
  whose incident **is** the mitigation for not disabling a failing team member.

**The fix, in order:** (1) fix the two predicates to match on the producer's
vocabulary — this is correct whether or not the gate ever opens; (2) replace the
env gate with a persisted app setting so admission is inspectable; (3) route the
three `let _ =` sites through `try_promote`, which already swallows correctly
while keeping the warn. A boot-time assertion — per promoter, *"qualifying rows
> 0 and incidents from that source = 0"* → `tracing::error!` — would have fired
on two sources every day since the module shipped.

**Why held:** flipping admission on would create incident rows on a live
surface, and 77 new items would land in a queue that already has 99 undrained.
Standing rule.

Detail: [`dead-letter-triage.md`](./golden-paths/dead-letter-triage.md) §0, §7 D1, D3, D7, §9.

---

## 123. A function named `prune` empties the whole table when its input list is empty

**Where:** `src-tauri/db/src/repos/resources/cloud_webhook_watermarks.rs:48-58`.

**What is measured** (2026-08-17):

```rust
/// Remove watermarks for triggers that no longer exist.
/// Keeps only rows whose trigger_id is in the `active_ids` set.
pub fn prune(pool: &DbPool, active_ids: &[&str]) -> Result<(), AppError> {
    …
    if active_ids.is_empty() {
        let conn = pool.get()?;
        conn.execute("DELETE FROM cloud_webhook_watermarks", [])?;
        return Ok(());
    }
```

- The empty-set branch is defensible in the intended case (no active triggers ⇒
  no watermarks) and wrong in the case that occurs on a bad day: the caller's
  enumeration of active triggers **failing and resolving to empty**, which this
  function reads as *"delete everything"*. That is
  [`partial-failure-read-envelope`](./golden-paths/partial-failure-read-envelope.md)'s
  finding — a failed read degrading to an empty value — arriving at a
  destructive door.
- It is one of **3 of 5** whole-table wipes in `src-tauri/db/src/repos/**` that
  return `Result<()>` and therefore discard the affected-row count SQLite
  already handed them (the others: `alert_rules::clear_fired_alerts:305`,
  `frontend_crashes::clear_all:91`). The compliant two —
  `manual_reviews::delete_all:243` and `messages::delete_all:501` — return
  `Result<usize>`. This split is the baseline of the published census rule
  `countless-table-wipe` (3 files / 3 matches, hand-verified 3/3).

**The fix:** make the empty-input case an explicit refusal
(`return Err(AppError::Validation("prune called with an empty active set"))`)
or require the caller to opt in (`prune(pool, active_ids, allow_empty: bool)`),
and return `Result<usize>` from all three so the count survives.

**Why held:** it changes what a live function does — a call that currently
succeeds would start failing. Standing rule.

Detail: [`maintenance-affordances.md`](./golden-paths/maintenance-affordances.md) §7 D2, D3, §9.

---

## 124. The one arm the failure translator most needs is gated on a phrase the engine never emits

**Where:** `src/features/vault/sub_catalog/components/design/CredentialDesignHelpers.ts:267`
against `src-tauri/src/engine/healthcheck.rs:1156`.

**What is measured** (2026-08-17): `translateHealthcheckMessage` opens its network family
with `if (raw.includes('request failed:'))` and nests four arms inside it — timeout, DNS,
connection-refused, unreachable — each with a `friendly` line and a `suggestion`. The real
probe emits `"Connection failed: {e}"`. **The only producer of `request failed:` reaching
this translator in 963 Rust files is `credential_design.rs:284`, the LLM design door.**

Producer inventory, hand-verified over every `HealthcheckResult::` call site above the
first `#[cfg(test)]` (`healthcheck.rs:1495`): **13 sites; exactly one** — `:1143`, via
`let msg = format!("Service returned HTTP {}", …)` at `:1142` — reaches a diagnostic arm.
The other twelve land on the fallback, which returns `{ friendly: raw, suggestion: '' }`;
because `friendly === raw`, `HealthcheckResultDisplay.tsx:10` then computes
`hasDifferentRaw = false` and suppresses the *"Technical details"* disclosure as well. A
DNS failure, a TLS failure, a timeout and an SSRF-policy rejection all render as one raw
`reqwest` sentence with no suggestion and no disclosure.

The sharpest instance: `healthcheck.rs:308` produces
`"{tool} timed out — the tool may be unresponsive"` and the translator has a **timeout**
arm. They cannot meet.

**Why held:** the one-line form (adding `Connection failed:` to the gate) changes what a
live surface shows on every connection failure, and the honest fix is a typed `step`/`code`
on the IPC payload rather than a second string to classify — a cross-language contract
change, not an edit. Registering rather than applying, per the standing no-destructive-apply
rule.

**No gate is possible in the census**, which evaluates one pattern per file and cannot
compare a TS literal against the Rust corpus. The instrument that would work is shaped
like `scripts/check-csp-hosts.mjs`: collect every `includes(`/`startsWith(` literal inside
the message-classifier functions, grep the Rust tree for each, **exit 2 if it finds no
classifier literals at all**, exit 1 on any literal with zero producers. Today it reports
five (`request failed:`, `timed out`, `timeout`, `dns`, `connection refused`).

Detail: [`connector-setup-panel.md`](./golden-paths/connector-setup-panel.md) §7.2, §9.2.

---

## 125. An unverifiable credential is certified with a green check on the surface that certifies it

**Where:** `src-tauri/src/engine/healthcheck.rs:26-28` and `:79-85`;
`src/features/vault/sub_credentials/components/forms/HealthcheckResultDisplay.tsx:6,:13`;
nine prop declarations listed in the detail link.

**What is measured** (2026-08-17, live database — credentials were **not** touched by the
purge): `HealthProbeState` is `Verified | Unverifiable | Failed`, required on the wire
type (`src/lib/bindings/HealthcheckResult.ts:5`). Its own doc comment promises
*"this is NOT a failure — it renders neutral/muted, never a green 'healthy' check."*
`HealthcheckResult::unverifiable` constructs `success: true`. Nine prop slots along the
setup path re-declare the verdict as an inline `{ success: boolean; message: string } | null`
— structurally compatible, so nothing errors — and the terminal renderer branches on the
boolean, returning a green `CheckCircle`.

**8 of 25 live credentials are `unverifiable`. 21 of 134 connectors have no
`healthcheck_config` and can produce nothing else.** The promise is kept in
`ConnectorStatusCard.tsx:26-34` (a neutral `ShieldQuestion`) and broken in the panel where
the credential is created.

**Two further states are unrepresentable at any layer.** Two live credentials
(`google_calendar`, `gmail`) carry `needs_reauth: true` with grants expired **99** and
**76** days ago; `HealthProbeState` has no `expired`/`revoked` variant, so both render as
a generic red box — in the one surface that owns an Authorize button.

**Why held:** it changes what a live surface shows for a third of the operator's vault,
and the correct fix is a discriminated union replacing the boolean pair
(`CliConnectionPanel.tsx:17-24` is the in-repo pattern), not a colour change.

A **ratchet** is shipped meanwhile: census rule `probe-verdict-narrowed-to-boolean`,
baseline 6 files / 9 matches, precision 9/9, zero site overlap with all 195 registered
rules. **Delete the rule when the union lands** — the census cannot express "must be zero".

Detail: [`connector-setup-panel.md`](./golden-paths/connector-setup-panel.md) §7.1, §8/G1, §9.

---

## 126. Three healthchecks pass for any value the user types into the field they gate

**Where:** `connector_definitions` rows `kalshi`, `pubmed`, `semantic_scholar`
(`healthcheck_config` column); gate at
`src/features/vault/sub_catalog/components/forms/CredentialTemplateForm.tsx:188-193`.

**What is measured** (2026-08-17, live `connector_definitions`, 134 rows / 196 declared
fields): of the **113** connectors carrying a `healthcheck_config`, **4** reference no
declared field, no `{{base64(a:b)}}` pair and no auth token in their endpoint, headers or
body. One of the four (`arxiv`) declares no fields at all and is correctly
unauthenticated. The other three declare an `api_key` field their probe never sends.

So *"Test connection"* returns `"Connection successful (HTTP 200)"` for any value,
including a wrong one — and because Save is gated on that success, the green tick is what
lets a credential that will fail at first use into the vault.

**Why held:** editing connector definitions is a data change to rows the app reads at
runtime, and the durable fix is a validation over the **pair** (declared fields,
healthcheck template) in the connector seed test, which no schema constraint can express
and which the census cannot see — both sides are JSON columns in a database, not source
text.

Detail: [`connector-setup-panel.md`](./golden-paths/connector-setup-panel.md) §7.6, §8/G4.

---

## 127. Every app start overwrites nine columns of all 134 built-in connectors, and stamps `updated_at` so the edit leaves no trace

**Where:** `src-tauri/db/src/lib.rs:1826-1831` (`seed_builtin_connectors`' refresh
`UPDATE`), reached from `init_db_with_journal` at `:341-348`. Same shape at `:1864-1873`
for `shared_event_catalog`. The operator's edit door is `update_connector`
(`src/commands/credentials/connectors.rs:42-52`, allow-listed at `ipc_auth.rs:168`), which
carries **no `is_builtin` guard**.

**What is measured** (2026-08-17, purge backup; `connector_definitions` was **not** in the
purge cascade, so these counts are current):

- 134 rows, all `is_builtin = 1`, **1 distinct `updated_at`** — the last app start,
  `2026-08-17T09:24:38.517217+00:00` — against **17 distinct `created_at`**.
- The refresh writes `label, icon_url, fields, healthcheck_config, metadata, category,
  services, events, resources, updated_at` unconditionally. It does **not** write `name`,
  `color`, `is_builtin`, `created_at`.
- `repos/resources/connectors.rs:228-262` lets `update_connector` write `fields`,
  `healthcheck_config`, `services`, `events`, `metadata` — five of the nine.

**Replayed verbatim** against a copy of the operator's own `slack` row, using the seeder's
exact statement and the shipped values read out of `builtin_connectors.rs`:

```text
1. shipped row, as seeded    : Slack        | #4A154B | messaging | [{"key":"bot_token"…
2. after the operator edits  : Slack (work) | #ff0000  | my-tools  | [{"key":"webhook_url"…
3. after the next app start  : Slack        | #ff0000  | messaging | [{"key":"bot_token"…
```

The rename, the recategorisation and the credential-field edit are gone. The **recolour
survives** only because `color` is the one presentation column missing from the
hand-maintained `SET` list — an accident, not a policy. And because `updated_at` is
rewritten by the same statement, nothing afterwards can tell that an edit ever existed.

A second, app-generated writer hits the same wall:
`src/commands/design/n8n_transform/confirmation.rs:540` sets `services` on a connector row
and the next boot reverts it.

**Why held:** this changes what a live surface shows and the current behaviour may be
deliberate for `fields` / `healthcheck_config` (a shipped schema fix must reach existing
installs). The durable fix is two edits, not one: (a) split the row's columns into a
`ShippedFields` struct the seeder is handed, so an operator-owned column is not nameable
from a seed; (b) gate the refresh on a `source_revision` / `definition_hash` written at
seed time, or on a signature of the un-edited row. `src/engine/recipe_seed.rs:189-190` is
the in-repo model for (b) and is the only seeder of seven that protects an edit.

**Adjacent, same file, same held reason:** 16 `is_builtin = 1` recipes and 2
`status = 'active'` shared events sit in their tables and in no shipped catalog — nothing
computes the set difference, and the two catalog retirements that have happened are
hand-written per-id `DELETE`s (`db/src/lib.rs:1799`, `migrations/incremental.rs:5734`).

Detail: [`catalog-row-seeding.md`](./golden-paths/catalog-row-seeding.md) §0.2, §0.3,
§0.4, §7/D1-D5.

---

## <a id="v2-pilot-deviations"></a> Hierarchy-v2 pilot deviations (2026-08-18) — the forge's first evidence-reconciliation pass

The v2 forge (plan §3) writes the standard from expertise first, then reconciles against
the repo; where the repo falls short, **the standard stays and the gap is registered
here**. These eight came out of the two pilot subjects. Each anchor is cited from the
owning document's `deviations:` frontmatter under `docs/concepts/paths/`.

### <a id="table-no-error-state"></a> Table: the primitive has no error state
`UnifiedTable.tsx:598-620` — the body machine is ghost/empty/rows only. A failed fetch
that settles empty renders the settled *empty* state: "no data" asserted when the truth
is "couldn't look". Same in `DataGrid`. Violates `failure-not-empty-success`.
**Why held:** adding an error branch changes what live surfaces render on fetch failure.

### <a id="table-default-sort-comparator"></a> Table: default sort comparator is lexicographic and untotal
`UnifiedTable.tsx:500-515` — default `sortFn` stringifies + `localeCompare`s (numbers and
dates sort wrong), uses `reverse()` for `desc` (inverts tie order of a stable sort), and
appends no identity tiebreaker. **Why held:** changes visible row order app-wide.

### <a id="table-forbidden-split-unguarded"></a> Table: client sort over a server-truncated window, unguarded
`UnifiedTable.tsx:173-175` — sortable columns always sort client-side over `data` while
`onEndReached` invites server windowing; nothing warns when both are active. The sort
result is then a lie about the unfetched remainder. **Why held:** the guard is an API
design decision (controlled sort state), tracked with legacy `tables.md` gap #6.

### <a id="table-recent-slice-tiebreaker"></a> Table: recent-slice query lacks a tiebreaker
`src-tauri/db/src/repos/orchestration/team_assignments.rs:358-364` — `ORDER BY created_at
DESC LIMIT` without `id`. Tolerable only because nothing resumes from its boundary; the
Rust application documents the graduation rule. **Why held:** cosmetic until a consumer
pages from it.

### <a id="scheduling-dup-nonfire-vocab"></a> Scheduling: non-fire reason vocabulary duplicated by hand
`src/features/triggers/lib/eventReason.ts:17-27` hand-syncs (`"Keep in sync with"`)
against `EventGateReason::token` in `src-tauri/src/engine/background.rs:948-989`; ts-rs
is available but unused here. Violates `one-authority-per-vocabulary`. **Why held:**
binding regen + consumer migration is its own change.

### <a id="scheduling-tz-fallback"></a> Scheduling: cron falls back to host-local timezone silently
`src-tauri/core/src/scheduler.rs:123-137` — a rule with no authored timezone means
different things on different machines, logged at debug only. The path prescribes
computing in the rule's own declared frame. **Why held:** changing the fallback shifts
real fire times for existing triggers.

### <a id="scheduling-claims-without-identity"></a> Scheduling: claims record no holder or timestamp
`claim_pending` (admitted at `background.rs:116-122`, `1028-1038`) forces the
two-consecutive-pass reaper heuristic instead of evidence-based reclamation. Violates
the claims-carry-identity rule in `overlap-and-reentrancy`. **Why held:** schema change
on a hot table.

### <a id="scheduling-subscription-health-volatile"></a> Scheduling: subscription health resets on restart
`SubscriptionHealth` (`background.rs:43-70`) is in-memory only — no persisted tick
heartbeat, so global gap detection ("the scheduler itself was dark") does not survive a
restart. **Why held:** new persistence surface.

---

## Hierarchy-v2 forge wave 1 deviations (2026-08-18) — eight subjects reconciled

Same contract as the pilot section above: the forge kept the standard; the repo's
shortfalls are registered here, one anchor per subject, cited from each golden path's
`deviations:` frontmatter. Full per-claim detail lives in the wave-1 composer reports
(session transcript); the entries below are the durable register.

### <a id="w1-modal-stack"></a> modal-stack
Backdrop click not topmost-gated (`BaseModal.tsx:283` vs the `isTopmost` escape gate at `:198-203`) · `portal` boolean fuses detachment with a 9,950-unit z jump (`BaseModal.tsx:8-10`; 3 overlays exist solely to out-paint it) · focus restore unreachable for unmount-close (96/129 sites, `BaseModal.tsx:229-233`) · stack registry entries are position-only (`ModalStackContext.tsx:12-14`) · 25 literal `z-[≥1000]` across 21 files, no shared layer scale · stored-coordinate popover with no recomputation + escape listener bypassing the keyboard ladder (`sub_mastermind/lib/ListPopover.tsx`) · flip decided on assumed constant (`useAnchoredPortalPosition.ts:28`) · generic Confirm/Cancel defaults (`ConfirmDialog.tsx:77,90`).

### <a id="w1-form"></a> form
`FormField` never styles the errored control (no red border anywhere; `hint` absent from described-by) · adoption inversion: 4 FormField adopters vs 19 shadow wrappers + 120 orphan labels/49 files · `FormErrorProvider`/`validateOn` machinery has zero adopters (timing is bimodal: every-keystroke or backend-toast) · ~70 `disabled={!x.trim()}` gates; `FormActions` busy renders null spinner, no in-flight re-entry guard, hardcoded English · `KeyValueEditor.tsx:80-91` positional row identity · `ValidationError {field,rule,message}` flattened to a joined sentence in `contract.rs:37-49`, imported by zero frontend files.

### <a id="w1-async-ui-states"></a> async-ui-states
(All already documented in-repo; cross-referenced, not re-measured.) ~75 null-spinner busy controls · 177 `onClick={() => void fn()}` disarming AsyncButton · `isLoading={false}` ghost suppression citing a stale doctrine section (`EventLogList.tsx:453-478`) · reduced-motion global reset destroys the ghost-invisibility window · no shared failure-state primitive (~20/27 error surfaces render empty on failure; see `table-no-error-state`).

### <a id="w1-search"></a> search
Default FTS rung is unlabeled any-term OR (`executions.rs:190`) · ranking tiebreak ends at second-resolution `created_at`, no identity term (`executions.rs:424-426`) · all-noise input returns empty success (`executions.rs:399-401`) · palette sorts by score only, ties rest on source order (`CommandPalette.tsx:232-235` + 4 sites) · saved-view parse failure leaves the view active with filters unapplied (`useEventLog.ts:364-375`); no update/rename, no dirty marker · chips removed by array index (`useStructuredQuery.ts:145`).

### <a id="w1-streaming-output"></a> streaming-output
Unknown events dropped uncounted (`parser.rs` `_ =>`; 40% of stream lines invisible; "unhandled" = "absent") · size cap mutates then parses (`read_line_within` appends a marker producing invalid frames; 68 tool-results vanished) · invented fixtures encode the belief under test (`parser.rs:1105`, `provider/claude.rs:402`; wire shape observed 0/2,811; 33.2M tokens discarded) · `is_error` never read — 82 failed turns display "Completed" · primary frontend channel is a formatted string, not the typed event · stall signal has a producer and zero consumers (`useActivityMonitor.ts`, 60% of runs cross threshold) · 13 pin-to-tail sites without at-bottom check · `useTauriStream.cancel()` discards partial output · 13/26 line channels broadcast to zero readers.

### <a id="w1-agent-memory"></a> agent-memory
Machine correlator episodes admitted at capture, excluded only at read (`fleet_bridge.rs` writes; `episodic.rs:29-72` filters; reached 57% of episodic memory) · episodic layer has no retention horizon or caps (deliberate no-data-loss guarantee, unbounded growth) · recalled facts carry importance/confidence/sources but not age (`prompt.rs:410-413`).

### <a id="w1-credential-vault"></a> credential-vault
Flat encryption: no envelope, no AAD, no key-id on 5,008 ciphertexts (`core/src/crypto.rs:1302-1314`; rotation unrepresentable, ciphertext-swap undetected) · rotation ledger fire-and-forget: 11 `let _ = record_rotation` sites, 6/11 `rotation_type` values rejected by the CHECK, clock advances regardless (`engine/rotation.rs`) · zero upstream revocation at retirement · provenance written by 1 of 4 admission doors (0/25 live credentials carry it; `foraging.rs:735-744`) · refresh threshold has two disagreeing authorities (`oauth_refresh.rs:171-176` vs `connector_strategy.rs:600-604`) + fabricated fallback expiry (`oauth_refresh.rs:571-582`) · transient unreachability recorded as credential failure, never expires; revoked still resolves Ready · system key in env at 127/129 spawn sites; broker-token temp files permissive; lane reaper created 6 dirs, removed 0.

### <a id="w1-migrations"></a> migrations
42 remaining `let _ = ddl_step(` + 13 `let _ = execute_batch` ALTER swallows (the six-site fix did not extinguish the class) · guard-uncertainty inversion `has_column(...).unwrap_or(true)` = probe failure treated as applied (`incremental.rs:7718`) · backup never verified by opening the copy; restore path prose-only, untested (`backup.rs:8-10`) · rotation ages in boots not migration boundaries (restart storm can rotate away the only good copy) · `personas_data.db` second store has no runner, no guards, no snapshot · no convergence instruments (fresh-vs-migrated diff, chain-runs-twice, query-prepare sweep).

---

## Hierarchy-v2 forge wave 2 deviations (2026-08-18) — eight more subjects reconciled

Same contract as waves above: standards kept, gaps registered, one anchor per subject,
cited from each golden path's `deviations:` frontmatter. Full detail in the wave-2
composer reports (session transcript).

### <a id="w2-data-access"></a> data-access
`QueryBuilder::order_by` identifier allowlist is advisory (doc-comment only, `query_builder.rs:198-204`) · ops-exclusion `NOT LIKE` predicate copy-pasted 3× in `executions.rs` (:298,:348,:420) beside its own drift warning (:1755-1767) · `row_mapper!` opt-kinds silently default missing columns, one to literal `"working"` (`macros.rs:116-127`) · `add_member` INSERT OR IGNORE returns a fresh UUID unconditionally (`mcp_gateways.rs:48`) · `sweep_zombie_executions` fires consequences regardless of CAS verdict (`executions.rs:1767-1804`) · 70 `to_string(..).unwrap_or_default()` write sites launder serialization failure to `''`.

### <a id="w2-ipc-contract"></a> ipc-contract
Two hand-rolled registration parsers, one matching by substring accident (`generate-command-names.mjs:21` vs `check-command-contract.mjs:57`) · timeout adoption backwards: 52 ad-hoc `timeoutMs` overrides vs 3 registry entries (`tauriInvoke.ts:69`) · the orphan-binding inventory gate specified in the legacy corpus is still unbuilt (29 orphans, 22 live invoke return types incl. `VaultStatus`) · `AppError::Validation(String)` collapses the code vocabulary at ~1,436 sites (one catch-all code = 99.2% of resolving sites) · `isIpcAuthFailure` branches on message prose via `includes()` (`tauriInvoke.ts:544`) beside the anchored-regex exemplar in `safeInvoke.ts`.

### <a id="w2-error-handling"></a> error-handling
Substring-ladder classification is the PRIMARY path even for app-minted messages (`error_taxonomy.rs:141-323`; 40/43 Unknown healing issues = one string) · TS classifier ladder hand-mirrored, gated only by byte-identical fixtures (`src/lib/errorTaxonomy.ts`) · two hand-synced user-facing registries (`errorRegistry.ts` ERROR_RULES + `useTranslatedError.ts` ERROR_KEY_MAP), registry stores hardcoded English · silentCatch/toastCatch emit breadcrumbs not events (~10.6% of catches produce Sentry events; 760/2,752 catch bodies reach no door) · crash capture sanitizes by denylist regex, not field allowlist (`crashPersistence.ts`).

### <a id="w2-hitl-approval"></a> hitl-approval
Pipeline approval pending state is in-memory — restart silently loses the question (`pipeline_executor.rs:716-749`) · three expiry policies for holds in one binary: manual reviews 7-day auto-RESOLVE incl. 17 high-severity bypassing the triage denylist (`background.rs:816-836`), team assignments never expire (11 parked 59-68 days), companion approvals never expire · dollar ceilings fail open (`0`/`None` = unlimited) while switches fail closed · `FirstUseConsentModal` re-ask overwrites a stored refusal (`FirstUseConsentModal.tsx:141-151`); telemetry preference read fails open (`telemetryPreference.ts:17`).

### <a id="w2-realtime-events"></a> realtime-events
CDC emits from inside transactions — rolled-back writes can be advertised (`cdc.rs`, no stage-and-release) · six event names minted as literals outside both registries (`cdc.rs::table_to_event`), invisible to `check-event-registry.mjs`; `eventRegistry.ts:5` names the wrong authority file · early-arrival buffer keeps oldest 50, sheds newest (`createSingletonListener.ts:96-99`) · outbound watermark shared across subscriptions (per-subscription cursor named in-code as "the deeper fix", `webhook_notifier.rs:653-724`); breaker strikes in-memory only; no dead-letter for passed-over events · `source_filter` wildcard is unanchored prefix (`bus.rs:308-319`).

### <a id="w2-mcp-tools"></a> mcp-tools
Stdio server has dual catalog authority: hand-built `list_tools` array vs separate dispatch match, no door-level schema validation (`mcp_server/tools.rs:722` vs `:1133`) · unknown tool returned in-band as `isError:true` instead of a protocol error (`tools.rs:1169-1181`) · one omnibus `personas:execute` scope gates all ~34 tools incl. mail/calendar/vault reads · install token has no reaper: no expiry, plaintext in shared config, re-installs accumulate live keys (`install.rs:61-81`) · blocking guidance/approval calls hold HTTP responses up to 10 min instead of the tasks-extension handle+poll shape · no per-request `_meta` version validation (2026-07-28 architecture).

### <a id="w2-retry-backoff"></a> retry-backoff
OAuth refresh ladder durable but unbounded — no attempt cap, no terminal state; live fail-counts 49/21 stopped only by a neighboring staleness filter while `needs_reauth` sits unread (`oauth_refresh.rs:49-53`) · half-open resets `consecutive_failures` to 0 so a failed probe buys 5 fresh full-admission failures (`failover.rs:395-397`) · zero jitter on ~19 backoff schedules in either language · no standard rate-limit-hint extraction outside the usage-limit parse · `automation_runner.rs` retryable set omits 429 · unbounded exponent `1 << consecutive_failures` (debug panic / release ladder-reset at 64; `healing.rs:330,:555`) · ~30 of 98 `retry_of_execution_id` rows point at completed parents.

### <a id="w2-background-jobs"></a> background-jobs
Roster escapes: curation scheduler + persona-jobs worker + webhook notifier run as raw spawned sleep-loops outside the unified supervisor — no panic barrier, no health row, survive `stop_loops` (`lib.rs:1434-1462`) · leadership split-brain: `heartbeat()` overwrites the lease without owner re-read, both gates fail open, `release()` has zero call sites (~90s follower blind spot; legacy loop-ownership D1/D3) · no per-tick deadline anywhere — a hung tick permanently silences its loop and nothing evaluates `last_tick_at` staleness · six pre-election boot sweeps carry no owner term (`lib.rs:815-909`) · client cancel collapses cancelling→cancelled before runner confirms (`useMediaExport.ts:144-153`) · health outcome vocabulary is success/panic only.

---

## Hierarchy-v2 forge wave 3 deviations (2026-08-18) — eight more subjects reconciled

Same contract: standards kept, gaps registered, one anchor per subject, cited from
frontmatter. Full detail in the wave-3 composer reports (session transcript).

### <a id="w3-app-shell"></a> app-shell
Nav registry governs 11 of ~156 destinations (~7%); the ~23 L2 tab unions have no registry/validation · `setSidebarSection` accepts never-valid ids from three arrival surfaces, persisted and replayed to `TypeError` · tier revocation silently evicts to home (`Sidebar.tsx:114-119`) · gating is uniformly hidden — no locked/upsell state was ever decided · second badge authority outside the attention registry (`useBadgeCounts.ts:36-51`) · all global overlays share one error boundary (`App.tsx:363`) · `personas://` scheme cannot name a destination.

### <a id="w3-authorization"></a> authorization
**⚠ SECURITY-RELEVANT, flag for human review:** unlisted/unannotated commands fall through to the Public tier (`ipc_auth.rs:835-843`) — no totality rule · `require_privileged` on async paths verifies boot then `Ok(())`; thread-local proof cleared before the async body runs (audit-only, per the file's own test comment `:1055-1064`) · `require_auth`/`require_auth_sync` are unconditional `Ok(())` — `#[requires(auth)]` reads as a guard and guards nothing · scope enforcement defaults to Warn indefinitely per credential (`scope_enforcement.rs:41-46`) · WebView2 header-race tier downgrades are standing classifications, not dated exceptions · `#[requires]` + `PRIVILEGED_COMMANDS` are two hand-reconciled artifacts.

### <a id="w3-design-tokens"></a> design-tokens
Derived custom themes bypass the contrast gate — "Low" themes save with an advisory badge; derived dark muted/bg measures 3.07-3.73:1 vs the 4.5:1 built-in floor (`CustomThemeCreator.tsx:243-254`) · all raw-value bans are warn-level = enforce nothing by construction · `MOTION` JS ↔ `--duration-*` CSS is a comment-only mirror (adoption 14 vs 196 raw) · brightness axis is a whole-document pixel filter that pushes light `muted-foreground@80` below AA while `check-themes.mjs` reads pre-filter declarations · `designTokens.ts:104` violates its own standard (`rounded-xl` vs `rounded-input`), shielded by path exemptions · severity-accent vocabulary duplicated 3×.

### <a id="w3-client-state"></a> client-state
sceneStore whole-family loads carry no latest-wins token though `latestWins.ts` exists · 6 of 7 persisted stores lack `version`+`migrate` (hand-rolled in merge/rehydrate) · 6 of 8 `globalThis` owners lack test-reset hatches · persist envelope hand-parsed pre-mount (`main.tsx:93/:151/:163`) · storage-key namespace fragmented: 89 module-local constants, 8 prefix conventions, no registry.

### <a id="w3-i18n"></a> i18n
Plural selection is caller-side `count === 1` at hundreds of sites (457 plural-suffix keys) — locales with 3-6 plural categories cannot be expressed, Russian-style rules wrong by construction · `tokenLabel` unknown-token path is dev-only; raw token renders silently in production (`tokenMaps.ts:40-50`) · `no-hardcoded-jsx-text` warn-level (226 standing) · no systematic domain-vs-catalog gate (the live ai-compose 6-vs-5 gap sits behind green parity boards) · `check-coverage.mjs` header still states the retired async-catch-up posture.

### <a id="w3-data-viz"></a> data-viz
`resolveMetricPercent` returns 0 for missing denominator/non-finite — "never measured" renders as "0%" (`metricIdentity.ts:48-58`) · kpiMath.ts ↔ kpi_derivation.rs and DimensionRadial ↔ score_design_result are comment-coupled mirrors with zero shared fixtures · sample-anchored sparkline scales at 32 call sites (`KpiTile.tsx:104`), with two same-named `sparklinePoints()` exports carrying opposite doctrine · hardcoded hex outside tokens (`ConfidenceArc.tsx:47-61`); `ChartEmptyState` has 0 render call sites · series stroke keyed on status makes legend swatches identical (`KPIDashboard.tsx:339`) · two exported `LazyChart` components with different jobs · no chart carries a text equivalent.

### <a id="w3-wizard-flows"></a> wizard-flows
Shared `WizardStepper` is two-state, non-interactive, and has zero live render paths (both call sites in the never-imported `CreateTemplateModal`) · `ScrapeEditorWizard.tsx:42,:88` rail/next unguarded — saved only by the modal's terminal re-check · training interview state fully ephemeral; unanswered generated questions die with the surface · corrupt persisted context removed silently (`usePersistedContext.ts:74-77`) · `n8n_transform_sessions` has no reaper; `sweep_stale_drafts` default-off · questionnaire/training keyed by array index while entities carry minted ids.

### <a id="w3-toasts-notifications"></a> toasts-notifications
No persistence tier — every toast auto-dismisses; action-required messages evaporate (`toastStore.ts:131`) · toast and notification ledger are disjoint populations with no shared identity — no toast has a durable twin · double live-region announcement (container aria-live + store announceImperative), error toasts announce raw copy then display friendly copy · hover-only timer pause — keyboard focus doesn't hold a toast (`useToastTimer.ts:68-76`) · OS tier is an unconditional focus-blind mirror with five delivery doors and 52/57 hardcoded-English strings (`notifications.rs:1543`) · second forked toast stack (`AlertToastContainer.tsx`: own vocabulary, fixed dwell, silent drop past 5, no live region) · no coalescing; ledger retention cap-only.

---

## Hierarchy-v2 forge wave 4 deviations (2026-08-18) — eight more subjects reconciled

Same contract: standards kept, gaps registered, one anchor per subject, cited from
frontmatter. Full detail in the wave-4 composer reports (session transcript).

### <a id="w4-voice-io"></a> voice-io
Dual "exclusive" audio channels overlap across the synthesis gap; stale clip wins, unstoppable (`athenaChatAudio.ts:62-119`; = legacy fix #114) · playback primitive hands callers the raw media element, 1 of 2 callers disciplined (`voicePlayback.ts:41-78`) · mic-denial error erased one layer up, 1 of 4 mic surfaces shows it (`useHoldToTalk.ts:64-73`; = #115) · no capture-side level meter anywhere (only playback is metered) · default STT engine is cloud-routed; disclosure lives in a docstring not beside the picker (`useSpeechInput.ts:8-18`) · tour narration cache keyed by step-id only + object URLs never revoked (`useTourNarration.ts:84,121-137`) · read-aloud renders null when unconfigured.

### <a id="w4-subprocess-lifecycle"></a> subprocess-lifecycle
Child env is inherit-then-strip, not allowlist — the denylist stays one variable behind (billing-leak history; `cli_process.rs` env_removals + `cli_args.rs`) · no spawn-time identity marker: orphan detection is name/cmdline heuristic, PIDs essentially never persisted (`build_sessions.cli_pid` 0 non-null) · `run_claude_cli` discards exit status (`let _ = child.wait()`, `cli_process.rs:479-491`); empty stdout and read failure collapse into one error · `spawn_cwd` inherits ambient working directory (`cli_process.rs:551-561`) · three cap layers count three different populations, no reconciliation.

### <a id="w4-fleet-orchestration"></a> fleet-orchestration
Slot cap is a default-off eviction hint — no Fleet spawn is ever refused or queued (`stale.rs:151` MAX_LIVE_SESSIONS=0; "spawn proceeds anyway" `:1388-1414`) · wake re-mints registry identity: resume spawns a new row + deletes the old, compensated by lineage adoption (`commands.rs:190-236`) · durable mirror is best-effort even for terminal transitions (`persist.rs:82-86`) · run membership is a 2-minute dispatch-time window; `begin_run`/`end_run` have zero frontend callers (`run.rs:29`) · harvest counts any non-terminal member "active" incl. stale stragglers (`run.rs:206-210`) · write-set/collision discipline lives in doctrine and prompts, never registered or checked at admission.

### <a id="w4-prompt-assembly"></a> prompt-assembly
Post-assembly appends: 44.5% of production prompt bytes are concatenated AFTER the assembler returns — outside budget, fence, and fingerprint (`runner/mod.rs:973,:1014,:1042`) · session cache hash digests `tool_count`, not tool identity — equal-count tool swap reuses a stale warm session (`session_pool.rs:133-148`) · unresolved `{{key}}` ships to the model as literal template syntax, warn-log only (`variables.rs:106-133`) · constitution op-grammar (89 hand-written OP lines) vs dispatcher ALLOWED_ACTIONS are two hand-maintained copies, no sync gate; cockpit widget kinds not validated at dispatch (`dispatcher.rs:1492-1523`) · no persisted record of any sent persona prompt (input_tokens 0 on all rows) while the companion side persists per-block sizes + hashes.

### <a id="w4-prompt-safety"></a> prompt-safety
Fence nonces are time^counter mixes, self-documented non-cryptographic, no re-mint-on-collision (`runtime_safety.rs:13-21`, `sleep_cycle.rs:1725-1736`) · canary has no trip protocol — nothing machine-screens output for the `[SECURITY]` marker or nonce leakage; output flows downstream regardless (`runtime_safety.rs:34-40`) · `strip_html_tags` decodes entities once AFTER stripping — not a fixpoint; once-encoded markup stored as live-looking text (`validation/mod.rs:11-27`) · no shared cross-language test-vector corpus for redaction parity; the 2026-08-15 in-file correction measured exactly this drift class.

### <a id="w4-structured-output"></a> structured-output
`parse_decision(&blob).unwrap_or_default()` spells parse failure as a default-valued LEGAL artifact — presents as team stall; 91% of headless turns cannot report a parse failure (`deliberation.rs:516,:1372`) · extraction-failed and turn-failed cross to the UI as one status string (`ai_artifact_flow.rs`) · dispatcher warnings logged, never counted/persisted — unknown-op rate untraceable; the grammar's three renderings (prompt menu / ALLOWED_ACTIONS / dispatch arms) hand-synced with no equality check.

### <a id="w4-triage-queues"></a> triage-queues
`pending_counts` roster enumerates 6 of 13 human-decision queues — 314/370 waiting items (84.9%) invisible to the badge, oldest 98 days (`db/src/repos/dev_tools.rs`; documented in legacy findings-triage-queue.md §0) · the 7-day auto-RESOLVE GC is already registered at #w2-hitl-approval (cited, not re-registered) · `useUnifiedInbox` sorts newest-first with no severity tier (acceptable for a capped quick-scan surface; noted).

### <a id="w4-health-checks"></a> health-checks
`HealthCheckStatus` (Ok/Warn/Error/Inactive/Info) has no could-not-determine member — keyring-unavailable maps to Warn (`system/health.rs:22-28`; the engine's three-state `HealthProbeState` is the honest form the system checker lacks) · live-run revocation evidence never writes the health record — `invalid_grant` logged, `mark_needs_reauth` skipped (`api_proxy.rs:924-934`) · `BinaryProbeCache` returns no timestamp — staleness TTL-bounded but never rendered · brief's `HealthCheckPanel.tsx` path does not exist (surface is `useHealthCheck.ts` + `useHealthDigestScheduler.ts`).

---

## Hierarchy-v2 forge wave 5 deviations (2026-08-18) — eight more subjects reconciled

Same contract: standards kept, gaps registered, one anchor per subject, cited from
frontmatter. Full detail in the wave-5 composer reports (session transcript).

### <a id="w5-tracing"></a> tracing
Write-once-at-finalize durability — 0% trace coverage for reaped/crashed runs (`core/src/trace.rs` + `runner/mod.rs`; legacy D4) · no closed span-status vocabulary — cancelled/interrupted/failed collapse into strings · `Some(0)` written for never-measured tokens (`parser.rs:340-341`) · LIFO tool-span close instead of close-by-handle (`runner/mod.rs:2484-2488`) · `spans` JSON read back with `unwrap_or_default()` — corrupt column renders as empty trace (`traces.rs:58`) · synthetic-trace estimate labels per-trace not per-datum · three parallel hand-rolled JSON highlighters.

### <a id="w5-observability-telemetry"></a> observability-telemetry
Pre-boot records dropped, not buffered (`DeferredFileWriter`, `logging.rs:160-178`) · second unbounded unredacted sink: `ExecutionLogger` = 99.1% of log bytes with live credentials, no level/filter/scrub/retention (`engine/src/logger.rs`) · native crash records unsanitized and non-atomic while the frontend path sanitizes all three fields (`logging.rs:245-299`) · crash-store cap enforced only at startup, not on insert · disk accounting sums files the retention line doesn't govern (`logging.rs:413-436`) · no runtime level control and the default directive targets a stale crate root, silencing ~301 debug! calls · webview capture merges into the file, bypassing filter/scrub/remote tap · no reveal-folder or export bundle.

### <a id="w5-metrics-rollups"></a> metrics-rollups
Ordinal period split over a sparse (no zero-fill) feed — every zero-execution day shifts the comparison boundary (`periodComparison.ts:30`, `computeTrends.ts:43` vs `metrics.rs:1181-1196`) · averages of averages in trends (per-day means of successRate and p50, `computeTrends.ts:117-118`) · two day definitions in one product, one undeclared (caller-local in sla/heatmap vs UTC in overview series) · heatmap streak walk anchors UTC over local-day buckets (`metrics.rs:2202`) · empty denominator spelled 0% beside a helper that documents the None doctrine (`sla.rs:802-806`) · no effective-window echo on `MetricsChartData` (days clamped silently).

### <a id="w5-alerting"></a> alerting
**A third evaluator fires off the viewed filter** — `useObservabilityData.ts:70` evaluates rules against the tab's 30/90-day + persona-filtered window and persists real FiredAlerts (violates private-window AND one-evaluator) · scope divergence: `rule.persona_id` honored by the Rust evaluator, never read by the client one — and all loops share one 1-hour cooldown keyed on rule_id, so a wrong-scope fire silences the authority's correct one · empty-window rates coerce to 0 — every `<`/`<=` rule fires forever on an idle install; the guard test covers only the `>` direction · partial-edit validation hole (threshold-only update skips always-true re-check, `alerts.rs:65-71`) · no lifecycle beyond `dismissed`; no flap control anywhere.

### <a id="w5-perf-instrumentation"></a> perf-instrumentation
Freeze-monitor durable sink is `File::create`-truncated at every launch — the crashed session's alert records die with the relaunch that follows the crash (`freeze_monitor.rs:70`) · two time bases in one startup record (backend PROCESS_START vs WebView `__BOOT_TIME__`); the window-creation gap is attributable to neither · the frontend freeze detector is dev-only — shipped builds have no frame-gap coverage · startup report retention is one launch; no persisted history/baseline.

### <a id="w5-usage-analytics"></a> usage-analytics
Barrel re-exports raw vendor helpers beside the sink — 18 hard-wired emit sites vs 4 sink consumers (`analytics/index.ts:162`) · `TAB_DIMENSIONS` hand-list leaves 6 of 20 tab dimensions unregistered (85.2% coverage on that axis) · rollup flushes on one fallback unload event, no checkpoint, no loss accounting · activation latch written before the send — an opted-out period permanently consumes first-time milestones (`activation.ts:121-134`) · emit path never validates tab values against declared dimension values.

### <a id="w5-scoring-rubrics"></a> scoring-rubrics
No rubric versioning anywhere — weight edits silently re-score history (`goldenStandard.ts:26`, `leaderboardScoring.ts:58`) · comment-only weight sums ("sums to 1" with no assertion; `compositeHealthScore.ts:104-120` has the assertion others should copy) · `improvePlan.ts:78` sorts by priority alone, ties fall to input order · coverage undisclosed after renormalization (no "scored on N of 5 dimensions") · band boundaries inlined at render sites (`qualityScore.ts:47-57`) · kpiMath↔kpi_derivation twin gate already at #w3-data-viz.

### <a id="w5-audit-logging"></a> audit-logging
Credential-ledger 90-day retention is a scheduled sweep, not insert-path enforcement (`background.rs:3023-3031`; `api_key_audit.rs` shows the correct form in the same binary) · `auditMiddleware.ts` is named "audit" but emits diagnostic log lines, not ledger rows — the audit/telemetry boundary blurred in code · sanitization is per-ledger, not uniform: only the credential door runs `sanitize_secrets`; `policy_events` free-text inserts unscrubbed.

---

## Hierarchy-v2 forge wave 6 deviations (2026-08-18) — engineering-process cluster reconciled

Same contract: standards kept, gaps registered, one anchor per subject. Full detail in
the wave-6 composer reports (session transcript).

### <a id="w6-release-pipeline"></a> release-pipeline
Tag pushed before artifacts exist (11 tags / 0 releases; = deferred fixes 62/63, cited) - ci-gate requires a workflow that is 0-for-324 all-time, so publish:true is unreachable by construction - five version literals, macros crate already diverged to 0.1.0, no drift gate - two changelogs, one abandoned (Unreleased covered 3 of 11 tags); empty changelog renders "Maintenance release." - no size ratchet; installer baseline never committed so CI deltas are always empty; budget runs on one target leg only - no previous-release-to-candidate update rehearsal.

### <a id="w6-packaging"></a> packaging
Android variant outside the drift gate - forks identifier and CSP, carries the unsafe-eval token the gate bans, invisible because no gate reads that file (check-tauri-configs.mjs:18) - no absence-side payload check (nothing asserts lite trees lack ML payloads) - no upgrade rung anywhere (fresh install + uninstall only) - uninstall acceptance asserts only binary removal - macOS/Linux cells are dispatch-only + continue-on-error - brief correction: verify-resource-scoping.mjs is connector-API listing, NOT packaging (false lead excluded).

### <a id="w6-build-economics"></a> build-economics
Only the desktop feature set builds on every change; 5 feature variants compiled by nothing routine - the crate split has no completion criterion or regression baseline (point-in-time record, not a series) - check-build-cache.mjs runs on a path that cannot produce the error it detects - cleaning ladder documented three times, three ways - 317 MB of debug symbols in a vendored cache on every dev machine, unbudgeted.

### <a id="w6-codegen"></a> codegen
Budgets are runner policy not registry data (one global timeout) - registry declares no outputs, so the task-to-artifact join is impossible - no zero-output detection (a generator writing nothing passes; one task exits 0 unconditionally by design) - unregistered generators exist and are stale (gen-tour-anchors.mjs et al.) - committed bypass: the android conf beforeBuildCommand runs 0 of the 14 tasks - no atomic writes in any generator; split-locales.mjs deletes 793 files before rewriting.

### <a id="w6-quality-gates"></a> quality-gates
lefthook.yml:10-11 comment claims a --fix the job (correctly) does not carry - stale doc, not wrong behavior - secret scan has no binding backstop: exits 0 with a hint when the scanner is absent AND no CI workflow runs one, so the D9 control is opt-in per machine - CLAUDE.md's own --quiet mechanism claim is REFUTED by fault injection: --quiet disarms only display; the 99999 threshold is the entire exit-code neutralizer (correction owed to the primitive text; the forged severity technique carries the measured truth).

### <a id="w6-test-harness"></a> test-harness
e2e-smoke red 38/38 since inception (one missing word) - a lane that never passed and nobody noticed - default lane denominator shrink: 11/402 files never start while the report says 3,737/3,738 passed - 28 of 32 Playwright specs unreachable from any named script - run-rust-tests.mjs header records the unresolved CI-matrix contradiction (bare cargo test on the platform the quirk kills).

### <a id="w6-concurrent-vcs"></a> concurrent-vcs
The intent ledger decayed past its own algorithm: 118 stale Active entries, duplicate section headings breaking the documented append anchor, current campaigns unregistered - nine skill specs still prescribe the defeated pathspec forms; GIT_INDEX_FILE appears in zero SKILL.md - zero skills instruct the post-commit log readback - three orphaned worktree directories invisible to registry-driven GC by default (--include-orphans is opt-in).

### <a id="w6-codebase-scanning"></a> codebase-scanning
parse_finding silently drops malformed protocol lines - nothing counts parse failures (standards_scan.rs:71-78) - the runner never reconciles received findings against the shipped ruleset (a rule the model skipped is silently absent) - the incremental digest ledger keys on content only, so a ruleset revision does not invalidate prior results - corpus-map has ZERO files for this subject; the census/idea-scanner legacy docs may be mapped elsewhere - check during N+2 backfill.

---

## Hierarchy-v2 forge wave 7 deviations (2026-08-18) — UI/interaction cluster reconciled

Same contract: standards kept, gaps registered, one anchor per subject. Full detail in
the wave-7 composer reports (session transcript).

### <a id="w7-canvas-graph"></a> canvas-graph
Brief correction: teams/sub_canvas reducer board (29 files incl. useCanvasReducer.ts) was deleted as orphaned in 78e9bff68 - evidence substituted with Mastermind + pattern-graph canvases - layout store never reconciles orphan entries (dead positions persist forever; 2 of 8 measured) - GroupLayer group-body drag has no travel threshold (any press-move mutates, GroupLayer.tsx:73-104) - edges render unculled and pair-keyed (CanvasShell.tsx:880-882) - no alignment guides exist anywhere, only grid snap.

### <a id="w7-chat-transcript"></a> chat-transcript
Streaming turn is a separate element swapped at settlement rather than one turn in two phases - resolved approval cards are REMOVED from the transcript instead of settling in place as the decision record (companionStore.ts:870-871) - row kinds partly sentinel-typed by string prefix (PROGRESS:, [proactive:) instead of a typed registry - jump-to-latest pill carries no unseen count - no per-thread reading-position restoration.

### <a id="w7-drag-drop"></a> drag-drop
DragHandle has role=button with no tabIndex (false affordance) - 0 of 26 drag surfaces keyboard-operable; the only live region never announces a move - ReferenceBoard onReorder(toIndex) discards dragged identity, so every reorder drag is a no-op (ReferenceBoard.tsx:186,257-262) - dev_tools.rs sequence rewrite is N unatomic commits and the stack is UI-unreachable - KanbanBoard void onItemMove discards the promise (request-shaped drop, no pending/rejection) - AssetCard handoff payload embeds a stale-able entity snapshot instead of a reference - brief correction: SortableColumnHeader is sort-toggling, not drag reorder; no live column drag-reorder exists.

### <a id="w7-schema-driven-ui"></a> schema-driven-ui
Cockpit widget kinds not validated at dispatch + registry/constitution as two hand-maintained vocabularies (cited at #w4-prompt-assembly) - CockpitWidgetProps.config is Record<string,unknown>, no per-kind validators, widgets self-defend - SurfaceSpec drop ledger is a bare integer: no per-drop reason/kind, so the emitter-improvement loop has no instrument (surfaceSpec.ts:204-211).

### <a id="w7-draft-editing"></a> draft-editing
useUnsavedGuard has 2 consumers of ~13 editing surfaces (>=11 unguarded) - BaseModal cannot refuse close, so drafts in modals are structurally unprotectable - beforeunload prompts but never saves; the one drain implementation has zero importers - 38 of 55 reseed effects keyed on the entity object clobber in-flight edits - draftChanged uses !== per key (flat drafts only, undocumented precondition) - persona switch asks before flushing where flush-first would settle it.

### <a id="w7-undo-history"></a> undo-history
No boundary-event closure: pointer-up never closes the open step; the 400ms window is the sole closer, and the target-only tag merges distinct gestures on the same clip (useMediaStudio.ts:79-100) - commit_snapshot swallows all failures: a project whose checkpoints stopped committing is indistinguishable from a protected one (versions.rs:23-34) - restore trusts the every-turn-committed invariant instead of capturing pre-restore state (versions.rs:67-84) - boot-rotating 3-set backup discards every pre-incident snapshot in ~2h11m (backup.rs; also cited under migrations) - brief correction: studioHistory.ts is session-display restoration, not the checkpoint exemplar (versions.rs + StudioVersions.tsx is).

### <a id="w7-media-playback"></a> media-playback
video src rebinds across clip boundaries with no identity key; prior transport state survives under new bytes, papered over by threshold seek-correction (CompositionPreview.tsx:366,:120-151) - the one clock consumer re-renders per tick in the component rendering the video element - the adapter seam lives inside a 734-line surface component with engine-identity branching and no extracted transport contract (RadioFooter.tsx:146-148) - switching away pauses rather than reaps the foreign frame (undeclared warm-instance policy).

### <a id="w7-file-browsing"></a> file-browsing
Range-select follows raw listing order, not visual order (useDrive.ts:517-533) - select-all ignores active filters; invisible selection feeds remove() (useDrive.ts:537-539) - refresh never prunes selection of externally deleted paths - bulk mutations have no aggregate report (no "moved 12 of 15, 3 failed") - vault walker skips unreadable dirs silently with no count - location/expansion not persisted across sessions - thumbnail decode failure not negatively cached.

---

## Hierarchy-v2 forge wave 8 deviations (2026-08-18) — LLM/backend platform cluster reconciled

Same contract: standards kept, gaps registered, one anchor per subject. Full detail in
the wave-8 composer reports (session transcript).

### <a id="w8-retrieval"></a> retrieval
Kind-scoped vector scan bypasses the embedding-model guard - after a model swap the doctrine lane serves foreign-model neighbours the main lane excludes (embeddings.rs:410-434 vs :386) - three forks of the FTS5 sanitization door (core/retrieval vs vector_kb.rs:872 vs execution search), acknowledged in-code as pending consolidation - NO retrieval evaluation exists anywhere: no labeled query set, no ranking metric; the 1.30 distance floor is calibrated by "watch the debug log" - TF-IDF sidecar lane is a hand-synced reimplementation ("keep in sync with graph.rs") - degraded mode unlabeled at the consumer; model_guard_excluded_total counter is dead code.

### <a id="w8-eval-harness"></a> eval-harness
test_runner.rs file-top comment claims the scenario cache key includes system_prompt; the implementation deliberately excludes it - a stale header stating the opposite of a load-bearing invariant (:14-16 vs :57-74) - judge-packet.mjs reads runs from one path while its instructions point the judge at another - a grid cell whose samples are all unscored renders composite 0: not-measured spelled as worst-score (evalAggregation.ts:143-151).

### <a id="w8-model-routing"></a> model-routing
Audit ledger never written: provider_audit_log.model_used NULL on 4,001/4,001 live rows; the BYOM audit UI renders '-' for every row - tier pair split at 7 call sites: .model read without .effort (call_claude_text has no effort parameter), dropped effort lands on the CLI default HIGH, above calibration - top-of-scale defaults against the repo's own benchmark (BUILD_TURN_EFFORT=xhigh where the effort guide ranked xhigh 4th of 8 at +33% spend) - policy governance is dirty-state review, no versioned diffs or approval records - model_routing_rules holds 0 rules ever; 5 of 6 resolution layers never populated.

### <a id="w8-cost-metering"></a> cost-metering
Two price tables with OPPOSITE unknown-model policies (cost.rs silently mid-tier and uncounted; config.rs zero) - get_monthly_spend(...).unwrap_or(0.0): DB error reads as $0 spent, undeclared fail-open on the unattended path (background.rs:2510) - only schedule-type triggers are budget-gated; event/webhook firings bypass (background.rs:2490) - max_budget_usd carries two units (monthly ceiling vs per-call cap) - cancelled/killed runs book Some(0.0) cost: definite-free instead of unknown - ledger drops warn-logged but never counted.

### <a id="w8-pipeline-dag"></a> pipeline-dag
Condition evaluator fails OPEN: malformed condition JSON or unknown operator silently FIRES the branch (pipeline_executor.rs:153-207), warn-log only, no persisted branch record - validation is run-start only: the editor saves cyclic graphs; no reachability or dangling-edge check (unknown members silently continue'd) - no restart resume: recovery fails running/awaiting_approval runs wholesale incl. runs parked on human gates (lib.rs:838-849; mechanism = #w2-hitl-approval) - "skipped" overloaded (blocked-by-failure vs branch-not-taken) - eight statuses as inline string literals, no enum authority - #w2-retry-backoff residual: 429 fixed 2026-08-16 but Retry-After remains unread.

### <a id="w8-self-healing"></a> self-healing
Effectiveness report has no unknown lane: attempted = confirmed + reverted; TTL-expired pendings vanish from the denominator (healing.rs:891,:903) - effectiveness cells keyed on a free detail string, not the closed category vocabulary, and carry no strategy dimension - incident promotion env-gated OFF by default (PERSONAS_INCIDENTS_PROMOTION) so the healer-gets-louder lane can be entirely dark; dedup is per-source-row not per failure signature - auto-rollback's no-qualifying-target path drops the detection silently (auto_rollback.rs:335-350, its own comment admits it).

### <a id="w8-admission-queue"></a> admission-queue
wait_ms computed and logged once but exported nowhere - no event field, no DB column; legacy replay measured p99 58-minute waits invisible to every consumer (queue.rs:367-368) - QueueFull typed Validation/retryable=false while its prose says "Try again later" (deferred fix #90 cited) - AdmitResult has exactly one call site; >=7 sibling admission lanes speak private verdict vocabularies - no aging: Low can starve under sustained Urgent, undetectably - TierConfig.max_queue_depth declared and rendered but set_max_queue_depth has zero callers (runtime bound always 10) - task_executor writes the durable running marker BEFORE asking the door; refusal strands rows (129-day-old examples live).

### <a id="w8-sync-replication"></a> sync-replication
Tombstone table has no producer: a full delete cascade reads persona_tombstones which zero code writes - no delete has ever propagated (cloud/sync/mod.rs:372-395) - tombstone cursor advances from a clock read with discarded Result, the exact race the same file fixes on the table path (:374/:393 vs :272-281) - cloud lane resolves conflicts by arrival order (merge-duplicates, no base, no read-back) - six streams watermark on creation time behind a 24h window: later mutations permanently invisible - status surface lacks lag-with-predicate (no tail comparison, no last-success-vs-last-attempt split).

---

## Hierarchy-v2 forge wave 9 deviations (2026-08-18) — platform/data tail reconciled

Same contract: standards kept, gaps registered, one anchor per subject. Full detail in
the wave-9 composer reports (session transcript).

### <a id="w9-webhook-ingestion"></a> webhook-ingestion
No replay-attack timestamp window on the direct receiver (the defence exists 900 lines away in oauth.rs and was not copied) - no dedup at the direct mint point: every accepted POST mints a fresh event - relay authenticity opt-in and FAIL-OPEN by default (unset secret = unauthenticated accept, smee_relay.rs:34-53) - relay gate hashes re-serialized JSON, not the sender's raw bytes - replay/curl-export re-deliver the body redaction placeholder while reporting success - headers logged verbatim incl. signature/sender tokens - relay dedup per-process in-memory (restart replays channel history) - three ingress mouths, three separate check stacks, no one admission door.

### <a id="w9-rate-limiting"></a> rate-limiting
Webhook 429 carries retry-after in body prose with no_headers() while the same file sets Retry-After on its 422 - the shared limiter's policy is a call-site parameter so the dashboard guesses limits from key prefixes (wrong for 3 families) - RateLimitDashboard renders three structurally-zero counters (the store's only writer has zero call sites); the user-authorable trigger rate-limit policy is read by NOTHING - egress default 60rpm exceeds documented provider limits; rate_limit_rpm declared by zero seeds - over-limit relay events dropped via .is_err() continue - warn latch has no suppressed-count.

### <a id="w9-concurrency-guards"></a> concurrency-guards
InflightGuard has no production inspection surface (len() is test-only) and no age-based reclamation - a hung holder wedges a key invisibly - daemon lock stale takeover is remove-then-create_new, not atomic replace-if-unchanged (one-leadership-bounce window, lock.rs:185-215) - oauth LOCK_MAP entries never pruned - brief correction: oauth_refresh_lock is IN-process (per-credential mutex), not cross-process.

### <a id="w9-delivery-guarantees"></a> delivery-guarantees
Claims are anonymous - no holder/timestamp/lease on claim_pending, forcing the heuristic two-snapshot reaper (= #w2-background-jobs, cited) - failure-lane escalation writes one generic prose string, defeating clustering (background.rs:1706) - the incident lane binds to a failure class that never occurs while the voluminous class routes to a verb-less parallel inbox (audit_incidents_promoter.rs).

### <a id="w9-embedded-db"></a> embedded-db
Maintenance defers forever - no staleness bound forces a pass; deferral logged at debug; blocking checkpoint with no chunk-yield - slow-query threshold is a server-calibrated uniform 100ms for a local store; pool-wait times logged but never enter the ring - journal contract set every boot, never read back (nothing checks any pragma took) - prune accounting not per-table; count-then-delete in separate statements; no referential closure, no prune ledger - extension-before-pool ordering is conventional, not structural - brief correction: pool construction + acquire_logged live in db/src/lib.rs, not core/src/pool.rs.

### <a id="w9-entity-lifecycle"></a> entity-lifecycle
Blast-radius probes use unwrap_or(0) - a FAILED probe renders as "safe to delete", and the in-file comment records this exact incident already happening (personas.rs:1933-1997) - probes narrower than their deletes (preview counts active/running rows, the cascade takes every row) - preview unguarded while the act is privileged (parity broken) - bulk-delete confirm shows the client page-size count (100) against a server predicate deleting 6,535 (= deferred-fixes 2c, cited) - risk ladder inverted: only persona delete has typed confirmation.

### <a id="w9-versioning-snapshots"></a> versioning-snapshots
unwrap_or(1) turns a failed max-version query into version 1 (failure spelled as success) + read-max-then-insert with NO UNIQUE(persona_id, version_number) - 12 such unconstrained tables per census - persona_versions is canonical-by-declaration and DEAD (0 callers, 0 rows ever) while the "replaced" table keeps gaining columns - the conditional capture door diffs only structured_prompt: system-prompt-only edits bypass capture (16/25 historical rows NULL) - demotion re-tags production to experimental, erasing the promoted-ever fact; archived exists and is never used.

### <a id="w9-settings"></a> settings
Secrets in the settings store: three API keys/tokens plaintext in app_settings while a credential vault exists (settings_keys.rs:28,34,70) - fail-open dollar ceilings (= #w2-hitl-approval, cited; contrast CHAIN_MAX_LINKS which does it right) - the two-list registry is hand-maintained with no set-equality test; the AUTONOMOUS_DELIBERATION scar (constant present, allowlist entry missing, toggle could never enable) proves the drift mode - repo-layer audit passes actor=None (all-writers coverage traded against attribution).

---

## Hierarchy-v2 forge wave 10 deviations (2026-08-18) — UI/agent tail reconciled

Same contract: standards kept, gaps registered, one anchor per subject. Full detail in
the wave-10 composer reports (session transcript).

### <a id="w10-accessibility"></a> accessibility
useRovingTabIndex has ZERO adopters (a standard without adoption; index-keyed signature pushes the identity rule onto consumers) - the announcer queue has no coalescing/bound/assertive-preemption and no unit test despite being pure logic - ~40 files carry scattered aria-live regions outside the one provider - deferred fix #33 (21/21 tab strips dangling aria-controls) touches name-wiring - four registered anchors cited from frontmatter (#w7-drag-drop, #w3-data-viz, #w3-toasts-notifications, #w3-design-tokens).

### <a id="w10-motion"></a> motion
MotionizedGlyph deliberately replays its entrance on every viewport re-entry while the data-row primitives implement one-shot correctly - two consumer families, opposite replay policies, only one written down (MotionizedGlyph.tsx:10-12) - motionPresets inlines durations/easings rather than referencing the token ladder (local face of #w3-design-tokens MOTION mirror) - reduced-motion global-reset trap cited at #w1-async-ui-states.

### <a id="w10-guided-tours"></a> guided-tours
Two anchor extractors disagree: six anchors pass the drift test but are absent from the manifest, so composed tours are forbidden the anchors hand-written tours use; nothing reports the disagreement - route choreography races fixed 100-400ms timers instead of observing arrival (GuidedTour.tsx:102-208) - no active-tour pointer persisted; hydration hardcodes the default tour (tourSlice.ts:1318) - a tour whose definition did not survive restart is marked 100% complete via [].every() (vacuous completion, tourSlice.ts:1493) - raw z-[9998]/z-[9999] literals unregistered with any layering authority - escape minimizes rather than exits.

### <a id="w10-client-fetch-cache"></a> client-fetch-cache
staleWhileRevalidate has no stale ceiling (any-aged entry serves) and background-refresh failure is invisible to callers - deduplicateKeyedFetch keys via naive JSON.stringify (non-canonical for objects) - the certification deferred-load guard is an ageless already-loaded latch, not a freshness window - reviewParseCache memoizes against ambient inputs outside the key (hidden-axis staleness) - hand-rolled warm slots have no invalidation door or test-reset hatch while the extracted primitive has both.

### <a id="w10-terminal-multiplexing"></a> terminal-multiplexing
Terminal stays interactive over a doze-killed process: dozing/childPid in the DTO, read by none of four host surfaces - keystroke/paste/resize failures land in silentCatch while sibling surfaces toast the same call - paste can self-submit twice (trailing-newline intent inference + two paste routes bypass bracketed paste) - write_text_line returns Ok before submit confirmation; the confirm/retry outcome dies in a detached task (registry.rs:750-851) - per-frame resize with no same-size skip rebuilds the backend screen model each change - MCP temp-dir reaper measured not to run (6 created / 0 removed).

### <a id="w10-sidecar-provisioning"></a> sidecar-provisioning
Path overrides silently fall through when unusable — a test enshrines the fallthrough (bun.rs:21-26,:111-123; same shape in kokoro.rs) - no digest rung anywhere: verification stops at advertised-length equality, which self-disables on chunked responses - the in-flight download guard REJECTS the second caller instead of joining it - four bespoke resolution implementations, no shared resolver; one has no override rung at all - no cancellation for any model download; no unified storage accounting across model stores.

### <a id="w10-agent-chaining"></a> agent-chaining
Wiring is append-only: no orphan cleanup when a drawn edge is deleted, no edge-id tagging on derived rows (team_handoff.rs) - the wiring pass is non-transactional per edge (a failed listener create leaves an emitter announcing into the void) - handoff payload forwarding is unbounded (no size cap, no truncation record, chain.rs:567-588) - unevaluable predicates fail closed but ledger as predicate_unmet (the distinction lives only in warn logs) - ledger writes best-effort + the happy-path leaf writes no completed record, so stopped-vs-stuck ambiguity survives at exactly those seams - brief correction: run conditions live in db/src/chain.rs, not engine/subscription.rs.

### <a id="w10-proactive-nudges"></a> proactive-nudges
Budget day boundary is UTC while quiet windows are local wall-clock — the two policy clocks disagree by the user's offset - quiet/budget bypass is per-code-path, uncounted, not a closed class - evaluator failure is empty success (collect_all swallows per-evaluator errors with unwrap_or_default, no health record) - a budget unit is not released on failed delivery claim (spent unit lost until rollover) - efficacy modulation never reads the ignored outcome — a purely-ignored kind is never throttled - no per-kind kill switch reachable from the nudge; no default night window shipped.

---

## Hierarchy-v2 forge wave 11 deviations (2026-08-18) — integration + security + operator additions

Same contract: standards kept, gaps registered, one anchor per subject. Full detail in
the wave-11 composer reports (session transcript).

### <a id="w11-connector-catalog"></a> connector-catalog
Cites the registered seeder-clobber (127: boot refresh reverts operator edits, updated_at lies - 134 rows / 1 distinct updated_at) and 126 (probes green for any value, Save gated on that green). New: two intra-row consistency classes no schema expresses - (declared fields, probe template) and (declared capability, registered adapter) - both need seed-time cross-checks; the correct revision-gated refresh existed in ONE seeder of seven and never propagated.

### <a id="w11-import-normalization"></a> import-normalization
Capability tables duplicated across runtimes (platformDefinitions.ts hand-mirrors platform_rules.rs while the SAME pipeline's size caps got proper codegen) - fabricating fallback: unmapped foreign types silently mint vocabulary instead of grading unsupported (resolveNodeType) - the import receipt enumerates nothing (entity_results = empty on all 155 rows) - one adapter lives outside the table system; detection fingerprints are code not data - no export-schema version detection. Re-homing: external-source-ingestion.md fits webhook-ingestion better.

### <a id="w11-templates-scaffolding"></a> templates-scaffolding
RE-MEASURED LIVE: 10 select questions across 8 canonical templates carry a default outside their own options - the de-branding pass rewrote defaults but not option lists, answers bind by label string (fix shape: 5-line membership check in validateTemplate.ts; data fix first). Two readiness evaluators (browse badge vs commit gate) judge different declarations; readinessTier hardcodes English + raw colors. Brief correction: checksum_mismatch at the catalog door is a typed skip, not log-and-accept - the door is the honest gate; the deleted per-adoption check was the decoration.

### <a id="w11-web-scraping"></a> web-scraping
Extraction collapse laundered as success: config_run stamps ok unconditionally; a page redesign produces empty-field records counted as changed-under-ok (engine/src/scraper.rs:578-587) - the DSL has no failure semantics (no required/optional on rules) - silent key fallback re-keys a record to its URL, splitting identity - no stale/tombstone tier - LLM authoring permits the imagination path with no URL, auto-decides replace/merge, never auto-verifies against the authoring page - schedules default enabled:true; single free-text last_status; no request spacing.

### <a id="w11-markdown-vault"></a> markdown-vault
Orphan-predicate divergence: graph.rs counts orphans with no entry-point exemption while lint.rs exempts them - two surfaces disagree on any vault with index notes - mirror ledger-vs-disk gap: the skip-gate reads sync_state, never disk, so a vault-side deletion of a mirrored note is skipped forever; no reconcile pass.

### <a id="w11-multi-project"></a> multi-project
Unwatched renders as quiet: every tracking watcher failure returns Ok(empty) with a warn - an unreadable repo is indistinguishable from an idle one (watchers/git.rs:51-70) - dual project-identity registries bridged BY CANONICALIZED PATH at the push boundary (the exact join-class defect the repo's own shipDerive doctrine kills one floor down) - admission has no dedupe: one repo admitted twice mints amnesiac twins - anchor policy (fixed vs cohort-relative) not rendered with traveling scores.

### <a id="w11-device-pairing"></a> device-pairing
Scope strings unvalidated at mint (approve_pairing passes modal strings straight to create) - friction inversion on the P2P ceremony (confirm is an unarmed primary; unpair is two-step; = deferred-fixes 36, cited) - last revocation does not stop the LAN listener (:17500 keeps serving off an empty registry) - claim surface lacks fixed delay and OriginMismatch is a distinguishable code (confirms an approved-unclaimed nonce to a prober, pairing.rs:314-329).

### <a id="w11-signed-artifacts"></a> signed-artifacts
engine/bundle.rs verifies over a RE-SERIALIZED manifest (to_string_pretty of the parsed struct at :327/:405/:540) while its sibling enclave.rs fixed exactly this by preserving raw bytes - works today, breaks cross-version on the first schema addition - cites deferred-fixes entries 76/77/78 (filed by the legacy document-signing pass; anchor minting owed) - DriveVerifyDialog collapses three verdicts to two (counter-evidence).

### <a id="w11-supply-chain"></a> supply-chain
gitleaks allowlist exempts 40% of tracked files by directory glob; one dead entry; fixture regex blind to cfg(test) (matches 8 of 963 rs files vs 443 carrying tests) - extract_selected has no decompression budgets, no symlink policy, extracts direct-to-destination - restated measured: policy engine 0 verdicts in 350 runs (frozen via --locked), deep audit lane dead 23/23, update automation never enabled, 56 workflow refs unpinned, one git+https source standing against unknown-git=deny (cites #w6-quality-gates for the scanner-absent gap).

### <a id="w11-p2p-networking"></a> p2p-networking
NO reconnection policy exists: header promises auto-reconnect; max_retries is dead code, retry_count never increments, auto_connect read by nothing - a dropped peer stays dropped until a human clicks - no discoverability consent gate: the network service auto-starts unconditionally ~3s after boot in every p2p build; no enable/stop command exists - exposure is global not per-peer (one manifest served to ANY connected peer; the code comment admits it) - no reachable state; prune deletes rather than downgrades - version handling is exact-equality rejection.

### <a id="w11-status-vocabulary"></a> status-vocabulary
155 string-typed status fields vs 66 CHECK vocabularies / 88 wire unions; 0 of 26 catalog categories fully covered; validate_one_of is 1 file wide - 80 local color maps vs the palette authority in 10 files; a 3-palette fork in one feature - prefer-numeric gate recall ~3.5% - four locale policies across three timestamp modules; 13 hand-rolled timers beside the shared ticker; 28 elapsed ladders + 611 catalog strings of one four-rung vocabulary (cites #w3-i18n, #w3-design-tokens, #w2-realtime-events, #w5-alerting).

### <a id="w11-job-coordination"></a> job-coordination
BuildPhase::validate_transition checks the escape hatch BEFORE the terminal guard - Completed-to-Failed and Promoted-to-Cancelled validate; verdicts are not final (build_session.rs:69-73) - guards keyed off live states turned one stranded row into a documented system-wide deadlock (teams.rs:714-723) - terminal set scattered as SQL literals forced reusing cancelled instead of minting expired (the one-authority bill arriving) - cites #w8-pipeline-dag and #w2-background-jobs.

---

## Hierarchy-v2 forge wave 12 deviations (2026-08-18) — the nine former candidates + feed + ui-controls; the inventory is complete

Same contract: standards kept, gaps registered, one anchor per subject. Full detail in
the wave-12 composer reports (session transcript). With this wave every subject in the
ratified inventory (85 + additions = 105 folders on disk) has been forged.

### <a id="w12-feed"></a> feed
Read-position watermark is a bare timestamp on a 45%-tied second-resolution key: countUnread uses at <= lastSeenAt so a row arriving in the same second as the mark is counted read, while the composite {at,id} cursor sits 140 lines below (channelSlice.ts:60,102,318 vs :238-244) - mergedFeed drops the tiebreaker its sibling documents (§88, cited) - jump affordance is a boolean with no unseen count (#w7-chat-transcript) - re-homing applied: chronological-feed.md -> feed.

### <a id="w12-ui-controls"></a> ui-controls
CopyButton sets a native title= fallback — the exact signature inside the primitive meant to retire it (566 files / 1,099 native-title matches vs 131 Tooltip adopters) - Tooltip escape-dismiss only on the triggerFocusable branch - CopyButton copied-state has no live-region announcement - PanelTabBar aria-controls optional -> 21/21 dangling (deferred fix 33) - re-homing applied: button.md, copy-to-clipboard.md, tooltip.md, tab-strip.md -> ui-controls.

### <a id="w12-docs-sync"></a> docs-sync
The never-fired hook is fix 105 (cited); the composer's autopsy adds: 45.7% precision on prefix-shaped satisfaction; the hook's own 30-assertion test suite has fixtures with no tool_result events (fixture-as-theory-of-input); the guide-sync marker note claimed the hook "now prevents drift" dated the day the dead hook landed (hope recorded as fact in the artifact the next repair reads); 33% of source areas unmapped; 6 unregistered tour steps.

### <a id="w12-session-resume"></a> session-resume
Heartbeat not presence-gated: beat fires every 60s regardless of document.hidden, so an overnight-minimized window advances the anchor all night -> empty morning briefing (sinceLeftBriefing.ts:133-135) - one anchor, two readers, coupled by tree order (useMorningBriefing.ts:52-55 admits it in a comment) - sample-bounded count rendered as total (RUNS_SAMPLE_LIMIT=500, no "500+"; worst window measured 1,158) - no liveness mark for the briefing pipeline (nothing-shown = never-ran).

### <a id="w12-diff-comparison"></a> diff-comparison
"No structural difference" computed over a 5-of-7-field projection (DiffViewer.tsx:14-16,54) - unsorted-serialization equality at 6 sites (census rule stringify-decided-equality) - baseline picked by byte LENGTH (competitions.rs:562) - id-set difference labeled a run diff (byte-identical runs -> all added + all removed, memoryDiff.ts:50-55) - drift finding id minted per observation so dismissal never sticks and slice(-50) evicts open findings (designDrift.ts:64-66) - worker caches never evict; unbounded DP diff measured 610ms / 8,000 elements at 4k lines.

### <a id="w12-time-travel-replay"></a> time-travel-replay
The log track's timing is FABRICATED while the truth is on disk: buildTimelineLines spreads log lines evenly across duration_ms though every line carries an rfc3339 stamp the reader returns verbatim (useReplayTimeline.ts:75-85 vs logger.rs:60-62) — tempo, the thing replay exists to show, is interpolated from index - useTimelineReplay (the better seek) is orphaned, zero importers - no dead-air compression - a replay-only renderer diverged from live (own highlighter, own scroll; TerminalBody carries its own classifyLine copy) - log-load failure spelled as empty success (silentCatch -> "scrub forward").

### <a id="w12-sql-console"></a> sql-console
Client CTE verb regex omits DROP/ALTER vs the authority; classify_db_query IPC has zero callers (§25, cited) - consent banner slices the statement at 200 chars: consent to a prefix - primary Console tab omits cancelQuery; NL lane never registers a cancel token - history in-memory, index-keyed, cap 10 - NULL exports as the string 'NULL' - PRAGMA classified as read (session state reaches a pooled connection) - local-lane execute writes no audit row - counter-evidence: a model-authored execute_mutation with starts_with over 7 verbs bypasses the classifier (connector_use.rs:1443-1469).

### <a id="w12-cicd-monitoring"></a> cicd-monitoring
THE PIPELINE MONITOR HAS NO BACKEND: gitlab_list_pipelines/get_pipeline/list_pipeline_jobs/get_job_log/trigger_pipeline are UnregisteredCommand and appear in ZERO Rust files across the entire git history; the bindings were hand-planted with the frontend. As shipped: fetch failure renders the error banner AND "No pipelines yet — trigger a pipeline" together, inviting a click on a Trigger whose command does not exist - two liveness vocabularies three lines apart (created/preparing never polled) - only the selected pipeline is polled while the notifier observes the list - log null = loading forever; single log slot races on double-expand - consent inverted (rollback armed; deploy-to-production and trigger unconfirmed) - is_current is a self-declared heuristic. Brief-lesson: include commandNames.overrides.ts in ground-truth sweeps for any IPC-fronted subject.

### <a id="w12-embedded-preview"></a> embedded-preview
Origin discipline absent both ways: host dispatches on message shape only, never e.origin; both host and agent sends target '*' (StudioPage.tsx:126,155-158; preview_agent.rs:63,82) - reqId is the PROJECT id not a request id and is never read on reply; no pending table, no timeout (silence and not-found converge on null) - boot poll has no deadline (a never-healthy server leaves the tab in starting forever) and server stdio is null so nothing could attach - instrumentation degradation is silent (coarse mode indistinguishable from precise-with-missing-element) - no route rescan on turn completion.

### <a id="w12-dead-code"></a> dead-code
FRESH MEASUREMENTS: 758 orphan modules (404 test + 354 non-test; a 21-file island reachable only from an unreachable file) - 118 unused i18n keys incl. whole planner (67/67) and deliberation (51/51) sections - check-unused-bindings finds 1 while inventory finds 29 with no overlap, and is 1,034 sequential grep passes per CI run - knip's bindings ignore delegates to a gate that does not exist - purge-dead-keys --apply names but never runs its second step - census excludes have reasons but no reaper/expiry (one rot axis enforced, the other open) - brief correction: orphan-modules.mjs lives in scripts/analysis/, not scripts/build/.

### <a id="w12-outbound-notifications"></a> outbound-notifications
Two outbound stacks for the same five channel classes with three vocabularies (notifications.rs:435-593 vs webhook_notifier.rs:285-299) - the delivery ledger crosses IPC and is never rendered: an owner cannot see a dead channel without pressing Test - breaker copy-pasted 3x, each comment saying "same shape as" another - metrics per channel TYPE not per sink - unknown channel type -> Ok(()) = logged success that sent nothing (notifications.rs:493-496,559-562) - delete reaps no in-memory breaker state.
