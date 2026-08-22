# Golden path — Spawning a CLI subprocess

> Situation node: `backend-runtime/process-execution/spawning-a-cli-subprocess` · [situation spine](../situation-spine.md)
> Composed 2026-08-15 against `master` @ `02fe37134`. Ground-truth sweep: all **963**
> `src-tauri/**/*.rs` files (matches [`shared-facts.json`](../shared-facts.json)
> `rust.files: 963`) walked by **three independent matchers** — a block-scoped
> builder-chain extractor, a line-window classifier, and a brace-matched
> `#[cfg(test)]`-range classifier — which disagreed three times, and every
> disagreement is reported below. **135** `Command::new` construction sites found,
> **10** inside `#[cfg(test)]` blocks, **125 production**; each classified on eight
> axes (program literal/variable, shell vehicle, env delta, cwd, stdio, lifetime
> binding, timeout, exit-status use). `engine/src/cli_process.rs` (820 lines),
> `engine/src/verification_command.rs`, `engine/runner/env.rs`,
> `engine/runner/credentials.rs`, `engine/mcp_tools.rs`'s spawn half,
> `commands/fleet/{pty,headless,external}.rs`, `webbuild/devserver.rs` and
> `daemon/lock.rs` read in full. **Three experiments were run on the operator's
> own Windows 11 box** (orphan survival, pipe-buffer capacity, `cmd.exe`
> re-parsing) — their results are the headline and they inverted two things I
> expected. **No `cargo` was run. Nothing touched the running app.**
> **Deviations** is a fix backlog; it migrates to `violating` cells on ingest.

