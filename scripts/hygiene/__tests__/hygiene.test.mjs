// Tests for build hygiene v2: scripts/cache-budget.mjs, scripts/hygiene/*.mjs
// and the predicates exported from scripts/worktree-gc.mjs + scripts/temp-gc.mjs.
//
// Run:  node --test scripts/hygiene/__tests__/
//
// EVERY destructive call here is pointed at a fixture under os.tmpdir(). The
// real src-tauri/target, the real %TEMP%, the real worktrees, the real eviction
// log and the real Task Scheduler are never touched: roots, tmpdir and log path
// are passed explicitly (and via CACHE_BUDGET_ROOT / CACHE_BUDGET_TMPDIR /
// PERSONAS_HYGIENE_LOG for the CLI cases), and schtasks only ever runs as a fake.
// The one read of the real repo is parsing src-tauri/Cargo.toml for crate names.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync,
  utimesSync, statSync, readFileSync, realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  enforceBudget, measureDirStrict, workspaceCrates, reapSupersededDeps,
  guardDecision, lockHeldReason, DEFAULT_BUDGET_GB, GIB, KEEP_HASH_SETS,
} from "../../cache-budget.mjs";
import { discoverTargetsDetailed, ALTERNATE_TARGETS } from "../targets.mjs";
import { readLog, CATEGORIES } from "../log.mjs";
import { sweepWorktrees, sweepRootResidue, sweepTempTargets } from "../run-daily.mjs";
import { run as runTask, installArgv, uninstallArgv, statusArgv, TASK_NAME } from "../install-task.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const CACHE_BUDGET = join(REPO, "scripts", "cache-budget.mjs");
const DAY = 86_400_000;

const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 3 });
});

function tmpRoot(prefix) {
  const r = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(r);
  return r;
}

function put(file, bytes = 1000) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.alloc(bytes, 1));
}

/** Set mtime of `p` — and everything under it, deepest first — to `days` ago. */
function age(p, days) {
  const t = new Date(Date.now() - days * DAY);
  const st = statSync(p);
  if (st.isDirectory()) for (const e of readdirSync(p)) age(join(p, e), days);
  utimesSync(p, t, t);
}

const H = (n) => n.toString(16).padStart(16, "0");

// Fixture ages DERIVE from the exported keep count, so changing KEEP_HASH_SETS
// (2 -> 3 on 2026-09-18, one hash per live lane) never needs a fixture edit.
// `youngAges()` = exactly the sets the reaper must keep, all under 3 days old.
const K = KEEP_HASH_SETS;
const youngAges = () => Array.from({ length: K }, (_, i) => 2 - (1.5 * i) / K);

/** A workspace manifest shaped like the real one: root package + one member. */
function writeManifests(srcTauri) {
  mkdirSync(join(srcTauri, "db"), { recursive: true });
  writeFileSync(join(srcTauri, "Cargo.toml"), [
    "[workspace]", 'members = [".", "db"]', "",
    "[package]", 'name = "personas-desktop"', "",
    "[lib]", 'name = "app_lib"', "",
    "[[bin]]", 'name = "personas-mcp"', 'path = "src/bin/mcp.rs"', "",
  ].join("\n"));
  writeFileSync(join(srcTauri, "db", "Cargo.toml"), ["[package]", 'name = "personas-db"', "", "[lib]", 'name = "personas_db"', ""].join("\n"));
}

/** One lib-shaped hash-set: lib<stem>-<h>.rlib + .rmeta, <stem>-<h>.d, + its .fingerprint dir. */
function libSet(profile, stem, pkg, h, days, bytes = 4000) {
  const deps = join(profile, "deps");
  const files = [join(deps, `lib${stem}-${h}.rlib`), join(deps, `lib${stem}-${h}.rmeta`), join(deps, `${stem}-${h}.d`)];
  for (const f of files) { put(f, bytes); age(f, days); }
  const fp = join(profile, ".fingerprint", `${pkg}-${h}`);
  put(join(fp, "invoked.timestamp"), 100);
  age(fp, days);
  return { files, fp };
}

function cargoTargetShell(target) {
  mkdirSync(join(target, "debug"), { recursive: true });
  writeFileSync(join(target, "CACHEDIR.TAG"), "Signature: 8a477f597d28d172789f06886806bc55\n");
  writeFileSync(join(target, ".rustc_info.json"), "{}");
  writeFileSync(join(target, "debug", ".cargo-lock"), "");
}

