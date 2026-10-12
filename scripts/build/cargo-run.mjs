#!/usr/bin/env node
/**
 * The one door every cargo invocation this repo launches goes through.
 *
 * WHY THIS EXISTS. Nothing capped cargo here: every build took all 12 cores at
 * normal priority, so one compile made the desktop unusable and two concurrent
 * sessions made the machine unusable. Measured on this host
 * (docs/development/build-memory.md): one `cargo build --lib` peaks at 6,583 MB
 * in a SINGLE rustc, and `-j 2` bought only 12% of that back for 8% more wall
 * time — so the fix for "the PC freezes" is not fewer jobs, it is *lower
 * priority* plus never letting two builds overlap.
 *
 * THE CONTRACT (frozen before the builders fanned out; callers depend on it):
 *
 *   import { runCargo } from "./cargo-run.mjs";
 *   const code = runCargo({ args, cwd, env, label });   // → cargo's exit code
 *
 *   node scripts/build/cargo-run.mjs [--label <s>] -- <cargo args...>
 *
 *   args   string[]  cargo's own argv, WITHOUT the leading "cargo"
 *   cwd    string?   defaults to the repo root
 *   env    object?   merged over process.env
 *   label  string?   one word for the status line, e.g. "dev" | "sidecar" | "test"
 *
 * ENVIRONMENT. Absent means default, and an EMPTY STRING MEANS ABSENT:
 *
 *   CARGO_FULL_SEND=1     skip the throttle AND the queue (unattended full speed)
 *   CARGO_GUARD=off       skip the queue only (keep the throttle)
 *   PERSONAS_CARGO_JOBS   explicit job count, overrides the computed default
 *   RUSTC_WRAPPER         set by ensure-sccache.mjs; this file NEVER clobbers it
 *
 * CI DOES NOT COME THROUGH HERE. CI calls cargo directly and must keep all of
 * its cores; routing it through this wrapper would slow every pipeline to
 * protect a desktop that does not exist on a runner.
 *
 * WHAT IT DOES, in this order, before cargo is ever spawned:
 *
 *   1. JOB CAP — `--jobs max(2, cpus - RESERVED_CORES)` (10 of 12 here), passed
 *      as a cargo ARGUMENT and not as CARGO_BUILD_JOBS, so the number is visible
 *      in the status line and in anything that reads the command line. If the
 *      caller already passed --jobs/-j we leave their number alone; if the
 *      invocation has no job-capable subcommand (`cargo --version`,
 *      `cargo metadata`) we add nothing, because cargo rejects --jobs there.
 *
 *   2. PRIORITY — `os.setPriority(process.pid, BELOW_NORMAL)` on THIS node
 *      process, before the spawn. Windows children inherit the priority class at
 *      creation, so cargo and every rustc under it come up at below-normal
 *      without us ever having to find their pids; that is what makes it
 *      race-free. `cmd /c start /low` was measured on this host and did NOT
 *      lower the class (the child reported `Normal`) — do not re-derive it.
 *
 *   3. THE QUEUE — poll for a live cargo.exe / rustc.exe and WAIT for it. It
 *      never refuses, and it has NO TIMEOUT. That is safe because the check is
 *      stateless and process-based: a crashed cargo leaves no lock to go stale,
 *      so the queue drains the instant the holder dies (do not add a lockfile —
 *      this repo has a documented habit of guards that outlive their subject).
 *      Its predecessor, guard-concurrent-cargo.mjs, *refused* the second cargo,
 *      which made a parallel agent session fail its gate on a race: waiting
 *      costs wall time, refusing costs a whole run. Enumeration is per-image
 *      `tasklist /FI "IMAGENAME eq ..."` — a bare `tasklist` hangs under this
 *      repo's process count (scripts/cache-budget.mjs:90 records it) and
 *      spawning powershell.exe every 2 s to ask CIM the same question costs more
 *      than the poll itself. POSIX keeps the `pgrep` path. An invocation that
 *      compiles nothing (`cargo --version`, `metadata`, `tree`, `fmt`) is not
 *      queued at all: it costs no cores, so waiting would be a pure penalty —
 *      and the hook that covers hand-typed cargo commands has always matched
 *      only build|check|test|clippy|bench for the same reason.
 *
 * FAIL OPEN, LOUDLY — the guard-concurrent-cargo.mjs precedent. If priority
 * cannot be set or the process table cannot be read, print one line and run the
 * build anyway: the cost of a false block is a developer who cannot compile,
 * the cost of a false allow is the CPU spike this merely mitigates. The three
 * mechanisms degrade INDEPENDENTLY — an unreadable process table disables the
 * queue and says so, it does not also throw away the job cap, which needs no
 * process table and is strictly good for the machine either way.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cpus, getPriority, setPriority } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Reserved for the desktop, so a build never takes the last core. */
