#!/usr/bin/env node
/**
 * Build measurement harness.
 *
 *   npm run bench:build -- --scenario rust-check-touch-lib --variant baseline
 *   npm run bench:build -- --list
 *
 * Every number this repo quotes about build cost should come from here. One run
 * appends ONE row to docs/development/build-ledger.jsonl, and the row carries its
 * own predicate: which scenario, which variant, which host, which toolchain,
 * which commit. A figure that travels without those is unusable — cold and
 * incremental differ by an order of magnitude.
 *
 * "Could not measure" is not a number. If another cargo/rustc is live the
 * harness refuses and exits 2 rather than record a contended figure; if the
 * measured command fails, it exits 1 and records nothing.
 *
 * Rust scenarios use --lib so a running dev app holding personas-desktop.exe
 * cannot fail the measurement. They are WARM by design: run once with
 * --warmup to build dependencies, which is never recorded.
 *
 * --root <path> measures another checkout (e.g. the main checkout's warm
 * target from inside a worktree). The ledger is always written beside THIS
 * script's checkout.
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF_ROOT = resolve(HERE, "..", "..");
const LEDGER = join(SELF_ROOT, "docs", "development", "build-ledger.jsonl");
const SAMPLER = join(HERE, "sample-build-memory.ps1");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ROOT = resolve(opt("root", SELF_ROOT));
const TAURI = join(ROOT, "src-tauri");
const FEATURES = opt("features", "desktop");
const LEAF = "src/commands/infrastructure/system/storage.rs";

const touch = (rel) => () => {
  const p = join(TAURI, rel);
  if (!existsSync(p)) throw new Error(`touch target missing: ${p}`);
  const now = new Date();
  utimesSync(p, now, now);
};
const cargo = (...a) => ({ cmd: "cargo", args: [...a, "--manifest-path", join(TAURI, "Cargo.toml"), "--features", FEATURES], sample: true });
const npm = (...a) => ({ cmd: process.platform === "win32" ? "npm.cmd" : "npm", args: a, cwd: ROOT, shell: true });
const node = (...a) => ({ cmd: process.execPath, args: a, cwd: ROOT });

/** Scenario ids are wire-level: the ledger, the docs and the campaign ratchet all key on them. */
const SCENARIOS = {
  "rust-check-warm": { kind: "rust", note: "no change; fingerprint walk only", run: cargo("check", "--lib") },
  "rust-check-touch-lib": { kind: "rust", note: "touch src/lib.rs (generate_handler!) then check", before: touch("src/lib.rs"), run: cargo("check", "--lib") },
  "rust-check-touch-leaf": { kind: "rust", note: `touch ${LEAF} then check`, before: touch(LEAF), run: cargo("check", "--lib") },
  "rust-build-lib-warm": { kind: "rust", note: "touch src/lib.rs then dev build of the lib", before: touch("src/lib.rs"), run: cargo("build", "--lib") },
  "fe-codegen": { kind: "fe", note: "predev codegen preset", run: node("scripts/run-codegen.mjs", "predev") },
  "fe-check": { kind: "fe", note: "npm run check (all gates)", run: npm("run", "check") },
  // The three gates that dominate fe-check once check:tiers is set aside. fe-tsc is cold or warm
  // depending on tsconfig.tsbuildinfo, and fe-eslint on the full-run cache: say which in --note.
  // fe-eslint runs `npm run lint` rather than a spelled-out eslint line so the row always measures
  // the cache location the repo actually uses, before and after that location changes.
  "fe-tsc": { kind: "fe", note: "npx tsc --noEmit (TS 6 API compiler)", run: { cmd: "npx", args: ["tsc", "--noEmit"], cwd: ROOT, shell: true } },
  "fe-tsc-native": { kind: "fe", note: "npm run typecheck:native (tsgo); pair with fe-tsc", run: npm("run", "typecheck:native") },
  "fe-eslint": { kind: "fe", note: "npm run lint (whole src/, full-run cache)", run: npm("run", "lint") },
  "fe-vitest": { kind: "fe", note: "npx vitest run (default lane, full suite)", run: { cmd: "npx", args: ["vitest", "run"], cwd: ROOT, shell: true } },
  "fe-build": { kind: "fe", note: "vite build only, codegen excluded", run: { cmd: "npx", args: ["vite", "build"], cwd: ROOT, shell: true } },
  "prepush": { kind: "fe", note: "lefthook pre-push jobs", run: { cmd: "npx", args: ["lefthook", "run", "pre-push"], cwd: ROOT, shell: true } },
  "disk-target": { kind: "disk", note: "bytes under src-tauri/target" },
};

if (flag("list")) {
  for (const [id, s] of Object.entries(SCENARIOS)) console.log(`${id.padEnd(24)} ${s.note}`);
  process.exit(0);
}

const id = opt("scenario");
const scenario = SCENARIOS[id];
if (!scenario) {
  console.error(`unknown --scenario ${id ?? "(none)"}; try --list`);
  process.exit(64);
}

