# Headless App Master - the app-closed chair

> **Status:** v0.1.0, built 2026-10-05 (WP0 `4b41e833d`, then three packages). Not yet run
> against the live app; see Known gaps.
> **Related:** [`.claude/skills/appmaster/SKILL.md`](../../.claude/skills/appmaster/SKILL.md)
> (the Director's procedure), [`roles/app-master.md`](../../.claude/skills/appmaster/roles/app-master.md)
> (what the master reads), [`app-master-e2e.md`](app-master-e2e.md) (the in-app role's
> history), [`.claude/skills/master/SKILL.md`](../../.claude/skills/master/SKILL.md) (the
> app-running chair). Design record: the vault note `Spark/ideas/headless-app-master.md`.

---

## Why

The App Master is a runtime role the app owns: its tick is a `ReactiveSubscription` inside
the running process, its decision prompt is `render_decision_prompt`
(`src-tauri/src/engine/subscription/attention_decide.rs`), its builders are fleet sessions,
and every write goes through the app's doors. While Personas itself is under active
development the app restarts often, and a restart kills its workers. `/appmaster` keeps three
projects (pof, ascent, kp) moving without the app: same role, same decision contract, but the
clock is a Claude Code session and the record is a file journal.

## What it is

```
        operator (CEO-level counsel)
              |  AskUserQuestion, say
              v
  +---------------------------+     context --project p      +-------------------+
  | Director (Claude session) | ---------------------------> | app DB (mode=ro)  |
  | the clock: ScheduleWakeup |                              +-------------------+
  +---------------------------+
     |  Agent x N, in parallel        ^ decision JSON
     v                                |
  master subagent (Opus, read-only) --+
     |
     |  decide -> run ids; dispatch
     v
  builder (Sonnet, `claude -p`, background) in ~/.personas/headless-masters/worktrees/<p>/<run8>
     |  exited (seen by the background `await`: a pid check every few seconds)
     v
  settle: verify claim -> merge gate --ff-only--> project checkout (pof/ascent: master, kp: main)
                                 \--held--> ask
  journal: .claude/master/<slug>/headless/   (wakes, runs, asks, channel, outbox)
  outbox --replay, only when the app is up--> app doors (idea, task, ask, channel)
```

The master never spawns anything: it returns one JSON object and the Director acts on it.
This keeps every process under one owner who can see its pid.

## The contract

All shared numbers, vocabularies, paths and record shapes are defined once in
`.claude/skills/appmaster/lib/contract.mjs`; this document names them and does not restate
values that could drift. The subcommand table is `appmaster.mjs` (`COMMANDS`).

- **Decision JSON**: `schema/decision.schema.json`. Keys `wakeId`, `dispatch` (at most
  `MAX_DISPATCH`), `defer`, `asks` (at most `MAX_ASKS`, kinds `ASK_KINDS`, 2 to 4 options),
  `ideaVerdicts` (`VERDICT_STATUSES`), `say` (string or null), `note`, `nextWakeMinutes`
  (`WAKE_MIN`..`WAKE_MAX`). Absent-value convention: every array present, `say` null, nothing
  omitted. Every charter appears exactly once across `dispatch` and `defer`
  (`lib/decision.mjs` `validateDecision`). Parity with the in-app contract is deliberate, so a
  later replay into the app loses nothing; the in-app prompt's `charterId` becomes
  `charterSlug` here because there is no persona-responsibility id without the app.
- **Run states** (`RUN_STATES`): `planned` (minted by `decide` before any effect) ->
  `running` (`dispatch`) -> `exited` (`await` or `watch` saw the process gone) -> `verifying` (`settle`)
  -> `merged` | `held` | `failed`; any non-merged state may go to `released`. Only
  `lib/worker.mjs` writes planned/running/exited; only `lib/merge.mjs` writes the rest.
  `LIVE_RUN_STATES` are the ones that hold a project's slot.
- **Outbox** (`OUTBOX_KINDS`, `OUTBOX_STATES`): id = `<kind>:<sha1(canonical payload)>`, so
  the same write queues once. Replay doors (the authority is the header of `lib/outbox.mjs`):
  `idea-verdict` -> `dev_tools_update_idea` (`commands/infrastructure/dev_tools.rs:491`);
  `task-complete` -> the worker write-back route `POST /dev-tools/ideas/{id}/outcome` per idea
  (it mints or reuses the task and records the commit), or `dev_tools_create_task`
  (`dev_tools.rs:991`) with the SHA in the description when no idea is named; `ask` resolve ->
  `update_manual_review_status`; `say` from the operator -> `post_persona_channel_message`
  (`commands/communication/persona_channel.rs:499`). **Two kinds have no door** and replay
  marks them `skipped` with the reason: an ask RAISE (`persona_manual_reviews` has no create
  command; the in-app raise needs a `persona_executions` row as its anchor), and the master's
  own `say` (the channel door authors every message as the operator). Those stay in the
  journal and the terminal. Replay reads the database before and after each post.
- **Caps and brakes**: `GLOBAL_CAP` builders across projects, `PER_PROJECT_CAP` per project,
  `MEM` (free GB: a dispatch needs a floor plus a reserve per running builder; a gate run needs more) refuses a dispatch, `QUIET_MIN` and `TIMEOUT_MIN` flag (never kill), the
  Director's sleep is clamped to `SLEEP_MIN_SEC`..`SLEEP_MAX_SEC`. Models: `MODELS` (Opus
  decides, Sonnet builds; `builderByCharter` and the brief's `models.byCharter` override).
- **Exit codes** (`EXIT`): 0 ok, 2 refused by a brake or gate (`{refused}` on stdout), 1 error.

## State layout

```
.claude/master/<slug>/                 gitignored (.claude/*), shared with /master
  brief.json                           /master's schema; this skill only reads it (onboard writes it)
  headless/
    wakes.jsonl                        one line per context, completed by decide (latest wins)
    asks.jsonl  channel.jsonl  outbox.jsonl
    context/<wakeId>.md                the rendered wake context the master read
    runs/<runId>/run.json              the Run record; plus the builder's stream and result.json
.claude/master/_headless-limit.json    global usage-limit mark {limitedAt, reason, resetsAt}
~/.personas/headless-masters/worktrees/<project>/<runId8>   branch autopilot/<charter>-<runId8>
```

Every path is a helper in `contract.mjs` (`headlessDir`, `runDir`, `limitPath`, `WORKTREE_ROOT`).
Tests redirect the roots with `APPMASTER_STATE_ROOT` and `APPMASTER_WORKTREE_ROOT`.

## The merge gate (rung 3)

The operator granted rung 3 (merge locally, no push) for this skill, against the recommended
branch-only rung, and a gate was chosen to carry the risk. `settle` treats the builder's
`result.json` as a claim and checks it (`lib/merge.mjs` `cmdSettle`); `mergeGate` merges only
if all eight hold:

1. the branch has at least one commit beyond the base it was cut from (none = `failed`);
2. the diff touches no path-glob in the brief's `boundaries` (a boundary written as prose is
   passed to the builder as a rule, not checked here);