export const RESERVED_CORES = 2;
/** node's priority scale is -20..19; 10 is Windows BELOW_NORMAL. Verified: children inherit it. */
export const BELOW_NORMAL = 10;

/** An env var that is unset OR empty is absent. Callers must not distinguish the two. */
export const envFlag = (name) => {
  const v = process.env[name];
  return v !== undefined && v !== "";
};

/** How often the queue looks at the process table. */
const POLL_MS = 2_000;
/** How often it says so. One line per 15 s, NOT one per poll. */
const ANNOUNCE_MS = 15_000;
/**
 * The two images that mean "a compile is in flight". rustc counts: cargo exits last, but a
 * cargo that has already handed off still has rustc children burning every core.
 */
const COMPILER_IMAGES = ["cargo.exe", "rustc.exe"];
/** Subcommands that accept --jobs. `cargo --version` and `cargo metadata` do not. */
const JOB_CAPABLE = new Set(["build", "check", "test", "clippy", "bench", "run", "doc", "rustc", "fix"]);

/**
 * Where `ensure-sccache.mjs` leaves the env it provisioned. Gitignored scratch.
 *
 * WHY A FILE AND NOT AN IMPORT. A child process cannot write its parent's environment, and an
 * npm `pre*` script is a SEPARATE PROCESS from the script it precedes — so `npm run ensure:sccache`
 * can never wrap the `tauri dev` that follows it. Measured 2026-10-07: with only that route,
 * `RUSTC_WRAPPER` was defended here but never SET by anything, so sccache would have wrapped
 * exactly nothing while looking entirely installed. This read is what closes that gap.
 *
 * It is deliberately SYNCHRONOUS and offline: `runCargo`'s contract returns an exit code, so it
 * cannot await, and provisioning (a download, a server start) must never happen inside a build.
 * `ensure-sccache.mjs` owns provisioning; this only adopts what it already wrote. Writing
 * `~/.cargo/config.toml` or `setx` was declined by that package for good reason — it would wrap
 * EVERY cargo on the machine and break them all the day the binary moves.
 */
const SCCACHE_HANDOFF = join(ROOT, ".claude", ".sccache-env.json");

/**
 * Adopt a previously provisioned sccache into this process's env. Never overrides a wrapper the
 * caller already set, never throws, and says one line when it declines — a cache that is silently
 * absent is the failure mode this whole file exists to avoid.
 */
function adoptSccacheFromHandoff(label) {
  if (envFlag("RUSTC_WRAPPER")) return; // the caller's choice wins, always
  let bin;
  try {
    const { env: handoff } = JSON.parse(readFileSync(SCCACHE_HANDOFF, "utf8"));
    bin = handoff?.RUSTC_WRAPPER;
    if (!bin) return;
    // The binary can be gone (a cleaned ~/.cargo/bin) while the handoff survives. Pointing
    // RUSTC_WRAPPER at a missing exe fails EVERY rustc invocation, so verify before adopting.
    if (!existsSync(bin)) {
      warnOnce("sccache-missing", `[cargo-run:${label}] sccache was provisioned at ${bin} but the file is gone — building unwrapped; run \`npm run ensure:sccache\`.`);
      return;
    }
    process.env.RUSTC_WRAPPER = bin;
    if (handoff.SCCACHE_CACHE_SIZE && !envFlag("SCCACHE_CACHE_SIZE")) {
      process.env.SCCACHE_CACHE_SIZE = handoff.SCCACHE_CACHE_SIZE;
    }
  } catch {
    // No handoff yet is the ordinary state before anyone runs ensure:sccache. Not a warning:
    // an unwrapped build is correct and complete, just colder. The status line reports
    // `wrapper=none`, which is where this becomes visible.
  }
}

