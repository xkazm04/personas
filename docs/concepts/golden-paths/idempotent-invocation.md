# Golden path — Idempotent invocation

> Situation node: `backend-runtime/command-definition/idempotent-invocation` ·
> [situation spine](../situation-spine.md) · recurrence 14 · risk **HIGH** ·
> sides: **both** · convergence: **diverged** ·
> dimensions: **function · resilience · cost · code-quality**
> Composed 2026-08-16 against `master` @ `19884e1f0`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri` and all **4,829**
> `.ts`/`.tsx` files under `src/`. Every `#[tauri::command]` function was
> extracted by brace-matching its body with `#[cfg(test)]` removed as
> **brace-matched ranges** (never a line threshold): **1,666** commands (**see
> the correction below**), of which
> **333** are named `list_`/`get_`/`fetch_`. Every frontend invocation site was
> counted twice — once by ripgrep, once by a TypeScript 6 AST walker resolving
> `import { invokeWithTimeout as invoke }` aliases — and **the two disagreed, and
> neither was right** (§12). All **15** production sites that can start a billable
> agent run were opened and read; so were `tauriInvoke.ts` (556 lines),
> `AsyncButton.tsx`, `Button.tsx`, `create_with_idempotency`, both pollers,
> `remote_commands.rs` and `queue.rs::admit` in full.
>
> **Correction, 2026-08-16 (one day after composition).** The command count
> here is **1,661**, not 1,666. `ownership-verification` re-counted with the
> same brace-matching but also excluded matches inside string literals and
> comments: 1,673 raw, 12 in strings/comments, 0 in `#[cfg(test)]`. Every ratio
> below whose denominator is the command count is therefore off by 5 in the
> conservative direction; none of the conclusions turn on it. `filesystem-boundary.md`
> records three different counts (1,657 / 1,661 / 1,666) from three composers —
> **1,661 is the one with a stated method for the discrepancy**, and is the
> number to cite.
>
> **Measured by execution, not by reading.** Six interleavings of *this repo's own
> idempotency path* were replayed against real SQLite (`node:sqlite`), every
> statement transcribed **verbatim** from
> `db/src/repos/execution/executions.rs:543-583`, the partial unique index from
> `db/src/migrations/incremental.rs:2139-2140`, and the caller's skip-spawn guard
> from `src/commands/execution/executions.rs:394`. The replay is what found §7 D1,
> which no amount of reading had: **the dedupe returns one row and still spawns two
> agents.**
>
> Read-only **copies** of the live `personas.db` (347 MB, 241 tables) and
> `personas_data.db` (68 tables) were queried — copied first, `readOnly: true`,
> the live files never opened for write while the app was running. Every table in
> both databases was swept for rows that differ only by id and timestamp, then the
> survivors were re-bucketed by the **time delta inside each duplicate group**,
> because a legitimate recurrence repeats days apart and a double-fire repeats in
> seconds. Nobody had looked for this artefact before; §7 D6 and D7 are what it
> returned.
>
> **`cargo` was not run** (the operator's app is running). Every Rust claim is
> static and traces to a file read during composition.
>
> ---
>
> ## The headline: this repo built a correct idempotency mechanism, wired it to 2 of 15 doors, and the door it wired it to spawns twice anyway
>
> `persona_executions.idempotency_key` is real. It has a **partial UNIQUE index**
> (`idx_pe_idempotency … WHERE idempotency_key IS NOT NULL`), a repository function
> that pre-checks and then falls back to `ON CONFLICT … DO NOTHING` with a re-read
> on the lost race, and a `#[tauri::command]` parameter to carry it over IPC. It is
> better than anything in three of the five sibling repos. Then:
>
> | | n | share |
> | --- | ---: | --- |
> | live executions in `personas.db` | 2,188 | |
> | ↳ carrying an `idempotency_key` | **12** | **0.55%** |
> | ↳ carrying a `traceparent` (the *tracing* correlation id) | 2,168 | 99.1% |
> | production call sites that can start a billable agent run | **15** | |
> | ↳ passing a key | **2** | **13%** |
> | distinct **mutation** commands invoked from the frontend | **669** | |
> | ↳ with an end-to-end idempotency key | **1** | **0.15%** |
> | frontend `executePersona` call sites | 22 | |
> | ↳ whose key survives a retry | **1** | **4.5%** |
>
> **The correlation id that nobody needs is on 99.1% of rows; the dedupe key that
> costs money is on 0.55%.** Both were added by migrations, both are `Option`, and
> the difference is that one is stamped by the infrastructure and the other is
> asked of the caller.
>
> Five findings are sharper than the ratio.
>
> ### 1 — the dedupe returns ONE row and still spawns TWO agents, and the window is the whole queue wait
>
> `create_with_idempotency` is correct. Its caller then asks a different question
> than the one it answered. `src/commands/execution/executions.rs:394`:
>
> ```rust
> // If idempotency dedup returned an already-started execution, skip the
> // engine spawn — it's already running (or finished). …
> if execution.status != "queued" {  …  return Ok(execution); }
> ```
>
> `create_with_idempotency` INSERTs with `status = 'queued'`, so a deduped row that
> has not started **is** `queued` — the guard's condition is false exactly when the
> dedupe fired. **Replayed against real SQLite, statements transcribed verbatim:**
>
> ```
> SCENARIO 2 — same key, concurrent, B pre-checks before A has left 'queued'
>   rows inserted = 1        ENGINE SPAWNS = 2
>   A: FRESH-INSERT   exec-A  status=queued  spawned=true
>   B: PRECHECK-HIT   exec-A  status=queued  spawned=true
>
> SCENARIO 3 — same key, both pre-checks miss, B loses the INSERT
>   rows inserted = 1        ENGINE SPAWNS = 2
>   A: FRESH-INSERT spawned=true    B: CONFLICT-REREAD spawned=true
>
> SCENARIO 4 — same key, A has already reached 'running'
>   rows inserted = 1        ENGINE SPAWNS = 1     <-- correct
> ```
>
> `ON CONFLICT … DO NOTHING` held the row count at 1 in every case: **the index
> works and the effect is not deduped.** So there is no duplicate row to find
> afterwards — which is why the live-database sweep, which found duplicates in 23
> other tables, found none here. **The artefact of this defect is an absence of an
> artefact.**
>
> And the window is not microseconds. `Engine::start_execution_with_priority`
> (`src/engine/mod.rs:864-950`) returns `AdmitResult::Queued` under per-persona or
> global concurrency pressure, quota cooldown, or resource pressure, storing the
> context in an in-memory map — **the row stays `queued` in the database for the
> entire queue wait.** `QueueTracker::admit` (`engine/src/queue.rs:253-308`) has no
> execution-id term, so the same `execution_id` is admitted or enqueued a second
> time. **Three layers, each individually reasonable, and not one of them
> idempotent on the request's identity.**
>
> ### 2 — the three things in this repo that dedupe correctly all dedupe on a value the SOURCE supplied
>
> | site | key | works? |
> | --- | --- | :-: |
> | `engine/discord_poller.rs:250` | `format!("discord:{}:{}", channel_id, msg.id)` | ✅ |
> | `engine/slack_poller.rs:296` | `format!("slack:{}:{}", channel_id, msg.ts)` | ✅ |
> | `commands/infrastructure/skill_usage.rs:459,:474` | the transcript line's **own** timestamp, `datetime(?)`-normalised | ✅ |
> | `src/api/agents/executions.ts:67` | `idempotencyKey ?? crypto.randomUUID()` | ❌ |
>
> The first three are replay-safe across a restart because the key is a property of
> *the request*, not of *the attempt*. The fourth is minted inside the function, so
> two clicks produce two keys, and `inflightByKey` gets two entries. **Replayed:**
>
> ```
> SCENARIO 1 — two clicks through src/api/agents/executions.ts:67
>   keys equal? false    rows inserted = 2    ENGINE SPAWNS = 2
>   >>> the dedupe was never reached
> ```
>
> Its comment says the default exists *"so every call is at least self-dedup'd
> against a concurrent duplicate (double-click, double-fire, React re-invoke)"*. It
> dedupes none of those three. **And this repo already knows**:
> `src/stores/slices/agents/executionSlice.ts:408-412`, one layer above, says
>
> > *"The key MUST be stable across a timeout+retry — a fresh `crypto.randomUUID()`
> > per call meant the backend's `create_with_idempotency` never matched on the
> > retry, so a SECOND execution spawned (double $)."*
>
> and then derives its key from `executionRequestSignature(personaId, useCaseId,
> inputData, continuation)`. **The correct answer and the incorrect one are 300
> lines apart in the same call chain, and the incorrect one is the default every
> other caller gets.** Of 22 `executePersona` call sites, one is that slice;
> `useManualPersonaRun.ts:113` holds a key for **1 s** against a **90 s** IPC
> timeout; and `useBulkRerun.ts:163` (`bulk-rerun-${row.id}-${Date.now()}`),
> `backgroundChatSlice.ts:227` and `chatSlice.ts:244` mint keys that **can never
> match anything**, under comments claiming dedupe.
>
> ### 3 — the ESLint rule that routes every developer to the IPC door advertises a guarantee the door does not give
>
> `eslint.config.js:80` — the message every developer sees when they reach for raw
> `invoke`:
>
> > *"Use `invokeWithTimeout` from `@/lib/tauriInvoke` … It adds timeout protection,
> > IPC metrics, **idempotency dedup**, and typed CommandName safety."*
>
> What the door actually gives: an `inflightByKey` map with **zero TTL**, deleted on
> settle (`tauriInvoke.ts:143, :336-339, :376`), and an automatic dedupe restricted
> to the `list_`/`get_`/`fetch_` prefixes (`:161`). For a mutation it collapses
> *concurrent* calls holding *the same key* — and 668 of 669 distinct mutation
> commands never supply one. `tauriInvoke.ts:47-48` states this plainly. **The rule
> message is the one place a developer reads about it, and it is the one place that
> is wrong.** This is the contract's fifth §9 failure mode inverted: not a gate
> pointing at a broken destination, but a gate **describing** the destination as
> better than it is.
>
> The same file then contradicts itself: `:64-67` keeps `execute_persona` off
> `BLOCKING_MUTATION_TIMEOUTS` *because* "a post-timeout retry reuses the key" —
> which is a property of **the caller**, true for 1 of 22.
>
> ### 4 — two sibling tables, one constraint, and the live database settles it
>
> `persona_event_subscriptions` and `persona_triggers` are seeded by the same
> adoption paths, in the same functions, by the same authors. One has
> `idx_pes_unique_sub ON (persona_id, event_type, COALESCE(source_filter,''))`. The
> other has **no unique index of any kind**.
>
> | table | rows | natural-key UNIQUE | duplicate groups | excess rows |
> | --- | ---: | :-: | ---: | ---: |
> | `persona_event_subscriptions` | 102 | ✅ | **0** | 0 |
> | `persona_triggers` | 351 | ❌ | **7** | 7 |
>
> All seven duplicate pairs are `trigger_type='manual'`, `config='{}'`,
> `enabled=1`, and each pair shares a `created_at` **identical to the nanosecond**
> (`2026-06-01T13:09:29.242697900+00:00`) — one `now` value, one operation, two
> rows. That is a controlled experiment inside one codebase, and it is the whole
> argument for clause 2 of the convergence sweep, which is the only clause in this
> leaf that is unanimous across all six repos.
>
> ### 5 — the money is small, real, and in the live database
>
> Grouping `persona_executions` by `(persona_id, input_data, use_case_id,
> trigger_id)` inside a time bucket:
>
> | bucket | duplicate groups | excess runs | spend attributable to the extra runs |
> | ---: | ---: | ---: | ---: |
> | 5 s | 3 | 5 | **$7.14** |
> | 60 s | 11 | 13 | **$9.74** |
> | 300 s | 19 | 21 | **$13.18** |
>
> Against $2,036.26 of lifetime execution spend that is ~0.5%. It is listed because
> it is *observed*, not modelled: eleven groups of identical work, one of them run
> three times inside the same second, all of them on the team-assignment dispatch
> path — which is `use_cases.rs:639`/`:700` and `deliberations.rs:258`, three of the
> thirteen unkeyed spawn sites in §9's population.
>
> ### Sibling boundaries, settled in prose
>
> [**conditional-write**](./conditional-write.md) owns the CAS *mechanism* — the
> predicate in the `WHERE` clause and whether the caller reads the count. **This
> path owns the case where there is no row yet to compare against**: the first of
> two identical requests must create, the second must not, and the arbiter is a
> uniqueness constraint rather than a predicate. Its §7 D9 refused to gate the 70
> conditional INSERTs because "many are idempotent seeds"; this path supplies the
> discriminator it lacked — **a dedupe key is one the source supplied; a seed key is
> one you chose** — and confirms its Gap 5 from the other side.
>
> [**job-claim-and-lease**](./job-claim-and-lease.md) owns everything that must
> exist besides the claim — the lease, renewal, release, rearm, fence. **This path
> owns the step before a claim exists**: whether the *request* that produced the
> claimable row should have produced a row at all. Its D4 (`remote_command_approve`
> approved twice) was fixed on 2026-08-16 at `1ad67db14`; §7 D3 here reports that
> **only 1 of that file's 4 mutating paths got the fix**, and §7 D2 that the
> approved command still spawns the persona with `idempotency_key = None`.
>
> [**inline-busy-state**](./inline-busy-state.md) owns *"does the person who just
> clicked know their click landed"*. **This path owns "did the click land twice"** —
> and they are strictly different, because a correct busy indicator and a duplicated
> mutation coexist happily: **all 7 of this document's disarmed AsyncButtons pass
> `isLoading` and render a perfectly correct spinner.** That document's Signal 2
> reaches 39 of the 134 non-returning action handlers, 0 of the 25 hand-rolled
> in-flight refs, and none of the wire layer. §12 corrects one of its counts by
> 2.17×.
>
> [**upsert**](./upsert.md) owns insert-or-update as a **merge**. **This path owns
> insert-or-nothing as a *dedupe*** — where "already there" is success and the only
> question is whether the caller may proceed to the side effect.
>
> The **Deviations** section is a fix backlog and contains **one live
> money-costing double-execution path** (D1), three more unguarded write paths on a
> cross-device queue (D3), and eight one-to-three-line repairs.

> **Post-publication note — 2026-08-17.** This document's `<LoadingSpinner>` population
> (252) predates `78e9bff68`, which deleted the unreachable `teams/sub_canvas/` tree and
> with it exactly 5 of those sites. **The count is 247 today**, verified against
> `78e9bff68^` = 252. The finding is unchanged; only the denominator moved, and it moved
> by deletion rather than by fix. See [`inline-busy-state.md`](./inline-busy-state.md).

---

## 1 Trigger

- "What happens if they click this twice?"
- "The request timed out — can I just retry it?"
- "This webhook/poller can deliver the same thing twice. Is that safe?"
- "Two tabs / two devices / two ticks could send this at the same moment."
- "It says it failed but I think it actually worked."
- "Should this have a unique index, or is the id enough?"

If you are about to type `idempotency`, `dedup`, `request_id`, `nonce`,
`INSERT OR IGNORE`, `ON CONFLICT … DO NOTHING`, `CREATE UNIQUE INDEX`,
`crypto.randomUUID()` as the value of a key, `retry`, `setSubmitting(true)`,
`disabled={busy}`, or a `#[tauri::command]` that spends money — you are in this
situation.

**Not this path:** *whether a guarded write's verdict is read* is
[conditional-write](./conditional-write.md); *the lease and release around work
already claimed* is [job-claim-and-lease](./job-claim-and-lease.md); *whether the
control shows it is busy* is [inline-busy-state](./inline-busy-state.md);
*merging two versions of a row* is [upsert](./upsert.md); *what a recovery pass
writes* is [terminal-state-and-recovery](./terminal-state-and-recovery.md).

## 2 The one way

**Derive the key from the request, never from the attempt; put it in a UNIQUE
constraint; and make the operation tell the caller WHICH branch it took.**
Concretely: (a) **the key is a function of the request's content or of an id the
source gave you** — `format!("discord:{channel}:{msg_id}")`,
`executionRequestSignature(personaId, useCaseId, inputData, continuation)`, a
provider's delivery id, a natural business key. A `crypto.randomUUID()` /
`Uuid::new_v4()` evaluated at the moment of use is not a key, because a retry
evaluates it again; **executed, it dedupes nothing.** If no natural key exists,
synthesize one **once per logical invocation** and carry it across every retry of
that invocation — that is exactly what `ascent` does after being double-charged
(§6 clause 5). (b) **The arbiter is a UNIQUE index, not an `if`.** A partial index
(`… WHERE key IS NOT NULL`) lets the un-keyed majority through unharmed while
making the keyed minority exclusive; this is the one clause the convergence sweep
found in **5 of 5** siblings. (c) **The write must be `INSERT … ON CONFLICT(<key>)
DO NOTHING` with a re-read on the lost race**, not a `SELECT` then an `INSERT` —
`create_with_idempotency` gets this exactly right and it is 40 lines. (d) **Return
which branch fired.** `Result<T>` cannot carry the one bit the dedupe produced, so
the caller re-derives it from the entity's own mutable state and gets it wrong;
return `Created(T) | Deduped(T)` — **this is the entire content of §7 D1 and the
executed fix in §9's replay is one line.** (e) **Dedupe BEFORE the irreversible
step, not after** — `ascent` states the rule its webhook route learned:
*"dedup must mean 'successfully processed', not merely 'HTTP acknowledged'."*
(f) **On the client, claim the slot synchronously before the first `await`** — a
`useRef` set true above the first suspension point, because React has not
committed your state update yet when the second click arrives; `AsyncButton` does
this for you and `useManualPersonaRun.ts:105-107` shows it hand-written with the
reason in a comment. (g) **A client guard and a server constraint are not
substitutes** — the ref stops the double-click, the constraint stops the retry, the
restart, and the second device, and **a toggle defeats both** (§8 Gap 6). Then
stop: do not add a mutex, do not add a debounce, do not add a post-write
verification read, and do not retry a mutation you have no key for.

If you must get one right first: **(a)**. (b), (c), (d) all fail loudly the first
time you look at the data. (a) fails silently and permanently, and its own comment
will tell the next reader it is solved.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `db/src/repos/execution/executions.rs:498` `create_with_idempotency` | **the one dedupe to copy.** Pre-check → `ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING` → re-read the winner on `rows_changed == 0`. The conflict target repeats the partial index's `WHERE` so SQLite selects it, and the doc comment (`:527-535`) says why. It needs §7 D1's return type; the SQL needs nothing |
| `db/src/migrations/incremental.rs:2139-2140` `idx_pe_idempotency` | the **partial** UNIQUE index — `WHERE idempotency_key IS NOT NULL`. Executed: two NULL-key inserts both land (`changes 1,1`), two same-key inserts give `1,0`. This is how you add exclusivity to a column most rows leave empty |
| `src/engine/discord_poller.rs:250` · `slack_poller.rs:296` | **the key derivation to copy.** `format!("discord:{channel_id}:{msg_id}")` — provider-scoped, content-free, replay-safe across a restart. The only two spawn sites in 963 files that pass a key |
| `src/commands/infrastructure/skill_usage.rs:455-465` | the same idea for an **append-only** stream: the source's own timestamp, `datetime(?)`-normalised so re-parsing the same transcript byte produces the same key. `:456-458` states the reason. Backed by `idx_sue_dedup` / `idx_dre_dedup` |
| `src/stores/slices/agents/executionSlice.ts:405-438` | **the client half.** A key derived from a request *signature* with a reuse window, retained deliberately on `InvokeTimeoutError` (`:496-498`) and only there. `:408-412` writes down the exact defect this path is about |
| `src/features/agents/sub_use_cases/libs/useManualPersonaRun.ts:105-107` | the **synchronous** claim: `runInFlightRef.current = true` set *before the first `await`*, with the comment saying why (React has not committed yet). Cleared in `finally` on both paths |
| `src/features/shared/components/buttons/AsyncButton.tsx:35-68` | the same guard as a primitive — a `useRef`, `e.preventDefault()` on re-entry, `.finally()` release so a failure is retryable, and a synchronous throw released then rethrown (`:50-53`). **Only arms if your handler returns a thenable** (§7 D5) |
| `db/src/repos/dev_tools.rs` `create_finding(… dedup_key)` + `idx_dev_ideas_dedup_unique` | the second real end-to-end key in the tree: caller-supplied, DB-persisted, `(project_id, dedup_key)` UNIQUE. Copy this when the "source" is another agent rather than a provider |
| `src/lib/tauriInvoke.ts:117-136` `InvokeTimeoutError` | `readonly backendMayStillBeRunning = true` and a message that spells out the hazard. **Read this before writing any retry**; the type is telling you the truth |
| `src/features/plugins/companion/sendNonceLedger.ts` | a restart-surviving **client** dedupe (localStorage, 200 entries, 24 h TTL) checked synchronously before IPC. Correct for its purpose and **never sent to Rust** — see §8 Gap 4 |

**Do NOT build:** a `crypto.randomUUID()` / `Uuid::new_v4()` evaluated where the
key is used (§7 D4); a dedupe whose arbiter is an `if` above an unconditional write
(that is [conditional-write](./conditional-write.md)'s subject and this leaf's
cause); a table holding externally-originated records with no UNIQUE index on the
source's id (§7 D6); a retry around a mutation with no key (§6 clause 5 — a sibling
double-charged a customer doing this); a second in-flight `Map` beside
`tauriInvoke`'s; a `debounce` as a submit guard (measured: **0** of 300
debounce/throttle sites wrap a mutation, and that is correct — keep it that way).

