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

## 24. Every run in the app's history records $0 and zero tokens

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

**One applied change has since been audited and found incomplete.** Commit
`1e714f817` corrected the credential **token-prefix** regex — measured as
masking 2 of 13 real token shapes before and 13 of 13 after, with 0 false
positives, across four copies. That result stands. What it did not do is examine
`INLINE_SECRET_RE`, the rule **directly above it in the same file**, which binds
`Bearer` as the value of an `Authorization` header and therefore prints
`[secret]` beside a surviving token — see item 35. The campaign's own doctrine
predicted this exact miss and the campaign made it anyway: **a search for the
broken literal finds every copy of that literal and nothing else.**
