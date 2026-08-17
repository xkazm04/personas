# Golden path — Agent dispatch

> Situation node: `ai-agents/agent-ux/agent-dispatch` · [situation spine](../situation-spine.md)
> recurrence **15** · risk **HIGH** · sides **client** · `twoSided: true` · convergence **diverged**
> dimensions: **function · resilience · cost · security**
> merged from *Agent session dispatch*, *Dispatching work to an agent*.
> Leaf definition: *"a button that spawns a Claude/Fleet session in some repo **and keeps it
> addressable afterwards**."* Composed 2026-08-16 against `master` @ `7b42f9333`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` under `src/` (**4,418** production, 411 test) and all
> **963** `.rs` under `src-tauri/`. Every production call expression reaching one of the seven
> session-starting doors was extracted **twice** — once by ripgrep-shaped regex, once by a
> TypeScript 6 AST walker climbing `await`/`void`/`.then` chains to the owning syntax node — and
> the two disagreed (§12.1). Read in full: `shared/dispatch/DispatchChooser.tsx`,
> `api/fleet/fleet.ts` (368 lines), `shared/components/buttons/AsyncButton.tsx`,
> `stores/slices/processActivitySlice.ts`, `stores/slices/agents/executionSlice.ts`,
> `overview/sub_patterns/{PracticeRolloutModal,ExtractionMenu,useHarvestAutoIngest}.tsx|ts`,
> `teams/sub_factory/passport/{passportFleet.tsx,improve/skillsWorkbenchData.ts}`,
> `teams/sub_mastermind/MastermindPage.tsx`, `plugins/fleet/{sub_grid/FleetGridPage.tsx,useFleetOverlayActions.ts}`,
> `src-tauri/src/commands/fleet/{persist.rs,external.rs,stale.rs,run.rs}`,
> `src-tauri/db/src/repos/fleet_sessions.rs`, `commands/companion/approvals/mod.rs`.
>
> **Measured by executing, not by reading.**
> 1. **Read-only copies of both live SQLite files** (`personas.db` 347 MB / 244 tables,
>    `personas_data.db` 17.5 MB / 71 tables, copied 2026-08-16 15:24 with their `-wal`/`-shm`,
>    opened `readOnly: true`; the live files were never opened for write while the app was
>    running). Queried for what dispatch actually left behind: **`fleet_sessions` 0 rows**,
>    **`dev_tasks` 9 rows of which 2 have been `status='running'` since 2026-04-09**,
>    **`persona_executions` 2,188**.
> 2. **The live app was observed read-only** through the test-automation harness on :17320
>    (`/eval` is fire-and-forget, so the result was stashed in a hidden DOM node and read back
>    through `/query`): `fleet_list_sessions` returns **0 sessions**. **Nothing was dispatched.**
>    No button was clicked, no session spawned, no row written.
> 3. **This repo's own dispatch door was replayed** in Node — `AsyncButton.handleClick`
>    (`AsyncButton.tsx:39-68`) and `DispatchChooserModal.dispatch` (`DispatchChooser.tsx:93-129`)
>    transcribed statement for statement, with React's commit lag modelled the way
>    `AsyncButton.tsx:28-34` describes it. That replay is what produced §7 D1 — **two presses,
>    two Claude sessions** — and §7 D2, which no amount of reading had.
> 4. The §9 rule was built, run in a **composer-private scratch registry with a filename unique to
>    this composer**, cross-checked against the AST census (identical membership), hand-verified
>    **6/6** and **9/9**, positive-controlled so the control **partitions the anchor exactly**
>    (6 + 9 = 15, no residue), fault-injected **six** ways — all six fire — then re-extracted from
>    this document and re-run. **The full registry was NOT run**, per the doctrine.
> 5. **`cargo` was not run.** Every Rust claim is static and traces to a file opened during
>    composition.
>
> ### Sibling boundaries, settled in prose
>
> [**informed-consent-gate**](./informed-consent-gate.md) owns *what the user was told before they
> authorised the run*. **This path owns what happens to the work after they said yes** — whether
> the app kept anything that can name, find, watch or stop it. A dispatch can be perfectly
> disclosed and still be unreachable one second later.
>
> [**idempotent-invocation**](./idempotent-invocation.md) owns *did the click land twice*, keyed on
> the Rust `idempotency_key` argument. **This path owns the client-side half of the same second
> press on a lane that has no key at all**: `fleet_spawn_session` takes no idempotency key and
> never will, so the whole guarantee has to live in the *name* (§2). Its D5 lists
> `DispatchChooser.tsx:175` among seven `void`-disarmed buttons; §7 D1 here **executes** that
> site and reports what the second press costs.
>
> [**inline-busy-state**](./inline-busy-state.md) owns *does the person who clicked know it
> landed*, and already routes multi-minute work to `processActivitySlice.processStarted(...)`.
> **This path owns the other half of that same record** — `ActiveProcess.navigateTo` is not a busy
> flag, it is the way back — and reports that **0 of its 17 registrations is a Fleet spawn** (§7 D3).
>
> [**cancelling-in-flight-work**](./cancelling-in-flight-work.md) owns the Stop button and the
> teardown. **This path owns whether the Stop button has an address to aim at.** Where the dispatch
> retained nothing, that path's mechanism is correct and unreachable.
>
> [**headless-model-call**](./headless-model-call.md) owns the *bounds on one unattended call*
> (`--max-budget-usd`, `--max-turns`, `build_cli_args`). **This path owns the door that starts
> one**, and adds the admission fact that path did not need: the Fleet lane's concurrency cap
> defaults to **off** (§7 D4). [**spend-ceilings**](./spend-ceilings.md) owns whether a ceiling
> refuses; [**long-running-job-progress**](./long-running-job-progress.md) owns job registration
> and readback and already records `dev_tasks` as having no recovery pass — §7 D6 supplies its
> live artefact and defers ownership.
>
> The **Deviations** section is a fix backlog and contains **one executed double-dispatch path**
> (D1), **one check-then-act that lets three concurrent presses spawn three sessions** (D2), and
> six one-expression repairs.

---

## 0. The headline, before anything else

**This app wrote one universal dispatch surface, documented it in its own first line as "ONE
consent surface for handing a prepared prompt to an agent", rendered it at three call sites — and
then spawned agents from forty other places. On the transport that most needs a handle, six of
those places throw the handle away.**

```
src/features/shared/dispatch/DispatchChooser.tsx:1-20   the doc comment describing the four transports
                                        3 render sites: SurfaceRenderer.tsx:139
                                                        ShipMilestoneComposer.tsx:168
                                                        PassportActionsRow.tsx:220
```

| | n |
|---|---:|
| production call expressions that start an agent session or run (7 doors, two implementations reconciled) | **44** across **33** files |
| ↳ Fleet lane (`spawnSession` · `spawnHeadlessSession` · `spawnExternalConsole` · `wakeSession` · `resumeOrphan`) | 20 |
| ↳ persona / dev-runner lane (`executePersona` · `executeTask`) | 24 |
| `<DispatchChooserModal>` render sites | **3** |
| the two **app-managed** Fleet spawn doors (`spawnSession`, `spawnHeadlessSession`) | **15** |
| ↳ **discard the session id and never name the session** | **6** |
| ↳ bind the id | 9 |
| `processStarted(domain, runId, label, navigateTo)` registrations app-wide | 17 (14 carry `navigateTo`) |
| ↳ **at a Fleet spawn** | **0** |
| `beginRun()` / `endRun()` — the run-labelling door | **0 callers** |
| dispatch surfaces that show the operator the prompt before it runs | **1** |
| dispatch surfaces that show a cost | **0** |

The four-way partition of the 17 Fleet spawns is the whole subject:

| what the spawn does with what it was handed | n | sites |
|---|---:|---|
| **names the session with a key it can recompute** — `renameSession(id, key)` | 5 | `PracticeRolloutModal:76` · `ExtractionMenu:269` · `passportFleet:66` · `DispatchChooser:106,:119` |
| **focuses it in the Fleet surface itself** — `setActiveSession(id)` / `setPreviewId(id)` | 4 | `FleetGridPage:328,:329` · `useFleetOverlayActions:84` · `MastermindPage:748` |
| **the external console, which by written design has no handle** | 2 | `DispatchChooser:112` · `skillsWorkbenchData:255` |
| **neither — the id is discarded and the session is anonymous** | **6** | §9's population |

### The second headline: the largest dispatcher in the app returns an English sentence

`companion_dispatch_fleet_plan` (`approval_exec_fleet.rs:1828`) spawns a plan's worth of Fleet
sessions and returns `Ok(result?.message)` (`:1901`). Every Athena approval goes through
`ExecuteResult` (`commands/companion/approvals/mod.rs:118-122`):

```rust
pub(crate) struct ExecuteResult {
    pub(crate) message: String,
    pub(crate) client_action: Option<ClientAction>,
}
```

Fifteen agent-starting actions multiplex through `execute_approval_action`'s table
(`approval_lifecycle.rs:144-266`) — `fleet_spawn`, `fleet_dispatch`, `canvas_dispatch`,
`canvas_group_dispatch`, `run_persona`, `run_arena`, `build_oneshot`, `assign_team`,
`night_shift_execute_plan`, … — and **not one id ever crosses back**. The chat card records
`dispatchedRows` as `{cwd, objective, skill}` (`:1886-1893`): what was dispatched, never which
sessions. The sessions *are* in the registry; the only way back to them is the `athena · …` name
prefix (`ATHENA_SESSION_NAME_SENTINEL`, `:1126`) — a string search over the grid.

### And the shape all of §7 reduces to

**The lane that can refuse a dispatch is the one that already had a handle; the lane that hands out
raw processes cannot refuse anything.**

| | persona lane (`execute_persona`) | Fleet lane (`fleet_spawn_session`) |
|---|---|---|
| admission | `tracker.admit(&persona.id, &execution_id, …)` (`engine/mod.rs:886`) → `Running \| Queued{position} \| QueueFull{max_depth}` (`engine/src/queue.rs:56-63`) | `free_slot_for_spawn(&app)` (`commands.rs:41`) |
| cap | `GLOBAL_MAX_CONCURRENT = 4` (`queue.rs:10`), hot-reloadable, per-persona depth 10 | `static MAX_LIVE_SESSIONS = AtomicU64::new(0)` (`stale.rs:151`) — **0 means off, and 0 is the default** |
| what happens at the cap | the row stays `queued` in SQLite; the queue is durable | *"If nothing is evictable … the spawn proceeds anyway — soft cap"* (`stale.rs:1390-1392`) |
| can a dispatch be refused? | yes | **no. No Fleet spawn is ever rejected.** |
| does the caller learn which happened? | yes — `AdmitResult` is a closed enum | there is nothing to learn |

And the Fleet lane is the one that runs `--dangerously-skip-permissions` as a hardcoded constant
(`pty.rs:324`, `:364`; `headless.rs:132`).

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
each clause carries its warrant, so an adopting repo can tell physics from local calibration. No
file path, primitive name or count appears below this line until the head ends.