3. the project's own gates (per gate: brief `gates{}`, else `.ai/manifest.yaml` capabilities,
   else the `package.json` script; typecheck / lint / test) exit 0 in a clean worktree whose
   HEAD is the branch tip, and at least one of them ran (a skipped gate is not a pass);
4. the project checkout is on its base branch;
5. it has no merge, rebase, cherry-pick or revert in progress;
6. no path in `git status --porcelain --no-renames` of the checkout is in the branch's diff;
7. if the base moved, the branch rebases cleanly onto the new tip and typecheck still passes;
8. `merge --ff-only` succeeds and the checkout's HEAD equals the branch tip afterwards.

Any failed condition leaves the run `held`, keeps the branch and worktree, and raises a
`merge-held` ask with the reason (options: merge it myself, discard the branch, re-dispatch
after a commit), also queued in the outbox. `settle --retry` takes a held run through the gate
again once the operator has cleaned the checkout. The gate never stashes, checks out, resets or `git add -A`s in a
project checkout: all three carry foreign uncommitted work, which is why condition 6 exists.

## What it deliberately does not do

- **No app database writes.** `mode=ro` only; app-owned writes wait in the outbox.
- **No push**, no pull request. Merges are local fast-forwards.
- **No scheduled or unattended tick.** It runs only while a Director session loops.
- **No HTML page**, no notifications, no vault session note: one terminal digest per wake.
- **No app change beyond the state door** (next section), and no edit of a project's code
  by the Director or the master.

## Failure modes and their handling

