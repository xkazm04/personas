#!/usr/bin/env node
// Register / remove / inspect the daily build-hygiene task.
//
//   npm run hygiene:install      # schtasks /Create /F … — idempotent
//   npm run hygiene:uninstall    # schtasks /Delete /F …
//   node scripts/hygiene/install-task.mjs --status
//   node scripts/hygiene/install-task.mjs --install --time 04:30
//
// The task is named PersonasBuildHygiene, runs daily (12:30 unless --time) as the
// CURRENT user at the default (limited) run level — no elevation, no stored
// password — and executes
//     cmd /c cd /d "<repo root>" && "<node>" "<repo>/scripts/hygiene/run-daily.mjs"
// so the repo root is the working directory. `/F` makes a second install
// overwrite the first instead of failing, which is the whole idempotency story.
//
// WHY schtasks AND NOT A NODE DAEMON / NPM HOOK
// The guard already covers "when a build runs". The gap is "when nothing runs
// through npm" — agents calling cargo directly, days of no dev server. Only the
// OS scheduler fires then, and schtasks needs no dependency and no admin.
//
// WHY 12:30 AND NOT THE SMALL HOURS
// A task created with `schtasks /Create /SC DAILY` does NOT run late if the
// machine was asleep at the trigger time — it is simply missed. On a laptop a
// 04:30 task may never fire at all, so the default is mid-day, when the machine
// is normally awake; the reaper refuses live targets, so running during work is
// safe. Run-when-missed needs the XML form (`/XML` with StartWhenAvailable). It
// was NOT built: it could not be tested without registering a task in the real
// scheduler, and an untested installer for an unattended deleter is worse than a
// documented limit. `--time HH:MM` overrides.
//
// The schtasks runner is injectable: tests assert the exact argv and never touch
// the real scheduler.

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TASK_NAME = "PersonasBuildHygiene";
export const DEFAULT_TIME = "12:30";

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF), "..", "..");

export function taskCommand({ repoRoot = REPO_ROOT, nodePath = process.execPath } = {}) {
  const script = join(repoRoot, "scripts", "hygiene", "run-daily.mjs");
  return `cmd /c cd /d "${repoRoot}" && "${nodePath}" "${script}"`;
}

export function installArgv({ time = DEFAULT_TIME, repoRoot, nodePath } = {}) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`--time must be HH:MM (24 h), got "${time}"`);
  const tr = taskCommand({ repoRoot, nodePath });
  // schtasks rejects a /TR longer than 261 characters with an unhelpful error.
  if (tr.length > 261) throw new Error(`task command is ${tr.length} chars; schtasks /TR allows 261. Install from a shorter path.`);
  return ["/Create", "/F", "/TN", TASK_NAME, "/SC", "DAILY", "/ST", time, "/RL", "LIMITED", "/TR", tr];
}

export function uninstallArgv() {
  return ["/Delete", "/F", "/TN", TASK_NAME];
}

export function statusArgv() {
  return ["/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"];
}

/** Default runner: the real schtasks.exe. Returns { code, stdout, stderr }. */
export function realSchtasks(argv) {
  try {
    const stdout = execFileSync("schtasks", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: typeof e.status === "number" ? e.status : 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? e.message) };
  }
}

/**
 * @param {"install"|"uninstall"|"status"} action
 * @returns {{ code:number, argv:string[]|null, message:string }}
 */
export function run(action, { platform = process.platform, runner = realSchtasks, time, repoRoot, nodePath } = {}) {
  if (platform !== "win32") {
    const script = join(repoRoot ?? REPO_ROOT, "scripts", "hygiene", "run-daily.mjs");
    return {
      code: 0, argv: null,
      message: `not supported on this platform; add a cron entry: 30 12 * * * cd "${repoRoot ?? REPO_ROOT}" && node "${script}"`,
    };
  }
  if (action === "install") {
    const argv = installArgv({ time, repoRoot, nodePath });
    const r = runner(argv);
    return r.code === 0
      ? { code: 0, argv, message: `installed: ${TASK_NAME} runs daily at ${time ?? DEFAULT_TIME}. Inspect: node scripts/hygiene/install-task.mjs --status   History: npm run hygiene:log` }
      : { code: r.code, argv, message: `schtasks /Create FAILED (exit ${r.code}): ${(r.stderr || r.stdout).trim()}` };
  }
  if (action === "uninstall") {
    const argv = uninstallArgv();
    const r = runner(argv);
    if (r.code === 0) return { code: 0, argv, message: `removed: ${TASK_NAME}` };
    // Distinguish "was not there" (fine) from "could not delete" (not fine).
    const q = runner(statusArgv());
    return q.code !== 0
      ? { code: 0, argv, message: `${TASK_NAME} is not installed — nothing to remove` }
      : { code: r.code, argv, message: `schtasks /Delete FAILED (exit ${r.code}) and the task still exists: ${(r.stderr || r.stdout).trim()}` };
  }
  if (action === "status") {
    const argv = statusArgv();
    const r = runner(argv);
    return r.code === 0
      ? { code: 0, argv, message: r.stdout.trim() }
      : { code: 0, argv, message: `${TASK_NAME} is NOT installed (npm run hygiene:install)` };
  }
  throw new Error(`unknown action "${action}"`);
}

const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && samePath(resolve(process.argv[1]), SELF)) {
  const args = process.argv.slice(2);
  const action = args.includes("--install") ? "install"
    : args.includes("--uninstall") ? "uninstall"
    : args.includes("--status") ? "status" : null;
  if (!action) {
    process.stderr.write("usage: install-task.mjs --install [--time HH:MM] | --uninstall | --status\n");
    process.exit(2);
  }
  const ti = args.indexOf("--time");
  try {
    const r = run(action, { time: ti >= 0 ? args[ti + 1] : undefined });
    (r.code === 0 ? process.stdout : process.stderr).write(r.message + "\n");
    process.exit(r.code);
  } catch (e) {
    process.stderr.write(`install-task: ${e.message}\n`);
    process.exit(2);
  }
}
