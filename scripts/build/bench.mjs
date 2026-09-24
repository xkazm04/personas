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
 * cannot fail the measurement. They are WARM by design (run once with --warmup
 * to build dependencies, which is never recorded) except the two scenarios named
 * *-cold-*, which exist so a cold number is taken on purpose and labelled as one.
 *
 * --root <path> measures another checkout (e.g. the main checkout's warm
 * target from inside a worktree). The ledger is always written beside THIS
 * script's checkout.
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
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
const cleanPkg = (pkg) => () => {
  const r = spawnSync("cargo", ["clean", "-p", pkg, "--manifest-path", join(TAURI, "Cargo.toml")], { cwd: TAURI, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cargo clean -p ${pkg} failed: ${r.stderr}`);
};
const cargo = (...a) => ({ cmd: "cargo", args: [...a, "--manifest-path", join(TAURI, "Cargo.toml"), "--features", FEATURES], sample: true });
const npm = (...a) => ({ cmd: process.platform === "win32" ? "npm.cmd" : "npm", args: a, cwd: ROOT, shell: true });
const node = (...a) => ({ cmd: process.execPath, args: a, cwd: ROOT });

/** Scenario ids are wire-level: the ledger, the docs and the campaign ratchet all key on them. */
const SCENARIOS = {
  "rust-check-warm": { kind: "rust", note: "no change; fingerprint walk only", run: cargo("check", "--lib") },
  "rust-check-touch-lib": { kind: "rust", note: "touch src/lib.rs (the crate root) then check", before: touch("src/lib.rs"), run: cargo("check", "--lib") },
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
  // Cold scenarios are deliberate, never accidental (build-measurement.md). The first wipes ONLY the app
  // crate's own artifacts in the checkout being measured; third-party and extracted-crate artifacts stay warm.
  "rust-check-cold-applib": { kind: "rust", note: "cargo clean -p personas-desktop, then check --lib: app_lib from nothing, deps warm, no incremental cache", before: cleanPkg("personas-desktop"), run: cargo("check", "--lib") },
  "rust-build-cold-worktree": { kind: "rust", note: "first dev build of the lib in a fresh build dir; say in --note what was already warm", run: cargo("build", "--lib") },
  "disk-build-dir": { kind: "disk", dir: "build", note: "bytes under cargo's build_directory (a worktree's own build dir when build.build-dir is configured)" },
  // The tier gate. It is the single most expensive entry in `npm run check` and
  // nothing had ever timed it, so "three serial vite builds" travelled as prose.
  "fe-check-tiers": { kind: "fe", note: "npm run check:tiers (the tier gate, codegen + vite build(s))", run: npm("run", "check:tiers") },
  // dist weight. These read the CURRENT dist — they run no build, so a row is
  // only meaningful next to a --note saying which build produced the tree.
  // `files` rides on every row: 0 bytes because nothing matched and 0 bytes
  // because the artefact is genuinely gone are different outcomes (the census's
  // fail-loud contract, applied to a measurement).
  // `allowZero` is per scenario and is the whole difference between a
  // measurement and a broken selector. A dist with no JS, or no worker chunk,
  // means the walk is wrong — refuse. Zero MAPS is the opposite: it is the
  // measurement `PERSONAS_RELEASE` was introduced to produce.
  "size-dist": { kind: "bytes", note: "bytes of .js emitted into dist (maps excluded)", select: (rel) => rel.endsWith(".js") },
  "size-dist-maps": { kind: "bytes", allowZero: true, note: "bytes of .map files in dist", select: (rel) => rel.endsWith(".map") },
  "size-worker-chunk": { kind: "bytes", note: "bytes of dist worker chunks (*.worker-*.js)", select: (rel) => /\.worker-[^\\/]*\.js$/.test(rel) },
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

/**
 * Bytes of the files under `dir` whose path (relative, forward-slashed) passes
 * `select`. Node fs rather than `du`, which hangs on this host, and rather than
 * robocopy, which counts whole trees and cannot filter by extension.
 */
function selectedBytes(dir, select) {
  if (!existsSync(dir)) throw new Error(`could not measure: ${dir} does not exist — build first`);
  let bytes = 0, largest = null;
  const files = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childAbs = join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(childAbs, childRel); continue; }
      if (!entry.isFile() || !select(childRel)) continue;
      const size = statSync(childAbs).size;
      bytes += size; files.push(childRel);
      if (!largest || size > largest.bytes) largest = { file: childRel, bytes: size };
    }
  };
  walk(dir, "");
  return { bytes, files, largest };
}

function buildDirectory() {
  // cwd matters: cargo discovers .cargo/config.toml from the working directory, not from --manifest-path.
  const r = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], { cwd: TAURI, encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error("cargo metadata failed");
  const m = JSON.parse(r.stdout);
  return m.build_directory ?? m.target_directory;
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
    row.bytes = dirBytes(scenario.dir === "build" ? buildDirectory() : join(TAURI, "target"));
  } else if (scenario.kind === "bytes") {
    const measured = selectedBytes(join(ROOT, "dist"), scenario.select);
    // Refuse an empty enumeration unless this scenario says zero is a result.
    if (measured.files.length === 0 && !scenario.allowZero) {
      console.error(`could not measure: ${id} matched 0 files under dist/ — broken selector, or wrong build`);
      process.exit(1);
    }
    row.bytes = measured.bytes;
    row.files = measured.files.length;
    row.largest = measured.largest;
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