## 4 Steps

1. **Ask what "the same request" means, in words.** Two clicks on one button? A
   retry of one HTTP call? A webhook redelivered by a provider? A resumed sync?
   The answer names your key. If you cannot name it, you do not have one, and
   steps 2-6 are unavailable — say so in the doc comment rather than shipping a
   random UUID that looks like one.
2. **Derive the key.** Provider id → use it. Content-addressable request → hash
   the fields that make it the same request (`executionRequestSignature`). Neither
   → synthesize one **at the top of the logical operation** and thread it through
   every retry, never inside the function that performs the attempt.
3. **Add the UNIQUE index in the same commit as the column**, partial if most rows
   will leave it NULL. A key with no constraint behind it is a comment; a
   constraint added a month later is a month of production without one (`ascent`
   did exactly that — §6).
4. **Write the insert as `ON CONFLICT(<key>) DO NOTHING` and re-read on zero.**
   Copy `create_with_idempotency`. Do not `SELECT` then `INSERT`; that is the race
   the constraint exists to arbitrate.
5. **Ask whether the signature can make the wrong call impossible** — before you
   write the caller, not after. See *Prefer a type over a gate*: an operation that
   returns `Created(T) | Deduped(T)` cannot be misread; one that returns `T` will
   be, and §7 D1 is the proof at a cost of two agent runs.