/** Fixture checkout with an over-grown main target. All ages are > 90 s. */
function overgrownCheckout() {
  const root = tmpRoot("hyg-root-");
  mkdirSync(join(root, ".claude"), { recursive: true });
  const srcTauri = join(root, "src-tauri");
  writeManifests(srcTauri);
  const target = join(srcTauri, "target");
  cargoTargetShell(target);
  const profile = join(target, "debug");

  const db = [12, 11, 10, ...youngAges()].map((d, i) => ({ days: d, ...libSet(profile, "personas_db", "personas-db", H(i + 1), d) }));
  const serde = [20, 19, 18].map((d, i) => libSet(profile, "serde", "serde", H(100 + i), d));
  const inc = [[10, "app_lib-aaaa"], [2, "personas_db-bbbb"], [0.05, "app_lib-cccc"]].map(([d, name]) => {
    const dir = join(profile, "incremental", name);
    put(join(dir, "s-xyz", "dep-graph.bin"), 6000);
    age(dir, d);
    return { dir, days: d };
  });
  const orphan = join(profile, "build", `ring-${H(500)}`);
  put(join(orphan, "out", "blob.o"), 5000);
  age(orphan, 5);
  const keptBuild = join(profile, "build", `serde-${H(100)}`); // has a .fingerprint entry
  put(join(keptBuild, "out", "x.o"), 5000);
  age(keptBuild, 5);
  return { root, target, profile, db, serde, inc, orphan, keptBuild };
}

const emptyTmp = () => tmpRoot("hyg-tmp-");
const noSweep = { hasCargoSweep: () => false };

// ---------------------------------------------------------------------------
test("(1) over-budget fixture is pruned to <= budget and every eviction is logged", () => {
  const fx = overgrownCheckout();
  const logPath = join(fx.root, "hygiene.jsonl");
  const before = measureDirStrict(fx.target).bytes;
  const evictable =
    fx.db.slice(0, 3).reduce((s, d) => s + d.files.reduce((a, f) => a + statSync(f).size, 0) + measureDirStrict(d.fp).bytes, 0)
    + fx.inc.filter((i) => i.days >= 1).reduce((s, i) => s + measureDirStrict(i.dir).bytes, 0)
    + measureDirStrict(fx.orphan).bytes;
  const budgetBytes = before - evictable + 50; // reachable ONLY if all three reapers fire

  const lines = [];
  const r = enforceBudget(fx.root, { budgetBytes, trigger: "daily", logPath, tmpdir: emptyTmp(), print: (l) => lines.push(l), ...noSweep });

  assert.equal(r.status, "pruned", JSON.stringify({ r, lines }, null, 1));
  const afterBytes = measureDirStrict(fx.target).bytes; // independent re-measure, not the engine's arithmetic
  assert.ok(afterBytes <= budgetBytes, `after ${afterBytes} must be <= budget ${budgetBytes}`);
  assert.equal(before - afterBytes, r.freedBytes, "reported freed bytes must equal what actually left the disk");

  const { rows } = readLog(logPath);
  assert.deepEqual([...new Set(rows.map((x) => x.category))].sort(), ["build-orphan", "deps-superseded", "incremental"]);
  for (const row of rows) {
    assert.ok(CATEGORIES.includes(row.category));
    assert.equal(row.trigger, "daily");
    assert.ok(row.bytesFreed > 0, "every row carries bytes");
    assert.ok(row.reason.length > 10 && row.target.startsWith("main/"), "every row says what and why");
    assert.ok(!Number.isNaN(Date.parse(row.ts)));
  }
  assert.equal(rows.reduce((s, x) => s + x.bytesFreed, 0), r.freedBytes);
  assert.equal(lines.filter((l) => l.includes("evicted")).length, rows.length, "one printed line per eviction");

  // (6) third-party artifacts survived every stage that ran.
  for (const s of fx.serde) { for (const f of s.files) assert.ok(existsSync(f)); assert.ok(existsSync(s.fp)); }
  assert.ok(existsSync(fx.keptBuild), "a build dir WITH a fingerprint is not an orphan");
  assert.ok(!existsSync(fx.orphan));
  assert.ok(existsSync(fx.inc[2].dir), "the 1 h-old incremental session is younger than every age tier");
});

test("(1b) under budget: nothing deleted, nothing logged, nothing printed", () => {
  const fx = overgrownCheckout();
  const logPath = join(fx.root, "hygiene.jsonl");
  const lines = [];
  const before = measureDirStrict(fx.target).bytes;
  const r = enforceBudget(fx.root, { budgetBytes: before + 1, logPath, tmpdir: emptyTmp(), print: (l) => lines.push(l) });
  assert.equal(r.status, "under");
  assert.equal(measureDirStrict(fx.target).bytes, before);
  assert.equal(readLog(logPath).missing, true);
  assert.deepEqual(lines, []);
});

