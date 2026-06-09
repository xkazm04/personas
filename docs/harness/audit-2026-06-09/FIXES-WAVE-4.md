# Audit Fix Wave 4 — Orphaned processes / zombie state / recovery gaps

> 4 commits, all 5 critical findings closed (no deferrals).
> Theme: spawned processes that outlive their owner, and DB rows that resurrect or get destroyed.
> Baseline preserved: `cargo check --features desktop` clean throughout.
> Branch: `vibeman/audit-2026-06-09`.

## Commits

| Commit | Finding | Files |
|---|---|---|
| `214a2a755` | execution #2 — session_id write resurrects terminal rows | `db/repos/execution/executions.rs`, `engine/runner/mod.rs` |
| `7830e9ddd` | dev-ideas #2 — timed-out task hangs on unbounded wait() | `commands/infrastructure/task_executor.rs` |
| `24d936d52` | dev-ideas #1 — context-map clobbered before LLM output | `commands/infrastructure/context_generation.rs` |
| `d6add434c` | fleet #1 + #2 — zombie shells + child_pid lifecycle | `commands/fleet/{registry,pty,commands}.rs` |

## What was fixed

1. **execution #2 — zombie resurrection.** A detached, retrying task persisted `claude_session_id` via `update_status` with `status=Running` and no guard. A fast run that already reached a terminal status got flipped back to `running` and orphaned (no finalizer left) until the stale-sweep downgraded it with a misleading "stalled" notice. Added `set_claude_session_id` — a column-scoped write `... SET claude_session_id=? WHERE id=? AND status='running'` that never touches `status`.
2. **dev-ideas #2 — timeout hang.** On the 10-min timeout, control fell to an unbounded `child.wait().await` *before* the timeout check, so a hung CLI never returned, the task stayed `running` forever, and the process was orphaned (`kill_on_drop` can't fire while `wait()` borrows the child). The timeout branch now runs first: `child.kill().await`, a bounded 5s reap, then the error — mirroring the sibling scanners.
3. **dev-ideas #1 — context-map data loss.** A non-delta rescan ran the committed `clear_project_context_map` DELETE *before* spawning the CLI, so any rescan that failed/cancelled/produced nothing permanently destroyed the hand-curated map. The clear is now lazy — fires only when the run produces its first real group/context (`map_cleared`) — so a failed rescan leaves the existing map intact.
4. **fleet #1 — zombie shells.** Kill/close/hibernate only dropped the PTY writer+master; interactive `claude` ignores stdin EOF on ConPTY, so the real process kept running (and burning tokens) — Fleet's own Kill button manufacturing the orphans `process_scan` cleans up. A kill handle is now cloned via `child.clone_killer()` at spawn, stored on `FleetSessionInner`, and `close_pty_handles`/`hibernate` call `killer.kill()` before dropping handles; `fleet_kill_session` routes through `close_pty_handles`.
5. **fleet #2 — child_pid mislabel.** `hibernate` cleared `child_pid` on the *intent* to sleep, before the process was confirmed dead, so the still-live orphan instantly read as untracked (process_scan would flag it / a wake would `--resume` a second process). `child_pid` is now kept until the reaper confirms exit: cleared in `mark_exited` (normal exit) and via `clear_child_pid` in the reaper's hibernation branch.

## Verification

| Gate | Result |
|---|---|
| `cargo check --features desktop` | clean, 0 errors (ran after every fix) |
| `tsc --noEmit` | 0 (no TS changed this wave) |
| `cargo test --lib` / `vitest` | pre-existing failures only, untouched files (see Wave-1/2/3 docs) |

> The fleet `killer` field is `Option<...>` so the existing test fixture (`registry.rs` `session()`) stays constructible (`killer: None`); the real spawn always sets `Some`.

## Patterns reinforced (catalogue, continued)

12. **A spawned process must have a kill handle its owner can reach.** Don't rely on stdin-EOF / handle-drop to stop a child — capture an explicit killer at spawn and call it. "Session closed ⇒ process dead" is a class invariant, not an EOF side-effect.
13. **Clear identifiers (PID, status) on *confirmed* state, not *intent*.** Clearing `child_pid` on hibernate-intent (before death) mislabels a live process; clear it where the truth is known (the reaper). Same shape as "terminal states are sinks".
14. **Never `wait()` unbounded on a process you've decided to abandon.** Kill first, then reap with a timeout. An unbounded wait on a hung child borrows it and blocks `kill_on_drop` forever.
15. **Destroy-then-recreate must be lazy or staged.** Don't commit a destructive clear before the replacement exists; defer the clear until the first valid output (or stage + atomic swap), so a failed regeneration leaves the old data intact.

## Cumulative status (Tier-1, waves 1–4)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Lost-update writes | 8 / 8 |
| 2 | Transition guards & lock leaks | 5 / 7 |
| 3 | Success theater / silent failure | 4 / 7 |
| 4 | Orphaned processes & recovery gaps | 5 / 5 |
| | **Tier-1 criticals fixed** | **22** |

Remaining Tier-1: Wave 5 security (7), Wave 6 corruption loops & stream/graph integrity (7), plus the deferred items (teams #1/#2, events #1/#2, composition #6 part b, research #1). Then Tier-2 UI (19) and Tier-3 highs (169).
