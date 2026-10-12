#!/usr/bin/env node
// The `tauri:dev*` wrapper: runs `tauri dev <args>` with its output piped
// through this process byte for byte, and records the toolchain's diagnostics
// into `<logs>/toolchain.YYYY-MM-DD.jsonl` on the side.
//
//   node scripts/devlog/run.mjs [tauri dev args...]
//
// - Output: every chunk is written to our stdout/stderr unchanged (ANSI kept).
//   Piping would make cargo drop its colours, so when our stdout is a terminal
//   the child gets CARGO_TERM_COLOR=always / FORCE_COLOR=1 / CLICOLOR_FORCE=1
//   unless already set (DEVLOG_COLOR=0 opts out). The ones the wrapper set are
//   listed in PERSONAS_DEVLOG_FORCED_ENV, and the app removes them at the top
//   of main(), so only the toolchain sees them.
// - Session: PERSONAS_DEVLOG_SESSION=<uuid> goes to the child; the app's
//   boot.start records it, joining the app boot to this toolchain session.
// - Ctrl+C: the console already delivers it to the whole child tree, so the
//   wrapper waits for tauri to wind down; if it is still alive after 3 s the
//   wrapper forwards the signal, and after 8 s kills the tree. SIGTERM is
//   forwarded at once. The child's exit code is propagated.
// - Logging failure never stops the dev server: one stderr warning, then inert.
// - DEVLOG_CHILD="node path/to/fake.mjs" replaces the tauri command (tests).
//
// The child is `node <@tauri-apps/cli>/tauri.js dev ...` rather than `npx
// tauri dev`: same CLI, no shell (so no quoting hazard and no EINVAL spawning a
// .cmd on Windows), and the PID we signal is tauri itself.
//
// CARGO THROTTLE. `tauri dev` spawns cargo ITSELF, so this wrapper cannot route
// it through scripts/build/cargo-run.mjs the way every other cargo call site in
// the repo now is. It instead sets the same two things the wrapper sets, by the
// only two mechanisms that reach a grandchild: `os.setPriority` on this process
// (children inherit the Windows priority class) and `CARGO_BUILD_JOBS` in the
// child environment, which is the env form of cargo's `--jobs` and the only way
// to cap a cargo you do not spawn. CARGO_FULL_SEND=1 skips both; an explicit
// PERSONAS_CARGO_JOBS or a pre-set CARGO_BUILD_JOBS wins.

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";
// BLOCKED ON A ONE-LINE FIX IN THE IMPORTED FILE, and this import is the only
// place in the repo that trips it. cargo-run.mjs's CLI entry guard is a SUFFIX
// match on the entry script's basename:
//     import.meta.url.endsWith(process.argv[1].split("/").pop())
// `".../cargo-run.mjs".endsWith("run.mjs")` is TRUE, so merely importing it from a
// process whose entry is THIS file fires its CLI block, which spawns a real cargo
// with devlog's own argv and process.exit()s. Measured: `npm run tauri:dev` dies
// with `error: unexpected argument '--features' found`, and two scripts/devlog
// tests go red on a byte-identical-output assertion. The same file is imported
// cleanly by ensure-mcp-sidecar.mjs and run-rust-tests.mjs, whose basenames do
// not collide — this is purely a name collision, not a contract problem. The fix
// belongs in cargo-run.mjs and is the guard ensure-mcp-sidecar.mjs:94 already
// uses: `path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`.
// The import is deliberately left correct rather than worked around here: a
// substring match that answers "does this text appear" instead of "is this the
// entry module" will misfire again, and papering over it in this file would hide
// it from the next caller.
import { BELOW_NORMAL, RESERVED_CORES, envFlag } from "../build/cargo-run.mjs";
import { makeRecord } from "./lib/envelope.mjs";
import { REPO_ROOT, resolveLogsDir } from "./lib/paths.mjs";
import { createLineSplitter, createToolchainParser } from "./lib/toolchain-parser.mjs";
import { JsonlWriter, pruneDaily } from "./lib/writer.mjs";

const GRACE_MS = 3000;
const FORCE_MS = 8000;

function gitSha(cwd) {
  try {
    const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8", timeout: 3000, windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The command to run: [executable, ...args]. */
export function childCommand(args, env = process.env) {
  if (env.DEVLOG_CHILD) {
    const parts = env.DEVLOG_CHILD.split(/\s+/).filter(Boolean);
    if (parts[0] === "node") parts[0] = process.execPath;
    return [...parts, ...args];
  }
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  const cli = require.resolve("@tauri-apps/cli/tauri.js");
  return [process.execPath, cli, "dev", ...args];
}

function killTree(child, signal) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      child.kill(signal);
    }
  } catch {
    /* already gone */
  }
}