test("(1c) --dry-run style call deletes nothing and logs nothing", () => {
  const fx = overgrownCheckout();
  const logPath = join(fx.root, "hygiene.jsonl");
  const before = measureDirStrict(fx.target).bytes;
  const lines = [];
  const r = enforceBudget(fx.root, { budgetBytes: 1, dryRun: true, logPath, tmpdir: emptyTmp(), print: (l) => lines.push(l), ...noSweep });
  assert.equal(measureDirStrict(fx.target).bytes, before);
  assert.equal(readLog(logPath).missing, true);
  assert.ok(r.evictions.length > 0 && lines.some((l) => l.includes("would evict")));
});

// ---------------------------------------------------------------------------
test("(2) a target whose incremental cache was written < 90 s ago is NOT touched; the refusal says why", () => {
  const fx = overgrownCheckout();
  put(join(fx.profile, "incremental", "app_lib-live", "s-now", "dep-graph.bin"), 3000); // mtime = now
  const logPath = join(fx.root, "hygiene.jsonl");
  const before = measureDirStrict(fx.target).bytes;
  const lines = [];
  const r = enforceBudget(fx.root, { budgetBytes: 1, logPath, tmpdir: emptyTmp(), print: (l) => lines.push(l), ...noSweep });

  assert.equal(measureDirStrict(fx.target).bytes, before, "not one byte may leave a live target");
  assert.equal(r.freedBytes, 0);
  assert.equal(r.status, "over");
  assert.equal(r.refusals.length, 1);
  assert.equal(r.refusals[0].target, "main");
  assert.match(r.refusals[0].reason, /incremental cache written \d+ s ago \(< 90 s\) — a build is in flight/);
  assert.ok(lines.some((l) => l.includes("refused main") && l.includes("a build is in flight")));
  assert.equal(readLog(logPath).missing, true);
});

test("(2b) a held cargo lock is detected by the read probe and refuses the target", { skip: process.platform !== "win32" }, async () => {
  const fx = overgrownCheckout();
  const lock = join(fx.profile, ".cargo-lock");
  assert.equal(lockHeldReason(fx.profile), null, "free lock reads as free");
  const ps = spawn("powershell", ["-NoProfile", "-Command",
    `$f=[System.IO.File]::Open('${lock}','OpenOrCreate','ReadWrite','ReadWrite'); $f.Lock(0,[long]::MaxValue); Start-Sleep 12; $f.Close()`],
  { stdio: "ignore", windowsHide: true });
  try {
    let held = null;
    for (let i = 0; i < 100 && !held; i++) { await new Promise((r) => setTimeout(r, 100)); held = lockHeldReason(fx.profile); }
    assert.match(held ?? "", /\.cargo-lock is locked by a running cargo/);
    const before = measureDirStrict(fx.target).bytes;
    const r = enforceBudget(fx.root, { budgetBytes: 1, logPath: join(fx.root, "l.jsonl"), tmpdir: emptyTmp(), print: () => {}, ...noSweep });
    assert.equal(measureDirStrict(fx.target).bytes, before);
    assert.match(r.refusals[0].reason, /\.cargo-lock is locked/);
  } finally {
    ps.kill();
  }
});