/** One warning per failure mode per process — "loudly" means one line, not a loop. */
const warned = new Set();
const warnOnce = (key, line) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(line);
};

/**
 * A synchronous sleep. runCargo's contract is synchronous (it RETURNS cargo's exit code),
 * so the queue cannot be a promise; Atomics.wait is the only sync sleep node offers.
 */
const SLEEP_SLOT = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms) => {
  Atomics.wait(SLEEP_SLOT, 0, 0, ms);
};

/**
 * Live compilers, or null if the process table could not be read.
 *
 * null is NOT "nothing is running" — the caller must treat it as "could not check", which is
 * the whole reason this returns a sentinel instead of an empty array. "Could not check" is
 * never "clean" (scripts/cache-budget.mjs holds the same line).
 */
export function liveCompilers(excludePids = new Set()) {
  if (process.platform !== "win32") {
    // Unchanged from scripts/build/bench.mjs. pgrep exits 1 when nothing matches, which is
    // an answer and not a failure.
    const r = spawnSync("pgrep", ["-l", "^(cargo|rustc)$"], { encoding: "utf8", timeout: 15_000 });
    if (r.error || (r.status !== 0 && r.status !== 1)) return null;
    return (r.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [pid, image] = line.trim().split(/\s+/);
        return { pid: Number(pid), image: image ?? "cargo" };
      })
      .filter((p) => Number.isInteger(p.pid) && !excludePids.has(p.pid));
  }
  const hits = [];
  for (const image of COMPILER_IMAGES) {
    const r = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    if (r.error || r.status !== 0) return null;
    // A filter matching nothing prints "INFO: No tasks are running ..." and still exits 0,
    // so the row regex — not the exit code — is what distinguishes empty from broken.
    for (const line of (r.stdout || "").split(/\r?\n/)) {
      const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
      if (!m) continue;
      const pid = Number(m[2]);
      if (!excludePids.has(pid)) hits.push({ pid, image: m[1] });
    }
  }
  return hits;
}

/**
 * Wait until no other compile is in flight. Returns
 *   { state: "free" | "waited" | "degraded" | "aborted", waitedMs }
 * and never throws. "degraded" means the process table could not be read.
 *
 * SIGINT aborts OUR wait and nothing else: this function sends no signal to anybody, ever —
 * the holder belongs to another session. The abort is observed between polls, so Ctrl-C
 * lands within POLL_MS instead of instantly; a blocking Atomics.wait cannot run the handler.
 */