**Adjacent leaves — cross-reference, do not absorb.**
[`cancelling-in-flight-work.md`](./cancelling-in-flight-work.md) owns **stopping a
child a user asked to stop**: the eight registries, `kill_process`, the five ordered
acts, `ProcessContext`. This path owns **creating** the child — everything decided
before `.spawn()` returns, plus the one teardown case that path cannot reach (the
app dying without running any cancel path at all). Where they meet —
`.kill_on_drop(true)` — that path owns it as a cancellation guarantee and this one
owns it as a construction step; neither restates the other.
[`background-loop.md`](./background-loop.md) owns **tokio tasks**; this path owns
**OS processes**. Its clause 6 hands the boundary over explicitly: *"Whatever a tick
spawns is not the loop's business, and must be somebody's."* It is this path's.
Concretely: a dropped `JoinHandle` does not abort its task (that path's finding); a
dropped `Child` does not kill its process **unless** `kill_on_drop` was set (this
path's), and even then only the immediate child.
[`structured-logging.md`](./structured-logging.md) owns **every byte the child
writes once you decide to keep it** — the `sanitize_secrets` chokepoint inside
`ExecutionLogger::log` (`engine/src/logger.rs:61`, landed 2026-08-14, masking new
writes only). It states as context that the child *"runs with decrypted service
credentials injected as environment variables"* and explicitly claims none of the
spawn side. **That injection is this path's subject**, and §"Deviations — E" is the
upstream of its P0.
[`secret-display-and-transfer.md`](./secret-display-and-transfer.md) owns serving
that stored output back to a human, and gates `secret-as-bare-string-field`. Its
own §9 declares env-var lists **outside** its instrument's reach.
[`filesystem-boundary.md`](./filesystem-boundary.md) owns proving a caller-supplied
path resolves inside an app-owned root — including a `cwd` parameter, which is
inside its trigger — and it hands argv construction to this path in as many words:
*"Subprocess argument construction … [is its] own situation."* Deviation C1 below is
that path's `validate_fleet_cwd` finding seen from the spawn side.
[`command-input-validation.md`](./command-input-validation.md) measured the three
IPC parameters named `command` / `args` / `script`, found *"all three delegate to a
downstream executor that constructs an argv array rather than a shell string"*, and
recorded that **"the delegation is a convention, not a type, and nothing states it
at the boundary."** This document is that statement.

---

## Principle

*Three sentences, no repo path, no primitive name, no count — the layer a sibling
repo on another stack can adopt as-is. Each clause carries its warrant, per the
[portability test](../research/portability-test.md)'s finding that unmarked local
calibration is what gets a whole document discarded.*

> **(physics)** A child is created from four inheritances — its argument vector, its
> environment, its working directory and its open streams — and each one you do not
> state explicitly you have granted in full, because the default for every one of
> them is "everything the parent had". **(physics)** Interposing an interpreter
> between you and the program you meant to run converts every one of those four from
> data into syntax, and no amount of quoting at your end restores the boundary,
> because the interpreter re-parses what you built by rules that are not the ones you
> escaped for. **(ergonomics)** A child outlives the abstraction that spawned it
> unless its lifetime was bound to something the operating system will honour when
> your process is gone — which a kill you have to remember to send is not, since the
> case you most need it for is the one where you are not running.
>
> *Scale condition:* clause 1 starts paying the moment the parent holds a secret the
> child does not need; clause 2 at the first value in a command line that you did not
> author; clause 3 at the first child that outlives one request. Below that, inherit
> everything and let the OS reap it.
> *Local calibration (do not port):* everything below this block.

---

## Trigger

- "Run the Claude CLI / `git` / `ffmpeg` / `npx` from the backend"
- "Shell out to X and parse the output" / "just run the command and give me stdout"
- "It works in my terminal but not from the app"
- "The app is closed and `claude` is still running" / "why is `node` pinning a core"
- "It hangs forever on a big build" / "the command never returns"
- "Let the user configure the command that gets run" / "the LLM should pick the command"
- "It exited 0 but produced nothing, so we treated it as success"

If you are about to type `Command::new(`, `.arg(` / `.args(`, `Stdio::piped()`,
`cmd /C` or `sh -c`, `child.kill()`, `.output().await`, or a `*_CMD_TIMEOUT_SECS`
constant — you are in this situation.

## The one way

**Do not build a command; build a `CliArgs` and hand it to the one driver.** Resolve
the program to an absolute path yourself (`claude_cli_invocation()`,
`cli_process.rs:69`) rather than letting `PATH`, `PATHEXT` or a `.cmd` shim resolve
it, and **never make a shell the program** — an interpreter turns your carefully
separated arguments back into one string that it re-parses by its own rules (measured
below: passing a value as a separate argv element to `cmd /C` does **not** stop
`cmd.exe` expanding `%NAME%` out of the child's environment, and does **not** stop an
embedded `"` re-opening command chaining, because Rust's `\"` escape is an MSVCRT
convention `cmd.exe` does not honour). State all four inheritances explicitly:
**argv** as an array of already-separated strings; the **environment** as
`env_clear()` plus an allowlist (`sanitized_env()`, `auth_detect.rs:503`) rather than
the parent's 93 variables minus a denylist; the **working directory** as the
`PathBuf` a validator *returned*, never the string it merely approved; and **stdio**
on every one of the three streams — pipe what you will drain, `Stdio::null()` what
you will not, and drain both pipes **concurrently with the wait**
(`verification_command.rs:71-88`) because a child stalls at tens of kilobytes of
undrained output (84 KB, measured) and then your timeout is the only thing left.
Bind the lifetime at construction with `.kill_on_drop(true)` **and** record the PID,
then wrap the wait in `tokio::time::timeout` and, when it fires, kill explicitly
rather than trusting drop order (`oneshot.rs:269-271`). Read the **exit status**, not
just stdout — `Option<i32>` plus a separate `timed_out` flag, because "killed" and
"exited 5" are different outcomes and `code()` is `None` for the first. And accept
that none of this survives the parent dying: on Windows only a **job object** and on
POSIX only a **process group** make "the app crashed and left a `claude` running"
impossible, and this repo has **zero of either**.

## Mandated primitives

- **`src-tauri/core/src/types.rs:287` — `CliArgs { command, args, env_overrides, env_removals, cwd }`.** The spawn contract as a value. Build this, not a `Command`. Its `args: Vec<String>` is the whole argv-array doctrine in a type.
- **`src-tauri/engine/src/cli_process.rs:576` — `CliProcessDriver::build_and_spawn_core`.** The one correct spawn body: argv array, `stdin`/`stdout` piped and `stderr` nulled *with the deadlock reason written down* (`:565-567`), `.kill_on_drop(true)` *with the billing reason written down* (`:584-589`), `current_dir`, `CREATE_NO_WINDOW`, then `env_removals` → `env_overrides` → `force_subscription_auth`. **11 production call sites** via `spawn` / `spawn_temp` / `spawn_cwd`.
- **`cli_process.rs:69` — `claude_cli_invocation()`** and **`:104` — `resolve_claude_exe_windows()`.** Program resolution as a decision, not a `PATH` lookup: native installer → npm-global layout → `PATH` scan, falling back to `cmd /C claude.cmd` only if no real exe exists. Its 30-line doc comment names the two real machine failures it fixes. `pub` precisely so `fleet/headless.rs:111` and `fleet/pty.rs` share the one source of truth.
- **`cli_process.rs:36` — `CLI_SUBSCRIPTION_RESERVED_ENV`** + **`:45` — `force_subscription_auth(&mut cmd)`.** `env_remove` for `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`. **Call it AFTER your overrides** — its doc says so and a test pins it (`:775`). 7 production call sites plus a hand-rolled mirror for the PTY lane (`fleet/pty.rs:409-411`, which explains why: `CommandBuilder` is not a `tokio::process::Command`).
- **`src-tauri/src/engine/runner/env.rs:83` — `sanitize_env_name(&str) -> Option<String>`.** The env-name guard: uppercases, strips non-`[A-Z0-9_]`, then refuses **34 exact names** (`PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, `PYTHONSTARTUP`, `BASH_ENV`, `ZDOTDIR`, …) and **6 prefix families** (`NPM_CONFIG_`, `UV_`, `BUN_`, `DENO_`, `PIP_`, `CARGO_`) whose runners map back onto the exact names. The prefix half exists because `npm_config_node_options` re-arms `NODE_OPTIONS` on an allowlisted runner. **2 call sites** (`credentials.rs:894`, `mcp_tools.rs:1764`).
- **`src-tauri/src/commands/credentials/auth_detect.rs:503` — `sanitized_env()`**, used as `.env_clear().envs(sanitized_env())`. The **only bounded environment in the repo**: PATH + HOME/USERPROFILE/APPDATA/LOCALAPPDATA/SYSTEMROOT and nothing else, with the reason in the comment (*"Clear env to prevent credential leaks to the subprocess"*). **2 of 125 sites.** This is the shape; see Deviations E1.
- **`src-tauri/src/engine/mcp_tools.rs:1787` — `validate_mcp_command(&str) -> Result<Vec<String>, AppError>`.** The only place a caller-supplied *program* is judged: rejects 14 shell metacharacters, splits to an argv array, allowlists 11 binary basenames (extension-stripped so `npx.cmd` matches `npx`), rejects remote-code specs and host-escape container flags — **and writes down what it does not stop** (a poisoned but real registry package). Tested at `:1929-1988`. 1 call site; see Gaps 3 and Deviation A3.
- **`src-tauri/engine/src/verification_command.rs:47` — `run_verification(dir, command, timeout) -> VerificationResult`.** The reference for the **read** half: `stdin(Stdio::null())`, both pipes drained by `tokio::join!` *concurrently with `child.wait()`*, a `tokio::time::timeout` over the join, `start_kill()` when it fires, and an outcome type that separates `passed` / `exit_code: Option<i32>` / `timed_out`. Its module doc (`:11-13`) is the only **declared trust boundary** for a shell string in the repo.
- **`src-tauri/src/webbuild/devserver.rs:244` — `clear_stale_next_lock`** + **`:266` — `pid_is_node`.** The only crash-recovery path for an orphaned child: read a persisted PID, **verify the process is still the kind of thing you think it is**, then tree-kill. Copy the identity check; nothing else in the repo has it. (`daemon/lock.rs:183-195` is the same idea for the daemon's own lock, via a heartbeat staleness test.)
- **`src-tauri/src/engine/mod.rs:1698` — `kill_process(pid)`** — `taskkill /F /T` on Windows, `kill -9` on POSIX. Owned by [`cancelling-in-flight-work.md`](./cancelling-in-flight-work.md); named here only so you know it **cannot reach a grandchild once the parent is gone** (measured, Experiment 1).

## Steps

1. **Ask whether you need a process at all.** brainiac — a Rust service of comparable size — spawns **zero** child processes across its whole 8-crate workspace and does its git publishing by writing files and leaving committing to CI. A child process is a security boundary, a lifetime problem and a portability problem in one. Only reach for one when the capability genuinely lives in another binary.
2. **Resolve the program to an absolute path, in code you can read.** Not `PATH`, not `PATHEXT`, not a `.cmd` shim. `claude_cli_invocation()` for the CLI; for anything else, resolve and probe like `resolve_claude_exe_windows` does. If the program name comes from outside the module, it must pass an allowlist — `validate_mcp_command` is the pattern, and there is exactly one of those.
3. **Build argv as an array. Never make a shell the program.** If you think you need `cmd /C` for `PATHEXT`, resolve the `.cmd`'s real target instead (step 2 is what that helper exists for). If you genuinely cannot — you are running an operator's own command line — say so in a doc comment naming who authored the string and why they are trusted, the way `verification_command.rs:11-13` does. That comment is the artifact §9's allowlist keys on.
4. **Clear the environment and add back what the child needs.** `.env_clear().envs(sanitized_env())`. Then your `env_overrides`, then `force_subscription_auth` last. The default — inherit — hands a child 93 variables on this box, and the app deliberately injects decrypted connector credentials into that same map. A denylist over an inherited environment is a bet that you enumerated every dangerous name; an allowlist is not a bet.
5. **Set the working directory from a validator's return value.** If a validator only tells you *yes*, it has not given you anything to use — fix its signature (Deviation C1). Never `PathBuf::from(the_string_you_checked)`.
6. **Configure all three streams, then decide who drains them.** `stdin(Stdio::null())` unless you will write to it, and if you do write, do it from a separate task (`cli_process.rs:372`). Pipe what you will read; `Stdio::null()` what you will not. **Drain concurrently with the wait, never after it** — `tokio::join!(child.wait(), read_stdout, read_stderr)`. 75 of 125 sites configure no stdio at all.
7. **Bind the lifetime before `.spawn()`.** `.kill_on_drop(true)`, then `ctx.set_pid(child.id())` immediately after. The first covers a dropped future; the second is the only thing that reaches grandchildren, and only while you are alive.
8. **Put a timeout on the wait, and kill explicitly when it fires.** `tokio::time::timeout(..)` then `child.kill().await` / `start_kill()` — do not rely on drop order (`oneshot.rs:269-271` states exactly this and calls it a "deterministic reap"). Then `child.wait()` so you do not leave a zombie on POSIX.
9. **Read the exit status.** `status.success()` at minimum; `Option<i32>` plus a `timed_out: bool` when a caller must distinguish outcomes. `code()` is `None` when the child was killed by a signal — collapsing that into `Some(1)` or into "failed" loses the one fact your operator needs.
10. **And then stop.** Do not write a cancel registry (that leaf owns it), a tree-kill (`kill_process` owns it), a retry ladder, or a log sink. Register the PID and return.

### Prefer a type over a gate

Asked directly, per the contract: **could a spawn be made impossible to get wrong?**
Partly — and the interesting answer is that the four axes need *four different*
answers, one of which is not a type at all and is the most valuable thing in this
document.

1. **The cwd axis has a one-line type fix with 7 call sites.** `validate_fleet_cwd` (`approval_exec_fleet.rs:1040`) canonicalises `cwd`, resolves `..`/symlinks, and confirms containment under a registered dev project — then returns `Result<(), AppError>`. The caller has nothing to use, so `approval_exec_fleet.rs:1105` does `std::path::PathBuf::from(cwd)` on the **raw string**, and that is the cwd `claude --dangerously-skip-permissions` runs in. Change the signature to `-> Result<PathBuf, AppError>` and check-then-use-original stops being expressible. The precedent is in-repo and is the strongest guard [`filesystem-boundary.md`](./filesystem-boundary.md) found: `open_log_file_safely` returns the **open `File`**, not a path.
2. **The env axis needs a newtype, because the guard is a function you must remember to call.** `sanitize_env_name` is correct and reachable from 2 of ~30 env-setting sites. Make `CliArgs.env_overrides: Vec<(EnvName, String)>` where `EnvName`'s only constructor is `EnvName::try_new(&str) -> Option<EnvName>` calling `sanitize_env_name`, and "a credential field named `NODE_OPTIONS` reached a child" stops compiling. Pair it with making `env_clear()`-plus-allowlist the driver's default rather than a thing two files remembered.
3. **The argv axis cannot be a type, and should not pretend to be.** `CliArgs.args: Vec<String>` is already the right shape and 121 of 125 sites already build argv arrays. What is missing is not a type but a **stated trust boundary** for the four sites that hand a whole string to an interpreter. §9's allowlist is the right home: an exemption with a mandatory prose `reason` *is* the declaration, reviewed at the moment it is added.
4. **The lifetime axis has no type at all, and this is the finding.** Every mechanism this repo has — `kill_on_drop`, `kill_process`, `Drop` guards, the eight cancel registries — requires the parent to be **running**. Experiment 1 measures what that is worth: kill a Rust-shaped parent and its grandchild survives indefinitely with its `ParentProcessId` still pointing at the dead PID, and `taskkill /F /T /PID <dead parent>` — the exact command `engine::kill_process` runs — fails with *"The process not found"*. There is no `Drop` you can write for a process that is not scheduled. **The answer is an OS primitive: a Windows job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, created once at startup, with `AssignProcessToJobObject` inside the one spawn helper; on POSIX, `process_group(0)` at spawn and `killpg` at teardown.** That makes "Personas died and left children" *unrepresentable*, including for grandchildren no tree-kill can reach. It is roughly 40 lines in `cli_process.rs`, it needs no call-site changes, and — see Experiment 1 — **Node already does this for you, which is why the repo's own build scripts never showed the symptom and the Rust backend does.**

**Propose 1, 2 and 4 as the fixes; the §9 census rule is the ratchet that holds
axis 3 until a trust boundary is written for each of its five files.**

## The contract (parent ↔ child)

Six rules bind a spawn to the process that made it. Every one is violated somewhere.

1. **Every inheritance is stated or it is granted in full.** argv, env, cwd, stdio. **97 of 125 sites apply no environment delta at all; 71 do not set `current_dir`; 75 configure no `Stdio` at all.** Inheriting is often correct — `git --version` needs nothing — but it must be a decision, and today it is a default.
2. **A value the app did not author never becomes syntax.** Passing it as a separate argv element to a **direct binary** satisfies this; passing it as a separate argv element to `cmd /C` does **not** (Experiment 3).
3. **What a validator approved is not what you may use; what it *returned* is.** C1.
4. **A piped stream is a promise to drain it, kept concurrently with the wait.** Draining after `wait()` returns is the same as not draining: measured, the child stalls at 84 KB and `wait()` never returns.
5. **The exit status is part of the result.** **42 of 125 sites never inspect it.** `.output()` succeeding means the process ran, not that it worked.
6. **A child's lifetime is bounded by something that survives your death.** No site in this repo satisfies this. See §9's refusal.

## Anti-patterns

- **Making a shell the program.** 12 `Command::new("cmd"|"sh"|"powershell")` lines across 8 logical sites. The failure mode is not "someone will inject a `;`" — it is that you no longer control what the string means. Measured: `cmd /C echo harmless-%VAR%-tail`, with the value passed as its **own argv element**, returns `harmless-SENSITIVE-VALUE-1234-tail`. The app injects decrypted connector credentials into exactly that environment.
- **Believing `.arg()` escaping protects you from `cmd.exe`.** `mcp_tools.rs:2049-2051` states the belief in a comment: *"This avoids passing the entire command as a single shell string, preventing metacharacter interpretation by cmd.exe."* Measured false: Rust's MSVCRT quoting of `a" & echo INJECTED & rem "b` produces `"a\" & echo INJECTED & rem \"b"`, `cmd.exe` treats `\"` as a literal backslash followed by a closing quote, and `INJECTED` executes. What actually saves that site is `validate_mcp_command`'s metacharacter denylist rejecting `&` — and that denylist contains **neither `%` nor `"`**.
- **A denylist over an inherited environment.** `BLOCKED_ENV_NAMES` is 34 names and 6 prefix families of genuine craft, and it is still a bet that nobody ships a 35th code-execution env var. `env_clear()` + allowlist is not a bet, exists in this repo, and has 2 users.
- **`Command::new` with no `current_dir`.** 71 sites. The app's own cwd on a desktop launch is wherever the shell/Explorer left it; `git status` in that directory is a different command from the one you meant. `cli_process.rs:552` at least materialises the decision (`current_dir().unwrap_or_else(|_| temp_dir())`) instead of leaving it implicit.
- **`.output()` inside a scope with no timeout.** 84 `.output()` sites, 8 of them with a timeout in scope. `output()` waits forever by construction; a child blocked on a full pipe or a network read wedges the caller with no upper bound.
- **Piping a stream and draining it after `wait()`.** `healthcheck.rs:249-260` reads stdout to EOF then stderr to EOF sequentially. `memory_reflection.rs:338` pipes stderr and never takes it. Both are bounded only by a deadline, so the symptom is a spurious timeout verdict rather than a hang — which is worse to debug.
- **`std::process::Command` inside an `async fn`.** `ai_artifact_flow.rs:572`. `.output()` on the blocking API occupies a tokio worker for the child's entire lifetime.
- **Trusting drop order to kill.** `kill_on_drop` fires when the `Child` is dropped, which is *after* your error path has already returned in some layouts. `oneshot.rs:269-271` names this and kills explicitly first. Copy that.
- **`child.kill()` with no `wait()`.** 54 `.kill()` sites; 15 follow with a `wait()`. On POSIX the rest leave a zombie until the parent exits.
- **Reading stdout and never the exit code.** 42 sites. An `rg` that found nothing and an `rg` that could not open the directory both produce empty stdout; only the code tells them apart. `optimize/route.ts:61-66` in `vibeman` gets this right by treating `rg`'s exit 1 as a valid empty result — nothing here does the equivalent.
- **Collapsing "killed" into "failed".** `status.code()` is `None` when the child died by signal. 6 sites read `.code()` at all; `verification_command.rs` is the only one that models the distinction in its result type.
- **Assuming the tree-kill will still be there.** `taskkill /F /T /PID <parent>` enumerates the tree **at kill time**. Once the parent is dead the relationship is gone and the command errors out (measured). Any teardown that runs *after* the parent's death is not a teardown.

## Evidence

- **`src-tauri/engine/src/cli_process.rs:576-612` (`build_and_spawn_core`) — copy this one.** Every construction decision in fourteen lines, each with its reason in a comment that names a real incident: stderr → null *"to prevent buffer-full deadlocks on Windows"*; `.kill_on_drop(true)` because *"without it the underlying `claude` CLI keeps streaming — and billing the user's API account — until the desktop app restarts"*; `env_removals` then `env_overrides` then `force_subscription_auth` *"AFTER applying any env overrides so nothing can re-introduce them"*.
- **`cli_process.rs:790-830` — the test that proves a negative about a child's environment.** `spawned_child_env_has_no_api_auth` spawns the **system shell** with `cmd /C set` / `sh -c env`, reads the real environment the child received, asserts a control variable arrived (so a failure to capture cannot pass as a clean result), and asserts none of the three reserved names leaked. This is the only test in the repo that inspects a child process's actual environment, and it is the template for verifying any env claim.
- **`src-tauri/engine/src/verification_command.rs:47-115` — the read half, done completely.** `stdin(Stdio::null())`; `tokio::join!(child.wait(), read stdout, read stderr)` with the bug it fixed written down (*"the previous code awaited wait() first and only then read the pipes — a command emitting more than the ~64KB pipe buffer blocked on write, wait() never returned, and every chatty verification ran to its full timeout"*); `tokio::time::timeout` over the join; `start_kill()` on expiry; partial buffers still returned; and `VerificationResult { passed, exit_code: Option<i32>, output_tail, timed_out }` — the only outcome type in the repo that keeps "killed" and "exited nonzero" apart.
- **`verification_command.rs:11-13` — the trust declaration.** *"The command is operator-authored (a persona `verification_command` parameter), so it inherits the host environment like any dev tool — it is trusted input, unlike untrusted agent output."* One sentence, and it is the difference between a shell string that is a decision and four that are an accident. §9's allowlist exists to make this sentence mandatory.
- **`cli_process.rs:52-140` (`claude_cli_invocation` / `resolve_claude_exe_windows`) — program resolution as a decision.** Three ordered install layouts, `cmd /C claude.cmd` kept only as the last fallback, and a doc comment recording the two real machine failures (*"a broken `claude.cmd` earlier on PATH shadows the working one"*, *"the shim itself can vanish from `%APPDATA%\npm` while the actual binary remains"*). Shared with the Fleet lanes rather than reimplemented — `fleet/headless.rs:107-110` explains in a comment why it used `#[cfg(windows)]` and not `if cfg!(windows)`.
- **`src-tauri/src/commands/credentials/auth_detect.rs:424-441` and `cli_capture.rs:627-646` — the only two bounded environments.** `.env_clear().envs(sanitized_env())` with the reason inline, plus per-step timeouts, both pipes drained by `tokio::join!` with byte caps (`read_limited(.., MAX_CLI_OUTPUT_BYTES)`), and a comment at `auth_detect.rs:421-423` that states the whole lifetime doctrine in two lines: *"Spawn child outside the timeout so we can kill it if the deadline fires. Dropping a `tokio::process::Child` without calling `kill()` orphans the process on both Unix and Windows."*
- **`src-tauri/src/engine/runner/env.rs:1-130` — the env-name guard, and the best-written denylist in the repo.** Every entry carries what it does (`NODE_OPTIONS` → *"--require= arbitrary module loading"*, `ZDOTDIR` → *"redirect zsh config to attacker-controlled dir"*), and the prefix families carry the reasoning that produced them (*"npm reads `npm_config_*` case-insensitively and forwards `npm_config_node_options` as `--node-options`, re-arming NODE_OPTIONS on an allowlisted runner even though the exact name is denied"*). 12 unit tests.
- **`src-tauri/src/engine/mcp_tools.rs:1787-1854` (`validate_mcp_command`) — the only judged program in the repo**, and the only guard that documents its own residual risk (*"this does NOT stop `npx <poisoned-but-real-registry-package>` — a published package is statically indistinguishable from a malicious one, so only a per-command user consent gate fully closes that path"*).
- **`src-tauri/src/engine/mcp_tools.rs:2092-2104` — piping stderr *in order to* drain it.** The comment says both halves out loud: *"Capture (not discard) the child's stderr — a drain task below logs it"* and *"A reader is required regardless of logging — without one the OS pipe buffer fills and blocks the child."* That is the correct relationship between the two decisions.
- **`src-tauri/src/webbuild/devserver.rs:244-290` — the only crash-orphan recovery.** Read the persisted PID from Next's own lock file, **confirm it is still a live `node` process** before killing it (so a recycled PID cannot take down a bystander), tree-kill, delete the lock. It works because *Next.js* writes the PID file; Personas writes none of its own.
- **`src-tauri/src/companion/brain/oneshot.rs:269-271` — the deterministic reap.** *"don't rely purely on kill_on_drop-on-drop ordering — kill explicitly before surfacing the timeout error."*
- **`src-tauri/src/commands/infrastructure/setup.rs:167-230`** — both pipes drained by two `tokio::spawn`s, `kill_on_drop(true)` with the reason (*"JoinHandle::abort while a child is stuck"*), and a three-way `tokio::select!` over wait / timeout / cancel.

## Deviations found

### The population

| Axis | Measured over the 125 production `Command::new` sites |
|---|---|
| program is a string literal / a variable | 75 / 50 |
| **shell interpreter as the program** | **12 lines, 8 logical sites** |
| a command string built by **interpolating** a value | **0 — see A1** |
| `env_clear()` (a bounded environment) | **2** |
| any environment delta at all (`.env` / `env_remove` / `env_clear`) | 28 → **97 inherit the app's whole environment untouched** |
| `current_dir(..)` | 54 → **71 inherit the app's cwd** |
| no `Stdio::` configured at all | **75** |
| `.kill_on_drop(true)` coverage | **19** (17 calls; 2 cover a `cfg!(windows)` two-branch pair) |
| a `tokio::time::timeout` in scope | 35 |
| **neither a timeout nor `kill_on_drop`** | **87** |
| exit status never inspected | **42** |
| terminator: `.spawn()` / `.output()` / `.status()` | 45 / 84 / 7 |
| `creation_flags` (58 calls: 54 `CREATE_NO_WINDOW`, 3 `DETACHED_PROCESS`, 1 `CREATE_NEW_CONSOLE`) | 60 sites |
| **Windows job object** (`CreateJobObject` / `AssignProcessToJobObject` / `CREATE_BREAKAWAY_FROM_JOB`) | **0** |
| **POSIX process group** (`setsid` / `process_group` / `pre_exec` / `killpg`) | **0** |
| **a child PID persisted for post-restart reaping** | **0** (only the daemon's own lock, `daemon/lock.rs`) |

**Three matchers, three disagreements — all reported.** (i) A block-scoped extractor
saw 128 sites until a `'"'` char-literal in its comment/string blanker swallowed real
code; fixed, it agrees at 135. (ii) It reports `kill_on_drop` coverage as 15 and a
line-window matcher as 17, because two sites are `if cfg!(windows) { Command::new("cmd") } else { Command::new("sh") }`
pairs whose single later `.kill_on_drop` belongs to both branches — the union is 19
construction sites under 17 calls. **[`cancelling-in-flight-work.md`](./cancelling-in-flight-work.md)
reports "15 `.kill_on_drop(true)` sites"; the code count is 17 and has been 17 since
`cf14b9832`.** (iii) A "first `#[cfg(test)]` onward" test filter excluded 19 sites;
brace-matching the actual test-module ranges excludes 10 — the 9-site difference is
production code that happens to sit *after* an inline test module, and it included
`mcp_tools.rs:2048`, the most important shell site in the repo. **A test filter that
is a line threshold rather than a range silently deletes the tail of every file with
an inline test mod.**

### A — argv and the shell

**A1 — command-string injection by interpolation: cleared, 0 of 963 files.** No site
in `src-tauri` builds a shell command by interpolating a value into a larger command
string. There are 21 `.arg(format!(..))` sites, and every one produces a **single
argv element** for a direct binary, which is the correct use of interpolation. The
four whole-string sites each pass a value that *is* the entire command
(`c.clone()`, `config.get("cmd").as_str()`, `config.command.clone()`, a `&str`
parameter). **The security question here is not "who concatenated" — it is "whose
string is it, and did anyone say so".**

**A2 — 4 sites hand a whole command string to an interpreter; 1 declares whose it is.**

| Site | The string comes from | Trust declared? |
|---|---|---|
| `engine/src/verification_command.rs:123,129` | a persona's `verification_command` parameter | **yes** — module doc `:11-13` |
| `src/engine/kpi_eval.rs:189,193` | `dev_kpis.measure_config` JSON `.cmd` | partial — see A5 |
| `src/engine/pipeline_executor.rs:598,602` | a pipeline node's `config.command` | no |
| `commands/infrastructure/dev_tools/git_ops.rs:124,130` | **`dev_tools_run_tests(test_command: Option<String>)` — a raw IPC parameter, unvalidated** | no |

`dev_tools_run_tests` is the sharpest: an `Option<String>` arrives over IPC, is
`clone()`d, and is `cmd /C`'d in the project root with no validation, no allowlist,
no timeout and no `kill_on_drop`. It is gated only by `require_auth_sync`, which
[`secret-display-and-transfer.md`](./secret-display-and-transfer.md) records as a
no-op. I am **not** labelling this P0 for injection, because there is no
interpolation and the whole parameter is the command — the honest label is
**"an unstated remote-code-execution surface"**: the IPC contract says
`test_command`, and what it means is `cmd /C <anything>`.

**A3 — `validate_mcp_command`'s metacharacter denylist omits `%` and `"`, and its
call site is `cmd /C`.** `SHELL_METACHARACTERS` (`mcp_tools.rs:1781`) is
`| ; & \` $ ( ) { } < > ! \n \r`. Command *chaining* is therefore closed — every
separator `cmd.exe` accepts is on the list. **`%` is not**, and Experiment 3 measures
that `cmd /C` expands `%NAME%` inside a separately-passed argv element, out of the
child's own environment — which `mcp_tools.rs:2075-2077` has just populated from
`parse_env_vars` → `sanitize_env_name`, i.e. from connector credential fields. An MCP
server config (template-, marketplace- or LLM-authored) whose argument reads
`--token=%SLACK_BOT_TOKEN%` receives the real token. Two-character fix: add `'%'` and
`'"'` to the const.

**A4 — 2 more sites route a non-literal through `cmd /C` believing separation is
enough.** `connector_readiness.rs:384` (`c.arg("/C").arg(spec.probe_program).args(spec.probe_args)`)
and `ocr/mod.rs:579-585` (`cmd /c <binary path> -p - …`). Same measured exposure.

**A5 — the controlled experiment is inside one file, 40 lines apart.** `kpi_eval.rs`
is the whole argument in one module doc (`:6-12`): the `codebase` kind runs
`measure_config.cmd` as a **free-text shell string**, justified as *"same trust level
as everything else the teams run in that repo: the config was REVIEWED by the user at
proposal-accept time"* — while the `derived` kind, immediately below, says
*"a WHITELISTED catalog of SQL metrics… Free-text SQL is deliberately not accepted:
the catalog is the contract."* One author, one file, one kind of stored config, two
opposite postures. And the review premise does not hold for either of the other two
writers of that column: `kpi_scan.rs:818` / `kpi_compose.rs:218` create KPIs from a
Claude CLI composition pass, and `data_portability.rs:6394` creates them from an
**imported bundle**. A shared KPI pack is `cmd /C <arbitrary>` in the user's project
root.

### B — the environment

**B1 — 97 of 125 children inherit the app's entire environment; 2 bound it.** This box
hands a child **93 variables**. The app deliberately injects decrypted connector
credentials as `{CONNECTOR}_{FIELD}` env vars on the execution hot path
(`runner/mod.rs:1537-1605`), and `ZeroizingFields` (`runner/credentials.rs:51-84`)
shrinks the *in-process* plaintext lifetime to a single injection — but the value
then lives for the child's whole life in an environment every grandchild inherits.
`claude` spawns MCP servers, `npx`, and browsers.

**B2 — the allowlist primitive is `pub(crate)` in a command module.** `sanitized_env()`
lives at `commands/credentials/auth_detect.rs:503`, so `engine/` — where
`CliProcessDriver`, the driver 11 sites use, actually lives — **cannot call it**.
This is structurally the same blocker `filesystem-boundary.md` Gap 2 records for
`resolve_safe`. The right home for both is `personas-core`.

**B3 — `sanitize_env_name` reaches 2 of ~30 env-setting sites.** `credentials.rs:894`
and `mcp_tools.rs:1764`. Everything else calls `cmd.env(k, v)` directly. The guard is
a function, and a function is a thing you can forget.

**B4 — `force_subscription_auth` is correct and has been reimplemented once.**
`fleet/pty.rs:404-411` applies the same reserved list by hand because `portable-pty`'s
`CommandBuilder` is not a `tokio::process::Command`; the comment says so, and records
that it was found *"in a live PoF pass: fleet CLIs stuck at OAuth because the key
leaked through."* One list, two appliers, no shared type.

### C — working directory

**C1 — the containment check for `claude --dangerously-skip-permissions` returns
nothing, so the spawn uses the unvalidated string.** `validate_fleet_cwd_in_db`
(`approval_exec_fleet.rs:1052`) canonicalises the cwd, rejects non-directories, and
requires containment under a canonicalised registered project root — genuinely good,
and its doc comment explains why it was split out (*"a second hand-written copy of
this check is the exact way a containment boundary rots"*). It returns
`Result<(), AppError>`. `approval_exec_fleet.rs:1105` then passes
`std::path::PathBuf::from(cwd)` — the raw string — to `pty::spawn_session`. **7 call
sites inherit the pattern.**

**C2 — 71 of 125 sites inherit the app's cwd.** For a desktop process that is not a
meaningful directory. `git`-family sites are the ones that matter; `git_ops.rs:25,58`
do set it, `competitions.rs:593,602` do not.

### D — streams, timeouts, teardown

**D1 — 87 of 125 sites have neither a timeout nor `kill_on_drop`.** 19 of those are
`.spawn()` sites holding a live `Child`, including `fleet/headless.rs:124` (a
`claude --dangerously-skip-permissions` session), `webbuild/devserver.rs:71` (`bun`,
which spawns `next`/node), `connector_readiness.rs:383,390`, `ocr/mod.rs:579,596` and
`ffmpeg.rs:883,950`.

**D2 — 75 of 125 sites configure no stdio at all**, so all three streams are
inherited. `pipeline_executor.rs:597-633` is the sharpest: it configures nothing while
its own comment at `:614-616` claims `wait_with_output` drains both pipes, so every
pipeline node's captured output is empty.

**D3 — two sites pipe a stream nobody drains, and one drains sequentially.**
`memory_reflection.rs:338` pipes stderr and never takes it (only the `:384` timeout
escapes). `healthcheck.rs:249-260` reads stdout to EOF *then* stderr to EOF — bounded
by a deadline, so it degrades to a false "timed out" verdict.

**D4 — the repo's two statements of the pipe capacity differ by 16× and neither is
right.** `cli_process.rs:566` says *"the ~4 KB pipe buffer"*; `verification_command.rs:65-70`
says *"more than the ~64KB pipe buffer"*. **Measured on this box: a child stalls at
84 KB of undrained stdout** (Experiment 2). The number is runtime-specific and the
point is that it is *tens of kilobytes* — a fraction of a second of a chatty CLI —
so "it will probably fit" is never the plan.

**D5 — 54 `child.kill()` sites, 15 followed by a `wait()`.** On POSIX the rest leave a
zombie for the life of the app.

**D6 — one blocking `std::process` call inside an `async fn`:** `ai_artifact_flow.rs:572`.

### E — the credential loop this path is upstream of

**E1 — the spawn side of `structured-logging.md`'s P0.** The chain, end to end and all
in this repo: `runner/credentials.rs` decrypts connector fields and pushes them into
`CliArgs.env_overrides` → `cli_process.rs:611` applies them to the child → the child is
the Claude CLI in stream-JSON mode, which reads files and runs `curl` on the user's
behalf → `runner/mod.rs:2173` writes **every stdout line verbatim** into a
per-execution log capped only at 10 MB, and `:2614` does the same for stderr. That
corpus is **2,999 files / 410.5 MB, oldest 130 days** as measured by
`structured-logging.md:12-13,314` — the sink was masked on 2026-08-14
(`engine/src/logger.rs:61`, *"this masks NEW writes only"*) and the read path was not.
**This path owns only the first arrow**, and the fix here is B1: a child that never
received a credential it did not need cannot echo one. *(Brief correction: the
"3,018 files / 410 MB" figure is `secret-display-and-transfer.md:338`, measured a day
later; `structured-logging.md` measured 2,999 / 410.5 MB. The two documents also
disagree on the Google-API-key file count — 26 vs 13 — and neither reconciles it.)*

### F — orphans

**F1 — zero job objects, zero process groups, zero persisted child PIDs.** Confirmed
by grep over all 963 files for `AssignProcessToJobObject`, `CreateJobObject`,
`CREATE_BREAKAWAY_FROM_JOB`, `CREATE_NEW_PROCESS_GROUP`, `setsid`, `process_group`,
`pre_exec`, `start_new_session`, `killpg`: **0 hits.** The only Windows creation flags
in use are cosmetic or actively *worsening*: 54 × `CREATE_NO_WINDOW`, 3 ×
`DETACHED_PROCESS` (`whisper.rs:175`, `kokoro.rs:256`, `pocket.rs:399` — which
explicitly detaches the child from the console, for a conhost flash), 1 ×
`CREATE_NEW_CONSOLE` (`fleet/external.rs:173`).

**F2 — app exit reaches one subsystem.** `lib.rs:3737` on `RunEvent::Exit` calls
`state.webbuild_servers.stop_all()` and nothing else — the same finding as
[`cancelling-in-flight-work.md`](./cancelling-in-flight-work.md) T7 and
[`background-loop.md`](./background-loop.md) S1, from the process side. **And even a
complete exit hook would not close F1**, because a crash, a `taskkill` on the app, an
OOM kill or a power loss runs no hook at all. That is the case a job object covers and
nothing else does.

**F3 — the one recovery path in the repo depends on a third party writing the PID
file.** `clear_stale_next_lock` (`devserver.rs:244`) works only because Next.js writes
`.next/dev/lock`. Personas persists no child PID of its own, so nothing at boot can
find, verify or reap a `claude`, `npx`, MCP server, Playwright browser or ffmpeg left
over from a previous run.

---

## Experiments (run 2026-08-15, Windows 11 Pro 10.0.26200, this operator's box)

**Experiment 1 — does a grandchild survive its parent's death, and does the repo's
tree-kill still reach it?** Two arms plus a control.

| Parent runtime | Spawn mode | Grandchild after a single-PID `taskkill /F` on the parent |
|---|---|---|
| Node 24 (libuv) | default | **dies** |
| Node 24 (libuv) | `detached: true` | **survives** |
| **PowerShell `[Diagnostics.Process]::Start` — a plain `CreateProcess`, the same call Rust's `std`/`tokio` make** | n/a | **survives indefinitely** |

In the surviving case the orphan's `ParentProcessId` still reads the dead parent's
PID, and `taskkill /F /T /PID <dead parent>` — the exact command `engine::kill_process`
(`engine/mod.rs:1698`) runs on Windows — **fails with `ERROR: The process "31052" not
found`**. The orphan was reachable only by its own PID, which nothing had recorded.

**This inverts the natural assumption that orphaning is what Windows does.** It is
what *this runtime* does. libuv creates a job object per process and assigns children
to it unless `detached` is set, so a Node parent's children die with it; Rust's
`std::process` issues a bare `CreateProcess` and they do not. **Personas' backend is
Rust and gets the worse default; Personas' own build, codegen and test scripts are
Node and get the better one — which is exactly why this never showed up in the
tooling.** It also means the fix is known-good and cheap: one job object at startup,
one `AssignProcessToJobObject` in `build_and_spawn_core`.

**Experiment 2 — how much undrained output wedges a child?** A child writing 1 KB at a
time to a piped stdout that nobody reads **stalls at 86,016 bytes (84 KB)** and never
exits; the drained control passed 4 MB and exited. See D4.

**Experiment 3 — does passing a value as a separate argv element protect it from
`cmd /C`?** Command lines built with Rust's exact Windows quoting rules:

| Built command line | Child received | Verdict |
|---|---|---|
| `cmd.exe /C echo harmless-%PERSONAS_EXP_SECRET%-tail` | `harmless-SENSITIVE-VALUE-1234-tail` | **`%VAR%` expanded** |
| `findstr.exe /C:harmless-%PERSONAS_EXP_SECRET%-tail …` (direct binary) | the literal, unexpanded | safe |
| `cmd.exe /C echo "a\" & echo INJECTED & rem \"b"` | `a"` **then `INJECTED` executed** | **chained** |

The third row is the important one: `\"` is the MSVCRT escape Rust emits and
`cmd.exe` does not honour it, so a single `"` inside an otherwise-separated argument
re-opens command chaining. **Separating your arguments does not sandbox them if the
program is a shell.**

---

## Gaps in the primitives

1. **There is no job-object / process-group primitive at all.** Nothing in the repo can express "this child dies when I do, whatever kills me". Every existing mechanism — `kill_on_drop`, `kill_process`, `Drop` guards, eight cancel registries — presupposes a running parent, and Experiment 1 shows what that is worth. **The single highest-value change in this document.**
2. **`CliProcessDriver` does not own the environment.** It applies `env_removals`/`env_overrides` on top of a full inherit; `env_clear()` is not reachable through `CliArgs` at all, so the 11 sites that use the driver *cannot* bound their child's environment even if they wanted to.
3. **`validate_mcp_command` is `fn` (private) in a 2,100-line module and has 1 call site.** It is the only program allowlist in the repo, and `dev_tools_run_tests`, `pipeline_executor`, `kpi_eval` and `connector_readiness` each accept a program/command from configuration with nothing equivalent.
4. **`sanitized_env()` and `resolve_safe` are both `pub(crate)` in `commands/`, invisible to `engine/`.** The two crates that spawn most of the children cannot reach either guard.
5. **`validate_fleet_cwd` returns `()`.** See "Prefer a type over a gate" #1.
6. **No spawn helper takes a timeout.** Every one of the 35 timed sites wires its own `tokio::time::timeout` + kill by hand, and the other 90 did not. `CliProcessDriver` has `collect_lines_with_timeout` for the *read*, and nothing for the *process*.
7. **No shared outcome type.** `VerificationResult { passed, exit_code: Option<i32>, output_tail, timed_out }` is the right shape and exists at exactly one site; 42 sites model the outcome as "whatever was on stdout".
8. **No test spawns a child and asserts what happened to it.** `cli_process.rs:790` (child environment) and the `read_line_within` silence-vs-EOF pair (`:846-920`) are excellent and are the only ones. Nothing tests a timeout kill, an orphan, a full pipe, or a nonzero exit.
9. **The stdin write path has no primitive.** `cli_process.rs:372` writes the prompt from a detached task to avoid the deadlock, and `cli_runner.rs:737` and `revitalize.rs:280` each reimplement it with their own comment explaining the same hazard.
10. **`personas-core` has no `process` module.** Everything in this document that should be shared — program resolution, the env allowlist, the outcome type, the job object — has no crate to live in that all of `src/`, `engine/` and `commands/` can see.

## Convergence check — `brainiac`, `personas-cloud`, `vibeman`

Read-only oracle sweep. Per the contract: a mechanic reinvented elsewhere is physics;
one with no trace anywhere should be suspected of local calibration. Convergence
measures **discoverability**, not whether a requirement is real.

| | brainiac | personas-cloud | vibeman |
|---|---|---|---|
| stack | Rust, axum + Postgres | Node orchestrator + worker, Python facade | Next.js 16 + better-sqlite3 |
| spawn sites | **0** | 2 | **52** |
| shell-string sites | 0 | 1 (a constant `where claude` probe) | **32**, 9+ interpolated |
| network-reachable injection | 0 | 0 | **1 confirmed** |
| job object / process group | — | **none** | POSIX group at **1 of 4** eligible sites |

**Independently reinvented — treat as physics:**

1. **Strip the inherited API-account auth and the CLI's own nesting markers before spawning it. Three repos, three implementations, no shared document.** Personas: `force_subscription_auth` (`cli_process.rs:45`) + `CLAUDE_NESTING_ENV` (`fleet/pty.rs:414`). personas-cloud: `delete childEnv['CLAUDECODE']` (`executor.ts:124`) + `envRemovals.push('ANTHROPIC_API_KEY')` (`shared/prompt.ts:495-505`). vibeman: `delete env.ANTHROPIC_API_KEY` (`cli-service.ts:387`, `:1168`) + `delete baseEnv.CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` (`:315-316`). Each records a different symptom (silent API billing; nested-session confusion; an OAuth dead-end) and each arrived at the same act. **The strongest convergence in this document.**
2. **Inherit-then-subtract is what everyone does, and everyone regrets a piece of it.** All three build the child env from the parent's. personas-cloud is the only one that then *bounds* it: `sanitizeEnvVars` (`worker/validation.ts:11-48`) rejects `NODE_*` / `LD_*` / `DYLD_*` / `BASH_*` / `PATH` / `HOME` and **returns `rejected` alongside `safe` so the caller learns what was stripped** — a refinement `sanitize_env_name` lacks (it logs a `warn!` and drops).
3. **A per-execution isolated `HOME`.** personas-cloud redirects `HOME`/`USERPROFILE` into a per-execution directory (`executor.ts:129-131`, built at `cleanup.ts:39-58`) *specifically* to stop concurrent executions racing on credential files. Personas has no analogue and runs concurrent CLI children against one real home. This is the one mechanic in the sweep that Personas should simply adopt.
4. **Validate the cwd, resolve it, and contain it under a root.** personas-cloud `ensureContainedPath` (`validation.ts:110-125`), vibeman `validateProjectPath` (used at `gitManager.ts:22-25` via `pathCheck.resolved`), Personas `validate_fleet_cwd_in_db`. **Two of the three use the resolved value; Personas discards it** (C1) — and vibeman is unevenly applied (`buildScanService.ts:228` passes `projectPath || process.cwd()` straight through).
5. **A tree-kill helper, because a single-PID kill orphans the compiler.** vibeman `killProcessTree.ts:17-36` and `buildScanner.ts:193-203`; Personas `kill_process` and `devserver.rs:218`. vibeman's comment names the exact symptom Personas' `taskkill /T` exists for: *"buildProcess.kill() reaped only the shell, orphaning the heavy compiler (pins CPU/RAM, holds file locks)."*

**The controlled-experiment shape — found four times, two of them inside Personas.**

- **`vibeman`, three copies of one function.** `executeBuildCommand` exists three times. `buildScanner.ts:181-227` sets `detached: !isWindows` (a POSIX process group), tree-kills, and clears its timer on both `close` and `error`, with the bug written in its comment. `buildScanService.ts:241-246` and `file-fixer/route.ts:274-279` set `detached: false`, kill with a bare `SIGTERM`→`SIGKILL`, and never clear the timer. Same repo, same code, one fixed.
- **`vibeman`, the same two git commands.** `git/branches/route.ts:59` uses `execFileAsync('git', ['rev-parse', …], { timeout: 5000 })`; `lifecycle/detect/route.ts:34` uses `execAsync('git rev-parse --abbrev-ref HEAD')` — shell string, no timeout. Repeated for `git status --porcelain`.
- **Personas, inside one file, 40 lines apart:** `kpi_eval.rs`'s free-text shell string for `codebase` against its whitelisted catalog for `derived` SQL (A5).
- **Personas, inside one subsystem:** `auth_detect.rs:431` and `cli_capture.rs:631` clear the environment and add back an allowlist, with the reason inline; the other 123 sites inherit everything. **Two authors of one module got it right and it propagated to nobody**, which is the same shape as vibeman's `commandSandbox.ts` (a documented sandbox whose header says *"All spawn/exec calls should route through this module"* — **2 importers out of ~50 sites**) and personas-cloud's `buildCliArgs` (a complete argv+env spawn contract at `shared/prompt.ts:457` with **zero call sites**). **The failure mode across all three repos is not ignorance. It is that the correct version was written and not routed to.**

**Where convergence contradicts me — reported honestly.**

- **The job object has no convergence at all. Four repos, zero.** Not one of brainiac, personas-cloud, vibeman or Personas uses `AssignProcessToJobObject`, and only vibeman uses a POSIX process group (at 1 of 4 eligible sites). By the oracle's letter, "bind the child's lifetime to an OS primitive that outlives your process" is **local calibration — a mechanism nobody discovered.** I am keeping it as the headline anyway, and here is the argument, which is about the *problem* rather than the mechanism: the **requirement** is convergent even though the mechanism is not. vibeman independently discovered the orphan problem twice — once as `detached: !isWindows` with the failure mode in a comment, once as persist-the-PID-at-spawn plus `reapOrphanedProcesses()` at boot (`orphanReaper.ts`, called from `schema.postinit.ts:8-10`) — and Personas discovered it once, as `clear_stale_next_lock`. Three independent reinventions of *compensating for* orphans; zero of *preventing* them. That pattern is what an undiscovered primitive looks like, not what an unreal requirement looks like. **A porting repo should take clause 3 of the principle and re-derive its own mechanism** — and if it cannot, it should at least take vibeman's fallback, which Personas lacks: write the child's PID down and reap it at next boot with an identity check.
- **`%VAR%`-expansion-through-`cmd /C` has no trace anywhere else, because nobody else spawns `cmd /C` with a non-literal.** personas-cloud reaches `cmd` only through `shell: true` on a Windows fallback with a constant probe; vibeman's shell strings go to the platform default shell. Mark A3/A4 as Windows-and-Rust-specific calibration: a sibling must ask "what does *my* interpreter re-parse", not inherit `%`.
- **brainiac spawns nothing, and that is a real bound on this whole document.** No `Command::new`, no `tokio::process`, no `child_process`, anywhere in an 8-crate workspace — even its git publishing writes files and leaves committing to CI. **A golden path about spawning has nothing to say to a service like that**, and step 1 exists because of it.
- **Exit-code discipline is weakly convergent and Personas is not the worst.** vibeman's `optimize/route.ts:61-66` treats `rg`'s exit 1 as a valid empty result and `executeCommand.ts:267` throws on nonzero unless `acceptNonZero`; personas-cloud's `executor.ts:270-271` documents why exit code wins a timeout/exit race. But **no site in any of the three repos inspects the `signal` half of a child's termination.** Personas' `verification_command.rs` — with `exit_code: Option<i32>` and a separate `timed_out` — is the closest any of the four gets, which makes contract rule 5 a house convention with three siblings' silence behind it.

## The missing gate

Nothing gates any of this. Every deviation above shipped under a green
`npm run check`, `cargo clippy -- -D warnings` and `cargo test`.

### The semantic condition, and the one I refuse to gate

There are two conditions worth enforcing here, and only one of them a census rule can
honestly express.

**Condition 1 — a value the app did not author becomes syntax for an interpreter.**
Gated below.

**Condition 2 — a child's lifetime is not bounded by anything that survives the
parent's death.** **I refuse to gate this, and the refusal is the finding.** The
correct assertion is *"the count of spawn helpers that do not assign the child to a
job object / process group must be zero"*, and `scripts/census/lib/engine.mjs:264-273`
cannot express "must be zero" — it treats a zero-match rule as a broken matcher and
fails structurally, by design. A ratchet is also the wrong instrument: the fix is
**one** change in **one** helper that corrects all 125 sites at once, so a
count-the-callers gate would report 125 → 125 → 0 and never once have caused the fix.
Per the contract's fifth failure mode, a gate on *reaching a destination* is only as
good as the destination's defaults; here the destination does not exist yet.
**The instrument is a Rust integration test in `personas-engine`**, and Experiment 1
is its specification: spawn a helper-created child that itself spawns a grandchild,
record both PIDs, terminate the *parent test process's* spawn helper by dropping its
job handle, and assert the grandchild is gone. That test fails today, fails for the
right reason, and passes the moment the job object lands — which is exactly what a
count cannot do.

**The signal below is a manifestation.** It keys on Rust's `Command::new("cmd"|"sh")`
idiom because that is the shape condition 1 wears here. A sibling must re-derive its
own proxy by asking: *what is the interpreter on this stack, what does it re-parse,
and which call sites hand it something the app did not write?* In personas-cloud the
proxy would be `shell: true` on a `spawn` whose args are not all literals (**1** site,
constant, would report clean); in vibeman it would be `execSync`/`execAsync` with a
template literal (**9+** sites, one network-reachable) — a different regex for the
same condition. In brainiac the condition is unrepresentable.

**Preconditions this signal depends on, stated so they can be checked before porting:**
(a) the shell is invoked as a *program name* rather than a flag on a spawn API;
(b) the flag and its payload sit within ~400 characters of the `Command::new`;
(c) the compliant form is distinguishable by the payload being a string literal.
None is semantic, which is why the `floor`, the zero-match assertion and the positive
control are load-bearing.

### Census rules (validated)

Do **not** paste these into `scripts/census/rules.json` yourself — the orchestrator
merges them. Validated standalone against `scripts/census/run-census.mjs` at
`02fe37134`: **963 files walked, 5 files / 8 matches, 5/5 precision** (`git_ops.rs:124,130`,
`kpi_eval.rs:189,193`, `pipeline_executor.rs:598,602`, `connector_readiness.rs:383`,
`ocr/mod.rs:579`); positive control **1 file / 1 match**; runner exits 0.
**Known false negative: `mcp_tools.rs:2048`**, whose `for part in &parts { c.arg(part); }`
loop form the pattern cannot reach — deliberately left uncaught, because that site's
argv shape is as correct as `cmd /C` allows and its actual defect is the `%` gap in
`SHELL_METACHARACTERS` (A3), which is a two-character const edit, not an argv problem.

```json
[
  {
    "id": "shell-vehicle-nonliteral-arg",
    "goldenPath": "docs/concepts/golden-paths/spawning-a-cli-subprocess.md",
    "title": "A shell interpreter is spawned with an argument that is not a string literal",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "Command::new\\s*\\(\\s*\"(?:cmd|sh|bash|powershell|pwsh|zsh)\"\\s*\\)(?:(?!Command::new)[\\s\\S]){0,400}?\"(?:/[Cc]|-c|-Command)\"\\s*(?:,|\\)\\s*\\.\\s*args?\\s*\\()\\s*(?!\")[&A-Za-z_]",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a shell interpreter (cmd/sh/bash/powershell) is spawned and its command slot receives a value that is not a string literal — so a string the app did not author is parsed by a shell. Measured on Windows 2026-08-15: this is NOT made safe by passing the value as a separate argv element, because cmd.exe re-parses the built command line and expands %NAME% out of the child's environment — the same environment into which this app injects decrypted connector credentials — and Rust's MSVCRT-style \\\" escaping does not survive cmd.exe's quote parser, so an embedded double quote re-opens command chaining"
    },
    "exclude": [
      {
        "path": "src-tauri/engine/src/verification_command.rs",
        "reason": "the operator-shell primitive itself: its module doc (:11-13) declares the trust boundary in prose — 'The command is operator-authored (a persona verification_command parameter), so it inherits the host environment like any dev tool — it is trusted input, unlike untrusted agent output.' A declared and reviewed exception is exactly what this allowlist is for; every other shell vehicle in the tree declares nothing."
      }
    ],
    "baseline": { "files": 5, "matches": 8 },
    "floor": 900
  },
  {
    "id": "shell-vehicle-nonliteral-arg-positive-control",
    "goldenPath": "docs/concepts/golden-paths/spawning-a-cli-subprocess.md",
    "title": "POSITIVE CONTROL — the compliant form: a shell vehicle whose command slot is a string literal",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "Command::new\\s*\\(\\s*\"(?:cmd|sh|bash|powershell|pwsh|zsh)\"\\s*\\)(?:(?!Command::new)[\\s\\S]){0,400}?\"(?:/[Cc]|-c|-Command)\"\\s*(?:,|\\)\\s*\\.\\s*args?\\s*\\()\\s*\"",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "POSITIVE CONTROL. Same anchors as shell-vehicle-nonliteral-arg, pointed at the COMPLIANT shape: a shell vehicle whose command slot is a literal the app authored (auto_cred_browser.rs:1471). It must keep matching; if it drops to zero the anchors have stopped reaching real spawn code and the violation rule's silence means nothing."
    },
    "floor": 900
  }
]
```

**The allowlist is the doctrine.** `exclude` requires a prose `reason`, and this rule
is designed so that the only way to legitimately spawn a shell with a non-literal is
to write down whose string it is and why they are trusted — the artifact
`verification_command.rs:11-13` already produced by hand, and the one
[`command-input-validation.md`](./command-input-validation.md) §7.C observed was
missing everywhere else.

### A third census rule — `process-spawn-outside-chokepoint`

**Read the refusal above before this one, because they are adjacent and only one
of them is refused.** Condition 2 — *a child's lifetime is not bounded by
anything that survives the parent's death* — stays refused, for the reason given:
its fix is **one** change in **one** helper that corrects all 125 sites at once,
so a count-the-callers ratchet would read 125 → 125 → 0 and never once have
caused the fix. That argument is about a defect whose repair lives entirely
inside the chokepoint. **It does not transfer to the population that never
reaches the chokepoint at all**, whose repair is per-site by construction: you
route this spawn through `CliProcessDriver`, and the count moves by one. A
ratchet is the right instrument for exactly that shape.

> **Condition 3 — a child process is created by code that has not agreed to any
> of the guarantees the application makes about child processes.**

This is "The one way" restated as a count. `build_and_spawn_core`
(`cli_process.rs:576`) is where a child gets its argv as an array, its stdio
decided on all three streams with the deadlock reason written down, its
`kill_on_drop(true)` with the billing reason written down, its `current_dir`,
its `CREATE_NO_WINDOW`, and its `env_removals` → `env_overrides` →
`force_subscription_auth` sequence. **The driver has 9 files / 16 call sites.
138 spawns across 58 files do not go through it**, and each of those 138
independently re-decides — usually by omission — every one of those properties.
The population table above is the itemised bill: 97 inherit the whole
environment, 71 inherit the cwd, 75 configure no stdio at all, 87 have neither a
timeout nor `kill_on_drop`, 42 never read the exit status.

**This rule is the parent of two already registered, and the relationship is
worth stating so nobody thinks it is a duplicate.** `unbound-child-lifetime`
(12 files / 13 matches, owned by
[`cancelling-in-flight-work.md`](./cancelling-in-flight-work.md)) and
`wholesale-inherited-child-env` (10 / 13, owned by
[`credential-injection-into-child.md`](./credential-injection-into-child.md))
each gate **one property** of a spawn — a missing `kill_on_drop`, a missing
`env_clear`. Both are subsets of this population, and both go to zero the moment
their one property is added *without the spawn ever moving*. This rule asks the
prior question, and it is the only one of the three that falls when a call site
adopts the driver and therefore inherits all of the properties at once.

**Precision 13/13**, on a systematic sample opened by hand (every 11th site):
`db/src/lib.rs:1667` (`icacls`), `commands/artist/mod.rs:124`
(`TokioCommand::new("blender")`), `commands/fleet/external.rs:156`
(`std::process::Command::new(&program)`), `commands/ocr/mod.rs:580`,
`engine/build_session/fix_pass.rs:205`, `webbuild/versions.rs:26` — every one a
real process spawn. **The spelling vocabulary was enumerated exhaustively rather
than sampled**: exactly four spellings exist in this tree —
`std::process::Command::new` (46), `tokio::process::Command::new` (39), bare
`Command::new` (38) and the `TokioCommand::new` alias (15) — summing to 138.
This is the number that punishes a careless matcher: **an anchor with a
lookbehind forbidding a preceding colon scores 43**, missing every qualified
call, a 3.2× undercount that reads as "mostly clean".

**Two independent implementations agree at 58 files / 138 matches** — the census
engine and a hand-written walker sharing no code with it. Four further matches
sit on comment-only lines and are correctly not counted, and five more sit inside
the excluded chokepoint itself (143 total).

```json
{
  "rules": [
    {
      "id": "process-spawn-outside-chokepoint",
      "goldenPath": "docs/concepts/golden-paths/spawning-a-cli-subprocess.md",
      "title": "A child process is spawned outside the one module that owns argv separation, env scrubbing, stdio, timeouts and kill-on-drop",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\b(?:[A-Za-z_][A-Za-z0-9_]*)?Command::new\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "Command::new( in any of its four spellings -- bare, std::process::, tokio::process::, or the TokioCommand alias -- anywhere outside engine/src/cli_process.rs. PROXY FOR the stack-free condition: a process is created by code that has not agreed to any of the guarantees the application makes about child processes, so whatever the chokepoint does for spawns that go through it simply does not happen for this one. CONCRETELY HERE cli_process.rs:576 build_and_spawn_core is where a child gets its argv as an ARRAY, its stdio decided on all three streams with the deadlock reason written down (:565-567), its .kill_on_drop(true) with the billing reason written down (:584-589), its current_dir, its CREATE_NO_WINDOW and its env_removals -> env_overrides -> force_subscription_auth sequence. COMPLIANT SHAPE: build a CliArgs (core/src/types.rs:287) and hand it to the driver -- 9 files / 16 call sites. VIOLATING SHAPE: commands/fleet/external.rs:156 `let mut cmd = std::process::Command::new(&program);`. The 138 outside inherit the app's whole environment (97 of 125 production sites), its cwd (71), configure no stdio at all (75), have NEITHER a timeout NOR kill_on_drop (87), and never read the exit status (42) -- the itemised population table is in this path's Deviations section. RELATIONSHIP TO TWO REGISTERED SIBLINGS, declared: unbound-child-lifetime (12/13) and wholesale-inherited-child-env (10/13) each gate ONE property of a spawn -- a missing kill_on_drop, a missing env_clear -- and each goes to zero when that one property is added WITHOUT THE SPAWN EVER MOVING. Both are subsets of this population. This rule asks the prior question and is the only one of the three that falls when a call site adopts the driver and inherits all the properties at once. NOT THE REFUSED RULE: this path refuses to gate child LIFETIME (job objects / process groups) because that fix is one change in one helper correcting 125 sites at once, so a ratchet would read 125 -> 125 -> 0 and never cause the fix. That argument does not transfer here: a spawn that never reaches the chokepoint is repaired per-site, one count at a time. MEASURED 2026-08-21 at b7fba447f: 138 matches across 58 of 963 files, plus 5 inside the excluded chokepoint (143 total) and 4 on comment-only lines correctly skipped. PRECISION 13/13 on a systematic hand-opened sample (every 11th site), all real process spawns. The SPELLING vocabulary was enumerated EXHAUSTIVELY rather than sampled: exactly four forms exist -- std::process::Command::new 46, tokio::process::Command::new 39, bare Command::new 38, TokioCommand::new 15. RECALL, and the number that punishes a careless matcher: an anchor with a lookbehind forbidding a preceding colon scores 43, missing every qualified call -- a 3.2x undercount that reads as 'mostly clean'. KNOWN FALSE-POSITIVE SURFACE, stated rather than papered over: the alias arm accepts ANY identifier ending in Command, so a future clap::Command::new (an argument parser, not a process) would count. No such type exists in this tree today; if one arrives, tighten the alternation to the aliases actually in use rather than baselining the noise. PRECONDITION (must be re-derived per repo): this repo spawns children through std/tokio Command and has ONE module that owns the policy. A repo that shells out through a library wrapper, or that has no chokepoint at all, has the same condition wearing different syntax. LEGAL FIX: build a CliArgs and route the spawn through cli_process.rs. If it needs a shape the chokepoint does not offer, WIDEN THE CHOKEPOINT rather than opening a second door -- and do not silence a match by wrapping Command::new in a local helper, which moves the match without moving the guarantees."
      },
      "exclude": [
        {
          "path": "src-tauri/engine/src/cli_process.rs",
          "reason": "the chokepoint itself — this file IS where argv separation, env scrubbing, stdio, timeouts, PID recording and kill-on-drop live, so it must call Command::new"
        }
      ],
      "baseline": { "files": 58, "matches": 137 },
      "floor": 900
    }
  ]
}
```

> **Ratcheted 138 -> 137 on 2026-08-22, and the file count deliberately did NOT move.**
> `personas-core` had two `icacls` spawns — `crypto.rs`'s `restrict_file_permissions`
> and its `repair_key_file_permissions`. Both now go through a single private
> `run_icacls` in the new `core/src/fs_private.rs`, so `crypto.rs` leaves the
> violating set and `fs_private.rs` enters it: **58 files either way, one fewer
> spawn site.**
>
> **This is the move this rule explicitly warns against ("do not silence a match by
> wrapping `Command::new` in a local helper"), so it needs the distinction stated.**
> The warning is about relocating a spawn to make a counter drop while the
> guarantees stay absent. Here two spawn sites became one — the count fell because
> a call to `Command::new` genuinely stopped existing, not because it moved.
>
> **What it is NOT: routing through the chokepoint.** `personas-core` is the
> dependency-free foundation crate and `cli_process` lives in `personas-engine`, so
> core structurally cannot reach it; the legal fix this path prescribes is
> unavailable here without inverting the crate graph. `fs_private::run_icacls` is
> therefore core's own one-function chokepoint, with fixed argv, no env, no stdin
> and no caller-supplied program name. The remaining 137 are unaffected.


**One `exclude`, and it is the chokepoint.** Nothing else is exempt: the two
sites this path *does* trust with a shell — `verification_command.rs`, whose
module doc declares its trust boundary in prose — are trusted about the
*interpreter*, not about argv, stdio or teardown, so they belong in this count
like everything else. **`floor: 900`** against 963 walked `.rs` files, matching
every other `src-tauri`-rooted rule including `shell-vehicle-nonliteral-arg`
above.

**End of life: this rule falls, it does not reach zero.** `db/src/lib.rs:1667`
runs `icacls` on a database file at init; `webbuild/versions.rs:26` shells out
to `git` at build time. Neither wants a CLI-session driver. A residue is correct
here, and the ratchet's job is the 138, not the last one.

### What the census cannot cover, and what should carry it instead

| Condition | Instrument |
|---|---|
| a child outlives the app (F1/F2/F3) | a `personas-engine` integration test per Experiment 1 — **must be zero**, which the census cannot express |
| a child inherits an unbounded environment (B1) | make `env_clear()` + allowlist the driver default; then a test that asserts a spawned child's env contains no key outside the allowlist — the shape of `cli_process.rs:790` already exists |
| a validated path is discarded (C1) | the type change in "Prefer a type over a gate" #1; nothing to count once the signature returns `PathBuf` |
| an exit status is ignored (42 sites) | not gateable — `.output()` returning `Output` whose `.status` is unread is a use-site question, and a regex on `.output()` would fire on all 84 including the 42 correct ones. **A gate that fires on correct content is worse than no gate.** |
| `SHELL_METACHARACTERS` omits `%` and `"` (A3) | a unit test next to the existing 5 in `mcp_tools.rs:1929-1988`, asserting `validate_mcp_command("npx pkg-%APPDATA%").is_err()` |