// ---------------------------------------------------------------------------
test("(3) measurement failure: enforce is loud, guard advises with the reason, neither ever says 'under budget'", () => {
  const root = tmpRoot("hyg-unmeasurable-");
  mkdirSync(join(root, ".claude"), { recursive: true });
  // The main target exists but cannot be listed: it is a FILE. v1's measureDir
  // returned 0 bytes for this, i.e. "empty, under budget".
  put(join(root, "src-tauri", "target"), 10);
  assert.equal(measureDirStrict(join(root, "src-tauri", "target")).ok, false);

  const r = enforceBudget(root, { budgetBytes: 10 * GIB, logPath: join(root, "l.jsonl"), tmpdir: emptyTmp(), print: () => {} });
  assert.equal(r.status, "unmeasured");
  assert.equal(r.unmeasured[0].label, "main");

  const env = { ...process.env, CACHE_BUDGET_ROOT: root, CACHE_BUDGET_TMPDIR: emptyTmp(), PERSONAS_HYGIENE_LOG: join(root, "l.jsonl"), CACHE_AUTO_PRUNE: "0" };
  const cli = spawnSync(process.execPath, [CACHE_BUDGET, "--enforce", "--yes"], { env, encoding: "utf8" });
  assert.notEqual(cli.status, 0, "--enforce must exit non-zero when it could not measure");
  assert.match(cli.stdout + cli.stderr, /COULD NOT MEASURE 1 target\(s\): main/);
  assert.doesNotMatch(cli.stdout + cli.stderr, /under the|under budget\b(?! result)|Nothing to do/i);

  // The enforce run persisted a snapshot that records the failure; the guard
  // must read that as "not checked", exit 0, and say why.
  const snap = JSON.parse(readFileSync(join(root, ".claude", ".cache-budget.json"), "utf8"));
  assert.equal(snap.unmeasured.length, 1);
  assert.deepEqual(guardDecision(snap, { autoPrune: true }).action, "background");
  const g = spawnSync(process.execPath, [CACHE_BUDGET], { env, encoding: "utf8" });
  assert.equal(g.status, 0, "the guard never fails the build");
  assert.match(g.stderr, /last measurement could not read main/);
  assert.doesNotMatch(g.stdout + g.stderr, /under budget|Nothing to do/i);

  // No snapshot at all is also "not checked", never silence-as-clean.
  assert.notEqual(guardDecision(null).action, "silent");
});

// ---------------------------------------------------------------------------
test("(4) discovery returns main, all four alternates, worktree targets, the shared build-dir and %TEMP% targets", () => {
  const root = tmpRoot("hyg-disc-");
  const tmp = tmpRoot("hyg-disc-tmp-");
  mkdirSync(join(root, "src-tauri", "target"), { recursive: true });
  for (const rel of ALTERNATE_TARGETS) mkdirSync(join(root, ...rel.split("/")), { recursive: true });
  mkdirSync(join(root, ".claude", "worktrees", "feat-x", "src-tauri", "target"), { recursive: true });
  mkdirSync(join(root, ".claude", "worktrees", "feat-x", "src-tauri", "target-clippy"), { recursive: true });
  mkdirSync(join(root, ".claude", "worktrees", ".cargo-build"), { recursive: true });
  cargoTargetShell(join(tmp, "worker-target"));                 // depth 1
  cargoTargetShell(join(tmp, "job-42", "target"));              // depth 2
  cargoTargetShell(join(tmp, "a", "b", "too-deep"));            // depth 3 — out of bounds
  mkdirSync(join(tmp, "looks-like", "target", "debug"), { recursive: true }); // no marker files

  const { targets, warnings } = discoverTargetsDetailed({ root, tmpdir: tmp });
  const byKind = (k) => targets.filter((t) => t.kind === k).map((t) => t.label).sort();
  assert.deepEqual(byKind("main"), ["main"]);
  assert.deepEqual(byKind("alternate"), ALTERNATE_TARGETS.map((r) => `alternate:${r}`).sort());
  assert.deepEqual(byKind("worktree"), ["worktree:feat-x", "worktree:feat-x:src-tauri/target-clippy"]);
  assert.deepEqual(byKind("worktree-shared-build"), ["worktree-shared-build"]);
  assert.deepEqual(byKind("temp"), ["temp:job-42/target", "temp:worker-target"]);
  assert.deepEqual(warnings, []);
  for (const t of targets) assert.ok(t.label && t.path && t.kind);

  // A truncated walk says so instead of passing for a complete one.
  const capped = discoverTargetsDetailed({ root, tmpdir: tmp, maxTempDirs: 1 });
  assert.ok(capped.warnings.some((w) => /NOT checked/.test(w)));

  // --report lists every one of them with kind and bytes.
  const env = { ...process.env, CACHE_BUDGET_ROOT: root, CACHE_BUDGET_TMPDIR: tmp };
  const rep = spawnSync(process.execPath, [CACHE_BUDGET, "--report", "--json"], { env, encoding: "utf8" });
  assert.equal(rep.status, 0);
  const snap = JSON.parse(rep.stdout);
  assert.equal(snap.budgetGB, DEFAULT_BUDGET_GB);
  assert.equal(snap.budgetGB, 60);
  assert.equal(snap.items.length, targets.length);
  for (const i of snap.items) assert.ok(typeof i.bytes === "number" && i.kind && i.ok === true);
});