export function waitForCargoSlot({ label = "cargo", excludePids, log = console.error } = {}) {
  // We are node, so we can never be a cargo.exe hit ourselves; the pids that matter are a
  // parent cargo (a build script calling back into this repo's scripts) and anything we
  // spawned — and we always wait BEFORE spawning, so there is nothing of ours yet.
  const exclude = excludePids ?? new Set([process.pid, process.ppid].filter(Boolean));
  const startedAt = Date.now();
  let aborted = false;
  const onSigint = () => {
    aborted = true;
  };
  process.on("SIGINT", onSigint);
  try {
    let lastAnnounce = 0;
    for (;;) {
      const live = liveCompilers(exclude);
      if (live === null) {
        warnOnce(
          "table",
          `[cargo-run:${label}] DEGRADED: could not read the process table — the queue is off for this run; ` +
            "a concurrent cargo will NOT be waited for.",
        );
        return { state: "degraded", waitedMs: Date.now() - startedAt };
      }
      if (live.length === 0) {
        const waitedMs = Date.now() - startedAt;
        if (lastAnnounce) log(`[cargo-run:${label}] slot free after ${Math.round(waitedMs / 1000)}s — starting`);
        return { state: lastAnnounce ? "waited" : "free", waitedMs };
      }
      const now = Date.now();
      // Announce on first sight — otherwise the first 15 s are indistinguishable from a hang —
      // and then once per ANNOUNCE_MS, never once per poll.
      if (lastAnnounce === 0 || now - lastAnnounce >= ANNOUNCE_MS) {
        lastAnnounce = now;
        const holder = live[0];
        const others = live.length > 1 ? ` (+${live.length - 1} more)` : "";
        log(
          `[cargo-run:${label}] waiting ${Math.round((now - startedAt) / 1000)}s for ${holder.image} ` +
            `PID ${holder.pid}${others} — no timeout; Ctrl-C to abort, CARGO_FULL_SEND=1 to skip`,
        );
      }
      sleepSync(POLL_MS);
      if (aborted) {
        log(`[cargo-run:${label}] wait aborted after ${Math.round((Date.now() - startedAt) / 1000)}s (SIGINT)`);
        return { state: "aborted", waitedMs: Date.now() - startedAt };
      }
    }
  } finally {
    // Leaving this installed would swallow the Ctrl-C that is meant for cargo itself.
    process.removeListener("SIGINT", onSigint);
  }
}

/** Where cargo's subcommand sits in args, allowing a leading `+toolchain`; -1 if there is none. */
function subcommandIndex(args) {
  const i = args[0]?.startsWith("+") ? 1 : 0;
  return i < args.length && !args[i].startsWith("-") ? i : -1;
}

const callerSetJobs = (args) =>
  args.some((a) => a === "--jobs" || a === "-j" || a.startsWith("--jobs=") || /^-j\d+$/.test(a));

/** The computed cap, and the one-phrase reason for the status line. */
function jobCap() {
  if (envFlag("PERSONAS_CARGO_JOBS")) {
    const raw = process.env.PERSONAS_CARGO_JOBS.trim();
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n > 0) return { jobs: n, why: "PERSONAS_CARGO_JOBS" };
    warnOnce("jobs", `[cargo-run] ignoring PERSONAS_CARGO_JOBS="${raw}" — not a positive integer.`);
  }
  const total = cpus().length;
  return { jobs: Math.max(2, total - RESERVED_CORES), why: `${total} cores - ${RESERVED_CORES} reserved` };
}

/**
 * args with the cap spliced in after the subcommand, plus what to print about it, plus
 * whether this invocation compiles at all.
 *
 * `compiles` is what the queue is keyed on, not merely the job cap. `cargo --version`,
 * `cargo metadata`, `cargo tree` and `cargo fmt` cost no cores, so making them wait behind a
 * 490-second build would be a pure penalty — and it would break the one-liner every script
 * here uses to check that the toolchain exists. The same set answers both questions because
 * it is the same property: a subcommand that accepts --jobs is a subcommand that compiles.
 */
function withJobCap(args) {
  const i = subcommandIndex(args);
  const sub = i >= 0 ? args[i] : null;
  const compiles = sub !== null && JOB_CAPABLE.has(sub);
  if (!compiles) return { args, compiles, note: `n/a (${sub ? `${sub} does not compile` : "no subcommand"})` };
  if (callerSetJobs(args)) return { args, compiles, note: "caller's own --jobs" };
  const { jobs, why } = jobCap();
  return {
    args: [...args.slice(0, i + 1), "--jobs", String(jobs), ...args.slice(i + 1)],
    compiles,
    note: `${jobs} (${why})`,
  };
}

