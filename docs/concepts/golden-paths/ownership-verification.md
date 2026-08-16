# Golden path — Ownership verification

> Situation node: `backend-runtime/command-authorization/ownership-verification` ·
> [situation spine](../situation-spine.md) · recurrence 10 · risk **HIGH** ·
> sides: **server** · convergence: **mixed** ·
> dimensions: **security · function · code-quality · resilience**
> Composed 2026-08-16 against `master` @ `f1b61ad73`; §7 D2 re-verified at
> `b3178e460` after a parallel session fixed one of its four sites mid-composition.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri`, lexed rather than
> grepped (string/char/raw-string/nested-block-comment aware), with
> `#[cfg(test)]` removed as **brace-matched ranges** — never a line threshold.
> **1,661** `#[tauri::command]` functions extracted by brace-matching each body;
> **3,595** SQL string literals; **3,145** production SQL statements. Every one of
> the **23** ownership assertions in the tree was opened and read, as were all
> **9** scoped single-row statements, `ipc_auth.rs` (1,214 lines), the `requires`
> proc-macro, `management_api.rs`'s `authorize`, `mcp_server/auth.rs`,
> `cloud/remote_commands.rs` and `cloud/sync/rows.rs` in full.
>
> **Measured by execution, not by reading.** The authorization decision itself was
> replayed against a **read-only copy** of the operator's `personas.db` (347 MB,
> 241 tables — copied first, `readOnly: true`, the live file never opened for
> write while the app was running): `list_all_executions`'s SELECT transcribed
> verbatim from `db/src/repos/execution/executions.rs:288-293`, then
> `verify_execution_owner` (`commands/execution/executions.rs:25-35`) run against
> its output with the comparand the UI actually supplies. **2,188 of 2,188 rows
> pass.** Both databases were then swept for the artefact this leaf leaves behind
> — a row whose owner disagrees with the owner of the row it references — across
> every declared foreign key plus every `<x>_id` column whose parent could be
> inferred by value overlap. **Zero cross-owner references exist**, and §7 D9
> explains why that is a finding about the *caller*, not about the *guard*.
>
> **`cargo` was not run** (the operator's app is running). Every Rust claim is
> static and traces to a file read during composition. No privilege escalation
> was attempted against the running app; every defect below is described as a
> repair, and the one command that acts on a caller-supplied id with real
> consequences (§7 D2) is named with `file:line` and a one-line fix.
>
> ---
>
> ## The headline: 886 commands take a row id from the caller, 31 check anything about who owns it — and 16 of the 23 checks in the tree ask the caller for the answer
>
> | | n | share |
> | --- | ---: | --- |
> | production `#[tauri::command]` functions | **1,661** | |
> | ↳ taking a singular `<entity>_id: String` from the caller | **886** | 53% |
> | ↳ reaching **any** ownership/scope check (body, or a helper it calls) | **31** | **3.5%** of the 886 |
> | production single-row-addressed `SELECT`/`UPDATE`/`DELETE` statements | **781** | |
> | ↳ `WHERE … id = ?N` **and an owner column** — the scoped fetch | **9** (13 matched, 4 subquery artefacts removed by hand) | **1.2%** |
> | ↳ `WHERE id = ?N` and a *non*-owner predicate (status, version) | 90 | 11.5% |
> | ↳ bare `WHERE id = ?N`, nothing else | **678** | **86.8%** |
> | ownership assertions in Rust (`if row.<owner> != X { … }`) | **23** | |
> | ↳ whose comparand **arrived on the same request as the row id** | **16** | **70%** |
> | ↳ whose comparand is **server-derived** | 5 | 22% |
> | `require_auth` / `require_auth_sync` **call** sites | **1,253** | |
> | ↳ that check anything | **0** | both are `Ok(())` |
>
> Five findings are sharper than the ratios.
>
> ### 1 — the guard reads its own answer off the wire, and the sibling command hands the caller the answer first
>
> `verify_execution_owner(&exec, &caller_persona_id)` is real, tested (three unit
> tests, `executions.rs:1117-1144`), and stands behind eight IPC commands. Its
> comparand is a **`#[tauri::command]` parameter**. `AppState` (`src/lib.rs:369-414`)
> holds no notion of a current persona, so there is no server-side value it could
> have used instead — the caller is the only source, by construction.
>
> And the answer is free. `list_all_executions` (`executions.rs:65-82`) takes
> `persona_id: Option<String>` — **omit it and every persona's rows return** — and
> its SELECT is `SELECT e.*` (`db/src/repos/execution/executions.rs:288`), i.e.
> all **38** columns, including `persona_id` and `log_file_path`. **Executed
> against the live copy:**
>
> ```
> list_all_executions(limit=200, status=None, persona_id=None)  -> 200 rows
>   rows carrying persona_id in the payload ............ 200
>   distinct personas exposed by ONE unscoped call ...... 16
> replay verify_execution_owner with the comparand the UI supplies (row.persona_id):
>   PASS 200   FAIL 0
> whole table: guard satisfiable for 2188/2188 rows using ONLY values the list returned
>   columns the GUARDED command returns that the UNGUARDED list does not: 0
> ```
>
> The UI's own spelling says it plainly:
> `ExecutionDetail.tsx:53` is `getExecution(executionId, execution.persona_id)` and
> `ReplaySandbox.tsx:39` is `getExecutionLog(execution.id, execution.persona_id)` —
> **the claimed owner is a field of the object being guarded.** This is
> qualification 4 of the doctrine, arrived at from the value side rather than the
> type side: *a value anyone can read off the previous response authenticates
> nothing.*
>
> ### 2 — the same repo already implements the correct answer, on the one surface where the caller is remote
>
> `src/cloud/sync/rows.rs:14-16`:
>
> > *"`user_id` is intentionally absent — the Supabase column defaults to
> > `auth.uid()` and RLS enforces it. `device_id` is stamped after mapping."*
>
> The owner is **withheld from the wire and stamped by the server**. That is
> qualification 5 (withholding beats requiring) implemented, in this repo, by
> these authors — and the projection is a typed struct per table
> (`SyncedPersonaRow`, `SyncedDeviceRow`, …) rather than `e.*`, so the column list
> is a compile-time decision. **The same codebase holds both answers ~40 files
> apart, and the one that withholds is the one facing a caller it does not
> control.**
>
> ### 3 — the best ownership reasoning in the tree was written once, on a READ, and did not carry to any of the four WRITES in the same file
>
> `src/cloud/remote_commands.rs:240-244`:
>
> > *"Scope the fetch to THIS device. The id is a listable UUID, not a per-device
> > capability token, and RLS only scopes rows to the tenant — not the device.
> > Without this filter a multi-device user could approve a run targeted at device
> > B and have it execute on device A (wrong sandbox / local creds / working tree).
> > A wrong-device row simply won't return → 'not found'."*
>
> Four things are right there at once: the scope is in the `WHERE` clause of the
> fetch; `resolve_device_id` (`cloud/sync/cursor.rs:103`) reads it from local
> settings, **not from the request**; the failure mode is *absence*, not a 403;
> and the comment names the exact gap between the tenant boundary it has and the
> device boundary it needs. It is the best paragraph on this subject in six repos.
>
> **Three of the four writes in the file still drop it.**
> `remote_command_approve`'s own claim (`:282`) is
> `pending_commands?id=eq.{id}&status=eq.pending` — exclusive on status, **no
> device term, forty lines below the comment.** The poll's auto-expire (`:146`)
> and `set_command_status` (`:105`) are bare `?id=eq.{id}`. **A device can expire
> or settle a command targeted at another device**, and §7 D2 is the
> one-expression fix.
>
> The fourth is the best evidence in this document that the observation is
> correct: **`remote_command_reject` was fixed in `b3178e460`, committed by a
> parallel session at 11:41 while this path was being composed.** It now reads
> `?id=eq.{id}&target_device_id=eq.{device}&status=eq.pending` through
> `patch_returning_count`, under a comment (`:344-355`) that reaches the same
> conclusion independently: *"The approve path 85 lines above carries a four-line
> comment explaining precisely why the device term is required … and reject,
> which resolves the same row, did not carry it."* **Two agents, one hour apart,
> reading the same file, found the same missing term** — and the fix landed on
> one of the four sites rather than on the class, which is exactly the shape §7 D2
> is about.
>
> ### 4 — the helper whose doc comment says it cannot be skipped is skipped 14 times in its own file
>
> `commands/tools/triggers.rs:101-103`:
>
> > *"Shared by every command that mutates a trigger — centralizes both the lookup
> > and the ownership check so a new command can't accidentally skip it."*
>
> `triggers.rs` holds **31 commands, 17 of which take a singular `<entity>_id`.
> Three call `ensure_trigger_owned`.** The other fourteen did not skip it by
> forgetting — the helper's signature *requires* a `persona_id`, so **the way to
> skip the check is to not ask for one**, and `resolve_pending_trigger_fire(id)`,
> `dry_run_trigger(id)`, `validate_trigger(id)`,
> `clear_webhook_request_logs(trigger_id)`, `replay_webhook_request(log_id)` and
> `webhook_request_to_curl(log_id)` all do exactly that. `annotations.rs` is the
> same story in 79 lines: `add_annotation` and `list_execution_annotations` both
> verify, and `delete_annotation(id)` — 25 lines below — takes no owner at all.
>
> **A centralised check whose parameter list is the enforcement mechanism is
> defeated by a narrower signature, not by a careless caller.** That is
> qualification 3 with the arrow reversed: it is not that nobody constructs the
> type — it is that declining to construct it is free and invisible.
>
> ### 5 — the tier annotation is not an ownership check, and on the async path it is not a check at all
>
> Measured, both halves:
>
> | | n |
> | --- | ---: |
> | `#[requires(privileged)]` on a command | 168 |
> | `#[requires(cloud)]` / `#[requires(auth)]` | 56 / 19 |
> | commands in `PRIVILEGED_COMMANDS` / `CLOUD_COMMANDS` | 191 / 50 |
> | listed as privileged but carrying no attribute | 33 |
> | **`#[requires(privileged)]`, ASYNC, and absent from both lists** | **10** |
> | commands reaching an ownership check (depth ≤ 1) | 31 |
> | ↳ that are `PRIVILEGED` | **0** |
>
> `require_privileged` (async, `ipc_auth.rs:547-562`) checks that the session token
> was *initialised* and returns `Ok(())`. It never inspects what the caller sent —
> the file says so (`:544-546`: *"For async commands the thread-local flag may not
> be reliable (tokio task migration), so we verify the security system is
> initialised and log"*). Primary enforcement is the invoke-handler wrapper, which
> keys on `PRIVILEGED_COMMANDS`. So for those **10 async commands the attribute
> expands to a `tracing::debug!` and nothing else** — the list itself records a
> prior instance of this (`ipc_auth.rs:121-122`: *"each already carried
> `#[requires(privileged)]` but was absent from this list, which for an async
> command is ZERO enforcement"*).
>
> And `require_auth` / `require_auth_sync` — **1,253 call sites (958 sync + 295
> async, 1,251 of them under `src/commands/`), the most-called guard in the
> tree**, plus 19 more reached through `#[requires(auth)]` — are `Ok(())`
> unconditionally
> (`ipc_auth.rs:477-479`, `:535-537`). A second HTTP surface has already been
> built on top of that fact and says so:
> `commands/infrastructure/dev_tools_http.rs:6-8` mounts **31 unauthenticated
> loopback routes** with the justification *"The underlying scan command is
> already unauthenticated on the IPC surface (`require_auth` is a no-op), so this
> exposes nothing the running app's frontend can't already do."*
>
> **Authentication and authorization are two axes and this repo has measured
> coverage on neither where they meet: 0 of its 31 ownership-checking commands is
> privileged (30 are public, 1 is cloud), and 0 of its 191 privileged commands
> checks ownership.**
>
> ### Sibling boundaries, settled in prose
>
> [**conditional-write**](./conditional-write.md) owns whether a write's
> precondition is in the `WHERE` clause and whether its verdict is read. **This
> path owns what the precondition is *about*** — the row's owner rather than its
> state — and supplies the number that document left implicit: of its 65 guarded
> single-row writes, **45 guard `status` and exactly 1 guards an owner**
> (`memory_ledger.rs:865`). Its mechanism is correct here and almost unused for
> this purpose.
>
> [**idempotent-invocation**](./idempotent-invocation.md) owns whether the *same*
> request arriving twice creates two effects. **This path owns whether the request
> was this caller's to make at all.** Its D2/D3 and this path's D2 are the same
> four lines of `remote_commands.rs` seen from two directions: it wants a key on
> the spawn, this wants a device term on the PATCH, and both are one expression.
>
> [**job-claim-and-lease**](./job-claim-and-lease.md) owns the fence around work
> already claimed. **This path owns the fence around a row addressed by name**;
> `get_running_only` (§7 D5) is where the two meet and neither has it.
>
> [**second-transport-exposure**](./second-transport-exposure.md) owns *whether a
> transport should carry this behaviour at all* and whether it authenticates.
> **This path owns what happens after it has.** The two meet at
> `dev_tools_http.rs` — that path measures the exposure, this one quotes the
> module header's own justification (*"`require_auth` is a no-op"*) as §5's
> evidence. Its `unauthenticated-transport-route` rule and this one's
> `caller-asserted-owner` are the authn and authz halves of one question and
> share no match position.
>
> [**repository-crud-surface**](./repository-crud-surface.md) owns whether a
> single-row read reports that the row did not exist. **This path owns whether
> "does not exist" is the right answer when it does exist and is not yours** —
> `management_api.rs:1857-1866` says yes and is the only place in the tree that
> does.
>
> The **Deviations** section is a fix backlog and contains **one live user-facing
> defect that fires on the operator's own machine** (D1), **one cross-device write
> path with no device scope** (D2), and eleven one-to-three-line repairs.

---

## 1 Trigger

- "The caller gave me an id — how do I know it's theirs?"
- "Can persona A read persona B's execution log?" / "Can device A cancel device B's job?"
- "Should this take a `persona_id` / `project_id` / `workspace_id` parameter?"
- "The list endpoint is unscoped but the detail endpoint checks — is that fine?"
- "It's `#[requires(privileged)]`, isn't that enough?"
- "This row has a parent. Do I need to check they're in the same project?"

If you are about to type `caller_*_id`, `verify_*_owner`, `ensure_*_owned`,
`does not belong`, `get_by_id(pool, &id)` inside a command, `WHERE id = ?1` on a
table that has an owner column, `persona_id: Option<String>` on a list command,
or `#[requires(privileged)]` while believing it answers "whose row is this" —
you are in this situation.

**Not this path:** *whether the caller is authenticated at all* is `ipc_auth.rs`
and the tier annotations; *whether a write's precondition about the row's STATE
is read* is [conditional-write](./conditional-write.md); *whether a claimant
still holds its claim when it settles* is
[job-claim-and-lease](./job-claim-and-lease.md); *whether the same request
arrives twice* is [idempotent-invocation](./idempotent-invocation.md); *whether a
missing row is reported as missing* is
[repository-crud-surface](./repository-crud-surface.md).

## 2 The one way

**Put the scope term in the `WHERE` clause of the statement that does the work,
and take the scope from somewhere the caller cannot write.** Concretely: (a) **the
scope must be server-derived** — read it from a local settings row
(`cursor::resolve_device_id`), from a token's own grant
(`execute:persona:<id>`), from an env pin, or from a *different* row the server
itself fetched (`ctx.project_id`, `persona.id`); **a parameter named
`caller_persona_id` is not a scope, it is the caller's opinion**, and this repo
has no session concept that would make it one. (b) **The scope belongs in the
predicate, not in an `if` after the fetch** — one statement,
`… WHERE id = ?1 AND project_id = ?2`, so the wrong row is *absent* rather than
fetched-then-rejected; `memory_ledger.rs:860-869` is the only site in 781
single-row statements that does this to a write, and it is the one to copy.
(c) **Never verify with one statement and act with another.** Seven of this
repo's nine scoped statements are `SELECT 1 …` / `SELECT COUNT(*) …` existence
probes followed by an *unscoped* `UPDATE`/`INSERT` — a check-then-act that is
both a TOCTOU and a second place to forget. (d) **A denial must be
indistinguishable from an absence.** Return `NotFound`, not `Auth` — a 403 on a
row you may not see confirms it exists; `management_api.rs:1857-1866` returns
A2A `-32001 "Task not found"` and its comment names the reason
(*"an attacker holding any valid API key could enumerate executions across
personas by guessing IDs"*), while all 16 caller-asserted checks answer
differently: **10 `AppError::Validation`, 5 `AppError::Auth`, 1 a bare `false`,
0 `NotFound`, and 15 of 16 name the owner in the message.**
`verify_execution_owner`'s *"Execution does not belong to the specified
persona"* answers a question it was asked not to. (e) **Scope the LIST, not just the
detail** — a detail guard is worth nothing when the list beside it returns
`SELECT e.*` for every owner, and 15 of this repo's 144 list commands make the
scope `Option<String>` where omitting it means *all*. (f) **A tier annotation
answers a different question**; `#[requires(privileged)]` says *may you call
this command*, never *may you touch this row*, and 0 of the 31 commands here
that check ownership are privileged. (g) **If the surface genuinely has one
tenant, do not build a check that reads its answer off the wire** — delete the
parameter, scope the query by a value you own, and let the absent row speak.
Then stop: do not add a second verification read, do not add a role table for a
single-user app, and do not add a `caller_*` parameter to a new command.

If you must get one right first: **(a)**. (b), (c) and (d) all fail visibly the
first time someone tries them. (a) fails silently and permanently, and the check
above it will look like it is working.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src/cloud/sync/cursor.rs:103` `resolve_device_id(pool)` | **the scope derivation to copy.** Reads a device id from local settings, mints one on first use. Server-owned, restart-stable, unforgeable from the wire. Paired with `target_device_id=eq.{device}` it is the repo's only end-to-end scoped fetch |
| `src/commands/infrastructure/memory_ledger.rs:860-869` | **the one scoped WRITE in 781 single-row statements.** `UPDATE memory_nodes SET … WHERE id = ?3 AND project_id = ?4 AND status = 'active' AND (…)` — the scope, the state guard and the no-op guard in one predicate. Copy this shape before you write any check-then-act |
| `src/engine/management_api.rs:1857-1866` (`handle_tasks_get`) · `:1932-1941` (`handle_tasks_cancel`) | **the one site to copy for the DENIAL.** `if row.persona_id != persona.id` → A2A `-32001 "Task not found"` + `404`, where `persona` came from `find_by_id_if_exposed` and never from the request body. `:1798-1801` states the anti-enumeration reason |
| `db/src/repos/core/personas.rs:666-676` `find_by_id_if_exposed` | the **exposure gate** — a fetch that returns `None` unless the row is externally visible. A server-side filter the caller has no term for. Layer it *above* the ownership comparison, as the A2A handlers do |
| `src/engine/management_api.rs:335-390` `authorize(method, path, scopes)` | **object-level capability, and the strongest authorization design in the tree.** `/api/execute/{persona_id}` accepts broad `personas:execute` **or** `execute:persona:<that id>`; `/api/proxy/{credential_id}` accepts `proxy:credential:<that id>` and then re-checks default-deny in `credential_broker::authorize_credential_use` before a secret resolves. The grant names the object |
| `src/cloud/remote_commands.rs:212-218` `validate_command_id` | the **injection guard that protects the scope term**: a caller-supplied id is parsed as a UUID before interpolation, because PostgREST would otherwise let `x&status=eq.pending` widen the `WHERE` clause and defeat the device filter. If you build a filter from a caller string, this is the shape |
| `src/cloud/sync/rows.rs:126-156` (`SyncedPersonaRow`, siblings) | **the projection as a type.** One struct per synced table, `user_id` deliberately absent because the server stamps it. The compile-time answer to `SELECT e.*` |
| `engine/src/p2p/remote_jobs.rs:750-763` `expect_job` | ownership against a **cryptographically authenticated** comparand: the QUIC peer identity from the signed Hello/HelloAck handshake, already filtered by `require_paired` (`:221`). Its doc comment is the principle in one line — *"pairing is not a licence to rewrite another device's history"* |
| `db/src/repos/resources/teams.rs:536-563` | the honest check-then-act: two `WHERE id = ?1 AND team_id = ?2` probes **inside an `IMMEDIATE` transaction** with the write, so the window is closed by the transaction rather than by hope. If you must probe, probe like this |
| `src/mcp_server/tools.rs:407-427` `resolve_context_project` | the **hybrid**: an env pin (`PERSONAS_DEV_PROJECT_ID`, validated against `dev_projects`) takes precedence, and only then does the caller's `project_id` apply. Server-derived when configured — which is what an MCP client should get |
| `src/commands/tools/triggers.rs:104` `ensure_trigger_owned` | the centralisation *intent*, worth keeping and worth fixing — see §7 D3 for why 14 of 17 siblings escape it |

**Do NOT build:** a `caller_*_id` parameter (§7 D1 — the repo has 12 and they are
the subject of §9's gate); a per-command copy of `verify_execution_owner` (there
are already **four byte-identical copies** because the original is a private
`fn`, §7 D4); a role/permission table for a single-tenant desktop app; a second
verification read after a scoped write; an `AppError::Auth` on a row the caller
may not know exists (use `NotFound`); a list command whose scope is
`Option<String>` unless you have written down what `None` means.

## 4 Steps

1. **Name the owner, in words.** "This row belongs to a ____." If the answer is
   "the machine" — a connector catalog, a radio station, a template — you are not
   in this situation and a bare `WHERE id = ?` is correct. Say so in the doc
   comment so the next reader does not add a check.
2. **Find where the server already knows the owner.** A settings row, a token
   grant, an env pin, or a row you are about to fetch anyway. **If there is no
   such place, stop and say that in the doc comment** — do not manufacture one by
   adding a parameter. This is the step that decides everything and it is the step
   `verify_execution_owner` skipped.
3. **Put the scope in the `WHERE` clause of the statement that does the work.**
   `… WHERE id = ?1 AND <owner> = ?2`. Not a probe, not an `if`. One statement.
4. **Read the affected-row count and treat 0 as absence.** This is
   [conditional-write](./conditional-write.md)'s step 4 and it is why the two
   paths compose: the scope term makes the wrong row unmatched, and the count is
   the only way you learn that. `Result<()>` cannot carry it.
5. **Return the same error a missing row returns.** `AppError::NotFound`, A2A
   `-32001`, HTTP 404. Never a message that names the owner, and never a distinct
   status for "exists but not yours".
6. **Scope the list command in the same commit.** If the detail command is
   scoped and the list is not, you have moved the disclosure, not closed it — and
   `SELECT e.*` means the list ships every column the detail command guards.
7. **Ask whether the signature can make the wrong call impossible** — before
   §9's gate, not after. See *Prefer a type over a gate*: the honest answer here
   is that a type reaches the *derivation* and not the *predicate*, and the
   derivation is where the defect lives.
8. **And then stop.** Do not add a role table, a policy DSL, or a
   post-write verification read. If the statement affected 0 rows, the row was
   not yours or was not there; those are the same answer and that is deliberate.

## 5 Anti-patterns

- **A check whose comparand is a parameter of the same command.** *Failure:* the
  caller supplies both halves, so the comparison is an assertion about the
  request rather than about the requester. **Executed: 2,188 of 2,188 executions
  pass `verify_execution_owner` using only values `list_all_executions` already
  returned.** 16 of the tree's 23 ownership assertions are this shape (§9).
- **Guarding the detail while the list is open.** *Failure:* the guarded command
  returns nothing the unguarded one did not. `get_execution` and
  `list_all_executions` return the identical 38 columns; the list takes
  `persona_id: Option<String>`, and 15 of 144 list commands do the same.
- **Verifying with one statement and acting with another.** *Failure:* two places
  to forget, plus a window between them. **7 of this repo's 9 scoped statements
  are existence probes** followed by an unscoped write —
  `dev_tools.rs:3431` proves the target group is in the project, then
  `:3446` writes `WHERE id = ?3`; `idea_scanner.rs:1096` proves both goals are in
  the project, then calls `add_goal_dependency(pool, from, to, …)` unscoped.
  `teams.rs:536-563` is the same shape done correctly, inside an `IMMEDIATE`
  transaction.
- **Reasoning about the scope on the read and not on the write.** *Failure:* the
  paragraph that explains the hazard sits forty lines above a write that ignores
  it. `remote_commands.rs` scopes 3 reads by `target_device_id` and **1 of 4
  writes** — and that one was fixed mid-composition by a parallel session that
  reached the same conclusion from the same comment (§7 D2). The convergence sweep found the same author-level failure in
  `personas-web`, which serialised its *filesystem* path against TOCTOU and left
  the *SQL* path in the same function unguarded.
- **A denial that confirms existence.** *Failure:* `AppError::Auth("Execution
  does not belong to the specified persona")` distinguishes "no such execution"
  from "someone else's execution", which is exactly the bit an id-guesser wants.
  `management_api.rs:1861` returns "Task not found" for both and says why.
- **Treating `#[requires(privileged)]` as an ownership check.** *Failure:* it
  answers "may you call this", and for an **async** command absent from
  `PRIVILEGED_COMMANDS` it answers nothing at all — 10 such commands exist, and
  `require_auth`/`require_auth_sync` (1,253 call sites) are `Ok(())`.
- **Escaping a centralised check by narrowing the signature.** *Failure:* invisible
  in review, because there is nothing on the page to notice. `ensure_trigger_owned`
  is called by 3 of the 17 id-taking commands in its own file;
  `delete_annotation(id)` sits 25 lines below two commands that verify.
- **A client fallback that supplies a wrong owner rather than none.**
  *Failure:* the guard fires on the user's own row and the error is
  misattributed. `executionSlice.ts:256` passes
  `executionPersonaId ?? activeExecutionId` — **the execution id as the claimed
  owner** — and the `catch` two lines down is commented *"Backend unreachable"*
  (§7 D1).

## 6 Evidence

**The one site to copy: `src/engine/management_api.rs:1795-1873` `handle_tasks_get`.**
Read it as five decisions: (1) the scope comes from the **path**, and is then
re-resolved server-side through `find_by_id_if_exposed`, which can return `None`
for a reason the caller has no term for; (2) the row is fetched by the
caller-supplied id; (3) `if row.persona_id != persona.id` compares against the
**server's** resolved persona, not against a body field; (4) the denial is
`-32001 "Task not found"` + `404`, **byte-identical to the not-found path three
branches above it**; (5) the comment at `:1857-1859` names the threat rather than
the rule — *"Without this check, an attacker holding any valid API key could
enumerate executions across personas by guessing IDs."* `handle_tasks_cancel`
(`:1932-1941`) repeats it exactly, which is what a doctrine looks like when it
has been applied twice.

Runner-up, for the **write**: `src/commands/infrastructure/memory_ledger.rs:860-869`
— the scope, the state and the no-op guard in one `UPDATE … WHERE id = ?3 AND
project_id = ?4 AND status = 'active' AND (title != ?1 OR …)`, count bound at
`:870`. For the **scope derivation**: `src/cloud/sync/cursor.rs:103` plus
`remote_commands.rs:240-245`. For **withholding the owner entirely**:
`src/cloud/sync/rows.rs:14-16`.

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`,
`../vibeman`, `../ascent`. **All five exist and all five were opened.** Two
measurement caveats shaped the result and both are findings: `vibeman` was first
reported clean on the strength of its *documented* trust model and had to be
**re-measured against its code**, which inverted four of five applicable clauses;
and a keyword count is a lead, not a finding — `brainiac`'s corpus is ~44%
template-generated fixture text.

> **Evidence density is uneven and the table says so.** `vibeman` was swept
> twice and carries most of the `file:line` citations below; the other four were
> swept once. Where a clause's verdict rests on a single repo it is written as
> "INVERTED in `vibeman`", not as a family verdict — and the two clauses that
> ARE family verdicts (4 and 7) are the two where every repo was checked
> individually.

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **The scope term lives in the `WHERE` clause of the fetch** | **PHYSICS in 4 of 5 · `vibeman` INVERTED structurally** | `vibeman` has **0** statements carrying both a row-id predicate and `project_id`, verified twice — and it is structural, not incidental: `generic.repository.ts:92,126,149`, the CRUD factory behind 19 repositories, exposes `getById(id)`/`update(id,…)`/`deleteById(id)` with **no projectId parameter**, and `repository.utils.ts:202` types the scope as an **XOR**, `idField: 'id' \| 'project_id' = 'id'`. The helper *cannot emit* `WHERE id = ? AND project_id = ?`. 47 SELECT / 115 UPDATE / 85 DELETE unscoped, **10 with no `WHERE` at all**. Personas' 9-of-781 is thin; `vibeman`'s is zero **by type**. |
| 2 | **The claimed owner is derived server-side, never from the request that supplied the id** | **PHYSICS where an auth context exists · INVERTED in 2** | The sharpest negative in the sweep is `vibeman` `goals/route.ts:212-217`: `const existingGoal = goalRepository.getGoalById(id); … checkProjectAccess(existingGoal.project_id, request)` — **the scope passed in is the row's own**, so the check verifies the row against itself. `accessControl.ts:74-86` then hardcodes `role = 'admin'`, and `verifyProjectExists` is **fail-open on exception** (`:96-107` returns `true` from its `catch`). It has **no reachable denial path**. The correctly-shaped helper, `verifyResourceOwnership(resourceProjectId, claimedProjectId)` (`accessControl.ts:294`), has **0 call sites**. Personas' `caller_persona_id` is the same defect one degree less degenerate: the comparand is at least a *different* value, it is just one the caller also chose. |
| 3 | **A denial is indistinguishable from an absence** | **NEAR-SILENCE everywhere, Personas split 2 : 16** | Personas does it right on the A2A surface (2 sites, `-32001 "Task not found"` + 404, with the anti-enumeration reason written at `management_api.rs:1857-1859`) and nowhere else: of the 16 caller-asserted checks, **10 return `AppError::Validation`, 5 return `AppError::Auth`, 1 returns a bare `false`, 0 return `NotFound`, and 15 of 16 name the owner in the message.** Ten of them answer a 403-shaped condition with a 400. No sibling wrote down a deliberate 403-vs-404 decision either. Reported as a **silence**: outside one file in one repo, nobody asked the question. |
| 4 | **Ownership verification is centralised** | **PHYSICS as intent, INVERTED as adoption — in 4 of 5** | Every repo *built* the middleware and then routed around it. `vibeman` `withAccessControl`: **5 call sites of 261 routes, all 5 `skipProjectCheck: true`**; `RoutePatterns.protected`/`.admin`: **0 call sites**; `createParamsRouteHandler:197-199` (used by all 8 `[id]` routes) *records* `accessControl: minRole` in an audit registry and applies nothing. Personas' analogue is `ensure_trigger_owned` at 3 of 17 and `verify_execution_owner` copied verbatim four times because it is a private `fn`. **The pattern is universal and it is the adoption that fails, not the knowledge.** |
| 5 | **A list is scoped by owner BY DEFAULT** | **INVERTED in 2, and identically** | `vibeman` `projectFilter.ts:26-28`: omitting `?projectId` returns `{ mode: 'all' }` — every project's rows — used in 4 route files. Personas: `persona_id: Option<String>` on **15 of 144** list commands, `None` meaning all, including `list_all_executions`. **Two repos independently chose the same permissive default for the same reason (a global dashboard view needs it), and neither scoped the per-owner case separately.** |
| 6 | **An authn/tier annotation is not treated as authorization** | **INVERTED here, N/A in `vibeman`** | Personas is the family's clearest instance: 1,253 no-op `require_auth*` calls, 10 async `#[requires(privileged)]` commands with zero enforcement, and a second HTTP surface (`dev_tools_http.rs:6-8`, 31 routes) whose stated justification is that the IPC guard is a no-op. `vibeman` is N/A rather than inverted — a constant `'admin'` is not an annotation being mistaken for authorization; there is nothing to mistake. |
| 7 | **A TYPE makes the unscoped access unrepresentable** | **NO TRACE — 0 in all six repos, and the nearest candidate INVERTS** | No scoped-repository handle, no tenant newtype, no ORM tenant-injection anywhere. `vibeman`'s nearest candidate actively inverts: `ideaQueryBuilder.ts:35` makes `.project()` optional and `buildWhereString` returns `''` with zero filters (`:204`), so `queryIdeas().delete()` emits `DELETE FROM ideas` **with no `WHERE`** — which `idea.repository.ts:305` does deliberately. Personas' `SyncedPersonaRow` family (`cloud/sync/rows.rs`) is the closest thing in six repos to a type-level answer and it constrains the *projection*, not the *predicate*. |

**Physics — keep as doctrine:** clauses 1, 2 and 4 (each independently present or
independently *attempted* in 4 of 5), and clause 5 as physics-of-failure.
**Inverted:** clause 6, which is Personas' own. **Reported as silence:** clause 3
is barely asked anywhere, and clause 7 is a unanimous absence across six repos —
which is the strongest argument in this document that the honest answer is not a
type (see below).

> **The single most transferable finding, and it is not about ownership at all.**
> **Three of the five repos had ownership predicates that silently evaluated to a
> constant** — `ascent`'s `!isAuthConfigured()` failing open and
> `readableOrgForOwner` failing closed, and `vibeman`'s `hasMinimumRole('admin', …)`
> — **and none of them failed loudly.** A term missing from a `WHERE` clause is
> visible in a diff; a predicate that is always `true` is not. That is clause 1
> and clause 7 argued from evidence rather than from principle, and it is why §2
> puts the scope in the statement rather than in a helper.

> **A port that dropped the containment, again.** `vibeman`
> `disk/file/route.ts:33-47` confines writes to registered project roots with the
> rationale written down — *"Confining here turns an arbitrary-disk read/write
> into a project-scoped one"*. Its Rust successor **in the same repo**,
> `vibeman/src-tauri/src/commands/fs_cmds.rs:53` (verified: no such file exists in
> Personas), is labelled
> `// File read/write/check (replaces /api/disk/file)` and carries **no
> containment at all**; same for `batch_read_files:99` and `search_files:133`.
> This is the second time in this corpus that a hand-port dropped precisely the
> mechanism that lived in a filter expression
> ([conditional-write](./conditional-write.md) §6 found `personas-cloud` dropping
> a compare-and-set the same way). **A scope that lives in a predicate does not
> survive being retyped by a careful engineer.**

## 7 Deviations

Every entry is live on `master` @ `f1b61ad73`. All 23 ownership assertions and all
9 scoped statements were opened and read.

### D1 — the ownership guard's only observed production effect is to make the operator abandon their own running job

`src/stores/slices/agents/executionSlice.ts:252-269` and `:809-824`.

On restart, execution recovery calls
`getExecution(activeExecutionId, executionPersonaId ?? activeExecutionId)`.
`executionPersonaId` is `string | null` (`:142`) and is rehydrated from persisted
state at `:230`, so it **can be null** — and the fallback then passes **the
execution id as the claimed persona**. `verify_execution_owner` rejects with
`AppError::Auth`. The `catch` at `:263` is commented *"Backend unreachable — do
NOT clear execution state"*, sets `executionVerificationFailed: true`, and
`PersonaRunner.tsx:140-152` renders an amber banner with **Retry** and
**Dismiss (abandon)**. Retry (`:815`) uses the same `personaId ?? execId`
fallback and therefore fails identically, forever. Dismiss calls
`finalizeRecovered` and drops the run.

**An authorization rejection is misread as a network failure, on the user's own
row, with a destructive affordance attached.** *Fix:* two lines — do not call
`getExecution` when the persona is unknown (there is nothing to verify against),
and distinguish `AppError::Auth` from a transport failure in the `catch`.

### D2 — a device can reject or expire a remote command targeted at another device

`src/cloud/remote_commands.rs` @ `b3178e460`. The reads are scoped by
`target_device_id=eq.{device}` (`:137`, `:202`, `:248`) with the comment at
`:240-244` explaining exactly why. **Three of the four writes drop it:**

- **`:146-150` the poll's auto-expire** — `PATCH pending_commands?id=eq.{c.id}`,
  no device term and no status term. A command approved between the poll's `GET`
  and its `PATCH` is stamped `expired` **while it executes**, and a command
  targeted at device B can be expired by device A.
- **`:104-106` `set_command_status`** — `?id=eq.{id}`, `let _ = client.patch(…)`,
  so the device term, the status precondition **and** the `Result` are all
  dropped in one statement. This is the settle, i.e. the write that stamps the
  outcome of a run.
- **`:282-285` `remote_command_approve`'s claim** — `?id=eq.{id}&status=eq.pending`.
  Exclusive (that was `1ad67db14`) but **not device-scoped**, forty lines below
  the comment that says RLS scopes to the tenant and not to the device.

**`remote_command_reject` (`:356-364`) was fixed in `b3178e460` while this
document was being written** and is now the model: device term, status term, and
`patch_returning_count` with a zero treated as a lost race.

**These are defects to repair, not capabilities to exercise.** *Fix:* copy
`:356-364` to the other three — append `&target_device_id=eq.{device}` (and
`&status=eq.pending` / `&status=eq.executing` respectively) and route them
through `patch_returning_count` so a zero is observable. `resolve_device_id` is
already in scope at two of the three.

### D3 — `ensure_trigger_owned` is called by 3 of the 17 id-taking commands in its own file

`src/commands/tools/triggers.rs:104`. Its doc comment
(`:101-103`) says it exists *"so a new command can't accidentally skip it"*.
Callers: `update_trigger` (`:129`), `set_trigger_unattended_mode` (`:168`),
`delete_trigger` (`:234`). Not callers, because their signatures take no owner:
`resolve_pending_trigger_fire(id)` (`:183`), `validate_trigger(id)` (`:285`),
`dry_run_trigger(id)` (`:1356`), `unlink_persona_from_event(trigger_id)` (`:1143`),
`list_webhook_request_logs(trigger_id)` (`:1754`),
`clear_webhook_request_logs(trigger_id)` (`:1764`),
`replay_webhook_request(log_id)` (`:1774`),
`webhook_request_to_curl(log_id)` (`:1836`),
`get_composite_partial_match(trigger_id)` (`:1993`).
*Fix:* the helper cannot fix this — see *Prefer a type over a gate*. The
tractable half is `dry_run_trigger` and `resolve_pending_trigger_fire`, which
**mutate or spend**, and which the repo's own privileged list already treats as
sensitive (`dry_run_trigger` is `PRIVILEGED` while `update_trigger` is public —
the two gates disagree about which command is dangerous).

### D4 — four byte-identical copies of a seven-line check, because the original is `fn`, not `pub fn`

`commands/execution/executions.rs:25` `verify_execution_owner` is **module-private**.
So:
- `commands/execution/annotations.rs:29-34` inlines it (`add_annotation`),
- `commands/execution/annotations.rs:54-59` inlines it again
  (`list_execution_annotations`),
- `commands/execution/healing.rs:87-92` inlines it a third time
  (`get_retry_chain`) — **in a file that calls `verify_healing_owner` twice, ten
  lines above, for the other entity type.**
- `engine/src/healing_timeline.rs:122` is the `pub` sibling, and is the only one
  a second module can reach.

*Fix:* make `verify_execution_owner` `pub(crate)` and delete the three copies —
but read *Prefer a type over a gate* first, because all four copies compare
against a caller-supplied value and consolidating them makes one wrong answer
instead of four.

### D5 — `get_running_only` has no instance filter, so a second process fails the leader's live runs

`db/src/repos/execution/executions.rs:1357-1367` is
`SELECT * FROM persona_executions WHERE status = 'running'` — repo-wide, no
instance term. Its only caller, `ExecutionEngine::recover_stale_executions`
(`src/engine/mod.rs:703-732`), runs at **startup on every instance** and marks
every returned row `Failed` with *"App restarted while execution was running"*.
The repo already has the column for the missing term:
`persona_executions.claimed_by_instance` (`migrations/incremental.rs:3615-3630`)
and a per-launch identity (`engine/leadership.rs:103` — a fresh UUID per
process). And it is not merely un-gated: `src/lib.rs:815` calls it **before
leadership is acquired at `:1250`**, and `lib.rs:481-482` says so —
*"Loop gating on `is_leader()` lands in a later phase."* **A second instance
fails the first instance's live runs before it has learned it is not the
leader.**
*Fix:* `AND (claimed_by_instance IS NULL OR claimed_by_instance = ?1)` with the
instance id, and adopt `claim_for_instance` — which
[conditional-write](./conditional-write.md) D2 measured at **0 production callers
and 0 of 2,188 live rows**.

### D6 — 15 list commands make the owner optional, and `None` means every owner

`persona_id: Option<String>` on `list_all_executions` (`:65`), `count_executions`
(`:88`), `search_executions` (`:97`), `list_healing_issues`
(`healing.rs:16`), `list_healing_audit_log` (`:174`), `list_memories`
(`memories.rs:24`), `list_memories_with_stats` (`:148`),
`list_persona_memory_review_proposals` (`:1056`), `list_persona_jobs`
(`persona_jobs.rs:123`), `list_build_sessions` (`build_sessions.rs:669`),
`list_manual_reviews` (`reviews.rs:997`), `list_manual_reviews_page` (`:1027`),
`list_director_verdicts` (`director.rs:78`), `list_director_experiments`
(`:177`), `list_events` (`events.rs:23`). Against **28** list commands that
require a scope and **101** that have none at all.
Each is *individually* correct — a global Activity view needs the unscoped
form — and collectively they are the reason the detail guards buy nothing.
*Fix:* not "remove the option". Split the door: a `list_all_*` that is explicitly
global and a `list_*_for_owner(owner)` that is explicitly not, so the call site
declares which it meant. `executions.rs` already has both
(`list_executions(persona_id: String)` and `list_all_executions`) and the UI uses
the unscoped one.

### D7 — `list_all_executions` ships `SELECT e.*`, including the column the cloud projection deliberately withholds

`db/src/repos/execution/executions.rs:288` selects `e.*` — all **38** columns —
while `src/cloud/sync/rows.rs` builds a typed projection per table and its own
test asserts the execution row omits `log_file_path`, `execution_flows`,
`claimed_by_instance` and `claim_expires_at` (`:985`). So the same column is
*device-local plumbing, never to leave the machine* on one surface and part of an
unscoped list payload on another. It matters because `get_execution_log`
(`executions.rs:632-663`) is one of the eight guarded commands, and its own
comment (`:645-655`) explains that historical logs still contain plaintext
credentials and are masked **on read** — a masking that lives in the guarded
command, not in the column.
*Fix:* an explicit column list on `get_all_global`, mirroring the cloud
projection's discipline. This is a one-statement change and it makes the guard on
the detail command mean something for the first time.

### D8 — 7 of the 9 scoped statements verify with one statement and act with another

`db/src/repos/dev_tools.rs:3431` (then an unscoped `UPDATE … WHERE id = ?3` at
`:3446`) · `db/src/repos/dev_workspaces.rs:1765` and `:2722` (then
`INSERT OR IGNORE`) · `src/commands/infrastructure/idea_scanner.rs:1096` (then
`add_goal_dependency(pool, from, to, …)`) ·
`src/commands/infrastructure/memory_ledger.rs:359` (then an unscoped
`INSERT OR IGNORE INTO memory_edges`) · `src/mcp_server/tools.rs:594` (read-only,
benign). Only `memory_ledger.rs:865` puts the scope in the write, and only
`teams.rs:536-563` closes the window with an `IMMEDIATE` transaction.

> **How 9 was arrived at.** A lexer over all 3,145 production statements found
> **773 whose `WHERE` contains an `id = ?N` term**; flattening nested parens to
> drop subquery predicates (a `WHERE` such as
> `SET document_count = (SELECT COUNT(*) … WHERE kb_id = ?1 AND status='indexed')
> … WHERE id = ?1` reads as scoped and is not) cut the id-addressed population to
> **781** and the scoped candidates to **13**. All 13 were opened: 3 were
> subquery artefacts (`commands/credentials/vector_kb.rs:1376`,
> `engine/kb_ingest.rs:670`, `engine/background.rs:2692`) and 1 was a state guard
> misread as a scope (`db/src/repos/dev_tools.rs:7635`, `AND context_id IS NULL`).
> **9 survive**, and the first pass — before subquery flattening — reported 17.
> A scope term inside a subquery looks exactly like a scope term.
`dev_tools.rs:3423-3427` has the best comment in the tree on *why* the check
exists — *"the `group_id` FK … never enforces same-project — so without this a
context could be silently moved into a group from another project"* — and the
write below it is unscoped.
*Fix:* fold the probe into the write's predicate; the count is then the verdict
([conditional-write](./conditional-write.md) §2).

### D9 — the artefact is absent, and that is a fact about the caller, not the guard

Swept both live databases (read-only copies). `personas.db`: **241 tables, 172
declared foreign keys across 130 of them**; 14 owner-pairs joinable through a
declared FK, plus 11 more through references inferred by ≥50% value overlap, plus
13 hand-chosen high-risk pairs. **Zero cross-owner references, in every pair.**

That is *not* evidence the guards work. It is evidence that the only caller is a
UI that reads the owner off the row it is asking about — which is the same fact
as §1. What the sweep *did* find is a different defect class, listed here so the
number is not lost: **880 of 2,942 `execution_traces` (30%), 980 of 5,720
`persona_tool_usage` (17%), 76 `persona_healing_issues` and 50 of 106
`assertion_results` point at an execution that no longer exists**, and 923
executions name a `use_case_id` with no row. Those are dangling references from
deletes that did not cascade; they belong to a parent-fate leaf, not this one.

### D10 — 73 `#[tauri::command]` functions are not registered, and 3 more were invisible to my own test-file filter

Two independent implementations of "how many commands are there" disagreed:
brace-matched extraction says **1,661 definitions / 1,658 distinct names**; the
codegen that parses `lib.rs`'s `invoke_handler!`
(`src/lib/commandNames.generated.ts`) says **1,585 registered**. The 73 declared
but unregistered include `create_execution` (which carries
`#[requires(privileged)]`), `dev_tools_move_context_to_group` (the function
carrying §7 D8's best comment), and `trigger_ai_healing`. Dead IPC surface is not
this leaf's subject, but an unregistered command that still compiles is a place a
future `invoke_handler!` edit can open a door nobody reviewed.

## 8 Gaps — what the primitives genuinely cannot do

1. **There is no server-held identity for a check to compare against.**
   `AppState` (`src/lib.rs:369-414`) has a `db`, an `engine`, an `auth` (Google
   OAuth, for cloud), a `session_key` and a `tier_config` — and no "current
   persona", "current project" or "current workspace". `caller_persona_id` is not
   a lazy choice; it is the **only** value available, and until something owns a
   per-session scope, every fix in §2(a) on the IPC surface is unavailable. This
   is the root cause of 16 of the 23 assertions and it is an architecture gap, not
   a code defect.
2. **The census can ratchet a presence and cannot assert an absence.** "This
   command takes an id and checks nothing" is 855 absences; "this list has no
   owner term" is an absence; "no code path re-derives the device" is an absence.
   §9 gates the one member of this family that *is* a presence — a check that
   exists and asks the caller — and §9's rejected-candidates table publishes the
   numbers for the four absences it could not.
3. **No type reaches inside a SQL predicate.** `AND project_id = ?2` is a word in
   a string; `AND project_id = ?2` misspelled is a query that returns 0 rows
   forever, indistinguishable from a scope that keeps losing. This is the same
   wall [conditional-write](./conditional-write.md) hit, for the same reason, and
   it is why §2(b) is prose.
4. **A comparand's provenance is not visible at the comparison.** `p.project_id
   != project_id` at `genome.rs:105` is *correct* (the local was bound from
   `first_persona.project_id` at `:100`); `v.persona_id != persona_id` at
   `lab.rs:90` is *the defect*; they are the same seven tokens. §9 excludes the
   first by path with a written reason because no bounded pattern can tell them
   apart, and that limitation is the honest form of Gap 1.
5. **PostgREST filters are string concatenation.** The device scope on the cloud
   surface is `format!("…&target_device_id=eq.{device}")`. Nothing types it,
   nothing requires it, and `validate_command_id` exists precisely because the
   *other* interpolated value could otherwise rewrite the filter. A missing term
   in a `format!` string is invisible to every tool in the repo.
6. **Two enforcement lists and one attribute must agree, and nothing checks
   them.** `PRIVILEGED_COMMANDS` (191) and `CLOUD_COMMANDS` (50) are
   hand-maintained `&[&str]` arrays; `#[requires(privileged)]` (168 commands) is
   an attribute. Neither knows about the other. Today: 33 listed without an
   attribute (harmless), **10 with the attribute and absent from both lists**
   (zero enforcement for async), and 0 entries naming a command that does not
   exist. That last number is luck, not a gate.
7. **A denial's error type is not the error the client matches on.** Personas
   returns `AppError::Auth` for a failed ownership check and `AppError::NotFound`
   for a missing row, and the frontend's `resolveError`
   (`src/lib/errors/errorRegistry.ts`) maps by message text. Changing the denial
   to `NotFound` per §2(d) is therefore a **user-visible copy change** as well as
   a security change, and both halves must land together.

## Prefer a type over a gate

**Held against all seven qualifications. The honest answer is that no type
reaches this leaf's defect, and the reason is Gap 1 — you cannot make a value
unforgeable when the process has nowhere else to get it.** That is a finding, and
it is the case the doctrine says genuinely earns a census rule.

The obvious proposal, and why each form fails:

```rust
/// The scope a request is permitted to act within. Constructible ONLY from a
/// value the server owns.
pub struct Scope(String);
impl Scope {
    pub fn from_local_device(pool: &DbPool) -> Self { … }   // resolve_device_id
    pub fn from_token_grant(g: &Grant) -> Option<Self> { … } // execute:persona:<id>
    pub fn from_row<T: Owned>(row: &T) -> Self { … }         // ctx.project_id
}
pub fn get_scoped<T>(pool: &DbPool, id: &str, scope: &Scope) -> Result<T, AppError>;
```

1. **A required prop carries only what it actually encodes.** ✔ `Scope` encodes
   "a value the server derived". It does **not** encode "this caller is entitled
   to it" — and conflating those is exactly the `successRateSource` failure. On
   the IPC surface there is no entitlement to encode, which is the next
   qualification's problem.
2. **Requiredness is orthogonal to closedness.** ✔ **And this is what rules out
   the fix a reader reaches for first.** Making the owner *required* has already
   been tried here: `caller_persona_id: String` is a **required positional
   parameter on all 12 commands** — nobody can omit it — and the check is still
   worthless, because requiredness constrains the caller's *effort*, not the
   value's *provenance*. Closedness on the constructor is the whole win.
3. **A type nobody constructs constrains nothing.** ✘ **This is the qualification
   that refuses the proposal.** Count the construction sites `Scope` would have on
   the day it shipped: `from_local_device` — **5** (every `resolve_device_id` call
   in the tree, 4 in `remote_commands.rs` and 1 in `cloud/sync/mod.rs:422`);
   `from_token_grant` — **2** (`/api/execute/`, `/api/proxy/`); `from_row` — **5**
   (the positive control's server-derived comparands). **Twelve, in 963 files, and
   every one of them is already correct today.**
   The 886 id-taking commands could not construct one, because Gap 1 means there
   is nothing to construct it *from*. A type adopted only by the code that was
   already right is a comment. The corpus has this exact counter-example already:
   `claim_for_instance` is correct, tested, and has 0 production callers.
4. **A type anyone can construct authenticates nothing.** ✔ — and this is the
   qualification the brief asked me to test, which **holds and generalises**.
   `Scope(String)` with a private field cannot be forged. But the thing it would
   protect is already unforgeable *in Rust* and forgeable *on the wire*: the
   defect is not that a Rust caller can build a `String`, it is that a JSON body
   can. **A newtype at the Rust boundary is downstream of where the value
   entered.** Generalised: a type authenticates nothing when the untrusted value
   crosses a serialization boundary before the type exists. This is a fourth
   place types cannot reach, alongside the doctrine's SQL-string, `OnceLock` and
   environment-variable cases.
5. **Withholding beats requiring.** ✔ — **and the repo has already run this
   experiment and won it.** `cloud/sync/rows.rs` withholds `user_id` from the
   projection entirely because the server stamps it, and its result is a surface
   with **no ownership check at all and no way to get it wrong**. That is the
   design §2(a) prescribes, and it is available wherever a server-side value
   exists. Where none exists, withholding is unavailable too.
6. **Withhold the dangerous freedom, not the answer.** ✔ The dangerous freedom is
   *naming your own scope*. The answer — which rows you get — is untouched.
   Applied to the IPC surface the correct withholding is to **delete
   `caller_persona_id` from the 12 signatures** and let the query be scoped by a
   value the process owns; §2(g) says so, and it is a smaller change than the
   type.
7. **Withholding a requirement only helps when the requirement was forcing the
   bad value.** ✔ **Directly applicable and it decides the fix order.** Nobody
   *forced* `get_execution` to take a persona id — the parameter was added to
   enable a check. Relaxing it (`Option<String>`) is inert-to-harmful: it would
   let the check silently degrade. **The construction to withhold is the caller's
   ability to name the scope at all**, and the way to withhold it is to remove
   the parameter, not to wrap it.

**So: the type is refused, on qualification 3, with the count (10 construction
sites, all already correct).** The prescription that survives is architectural
and ordered: **(1)** give the IPC surface a server-held scope, or accept that it
has one tenant and delete the 12 `caller_*` parameters (both are honest; the
current state is not); **(2)** fix D2's four cloud writes, where a server-derived
scope already exists and is simply not used; **(3)** move the 7 check-then-act
probes into their write's predicate; **(4)** keep §9's rule as the ratchet on
checks that ask the caller, and delete it when the count reaches zero.

## 9 The missing gate

**The condition, stated stack-free:** *an authorization decision is made by
comparing a property of the resource against a value that arrived in the same
request that named the resource — so the requester supplies both the question and
the answer, and the check can only fail for a caller who chose to fail it.*

An adopting repo must re-derive its own proxy. This one keys on a Rust `if`
comparing a struct field named `<owner>_id` against a bare identifier. A repo on
Prisma spells the identical condition as
`prisma.x.findFirst({ where: { id, userId: body.userId } })` and this pattern
scores a **structural zero** there while the condition is present at scale —
`vibeman` `goals/route.ts:212-217` is the same defect in a *more* degenerate form
(the comparand is the row's own field) and would match neither this pattern nor a
naive one.

**Where it runs:** `npm run census` / `npm run census:check` — local, and invoked
by the pre-push hook. Explicitly **not** a CI-only gate: `ci.yml` now runs its
Rust tests but is red on 10 pre-existing failures, so a gate that only runs there
runs nowhere.

### Existing rules checked first, by reading each definition rather than its title

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `blind-identity-write` (35/82) | a repo fn returning `Result<()>` whose write's **entire** `WHERE` is `id = ?N`, count discarded | Nearest neighbour on the population, opposite on the question: it asks whether the caller learned the row was missing. Also scoped to `src-tauri/db/src/repos`; **11 of 11 of this rule's files are outside that root** — zero file overlap. |
| `discarded-guard-verdict` (7/11) | a guarded single-row `UPDATE` in statement position | About a predicate on the row's **state** and whether its verdict is read. Its own §7 measures 45 of 65 guards naming `status` and **1** naming an owner. Disjoint: that rule matches SQL literals, this matches Rust `if` conditions. |
| `unfenced-work-outcome-write` (6/11) | an outcome write addressed by identity alone | The settle at the end of claimed work. Also SQL-literal-shaped. Zero overlap. |
| `unkeyed-billable-spawn` (11/13) | a spawn passing `None` for the idempotency key | Whether the same request arrives twice, not whose request it is. Its D2 and this D2 are the same file seen from two sides, and neither rule matches the other's positions. |
| `unchecked-destination-id-assertion` (19/54) | `as SidebarSection` etc. — a destination id asserted into a vocabulary | TypeScript, `src/`, and about a *value's vocabulary*, not a row's owner. |
| `autonomy-verdict-outside-the-front-door` (4/5) | a "may this run unattended" verdict computed from raw config | The closest in *spirit* — a policy decision taken at a call site instead of the door — and it keys on settings reads. No shared match. |
| `verdict-write-outside-door` (6/8) | a human verdict written without the one door | TS, `src/`, about which door a **write** goes through. |
| `build-gated-ipc-entrypoint` (1/127) · `untyped-command-payload` (40/104) · `persistence-handle-in-command-tree` (46/134) | IPC registration, payload types, raw pool checkout | All three key on the command surface and none on a comparison. Verified: no position overlap. |
| `unauthenticated-transport-route` (4/79) — **added `b3178e460`, mid-composition** | every `.route("` registration in `src-tauri`, ratcheting the count of second-transport surfaces | The authn half of the same question, and re-checked after it landed. It matches **`.route("` string literals in router builders**; this rule matches **Rust `if` conditions in command bodies**. Zero position overlap and zero file overlap (its 4 files are `management_api.rs`, `dev_tools_http.rs`, `local_http/mod.rs`, `webhook.rs`; none of this rule's 11). |
| `optional-store-handle` (`Option<&DbPool>`) | a nullable persistence handle at a boundary | Unrelated. |

**None of the 106 existing rules** (104 at the start of composition, plus
`anonymous-retry-budget` and `unauthenticated-transport-route` added by a
parallel session at `b3178e460` and re-checked before publishing) **keys on an
authorization decision whose comparand came from the request. Proposing one.**

### Measurement

**Precision 16/16 — every match opened and read**, as were the 5 controls and the
2 exclusions: **23 of 23 anchor matches hand-verified.**

Two independent implementations, and **they agreed exactly**: the census engine
from the published pattern, and a Rust-lexer walk that brace-matches every `if`
body and classifies the comparand structurally (no regex over raw source, no
shared code). Both return **16 violating / 11 files** and **5 compliant / 4
files**, with the same membership. Agreement is not soundness, which is why all
23 were also read by hand — and the reading is what produced the two exclusions.

The **partition is the control**, which is stronger than a ratio. An anchor
rule that accepts *any* comparand (`!= [^{\n]{1,80}`) returns **23**:

| | matches | files |
| --- | ---: | --- |
| **anchor** — every `if <row>.<owner>_id != … {` with an error/absence consequent | **23** | 17 |
| ↳ **violating** — comparand is a bare identifier from the request | **16** | 11 |
| ↳ **compliant** — comparand is a field of a server-fetched row (the control) | **5** | 4 |
| ↳ **excluded by path, with a written reason** | 2 | 2 |

16 + 5 + 2 = 23 exactly, so **there is no unexamined third population**.
**70% of this repo's ownership assertions ask the caller for the answer; 22% do
not.**

**Two false-positive families excluded by construction, not by allowlist:**

1. **`==` comparisons.** Restricting to `!=` costs **0** true positives (all 16
   use `!=`) and removes `owned_devices.rs:42` (`local.peer_id == peer_id`, a
   self-registration guard, not a row-ownership check) and `identity.rs:70`
   (which had landed in the *control* on the strength of a dotted comparand —
   `card.peer_id` — that is in fact **parsed from a caller-supplied string**).
   That near-miss is the sharpest thing the partition taught me: **"the comparand
   has a dot, therefore the server fetched it" is a heuristic, and it fails in
   both directions.** It is why the two remaining exceptions are path exclusions
   with prose rather than pattern tweaks.
2. **Comparisons inside `#[cfg(test)]`.** Verified by brace-matched range against
   all 21 surviving match sites: **0 inside test code**, and structurally, tests
   here build fixtures through `exec_owned_by`-style helpers rather than
   hand-writing the comparison.

**Two disclosed recall gaps, both with a number:**

1. **Closure-form checks.** `get_chain_trace` (`executions.rs:757-763`,
   `.filter(|t| t.persona_id == caller_persona_id)` then `if owned.is_empty()`)
   and `get_chain_stop_reasons` (`:788-793`, `.any(…)`) are caller-asserted and
   invisible to an `if`-shaped pattern. **Recall on the caller-asserted set is
   therefore 16/18 (89%)**, and both misses are in the file that already
   contributes a match.
2. **SQL-side caller-asserted scoping.** `WHERE id = ?1 AND project_id = ?2`
   where `?2` came from the request is the *right shape* with the *wrong
   provenance*, and this rule is Rust-comparison-shaped. Of the 9 scoped
   statements, **6 bind a caller-supplied scope** (`teams.rs:537`/`:552`,
   `memory_ledger.rs:359`/`:865`, `idea_scanner.rs:1096`,
   `dev_workspaces.rs:1765`) and 3 bind a server-derived one. Left out
   deliberately: gating the correct shape would punish the migration §2(b) is
   asking for.

**Backtracking:** the only broad fill is `(?:[^;{}]|[;{}]){0,400}?`, a bounded
lazy repetition over a complete partition of the alphabet with no nested
quantifier and no same-span alternation. Full 963-file run: **0.5 s**;
`commentMatchesSkipped: 0` on both rules.

**Validated standalone** in a composer-private registry
(`registry-ownership-verification-composer.json` — a filename unique to this
composer, because sibling composers share the scratchpad), then **re-extracted
from this finished document and re-run: `files 11 / matches 16` and
`files 4 / matches 5`, identical both times.** `--check` passes at the published
baseline over 963 files against a floor of 900.

### The rule

```json
{
  "rules": [
    {
      "id": "caller-asserted-owner",
      "goldenPath": "docs/concepts/golden-paths/ownership-verification.md",
      "title": "An ownership check compares a fetched row's owner field against a value that arrived on the SAME request as the row id, so the caller supplies both halves of the comparison",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\bif\\s+!?\\s*[A-Za-z_]\\w*\\s*\\.\\s*(?:persona_id|project_id|workspace_id|team_id|twin_id|peer_id|device_id|owner_id|user_id|group_id)\\s*(?:\\.\\s*as_deref\\s*\\(\\)\\s*)?!=\\s*(?:Some\\s*\\(\\s*)?&?\\s*[a-z_]\\w*(?:\\s*\\.\\s*(?:as_str|as_deref|trim|to_string|clone)\\s*\\(\\))?\\s*\\)?\\s*(?:\\|\\|[^{\\n]{0,120})?\\{(?:[^;{}]|[;{}]){0,400}?(?:Err\\s*\\(|bail!|return\\s+false|AppError::|StatusCode::NOT_FOUND|::error\\s*\\(|not found|not_found)",
        "flags": "g",
        "ignoreCommentLines": true,
        "$measured": "2026-08-16 @ f1b61ad73 — 963 .rs files walked, floor 900, run 0.5s, commentMatchesSkipped 0; two independent implementations (census engine + a Rust-lexer brace-matching walk) agree at 16/11 and 5/4 with identical membership; all 23 anchor matches opened and read; live counts from read-only copies of personas.db (241 tables, 172 declared FKs) and personas_data.db.",
        "description": "An `if` comparing a FETCHED ROW'S OWNER FIELD (`<recv>.persona_id` / `.project_id` / `.workspace_id` / `.team_id` / `.twin_id` / `.peer_id` / `.device_id` / `.owner_id` / `.user_id` / `.group_id`) against a BARE IDENTIFIER — no field access — whose body reaches an error or a not-found within 400 chars. The bare identifier is the signal: in this tree it is, without exception, a `#[tauri::command]` parameter or a fn parameter threaded from one, i.e. A VALUE THAT ARRIVED ON THE SAME REQUEST THAT NAMED THE ROW. PROXY FOR the stack-free condition: an authorization decision is made by comparing a property of the resource against a value supplied by the requester, so the requester supplies both the question and the answer and the check can only fail for a caller who chose to fail it. THE SHAPE IS NOT AN ACCIDENT OF THE AUTHOR: somebody deliberately fetched the row and deliberately compared its owner - these are the repo's ownership checks, not code that forgot to have one - which is why this rule counts a PRESENCE (a check that asks the caller) rather than the 855 absences around it, and why its positive control is the SAME assertion with a server-derived comparand. EXECUTED, not argued (node:sqlite, 2026-08-16, statements transcribed verbatim from db/src/repos/execution/executions.rs:288-293 and commands/execution/executions.rs:25-35, against a READ-ONLY COPY of the operator's 347 MB personas.db): list_all_executions(persona_id=None) returns `SELECT e.*` - all 38 columns including persona_id AND log_file_path - for every persona, and replaying verify_execution_owner with the comparand the UI actually passes (ExecutionDetail.tsx:53 `getExecution(executionId, execution.persona_id)`) gives PASS 2188 / FAIL 0 across the whole table. The guarded command returns ZERO columns the unguarded list did not. MEASURED 2026-08-16 at f1b61ad73: 16 matches across 11 of 963 .rs files, ALL SIXTEEN OPENED AND READ (precision 16/16), commentMatchesSkipped 0. Population and partition: an anchor accepting ANY comparand matches 23; this rule takes 16, the positive control takes 5, and 2 are excluded by path with written reasons - 16 + 5 + 2 = 23 exactly, so no unexamined third population. THE SIXTEEN: commands/execution/executions.rs:29 (verify_execution_owner, the cross-persona read barrier behind EIGHT IPC commands, with three unit tests of its own at :1117-1144); commands/execution/annotations.rs:30 and :55 plus commands/execution/healing.rs:88 - three BYTE-IDENTICAL inline copies of that function's body, which exist because the original is a module-private `fn` and a sibling module cannot reach it, and :88 sits ten lines below two calls to the `pub` sibling verify_healing_owner; engine/src/healing_timeline.rs:126 (that pub sibling); commands/execution/lab.rs:90, :292, :671, :1064 and commands/communication/observability/prompt_lab.rs:212 (prompt-version ownership, `v.persona_id != persona_id`, both from the args); commands/tools/triggers.rs:110 (ensure_trigger_owned, whose doc comment at :101-103 says it is 'shared by every command that mutates a trigger so a new command can't accidentally skip it' and which 3 of the 17 id-taking commands in its own file call); commands/infrastructure/workspace_harvest.rs:160 and :386 plus workspace_verify.rs:210 (project-in-workspace); commands/infrastructure/dev_tools/triage_ingest.rs:222 and idea_scanner.rs:1058 (idea-in-project). THE ROOT CAUSE IS ARCHITECTURAL AND THE RULE SAYS SO: AppState (src/lib.rs:369-414) holds a db, an engine, a Google-OAuth `auth`, a session key and a tier config - and NO notion of a current persona, project or workspace. There is no server-side value these checks could have used instead; the caller is the only source, by construction. That is why the fix is not a newtype (see the golden path's 'Prefer a type over a gate', which REFUSES one on qualification 3 with the count: a Scope type would have TWELVE construction sites in 963 files and all twelve are already correct) but either a per-session scope or the honest deletion of the parameter. THE FIVE COMPLIANT SITES ARE THE DOCTRINE: engine/management_api.rs:1860 and :1935 compare `row.persona_id != persona.id` where `persona` came from find_by_id_if_exposed - a SERVER-side exposure-gated fetch - and return A2A -32001 'Task not found' + 404, byte-identical to the genuine not-found path, with the comment at :1857-1859 naming the threat ('an attacker holding any valid API key could enumerate executions across personas by guessing IDs'); commands/tools/automation_suggestions.rs:68 and commands/infrastructure/dev_tools_http.rs:1396 compare two rows the server itself fetched; db/src/repos/core/memories.rs:1126 refuses to merge two memories with different owners. TWO EXCLUSIONS, BY PATH WITH A REASON, NOT BY WEAKENING THE PATTERN - and each is a case where a comparand's PROVENANCE is invisible at the comparison (the golden path's Gap 4). RESTRICTED TO `!=` DELIBERATELY: `==` costs zero true positives (all 16 use !=) and removes two semantic false positives, network/owned_devices.rs:42 (`local.peer_id == peer_id`, a self-registration guard) and network/identity.rs:70 - and that second one is the sharpest methodological lesson here, because it had landed in the POSITIVE CONTROL on the strength of a dotted comparand (`card.peer_id`) that is in fact parsed from a caller-supplied string. 'The comparand has a dot, therefore the server fetched it' is a heuristic and it fails in BOTH directions; that is why the two remaining exceptions are path exclusions with prose rather than pattern tweaks. TWO DISCLOSED RECALL GAPS: (1) closure-form checks - executions.rs:757-763 get_chain_trace does `.filter(|t| t.persona_id == caller_persona_id)` then `if owned.is_empty()`, and :788-793 get_chain_stop_reasons does `.any(..)`; both are caller-asserted and invisible to an if-shaped pattern, so recall on the caller-asserted set is 16/18 (89%) and both misses are in a file that already contributes a match. (2) SQL-side caller-asserted scoping - `WHERE id = ?1 AND project_id = ?2` where ?2 came from the request is the RIGHT SHAPE with the WRONG PROVENANCE; of the tree's 9 scoped single-row statements 6 bind a caller-supplied scope (db/src/repos/resources/teams.rs:537 and :552, commands/infrastructure/memory_ledger.rs:359 and :865, idea_scanner.rs:1096, db/src/repos/dev_workspaces.rs:1765) and 3 bind a server-derived one. Left out deliberately: gating the correct shape would punish the migration the golden path's section 2(b) is asking for. ZERO MATCHES INSIDE #[cfg(test)], verified by BRACE-MATCHED RANGE against all 21 surviving match sites - never a line threshold - and structurally, because tests here build fixtures through helper constructors rather than hand-writing the comparison. DOES NOT OVERLAP blind-identity-write, its nearest neighbour on the population and its opposite on the question: that rule asks whether the caller learned the row was MISSING and is scoped to src-tauri/db/src/repos, and 11 of 11 of this rule's files are outside that root - zero file overlap. Nor discarded-guard-verdict or unfenced-work-outcome-write, both of which match SQL LITERALS about a row's STATE while this matches Rust `if` conditions about its OWNER (discarded-guard-verdict's own section 7 measures 45 of 65 guards naming `status` and exactly ONE naming an owner). Nor unkeyed-billable-spawn, whose D2 and this path's D2 are the same four lines of cloud/remote_commands.rs seen from two directions with no shared match position. Nor unchecked-destination-id-assertion, verdict-write-outside-door, build-gated-ipc-entrypoint, untyped-command-payload or persistence-handle-in-command-tree. TWO INDEPENDENT IMPLEMENTATIONS AGREED EXACTLY: the census engine from this pattern, and a Rust-lexer walk that brace-matches every `if` body and classifies the comparand structurally with no regex over raw source and no shared code - both 16 violating across 11 files and 5 compliant across 4, same membership. Agreement is not soundness, which is why all 23 anchor matches were ALSO read by hand, and the reading is what produced the two exclusions. BACKTRACKING: the only broad fill is `(?:[^;{}]|[;{}]){0,400}?`, a bounded lazy repetition over a complete partition of the alphabet with no nested quantifier and no same-span alternation; full 963-file run 0.5s. LEGAL FIX, in order: give the IPC surface a server-held scope and derive the comparand from it (src/cloud/sync/cursor.rs:103 resolve_device_id is the shape), OR accept that the surface has one tenant and DELETE the caller_* parameter along with the check, scoping the query by a value the process owns. Do NOT silence a match by renaming the parameter, by moving the comparison into a helper (four byte-identical copies already exist for that reason), or by widening the comparand to `Some(x)` - all three preserve the defect. PRECONDITION (must be re-derived per repo): this repo compares owner fields in Rust `if` statements against snake_case parameters. A repo on Prisma spells the identical condition as prisma.x.findFirst({where:{id, userId: body.userId}}) and this pattern scores a structural zero there while the condition is present at scale - vibeman's goals/route.ts:212-217 is the same defect in a MORE degenerate form (it passes the row's OWN project_id into the access check, so the check verifies the row against itself, and its denial path is unreachable because accessControl.ts:74-86 hardcodes role='admin' and verifyProjectExists fails OPEN from its catch at :96-107) and would match neither this pattern nor a naive one. END OF LIFE: this rule is designed to reach zero. When the count reaches 0 the runner fails structurally on zero-matches, BY DESIGN: DELETE the rule then, do not baseline it at 0."
      },
      "exclude": [
        {
          "path": "src-tauri/engine/src/p2p/remote_jobs.rs",
          "reason": "`expect_job` (:757) compares job.peer_id against the QUIC peer identity established by the SIGNED Hello/HelloAck handshake (connection.rs:462) and already filtered by require_paired (:221) — a transport-authenticated comparand, not a body field. Its doc comment (:745-749) is the best one-line statement of this leaf in the tree ('pairing is not a licence to rewrite another device's history'). It is the compliant form wearing the violating shape, and no regex separates a &str parameter carrying a signed identity from one carrying a request field."
        },
        {
          "path": "src-tauri/src/commands/execution/genome.rs",
          "reason": "genome_start_breeding (:105) compares p.project_id against a `project_id` local bound SEVEN LINES EARLIER from first_persona.project_id.clone() (:100) — server-derived, merely rebound to a bare identifier. `p.project_id != project_id` here and `v.persona_id != persona_id` at lab.rs:90 are the same seven tokens with opposite provenance; no bounded pattern can tell them apart, which is the golden path's Gap 4."
        }
      ],
      "baseline": { "files": 11, "matches": 16 },
      "floor": 900
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "caller-asserted-owner-positive-control",
  "goldenPath": "docs/concepts/golden-paths/ownership-verification.md",
  "title": "POSITIVE CONTROL — the same ownership assertion whose comparand is SERVER-DERIVED (a field of a row the server itself fetched)",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\bif\\s+!?\\s*[A-Za-z_]\\w*\\s*\\.\\s*(?:persona_id|project_id|workspace_id|team_id|twin_id|peer_id|device_id|owner_id|user_id|group_id)\\s*(?:\\.\\s*as_deref\\s*\\(\\)\\s*)?!=\\s*(?:Some\\s*\\(\\s*)?&?\\s*[a-z_]\\w*\\s*\\.\\s*[a-z_]\\w*(?!\\s*\\()\\s*\\)?\\s*(?:\\|\\|[^{\\n]{0,120})?\\{(?:[^;{}]|[;{}]){0,400}?(?:Err\\s*\\(|bail!|return\\s+false|AppError::|StatusCode::NOT_FOUND|::error\\s*\\(|not found|not_found)",
    "flags": "g",
    "ignoreCommentLines": true,
    "$measured": "2026-08-16 @ f1b61ad73 — validated standalone in a composer-private scratch registry, then re-extracted from this document and re-run; 4 files / 5 matches both times.",
    "description": "CONTROL, not a gate. The IDENTICAL anchor as caller-asserted-owner — the same owner-field alternation, the same `!=`, the same error/absence consequent within 400 chars — differing in ONE clause: the comparand is a FIELD ACCESS (`persona.id`, `kpi.project_id`, `suggestion.persona_id`, `mem_b.persona_id`) rather than a bare identifier, i.e. a value the SERVER fetched rather than one the request supplied. The two are mutually exclusive by construction: one requires a bare identifier there, the other requires an `ident.ident`. MEASURED 2026-08-16 at f1b61ad73: 5 matches across 4 files versus the gate's 16 across 11. PARTITION, NOT A RATIO: an anchor accepting ANY comparand (`!= [^{\\n]{1,80}`) matches 23, and 16 + 5 + 2 excluded = 23 exactly, so every ownership assertion in 963 .rs files is classified and there is no unexamined third population. WHAT THE FIVE DEMONSTRATE IS THE DOCTRINE, NOT MERELY COMPLIANCE: engine/management_api.rs:1860 (handle_tasks_get) and :1935 (handle_tasks_cancel) resolve the persona through find_by_id_if_exposed — a server-side EXPOSURE GATE the caller has no term for — and then deny with A2A -32001 'Task not found' + HTTP 404, byte-identical to the genuine not-found branch three arms above, with the reason written at :1857-1859; commands/tools/automation_suggestions.rs:68 and commands/infrastructure/dev_tools_http.rs:1396 compare two rows the server fetched itself; db/src/repos/core/memories.rs:1126 refuses a merge across owners. A control that merely counted 'has an ownership check' would also pass for the 16 violations; that the compliant five are ALL server-derived comparands, and that two of them are also the tree's only 404-shaped denials, is the evidence behind the golden path's section 2(a) and 2(d). IT HAS ALREADY CAUGHT ONE ERROR IN ITS OWN PARTITION: on the first run network/identity.rs:70 landed HERE, in the control, because its comparand `card.peer_id` is a field access — and `card` is parsed from a caller-supplied identity-card STRING. Restricting both rules to `!=` removed it at zero cost to the gate's 16. 'The comparand has a dot, therefore the server fetched it' is a heuristic that fails in both directions, and that is exactly what this control exists to expose. If this count ever collapses toward the gate's, the shared anchor has broken and BOTH numbers are meaningless. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; the census engine exempts a `-positive-control` id from the baseline requirement and the registry merge skips it by construction."
  },
  "floor": 900
}
```

### Gates I rejected, with numbers

| candidate | violating | compliant | why rejected |
| --- | ---: | ---: | --- |
| **a command taking a singular `<entity>_id` with no ownership check** — the headline condition | **855** | 31 | 96.5% of the population would fire. That is a to-do list, not a ratchet, and most members are correct: connectors, templates, radio stations and skill definitions have no owner. The honest discriminator ("does this entity have an owner?") has **no textual signal**, and the count is carried in §7 and the headline table instead. |
| **a mutating command with an entity id and no owner parameter** — D3's escape hatch | **114** | 59 | Precision unscoreable for the same reason, and the split is wrong: `delete_annotation(id)` is a defect and `radio_set_station(station_id)` is not, and they are the same shape. Carried as D3, where the *same-file* contrast (3 of 17 in `triggers.rs`, 2 of 4 in `annotations.rs`) supplies evidence a count could not. |
| **a command taking an entity id AND a distinct owner id with no check in its body** | 40 | 19 | **Precision fails on the check-then-delegate case**: `create_team_connection(team_id, source_member_id, target_member_id)` has its check in `teams.rs:537`, one call away, and a text matcher cannot follow the call. A call-graph pass at depth 1 moves 14 of the 40 into the compliant column, and the census engine has no call graph by design. |
| **a list command whose owner parameter is `Option<String>`** — D6 | 15 | 28 | 100% structural precision and **semantically wrong most of the time**: a global Activity view legitimately needs `None`. The defect is that one door serves two intents, which is a refactor (§7 D6's fix), not a violation to count. |
| **a `WHERE id = ?N` on a table that has an owner column** | ~678 | 9 | The largest and most tempting population, and unscoreable without the schema: the pattern is in a SQL string and the column list is in `schema.rs` / 400 migration steps. A rule firing 678 times whose true-positive rate is unknown is exactly what the contract rules out. |
| **`#[requires(privileged)]` async and absent from `PRIVILEGED_COMMANDS`** — §5's zero-enforcement set | **10** | 158 | Genuinely tempting: 100% precision and a real gap. Rejected because the census matches within ONE file and this condition is a **join across two files** — the attribute in `commands/**` and the list in `ipc_auth.rs`. The right instrument is a Rust unit test that walks the registered command list and asserts the two agree, which does not exist and is specified in Gap 6. |

The pattern across those six rejections is the shape of the whole leaf:
**having a check is a presence; needing one is an absence.** The census counts
presences, so the gate lands on the one member of the family that is one — a
check that exists and asks the caller for its answer — and the other five
findings are held by §7, by the refused type, and by two instruments this repo
does not yet have (a scope-agreement unit test, and a schema-aware scan).

### What the census fundamentally cannot gate here

- **"This value came from the request."** `p.project_id != project_id` at
  `genome.rs:105` is correct and `v.persona_id != persona_id` at `lab.rs:90` is
  the defect, in the same seven tokens. Provenance is a dataflow property; the
  two path exclusions above are the honest admission, and each fails loudly if it
  stops matching.
- **"Nothing anywhere checks this."** Every absence in §7 — no device term on
  four PATCHes, no instance term on `get_running_only`, no owner on 855 commands
  — was found by enumerating a population and subtracting, which is a program.
- **"This scope term can never be wrong."** `AND project_id = ?2` misspelled
  compiles, runs, and matches 0 rows forever. Same wall as
  [conditional-write](./conditional-write.md) Gap 6, same reason.
- **The runtime instrument this leaf actually wants** is a counter on every
  ownership assertion reporting how often it has *denied*. Today the answer for
  `verify_execution_owner` is knowable only by replay, and the replay says
  **0 of 2,188**. A check that has never denied anything is either unnecessary or
  broken, and nothing in the repo can tell you which.

## 12 Corrections to the brief

1. **"There are 1,666 `#[tauri::command]` functions" — the true figure is 1,661**,
   and the same number is wrong by 5 in
   [idempotent-invocation](./idempotent-invocation.md)'s sweep note. Raw
   occurrences: **1,673**; **12** are inside string literals or doc comments
   (`core/src/context_fingerprint.rs` ×3, `macros/src/lib.rs` ×4 — the `requires`
   macro's own doc example — `commands/testing/mod.rs`, `src/lib.rs` ×4);
   **0** are inside `#[cfg(test)]`. A second, fully independent implementation —
   the codegen that parses `lib.rs`'s `invoke_handler!` — says **1,585
   registered**, which is a different and also true number, and the 73-command gap
   is §7 D10.
2. **"`verify_execution_owner` exists and `get_execution` uses it" — true, and it
   is used by FIVE commands, not one**, with two more (`get_chain_trace`,
   `get_chain_stop_reasons`) implementing the same idea in closure form and three
   more (`annotations.rs` ×2, `healing.rs` ×1) **copying its body verbatim because
   it is a private `fn`**. The concept reaches 12 commands; the function reaches 5.
3. **"How many commands take an entity id and do NOT check it? That count is the
   headline" — the count is 855 of 886, and it is the wrong headline.** 96.5% is
   not informative, because most of those entities have no owner and correctly
   need no check. **The informative number is the other end: of the 23 ownership
   checks that DO exist, 16 ask the caller for the answer** — and the second-most
   informative is 9 of 781 single-row statements carrying a scope term. A
   near-total absence measured against a population that does not need the
   behaviour is a big number, not a finding.
4. **"The pattern's weakness is that the caller supplies BOTH the id and the
   claimed owner — qualification 4 territory. Test that." — CONFIRMED, and the
   qualification generalises.** Q4 says a type anyone can construct authenticates
   nothing. Here the *type* is fine — a private-field newtype would be unforgeable
   in Rust — and the value is forgeable anyway, **because it crossed a JSON
   boundary before the type existed**. So Q4's real content is not "public field
   bad": it is **"a type authenticates nothing when the untrusted value crosses a
   serialization boundary before the type does."** That is a fourth place types
   cannot reach, and it is why the type proposal is refused here on Q3 rather than
   patched.
5. **"A real instance of the class was found and is worth extending: approving a
   remote command scopes its fetch by `target_device_id` … Someone understood this
   problem precisely, once, in one place." — the brief undersells the good half and
   misses the bad half.** The reasoning is applied to **three** reads (`:137`,
   `:202`, `:248`), not one. And **all four writes in the same file drop it**,
   including the claim four lines below the comment. The instructive fact is not
   that someone understood it once — it is that the same author, in the same
   function, did not carry it across the read/write boundary, which is precisely
   the failure `personas-web` committed across the SQL/filesystem boundary and
   `vibeman` committed across a TS→Rust port.
6. **"`#[requires(privileged)]` is a tier annotation, not an ownership check. Do
   not conflate them; measure both." — measured, and the finding is stronger than
   "do not conflate".** The two are not merely different: they are **disjoint** in
   this repo. **0 of the 31 ownership-checking commands is privileged; 0 of the
   191 privileged commands checks ownership.** And on the async path the
   annotation is not a check of any kind — `require_privileged` returns `Ok(())`
   after a `tracing::debug!`, and 10 commands rely on it alone.
7. **"A prior path found `get_running_only` has no instance filter" — confirmed,
   and the consequence is worse than stated.** It is not only that a second
   process fails the leader's live runs; `recover_stale_executions`
   (`engine/mod.rs:703`) is **not leader-gated** (other loops in the same tree
   are), and the repo already carries both halves of the fix — a
   `claimed_by_instance` column and a per-launch `instance_id`
   (`leadership.rs:103`) — with `claim_for_instance` measured at 0 production
   callers by a sibling path.
8. **The leaf's `convergence: mixed` label survives and is the correct one.** The
   scope-in-the-predicate and server-derived-owner clauses are physics at 4 of 5;
   centralisation is physics as *intent* and inverted as *adoption* in 4 of 5;
   permissive list defaults are inverted identically in 2; the 404-vs-403 question
   is a near-silence nobody asked; and a type-level answer has **no trace in any of
   the six repos**. One label cannot carry that, and "mixed" is the honest one.
9. **How "31 of 886" was arrived at, and the two false positives I had to remove
   by hand.** A command counts as *checked* if its own body, or a function it
   directly calls, reaches one of the **23 hand-verified ownership assertions**,
   one of the **9 scoped single-row statements**, a `target_device_id=eq.` filter,
   `find_by_id_if_exposed`, or `scoped_context_block` — depth ≤ 1, because deeper
   propagation degenerates fast (depth 2 returns 91 and is mostly reachability
   noise). **21 of the 31 are direct and 10 are via a helper.** The raw run
   returned **34**, and three were **name-collision false positives**:
   `cloud_cancel_execution`, `cloud_update_trigger` and `cloud_delete_trigger`
   were credited because the *cloud client's* methods are called
   `cancel_execution` / `update_trigger` / `delete_trigger` — the same identifiers
   as the local guarded commands. A call-graph keyed on names rather than resolved
   paths will do this every time, and all three bodies were opened and contain no
   check. **The narrower in-body-only regex I first used returned 22, which was
   also wrong** — it missed the ten commands that delegate correctly. Both wrong
   numbers were plausible and neither arrived with an error.

   A third instance, from the re-extraction check itself: a `python` rewrite of
   this file converted every `
` to `
`, after which the extractor's
   `/```json
…/` regex found **zero** fenced blocks. It was caught in one second
   only because the extractor **prints the block count before doing anything with
   it**. Without that line it would have "re-extracted and re-run" an empty
   registry and reported success. That is the doctrine's *assert the instrument*
   rule earning its place in the smallest possible way.
10. **A methodology correction I owe against myself.** My first extraction excluded
   test files with the filename rule `/_tests?\.rs$/` — the plural-optional form —
   which swallowed **`src/commands/companion/browser_test.rs`, a production file
   holding three live IPC commands**, one of which returns a pairing token. It
   surfaced only because a second implementation (the `invoke_handler!` codegen)
   reported 3 commands mine did not. **The doctrine's `*_tests.rs` filename rule is
   itself a vocabulary rule and has the same recall failure as any other** — and,
   like the `head -3` case in `CLAUDE.md`, the wrong number arrived without an
   error.