// ---------------------------------------------------------------------------
test("(5) superseded-deps reaper: newest KEEP_HASH_SETS per workspace crate+shape kept, lib-prefix + .fingerprint handled, third-party never touched", () => {
  const root = tmpRoot("hyg-reap-");
  const srcTauri = join(root, "src-tauri");
  writeManifests(srcTauri);
  const crates = workspaceCrates(srcTauri);
  assert.deepEqual(crates, [
    { package: "personas-desktop", stems: ["app_lib", "personas_mcp"] },
    { package: "personas-db", stems: ["personas_db"] },
  ]);

  const profile = join(srcTauri, "target", "debug");
  const db = [9, 7, ...youngAges()].map((d, i) => libSet(profile, "personas_db", "personas-db", H(i + 1), d)); // oldest first; K + 2 sets
  // bin shape: personas_mcp-<h>.exe/.pdb/.d under package personas-desktop
  const bins = [9, ...youngAges()].map((d, i) => { // K + 1 sets
    const h = H(50 + i);
    const files = ["exe", "pdb", "d"].map((x) => join(profile, "deps", `personas_mcp-${h}.${x}`));
    for (const f of files) { put(f); age(f, d); }
    const fp = join(profile, ".fingerprint", `personas-desktop-${h}`);
    put(join(fp, "bin-personas-mcp"), 50); age(fp, d);
    return { files, fp };
  });
  // check shape (rmeta + d only): its own keep-K group, so a `cargo check` set
  // is not evicted merely because two newer `cargo build` sets exist.
  const check = join(profile, "deps", `libpersonas_db-${H(90)}.rmeta`);
  put(check); age(check, 30);
  // third-party, incl. names that merely START like a workspace crate
  const foreign = [
    ...libSet(profile, "serde", "serde", H(200), 40).files,
    ...libSet(profile, "serde", "serde", H(201), 39).files,
    ...libSet(profile, "serde", "serde", H(202), 38).files,
    ...libSet(profile, "personas_db_extra", "personas-db-extra", H(203), 40).files,
    ...libSet(profile, "app_lib_macros", "app-lib-macros", H(204), 40).files,
  ];
  const foreignFp = ["serde", "serde", "serde"].map((p, i) => join(profile, ".fingerprint", `${p}-${H(200 + i)}`));

  const r = reapSupersededDeps(profile, crates, { minAgeMs: 0 });
  assert.equal(r.count, 3, `beyond the newest ${K}: 2 personas_db lib sets + 1 personas_mcp bin set`);

  for (const old of db.slice(0, 2)) { for (const f of old.files) assert.ok(!existsSync(f), `${f} should be reaped`); assert.ok(!existsSync(old.fp)); }
  for (const keep of db.slice(2)) { for (const f of keep.files) assert.ok(existsSync(f)); assert.ok(existsSync(keep.fp)); }
  for (const f of bins[0].files) assert.ok(!existsSync(f));
  assert.ok(!existsSync(bins[0].fp));
  for (const b of bins.slice(1)) { for (const f of b.files) assert.ok(existsSync(f)); assert.ok(existsSync(b.fp)); }
  assert.ok(existsSync(check), `the only check-shaped set is within its own newest-${K}`);
  for (const f of foreign) assert.ok(existsSync(f), `third-party ${f} must never be touched`);
  for (const f of foreignFp) assert.ok(existsSync(f));

  // Age tiers: with a 6-day floor nothing younger goes, even beyond newest-K.
  const again = [9, 8, ...youngAges()].map((d, i) => // two beyond newest-K; only one is past the floor
    libSet(profile, "app_lib", "personas-desktop", H(300 + i), d));
  const r2 = reapSupersededDeps(profile, crates, { minAgeMs: 8.5 * DAY });
  assert.equal(r2.count, 1);
  assert.ok(!existsSync(again[0].files[0]) && existsSync(again[1].files[0]));

  // Names come from the REAL manifest too — derived, not hardcoded.
  const real = workspaceCrates(join(REPO, "src-tauri")).flatMap((c) => c.stems);
  for (const s of ["personas_db", "personas_engine", "personas_core", "personas_macros", "app_lib", "personas_mcp"]) {
    assert.ok(real.includes(s), `derived stems must include ${s}; got ${real.join(",")}`);
  }
});