> **P1 — physics, and the whole subject.** *A dispatch is not finished when the work starts; it is
> finished when the surface that started it can find it again.* The button is the cheap half. The
> expensive half is the address — a name, an id, a row — that survives the click handler, the
> component unmount, the navigation away and the process restart. A dispatch that returns a handle
> nobody keeps has produced a running agent and no way to reach it.
>
> **P2 — physics.** *Derive the address from the thing being worked on, never from the attempt.*
> A key computed from the entity ids (which repo, which item, which scope) can be recomputed by any
> surface at any later time, including a surface that did not exist when the work started. An id
> minted at spawn can only be remembered, and remembering is exactly what unmounting destroys.
>
> **P3 — physics.** *Name the work at the moment you create it, in the same statement.* The window
> between "the agent is running" and "the agent is labelled" is a window in which the work is
> anonymous, and every recovery mechanism you own is blind inside it. If naming is a second call,
> make it the very next line and treat a failure to name as a failure to dispatch.
>
> **P4 — physics, and the clause with the most external warrant.** *A second press must be refused
> at the door, and the refusal has to be synchronous.* Reactive state is committed a frame later
> than the click; a guard that reads it is a guard with a hole exactly the width of a double-click.
> The three places a repo can put this — the control, the caller's own registry, the server's
> constraint — are complements, not alternatives, and the first is the only one that is free.
>
> **P5 — physics.** *A check that reads a registry and then spawns is not a lock.* "Is one already
> running with this name?" followed by "start one with this name" is check-then-act, and two
> callers in that window both get "no". Either the naming and the spawn are one operation, or the
> answer is advisory and must be labelled advisory.
>
> **P6 — physics, and the one that decides severity.** *If you spawn a process you cannot refuse,
> you have no admission control — only a hint.* A cap that evicts when it can and proceeds when it
> cannot is a scheduling preference. It is a legitimate design, but a system that also treats it as
> a safety bound is wrong twice: about the bound, and about the default.
>
> **P7 — ergonomics.** *Show what will be sent, before it is sent, and let it be edited.* A prepared
> prompt is the entire content of the dispatch; a surface that shows a title and a button asks the
> operator to authorise text they have never seen. Editability costs one textarea and converts a
> yes/no into a correction.
>
> **P8 — ergonomics, cost.** *The first second belongs to the surface the operator is looking at,
> not to the surface that owns the work.* A dispatch that only manifests somewhere else has, from
> where the user is standing, done nothing. Put an optimistic record where they are, carry the run's
> identity and its live cost in it, and make it clickable to the real thing.
>
> **P9 — security.** *When a dispatch escalates privilege, the escalation is part of what is being
> dispatched.* If the spawn suppresses the runtime's own permission prompts, that fact belongs on
> the surface that spawns, in the same visual weight as the target directory — not in the argv, and
> not in a source comment.
>
> **P10 — resilience.** *A detached dispatch is a legitimate product decision and an illegitimate
> default.* Handing work to something the app cannot observe, steer or kill is sometimes exactly
> right. It must be a named transport that says so, chosen deliberately per call site — never the
> accidental result of dropping a handle.
>
> **Scale condition.** P4, P5 and P7 are correctness on the first dispatch. P1, P2, P3 and P8 begin
> to pay at the second surface that wants to reach the same work — which is usually the first time
> anyone asks "did that finish?". P6 and P10 arrive silently and are discovered the day something
> fans out. P9 is discovered by an auditor, never by a user.

### Warrant evidence — five siblings, censused independently

`personas-web` (Next.js), `brainiac` (Rust workspace + Next.js console), `personas-cloud`
(TS orchestrator/worker), `vibeman` (Next.js + Tauri), `ascent` (Next.js). All five present and
opened. `personas-web` is **NOT-APPLICABLE** throughout — it has no subprocess spawn anywhere in
`src/`; its only "fleet" is a 24-tick *animation* (`src/components/feature-sections/plugins/dev-tools-grid/athenaFleetData.ts:9-14`).
It can watch a run it never started (`src/app/api/executions/[id]/stream/route.ts:13`), which is
this leaf inverted and worth noting.

- **P1 is SPLIT, and the counter-example is argued rather than careless — the single most
  important result here.** `vibeman` retains at 5 of 5 spawn sites (`cli-service.ts:1074` returns
  the id; retained at `terminalStrategy.ts:103`, `cliExecutionManager.ts:205`,
  `CompactTerminal.tsx:591`, `groupHealthStore.ts:148`). `personas-cloud` mints
  `executionId: nanoid()` and returns 202 `{executionId, status:'queued'}` (`httpApi.ts:1629,1646`).
  But **`brainiac` deliberately made its runs non-addressable and wrote the reason in a migration
  header**: status is written back onto the same schedule row *"so the UI can show 'last scanned 2h
  ago — 7 clusters, 1 divergence' **without a separate history table**"*
  (`migrations/0018_sweep_schedules.sql:9-11`). Consequently `POST /v1/ops/sweeps/{kind}/run`
  returns **no run id** (`sweeps.rs:222-226`) and the client action is typed
  `Promise<void>` (`console/src/ops/sweep-actions.ts:24-27`). `ascent` also discards at the door
  and navigates **by subject** instead — `router.push('/report?repo=…')` (`ScanForm.tsx:148`).
  **So P1's real content is not "keep the id" — it is "have an address", and an entity-scoped
  address is a legitimate answer.** That is why §2 prescribes the *key*, not the id.
- **P2 and P3 are a genuine SILENCE. No sibling names a spawned unit of work with a recomputable
  key.** This is Personas' own invention (`harvestDispatchKey`, `adoptDispatchKey`) and must be
  labelled a house convention, strongly reasoned and externally untested.
- **P4 is PHYSICS — 4 of 4 applicable repos, at three different layers, and one of them paid for
  it.** `brainiac` puts it in the claim SQL: `last_status IS DISTINCT FROM 'running' OR last_run_at
  < now() - interval …` (`sweeps.rs:249-250`). `personas-cloud` puts it on the wire —
  `Idempotency-Key` honoured on every mutation including `/api/execute` (`httpApi.ts:1141-1159`),
  with *"Record dispatch before submitting — this is the idempotency key"* (`eventProcessor.ts:535`).
  `vibeman` runs all three layers at once: `if (scanning) return` (`GroupHealthScanButton.tsx:57`),
  a store check (`groupHealthStore.ts:78-80`), and a server 409 (`api/cross-task/route.ts:53`).
  `ascent`'s `ScanForm.tsx:105-117` carries a **paid-for-it comment**: its own guard bricked the
  form on a bfcache restore.
- **P6 is MINORITY and the sibling answer is better.** `vibeman`'s global concurrency cap
  **defers** rather than throwing (`cli-service.ts:1063-1072`); `personas-cloud` queues durably
  (`dispatcher.ts:1227`). Neither ships a cap whose default is *off*.
- **P7 is SILENCE — 0 of 4.** Nobody shows the prompt at the affordance. `vibeman` gets closest and
  misses instructively: `CrossTaskPanel` receives `promptContent` back from the server and pipes it
  straight into `directPrompt` **unrendered** (`:79`, `:103`), and its `PromptEditorModal`
  (`PromptEditorModal.tsx:41-47`) edits the prompt **template file on disk**, i.e. authoring, not
  this-run preview. **Personas is alone on this clause and it is the best thing in this leaf.**
- **P8 is MINORITY — three answers, no convention.** `vibeman` inserts an optimistic `ActiveScan`
  with a synthetic *"Initializing…"* message **before** the execute POST
  (`groupHealthStore.ts:108-133`, then `:136`). `ascent` navigates (`ScanForm.tsx:148`) or swaps a
  label with no optimistic row (`RepoRescanButton.tsx:67,:85`). `brainiac` dims the panel
  (`SweepControl.tsx:101`) and its header admits *"status flips running → ok on a later paint"*
  (`:9-10`).
- **P9 is SILENCE at the UI layer in every repo, and the one repo that models it defaults to
  maximum.** `--dangerously-skip-permissions` occurs in `vibeman` at 4 code sites and **zero
  `.tsx` files**. `personas-cloud` is the only sibling with a typed permission model, and
  `buildPermissionArgs(null)` returns the skip flag (`packages/shared/src/prompt.ts:725-742`) while
  the dispatch door never populates the field (`httpApi.ts:1628-1636`). Only `ascent` moves the
  other way — `delete env.ANTHROPIC_API_KEY` and `cwd: tmpdir()` with the reasoning inline
  (`claude-cli.ts:100,:104`) — and even that is a comment, not a surface.
- **P10 is SILENCE, and the sibling case shows what the accidental version looks like.** No repo
  labels an agent spawn as detached. `vibeman`'s `execute_claude` moves the `Child` into a wait task
  (`claude_cmds.rs:451-452`) with `CREATE_NEW_PROCESS_GROUP` (`:330`) and returns `{execution_id,
  pid}` (`:491-494`) — with **no label at all**. Personas' `external.rs:13-14` is the only written
  statement of this trade-off in six repos.
- **P1's corollary is CONVERGENT AS A FAILURE and that changes §7's severity.** `vibeman` built
  `TerminalStrategy.execute()` precisely to own the POST and the handle registration
  (`terminalStrategy.ts:73-103`) and then hand-rolled the identical POST twice in one file
  (`CompactTerminal.tsx:555`, `:759`) plus four more bypasses — **≈1 shared : 6 hand-rolled**, on
  top of ≥8 bespoke spawn buttons. `ascent` documents the duplication as intent: *"Mirrors
  OrgScanButton's SSE consumption … and ScheduleSelect's … presentation"*
  (`RepoRescanButton.tsx:3-8`). **So "built a universal dispatch surface and routed around it" is
  not local carelessness — it is what happens to dispatch abstractions in every repo that has
  one**, and §9 therefore gates the *consequence* (an unaddressable spawn) rather than
  non-adoption of the component.
- **P6's other half — durable registry plus boot reconciliation — is PHYSICS, independently
  reinvented with near-identical vocabulary.** `personas-cloud` persists the whole `ExecRequest` as
  `queue_data` at submit and runs `recoverQueue()` / `recoverStaleRunningExecutions()` on boot
  (`dispatcher.ts:1227`, `:1144-1189`). `vibeman` persists pid + `claude_session_id` and runs
  `reapOrphanedProcesses()` / `startStaleSessionSweeper()` at boot (`cli-service.ts:618-627`;
  `src/app/db/schema.postinit.ts:8-14`), then extends it to the client with the reason written
  down: *"recovery must NOT blindly re-queue and restart tasks — that would create duplicate
  processes"* (`cliExecutionManager.ts:606-616`). Personas' `fleet/persist.rs` is the same design,
  arrived at independently.

**The sharpest single sibling finding, because Personas is one refactor away from it.**
`vibeman`'s Stop button addresses a registry the spawn never wrote to: `execute_claude` returns
`{execution_id, pid}` and the code under its `// Track in process manager` comment
(`claude_cmds.rs:483`) is *only a `log::info!`* — the sole writer to that registry is a different
command (`process_cmds.rs:98`) — while `abort_claude` (`claude_cmds.rs:503`) and
`claude_execution_status` (`:968`) both look the session up by `execution_id`. **Handle returned,
handle unusable.** That is what a repo looks like after enough dispatch doors have discarded
enough handles.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "add a button that runs `/<skill>` in this repo"
- "dispatch this to Fleet / to the runner / to a console"
- "kick off an agent for this row" · "run this in the background and tell me when it's done"
- "we spawned it — how do I get back to it?" · "which of these tiles is the one I just started?"
- "did that finish?" — asked about work this surface itself started
- **The "about to write X" test:** you are about to type `spawnSession(`, `spawnHeadlessSession(`,
  `spawnExternalConsole(`, `executeTask(`, `Command::new("claude")`, `await someSpawn(...)` as a
  bare statement, `void spawn…().then(toast)`, `fleetRefresh()` immediately after a spawn, or a
  `listSessions()` call whose purpose is to decide whether to spawn.