/**
 * The cargo throttle for a cargo this process does not spawn.
 *
 * Returns the environment additions for the child, and lowers THIS process's
 * priority as a side effect (the child and its cargo/rustc grandchildren inherit
 * the Windows priority class). Both halves are skipped under CARGO_FULL_SEND.
 *
 * `CARGO_BUILD_JOBS` rather than `--jobs` because the cargo being capped is three
 * processes away: node -> tauri CLI -> cargo. cargo-run.mjs deliberately uses the
 * ARGUMENT form so the number is visible on the command line; here there is no
 * command line to put it on, and the env var is cargo's own documented equivalent
 * (`--jobs` on the CLI still beats it, and `tauri dev` passes none). An explicit
 * PERSONAS_CARGO_JOBS (the wrapper's own override name) sets the number, and a
 * CARGO_BUILD_JOBS the operator already exported is left exactly as it is.
 *
 * The priority is NOT restored afterwards, unlike in cargo-run.mjs: this process
 * lives exactly as long as the dev server it is relaying, and everything under it
 * — cargo, rustc, and the Vite server `beforeDevCommand` starts — should stay
 * below-normal for that whole time. That is the point.
 *
 * @param {object} env the environment the child will be given
 * @param {(line: string) => void} log one-line reporter
 * @returns {Record<string, string>} additions for the child env
 */
export function cargoThrottleEnv(env = process.env, log = () => {}) {
  if (envFlag("CARGO_FULL_SEND")) {
    log("[devlog] CARGO_FULL_SEND set - cargo runs unthrottled at full speed");
    return {};
  }
  // `os.cpus().length` and `max(2, …)` to match cargo-run.mjs's jobCap() exactly:
  // two commands that claim the same throttle must not report different numbers.
  const cores = os.cpus().length;
  // No `??` fallback on the env read: `envFlag` has already decided unset-vs-empty
  // (an empty string IS absent, per the wrapper's contract), so the override is read
  // only inside the branch that proved it is there. The census rule
  // `env-default-conflates-unset-with-empty` fires on the `??` form and is right to.
  let jobCount = Math.max(2, cores - RESERVED_CORES);
  if (envFlag("PERSONAS_CARGO_JOBS")) {
    const n = Number.parseInt(process.env.PERSONAS_CARGO_JOBS.trim(), 10);
    if (Number.isInteger(n) && n > 0) jobCount = n;
  }
  const jobs = String(jobCount);

  let priority = "normal (unchanged)";
  try {
    os.setPriority(process.pid, BELOW_NORMAL);
    priority = "below-normal";
  } catch (err) {
    // FAIL OPEN, LOUDLY - cargo-run.mjs's own rule. A developer who cannot launch
    // the app is a worse outcome than one unthrottled compile.
    log(`[devlog] could not lower priority (${err?.message ?? err}); staying at normal priority`);
  }

  const preset = env.CARGO_BUILD_JOBS !== undefined && env.CARGO_BUILD_JOBS !== "";
  log(
    `[devlog] cargo throttle: priority ${priority}, CARGO_BUILD_JOBS=` +
      `${preset ? `${env.CARGO_BUILD_JOBS} (preset, kept)` : jobs} of ${cores} cores ` +
      `(CARGO_FULL_SEND=1 opts out)`,
  );
  return preset ? {} : { CARGO_BUILD_JOBS: jobs };
}

/**
 * Run the wrapped command. Resolves with the exit code once the child has
 * exited and the toolchain log is flushed.
 * @param {{ args?: string[], env?: object, logsDir?: string, onExit?: () => void,
 *           stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} opts
 */
/** At most this many `devlog.capture_error` records per session. */
const MAX_CAPTURE_ERRORS = 20;

function openRaw(logsDir, sessionId, errOut) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const file = path.join(logsDir, `toolchain-raw.${sessionId}.log`);
    const stream = fs.createWriteStream(file, { flags: "a" });
    stream.on("error", () => {});
    errOut.write(`[devlog] raw child output -> ${file}\n`);
    return stream;
  } catch {
    return null;
  }
}