// ---------------------------------------------------------------------------
test("(6) install-task: exact argv, idempotent second install, uninstall, status, non-Windows", () => {
  const calls = [];
  const runner = (argv) => { calls.push(argv); return { code: 0, stdout: "TaskName: \\PersonasBuildHygiene", stderr: "" }; };
  const o = { platform: "win32", runner, repoRoot: "C:\\repo", nodePath: "C:\\Program Files\\nodejs\\node.exe" };
  const expectInstall = [
    "/Create", "/F", "/TN", "PersonasBuildHygiene", "/SC", "DAILY", "/ST", "12:30", "/RL", "LIMITED",
    "/TR", 'cmd /c cd /d "C:\\repo" && "C:\\Program Files\\nodejs\\node.exe" "C:\\repo\\scripts\\hygiene\\run-daily.mjs"',
  ];
  assert.equal(TASK_NAME, "PersonasBuildHygiene");
  const first = runTask("install", o);
  const second = runTask("install", o);
  assert.equal(first.code, 0); assert.equal(second.code, 0);
  assert.deepEqual(calls[0], expectInstall);
  assert.deepEqual(calls[1], expectInstall, "second install = same argv, /F overwrites, no error");
  assert.ok(calls[0].includes("/F"));
  assert.ok(!calls[0].includes("/RU") && !calls[0].includes("HIGHEST"), "current user, no elevation");
  assert.deepEqual(installArgv({ ...o, time: "04:30" }).slice(6, 8), ["/ST", "04:30"], "--time stays overridable");
  assert.throws(() => installArgv({ ...o, time: "4pm" }), /HH:MM/);

  calls.length = 0;
  assert.equal(runTask("uninstall", o).code, 0);
  assert.deepEqual(calls, [["/Delete", "/F", "/TN", "PersonasBuildHygiene"]]);
  assert.deepEqual(uninstallArgv(), calls[0]);

  calls.length = 0;
  assert.equal(runTask("status", o).code, 0);
  assert.deepEqual(calls, [["/Query", "/TN", "PersonasBuildHygiene", "/FO", "LIST", "/V"]]);
  assert.deepEqual(statusArgv(), calls[0]);

  // uninstall when absent: fine. uninstall that fails while the task exists: not fine.
  const absent = runTask("uninstall", { ...o, runner: () => ({ code: 1, stdout: "", stderr: "ERROR: cannot find" }) });
  assert.equal(absent.code, 0); assert.match(absent.message, /not installed/);
  const stuck = runTask("uninstall", { ...o, runner: (a) => (a[0] === "/Delete" ? { code: 1, stdout: "", stderr: "Access is denied." } : { code: 0, stdout: "x", stderr: "" }) });
  assert.equal(stuck.code, 1); assert.match(stuck.message, /Access is denied/);
  const failed = runTask("install", { ...o, runner: () => ({ code: 1, stdout: "", stderr: "ERROR: boom" }) });
  assert.equal(failed.code, 1); assert.match(failed.message, /boom/);

  let ran = false;
  const nix = runTask("install", { platform: "linux", runner: () => { ran = true; return { code: 0 }; }, repoRoot: "/repo" });
  assert.equal(nix.code, 0); assert.equal(ran, false);
  assert.match(nix.message, /^not supported on this platform; add a cron entry: /);
});

// ---------------------------------------------------------------------------
function gitFixture() {
  const root = tmpRoot("hyg-git-");
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_/.test(k)) delete env[k]; // never inherit an index/dir from the caller
  const git = (...a) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...a], { env, stdio: "pipe" });
  git("init", "-q", "-b", "master");
  writeFileSync(join(root, ".gitignore"), "*.stackdump\n.claude/\n");
  writeFileSync(join(root, "build-tracked.log"), "kept: tracked\n");
  writeFileSync(join(root, "README.md"), "x\n");
  git("add", ".gitignore", "build-tracked.log", "README.md");
  git("commit", "-q", "-m", "fixture");
  return root;
}

