# Linux Fleet Filesystem — running the agent fleet in WSL2

> **Status:** Plan 2 of the fleet-CPU pair, **deferred**. Companion to
> [`warm-verification-service.md`](warm-verification-service.md) (Plan 1, executed
> 2026-09-07). Operator directive 2026-09-07: execute Plan 2 "later after we hit
> bottlenecks in the future". This doc names the bottleneck signals that start it,
> so the decision is measured rather than felt.
> **Last updated:** 2026-09-07

---

## Why

The tools an agent runs before each commit are tree walkers and compilers: git
status, `tsc`, eslint, the census, cargo. On Windows every one of them pays NTFS
metadata cost per file plus Defender real-time scanning on every read and write,
and the repo has ~6,500 gate-relevant files plus 66k files under agent worktrees.
The same walks on ext4 inside WSL2 are commonly two to five times faster, and
Defender does not scan the Linux filesystem unless it is reached through `\\wsl$`.

WSL2 also gives the one thing Windows priority classes cannot: a **hard** CPU and
memory cap on the whole fleet (`.wslconfig` `processors=` and `memory=`), so thirty
agents can never starve the desktop no matter what they spawn.

Plan 1 removes the redundant work. Plan 2 makes the remaining work cheaper and
fences it. Do Plan 2 only when Plan 1 has landed and the signals below fire.

## Machine baseline (measured 2026-09-07)

| | |
|---|---|
| CPU | AMD Ryzen 7 7800X3D, 8 cores / 16 threads |
| RAM | 64 GB |
| Disk | C: only, 244 GB free |
| WSL2 | installed; distros `Ubuntu` (stopped), `NVIDIA-Workbench` (stopped, default), `docker-desktop` (running) |
| `.wslconfig` | none, so WSL2 defaults to half the RAM and all logical processors |
| Hypervisor | present |

## Start signals (any one, measured, not felt)

1. With the gate daemon warm, a fleet of N agents still holds the box above 80%
   total CPU for more than 15 minutes, measured with `Get-Counter '\Processor(_Total)\% Processor Time'`.
2. A cold gate on Windows measures more than 2× the same gate in WSL2 on the same
   commit (the measurement recipe is step 1 below; it is cheap and can run any time).
3. `MsMpEng` exceeds 10% of one core averaged over a working hour even with the
   exclusions from the 2026-09-07 guidance applied.
4. Foreground latency complaints persist after BelowNormal priority and the
   exclusions.

## Approaches considered

1. **Cross-OS worktrees** (a Linux worktree of the Windows repo, through `/mnt/c`).
   **Rejected.** `/mnt/c` is the slowest path of all (9P), line endings and file
   modes churn every diff, and Linux `node_modules` cannot share Windows binaries.
2. **A separate Linux clone with a local remote.** **Chosen.** The Linux clone owns
   its own `node_modules`, cargo target, and gate-daemon instance. It fetches from
   `origin` and from a `windows` remote pointing at `/mnt/c/.../personas` so branches
   move between the two sides without a round trip through GitHub.
3. **A second physical machine.** Cleanest isolation, but a purchase, and the
   Fleet's spawn path would need a remote transport. Revisit only if WSL2's cap is
   still too tight.

## Implementation

### Step 1: measure before committing (30 minutes, safe to do today)

```bash
# inside WSL2 Ubuntu
git clone https://github.com/xkazm04/personas ~/kiro/personas
cd ~/kiro/personas && git remote add windows /mnt/c/Users/kazda/kiro/personas
npm ci
time git status; time npx tsc --noEmit; time npm run census:check; time npx eslint src/
```

Compare against the Windows numbers on the same commit. If the ratio is under
1.5× across the board, stop here: the disk was not the bottleneck.

### Step 2: cap the fleet

`%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
processors=12
memory=28GB
swap=8GB
```

Twelve of sixteen threads for the fleet, four reserved for the desktop. Tune from
measurement, never below what Plan 1's daemon needs (about 4 GB plus one gate).

### Step 3: the fleet spawns into Linux

- Install the Claude CLI in the distro; log in with the subscription (never an API
  key, see `feedback_cli_always_subscription_never_api`).
- The headless runner (`src-tauri/src/commands/fleet/headless.rs:143`) gains a
  `program` override so a session can be `wsl.exe -d Ubuntu -- claude --print ...`.
  stdio piping is unchanged; stream-json comes back the same way.
- Worktrees for Linux sessions live under the Linux clone, not under
  `.claude/worktrees/` on C:. The active-runs ledger stays the coordination surface
  and is read through the `windows` remote.
- The gate daemon runs once per side. The Linux instance answers Linux worktrees.

### Step 4: what stays on Windows

- `npm run test:rust` and anything that links the Tauri desktop app: it embeds the
  comctl32 manifest with `mt.exe` and needs the Windows SDK.
- Live UI verification against the running desktop app on `:17320`.
- Release builds.

Rust logic tests for the extracted crates (`npm run test:rust:crates`) run fine on
Linux and are the cheaper lane for agents that touch `personas-core` / `db` / `engine`.

### Step 5: exit criteria

- Fleet CPU share is bounded by `processors=` under any load (verify by starting
  thirty idle sessions and one `npm run check` each).
- Foreground responsiveness holds during a full fleet gate.
- Per-gate wall clock on Linux is recorded next to the Windows numbers in
  `warm-verification-service.md`'s "Measured" section.

## Risks named up front

- Two clones means two places for uncommitted work to live. The never-stash and
  isolated-index rules apply on both sides.
- WSL2's VHDX grows and never shrinks on its own; budget 40 GB and schedule
  `wsl --manage Ubuntu --set-sparse true` or an `Optimize-VHD` pass.
- `docker-desktop` shares the same WSL2 VM caps; `processors=` applies to it too.