You are **not** in this situation when the question is what the confirmation dialog *says*
([informed-consent-gate](./informed-consent-gate.md)), whether the same request arrived twice on
the *server* ([idempotent-invocation](./idempotent-invocation.md)), whether the *control* looks
busy ([inline-busy-state](./inline-busy-state.md)), how the Stop button tears a child down
([cancelling-in-flight-work](./cancelling-in-flight-work.md)), or what bounds one unattended model
call ([headless-model-call](./headless-model-call.md)). **The discriminator is that a UI affordance
creates a long-lived, externally-running unit of work, and something later has to point at it.**

---

## 2. The one way

**Compute a dispatch key from the entities before you spawn, check it, spawn, name the session with
it in the very next statement, and persist the key next to the thing the work is about.** Concretely:
reach for `DispatchChooserModal` when the operator should choose a transport and see the prompt; for
a fixed-transport button, copy the workspace-harvest lane exactly. Write a pure key function beside
your prompt builder — `harvestDispatchKey(workspaceId, projectId, scopeId)` shape, entity ids only,
never `Date.now()` and never the session id — because a key derived from the request can be
**recomputed** by a surface that has forgotten everything, and an id can only be remembered. Then
`listSessions()` and refuse if a non-exited session already holds the key (advisory — see P5 and
§7 D2); `const id = await spawnSession(cwd, [prompt])`; `await renameSession(id, key)` on the next
line; and write the key into the domain row (`setWorkspaceAdoption(…, 'dispatched', undefined, key)`)
so the address outlives the component. Register the dispatch where the user is standing —
`processStarted(domain, runId, label, navigateTo)` — because `navigateTo` is the click target that
turns a toast into a way back, and because that record is where live cost accrues. **Return the
promise from `onClick` and let `AsyncButton` own the guard: `onClick={() => dispatch()}`, never
`onClick={() => void dispatch()}`, which releases the synchronous re-entry ref one line later and
leaves only React's next-frame state** (executed: two presses, two Claude sessions — §7 D1). If the
transport genuinely cannot be reclaimed, use the one that says so — `spawnExternalConsole`, whose
module header states *"Fleet cannot observe, steer, hibernate or kill it… this path must not be
used for anything the app later needs to reconcile"* — and **say so on the button**, together with
the permission mode, which today reaches the UI at two sites and is rendered at none. Then stop: do
not poll `listSessions()` for a session you could have named; do not call `fleetRefresh()` and hope;
do not add a second in-memory map of what you spawned.

If you can only get one right: **the key**. Everything else is recoverable from it — the dedup
check, the reopen, the watcher, the auto-ingest. Nothing is recoverable without it.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
| --- | --- |
| **`src/features/shared/dispatch/DispatchChooser.tsx` — `DispatchChooserModal`** | **The universal door, and the only surface in 4,829 files that shows the operator the prompt before it runs and lets them edit it** (`:163-169`, `prompt` bound to a textarea). Four transports as `role="radiogroup"` cards, a `prepare?: () => Promise<void>` hook that *"aborts the dispatch with the error surfaced, so a half-prepared repo never gets a session pointed at it"* (`:51-56`), a `fleetKey` that defaults to a derived string (`:91`), `renameSession` after every managed spawn, and `onDispatched?(method, ref)` handing the caller the id. **3 render sites. Its own button is disarmed — §7 D1.** |
| **`overview/sub_patterns/practiceHarvestPrompt.ts:38` `harvestDispatchKey` · `adoptPracticePrompt.ts:18` `adoptDispatchKey`** | **The address, and the thing this leaf is named for.** Pure functions of entity ids → `workspace-harvest:<ws>:<proj>:<scope>` / `workspace:adopt:<practice>:<proj>`. `harvestDispatchKey`'s docstring states the design rule: *"The scope is part of the key: several territories of the same repo are meant to run concurrently, and a repo-level key would make them collide as duplicates of each other."* Recomputable by any surface, at any later time, with no memory of the dispatch. |
| **`api/fleet/fleet.ts:115` `renameSession(sessionId, name)`** | The naming half. One line after the spawn, and the session becomes findable by a string the caller can regenerate. The Rust side trims and treats empty as null. |
| **`api/devTools/workspaces.ts:322` `setWorkspaceAdoption(practiceId, projectId, state, note?, fleetKey?)`** | **The persistence half — the only door in the tree that writes a dispatch key into a domain row.** This is what makes the address survive an app restart, not just a component unmount. |
| **`overview/sub_patterns/useHarvestAutoIngest.ts:92-110`** | The readback half: poll `listSessions()`, match `s.name === key \|\| s.name.startsWith(`${key}:`)`, and fire on the live→gone transition. The key is recomputed inside the loop (`:96`) — the hook holds no memory of what was dispatched. |
| **`stores/slices/processActivitySlice.ts:240` `processStarted(domain, runId, label, navigateTo)`** | **The optimistic, addressable, navigable record of a dispatch.** `ActiveProcess` (`:30-42`) carries `runId`, `status`, `toolCallCount`, **`costUsd`**, `lastEvent`, `queuePosition` and **`navigateTo: {section, tab?, personaId?, chatSessionId?}`** — the click target of the titlebar dock row. `enrichProcess` folds live telemetry in; `updateProcessStatus` can add a `navigateTo` later. 17 registrations, 14 with `navigateTo`. |
| **`shared/components/buttons/AsyncButton.tsx:39-68`** | The synchronous double-submit guard: `inFlightRef` set before the handler runs, `e.preventDefault()` on re-entry, released in `.finally()` so a failure is retryable, plus its own `internalLoading` so you need not thread `isLoading`. **It arms only if your handler returns a thenable (`:55`)** — the comment at `:28-34` states exactly why the reactive flag alone is not enough. |
| **`stores/slices/agents/executionSlice.ts:359-500`** | The reference **client** dispatch for the persona lane: a budget refusal before any async work (`:363-367`), the execution-state lock taken *"immediately before any async work to close the race-window"* (`:376-380`), a pipeline trace, and an idempotency key derived from `executionRequestSignature(...)` with the defect it fixes written down at `:408-412`. |
| **`src-tauri/src/commands/fleet/persist.rs`** | **The durable registry, and the convergent one** (see the head). `note_changed` piggybacks the two existing emit points so no lane gets a private write path (`:15-19`); writes go through one dedicated thread so *"a DB stall can never wedge the PTY"*; `rehydrate` (`:200`) restores rows as **dozing tombstones** reusing the existing wake path rather than inventing a state; `recover_after_restart` (`:263`) force-parks Athena-owned mid-task orphans to `AwaitingInput` and **deliberately refuses** to auto-kill-and-resume (`:259-262`). Only rows with a bound `claude_session_id` are persisted — see §8.2. |
| **`src-tauri/src/commands/fleet/external.rs:13-14, :189-191`** | **The labelled non-addressable transport** — the P10 exemplar and, per the oracle, the only written statement of this trade-off in six repos: *"The handle is dropped immediately: this process is the operator's, not ours. `std::process::Command` does not kill on drop, so it survives."* Its `skip_permissions: Option<bool>` (`:124`) is also the app's **only** parameterised permission escalation (`unwrap_or(false)` at `:138`, rationale at `:109-115`). |
| **`src-tauri/src/commands/infrastructure/dev_tools.rs:1042` `dev_tools_dispatch_ideas`** | The one Rust dispatch command that hands ids back: `DispatchedIdea { session_id: Option<String>, task_id }` (`:957-969`). Copy this return shape, not `ExecuteResult`. |

**Do not exist — this path names them:**

- **Any dispatch helper that owns the key.** `spawnSession(cwd, args?)` is the only door, it takes
  no key, and the naming is a second call five of fifteen callers remember to make. See §4's type
  proposal.
- **Any way for an Athena-dispatched session to be addressed other than a name-prefix string
  search.** `ExecuteResult` has no id field (`approvals/mod.rs:118-122`).
- **Any caller of `beginRun()` / `endRun()`.** Both are exported from `api/fleet/fleet.ts:309,:313`
  and invoked **nowhere** in `src/`. Every run in the app is therefore the 2-minute
  `DISPATCH_WINDOW_MS` auto-group (`run.rs:29`) with a `None` label, which the UI calls "ad hoc"
  (`run.rs:58-60`).
- **Any cost figure on any dispatch surface.** Confirmed independently of
  [informed-consent-gate](./informed-consent-gate.md) §7.D: `ExecutionPreviewPanel` has **0 render
  sites** and `previewExecution` has exactly one consumer, that unmounted panel.
- **Any recovery pass for `dev_tasks`.** §7 D6.

---

## 4. Steps

1. **Write the key function first, above the prompt builder, as a pure function of entity ids.**
   If you cannot name the entities that make two dispatches "the same dispatch", you do not yet
   know what you are starting. Put the reasoning in the docstring the way `harvestDispatchKey` does.
2. **Choose the transport deliberately, and say which one on the surface.** App-managed
   (`spawnSession` / `spawnHeadlessSession`) if anything will ever ask "did it finish?";
   `spawnExternalConsole` only when the operator will carry it on by hand and nothing downstream
   reconciles it; the dev runner when you want a queued, model-routed task row. Offer the choice
   through `DispatchChooserModal` rather than deciding for the operator when you genuinely don't know.
3. **Check the key, and treat the answer as advisory.** `listSessions()` → refuse if a non-exited
   session holds it. This closes the slow case (a session started a minute ago) and not the fast
   one (§7 D2); do not describe it as a lock.
4. **Spawn, bind, name — three statements, no branch between them.**
   `const id = await spawnSession(cwd, [prompt]); await renameSession(id, key);`
   A `return` or an early `catch` between them leaves a running anonymous agent.
5. **Persist the key next to the domain object** so the address survives an unmount and a restart.
   `setWorkspaceAdoption(..., key)` is the only existing example; if your feature has no such row,
   that is a schema gap, not a reason to skip it.
6. **Register the dispatch where the user is standing** — `processStarted(domain, key, label,
   { section, tab })` — and end it from wherever the completion signal arrives. Without
   `navigateTo` the dock row is a notification; with it, it is a door.
7. **Return the promise from `onClick`.** `<AsyncButton onClick={() => dispatch()}>`. Never `void`.
   If you cannot use `AsyncButton`, set a ref above the first `await` and clear it in `finally` —
   `useFleetOverlayActions.ts:63` (`wakingRef`) is the shape.
8. **Disclose the escalation.** If the spawn passes `--dangerously-skip-permissions`, one line under
   the transport card saying so, at the weight of the target path.
9. **Ask the type question now, before §9** — see below.
10. **And then stop.** The confirmation copy is
    [informed-consent-gate](./informed-consent-gate.md); the Stop button is
    [cancelling-in-flight-work](./cancelling-in-flight-work.md); the busy affordance is
    [inline-busy-state](./inline-busy-state.md); what bounds the model call once it runs is
    [headless-model-call](./headless-model-call.md).

### Can the type make the wrong call impossible? — asked before §9