6. **Put the dedupe check before the irreversible step.** Spawn, charge, send,
   PATCH — all of it after. `approval_exec_fleet.rs:1839-1845` documents where the
   line is for the claim case and the same reasoning applies here.
7. **On the client, claim synchronously, then let the primitive take over.** Use
   `AsyncButton` and **return the promise from `onClick`** — the guard arms only on
   a returned thenable and `MouseEventHandler` returns `void`, so dropping it is
   not a type error (§7 D5). If you cannot use `AsyncButton`, set a `useRef` above
   the first `await` and clear it in `finally`.
8. **Decide what a timeout means and write it down.** A Tauri `invoke` timeout does
   **not** cancel the backend. Either give the command a long ceiling in
   `BLOCKING_MUTATION_TIMEOUTS` so the IPC waits, or give it a key so the retry
   dedupes, or make it fire-and-poll. Those are the three options; there is no
   fourth, and "the user probably won't click again" is not one of them.
9. **And then stop.** Do not add a mutex, a debounce, a post-write verification
   read, or a second in-flight map. If the constraint says the row exists, the
   request already happened; return what it produced.

## 5 Anti-patterns

- **A key generated where it is used.** *Failure:* every attempt is a different
  request, so nothing ever matches and the dedupe is dead code under a comment
  claiming it works. **Executed: two calls through `src/api/agents/executions.ts:67`
  produce two keys, two rows and two agent runs.** §7 D4.
- **Deciding "did I create this?" from the entity's own mutable state.** *Failure:*
  the operation knew the answer and threw it away; the caller's proxy is wrong
  exactly in the window that matters. **Executed: `if execution.status != "queued"`
  is false precisely when the dedupe fired, and both callers spawn.** §7 D1.
- **A dedupe that runs after the side effect.** *Failure:* you dedupe the record
  and not the charge. `ascent`'s webhook route names it: *"dedup must mean
  'successfully processed', not merely 'HTTP acknowledged'."*
- **A retry wrapper around a mutation with no key.** *Failure:* the retry is the
  duplicate. `ascent` `src/lib/db/credits.ts:330-332` documents the bill: *"a
  commit-ambiguity blip … re-ran the whole closure: a SECOND decrement + a SECOND
  `delta:-1` row → the org charged twice for one scan."*
- **A natural key with no UNIQUE index.** *Failure:* the check-then-insert races and
  nothing catches it. **Live: `persona_triggers` has 7 duplicate groups;
  `persona_event_subscriptions`, seeded by the same code with the index, has 0.**
  `vibeman` shipped the textbook repair for its version —
  `DELETE … WHERE rowid NOT IN (SELECT MAX(rowid) … GROUP BY project_id)` then
  `CREATE UNIQUE INDEX` — with the cause in the migration header (§6).
- **`onClick={() => void handler()}` on a guarded button.** *Failure:* the
  synchronous re-entry guard never arms, because `AsyncButton` keys on a returned
  thenable and `void` discards it. **The button still shows a correct spinner**, so
  the failure is invisible in review and in QA. 7 of 49 sites, and all 7 pass
  `isLoading`. §7 D5.
- **A scalar busy flag guarding a list of per-entity actions.** *Failure:* every
  row disables together or none does, and the one the user pressed is
  indistinguishable. 11 structural sites, **5** genuinely per-entity. §7 D8.
- **An in-memory dedupe for something that crosses a restart or a device.**
  *Failure:* it is empty after every restart and does not exist on the other
  machine. `remote_commands.rs:30` `SURFACED` guards a queue row shared across
  devices; `tauriInvoke`'s `inflightByKey` has a zero TTL by design and says so.
- **Trusting a command's NAME to describe its behaviour.** *Failure:*
  `tauriInvoke.ts:161` auto-dedupes every `list_`/`get_`/`fetch_` command for 250 ms
  and hands the second caller a clone. A read-named command that writes would have
  its second call silently skipped. **Measured: 333 read-named commands, 0 containing
  a SQL write** — the contract holds today, and nothing enforces it (§9, refused).

## 6 Evidence

**The one site to copy: `db/src/repos/execution/executions.rs:498-586`
`create_with_idempotency`, read together with
`db/src/migrations/incremental.rs:2139-2140`.** They are one design in two places
and neither is complete alone:

```sql
-- the constraint: exclusivity for the keyed minority, nothing for the rest
CREATE UNIQUE INDEX IF NOT EXISTS idx_pe_idempotency
  ON persona_executions(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- the write: insert-first, so a lost pre-check race dedupes instead of erroring
INSERT INTO persona_executions (…, idempotency_key, …)
VALUES (?1, …, 'queued', …)
ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
-- then: if rows_changed == 0 → get_by_idempotency_key(key) → return the winner
```

Five decisions worth copying: (1) the pre-check is an **optimisation**, not the
guard — the constraint is the guard, and the code is written so losing the
pre-check race is a normal path; (2) the conflict target **repeats the partial
index's `WHERE`** so SQLite can select it, and `:531-534` says so; (3) a NULL key
is not in the index, so the un-keyed path is bit-for-bit unchanged — you can add
this to a live table with 2,176 NULL rows and nothing moves; (4) the loser
**re-reads and returns the winner**, so the caller gets the same shape either way;
(5) both dedupe branches `tracing::info!` with the key and the winning id, so the
mechanism is observable in a log. Executed proof it works at the row level: three
different interleavings, `rows inserted = 1` in all three.