| Situation | Handling |
|---|---|
| Builder process dies | The run's `await` (or a `watch`) sees the pid gone, state `exited`; `settle` verifies by git, so a dead builder with no commits ends `failed` and one with commits goes through the gate. |
| An `await` is lost (the Director session restarted) | Its lock names a dead pid and holds nothing; the next wake's `watch` finds the run `running` or `exited` and the Director starts a new `await`. The lock also expires on its own (`AWAIT.lockSlackMin` past the wait), so a reused pid cannot hold a run. |
| An `await` times out | `{timedOut: true}`, exit 0, the run still `running`, nothing killed. |
| Builder goes quiet or runs long | Flagged `quiet` / `timedOut` in `watch` and the digest; never killed. Only `release --kill`, on the operator's word. |
| Usage limit | A builder's output matching `LIMIT_SIGNATURES` (scanned on stderr and non-conversation stream lines only, so a repo that mentions "usage limit" does not trip it) writes the global mark from `watch` or `settle`; `settle` releases that run; `dispatch` refuses while the mark stands (a mark whose `resetsAt` has passed reads as cleared); the loop stops. |
| Memory short (free GB, not used %) | `dispatch` refuses and the loop pauses dispatch and master wakes, still verifies; `settle` takes the single machine-wide gate slot and WAITS (bounded) for headroom, then refuses leaving the run untouched. A short sleep, never a long one: a sibling process holding memory is transient. `status --text` names who is using it. |
| App starts mid-run | The app's stale sweep (`STALE_AFTER_SECS`, `src-tauri/src/commands/fleet/stale.rs:65`, 6 min) marks fleet sessions stale, but these builders write no `fleet_sessions` rows, so it cannot touch them. Replay the outbox only after `--dry-run`. |
| Merge held | Branch kept, ask raised and queued; the operator decides. |
| Invalid decision | `decide` refuses with the errors; the Director sends them back to the same master once, then parks the project for the wake and reports it. |

## Exit watchers: `await` instead of a polling Director

Added 2026-10-06. The Director used to find a finished builder by polling `watch` on its
wake cadence (about 15 minutes), so a builder that had exited waited 17.8 minutes on average
(p90 30) before `settle` started. Now `dispatch` prints an `awaitCommand`, and the Director
starts it with `run_in_background` at once:

- `await --run <id> [--timeout-min N]` (`lib/await.mjs`) blocks until the run's builder pid is
  gone, polling it every `AWAIT.pollSec` seconds with `process.kill(pid, 0)`: no model, no
  journal write while it waits. Then it does exactly what `watch` does for that run (running
  -> exited, the usage-limit mark) and then `settle`'s own code path, so the machine-wide gate
  slot, the memory wait and every refusal are settle's. It prints the settled run plus
  `waitedSec` (the wait for the exit, not the gates). `--project p` awaits the first of the
  project's `running`/`exited` runs to finish instead.
- **Many at once, one per run.** Awaits run side by side; their gates still run one at a time
  because settling takes the gate slot. Each run is locked (`runs/<id>/await.lock`, pid +
  expiry): a second await on it is refused `already awaited`, and `settle` refuses `awaited`
  while another process holds the lock, so a run is never settled twice concurrently.
- **Refusals** (exit 2): `not awaitable` for a run not `running`/`exited` (also when the
  operator releases it mid-wait), `nothing to await`, `already awaited`, and settle's own
  (`memory`, `gate busy`, ...), each carrying the slug, run id and `waitedSec`.
- **Timeout** (default `TIMEOUT_MIN`): `{timedOut: true}`, exit 0, and nothing is killed;
  the skill kills a worker only on the operator's word (`release --kill`).
- The Director's `ScheduleWakeup` becomes a fallback heartbeat (1200 s or more); a
  background-task notification is the primary wake. `watch` stays for runs no await covers.

## The state door: the app sees the headless chair

Added 2026-10-06. Before it, the app showed a headless-run project's in-app master as idle
or stale (the kp master note frozen at its last in-app decision, pof with no master at all,
"Running" never shown), and nothing stopped the in-app tick from deciding on the same
backlog. Scope is the master's STATE only; the Fleet builder rows, `persona_executions` and
`fleet_sessions` are untouched.

- **Storage**: one `app_settings` row per project, `headless_master:<project_id>`
  (`HEADLESS_MASTER_PREFIX`, `src-tauri/db/src/settings_keys.rs`), JSON
  `{ state: running|idle|ended, note (<= 600 chars, cut server-side), nextWakeAt, beatAt
  (server-stamped), runId, source: "appmaster" }`. Excluded from the settings audit, so a
  beat never floods Settings -> History. Rejected alternatives: a fake `persona_executions`
  row (takes a concurrency slot and is swept as stale at startup), an attention-ledger row,
  and the charter's `spec.pacing` (distorts the interval floor and the daily cap).
- **Write**: `POST /dev-tools/app-master/{project_id}/heartbeat`
  (`dev_tools_http.rs` -> `commands/infrastructure/headless_master.rs`
  `record_heartbeat`). The project resolves by id, name or root path like the adopt door.
  A bad state, an unparseable `nextWakeAt`, a run id over 100 characters or a note over
  16,384 characters after trimming is a 400; a note between 600 and that is stored cut.
  The answer is the stored beat plus `suppressing`. A beat is accepted for a project with
  no master persona yet (pof before adoption) and displays once the persona exists.
- **Freshness**: fresh while
  `now < min(max(beatAt, nextWakeAt) + 15 min, beatAt + 6 h)` and the state is not
  `ended` (`HEADLESS_GRACE_MINUTES`, `HEADLESS_HARD_CAP_HOURS`). The grace covers the
  minutes a wake takes to decide and settle, since a headless wake can be up to 240 minutes
  after the last; the hard cap stops a Director that died without `ended` from holding the
  in-app master aside forever. `ended` releases at once.