**Yes on the client, almost entirely; no on the server, and the boundary is the finding.**

The dangerous freedom is not *spawning* — it is *receiving a bare `string` with no obligation*.
`spawnSession(cwd, args?) => Promise<string>` hands every caller a raw session id and asks nothing.
Withhold that and offer only the dispatch that owns the address:

```ts
// src/features/shared/dispatch/dispatchFleetSession.ts  (proposed)
declare const brand: unique symbol;
/** Constructible ONLY from entity ids — never from a free string, a uuid, or Date.now(). */
export type DispatchKey = string & { readonly [brand]: 'DispatchKey' };
export const dispatchKey = (...parts: [string, string, ...string[]]): DispatchKey =>
  parts.join(':') as DispatchKey;

export interface FleetHandle { readonly sessionId: string; readonly key: DispatchKey }

export function dispatchFleetSession(req: {
  cwd: string; prompt: string; key: DispatchKey;
  mode?: 'interactive' | 'headless';
  onExisting?: 'reject' | 'focus';
}): Promise<FleetHandle>;
```

…and move `spawnSession` / `spawnHeadlessSession` behind it (they stay for the Fleet plugin's own
grid, which legitimately addresses everything).

Held against the doctrine's seven qualifications:

- **Q1 — a required prop carries only what it encodes.** ✔ and this is the honest limit.
  `DispatchKey` encodes "a key was supplied and it was assembled from parts", **not** "the key is
  stable across a restart". `dispatchKey(projectId, String(Date.now()))` type-checks and dedupes
  nothing. That is exactly [idempotent-invocation](./idempotent-invocation.md) §8 Gap 2's boundary —
  no type separates a property of the request from a property of the attempt — and it is why P2
  stays prose.
- **Q2 — requiredness ≠ closedness.** ✔ Making `args` required, or `renameSession` mandatory by
  convention, changes nothing: 5 of 15 callers already call it and the other 10 had the same
  opportunity. The win is closing the *return* into a `FleetHandle` that only the helper can mint.
- **Q3 — a type nobody constructs constrains nothing.** ✔ `dispatchFleetSession` has **15
  construction sites on the day it lands** — every current `spawnSession`/`spawnHeadlessSession`
  call. Contrast `--max-budget-usd`, refused by this qualification at one construction site in 963
  files ([headless-model-call](./headless-model-call.md)).
- **Q4 — a type anyone can construct authenticates nothing.** ✔ with a caveat: the brand is only
  worth having if `dispatchKey` is the sole constructor and the cast lives in one file. A
  `as DispatchKey` at a call site is a comment. Lint the cast or drop the brand and keep the helper.
- **Q5 — withholding beats requiring.** ✔ This is the applicable qualification. The repo has already
  run the "require it by convention" experiment for three years and scored 5/15. Withhold the raw
  id: a caller who never sees a bare `string` cannot drop one.
- **Q6 — withhold the dangerous freedom, not the answer.** ✔ `FleetHandle` still contains the
  `sessionId`; the Fleet grid still gets its raw doors. What is withheld is *an anonymous session*.
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value voluntarily.** ✔
  Nothing forces `ShipMilestoneRun.tsx:99` to discard its id — the API simply gave it nothing better
  to do with it. Widening any existing signature is inert; the **construction** (`spawnSession`) is
  what must be withheld, exactly as [entity-draft-editing](./entity-draft-editing.md) concluded for
  `buildMetadataWithTags`.

**Where the type does not reach**, three places, all measured:

1. **The Rust dispatchers.** `ExecuteResult { message, client_action }`
   (`approvals/mod.rs:118-122`) is the return type of fifteen agent-starting actions. No TypeScript
   type reaches it; the fix there is the same *move* as
   [idempotent-invocation](./idempotent-invocation.md)'s `Spawn { Created | Deduped }` — widen the
   return so the information the executor already has stops being discarded — with different
   content: `ExecuteResult { message, client_action, started: Vec<StartedWork> }`.
2. **The external console.** There is no id to brand; `spawn_console` never passes `--session-id`
   and creates no row (`external.rs:155-173`). The correct answer is the label, not a type.
3. **Inside the key's derivation.** See Q1.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`await spawnSession(...)` as a bare statement** | A Claude agent is now running in the operator's repo with `--dangerously-skip-permissions` and the surface that started it holds nothing. The follow-up is always the same: `void fleetRefresh()` — *go look at the grid*. **6 sites (§9).** |
| **`onClick={() => void dispatch()}` on an `AsyncButton`** | `void` discards the promise, `AsyncButton` keys its re-entry ref on a returned thenable (`:55`) and releases it one line later (`:64`), so the only remaining guard is React state committed a frame late. **Executed: two presses inside one frame → 2 Fleet sessions.** §7 D1. |
| **`listSessions()` → `find(name === key)` → `spawnSession(...)`** | Check-then-act. **Executed: three concurrent dispatches with an identical key → 3 sessions, all renamed to the same name, 0 rejections.** §7 D2. |
| **Spawning and then naming in a different function, or not at all** | The window between the two is a window in which every recovery mechanism you own is blind. 12 of 17 Fleet spawns never reach `renameSession`. |
| **A key that contains the attempt** — a uuid, `Date.now()`, the session id | It cannot be recomputed, so the only way to use it is to remember it, and unmounting is what destroys memory. Same family as [idempotent-invocation](./idempotent-invocation.md) §2(a). |
| **Returning prose from a dispatcher** | `Ok(result?.message)` (`approval_exec_fleet.rs:1901`). The caller receives "Dispatched 4 sessions" and cannot address any of them. |
| **A cap whose default is off, treated as a bound** | `MAX_LIVE_SESSIONS = 0` (`stale.rs:151`); `free_slot_for_spawn` evicts one idle session when it can and *"the spawn proceeds anyway"* when it cannot (`stale.rs:1390-1392`). It is an eviction hint. No Fleet spawn is ever refused. |
| **A dispatch that manifests only where the work lives** | The operator is on the Ship tab; the tile appears in the Fleet grid. **0 of 17 `processStarted` registrations is a Fleet spawn.** |
| **Passing a permission-escalation flag through a surface that does not mention it** | `DispatchChooser.tsx:115` forwards `consoleSkipPermissions`; `skillsWorkbenchData.ts:255` hardcodes `skipPermissions: true`. Both correct decisions; neither visible. Named by [informed-consent-gate](./informed-consent-gate.md) §7.G and re-measured here. |
| **A detached spawn by accident** | Dropping a handle produces the same runtime state as `spawnExternalConsole` without any of its written reasoning. The sibling case is `vibeman`'s `execute_claude`, whose "Track in process manager" comment sits above a `log::info!`. |
| **Hardcoded English at a dispatch door** | `CommandPalette.tsx:105-106` toasts `'Execution started'` / `'Failed to start execution'`; `skillsWorkbenchData.ts:227,:229` toast `` `Running /${name} in ${…}` `` / `"Couldn't start the Fleet session"`. Owned by [i18n-string-authoring](./i18n-string-authoring.md)'s `frozen-ui-copy-constant`; listed because a dispatch door is where a 14-locale app is least forgiving. |

---

## 6. Evidence

### The one lane to copy: workspace harvest / practice rollout

Five files, one idea, and it is the only complete implementation of this leaf in the repo.

```ts
// practiceHarvestPrompt.ts:34-46 — the address, derived from entities, with the rule stated
/** Fleet dedup key for a per-scope harvest session. The scope is part of the
 *  key: several territories of the same repo are meant to run concurrently, and
 *  a repo-level key would make them collide as duplicates of each other. */
export function harvestDispatchKey(workspaceId, projectId, scopeId?) {
  const base = `workspace-harvest:${workspaceId}:${projectId}`;
  return scopeId ? `${base}:${scopeId}` : base;
}

// PracticeRolloutModal.tsx:70-83 — check, spawn, name, PERSIST, tell the user
const key  = adoptDispatchKey(practice.id, project.id);
const snap = await listSessions();
if (snap.sessions.find((s) => s.name === key && s.state !== 'exited')) { …warn; return; }
const sessionId = await spawnSession(project.root_path, [buildAdoptPrompt(...)]);
await renameSession(sessionId, key);
await setWorkspaceAdoption(practice.id, project.id, 'dispatched', undefined, key);

// useHarvestAutoIngest.ts:96-104 — the readback, holding NO memory of the dispatch
const key = harvestDispatchKey(workspaceId, project.id);
const active = snap.sessions.some(
  (s) => (s.name === key || (s.name ?? '').startsWith(`${key}:`)) && ACTIVE.has(String(s.state)));
if (wasLive.current.get(key) && !active) autoIngest(project);
```

Five properties make it the reference, and only one of them is the spawn:

1. **The address is a function, not a variable.** Nothing has to be remembered; the watcher
   recomputes the key from `workspaceId` and `project.id` it already has.
2. **The prefix match is deliberate.** `startsWith(`${key}:`)` covers the scoped fan-out from the
   unscoped parent key — the key's shape was designed for the readback, not just the write.
3. **The key is persisted into the domain row** (`setWorkspaceAdoption(..., key)`), so the address
   outlives the modal, the tab and the process.
4. **The dedup check and the naming use the same key**, so "already running" and "reopen this one"
   are the same question.
5. **`ExtractionMenu.tsx:269-279` arms the watcher immediately after the wave**, with the reason:
   *"so a session that finishes between polls still produces an active→settled transition."*

`passportFleet.tsx:61-69` is the same shape compressed into one exported function and is the best
single-function version; `DispatchChooser.tsx:91-121` is the same shape generalised over four
transports.

### The backend to copy: `commands/fleet/persist.rs`

The convergent mechanism (see the head — independently reinvented in two siblings). Four decisions
worth carrying: writes **piggyback the existing emit points** so no lane gets a private write path
(`:15-19`); the SQLite write runs on one dedicated thread so *"a DB stall can never wedge the
PTY"*; restored rows come back as **dozing tombstones** reusing the existing wake path rather than
inventing a state (`:139-146`); and `recover_after_restart` **refuses to auto-kill-and-resume**
because *"matching a process to a session by cwd is ambiguous when several share a directory — too
risky to fire unattended"* (`:259-262`). Read it before designing any recovery pass.

### What the live system holds

Read-only copies + a read-only harness probe, 2026-08-16:

- **`fleet_sessions`: 0 rows**, and `fleet_list_sessions` on the running app returns **0 sessions**.
  The two agree, so this is an idle fleet, **not** a broken writer — and I could not falsify the
  writer from data, which I record rather than dress up. What *is* structural: `list_runs`
  (`fleet_sessions.rs:149-169`) is a `GROUP BY run_id` over this table, `note_removed` deletes a row
  when the operator dismisses a tile, and `prune_exited_before` drops terminal rows older than
  `EXITED_RETENTION_MS = 24 h` (`persist.rs:47`) — **so `FleetHarvestPanel`'s "what did the fleet
  deliver?" index can only ever see the last day, minus anything tidied away.**