Its one defect is not in this function — it is that the function cannot tell the
caller which of those five paths it took. §7 D1.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `src/engine/discord_poller.rs:250` | the key **derived from the provider's id**, and `:188-192` explaining why the re-dispatch after a failed cursor advance is safe |
| `src/commands/infrastructure/skill_usage.rs:455-458` | a source-supplied **timestamp** as part of the key, normalised so a re-parse is idempotent — the honest version of "timestamps can't be dedupe keys" |
| `src/stores/slices/agents/executionSlice.ts:405-438` | the client key derived from a **request signature**, with the reuse window scoped to the retry and background runs deliberately excluded |
| `src/features/agents/sub_use_cases/libs/useManualPersonaRun.ts:105-107` | the **synchronous** in-flight claim, taken above the first `await`, with the React commit timing spelled out |
| `src/lib/tauriInvoke.ts:117-136` | an error type that **carries the hazard** — `backendMayStillBeRunning` is a field, not a comment |
| `src/cloud/sync/client.rs:126-153` | the transport method added on 2026-08-16 so a cloud write can report whether it matched. The doc comment names the two runs it cost |

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`,
`../vibeman`, `../ascent`. **All five exist and all five were opened.** Two
measurement caveats shaped the counts and both are findings in their own right:
`brainiac`'s raw `idempotenc` count (167) is **~44% synthetic corpus** — 73
template-generated payments-domain lines in `fixtures/bank/memories/gold.yaml` —
so a banked keyword count is a lead, not a finding; and `rg -i` intermittently
blanked matched substrings mid-stream on this machine, so every quote below was
re-verified by `Read`.

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **An idempotency key travels on the wire with a mutating request** | **PHYSICS (3 of 5, three unrelated stacks)** | `brainiac` `migrations/0013_source_idempotency.sql:1-3`: *"let POST /v1/memories carry an Idempotency-Key so a network retry returns the ORIGINAL source instead of minting a fresh one (**each duplicate source burns a full extraction pipeline / LLM call**)."* `personas-cloud` replays the cached response with `X-Idempotency-Replay: 1` (`httpApi.ts:1139-1145`). `ascent` uses provider/business/synthesized keys with no generic header. **`personas-web` and `vibeman`: none.** Personas is in the top group on mechanism and the bottom group on adoption. |
| 2 | **A UNIQUE constraint is the dedupe arbiter, and "already there" is success** | **PHYSICS — 5 of 5, unanimous, the only such clause in this leaf** | `ascent` 52 `onConflict` + 20 `skipDuplicates` + 91 `@@unique`; `brainiac` 38 `ON CONFLICT` / 22 `DO NOTHING`; `vibeman` 27 / 22 `CREATE UNIQUE`; `personas-web` 6/5; `personas-cloud` 4. Personas: 177 conflict-tolerant writes, 26 `CREATE UNIQUE INDEX` + 51 table-level `UNIQUE`. The sharpest form is `brainiac` `governance.rs:56-60` — `ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`, **character-for-character the partial-index design Personas uses**, arrived at independently in Postgres. |
| 3 | **A webhook/ingress dedupes on a PROVIDER-supplied id, BEFORE the side effect** | **PHYSICS where an ingress exists (2 of 3) — `vibeman` INVERTED, and 2 repos are a true SILENCE (no ingress)** | `ascent` `api/app/webhook/route.ts:511-514` claims and bails before any `after()`, and `:596-598` states the rule: *"dedup must mean 'successfully processed', not merely 'HTTP acknowledged'."* `personas-cloud` dedupes before dispatch. **`vibeman` has a GitHub webhook and never reads the delivery id** (`api/goals/github-webhook/route.ts:84` reads only `x-github-event`). Personas' pollers are the same mechanism through a pull rather than a push, and they are its only two keyed spawns. |
| 4 | **The client double-submit guard is ONE shared primitive** | **INVERTED — nowhere centralized, and adoption is the failure, not knowledge** | shared:hand-rolled — `personas-web` **0:16**, `vibeman` **2:126 (1:63)**, `ascent` **6:30 (1:5)**. Personas is the family's best at **49 `AsyncButton` renders : 25 hand-rolled refs**, and still 7 of the 49 are disarmed. The strongest sibling fact is negative: `vibeman` **built** `TableActionButton.tsx:44,:68` — the only file in six repos where the re-entrancy latch and the `disabled` binding are co-located — and **renders it zero times**, against 126 hand-rolled flags in 105 files. `useTransition`/`isPending` as a submit guard: **0 across all three UI repos.** |
| 5 | **A retry is applied to a mutation with no dedupe key** | **PHYSICS-of-failure — one repo did it, paid, and wrote it down** | `ascent` `src/lib/db/credits.ts:330-332`: *"a commit-ambiguity blip (the COMMIT acked-lost, then retried) re-ran the whole closure: a SECOND decrement + a SECOND `delta:-1` row → **the org charged twice for one scan**; and at balance=1 the retry's conditional decrement found 0 and reported a PAID scan as denied."* Its fix is §2(a)'s general form: synthesize `auto:${randomUUID()}` **once per invocation** (`:129`, `:334`) so a retry of *this call* collapses while a separate call still lands. Every repo in the family has retry wrappers; only this one has been bitten. |
| 6 | **Somebody wrote the reasoning down** | **PHYSICS — named in 5 of 5** | "exactly once": `ascent` 50, `brainiac` 29, `vibeman` 5, `personas-web` 3, `personas-cloud` 1 ("at most once"). `ascent` `api/billing/webhook/route.ts:5-6`: *"The grant is IDEMPOTENT on the Polar order id … so an at-least-once webhook can retry without double-fulfilling."* Personas' equivalent is `tauriInvoke.ts:43-51` and `executionSlice.ts:408-412`, which are as good as anything in the family. **The concept is universally named and unevenly wired — which is this leaf's whole shape.** |
| 7 | **The client guard and the server constraint agree** | **MINORITY — and a UNIQUE constraint is structurally blind to a TOGGLE** | The sharpest structural finding in the sweep, independently present in two repos. `vibeman`'s `hall_of_fame_stars.component_id` is a PRIMARY KEY and `star()`/`unstar()` are each idempotent — but the API exposes `toggle`, which composes two idempotent operations into a non-idempotent one, and `ComponentTable.tsx:83` has **no `disabled`**. `personas-web`'s `postVoteToggle` fires optimistically with **no in-flight ref** while its sibling boost handler has one; the server's `UNIQUE(feature_id, voter_id)` fixed the duplicate-**row** mode and leaves the double-**flip** mode open. **Neither repo noticed.** See §8 Gap 6 — Personas has toggles too. |

**Physics — keep as doctrine:** clauses 1, 2 (the strongest, unanimous), 3, 5 and
6. **Inverted:** clause 4 — there is no shared client primitive anywhere, and
Personas' `AsyncButton` is the family's best answer, which makes §7 D5's 7
disarmed sites the highest-leverage fix in this document. **Reported as silence:**
`personas-web` and `vibeman` have no client-generated key at all; `brainiac` and
`personas-web` have no external ingress, so clause 3 is *not applicable* there
rather than absent.

> **Evidence of ACTUAL duplicates, paid for, in four of the five siblings.** This
> is what makes clause 2 doctrine rather than taste: (1) `ascent` charged a
> customer twice and a second bug in the same file collapsed every refund event
> into the first, so *"the buyer kept the rest of the pack for free"*
> (`credits.ts:197-199`); (2) `vibeman` ran the textbook dedupe migration
> (`138_file_watch_config_unique_project.ts:36-44`) whose header names the cause —
> *"upsert… uses a check-then-act pattern (SELECT then INSERT/UPDATE) which can
> produce duplicate rows under concurrent access since project_id has no UNIQUE
> constraint"*; (3) `personas-web` collapsed duplicate paid boosts and then added
> the constraint (`setup-voting-db.sql:53-55`); (4) `ascent`'s `CreditLedger` and
> `Scan` uniques were **retrofitted a month after the code started believing in
> them**, and it deletes duplicate PR comments in production
> (`github/checks.ts:201-206`) because GitHub issued **two delivery ids for one
> logical event** — which no provider-id dedupe can collapse. Personas' equivalent
> artefact is 7 duplicate triggers and 13 excess agent runs, and it is smaller only
> because it is local-first.

## 7 Deviations

Every entry is live on `master` @ `19884e1f0` and was verified by replay against
real SQLite, by a read-only copy of the operator's database, or by opening the
file.

### D1 — a deduped execution still spawns the engine, and the window is the whole queue wait

`src/commands/execution/executions.rs:390-403`.

`create_with_idempotency` returns the existing row on a dedupe hit. The caller's
only test for "was this a dedupe?" is `if execution.status != "queued"` — and a
deduped row that has not started is `queued`. Executed (three interleavings, §9):
`rows inserted = 1`, `ENGINE SPAWNS = 2`.

- **The window is not a microsecond.** `Engine::start_execution_with_priority`
  (`src/engine/mod.rs:864-950`) returns `AdmitResult::Queued` under per-persona
  concurrency, global concurrency, quota cooldown or resource pressure; the row
  stays `queued` for the whole wait. `QueueTracker::admit`
  (`engine/src/queue.rs:253-308`) carries **no execution-id term**, so the same id
  is admitted or enqueued again.
- **The failure is correlated with its own trigger.** `discord_poller.rs:188-192`
  deliberately does not advance the cursor after a transient dispatch failure, so
  the next poll re-dispatches with the same key — and the transient failures that
  stop the cursor (queue full, quota cooldown) are exactly the conditions that keep
  the row `queued`.
- **It leaves no artefact.** One row, two agents. The whole-database duplicate
  sweep found excess rows in 23 tables and none in `persona_executions`, and that
  is consistent with this defect rather than evidence against it.

**Fix, as one unit:** have `create_with_idempotency` return
`enum Spawn { Created(PersonaExecution), Deduped(PersonaExecution) }` — the
information already exists at `:513-521` and `:570-581` and is discarded — and
branch on the variant at `:394` instead of on `status`. Executed: **one spawn
across all three interleavings.** Then delete the `status != "queued"` heuristic
entirely; it has no correct use.

### D2 — the command that was fixed for double-approval still starts the agent with no key

`src/cloud/remote_commands.rs:294-305`. The 2026-08-16 fix (`1ad67db14`) made the
*claim* exclusive with `patch_returning_count` + `status=eq.pending`. The line
below it calls `execute_persona_inner(…, /* idempotency_key */ None, false)` while
`cmd.id` is a perfect natural key. `src/lib/tauriInvoke.ts:75-77` puts the command
on `BLOCKING_MUTATION_TIMEOUTS` with the reason stated: *"Approves a remote
run-request by executing the persona LOCALLY to completion. **No backend dedup — a
post-timeout retry would run the persona a second time.**"* The 30-minute ceiling
is a mitigation for a missing key, and the key is one expression away.

**Fix:** `Some(format!("remote-command:{id}"))`. One line, and it deletes the
reason the timeout override exists.

### D3 — three of the four mutating cloud paths in one file still have no precondition

`src/cloud/remote_commands.rs`. `remote_command_approve` was fixed;
`patch_returning_count` now exists and can express a precondition. The other three
were not migrated:

- **`:344-348` `remote_command_reject`** — `PATCH pending_commands?id=eq.{id}`, no
  filter, `Result<()>`. A reject racing an approve flips a row to `rejected` **while
  the agent is running and billing**, and the approve's own settle then stamps
  `completed` back over it. Neither side can tell.
- **`:144-149` the poll's auto-expire** — same filterless path. A command approved
  between the poll's `GET` and its `PATCH` is marked `expired` while it executes.
- **`:104-106` `set_command_status`** — the settle, `let _ = client.patch(…)`,
  unconditional and with the `Result` discarded. This is
  [job-claim-and-lease](./job-claim-and-lease.md)'s unfenced settle on the cloud
  side, where its census rule (rusqlite-shaped) structurally cannot see it.

**Fix:** `&status=eq.pending` on `:345`, `&status=eq.pending` on `:146`, and
`&status=eq.executing` on `:105`; route all three through
`patch_returning_count` and log a zero.

### D4 — the default idempotency key is a fresh UUID, and the file that explains why that fails is in the same call chain

`src/api/agents/executions.ts:67` — `const resolvedKey = idempotencyKey ??
crypto.randomUUID();`, under a comment claiming it makes every call *"self-dedup'd
against a concurrent duplicate (double-click, double-fire, React re-invoke)"*.
Executed: two calls, two keys, two rows, two spawns.
`src/stores/slices/agents/executionSlice.ts:408-412` documents the same defect and
fixes it correctly, one layer up.

Of 22 `executePersona` call sites: **1** (the slice) keeps a key stable across a
retry; `useManualPersonaRun.ts:113` holds one for **1 s** against a **90 s** IPC
timeout, so it covers the double-click and not the retry it was written for; and
`useBulkRerun.ts:163` (`bulk-rerun-${row.id}-${Date.now()}`),
`backgroundChatSlice.ts:227` and `chatSlice.ts:244` (inline `crypto.randomUUID()`)
mint keys that **can never match anything**, under comments claiming dedupe.

**Fix:** default to `undefined`, not to a random UUID — a missing key is honest and
a fake one is not; then give the remaining four callers a derived key, reusing
`executionRequestSignature`.

### D5 — seven guarded buttons are disarmed by a `void`, and every one of them renders a correct spinner

`AsyncButton`'s re-entrancy guard arms only when the handler returns a thenable
(`AsyncButton.tsx:55`). `onClick` is typed `MouseEventHandler`, which returns
`void`, so discarding the promise is **not a type error and produces no warning**.

`agents/components/matrix/BuildTemplateSuggestion.tsx:112` ·
`agents/sub_use_cases/components/core/UseCasesRefineCard.tsx:70` ·
`settings/sub_byom/components/ByomProviderList.tsx:447` ·
`shared/dispatch/DispatchChooser.tsx:175` ·
`teams/sub_factory/l2/ship/ShipDispatch.tsx:136` ·
`teams/sub_factory/l2/ship/ShipMilestoneRun.tsx:124, :134`.

7 of 49 renders (14.3%), hand-verified 7/7 with each callee's `async` declaration
confirmed. **All 7 pass `isLoading`**, so they keep the reactive guard and lose only
the synchronous one — which is precisely the sub-frame double-click the ref exists
to stop, and precisely the half that is invisible to review. A further **22 of 49
renders pass no `isLoading` at all** and depend solely on thenable detection: one
`void` there removes the spinner *and* the guard.

Repo-wide the same shape reaches **134** non-returning action handlers with an
in-file-resolvable `async` callee across 85 files (hand-verified 10/10).

**Fix:** delete the `void` at the 7 AsyncButton sites — `onClick={() => accept(top)}`.
Then change `AsyncButtonProps['onClick']` to `(e) => void | Promise<unknown>` so the
next one is a type error (see *Prefer a type over a gate*).

### D6 — a table whose sibling has the constraint, and the live database shows the difference

`persona_triggers` has 13 production INSERT sites, **no UNIQUE index**, and 7
duplicate groups live (7 excess rows of 351) — all `manual`, all with a
`created_at` identical to the nanosecond within each pair, i.e. one operation
writing the same logical trigger twice. `persona_event_subscriptions`, seeded by
the same paths, carries `idx_pes_unique_sub` and has **0 duplicate groups in 102
rows**.

**Fix:** `CREATE UNIQUE INDEX idx_ptr_unique_manual ON persona_triggers(persona_id,
trigger_type, COALESCE(use_case_id,'')) WHERE trigger_type = 'manual'` — partial, so
schedule/webhook/event triggers with distinct configs are untouched — after a
`DELETE … WHERE rowid NOT IN (SELECT MIN(rowid) … GROUP BY …)` pass. `vibeman`'s
`138_file_watch_config_unique_project.ts` is the migration to copy; it is the same
repair for the same cause.

### D7 — thirteen duplicate agent runs are already in the operator's database

Grouping `persona_executions` by `(persona_id, input_data, use_case_id,
trigger_id)` inside a 60 s bucket: **11 groups, 13 excess runs, $9.74 attributable**
(5 s: 3 groups / 5 runs / $7.14; 300 s: 19 / 21 / $13.18). One group ran **three
times inside the same second** at `2026-06-11T07:05:23` for $8.26. Every group is on
the team-assignment dispatch path — `use_cases.rs:639`/`:700` and
`deliberations.rs:258`, three of §9's thirteen unkeyed spawns.

Adjacent, larger, and deliberately *not* claimed as a defect here:
`team_assignments` holds 31 rows with an identical title spanning 107.6 hours. Its
`idx_one_active_assignment_per_goal` is partial on `status IN ('queued',…)`, so a
completed assignment permits a new one — which is either a retry loop working as
designed or a re-proposal loop that nobody bounded. It needs an owner and this
path is not it.

### D8 — eleven list surfaces guard per-row actions with one scalar flag

`fleet/monitor/channels/ReviewsRail.tsx:139` · `plugins/companion/fleet/AthenaFleetPlanCard.tsx:149` ·
`plugins/companion/ship/AthenaShipMilestoneCard.tsx:160` · `plugins/drive/knowledge/KbPickerDialog.tsx:81` ·
`plugins/twin/sub_knowledge/ContactsPanel.tsx:206` · `plugins/twin/sub_brain/ReflectionsPanel.tsx:153` ·
`settings/sub_api_keys/CreateApiKeyDialog.tsx:142,:192` · `settings/sub_api_keys/PairApprovalModal.tsx:132,:155` ·
`triggers/sub_triggers/UnattendedModeSection.tsx:67`.

Structural precision 11/11; **semantic precision 5/11** — six are single-select
surfaces (radio group, scope checkboxes, seed chips) where one flag is correct.
Reported as both numbers rather than as eleven, because structural agreement is not
soundness. The five real ones are `ReviewsRail`, `AthenaFleetPlanCard`,
`AthenaShipMilestoneCard`, `KbPickerDialog`, `ContactsPanel`.

**Fix:** a keyed `Set` of in-flight ids. Two stores already do this
(`pendingDeleteCredentialIds`, `pendingDeleteEventIds`); there is no shared hook and
[inline-busy-state](./inline-busy-state.md) owns the extraction.

### D9 — two raw `invoke` calls that no lint rule can see

`src/App.tsx:237-238` and `src/lib/debug/freezeDetector.ts:36-37` obtain `invoke`
through a **dynamic `import()`**, so `no-restricted-imports` — the rule whose
message is §3's headline claim — is structurally blind to them. Both are
`report_frontend_ready` / `log_frontend_error` and neither is a mutation worth
deduping; they are listed because they establish that the wrapper is not a
chokepoint by construction, only by convention, and 1,458 of 1,526 sites (95.5%)
being inside `src/api/**` is a habit rather than an invariant.

### D10 — the ESLint message is wrong and it is the only place most developers will read about this

`eslint.config.js:80` promises "idempotency dedup". `tauriInvoke.ts:47-48` says the
opposite. The rule fires more often than the doc is read.

**Fix:** change the message to *"…timeout protection, IPC metrics, in-flight
collapsing for concurrent reads, and typed CommandName safety"* — one string, and it
stops manufacturing a guarantee.

## 8 Gaps — what the primitives genuinely cannot do

1. **`Result<T>` cannot carry which branch a dedupe took.** The information exists
   inside `create_with_idempotency` at three separate points and is discarded at
   the `return`. Every caller must then re-derive it from the entity, and the only
   field available is a status the engine owns asynchronously. **This is D1's root
   cause and it is a type problem, not a logic problem.**
2. **No type reaches inside the key.** `format!("discord:{}:{}", channel_id,
   msg.id)` is a `String`; so is `crypto.randomUUID()`. Nothing distinguishes "a
   property of the request" from "a property of this attempt", and that distinction
   is the entire subject of §2(a). A `RequestKey` newtype constructible only from
   borrowed request fields would reach it — see *Prefer a type over a gate*.
3. **The census can ratchet a presence and cannot assert an absence.** "This table
   has no UNIQUE index on its natural key" (D6), "this command takes no key" (669
   of 669), and "nothing in the tree passes a key here" are three of this
   document's five headline findings and **not one is expressible as a count**.
   They were found by enumerating every table's indexes and every spawn's argument
   list against the live schema — which is a program, not a matcher.
4. **The client's durable dedupe cannot reach the server.**
   `sendNonceLedger.ts` is a correct restart-surviving nonce ledger in
   localStorage, and **the nonce is never sent to Rust**. So the client can prove
   to itself that it already sent something and cannot prove it to the backend; a
   second device or a cleared profile defeats it entirely. There is no wire field
   for a nonce on any command but three.
5. **A Tauri `invoke` cannot be cancelled.** `tauriInvoke.ts` is honest about this
   and offers the only three mitigations that exist (§4 step 8). `AbortController`
   appears 14 times in the tree and **not one aborts an IPC call** — all 14 are DOM
   fetch/stream/timer. There is no fourth option to reach for.
6. **A uniqueness constraint is structurally blind to a toggle.** Two idempotent
   operations composed into a toggle are not idempotent, and the constraint
   dutifully prevents the duplicate *row* while the double-click still flips the
   state twice. The convergence sweep found this independently in `vibeman` (star)
   and `personas-web` (vote), **and neither repo noticed**. Personas' analogue is
   `forms/AccessibleToggle` over `cascade_use_case_toggle` and
   `daily_goals::toggle_goal`; nobody has audited it and this path does not claim
   to have. **The correct client answer for a toggle is a target state, not a flip
   — send `enabled: false`, never `enabled: !enabled`.**
7. **A provider id is not always unique per logical event.** `ascent` deletes
   duplicate PR comments in production because GitHub issued **two delivery ids for
   one event** (`github/checks.ts:201-206`). §2(a) is the best available answer and
   it is not a total one; where the effect is externally visible you also need a
   reconciliation pass.

## Prefer a type over a gate

**Held against all seven qualifications. The honest answer is that a type gets the
server side almost entirely, gets the client side completely, and cannot reach the
key's derivation at all — and that last boundary is where §2(a) has to live as
prose.**

The measured facts to design against: 15 spawn sites, 2 keyed; 669 mutation
commands, 1 keyed; 12 of 2,188 live rows keyed; the dedupe's branch discarded at
one `return`; 7 of 49 guarded buttons disarmed by a token the compiler accepts.

**Two proposals, because the two halves of this leaf fail differently.**

```rust
/// What create_with_idempotency actually knows and currently throws away.
#[must_use = "the whole point of a dedupe is knowing which branch fired — \
              a caller that re-derives it from the row's status will be wrong \
              exactly in the window the dedupe was built for"]
pub enum Spawn {
    /// This call inserted the row. YOU own the side effect.
    Created(PersonaExecution),
    /// A prior call with this key already inserted it. Do NOT spawn.
    Deduped(PersonaExecution),
}
```

```ts
// AsyncButton.tsx — the guard arms only on a returned thenable, so say so.
onClick: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
```

1. **A required prop carries only what it actually encodes.** ✔ `Spawn` encodes
   exactly "this call, not some other call, performed the insert". It does **not**
   encode "the work has started" — that is the engine's business, and conflating
   the two is the `successRateSource` failure and also, precisely, D1.
2. **Requiredness is orthogonal to closedness.** ✔ **This qualification is why the
   obvious fix is wrong.** `idempotency_key: Option<String>` is **already required
   at every call site** — it is a positional parameter; all 15 authors had to type
   something, and 13 typed `None`, eight of them under a
   `/* idempotency_key */` comment naming the thing they were declining.
   *Requiredness has been tried here and it produced 13 declines.* What is missing
   is closedness on the **return**, which no caller can decline.
3. **A type nobody constructs constrains nothing.** ✔ `Spawn` is constructed by the
   one function that performs the write, so it is on the hot path by construction —
   and the counter-example is in this very document: `claim_for_instance` is
   correct, tested, and has **0 production callers**
   ([job-claim-and-lease](./job-claim-and-lease.md) finding 4), and
   `idempotency_key` itself is a live demonstration that an available parameter is
   not an adopted one at 12 rows in 2,188. The `onClick` widening has the same
   property: it constrains 49 existing call sites the day it lands.
4. **A type anyone can construct authenticates nothing.** ✔ `Spawn`'s variants are
   produced only by the repository function; there is no `Spawn::Created(row)` a
   caller can fabricate usefully, because fabricating it means writing the row
   yourself. It does not need to authenticate — it needs to be **unignorable**, and
   `#[must_use]` on the enum survives the `?` that erases a `bool`.