export async function runWrapped(opts = {}) {
  const args = opts.args ?? [];
  const env = { ...process.env, ...(opts.env ?? {}) };
  const out = opts.stdout ?? process.stdout;
  const errOut = opts.stderr ?? process.stderr;
  const sessionId = randomUUID();
  const logsDir = opts.logsDir ?? resolveLogsDir(undefined, env);
  const startedAt = Date.now();
  const writer = new JsonlWriter(logsDir, { warn: (m) => errOut.write(m + "\n") });
  pruneDaily(logsDir, "toolchain", 7);
  // DEVLOG_RAW=1 also keeps every line the child printed (ANSI intact) in
  // `toolchain-raw.<session>.log`, for when the parser misses something.
  const raw = env.DEVLOG_RAW === "1" ? openRaw(logsDir, sessionId, errOut) : null;

  // One bad line, or one record that cannot be built, costs that line and
  // never the session. Both used to switch capture off for good: a tauri dev
  // run that built and booted the app wrote nothing after session.start
  // (2026-10-05). Failures are recorded, bounded, so the digest shows them.
  let failures = 0;
  const noteFailure = (stage, err, line) => {
    failures += 1;
    if (failures > MAX_CAPTURE_ERRORS) return;
    try {
      writer.write(
        makeRecord({
          lvl: "WARN",
          tgt: "devlog",
          msg: "devlog.capture_error",
          src: "toolchain",
          boot: sessionId,
          f: {
            stage,
            error: String(err?.message ?? err).slice(0, 300),
            line: line === undefined ? undefined : String(line).slice(0, 300),
            n: failures,
          },
        }),
      );
    } catch {
      /* the writer itself is gone; its own fail() already said so */
    }
  };
  const record = (draft) => {
    let rec;
    try {
      rec = makeRecord({ ...draft, src: "toolchain", boot: sessionId });
    } catch (err) {
      noteFailure("record", err, draft?.msg);
      return;
    }
    writer.write(rec);
  };

  const [cmd, ...cmdArgs] = childCommand(args, env);
  const childEnv = { ...env, PERSONAS_DEVLOG_SESSION: sessionId };
  // Skipped when DEVLOG_CHILD replaces the tauri command: that is the test hook,
  // and a fake child compiles nothing worth throttling (nor should a `node --test`
  // run quietly drop its own priority).
  if (!env.DEVLOG_CHILD) {
    Object.assign(childEnv, cargoThrottleEnv(env, (m) => errOut.write(m + "\n")));
  }
  if (out.isTTY && env.DEVLOG_COLOR !== "0") {
    const forced = [];
    for (const [key, value] of [["CARGO_TERM_COLOR", "always"], ["FORCE_COLOR", "1"], ["CLICOLOR_FORCE", "1"]]) {
      if (!childEnv[key]) {
        childEnv[key] = value;
        forced.push(key);
      }
    }
    // The app removes exactly these at the top of main(), so the CLIs it
    // spawns and parses never inherit a colour the operator did not ask for.
    if (forced.length) childEnv.PERSONAS_DEVLOG_FORCED_ENV = forced.join(",");
  }

  record({
    lvl: "INFO",
    tgt: "devlog",
    msg: "session.start",
    f: {
      script: env.npm_lifecycle_event,
      args,
      cwd: process.cwd(),
      node: process.version,
      git_sha: gitSha(REPO_ROOT),
      child: env.DEVLOG_CHILD ? env.DEVLOG_CHILD : "tauri dev",
    },
  });

  const state = { viteReady: false };
  const safeParse = (fn, line) => {
    try {
      fn();
    } catch (err) {
      noteFailure("parse", err, line);
    }
  };

  const child = spawn(cmd, cmdArgs, { cwd: process.cwd(), env: childEnv, stdio: ["inherit", "pipe", "pipe"], windowsHide: false });

  const pipe = (stream, target) => {
    const parser = createToolchainParser({ emit: record, state });
    const splitter = createLineSplitter((line) => {
      raw?.write(line + "\n");
      safeParse(() => parser.line(line), line);
    });
    const decoder = new StringDecoder("utf8");
    stream.on("data", (chunk) => {
      if (!target.write(chunk)) {
        stream.pause();
        target.once("drain", () => stream.resume());
      }
      safeParse(() => splitter.push(decoder.write(chunk)));
    });
    return new Promise((resolve) => {
      stream.on("end", () => {
        safeParse(() => {
          splitter.push(decoder.end());
          splitter.end();
          parser.flush();
        });
        resolve();
      });
      stream.on("error", () => resolve());
    });
  };
  const drained = Promise.all([pipe(child.stdout, out), pipe(child.stderr, errOut)]);

  let interrupted = null;
  const timers = [];
  const onSigint = () => {
    if (interrupted) return;
    interrupted = "SIGINT";
    timers.push(setTimeout(() => (process.platform === "win32" ? killTree(child) : killTree(child, "SIGINT")), GRACE_MS));
    timers.push(setTimeout(() => killTree(child, "SIGKILL"), FORCE_MS));
  };
  const onSigterm = () => {
    interrupted = "SIGTERM";
    killTree(child, "SIGTERM");
    timers.push(setTimeout(() => killTree(child, "SIGKILL"), FORCE_MS));
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  process.on("SIGBREAK", onSigint);

  const exit = await new Promise((resolve) => {
    child.on("error", (err) => {
      errOut.write(`[devlog] failed to launch ${cmd}: ${err.message}\n`);
      resolve({ code: 1, signal: null });
    });
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  // A grandchild holding the pipe open (or a failed spawn) must not hang the exit.
  await Promise.race([drained, new Promise((r) => setTimeout(r, 2000).unref())]);
  for (const t of timers) clearTimeout(t);
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  process.off("SIGBREAK", onSigint);

  const exitCode = exit.code ?? (exit.signal === "SIGINT" || interrupted === "SIGINT" ? 130 : exit.signal ? 143 : 1);
  record({
    lvl: "INFO",
    tgt: "devlog",
    msg: "session.end",
    f: { exit_code: exitCode, duration_ms: Date.now() - startedAt, signal: exit.signal ?? interrupted ?? undefined, records: writer.written + 1 },
  });
  await writer.close();
  raw?.end();
  opts.onExit?.();
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runWrapped({ args: process.argv.slice(2) }).then((code) => process.exit(code));
}