- **`dev_tasks`: 9 rows, 2 of them `status='running'` with `completed_at IS NULL` since
  **2026-04-09**, i.e. 129 days** (`8fea62ab…` and `3cd603c1…`, both *"Create 5 new invoice
  templates"* competitors). §7 D6.
- **`persona_executions`: 2,188 rows.** The persona lane's dispatch record is durable, queued and
  reconciled at boot (`engine/mod.rs:703`, `:748`); the Fleet lane's is a 24-hour mirror; the
  external console's does not exist.
- **`personas`: 78 rows, `max_budget_usd IS NULL` on all 78** — re-confirmed, so the client-side
  refusal at `executionSlice.ts:363-367` has never fired on this install and no dispatch surface
  could have quoted a ceiling.

### Executed — the double dispatch

`AsyncButton.handleClick` and `DispatchChooserModal.dispatch` transcribed statement for statement;
React's commit lag set to one 60 Hz frame, which is the lag `AsyncButton.tsx:28-34` says its ref
exists to cover:

```
AS SHIPPED  onClick={() => void dispatch()}   gap  0 ms  click2 -> RELEASED (not a thenable)   FLEET SESSIONS SPAWNED = 2
AS SHIPPED  onClick={() => void dispatch()}   gap  2 ms  click2 -> RELEASED (not a thenable)   FLEET SESSIONS SPAWNED = 1  [rejected: already_running]
AS SHIPPED  onClick={() => void dispatch()}   gap 16 ms  click2 -> disabled-prop               FLEET SESSIONS SPAWNED = 1
FIXED       onClick={() => dispatch()}        gap  0 ms  click2 -> disabled-prop               FLEET SESSIONS SPAWNED = 1
FIXED       onClick={() => dispatch()}        gap 16 ms  click2 -> disabled-prop               FLEET SESSIONS SPAWNED = 1

three CONCURRENT dispatch() calls, identical fleetKey -> sessions spawned = 3, all renamed to the same key, rejections = 0
```

Two things the replay settles that reading did not. **One:** the `void` costs the guard only inside
the commit window, and inside that window it costs a whole extra Claude session — the fix is one
token and it holds at every gap. **Two:** the name check is not a lock. At a 2 ms gap it does
reject, because the first dispatch has already spawned; run genuinely concurrently, all three pass
and all three get renamed to the same key, which then makes `useHarvestAutoIngest`'s prefix match
see one logical dispatch where three are running.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every item below is the same omission: **the
> app treats "the agent is running" as the end of the dispatch, when it is the middle.** Asked at
> the client it produces D1/D2/D3 — a guard released a line early, a check that is not a lock, a
> record nobody writes. Asked at the transport it produces D4/D5 — a cap that is off and an
> escalation that is invisible. Asked at the backend it produces D7 — fifteen dispatchers returning
> a sentence. The app answers it correctly exactly once, in the workspace-harvest lane, and that
> lane is five files nobody else imports.

### D1 — P0: the app's canonical dispatch button releases its double-submit guard one line early

`src/features/shared/dispatch/DispatchChooser.tsx:178` — `onClick={() => void dispatch()}` on an
`<AsyncButton isLoading={busy}>`. `AsyncButton` arms `inFlightRef` only when the handler returns a
thenable (`AsyncButton.tsx:55`) and releases it at `:64` otherwise; `MouseEventHandler` returns
`void`, so this is not a type error and produces no warning. **Executed above: two presses inside
one commit frame spawn two Fleet sessions.** The same shape at
`ShipMilestoneRun.tsx:124` (`void run()` → `spawnSession`) and at the five other sites
[idempotent-invocation](./idempotent-invocation.md) D5 lists.

**Fix:** delete the token — `onClick={() => dispatch()}`. Then land that path's proposed widening of
`AsyncButtonProps['onClick']` to `(e) => void | Promise<unknown>` so the next one is a compile
error. **One token, and it is the cheapest permanent win in this document.**

### D2 — P1: the Fleet name dedup is a `SELECT` and the spawn is a `WRITE`, with nothing between them

`DispatchChooser.tsx:103-106`, `PracticeRolloutModal.tsx:71-77`, `passportFleet.tsx:63-66` — three
sites, one shape: `listSessions()` → `find(s.name === key && s.state !== 'exited')` → throw, else
`spawnSession` → `renameSession`. **Executed: three concurrent calls, three sessions, zero
rejections.** The registry is authoritative only *after* `renameSession` lands, which is two IPC
round trips after the decision was made.

There is no server-side arbiter available: `fleet_spawn_session` takes no key and the registry has
no uniqueness constraint on `name`, so this cannot be fixed the way
[idempotent-invocation](./idempotent-invocation.md) fixes the persona lane.

**Fix, in order of cost:** (a) document the check as advisory in all three docstrings — it closes
the slow case and nothing else; (b) move the name into the spawn — `fleet_spawn_session(cwd, args,
name)` writing `inner.name` at row construction (`pty.rs:457`), which makes naming atomic with
insertion and removes the second round trip; (c) then, and only then, have the registry refuse an
insert whose name is held by a non-exited row, which turns the advisory check into a real one.

### D3 — P1: six surfaces start a Claude agent and keep nothing

The §9 population, hand-read 6/6. Each starts a real `claude` process with
`--dangerously-skip-permissions` in the operator's repo, discards the returned session id, and
never names the session.

| Site | What it starts | What it does instead of keeping the address |
|---|---|---|
| `stores/slices/system/fleetSlice.ts:54` | `/scan-sweep --lenses <lens> <context>` — **automatic**, up to `MAX_AUTO_DEEP_SCANS_PER_INGEST = 2` per outbox ingest, **default ON** (`lib/scanSweep.ts:16,:20-25`) | a toast naming the lens |
| `teams/sub_factory/l2/ship/ShipMilestoneRun.tsx:99` | `/ship-milestone <id>` | nothing. The component's *other* button is "Ingest" — **the two halves of one workflow with no link between them**, so the surface cannot tell you whether the run it started has finished |
| `teams/sub_factory/passport/improve/skillsWorkbenchData.ts:222` | `/<skill> <args>` in the project root | `fleetRefresh()` + a hardcoded-English toast |
| `plugins/dev-tools/sub_skills/registry/RegistryTab.tsx:101` | `/<skill>` per column | `void …then(toast); setTick(n => n + 1)` |
| `plugins/dev-tools/sub_triage/findings/dispatch.ts:85` | a finding's prompt | creates a linked `dev_tasks` row first (`:80`) *"so the finding↔task link … works identically whichever executor ran it"* — **the finding is addressable and the session is not** |
| `teams/sub_mastermind/MastermindPage.tsx:764` | the operator's free-text instruction | a toast; the comment says the session *"docks as an island fleet badge, reachable later like any other"* — i.e. findable only by eye |

`fleetSlice.ts:54` deserves its own note: **it is the only dispatch door in the app with no visible
affordance, and also the only one with a declared numeric cap on how many sessions a single event
may spawn.** The door nobody presses is the door somebody bounded.

**Fix:** each is one key function plus two lines, and `PracticeRolloutModal` is the template.
`ShipMilestoneRun` is the highest value — its key is `ship:milestone:<milestoneId>`, and with it the
Ingest button can know whether its run is still live.

### D4 — P1: the Fleet lane has no admission control, and the persona lane's is four

`stale.rs:151` — `static MAX_LIVE_SESSIONS: AtomicU64 = AtomicU64::new(0)`, where **0 means the
feature is off**, and that is the shipped default (`stale.rs:145`). `free_slot_for_spawn`
(`stale.rs:1393-1406`) returns immediately when the cap is 0, and otherwise hibernates one idle
candidate and lets the spawn through regardless: *"If nothing is evictable (everything is genuinely
working), the spawn proceeds anyway — soft cap."* `fleet_resume_orphan` (`process_scan.rs:145-171`)
does not call it at all.

Compare, in the same repo: the persona lane admits through `ConcurrencyTracker` at
`GLOBAL_MAX_CONCURRENT = 4` with a durable queue and a closed `AdmitResult`; `dev_tools_start_batch`
uses a real `Semaphore` defaulting to 2 (`task_executor.rs:662-676`); knowledge-apply enforces
`APPLY_MAX_CONCURRENT_PER_REPO = 4` (`approval_exec_knowledge.rs:464,:690-693`); the build-session
orchestrator uses `Semaphore::new(max_parallel)` (`orchestrator.rs:59`). **Four bounded lanes and
one unbounded one, and the unbounded one is the one that spawns full CLI agents with permissions
suppressed.**

This is not a bug — the soft-cap reasoning at `stale.rs:145-147` is sound and deliberate. The
deviation is that **nothing in the product says which lane can refuse you**, so a fan-out that the
persona lane would queue, the Fleet lane simply runs.

**Fix:** ship a non-zero default for `MAX_LIVE_SESSIONS`, and — separately — make the dispatch
surface state which transport queues and which does not, since that is the difference between "this
will start in a minute" and "this will start eight `claude` processes now".

### D5 — P1: the escalation reaches the UI at two sites and is rendered at zero