5. **Withholding beats requiring.** ✔ Both proposals withhold rather than demand.
   `Spawn` withholds *the freedom to proceed without knowing*. The `onClick`
   signature withholds nothing the caller needs — it merely stops `void` from
   type-checking. Note the contrast with the alternative a reader reaches for
   first: making `idempotency_key` non-`Option`. That is *requiring*, the caller
   would supply `Uuid::new_v4().to_string()`, and **the repo has already run that
   experiment on the client at `executions.ts:67`.**
6. **Withhold the dangerous freedom, not the answer.** ✔ The answer — the execution
   row — is inside both variants. What is withheld is treating them the same. For
   `onClick`, the answer (fire the handler) is untouched; only discarding its
   promise becomes illegal.
7. **Withholding a requirement only helps when the requirement was forcing the bad
   value.** ✔ Directly applicable and it rules out the last alternative. Nobody
   *forced* `executions.rs:394` to read `status`; the function simply gave it
   nothing better. Relaxing any existing signature is inert. **The construction is
   what must be withheld — and here the construction is the caller's ability to
   invent a verdict.**

**Does the type reach the code?** *On the return side, entirely. On the client
side, entirely. On the key's derivation, not at all — and that boundary is the
finding.*

Reaches: the single `return` in `create_with_idempotency`, its two call sites, and
the `status != "queued"` branch are ordinary Rust the compiler sees; changing the
return type is a compile error at every one. `onClick`'s widening is a compile
error at all 7 disarmed sites the day it lands, and at none of the 39 correct ones.