test("(7) orphan shell with content is reported not removed; empty shell goes; a tracked root file is never deleted", () => {
  const root = gitFixture();
  const logPath = join(root, ".claude", "hygiene.jsonl");
  const wt = join(root, ".claude", "worktrees");
  mkdirSync(join(wt, "empty-shell"), { recursive: true });
  put(join(wt, "orphan-with-work", "notes.md"), 20);
  age(join(wt, "empty-shell"), 40);
  age(join(wt, "orphan-with-work"), 40);

  const lines = [];
  const w = sweepWorktrees(root, { logPath, print: (l) => lines.push(l) });
  assert.ok(!existsSync(join(wt, "empty-shell")));
  assert.ok(existsSync(join(wt, "orphan-with-work", "notes.md")), "an orphan with ANY content is never removed");
  assert.deepEqual(w.reportedOrphans.map((o) => o.name), ["orphan-with-work"]);
  assert.ok(lines.some((l) => l.includes("orphan-with-work") && l.includes("HAS CONTENT")));
  assert.deepEqual(w.removed.map((r) => r.category), ["worktree-orphan"]);

  // root residue
  for (const [name, days] of [["build-tracked.log", 40], ["build-old.log", 40], ["build-new.log", 1], ["crash.exe.stackdump", 40], ["response-1.txt", 40], ["notes-old.txt", 40]]) {
    if (name !== "build-tracked.log") writeFileSync(join(root, name), "junk\n");
    age(join(root, name), days);
  }
  const res = sweepRootResidue(root, { logPath, print: () => {} });
  assert.ok(existsSync(join(root, "build-tracked.log")), "TRACKED file must survive even though it matches and is old");
  assert.ok(res.refused.some((x) => x.target === "build-tracked.log" && x.reason === "tracked by git"));
  assert.ok(existsSync(join(root, "build-new.log")), "younger than 14 d");
  assert.ok(existsSync(join(root, "notes-old.txt")), "does not match a residue pattern");
  assert.deepEqual(res.removed.map((r) => r.target).sort(), ["build-old.log", "crash.exe.stackdump", "response-1.txt"]);
  assert.match(res.removed.find((r) => r.target === "crash.exe.stackdump").reason, /git-ignored/);
  assert.match(res.removed.find((r) => r.target === "build-old.log").reason, /untracked/);

  // tracked-ness that cannot be verified (not a git repo) => refuse, never delete
  const bare = tmpRoot("hyg-nogit-");
  writeFileSync(join(bare, "build-x.log"), "junk\n");
  age(join(bare, "build-x.log"), 40);
  const nogit = sweepRootResidue(bare, { logPath, print: () => {} });
  assert.ok(existsSync(join(bare, "build-x.log")));
  assert.match(nogit.refused[0].reason, /could not verify/);

  const { rows } = readLog(logPath);
  assert.deepEqual([...new Set(rows.map((r) => r.category))].sort(), ["root-residue", "worktree-orphan"]);
});

test("(7b) temp targets: only > 24 h, unnamed by a process, and never when processes could not be listed", () => {
  const tmp = tmpRoot("hyg-temp-");
  const logPath = join(tmp, "l.jsonl");
  const mk = (name, days) => { const t = join(tmp, name); cargoTargetShell(t); put(join(t, "debug", "deps", "libx-0000000000000001.rlib"), 3000); age(t, days); return t; };
  const stale = mk("stale-target", 3);
  const fresh = mk("fresh-target", 0.2);
  const inUse = mk("inuse-target", 3);
  const { targets } = discoverTargetsDetailed({ root: tmpRoot("hyg-temp-root-"), tmpdir: tmp });

  const blind = sweepTempTargets(targets, { procText: null, logPath, print: () => {} });
  assert.equal(blind.removed.length, 0, "could not list processes => refuse, never 'nothing is using it'");
  assert.ok(existsSync(stale));

  const r = sweepTempTargets(targets, { procText: `node c:\\x.js --target-dir ${inUse.toLowerCase()}`, logPath, print: () => {} });
  assert.ok(!existsSync(stale));
  assert.ok(existsSync(fresh) && existsSync(inUse));
  assert.deepEqual(r.removed.map((x) => x.category), ["temp-target"]);
  assert.ok(r.removed[0].bytesFreed >= 3000);
});

// ---------------------------------------------------------------------------
test("(A7) under-budget guard reads the snapshot only: no walk, no output, snapshot untouched", () => {
  const root = tmpRoot("hyg-guard-");
  mkdirSync(join(root, ".claude"), { recursive: true });
  // Poison: if the guard measured, this FILE-as-target would come back
  // unmeasured and the guard would print. Silence proves it never looked.
  put(join(root, "src-tauri", "target"), 10);
  const snapPath = join(root, ".claude", ".cache-budget.json");
  const snap = { measuredAt: Date.now() - 3600e3, budgetGB: 60, totalBytes: 30 * GIB, unmeasured: [], items: [{ label: "main", kind: "main", bytes: 30 * GIB, ok: true }] };
  writeFileSync(snapPath, JSON.stringify(snap));
  const mtime = statSync(snapPath).mtimeMs;

  assert.deepEqual(guardDecision(snap), { action: "silent" });
  const env = { ...process.env, CACHE_BUDGET_ROOT: root, CACHE_BUDGET_TMPDIR: emptyTmp(), PERSONAS_HYGIENE_LOG: join(root, "l.jsonl") };
  delete env.CACHE_BUDGET_GB;
  const g = spawnSync(process.execPath, [CACHE_BUDGET], { env, encoding: "utf8" });
  assert.equal(g.status, 0);
  assert.equal(g.stdout + g.stderr, "", "under-budget guard is silent");
  assert.equal(statSync(snapPath).mtimeMs, mtime, "snapshot not rewritten => nothing was measured");
  assert.equal(existsSync(join(root, ".claude", ".cache-budget.lock")), false, "no background enforcer was started");

  // There is no dead band any more: 80%+ of budget always leads to enforcement.
  for (const pct of [0.8, 1.0, 1.1, 2.4]) {
    assert.equal(guardDecision({ ...snap, totalBytes: pct * 60 * GIB }).action, "background", `${pct * 100}% must enforce`);
  }
  assert.equal(guardDecision({ ...snap, measuredAt: Date.now() - 13 * 3600e3 }).action, "background", "a stale snapshot is re-measured, not trusted");
  assert.equal(guardDecision({ measuredAt: Date.now(), totalBytes: 1, items: [{ label: "main", bytes: 1 }] }).action, "background", "a v1 snapshot never saw the alternate/temp targets");
});