`DispatchChooser.tsx:115` forwards `request.consoleSkipPermissions` into `spawnExternalConsole`; the
modal renders the title, four transport cards, the editable prompt and a Dispatch button, and
nothing about the permission mode. `skillsWorkbenchData.ts:255` hardcodes `skipPermissions: true`
with the reasoning in a comment (*"a skill run walks the whole repo, and a prompt-per-file console
is unusable"* — sound, and invisible). Worse for the *unparameterised* transports: Fleet and
headless pass the flag as a constant, so the modal's Fleet card is escalated too and says even less.

[informed-consent-gate](./informed-consent-gate.md) §7.G owns the consent framing; this entry is
the dispatch-surface half, and it adds a number that path did not have: **the count of literal
occurrences understates the reach by an order of magnitude.** `--dangerously-skip-permissions`
appears 25 times in `src-tauri/**/*.rs`; 1 is a `#[cfg(test)]` assertion, 12 are comments, **12 are
live argv sites**, 11 of them hardcoded — and one of those 11, `engine/src/prompt/cli_args.rs:107`,
is inside the shared `build_cli_args`, which is referenced at **75** sites (49 passing `None`). The
honest sentence is *"every CLI agent this app starts runs with the runtime's permission prompts
suppressed"*, not *"twelve sites pass a flag"*.

**Fix:** one line under the transport card, at the weight of the target path.

### D6 — P2: two dev-runner dispatches have been `running` for 129 days, and nothing can settle them

`dev_tasks` rows `8fea62ab…` and `3cd603c1…`, `started_at` 2026-04-09, `completed_at NULL`.

`dev_tools_execute_task` (`task_executor.rs:515`) writes `status='running'` (`:552-565`), registers
a `CancellationToken` in the **in-memory** `TASK_EXEC_JOBS` (`:567-569`), and detaches a
`tokio::spawn` (`:585`). All three settle paths — `finalize_task` (`:406`), the 600 s
`tokio::time::timeout` (`:975`), the `catch_unwind` net (`:620`) — live *inside that task, in this
process*. Kill the app mid-run and the task, its timer, its panic net and its cancel token die
together, leaving the row. Then: **there is no startup reaper for `dev_tasks`** — unlike
`persona_executions` (`engine/mod.rs:703`), `persona_background_job` (`persona_jobs.rs:257`),
`companion_background_job` (`companion/jobs/mod.rs:170`), `companion_approval`
(`approval_lifecycle.rs:390`), lab / teams / n8n (`lib.rs:842-864`) — and
`dev_tools_cancel_task_execution` cannot settle them either, because after a restart
`get_cancel_token` misses and it returns `Ok(false)` without touching the row (`:866`, `:884-885`).

[long-running-job-progress](./long-running-job-progress.md) already records `dev_tasks` as having no
recovery pass, in a table of eight such tables. **This entry contributes the live artefact — two
rows, 129 days — and defers ownership of the fix**, which has an exact five-file-over template in
`persona_jobs.rs:260-268`.

Adjacent and deliberately not claimed here: `dev_tasks.session_id` carries an unrelated
`"worktree:<name>"` convention (`task_executor.rs:893-900`) and is written `None` by this lane
(`:559`), so **the Claude session id of the CLI this door spawns is never captured anywhere.**

### D7 — P2: fifteen agent-starting actions return an English sentence

`ExecuteResult { message, client_action }` (`approvals/mod.rs:118-122`) is the return type of
`execute_approval_action`'s whole table (`approval_lifecycle.rs:144-266`), including `fleet_spawn`
`:212`, `fleet_dispatch` `:213`, `canvas_dispatch` `:218`, `canvas_group_dispatch` `:219`,
`run_persona` `:145`, `run_arena` `:170`, `assign_team` `:248`, `night_shift_execute_plan` `:255`.
`companion_dispatch_fleet_plan` returns `Ok(result?.message)` (`approval_exec_fleet.rs:1901`); the
chat card it writes records `dispatchedRows` as `{cwd, objective, skill}` (`:1886-1893`). The
sessions land in the registry tagged `athena · …` (`:1126`), so the app's own answer to "which
sessions did that plan start?" is a name-prefix search.

**Fix:** `ExecuteResult { message, client_action, started: Vec<StartedWork> }` where `StartedWork`
is `{ kind, id, label }` — the same move as
[idempotent-invocation](./idempotent-invocation.md)'s `Spawn { Created | Deduped }`: stop discarding
what the executor already knows at the `return`. `dev_tools_dispatch_ideas`
(`dev_tools.rs:957-969`) already has the shape.

### D8 — P3: the run-labelling door has no callers, and the run report expires in a day

`beginRun(label)` / `endRun()` (`api/fleet/fleet.ts:309,:313`) are invoked **nowhere** in `src/`.
Every run is therefore the automatic `DISPATCH_WINDOW_MS = 2 min` group (`run.rs:29`) with a `None`
label, which `FleetHarvestPanel` renders as "ad hoc". And because `list_runs` is a `GROUP BY` over
`fleet_sessions` (`fleet_sessions.rs:149-169`), whose terminal rows are pruned at 24 h
(`persist.rs:47`) and whose dismissed rows are deleted (`persist.rs:113`), **the harvest report is a
24-hour window over sessions nobody tidied.** A dispatch made yesterday afternoon is not reportable
today.

**Fix:** call `beginRun(label)` from `DispatchChooserModal` when a caller supplies a batch title,
and `endRun()` after the batch; and give `fleet_sessions` a longer terminal retention than the
rehydration window it currently shares, since the two have different jobs.

### D9 — P3: a woken session is unaddressable and undurable until something binds it

`fleet_spawn_session` pre-binds `claude_session_id` before the row is inserted (`pty.rs:275-283`
mints it, `:325-327` passes `--session-id`, `:457` writes it, `:487` inserts, `:531` returns) — so
the `api/fleet/fleet.ts:23-27` claim holds and the unbound window is **0 ms**. It does **not** hold
for `fleet_wake_session` (`commands.rs:208-220`) or `fleet_resume_orphan`
(`process_scan.rs:158-170`), which pass `--resume` and therefore insert with
`claude_session_id: None` (`pty.rs:278-279`). Binding then happens out of band via the hook router
(`hooks.rs:231-235`) or the transcript watcher (`transcript.rs:165-203`), neither of which has a
deadline. Meanwhile `persist.rs:119-120` persists **only bound rows**, and
`fleet_hibernate_session` refuses an unbound one (`commands.rs:169-170`). So a woken session is
non-durable and non-hibernatable for an unbounded interval, and if hooks are not installed and no
transcript matches, forever.

### D10 — What this path CLEARED

Four things that looked like defects and are not:

1. **`fleet_sessions` being empty is not a broken writer.** The durable table and the live registry
   both report 0, which is what an idle fleet looks like. I could not falsify the writer from data
   and say so rather than implying a defect.
2. **The external console discarding its handle is correct**, and its module header is the best
   statement of the trade-off found in six repos. Do not "fix" `skillsWorkbenchData.ts:255`.
3. **The Fleet grid's own spawns not naming their sessions is correct.** `FleetGridPage:328/329`
   and `useFleetOverlayActions:84` address everything by construction and call `setActiveSession(id)`;
   a key would buy nothing.
4. **`executionSlice.executePersona` is a genuinely good client dispatch** — a refusal before any
   async work, the state lock taken *before* the first `await` with the race spelled out
   (`:376-380`), and a request-signature idempotency key. It is the shape the Fleet lane lacks, in
   the same repo, one directory over.

---

## 8. Gaps in the primitives

1. **`spawnSession` cannot take a name.** The whole leaf reduces to this. Naming is a second IPC
   call, so the atomic operation the doctrine wants (§2, D2) is not expressible, and 10 of 15
   callers simply skip it. `fleet_spawn_session(cwd, args, name)` would collapse D2 and D3 together.
2. **`persist.rs` can only persist bound rows**, by design (`:119-120`: *"without one there is no
   conversation to come back to"*). Correct for resumability, and it means the durable registry has
   a structural blind spot exactly where D9 lives.
3. **There is no way to ask the Fleet registry a question other than "give me everything".**
   `fleet_list_sessions` returns the whole snapshot; every consumer filters client-side, which is
   why the readback in §6 is an O(n) scan inside a `setInterval`. A `fleet_find_by_name(prefix)`
   would make the key-based address a first-class query instead of a convention.
4. **`ActiveProcess` has no transport field and no cwd.** It can say *what* is running and where to
   navigate, but not *which agent process* — so even a Fleet spawn that registered could not link
   its dock row to its tile. `navigateTo` would need a `sessionId`.
5. **`ExecuteResult` cannot carry an id** (D7), so nothing Athena dispatches is addressable by
   anything except a name prefix.
6. **No type separates a key derived from the request from one minted for the attempt.** Shared
   verbatim with [idempotent-invocation](./idempotent-invocation.md) §8 Gap 2; it is why §2's key
   rule is prose and why §9's rule cannot check key quality.
7. **The census can ratchet a presence and not an absence.** "No surface can find this session",
   "`beginRun` has no callers", "no dispatch shows a cost", "`dev_tasks` has no reaper" are four of
   this document's findings and **not one is expressible as a count.** They were found by
   enumerating doors against a live database and a running app — a program, not a matcher. §9 says
   what to build instead.

---

## 9. The missing gate

**The condition, stated stack-free:** *a UI surface starts a long-lived, externally-running unit of
work and retains no address for it — neither the identifier the platform handed back nor a name it
could recompute — so nothing that surface owns can ever find, watch or stop what it created.*

**An adopting repo must re-derive its own proxy.** In this repo the condition wears a very specific
costume: a call to one of the two app-managed Fleet spawn doors in *expression-statement position*.
Elsewhere it is `const { data } = useStartJobMutation()` with the returned id unread, a
`fetch('/api/run', {method:'POST'})` whose response body is discarded, or a `Command::new(...).spawn()`
whose `Child` is dropped. **This pattern scores a structural zero on all of them**, and the oracle
proves the point from the other side: `brainiac`'s equivalent condition is *unreachable* by any such
matcher because its endpoint deliberately returns no id at all (`sweeps.rs:222-226`). The portable
half is the head, §2 and §5 — not this regex.

**Where it runs.** `npm run census` / `npm run census:check` — inside `npm run check`
(`package.json:52`) and, more importantly, in the **`golden-path-census` pre-push job**
(`lefthook.yml:74-75`), which exists because the census had been *"enforced NOWHERE"* before
2026-08-16 (`lefthook.yml:58-64`). Deliberately **not** `ci.yml`: that workflow is currently red on
10 pre-existing Rust failures, and per this batch's calibration a gate that only runs in CI runs
nowhere. This one runs on every push from the machine that made the change.

### Existing rules checked first, by reading each definition rather than its title

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `unkeyed-billable-spawn` (11/13, `idempotent-invocation`) | a Rust `execute_persona_inner` / `create_with_idempotency` call passing `None` in the idempotency slot | **Nearest neighbour, and disjoint by root and by lane.** Roots `src-tauri`, `.rs`; mine is `src`, `.ts/.tsx`. Its subject is the *persona* lane, which has a key; mine is the *Fleet* lane, which has none and never will. Zero possible match overlap. |
| `hand-rolled-spinner` (182/248, `inline-busy-state`) | spinner markup in `src/features` | Whether the control *looks* busy. `ShipMilestoneRun.tsx` renders a perfectly correct `AsyncButton` spinner **and** is one of my six — the two conditions are orthogonal, which is the point. |
| `hand-rolled-disabled-state` (361/815) | `disabled` styling | Same layer, opposite question. |
| `unconsented-irreversible-door` (12/12, `informed-consent-gate`) | a `src/features` `.tsx` importing `deleteX`/`revokeX`… from `@/api` with no confirmation anywhere in the file | Verb vocabulary is `delete|remove|revoke|purge|wipe|clearAll` — no spawn verb. File-scoped negative lookahead; mine is a call-expression position. **Measured, not assumed:** this rule was run alongside `unconsented-irreversible-door`, `hand-rolled-spinner`, `widthless-collection-fanout` and `unwired-url-open-door` in the same private registry, and its 6 files intersect all four reported file sets at **zero**. |
| `unbound-child-lifetime` (12/13, `cancelling-in-flight-work`) | a Rust `.spawn()` with no `kill_on_drop` | The *callee's* lifetime in Rust; mine is the *caller's* memory in TypeScript. |
| `unverified-effect-dispatch` (60/162, `post-write-side-effects`) | `let _ = …emit(…)` | Whether a notification arrived. Rust-only, contains `emit`. |
| `unwired-url-open-door` (40/46, `external-url-opening`) | an `openExternalUrl` door with no wiring | Nearest in *spirit* (a door whose result goes nowhere) and disjoint in anchor. |
| `widthless-collection-fanout` (35/43, `bounded-parallel-fan-out`) | an unbounded `Promise.all` over a collection | Would fire on a *fan-out* of spawns; mine fires on a *single* spawn. `ExtractionMenu:269` is a sequential `for` loop and matches neither. |
| `module-scope-install-latch`, `unswept-job-registry-read` | in-memory registries | Neither sees a TS call expression. |

**None of the 116 existing rules keys on a surface that starts long-lived work and keeps no address
for it. Proposing one.**

### Measurement

**Precision 6/6 violating and 9/9 compliant — every match opened and read.** The population is the
**15** production call expressions reaching the two app-managed Fleet spawn doors
(`spawnSession`, `spawnHeadlessSession`). The anchor sees all 15 and partitions them **6 violating /
9 compliant**, with no residual: **6 + 9 = 15 exactly.**

Two independent implementations, and **the first was wrong**:

| implementation | sites found | discarded | retained |
| --- | ---: | ---: | ---: |
| regex over whole-file content, all 7 doors | 41 | — | — |
| TypeScript 6 AST walker, climbing `await`/`void`/`.then` to the owning node | **44** | 18 | 26 |
| the census engine, from the published pattern | — | **6** (of the 2 Fleet doors) | **9** |

The regex pass missed **three** sites and they were all the same shape: a **method call through an
object** — `devApi.executeTask(id)` (`devToolsTaskSlice.ts:161`), `api.executePersona(…)`
(`useTriggerHistory.ts:128`), and `fleetApi\n  .spawnSession(…)` (`fleetSlice.ts:54`), the last
split across lines. A negative lookbehind for `.` written to exclude property access excluded
exactly the calls that matter, and one of the three is the app's only invisible dispatch door. The
published pattern therefore admits an optional `IDENT` + newline + `.` before the function name, and
both implementations now return the same membership.

**Contamination: zero.** No test file appears in either count. `.test.ts` mocks are property
assignments (`spawnSession: vi.fn()`) with no `(` after the identifier, and the pattern requires
`\(`. The three `spawnSession` references in `src/api/fleet/fleet.ts` are its own `export const`
(no preceding `=`), an `{@link}` in a doc comment, and an import list member (no `(`) — none matches
either side.

**Backtracking:** the only optional multi-token fill is `(?:[A-Za-z_$][\w$]*[ \t]*(?:\r?\n[ \t]*)?\.[ \t]*)?`
— a bounded optional group with no nested quantifier over the same span. Full 4,829-file run:
**under 2 s**, both rules.

**Fault-injected six ways, all six fire** (`census FAILED`, exit 1): floor raised to 99999 → *"THE
MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; pattern replaced with a non-matching literal → silent-drop
drift; baseline lowered to 2 → rise; baseline raised to 40 → silent drop; a `baseline` added to the
control → *"a positive control must NOT carry a baseline — it exists to fail, and a baselined
control would ratchet against improving adoption"*, rejected before any file is walked; a stale
`exclude` path → *"the exemption is stale"*.

**Validated standalone** in a composer-private registry
(`registry-agent-dispatch-composer.json` — a filename unique to this composer, because sibling
composers share the scratchpad directory and have overwritten each other's files), then
**re-extracted from this finished document and re-run: `files 6 / matches 6` and `files 7 / matches
9`, identical both times.** The full registry was not run.

**One reporting artefact worth knowing:** the engine reports the line of the statement-boundary
character, so every match line is **one less** than the line of the call. `RegistryTab.tsx:100` is
the spawn at `:101`.

### The rule

```json
{
  "rules": [
    {
      "id": "unaddressable-agent-spawn",
      "goldenPath": "docs/concepts/golden-paths/agent-dispatch.md",
      "title": "A surface starts an app-managed agent session and discards the session id it was handed, so nothing it owns can ever find, watch or stop the work it created",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "(?:^|[\\n;{}])[ \\t]*(?:await[ \\t]+|void[ \\t]+)?(?:[A-Za-z_$][\\w$]*[ \\t]*(?:\\r?\\n[ \\t]*)?\\.[ \\t]*)?(?:spawnSession|spawnHeadlessSession)[ \\t]*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A call to one of the two APP-MANAGED Fleet spawn doors in EXPRESSION-STATEMENT POSITION — the returned session id is discarded at the moment it is handed over. The position is identified unambiguously: the call is preceded by a statement boundary (start of file, newline, `;`, `{` or `}`) and optionally by `await`/`void` and an object receiver, and is NOT preceded by `=`, `return`, `?` or `:`, which is what the positive control keys on. PROXY FOR the stack-free condition: a UI surface starts a long-lived, externally-running unit of work and retains no address for it — neither the identifier the platform handed back nor a name it could recompute — so nothing that surface owns can find, watch or stop what it created. MEASURED 2026-08-16 at 7b42f9333: 6 matches across 6 of 4829 .ts/.tsx files, ALL SIX OPENED AND READ (precision 6/6). Population and partition: the 15 production call expressions reaching spawnSession or spawnHeadlessSession split 6 violating / 9 compliant, and 6 + 9 = 15 exactly, so every such site is classified and there is no unexamined third population. THE SIX: stores/slices/system/fleetSlice.ts:54 (the app's ONLY dispatch door with no visible affordance — it auto-spawns up to MAX_AUTO_DEEP_SCANS_PER_INGEST = 2 `/scan-sweep` sessions per outbox ingest, default ON per lib/scanSweep.ts:20-25); teams/sub_factory/l2/ship/ShipMilestoneRun.tsx:99 (spawns /ship-milestone and renders an `Ingest` button beside it — two halves of one workflow with no link, so the surface cannot tell whether the run it started has finished); teams/sub_factory/passport/improve/skillsWorkbenchData.ts:222; plugins/dev-tools/sub_skills/registry/RegistryTab.tsx:101 (`void … .then(toast)`); plugins/dev-tools/sub_triage/findings/dispatch.ts:85 (creates a linked dev_tasks row first, so the FINDING is addressable and the SESSION is not); teams/sub_mastermind/MastermindPage.tsx:764. Every one of the six starts a real `claude` process with --dangerously-skip-permissions in the operator's repo (hardcoded at commands/fleet/pty.rs:324,:364 and headless.rs:132), and the follow-up at four of them is `void fleetRefresh()` — go look at the grid. TWO DELIBERATE SCOPE DECISIONS. (1) spawnExternalConsole is NOT in the pattern: its return is an OS pid the API doc calls 'informational only, since the app keeps no handle on it' (src/api/fleet/fleet.ts:153-156, src-tauri/src/commands/fleet/external.rs:117-118), so discarding it is CORRECT and including it would have made this rule 6/7 instead of 6/6 by firing on skillsWorkbenchData.ts:255. (2) wakeSession and resumeOrphan are excluded because both are Fleet-plugin-internal focus operations, not dispatch doors. THE NINE COMPLIANT SITES ARE THE DOCTRINE, NOT MERELY COMPLIANCE: five bind the id and immediately `renameSession(id, key)` with a key computed by a PURE FUNCTION OF ENTITY IDS — overview/sub_patterns/PracticeRolloutModal.tsx:76 (adoptDispatchKey, and it also PERSISTS the key via setWorkspaceAdoption so the address survives a restart), ExtractionMenu.tsx:269 (harvestDispatchKey, whose docstring states why the scope is part of the key), teams/sub_factory/passport/passportFleet.tsx:66, and shared/dispatch/DispatchChooser.tsx:106,:119 — while four are the Fleet grid and overlay addressing their own sessions with setActiveSession/setPreviewId (FleetGridPage.tsx:328,:329, useFleetOverlayActions.ts:84, MastermindPage.tsx:748). DO NOT SILENCE A MATCH by binding the id to an unused variable: `const _id = await spawnSession(...)` satisfies the pattern and keeps no address, which is the exact defect this golden path's section 2 exists to name. Do not silence it by moving the call onto its own line or by extracting it into a helper that itself discards — both preserve the defect. TWO INDEPENDENT IMPLEMENTATIONS, AND THE FIRST WAS WRONG: a whole-file regex over all seven dispatch doors found 41 call expressions and a TypeScript AST walker found 44; the three it missed were all METHOD CALLS THROUGH AN OBJECT (devApi.executeTask, api.executePersona, and fleetApi<newline>.spawnSession), because a lookbehind written to exclude property access excluded exactly the calls that mattered — one of the three being the only dispatch door in the app with no UI affordance. This pattern therefore admits an optional receiver plus a line break before the dot. CONTAMINATION ZERO: no test file matches either side, because .test.ts mocks are property assignments (`spawnSession: vi.fn()`) with no `(` after the identifier, and the pattern requires `\\(`; the three references inside src/api/fleet/fleet.ts are its own `export const` (no preceding `=`), an {@link} in a stripped comment line, and an import-list member (no paren). BACKTRACKING: the only optional multi-token fill is a bounded optional receiver group with no nested quantifier over the same span; full 4829-file run under 2s. REPORTING ARTEFACT: the engine reports the line of the statement-boundary character, so each match line is ONE LESS than the line of the call (RegistryTab.tsx:100 is the spawn at :101). DOES NOT OVERLAP unkeyed-billable-spawn, its nearest neighbour: that rule is roots src-tauri / .rs and its subject is the PERSONA lane, which has an idempotency key; this one is roots src / .ts,.tsx and its subject is the FLEET lane, which takes no key and never will, so the whole guarantee has to live in the session NAME. Nor unconsented-irreversible-door, whose verb vocabulary (delete|remove|revoke|purge|wipe|clearAll) contains no spawn verb. FILE OVERLAP MEASURED, NOT ASSUMED: this rule was run in the same private registry alongside unconsented-irreversible-door, hand-rolled-spinner, widthless-collection-fanout and unwired-url-open-door, and its 6 files intersect all four of their reported file sets at ZERO. Nor hand-rolled-spinner or hand-rolled-disabled-state (whether the control LOOKS busy — the two conditions are orthogonal, and ShipMilestoneRun.tsx demonstrates it by satisfying both: it renders a perfectly correct AsyncButton spinner while keeping no address for the session it just started). Nor unbound-child-lifetime (the CALLEE's lifetime in Rust; this is the CALLER's memory in TypeScript). Nor widthless-collection-fanout (a fan-out of many; this is a single spawn — ExtractionMenu's sequential for-loop matches neither). LEGAL FIX, one key function plus two lines each, and PracticeRolloutModal.tsx:70-83 is the template: compute a key from the entity ids, spawn, `await renameSession(id, key)` on the very next line, and persist the key next to the domain row. PRECONDITION (must be re-derived per repo, do NOT port): this repo starts app-managed agents through two named TypeScript wrappers returning Promise<string>. A Next.js app spells the identical condition as a POST whose response body is discarded or a useStartJobMutation whose data is unread; a Rust TUI spells it as a Child that is dropped. This pattern scores a STRUCTURAL ZERO on all of them — and brainiac makes the point from the other side: its sweep endpoint deliberately returns no run id at all (crates/brainiac-server/src/sweeps.rs:222-226, reasoned in migrations/0018_sweep_schedules.sql:9-11), so no matcher of this shape could ever see its condition. END OF LIFE: this rule is designed to reach zero — all six are one-key-plus-two-lines fixes — and the golden path's 'Prefer a type over a gate' proposes a dispatchFleetSession() helper returning a FleetHandle, which withholds the bare session id and makes an anonymous dispatch unrepresentable at all 15 sites. When the count reaches 0 the runner fails structurally on zero matches, BY DESIGN: DELETE the rule then, do not baseline it at 0.",
        "$measured": "2026-08-16 @ 7b42f9333 — 4829 .ts/.tsx walked, floor 4000, run under 2s; two independent implementations (TypeScript 6 AST walker + the census engine) reconciled at identical membership after a diagnosed method-call-through-an-object gap; all 6 matches and all 9 control matches hand-read; the DispatchChooser double-press replayed in Node against transcribed AsyncButton + dispatch source; live counts from read-only copies of personas.db / personas_data.db and a read-only fleet_list_sessions probe of the running app (fleet_sessions 0 rows, live registry 0 sessions, dev_tasks 2 rows running since 2026-04-09, persona_executions 2188)."
      },
      "baseline": { "files": 6, "matches": 6 },
      "floor": 4000
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "unaddressable-agent-spawn-positive-control",
  "goldenPath": "docs/concepts/golden-paths/agent-dispatch.md",
  "title": "POSITIVE CONTROL — the same two spawn doors whose returned session id is bound",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:=|return|\\?|:)[ \\t]*(?:await[ \\t]+)?(?:[A-Za-z_$][\\w$]*[ \\t]*\\.[ \\t]*)?(?:spawnSession|spawnHeadlessSession)[ \\t]*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "$measured": "2026-08-16 @ 7b42f9333 — validated standalone in a composer-private scratch registry, then re-extracted from this document and re-run; 7 files / 9 matches both times.",
    "description": "CONTROL, not a gate. The IDENTICAL two function names as unaddressable-agent-spawn, in the opposite syntactic position: the call is preceded by `=`, `return`, `?` or `:`, i.e. its result is BOUND. The two are mutually exclusive BY CONSTRUCTION rather than empirically — a call expression is either in statement position or it is the right-hand side of something, never both. MEASURED 2026-08-16 at 7b42f9333: 9 matches across 7 files versus the gate's 6 across 6. PARTITION, NOT A RATIO: the two patterns together see all 15 production call expressions reaching these doors and 6 + 9 = 15 exactly, so every site is classified and there is no unexamined residue. WHAT THE NINE DEMONSTRATE IS THE DOCTRINE, NOT MERELY COMPLIANCE. Five bind the id and name the session on the very next line with a key computed by a PURE FUNCTION OF ENTITY IDS, so any later surface can RECOMPUTE the address rather than having to remember it: PracticeRolloutModal.tsx:76 (adoptDispatchKey(practiceId, projectId), then renameSession, then setWorkspaceAdoption(..., key) which persists the address into the domain row so it survives an app restart), ExtractionMenu.tsx:269 (harvestDispatchKey, whose docstring states why the scope belongs in the key: 'several territories of the same repo are meant to run concurrently, and a repo-level key would make them collide as duplicates of each other'), passportFleet.tsx:66, DispatchChooser.tsx:106 and :119. The other four are the Fleet grid and overlay addressing their OWN sessions (FleetGridPage.tsx:328,:329 and useFleetOverlayActions.ts:84 call setActiveSession(id); MastermindPage.tsx:748 calls setPreviewId(id)) — legitimately compliant without a key, because those surfaces already address every session by construction. A CONTROL THAT MERELY COUNTED `const x = await spawnSession(...)` WOULD ALSO PASS FOR A BINDING THAT IS NEVER USED, which keeps no address at all; that this repo's compliant set splits cleanly into five key-namers and four self-addressing Fleet surfaces, with no unused bindings, is the evidence behind the golden path's section 2. 60% of this repo's app-managed agent spawns keep an address; 40% do not. If this control's count ever collapses toward the gate's, the shared anchor (the two function names) has broken and BOTH numbers are meaningless — that is the failure this control exists to make visible, and it already caught one: the first implementation of the population used a lookbehind that silently dropped every method call through an object receiver. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; the census engine rejects a `-positive-control` id that carries one (verified by injection) and the registry merge skips it by construction."
  },
  "floor": 4000
}
```

### Gates I rejected, with numbers

| candidate | violating | compliant | why rejected |
| --- | ---: | ---: | --- |
| **a Fleet spawn in a file that never calls `renameSession`** — the "unnamed session" condition, closer to §2's actual prescription | 12 | 5 | Precision **6/12 at best**. Four of the twelve are the Fleet grid and overlay, which address every session by construction and need no key; two are the external console, which has no id to name. A file-scoped lookahead cannot see that `setActiveSession(id)` is an address too. **Refused; the position-based rule reaches the same six with 6/6.** |
| **a `<DispatchChooserModal>`-less feature that imports a spawn door** — non-adoption of the universal surface | 12 | 3 | The condition is real (§0) but gating it would be gating *architecture*, and the oracle says the same non-adoption happens in every repo that builds a dispatch abstraction (`vibeman` ≈1:6, `ascent` documents the duplication as intent). A gate on "use the component" is the contract's fifth failure mode waiting to happen — and `DispatchChooserModal`'s own button is disarmed (D1), so the destination is not correct by default. **Refused; §9 gates the consequence instead.** |
| **`beginRun` / `endRun` never called** — D8 | 0 | 0 | The census cannot express an absence, and a zero-match rule fails the runner structurally. Carried as D8 and as §8.7's instrument list. |
| **a spawn with no `processStarted` beside it** — D3's registration half | 15 | 0 | **Zero compliant examples anywhere**, so there is nothing to control against and no partition. It is also the wrong altitude: `processStarted` is [inline-busy-state](./inline-busy-state.md)'s primitive and a gate here would duplicate its territory. Carried as D3. |
| **`--dangerously-skip-permissions` as a hardcoded constant** (Rust) | 11 | 1 | 92% would fire, and correctly — the flag is deliberate on 11 of the 12 lanes. A gate firing on 11 of 12 members is a to-do list, and the interesting fact is not the count but that one shared argv builder is inherited at 75 sites. Owned by [informed-consent-gate](./informed-consent-gate.md) §0; carried here as D5. |
| **`fleet_sessions` rows past their retention with a live run** — D8's expiry half | — | — | A **runtime** invariant. Nothing static sees it. The right instrument is a health-panel row, not a matcher. |

### What the census fundamentally cannot gate here, and what to build instead

Three of this document's findings are absences, and the runner ratchets presence:

- **"`beginRun` / `endRun` have no callers"** — a *dead-export* check. The general instrument is a
  script over `src/api/**` listing exported wrappers with no call site outside their own module and
  no entry in an explicit backend-only allowlist with a reason. Same shape as
  `check-csp-hosts.mjs`, same reason it cannot be a census rule, and
  [informed-consent-gate](./informed-consent-gate.md) §9 asked for the same instrument from the
  other direction (`revoke_desktop_approvals` has no wrapper). **Two paths now want it; build it once.**
- **"`dev_tasks` has no recovery pass"** — a *reaper-coverage* check: every table with a `status`
  column admitting a non-terminal value should be named by exactly one boot recovery function or
  listed as deliberately unreapable. [long-running-job-progress](./long-running-job-progress.md)
  already enumerated eight such tables by hand; the enumeration is the check.
- **"no dispatch surface shows a cost"** — an *orphaned-component* check
  (`ExecutionPreviewPanel`, 0 render sites). Requested identically by
  [informed-consent-gate](./informed-consent-gate.md) §9. **Also two paths, also once.**

---

## 12. Corrections to the brief

The brief was right about the shape and wrong or incomplete on six specifics. Recorded per the
doctrine, since the corrections are the deliverable.

1. **"15 production sites can start a billable agent run."** — That number is
   [idempotent-invocation](./idempotent-invocation.md)'s, and it counts **Rust** call sites reaching
   a `persona_executions` insert. On the client, which is this leaf's side, the figure is **44 call
   expressions across 33 files** over seven doors. It coincidentally equals 15 for the two
   app-managed Fleet spawn doors, which is the population §9 gates — a coincidence worth flagging
   so the two are not conflated. Measuring the brief's 15 would have produced a duplicate of that
   path.

2. **"`--dangerously-skip-permissions` is passed at 13 spawn sites."** — **It does not reproduce; I
   count 12, by a stated method, and the number is the wrong instrument anyway.** Of 25 raw
   occurrences in `src-tauri/**/*.rs`: **1** is a `#[cfg(test)]` assertion
   (`engine/src/prompt/mod.rs:1793`), **12** are comments or doc comments, **12** are live argv
   sites (11 hardcoded + `external.rs:169`, the one parameterised). This also corrects
   [informed-consent-gate](./informed-consent-gate.md) §0, which published 13. **And the count
   understates the reach by an order of magnitude:** one of the 12, `engine/src/prompt/cli_args.rs:107`,
   is inside the shared `build_cli_args`, referenced at **75** sites (49 passing `None`), so every
   headless lane inherits it. The honest sentence is *"every CLI agent this app starts runs with the
   platform's permission prompts suppressed"*.

3. **"`ExecutionPreviewPanel` — the only surface naming a dollar estimate — has zero render call
   sites."** — **Confirmed independently**, and the second half is now stronger: `previewExecution`
   has exactly one consumer in 4,829 files and it is that unmounted panel, so the live
   `preview_execution` command has no consumer at all. The budget-branch analysis I could not
   improve on; see that path's §7.D.

4. **"Check the remaining dispatch doors for the same double-execution shape."** — Found, and it is
   a *third* shape, not a repeat of the two. Not a Rust `if` over an unconditional write, and not a
   dedupe guard false when the dedupe fires: **a client-side re-entry ref released one line early by
   a `void`** (D1, executed: 2 sessions), sitting on top of **a check-then-act name dedup** (D2,
   executed: 3 concurrent presses → 3 sessions, 0 rejections). The Fleet lane cannot be fixed the
   way the persona lane was, because `fleet_spawn_session` takes no idempotency key and the registry
   has no uniqueness constraint on `name`.

5. **"`AsyncButton` exists to disarm double-submit; measure adoption at dispatch sites
   specifically."** — Measured, and **adoption is not the story at these sites: `<AsyncButton>` is
   rendered at only 2 of the 33 dispatch files** (`DispatchChooser`, `ShipMilestoneRun`), and **both
   of them `void` it.** The other 31 files render no `AsyncButton` anywhere. So the sibling path's
   conclusion ("adoption is good, the failure is the `void`") holds
   repo-wide at 49 renders and **inverts inside this leaf**: at dispatch doors, adoption is 2/33 and
   the two adopters are both disarmed.

6. **"No kill switch reaches in-flight work."** — True and, for this leaf, **the more interesting
   fact is upstream of the kill switch**: `fleet_kill_session` reaches every app-managed session
   perfectly well. What it cannot reach is a session **nobody kept the address of** — which is 6 of
   15 spawns, plus everything Athena dispatches (D7), plus every external console by design. The
   Stop button is not the defect; the missing address is. The sibling oracle supplies the endgame:
   `vibeman`'s `abort_claude` looks sessions up in a registry its spawn path never writes to
   (`claude_cmds.rs:483` — the code under `// Track in process manager` is only a `log::info!`).

7. **The brief's framing — "what it shows first, what it costs, what the user can do while it
   runs" — is three questions with one answer, and the answer is the address.** Cost is invisible
   because `ActiveProcess.costUsd` accrues only on registered dispatches and **0 of 17 registrations
   is a Fleet spawn**. "What you see first" is a toast because `navigateTo` needs a run id nobody
   kept. "What you can do while it runs" is nothing because the surface cannot name the session.
   Three symptoms, one omission — which is why §2 prescribes the key first and everything else
   second.

8. **The leaf's `convergence: diverged` label survives, and it is diverged in an unusual
   direction.** The *guard* clause is unanimous physics (4/4, at three different layers, with one
   sibling carrying a paid-for-it comment). The *durable registry* clause is physics, independently
   reinvented twice with near-identical vocabulary, and Personas converges with it. But the three
   clauses this document actually prescribes — a recomputable entity-derived key, the prompt shown
   and editable at the door, and a labelled non-addressable transport — are **silence, 0 of 4 each**.
   Personas is alone on all three and is ahead on all three. They are marked house conventions in
   §2 and the head, strongly reasoned and externally untested, and an adopting repo should feel free
   to reach P1's goal by another route: `ascent` addresses by subject
   (`router.push('/report?repo=…')`) and `brainiac` argued its way to no run id at all.