**Does not reach, and cannot:** whether the `String` you passed is *a property of
the request* or *a property of this attempt*. `Some(format!("discord:{}:{}", …))`
and `Some(Uuid::new_v4().to_string())` have the same type, the same shape and
opposite behaviour. A `RequestKey` newtype whose only constructors take borrowed
request fields (`RequestKey::from_provider(&str, &str)`,
`RequestKey::from_content(&impl Hash)`) would close it — and would also be a type
with **2 construction sites in 963 files** on the day it shipped, which is
qualification 3 refusing it. So §2(a) stays prose, and §9's gate counts the one
member of this family that *is* a presence: the spawn that declined the key.

**Fix order:** (1) D10, one string; (2) D5's seven `void` deletions plus the
`onClick` widening, which is the cheapest permanent win in the document; (3) `Spawn`
+ D1's branch, which is what makes every subsequent key actually work; (4) D4's
default; (5) D2/D3; (6) D6's index; (7) keep §9's rule as the ratchet until the
spawn sites are keyed, then delete it.

## 9 The missing gate

**The condition, stated stack-free:** *a code path that starts an irreversible,
billable unit of work supplies no value that identifies WHICH request asked for
it, so the system has no way to recognise the same request arriving a second time
— and the second arrival is indistinguishable from a new one.*

An adopting repo must re-derive its own proxy. This one keys on a Rust positional
argument being the literal `None` in the idempotency-key slot of the two functions
that create an execution row. A repo on Prisma spells the identical condition as
`prisma.job.create({ data })` with no `where`-bearing `upsert` and no unique key in
the model, and this pattern scores a **structural zero** there while the condition
is present at scale — `personas-web` and `vibeman` have **no client-generated key
anywhere** and would report clean forever.

**Where it runs:** `npm run census` / `npm run census:check` — local, and invoked
by the pre-push hook. Explicitly **not** a CI-only gate: `ci.yml` is still red on
10 pre-existing Rust test failures and its `frontend-checks` job is red on a
platform-incomplete lockfile, so a gate that runs only there runs nowhere.

### Existing rules checked first, by reading each definition rather than its title

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `unverifiable-conflict-clause` (40/71) | `INSERT OR IGNORE` / `OR REPLACE` / `REPLACE INTO` — *which* constraint is being resolved | **The nearest neighbour and the complement.** It fires on statements that HAVE a conflict clause and asks whether the author named the constraint. Mine fires on **call sites that supply no key**, so no conflict clause is even reachable. Verified: zero match-position overlap — its 71 matches are `INSERT` literals, mine are Rust call expressions containing no SQL. |
| `discarded-guard-verdict` (7/11) | a guarded single-row `UPDATE` in statement position | UPDATE-side, and about a verdict that *was* produced. Here no verdict exists because no predicate was supplied. Disjoint. |
| `blind-identity-write` (35/82) | a repo fn returning `Result<()>` reaching a write whose whole `WHERE` is `id = ?N` | About *writes to a known row*; mine is about *creating one that may already exist*. Different statement kind, different question. |
| `unfenced-work-outcome-write` (6/11) | an outcome-recording write addressed by identity alone | Its subject is the settle at the END of work; mine is the decision to START it. Sibling paths, opposite ends. Zero overlap. |
| `constraintless-table-declaration` (6/15) | a `CREATE TABLE` whose column list carries no `NOT NULL` | Closest in *spirit* — a declaration that cannot reject anything — and it keys on nullability, not uniqueness. I measured the uniqueness analogue and **refused it**; see below. |
| `unverified-effect-dispatch` (60/162) | `let _ = …emit(…)` — a notification whose delivery result is dropped | About whether an effect ARRIVED; mine is about whether it should have been sent twice. No shared match (mine contains no `emit`). |
| `module-scope-install-latch` (13/13), `unswept-job-registry-read` (6/9) | a TS module-scope latch; an in-memory `*_JOBS` map | In-memory dedupe structures. Neither would see `SURFACED` or `inflightByKey`, and both are different languages/roots from this rule. |
| `hand-rolled-disabled-state`, `hand-rolled-spinner` | client busy affordances | [inline-busy-state](./inline-busy-state.md)'s territory — whether the control LOOKS busy, not whether the effect fired twice. |

**None of the 101 existing rules keys on a call that starts billable work without
identifying its request. Proposing one.**

### Measurement

**Precision 13/13 — every match opened and read.** The population is the **15**
production call sites that reach a `persona_executions` insert (excluding the
unkeyed constructor itself and two pure conduits that forward their caller's
parameter). The anchor sees all 15 and partitions them **13 violating / 2
compliant**, with no residual: 13 + 2 = 15 exactly.

Two independent implementations, and **they disagreed, which was the finding**:

| implementation | violating | compliant |
| --- | ---: | ---: |
| a paren-aware argument extractor over every `execute_persona_inner` / `create_with_idempotency` call | 12 | 2 |
| the census engine, from the published pattern (first draft) | 12 | 2 |
| the census engine, after widening for a **trailing line comment** | **13** | **2** |

Both first implementations agreed at 12 and **both were wrong**, because
`src/engine/background.rs:1561` closes its argument list as
`None,\n  true, // is_simulation\n)` — a trailing `//` comment *inside* the call,
which `ignoreCommentLines` does not strip (it removes whole comment lines, not
line-tail comments) and which my hand enumeration had also missed. **Two agreeing
implementations, one missed member, and the member is the dry-run trigger-fire
path.** The published pattern admits `(?://[^\n]{0,80}\n\s*)?` before the closing
paren and both now return 13.

A third vocabulary failure is worth recording because it landed on the most
important site in the document: a TS scan for "a per-call UUID used as an
idempotency key" keyed on identifiers matching
`idempotenc|dedup|request_?id|nonce` and returned 3 sites — **missing
`src/api/agents/executions.ts:67`, the single worst one, because the binding is
named `resolvedKey`.** A vocabulary-based signal's recall is bounded by its
author's word list and the misses cluster on the interesting cases, exactly as the
doctrine says.

**Contamination: zero.** `#[cfg(test)]` was removed as **brace-matched ranges**
(plus a `*_tests.rs` filename rule) by the reconciling implementation; the census
engine does neither, and **both returned the same 13**, which is a stronger check
than either alone. Structurally, tests here construct executions through
`init_test_db` helpers rather than calling the spawn path.

**Backtracking:** the only unbounded-looking fill is `(?:[^;]{0,900}?)` — a
bounded lazy repetition of a single negated character class, with no nested
quantifier and no alternation that can match the same span. Full 963-file run:
**0.35 s**.

**Validated standalone** in a composer-private registry
(`registry-idempotent-invocation-composer.json` — a filename unique to this
composer, because sibling composers share the scratchpad), then **re-extracted
from this finished document and re-run: `files 11 / matches 13` and
`files 2 / matches 2`, identical both times.**

**Not every match is a live bug and the rule does not claim so.**
`build_simulate.rs:330` and `synthesize_review.rs:100` create simulation rows;
`director.rs:825`/`:937` run once per director tick. They are carried so the count
is a **population** rather than an opinion — the same treatment
`discarded-guard-verdict` gave its two benign members.

### The rule