export function runCargo({ args = [], cwd = ROOT, env = {}, label = "cargo" } = {}) {
  const fullSend = envFlag("CARGO_FULL_SEND");
  const guardOff = envFlag("CARGO_GUARD") && /^(off|0|false|no)$/i.test(process.env.CARGO_GUARD.trim());

  const capped = fullSend ? { args, compiles: false, note: "uncapped (CARGO_FULL_SEND)" } : withJobCap(args);
  const queueThis = !fullSend && !guardOff && capped.compiles;

  // Priority before the status line, so the line reports the class we actually GOT rather
  // than the one we asked for — and before anything is spawned, which is the whole trick.
  let priority = 0;
  let restoreTo = null;
  if (!fullSend) {
    try {
      restoreTo = getPriority(process.pid);
      setPriority(process.pid, BELOW_NORMAL);
      priority = getPriority(process.pid);
    } catch (err) {
      restoreTo = null;
      warnOnce(
        "priority",
        `[cargo-run:${label}] DEGRADED: could not lower priority (${err?.message ?? err}) — ` +
          "building at normal priority.",
      );
    }
  }

  adoptSccacheFromHandoff(label);

  const wrapper = envFlag("RUSTC_WRAPPER") ? basename(process.env.RUSTC_WRAPPER) : "none";
  const queueMode = fullSend
    ? "off (CARGO_FULL_SEND)"
    : guardOff
      ? "off (CARGO_GUARD=off)"
      : capped.compiles
        ? "on"
        : "n/a (nothing to compile)";
  console.log(
    `[cargo-run:${label}] jobs=${capped.note} priority=${priority}${priority === BELOW_NORMAL ? "/below-normal" : ""}` +
      ` wrapper=${wrapper} queue=${queueMode}`,
  );

  const restorePriority = () => {
    if (restoreTo === null) return;
    try {
      setPriority(process.pid, restoreTo);
    } catch {
      // Best effort. Failing to climb back is not worth a second warning line: the build
      // either already ran or never will, and this process is about to exit either way.
    }
  };

  if (queueThis && waitForCargoSlot({ label }).state === "aborted") {
    restorePriority();
    return 130; // 128 + SIGINT, the shell convention. Our wait died; the holder was never touched.
  }

  // Merge, then re-assert RUSTC_WRAPPER: a caller handing us an env object that happens to
  // carry `RUSTC_WRAPPER: undefined` must not be able to unset sccache behind its back.
  const childEnv = { ...process.env, ...env };
  if (envFlag("RUSTC_WRAPPER") && !childEnv.RUSTC_WRAPPER) childEnv.RUSTC_WRAPPER = process.env.RUSTC_WRAPPER;

  try {
    const r = spawnSync("cargo", capped.args, {
      cwd,
      stdio: "inherit",
      env: childEnv,
      shell: process.platform === "win32",
    });
    if (r.error) {
      console.error(`[cargo-run:${label}] failed to launch cargo: ${r.error.message}`);
      return 1;
    }
    return r.status ?? 1;
  } finally {
    // The child inherited the class at creation, so handing this process back to normal
    // afterwards changes nothing for the build — it only stops a long-lived caller
    // (ensure-mcp-sidecar, run-rust-tests) from staying slow for the rest of its life.
    restorePriority();
  }
}

// Run as a CLI only when THIS file is the entry point. The test is an absolute-path
// identity, never a basename suffix: the frozen stub shipped
// `import.meta.url.endsWith(basename(process.argv[1]))`, and
// `"…/cargo-run.mjs".endsWith("run.mjs")` is TRUE — so merely *importing* this module
// from `scripts/devlog/run.mjs` fired this block, spawned cargo with devlog's own argv
// and exited. `npm run tauri:dev` died with
// `running the file src-tauri/tauri.lite.conf.json requires -Zscript`, and
// `npm run test:devlog` went red, for any caller whose basename ends in `run.mjs`.
// Caught 2026-10-07 by the package that imports it; same guard shape as
// `scripts/dev/ensure-mcp-sidecar.mjs`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf("--");
  const labelIdx = argv.indexOf("--label");
  const label = labelIdx >= 0 ? argv[labelIdx + 1] : "cargo";
  const args = sep >= 0 ? argv.slice(sep + 1) : argv.filter((a, i) => i !== labelIdx && i !== labelIdx + 1);
  process.exit(runCargo({ args, label }));
}