function liveCompilers() {
  if (process.platform !== "win32") {
    const r = spawnSync("pgrep", ["-l", "^(cargo|rustc)$"], { encoding: "utf8" });
    return (r.stdout || "").trim().split("\n").filter(Boolean);
  }
  // `tasklist` without filters hangs under this repo's process count (see cache-budget.mjs); filter per image.
  const hits = [];
  for (const image of ["cargo.exe", "rustc.exe"]) {
    const r = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 15000 });
    if (r.error || r.status !== 0) return null;
    if (r.stdout.toLowerCase().includes(image)) hits.push(image);
  }
  return hits;
}

function dirBytes(dir) {
  if (!existsSync(dir)) return 0;
  if (process.platform === "win32") {
    // robocopy /L lists without copying; du hangs on this host.
    const r = spawnSync("robocopy", [dir, "C:\\__bench_nx__", "/L", "/S", "/NJH", "/BYTES", "/NC", "/NDL", "/NFL", "/NP", "/XJ", "/R:0", "/W:0"], { encoding: "utf8", maxBuffer: 1 << 26 });
    const m = /Bytes\s*:\s*(\d+)/.exec(r.stdout || "");
    if (!m) throw new Error("could not measure: robocopy summary missing");
    return Number(m[1]);
  }
  return Number(execSync(`du -sb "${dir}"`, { encoding: "utf8" }).split(/\s+/)[0]);
}

const git = (...a) => spawnSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).stdout.trim();
const rustc = spawnSync("rustc", ["-V"], { encoding: "utf8" }).stdout?.trim() ?? "unknown";

function runTimed(spec) {
  return new Promise((res, rej) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(spec.cmd, spec.args, { cwd: spec.cwd ?? TAURI, stdio: flag("verbose") ? "inherit" : "ignore", shell: spec.shell ?? false });
    child.on("error", rej);
    child.on("close", (code) => res({ code, wallMs: Number((process.hrtime.bigint() - t0) / 1000000n) }));
  });
}

async function main() {
  if (scenario.kind === "rust") {
    const live = liveCompilers();
    if (live === null) { console.error("could not measure: process probe failed"); process.exit(2); }
    if (live.length) { console.error(`refusing to measure: ${live.join(", ")} is live; a contended number is not a number`); process.exit(2); }
  }

  const row = {
    ts: new Date().toISOString(), scenario: id, variant: opt("variant", "baseline"), features: scenario.kind === "rust" ? FEATURES : undefined,
    host: `${os.hostname()}/${os.arch()}/${os.cpus().length}c/${Math.round(os.totalmem() / 2 ** 30)}G`, rustc,
    commit: git("rev-parse", "--short", "HEAD"), root: ROOT === SELF_ROOT ? "." : ROOT, note: opt("note", scenario.note),
  };

  if (scenario.kind === "disk") {
    row.bytes = dirBytes(join(TAURI, "target"));
  } else {
    if (flag("warmup")) {
      console.error("warmup run (not recorded) ...");
      const w = await runTimed(scenario.run);
      if (w.code !== 0) { console.error(`warmup failed (exit ${w.code})`); process.exit(1); }
    }
    scenario.before?.();
    let sampler, peakFile, stopFile;
    if (scenario.run.sample && process.platform === "win32") {
      const tmp = join(os.tmpdir(), `personas-bench-${process.pid}`);
      mkdirSync(tmp, { recursive: true });
      peakFile = join(tmp, "peak.json"); stopFile = join(tmp, "stop");
      sampler = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SAMPLER, "-OutFile", peakFile, "-StopFile", stopFile], { stdio: "ignore" });
      await new Promise((r) => setTimeout(r, 1500));
    }
    const { code, wallMs } = await runTimed(scenario.run);
    if (sampler) {
      writeFileSync(stopFile, "");
      await new Promise((r) => sampler.on("close", r));
      try {
        const peak = JSON.parse(readFileSync(peakFile, "utf8").replace(/^\uFEFF/, ""));
        row.peakRssMb = peak.peak_single_rustc_mb ?? null;
        row.peakTotalMb = peak.peak_total_mb ?? null;
        row.peakProc = peak.peak_rustc_cmdline ? String(peak.peak_rustc_cmdline).match(/--crate-name (\S+)/)?.[1] ?? null : null;
      } catch { row.peakRssMb = null; row.peakNote = "sampler output unreadable"; }
      rmSync(dirname(peakFile), { recursive: true, force: true });
    }
    if (code !== 0) { console.error(`measured command failed (exit ${code}); nothing recorded`); process.exit(1); }
    row.wallMs = wallMs;
    // A "warm" row that actually compiled is mislabelled, not slow: a file changed under the
    // measurement (sibling session, codegen). Seen on the very first baseline, 2026-09-18.
    if (scenario.kind === "rust") row.rebuilt = (row.peakRssMb ?? 0) > 500;
    if (id === "rust-check-warm" && row.rebuilt) { console.error("rust-check-warm recompiled a crate: the tree changed under the measurement; nothing recorded"); process.exit(2); }
  }

  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, JSON.stringify(row) + "\n");
  console.log(JSON.stringify(row));
}

main().catch((e) => { console.error(`could not measure: ${e.message}`); process.exit(2); });
