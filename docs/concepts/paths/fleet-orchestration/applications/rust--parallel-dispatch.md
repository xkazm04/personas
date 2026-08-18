---
layer: application
subject: fleet-orchestration
technique: parallel-dispatch
stack: rust
---

# Rust — Fleet dispatch, slots, runs, and the harvest

How the Personas Fleet backend implements
[parallel-dispatch](../techniques/parallel-dispatch.md) and
[result-harvest](../techniques/result-harvest.md) — including where it
deliberately trades away pieces of the standard.

## The slot scheduler — a soft cap by explicit design

`stale.rs:1307-1420`: the live-slot policy is a **pure, unit-tested decision
function** (`live_slot_evictions`) over minimal per-session facts (`SlotSnap`) —
the eviction choice is testable without a fleet. The cap
(`fleet_set_live_slots`, 0 = off) is enforced two ways:

- `live_slot_pass` runs every ticker tick and hibernates overflow Idle/Stale
  sessions, oldest-idle first — only resumable (`has_cc_id`) and process-backed
  (`has_pid`) rows count, and `hibernate(sid, require_resting=true)` re-validates
  state inside the lock so a session revived between snapshot and eviction is
  never slept mid-turn.
- `free_slot_for_spawn` runs before every spawn *and every wake*
  (`commands.rs:41`, `:67`, `:207` — a wake consumes a slot like any spawn),
  evicting one candidate so the newcomer starts inside the budget.

**The declared trade-off:** "If nothing is evictable (everything is genuinely
working), the spawn proceeds anyway — soft cap." Running/AwaitingInput/Spawning
sessions are untouchable because evicting working sessions would lose in-flight
work. So no Fleet spawn is ever *refused* — the cap is an eviction preference,
not admission control, and its default is off (`MAX_LIVE_SESSIONS = 0`,
`stale.rs:151`). The technique's admit-or-queue standard is not implemented on
this lane; the persona-execution lane next door has real admission
(`tracker.admit` → `Running | Queued | QueueFull`, `engine/src/queue.rs:56-63`),
which shows both designs living in one codebase.

## Run identity — stamped at spawn, grouped by window

`run.rs`: every spawn claims a run id (`claim_run_for_spawn`) persisted onto the
session row (`fleet_sessions.run_id`), so "every session belongs to some run,
even a run of one." Explicit waves use `begin_run(label)` / `end_run`; otherwise
spawns within a 2-minute sliding window (`DISPATCH_WINDOW_MS`) auto-group as an
ad-hoc run. The window is a pragmatic default with a known failure shape (a
hand-started session inside the window joins a wave it isn't part of) — and as
of the 2026-08-16 census, `beginRun`/`endRun` had **zero** frontend callers, so
every real run was window-grouped. The technique's "the wave is an entity,
minted at dispatch" is available here but unexercised.

## Harvest — declared results only, roster math attached

`run.rs:100-240` (`build_report`, pure and unit-testable; IO stays in the
command): per-session rows fold into `FleetRunReport` with `FleetRunTotals`
(session/finished/active/exited counts, token totals, files deduped across the
run — not summed). Two contract details worth copying:

- `summary_from_reason` (`run.rs:169-183`) extracts the summary **only** from a
  `Finished` row's declared `FLEET:DONE` text: "we only report what a session
  actually declared, never a paraphrase of its last state" — the technique's
  report-vs-inference boundary, enforced in one function.
- The result contract is mechanical: a session declares completion by writing
  `FLEET:DONE — <summary>` in its end-of-turn recap; `registry::mark_finished`
  parks it `Finished` with the summary in `state_reason`, detected without any
  orchestrator LLM turn.

Gaps against the technique, visible in the same files: totals classify anything
non-finished/non-exited as "active" (a `Stale` straggler counts as active, not
as its own accounting class), and there is no per-member deadline or straggler
policy — the generic staleness ticker is the only backstop.

## The address discipline — implemented one layer up

The recomputable dispatch key lives on the frontend lane that dispatches into
this registry: `harvestDispatchKey(workspaceId, projectId, scopeId)`
(`src/features/overview/sub_patterns/practiceHarvestPrompt.ts:38`) derives the
key from entity ids (scope included, so concurrent territory fan-outs don't
collide as duplicates), `PracticeRolloutModal.tsx:70-83` does
check → spawn → `renameSession(id, key)` → persist-key-into-domain-row, and
`useHarvestAutoIngest.ts:92-110` reads back by recomputing the key with no
memory of the dispatch. The deliberately opposite lane also exists and is
labelled: `external.rs:13-14` drops the handle by written design ("this process
is the operator's, not ours") — the named detached transport the technique
requires a detached dispatch to be.

## Repo-practice evidence for the collision-domain sections

The write-set discipline and the verify-after-irreversible-act ritual are
operational practice documented in `.claude/CLAUDE.md` ("Parallel-safety
primitives"): disjoint write sets per concurrent session on one checkout,
`git worktree` for multi-file scopes, the isolated-index commit technique
(`GIT_INDEX_FILE`) that survived four runs × eight concurrent builders, and the
standing rule that after every commit the session verifies `git log -1` is its
own message — with the measured incidents (swept stashes, no-oped commits,
mis-attributed pathspec commits) that earned each rule.