// ---------------------------------------------------------------------------
test("(A8) a worktree's copy of the guard never enforces; the main checkout's copy does", async () => {
  const { guardMayEnforce } = await import("../../cache-budget.mjs");
  const main = "C:/repo";
  assert.equal(guardMayEnforce(main, { self: "C:/repo/scripts/cache-budget.mjs", env: {} }), true);
  assert.equal(guardMayEnforce(main, { self: "C:\\Repo\\scripts\\cache-budget.mjs", env: {} }), true, "case/slash-insensitive on the same checkout");
  assert.equal(guardMayEnforce(main, { self: "C:/repo/.claude/worktrees/feat/scripts/cache-budget.mjs", env: {} }), false,
    "2026-09-18: a worktree guard evicted 9.77 GB from the shared main target before review");
  assert.equal(guardMayEnforce(main, { self: "C:/elsewhere/scripts/cache-budget.mjs", env: { CACHE_BUDGET_ROOT: main } }), true, "explicit redirect is allowed (fixtures)");
});

test("(A9) runDaily end to end on a fixture checkout + fixture temp dir", async () => {
  const { runDaily, printLog } = await import("../run-daily.mjs");
  const fx = overgrownCheckout();
  const tmp = tmpRoot("hyg-daily-tmp-");
  const staleTemp = join(tmp, "old-worker", "target");
  cargoTargetShell(staleTemp); put(join(staleTemp, "debug", "deps", "libq-0000000000000009.rlib"), 2000); age(join(tmp, "old-worker"), 4);
  const logPath = join(fx.root, "daily.jsonl");
  const before = measureDirStrict(fx.target).bytes;

  const dry = runDaily({ root: fx.root, tmpdir: tmp, logPath, dryRun: true, budgetBytes: before - 20000, procText: "", print: () => {}, ...noSweep });
  assert.equal(measureDirStrict(fx.target).bytes, before, "dry run deletes nothing");
  assert.ok(existsSync(staleTemp) && readLog(logPath).missing);
  assert.ok(dry.freedBytes > 0);

  const r = runDaily({ root: fx.root, tmpdir: tmp, logPath, budgetBytes: before - 20000, procText: "", print: () => {}, ...noSweep });
  assert.equal(r.exitCode, 0);
  assert.ok(!existsSync(staleTemp), "24 h-stale temp target removed");
  assert.ok(measureDirStrict(fx.target).bytes <= before - 20000);
  const { rows } = readLog(logPath);
  assert.ok(rows.every((x) => x.trigger === "daily"));
  assert.ok(rows.some((x) => x.category === "temp-target") && rows.some((x) => x.category === "deps-superseded"));

  // A capped %TEMP% walk says so in one line — silence there would be
  // "could not check" dressed as "clean".
  const capLines = [];
  mkdirSync(join(tmp, "a")); mkdirSync(join(tmp, "b")); mkdirSync(join(tmp, "c"));
  runDaily({ root: fx.root, tmpdir: tmp, logPath, dryRun: true, maxTempDirs: 1, budgetBytes: before, procText: "", print: (l) => capLines.push(l), ...noSweep });
  assert.equal(capLines.filter((l) => /WARNING: temp walk stopped at 1 directories/.test(l)).length, 1);

  let out = "";
  printLog(5, { path: logPath, out: { write: (s) => { out += s; } } });
  assert.match(out, /last 30 days: \d+ eviction\(s\), .* freed/);
});