```json
{
  "rules": [
    {
      "id": "unkeyed-billable-spawn",
      "goldenPath": "docs/concepts/golden-paths/idempotent-invocation.md",
      "title": "A billable agent run is started with the idempotency-key argument passed as the literal None, so the same logical request arriving twice starts two runs and bills twice",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\b(?:execute_persona_inner|create_with_idempotency)\\s*\\((?:[^;]{0,900}?)\\bNone\\s*,\\s*(?:/\\*[^*\\n]{0,60}\\*/\\s*)?(?:true|false|is_simulation)\\s*,?\\s*(?://[^\\n]{0,80}\\n\\s*)?\\)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A call to one of the two functions that create a `persona_executions` row whose IDEMPOTENCY-KEY ARGUMENT IS THE LITERAL `None`. The slot is identified positionally and unambiguously: it is the second-to-last argument, immediately followed by the `is_simulation` boolean and the closing paren, so `None, false)` / `None, /* is_simulation */ true)` matches and `Some(idempotency_key), false)` does not. PROXY FOR the stack-free condition: a code path starts an irreversible, billable unit of work while supplying no value that identifies WHICH request asked for it, so the system cannot recognise the same request arriving a second time and the second arrival is indistinguishable from a new one. THE SHAPE IS NOT AN ACCIDENT OF THE AUTHOR: the parameter is POSITIONAL AND REQUIRED - every one of these 15 authors had to type something in that slot, and 13 typed `None`, EIGHT of them under a `/* idempotency_key */` comment naming the thing they were declining. That is why requiredness is not the fix here; see the golden path's 'Prefer a type over a gate' qualification 2. EXECUTED, not argued (node:sqlite, 2026-08-16, statements transcribed verbatim from db/src/repos/execution/executions.rs:543-583 and the partial unique index from db/src/migrations/incremental.rs:2139-2140): with NO key, two calls insert two rows and spawn two engines (`rows inserted=2, ENGINE SPAWNS=2`); with the SAME key, `ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING` holds the row count at 1 across all three interleavings (fresh/pre-check-hit/conflict-reread) - so the constraint works and the KEY IS THE ONLY THING MISSING. Also executed: two inserts with a NULL key both land (changes 1,1) because a NULL is not in the partial index, which is why 2,176 of 2,188 live rows are outside the guarantee and the index protects 0.55% of the table. MEASURED 2026-08-16 at 19884e1f0: 13 matches across 11 of 963 .rs files, ALL THIRTEEN OPENED AND READ (precision 13/13), commentMatchesSkipped 0. Population and partition: the 15 production sites that reach a persona_executions insert (excluding the unkeyed constructor and two pure conduits that forward their caller's parameter) split 13 violating / 2 compliant, and 13 + 2 = 15 exactly, so there is no unexamined third population. THE THIRTEEN: commands/core/use_cases.rs:639 and :700 (the team-assignment dispatch path, which is where all 11 duplicate-execution groups in the live database sit); engine/director.rs:825 and :937; engine/director_memory.rs:160; cloud/remote_commands.rs:294 - the command whose CLOUD-side double-approval was fixed on 2026-08-16 at 1ad67db14 and which still spawns the persona unkeyed, while src/lib/tauriInvoke.ts:75-77 puts it on BLOCKING_MUTATION_TIMEOUTS with the reason stated as 'No backend dedup - a post-timeout retry would run the persona a second time' (cmd.id is a perfect natural key one expression away); commands/companion/approvals/approval_exec_core.rs:29; commands/design/build_simulate.rs:330; commands/design/reviews.rs:1364; commands/teams/deliberations.rs:258; commands/testing/synthesize_review.rs:100; engine/background.rs:1561 (the dry-run trigger fire); src/lib.rs:1319 (the F7 fix-loop worker, which RE-ENTERS a persona after a quality-failed run - the one site where a redelivery is designed in). NOT EVERY MATCH IS A LIVE BUG AND THE RULE DOES NOT CLAIM SO: build_simulate.rs:330 and synthesize_review.rs:100 create simulation rows and director.rs runs once per tick; they are carried so the count is a population rather than an opinion. THE TWO COMPLIANT SITES ARE THE DOCTRINE: engine/discord_poller.rs:251 passes `format!(\"discord:{}:{}\", channel_id, msg.id)` and engine/slack_poller.rs:297 passes `format!(\"slack:{}:{}\", channel_id, msg.ts)` - keys derived from THE SOURCE'S OWN ID, therefore replay-safe across a restart. Contrast src/api/agents/executions.ts:67, `idempotencyKey ?? crypto.randomUUID()`, which mints a fresh key PER CALL and therefore dedupes nothing, under a comment claiming it self-dedups double-clicks - while src/stores/slices/agents/executionSlice.ts:408-412, one layer up the same call chain, documents that exact defect and fixes it with a request-signature key. ONE EXCLUSION, BY PATH WITH A REASON, NOT BY WEAKENING THE PATTERN: db/src/repos/execution/executions.rs is the deliberate no-dedup constructor (`create()` at :471 delegating to create_with_idempotency with None) - it is the unkeyed door itself rather than a caller that declined, and excluding it is what lets this rule reach zero when the 13 callers are keyed. TWO INDEPENDENT IMPLEMENTATIONS AGREED AT 12 AND BOTH WERE WRONG: a paren-aware argument extractor and the census engine's first draft both missed engine/background.rs:1561, whose argument list closes as `None,` newline `true, // is_simulation` newline `)` - a TRAILING LINE COMMENT INSIDE THE CALL, which ignoreCommentLines does not strip because it removes whole comment lines and not line-tail comments. The published pattern admits `(?://[^\\n]{0,80}\\n\\s*)?` before the closing paren and both implementations now return 13. A third scan, hunting 'a per-call UUID used as an idempotency key' in TypeScript, keyed on identifiers matching idempotenc|dedup|request_?id|nonce and returned 3 - MISSING src/api/agents/executions.ts:67, the single most consequential site in the document, because its binding is named `resolvedKey`. A vocabulary-based signal's recall is bounded by its author's word list and the misses cluster on the interesting cases. CONTAMINATION: zero - the reconciling implementation removed #[cfg(test)] as BRACE-MATCHED RANGES plus a *_tests.rs filename rule, the census engine does neither, and both returned the same 13; tests here build executions through init_test_db helpers rather than calling the spawn path. BACKTRACKING: the only broad fill is `(?:[^;]{0,900}?)`, a bounded lazy repetition of one negated character class with no nested quantifier and no same-span alternation; full 963-file run 0.35s. DOES NOT OVERLAP unverifiable-conflict-clause, its nearest neighbour and its complement: that rule fires on statements that HAVE a conflict clause and asks whether the author named the constraint, this one fires on call sites that supply no key so no conflict clause is reachable - verified zero match-position overlap, since its 71 matches are INSERT string literals and these 13 are Rust call expressions containing no SQL. Nor discarded-guard-verdict or blind-identity-write (both about writes to a row known to exist). Nor unfenced-work-outcome-write, its sibling at the opposite end of the same unit of work: that one guards the SETTLE, this one guards the DECISION TO START. Nor constraintless-table-declaration, which keys on nullability rather than uniqueness - the uniqueness analogue was measured and REFUSED (241 tables, 20 unique indexes, ~93% with no natural-key constraint; a gate firing 220 times is a to-do list, and most of those tables are audit logs that correctly permit repeats). LEGAL FIX, one expression each: derive a key from the request. cloud/remote_commands.rs:294 -> `Some(format!(\"remote-command:{id}\"))`; use_cases.rs:700 -> the assignment id it already holds; lib.rs:1319 -> the fix-loop request's own identity. engine/discord_poller.rs:250 is the shape to copy. Do NOT silence a match by passing `Some(Uuid::new_v4().to_string())` - that satisfies the pattern and dedupes NOTHING, and it is the exact defect this golden path's section 2(a) exists to name; do not silence it by moving the argument onto its own line or by introducing a local `let key = None;`, both of which preserve the defect. PRECONDITION (must be re-derived per repo): this repo creates executions through two Rust functions taking a positional `Option<String>` idempotency key immediately before an `is_simulation` bool. A repo on Prisma spells the identical condition as prisma.job.create({data}) with no unique key in the model, and this pattern scores a structural zero there while the condition is present at scale - personas-web and vibeman have no client-generated idempotency key anywhere and would report clean forever. END OF LIFE: this rule is designed to reach zero - all 13 are one-expression fixes - and the golden path's 'Prefer a type over a gate' proposes a Spawn { Created | Deduped } return that makes the KEY actually effective (without it, a supplied key still double-spawns while the row is queued: see deviation D1). When the count reaches 0 the runner fails structurally on zero-matches, BY DESIGN: DELETE the rule then, do not baseline it at 0.",
        "$measured": "2026-08-16 @ 19884e1f0 — 963 .rs files walked, floor 900, run 0.35s; two independent implementations reconciled at 13/2 after a diagnosed trailing-line-comment gap; every match hand-read; six interleavings of create_with_idempotency replayed against real SQLite; live counts from a read-only copy of personas.db (2,188 executions, 12 keyed, 11 duplicate-run groups worth $9.74 in a 60s bucket)."
      },
      "exclude": [
        {
          "path": "src-tauri/db/src/repos/execution/executions.rs",
          "reason": "the deliberate no-dedup constructor itself — `create()` at :471 delegates to `create_with_idempotency(.., None, false)` and IS the unkeyed door, not a caller who declined the key. Excluding it is what allows this rule to reach zero once the 13 callers are keyed; the door's own removal is tracked in the golden path's type proposal instead."
        }
      ],
      "baseline": { "files": 11, "matches": 13 },
      "floor": 900
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "unkeyed-billable-spawn-positive-control",
  "goldenPath": "docs/concepts/golden-paths/idempotent-invocation.md",
  "title": "POSITIVE CONTROL — the same billable spawn whose idempotency-key argument is a real value",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b(?:execute_persona_inner|create_with_idempotency)\\s*\\((?:[^;]{0,900}?)\\bSome\\s*\\([^()]{0,120}\\)\\s*,\\s*(?:/\\*[^*\\n]{0,60}\\*/\\s*)?(?:true|false|is_simulation)\\s*,?\\s*(?://[^\\n]{0,80}\\n\\s*)?\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "$measured": "2026-08-16 @ 19884e1f0 — validated standalone in a scratch registry, then re-extracted from this document and re-run; 2 files / 2 matches both times.",
    "description": "CONTROL, not a gate. The IDENTICAL positional anchor as unkeyed-billable-spawn — the same two function names, the same second-to-last slot immediately before the is_simulation bool — with `Some(..)` in that slot instead of `None`. The two are mutually exclusive BY CONSTRUCTION rather than empirically: one requires the literal `None` there, the other requires a `Some(..)`. MEASURED 2026-08-16 at 19884e1f0: 2 matches across 2 files versus the gate's 13 across 11. PARTITION, NOT A RATIO: the anchor sees all 15 production sites that reach a persona_executions insert and 13 + 2 = 15 exactly, so every such site is classified; the excluded 16th is the unkeyed constructor `create()` and the two conduits (commands/execution/executions.rs:160 and :377) forward their caller's parameter rather than choosing a value, so they are neither. The 2 compliant sites are engine/discord_poller.rs:251 and engine/slack_poller.rs:297, and WHAT THEY DEMONSTRATE IS THE DOCTRINE, not merely compliance: both keys are `format!(\"<provider>:{}:{}\", channel_id, message_id)` — derived from an id THE SOURCE SUPPLIED, so the same key is reproduced on a restart, on a re-poll, and on a cursor rewind. A control that merely counted `Some(..)` would also pass for `Some(Uuid::new_v4().to_string())`, which dedupes nothing; that this repo's only two compliant sites are BOTH provider-derived is the evidence behind the golden path's section 2(a), and it converges with brainiac, ascent and personas-cloud, which independently reinvented the same rule. 13% of this repo's billable spawns identify their request; 87% do not. If this control's count ever collapses toward the gate's, the shared positional anchor has broken and BOTH numbers are meaningless — that is the failure this control exists to make visible, and it already caught one: on the first run both this control and the gate were computed by a second implementation that agreed at 12/2, and both were wrong, because engine/background.rs:1561 closes its argument list with a trailing `// is_simulation` line comment that ignoreCommentLines does not strip. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; the census engine exempts a `-positive-control` id from the baseline requirement and the registry merge skips it by construction."
  },
  "$measured": "2026-08-16 @ 19884e1f0 — validated standalone in a scratch registry, then re-extracted from this document and re-run; 2 files / 2 matches both times."
}
```

### Gates I rejected, with numbers

| candidate | violating | compliant | why rejected |
| --- | ---: | ---: | --- |
| **a `#[tauri::command]` named `list_`/`get_`/`fetch_` that WRITES** — the contract `tauriInvoke.ts:161`'s 250 ms auto-dedup depends on | **0** | **333** | The strongest *positive* result in this sweep and therefore not a gate. All 1,666 commands were brace-matched and their bodies scanned: of 333 read-named commands, **zero** contain a SQL write literal, and the 4 with a write-*verb* call are 3 `HashMap::insert` and one `write_cache` in `live_roadmap.rs:163`. **Precision ≤1/4.** The naming contract that the wrapper silently relies on holds today; nothing enforces it, and a rule at 0 matches fails the runner structurally. Carried as §5's last anti-pattern. |
| **a table with no UNIQUE index on a natural key** — D6's condition | ~220 | ~20 | **241 tables, 20 unique indexes.** ~93% would fire, and most correctly: audit logs, event streams and message tables are *supposed* to permit identical rows. A gate firing on 220 members is a to-do list, and the honest discriminator ("does this table hold externally-originated records?") has no textual signal. Carried as D6, where the *sibling-table* contrast supplies the evidence a count could not. |
| **a per-call UUID used as an idempotency key** — §2(a)'s whole doctrine | 3 (true 4) | 1 | n=4 after hand-correction, and **the scan missed the worst member** (`executions.ts:67`, bound to `resolvedKey`) because the signal was vocabulary-based. A 4-member population whose detector has demonstrated 75% recall is not a ratchet. Carried as D4 and as §2(a). |
| **a mutating command invoked inside a `useEffect` body** | **1** | — | Measured across 4,829 files with brace-matched effect bodies: exactly one (`DeepScanRecommendations.tsx:38`, `scan_sweep`). The condition is genuinely near-absent here — a real finding about this codebase and not a gate. |
| **a retry/backoff wrapper around a mutating IPC call** | **1** | — | Also near-absent: no `react-query`, no `swr`, no `p-retry` in `package.json`; `lazyRetry` retries a chunk fetch, and `_invokeCore`'s one-shot auth retry (`tauriInvoke.ts:524-532`) fires **pre-execution**, so it is safe by accident rather than by assertion. n=1. Carried as §8 Gap 5 and as a note in D9. |
| **a dedupe verdict re-derived from the entity's own status** — D1, the document's headline | **1** | 0 | The single most consequential defect here and it is **n=1** with no compliant example anywhere to control against. The honest instrument is not a matcher but the four-line replay in §9's measurement — claim a key, call twice before the first leaves `queued`, assert one spawn — and that test does not exist. Carried as D1 and as the `Spawn` type proposal. |

