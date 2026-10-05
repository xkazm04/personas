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

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";
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