- **The in-app tick stands aside**: the top rung of `admit_persona`
  (`src-tauri/src/engine/subscription/attention.rs`) refuses a persona any of whose active
  charters is bound to a project with a fresh beat, as
  `AttentionRefusal::HeadlessMaster` (kind `headless_master`). It sits before the wake
  request is consumed, so a pending wake survives, and it covers the live tick and the
  Orchestration preview alike.
- **Read side**: `HeadlessState { state, note, nextWakeAt, beatAt, fresh }` on
  `AppMasterAdoption.headless` (`GET /dev-tools/app-master/{project_id}`; `None` on the
  adopt path) and on each Orchestration preview row, resolved to the project's App Master
  persona by the adopt door's rule (design-context pin + the "App Master" name prefix). The
  preview fills it whatever the persona's own switch says, so a switched-off in-app master
  whose project a terminal runs does not read only "Switched off". The Orchestration panel
  shows it as a chip (`docs/features/monitor.md`).
- **The skill side**: `lib/heartbeat.mjs` posts best-effort through `lib/bridge.mjs` at the
  end of `decide`, `dispatch`, `watch`, `settle`, `await` (also after its refusals) and
  `release`, and `heartbeat --project p
  [--state ended]` posts by hand; `end` posts `ended` for every managed project. It never
  throws, never blocks past about two seconds and never changes an exit code; with the app
  down it does nothing.

**Known gap (v1)**: only the attention TICK stands aside. A channel reply to the in-app
master (the arrivals path) and a manual wake from the UI still start an in-app run while a
headless chair holds the project.

**pof adoption note**: adopt pof's master with the adopt route only. A channel brief
(`/master onboard`'s brief post) calls `dispatch_channel_followup` and WOULD start an in-app
run, which the v1 door does not stop.

## Relationship to /master and the app

`/master` is the chair for the in-app master and needs the app running for every write;
`/appmaster` replaces the clock, the builders and the writes, and shares only `brief.json`.
Running both on one project at once would put two deciders on one backlog; nothing locks it.

**Finding: the rung documents disagree with the code.** `MAX_GRANTABLE_RUNG = RUNG_MERGE` (3)
in `src-tauri/engine/src/app_master.rs:81`, grantable since 2026-09-09 (`495ade3b3`, "rung 3
(merge) is grantable"). The `/master` skill still says "Rung is always 2 (branch and PR; the
operator merges)" (`.claude/skills/master/SKILL.md`, Wave 3), its `master.mjs` adopts with
`scopeRung: 2` (`master.mjs:348`), and `docs/architecture/app-master-e2e.md` records
`MAX_GRANTABLE_RUNG = 2` (section 1). Those claims are left as they are here; the in-app
default (`Mandate::default`) is still rung 2, so `/master`'s choice may be policy rather than
error, but the "never grantable" wording is out of date. This skill runs at rung 3 through its
own gate, independent of the app's mandate.

## Known gaps / unverified

- Outbox replay against the live app: tests use a fake bridge; the door names come from
  `master.mjs` and the scouts.
- Asks raised headless never reach the app's Approvals (no raise door), and the master's own
  `say` never reaches its channel; both live only in the journal and the digest. Closing that
  needs an app-side door, which is out of scope while the app is mid-development.
- Nested subagents: unverified, and the topology does not need them.
- Windows junction hazards: a worktree's `node_modules` is a junction; it must be unlinked
  before any recursive delete, and `ln -s` under MSYS makes a copy, not a link.
- `Discard the branch` releases the run but `release` keeps the branch and worktree; deleting
  them is left to the operator.
- `settle --retry` is not yet in the usage header of `appmaster.mjs`.
- The state door holds the in-app tick only; channel replies and manual wakes are not
  stopped (see "The state door").

## Replay checklist (the day the app is back)

1. Start the app with the test-automation server (`node scripts/e2e/sim-app.mjs up`).
2. `/appmaster end` first if a loop is running; do not run both chairs at once.
3. `AM outbox list` for each project; `AM outbox replay --dry-run`; read every entry.
   An operator `say` replays as a channel message and starts a follow-up run of the in-app
   master persona; drop or accept that before replaying.
4. `AM outbox replay`; confirm each entry reads `replayed` (or `skipped` with a reason you
   accept) with database evidence; a `failed` entry is retried by the next replay.
5. pof: `/master onboard pof` with the brief this skill wrote, so its goals land in `dev_goals`.
6. Check the merged SHAs against `dev_tasks` and the ideas' outcomes.
7. Asks raised headless are not in Approvals (no door); answered ones are in `asks.jsonl`.
8. Then decide whether the in-app master takes over (`/master <p> run`) or this one continues.