The pattern across those six rejections is the shape of the whole leaf: **supplying
a key is a presence and recognising a repeat is an absence.** The census counts
presences, so the gate lands on the one member of the family that *is* one — the
spawn that declined its key — and the other five findings are held by §7, by the
type proposal, and by a test this repo does not yet have.

### What the census fundamentally cannot gate here

- **"This key can never repeat."** `Some(format!("discord:{}:{}", …))` and
  `Some(Uuid::new_v4().to_string())` are the same type, the same shape, and
  opposite behaviour. No matcher separates a key derived from the request from one
  minted for the attempt; §2(a) is prose for that reason, and the positive control
  above says so explicitly so a future author does not "fix" a violation by
  satisfying the pattern.
- **"Nothing anywhere recognises this request a second time."** Every headline
  finding in §7 except D1 and D5 is an *absence* — no index, no key, no filter, no
  release. They were found by enumerating the live schema and every argument list
  against it, which is a program.
- **The runtime instrument this leaf actually wants** is a counter on
  `create_with_idempotency` that reports the ratio of `Deduped` to `Created`. Today
  that ratio is unobservable because the branch is discarded at the `return` — so
  the type change in *Prefer a type over a gate* is also the only thing that makes
  the condition measurable at all. **The type is the instrument.**

## 12 Corrections to the brief

1. **"The frontend has ~1,661 Tauri command invocations" — WRONG, and the number
   belongs to the other side of the wire.** The true figure is **1,528** invocation
   sites (1,475 production + 53 test), reconciled from two implementations that
   disagreed (ripgrep 1,538 with 10 comment false positives; an AST walker 1,526,
   missing 2 raw `invoke`s obtained by **dynamic `import()`** at `App.tsx:237` and
   `freezeDetector.ts:36`, which no static-import analysis and no
   `no-restricted-imports` rule can see). **1,666** is the count of
   `#[tauri::command]` functions in Rust with `#[cfg(test)]` brace-matched out —
   which is almost certainly where ~1,661 came from. The brief attributed a
   backend count to the frontend.
2. **"How many are naturally idempotent, how many are guarded, and how many are
   neither" — the classification the brief asked for cannot be done from verb
   prefixes, and that is a finding about the command surface.** A prefix classifier
   leaves **65%** of the 1,463 distinct commands unclassified, because the naming
   convention is **domain-first, not verb-first**: the top first-tokens are `get_`
   178, **`dev_` 176**, `list_` 125, **`companion_` 115**, across 181 distinct
   prefixes, and the verb sits in position 2 (`dev_tools_create_finding`,
   `companion_send_message`). Token-anywhere classification gives 495 read / 672
   mutation / 304 unclassified. The answer to the brief's actual question is
   **669 distinct mutation commands, of which 1 has an end-to-end idempotency key.**
   Ranking them "by call-site count" is also meaningless: **666 of the 669 have
   exactly one call site**, because `src/api/**` is a 1:1 wrapper layer holding
   95.5% of all invocations.
3. **"Is there any request-id / idempotency-key concept anywhere" — yes, three,
   and they are not the same thing.** `execute_persona` (`Option<String>`, SQLite
   column, partial UNIQUE index, survives restart), `dev_tools_create_finding`
   (`dedup_key`, `(project_id, dedup_key)` UNIQUE), and
   `companion_mcp_resolve_request` (`request_id`, an in-memory HashMap — pure
   correlation, no dedupe). Zero repo-wide hits for `correlation_id`,
   `client_token`, `X-Request-Id` or `Idempotency-Key`. There is also a
   **restart-surviving client-side nonce ledger** (`sendNonceLedger.ts`) that is
   never transmitted (§8 Gap 4).
4. **"Check whether the other cloud write paths have the same shape" — yes, three
   of the four in the same file, and the fix was not generalised.** D3.
5. **"`AsyncButton` exists specifically to disarm double-submit … measure
   adoption" — adoption is good and the failure is not adoption.** 49 renders
   across 39 files is the best client-side number in the six-repo family (the
   sibling ratio of shared:hand-rolled is 0:16, 2:126 and 6:30). The defect is that
   **7 of the 49 are silently disarmed by a `void`, and all 7 render a correct
   spinner**, so the guard is off in exactly the cases QA cannot see. `void`-ing an
   `onClick` is not a type error because `MouseEventHandler` returns `void` — which
   makes this a type fix, not an adoption campaign.
6. **"8 durable claim sites … lease 1/8, release-on-failure 3/8" — accurate, and
   the fix landed on the transport, not on the callers.**
   `SyncClient::patch_returning_count` exists as of `1ad67db14` and has **one**
   caller. The other three mutating paths in the same file still use `patch`.
7. **A correction to a sibling path.**
   [inline-busy-state](./inline-busy-state.md) reports **261** `<Button>` render
   sites; the true figure at HEAD is **566** (AST; ripgrep says 568, and both
   extras are comments). The error is systematic rather than drift — **300 of the
   566 openers end their line right after the tag name**, so a single-line regex
   sees 266. Every ratio in that document using 261 as a denominator is inflated
   ~2.17×. Its other twelve re-measured claims all still hold exactly (49/39
   AsyncButton, 252 `LoadingSpinner`, 21 `ConfirmDialog`, 95 `loading=`, 10
   `aria-busy`, 0 `useAsyncAction` adopters, 2 per-entity in-flight sets).
8. **A methodology hazard worth carrying forward.** `rg` twice emitted
   `fatal runtime error: I/O error: operation failed to complete synchronously`
   **mid-stream on Windows** while still exiting into the pipe; piped through
   `wc -l` this produced a plausible **1,985** for a count whose true value is
   **2,879** — **31% low, with no error banner in the captured output.** Same
   family as the `head -3` truncation already recorded in `CLAUDE.md`: **a count
   that arrives without an error is not therefore complete.**
9. **A correction to my own hypothesis, recorded because it was wrong in an
   instructive direction.** `idx_sue_dedup ON skill_usage_events(session_id,
   skill_name, occurred_at)` and `idx_dre_dedup ON doc_read_events(session_id,
   project_id, doc_path, read_at)` are UNIQUE indexes named `_dedup` that include a
   **timestamp** in the key, and the live database holds 69 and 181 excess rows
   against them. That looks exactly like a broken dedupe key, and I had written it
   up as one. It is not: `skill_usage.rs:455-458` shows the timestamp is **the
   source transcript line's own**, `datetime(?)`-normalised *"so the dedup index
   holds across truncation-triggered re-parses"* — a provider-supplied value, the
   same category as `discord:{channel}:{msg_id}`. The duplicates are genuine
   distinct real-world reads. **A timestamp in a dedupe key is wrong when it is a
   clock read and right when it is part of the event's identity, and nothing about
   the index distinguishes them.**
10. **The leaf's `convergence: diverged` label survives, and it is diverged in an
    unusual direction.** The *constraint* clause is unanimous physics (5/5 with a
    partial-index design independently reinvented in Postgres); the *key on the
    wire* clause is physics at 3/5 with Personas holding the strongest mechanism
    and the weakest adoption; the *client guard* clause is inverted with no shared
    primitive anywhere and Personas leading; and the *client-and-server-agree*
    clause is a minority everywhere. A single label cannot carry that — but
    "diverged" is right, because the six repos disagree about **where** the
    guarantee lives, not about whether it is needed.
