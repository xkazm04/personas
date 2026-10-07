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
 * FAIL OPEN, LOUDLY — the guard-concurrent-cargo.mjs precedent. If priority
 * cannot be set or the process table cannot be read, print one line and run the
 * build anyway: the cost of a false block is a developer who cannot compile,
 * the cost of a false allow is the CPU spike this merely mitigates.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
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

export function runCargo({ args = [], cwd = ROOT, env = {}, label = "cargo" } = {}) {
  // STUB (WP0): pass-through, no throttle and no queue yet. The signature, the
  // env names and the exit-code semantics above are final — WP1 fills in the
  // priority call, the job cap and the queue without changing any of them.
  console.log(`[cargo-run:${label}] stub pass-through — no throttle yet`);
  const r = spawnSync("cargo", args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  return r.status ?? 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf("--");
  const labelIdx = argv.indexOf("--label");
  const label = labelIdx >= 0 ? argv[labelIdx + 1] : "cargo";
  const args = sep >= 0 ? argv.slice(sep + 1) : argv.filter((a, i) => i !== labelIdx && i !== labelIdx + 1);
  process.exit(runCargo({ args, label }));
}
