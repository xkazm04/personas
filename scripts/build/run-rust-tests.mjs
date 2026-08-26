#!/usr/bin/env node
// Run the Rust test suite, working around the Windows comctl32 v6 loader trap.
//
// THE PROBLEM
// -----------
// The crate's dependency graph (tauri dialog APIs -> rfd) imports
// TaskDialogIndirect from comctl32.dll. That entry point exists only in the
// comctl32 *version 6* side-by-side assembly. A binary that does not request
// v6 in an embedded manifest gets bound to the legacy v5.82 comctl32 and dies
// at LOAD time with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) -- before main().
// The symptom is a bare exit code 127 and zero output.
//
// tauri-build embeds the needed manifest, but only into BIN targets. So the
// application always worked while `cargo test` was completely dead on Windows.
// CI never caught it because CI runs the Rust suite on Linux.
//
// CORRECTION 2026-08-14: `.github/workflows/ci.yml`'s Rust job is a MATRIX over
// windows-latest, macos-latest and ubuntu-24.04, and the Windows leg runs
// `cargo test` bare (ci.yml:275) with no manifest fixup. So either that leg is
// red, or the trap does not reproduce on the runner (plausibly a different
// dependency graph, since the failure comes via rfd/tauri dialog APIs). Not
// resolvable without compiling, and cargo runs are guarded on this machine —
// flagged rather than guessed. The sentence above is kept because it records
// what was believed when the fixup was written.
//
// WHY THIS IS A POST-LINK STEP AND NOT build.rs
// ---------------------------------------------
// Cargo has no build-script directive that targets the *lib unit-test* binary:
//   - `cargo:rustc-link-arg-tests` reaches only tests/ integration targets.
//     Verified: the lib harness relinked without picking it up.
//   - `cargo:rustc-link-arg` (catch-all) DOES reach it -- and necessarily also
//     hits the app binary and the cdylib. On the app binary that collides with
//     tauri's own RT_MANIFEST (`CVT1100: duplicate resource`), and on the
//     cdylib mt.exe fails outright (`LNK1327`).
// Making it work through build.rs therefore means disabling tauri's manifest
// and changing how the SHIPPING binary is produced, to fix test tooling. Not
// worth the risk. Embedding after the fact touches only the test executables,
// needs no rebuild, and shares the existing artifact cache.
//
// Usage:
//   node scripts/build/run-rust-tests.mjs [--crates] [-- <libtest args>]
//     (default)  app_lib unit tests (--features desktop), with the manifest fixup
//     --crates   the extracted crates only: personas-core, -db, -engine
//
// A NOTE ON "FAST": --crates is a NARROWER lane, not a quick one. It was
// scoped on the assumption that the extracted crates avoid the heavy
// dependency tree; they do not. personas-db and personas-engine both depend on
// tauri (src-tauri/{db,engine}/Cargo.toml), and personas-core pulls reqwest +
// sentry. Only the app_lib-specific surface is skipped. Treat --crates as
// "test the extracted crates" and expect a cold build to be minutes, not
// seconds. Do not present it to anyone as a full-suite substitute.
//
// Anything after `--` is forwarded to the test harness, e.g.
//   node scripts/build/run-rust-tests.mjs -- --nocapture healing::

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectPe } from './inspect-pe-imports.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const MANIFEST = join(HERE, 'comctl32-v6.manifest');
const CARGO_TOML = join(REPO_ROOT, 'src-tauri', 'Cargo.toml');

const argv = process.argv.slice(2);
// `npm run test:rust -- foo` consumes the `--` itself, so by the time argv
// reaches here the separator is usually gone. Treat anything this script does
// not recognise as a harness argument, which makes both of these filter:
//   npm run test:rust -- some::test
//   node scripts/build/run-rust-tests.mjs -- --nocapture some::test
const OWN_FLAGS = new Set(['--crates']);
const sepIdx = argv.indexOf('--');
const own = sepIdx >= 0 ? argv.slice(0, sepIdx) : argv;
const harnessArgs = sepIdx >= 0 ? argv.slice(sepIdx + 1) : [];
for (const a of own) if (!OWN_FLAGS.has(a)) harnessArgs.push(a);
const cratesLane = own.includes('--crates');

/** Locate the Windows SDK manifest tool. Highest SDK version wins. */
function findMtExe() {
  if (process.env.MT_EXE && existsSync(process.env.MT_EXE)) return process.env.MT_EXE;
  const roots = [
    'C:/Program Files (x86)/Windows Kits/10/bin',
    'C:/Program Files/Windows Kits/10/bin',
  ];
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const version of readdirSync(root)) {
      const candidate = join(root, version, 'x64', 'mt.exe');
      if (existsSync(candidate)) found.push({ version, candidate });
    }
  }
  found.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  return found.length ? found[found.length - 1].candidate : null;
}

/** Embed the v6 manifest into `exe` if -- and only if -- it needs one. */
function ensureManifest(exe) {
  let pe;
  try {
    pe = inspectPe(exe);
  } catch {
    return { patched: false, reason: 'not a PE image' };
  }
  if (pe.hasManifest) return { patched: false, reason: 'already has a manifest' };

  const needsV6 = pe.imports.some(
    (i) => i.dll.toLowerCase() === 'comctl32.dll' && i.symbols.includes('TaskDialogIndirect'),
  );
  // Surgical on purpose: the extracted crates' test binaries do not import
  // comctl32 at all and must be left untouched.
  if (!needsV6) return { patched: false, reason: 'does not import TaskDialogIndirect' };

  const mt = findMtExe();
  if (!mt) {
    throw new Error(
      `${exe} needs a comctl32 v6 manifest but mt.exe was not found.\n` +
        'Install the Windows SDK, or set MT_EXE to its path.\n' +
        'Without it this binary will exit 127 (0xc0000139) before running any test.',
    );
  }
  execFileSync(mt, ['-nologo', '-manifest', MANIFEST, `-outputresource:${exe};#1`], {
    stdio: 'pipe',
  });
  return { patched: true, reason: 'embedded comctl32 v6 manifest' };
}

/** Build without running, and return the test executables cargo produced. */
function buildTestExecutables(cargoArgs) {
  // stdout is captured (it carries the JSON artifact stream) but stderr is
  // inherited, so cargo's compile progress and diagnostics stay live on the
  // terminal. Capturing both would leave the user staring at nothing for
  // several minutes on a cold build.
  const out = spawnSync(
    'cargo',
    [...cargoArgs, '--no-run', '--message-format=json'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['inherit', 'pipe', 'inherit'],
    },
  );
  const exes = [];
  const diagnostics = [];
  for (const line of (out.stdout ?? '').split('\n')) {
    if (!line.startsWith('{')) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.reason === 'compiler-artifact' && msg.executable) exes.push(msg.executable);
    // `--message-format=json` moves compiler diagnostics OUT of stderr and into
    // this stdout stream, which we capture -- so without re-emitting them a
    // failed build prints only cargo's one-line summary and the actual error is
    // invisible. That cost a debugging round the first time it happened.
    if (msg.reason === 'compiler-message' && msg.message?.level === 'error') {
      diagnostics.push(msg.message.rendered ?? msg.message.message ?? '');
    }
  }

  if (out.status !== 0) {
    for (const d of diagnostics) process.stderr.write(d.endsWith('\n') ? d : `${d}\n`);
    if (diagnostics.length === 0) {
      process.stderr.write(
        'Build failed but cargo emitted no error diagnostic. This is usually a LINK\n' +
          'failure. Re-run without --message-format=json to see it:\n' +
          `  cargo ${cargoArgs.join(' ')} --no-run\n`,
      );
    }
    process.exit(out.status ?? 1);
  }
  return exes;
}

// `desktop` is NOT optional for a meaningful run. personas-core selects the
// OS-keychain master-key path behind it; without it the crate compiles its
// mobile stub and all ten crypto tests fail with "Keychain not available on
// this platform" — a configuration artefact, not a defect. Each crate declares
// its own `desktop`, so the features are package-qualified here. (The same
// class of mistake had CI's `cargo test` never compiling at all: see
// .github/workflows/ci.yml.)
const cargoArgs = cratesLane
  ? [
      'test', '--manifest-path', CARGO_TOML,
      '-p', 'personas-core', '-p', 'personas-db', '-p', 'personas-engine', '--lib',
      '--features', 'personas-core/desktop,personas-db/desktop,personas-engine/desktop',
    ]
  : ['test', '--manifest-path', CARGO_TOML, '--features', 'desktop', '--lib'];

// Stamped before the build so every database this run creates sorts after it.
const RUN_STARTED_AT = Date.now();
console.log(`> cargo ${cargoArgs.join(' ')}`);
const executables = buildTestExecutables(cargoArgs);
if (executables.length === 0) {
  console.error('No test executables were produced.');
  process.exit(1);
}

if (process.platform === 'win32') {
  for (const exe of executables) {
    const { patched, reason } = ensureManifest(exe);
    if (patched) console.log(`  manifest: patched ${exe} (${reason})`);
  }
}

let failed = 0;
for (const exe of executables) {
  const run = spawnSync(exe, harnessArgs, {
    stdio: 'inherit',
    // ts-rs reads TS_RS_EXPORT_DIR at test-exe runtime. Under `cargo test` the
    // cwd is the crate dir so the relative default resolves correctly, but this
    // script spawns the exe directly from the repo root — without an explicit
    // ABSOLUTE export dir, ts-rs fell back to ./bindings under the cwd and
    // silently dumped every export into the gitignored repo-root bindings/
    // (419 stale files by 2026-08-08, while src/lib/bindings/ drifted 26 files
    // behind the Rust structs). Absolute path = cwd-independent.
    env: {
      ...process.env,
      TS_RS_EXPORT_DIR: join(REPO_ROOT, 'src', 'lib', 'bindings'),
    },
  });
  if (run.status !== 0) {
    failed++;
    if (run.status === 127 || run.status === 0xc0000139) {
      console.error(
        `\n${exe} exited ${run.status} without running -- this is the loader failing, not a test failure.\n` +
          `Inspect it: node scripts/build/inspect-pe-imports.mjs "${exe}"`,
      );
    }
  }
}
/**
 * Reclaim the temp databases this run created.
 *
 * `personas_db::init_test_db` copies a migrated template to
 * `%TEMP%/personas_test_<uuid>.db` for every call, and nothing in the process
 * ever deletes it — a full suite leaks thousands of ~4.5 MB files. Measured
 * 2026-08-25 before this existed: **15,669 files / 70 GB accumulated in five
 * days**, the largest single reclaimable item on a volume that had just hit
 * zero bytes free.
 *
 * The crate sweeps at startup (`sweep_stale_test_dbs`), which bounds growth to
 * roughly one run. This closes the other half for the sanctioned path: the
 * files are dead the instant their test binary exits, and this script is the
 * one place that knows the run is over.
 *
 * Deliberately time-boxed rather than exhaustive, and deliberately silent about
 * individual failures: a file another process still holds is skipped, not
 * retried, because a cleanup step that can fail a green test run is worse than
 * the disk it reclaims.
 */
function sweepTestDatabases(startedAt) {
  const prefixes = [
    'personas_test_',
    'personas_user_test_',
    'personas_journal_',
    'personas_cdc_drop_',
    'mgmt_api_test_',
  ];
  const dir = tmpdir();
  let removed = 0;
  let bytes = 0;
  try {
    for (const name of readdirSync(dir)) {
      if (!prefixes.some((p) => name.startsWith(p))) continue;
      const full = join(dir, name);
      try {
        const st = statSync(full);
        if (!st.isFile()) continue;
        // Only this run's files. An older one belongs to a process that may
        // still be alive; the crate-side sweep reclaims those on its own clock.
        if (st.mtimeMs < startedAt) continue;
        rmSync(full, { force: true });
        removed++;
        bytes += st.size;
      } catch {
        // Held, vanished, or denied — leave it for the next sweep.
      }
    }
  } catch {
    // No temp dir to read is not a test failure.
  }
  if (removed > 0) {
    console.log(`  cleaned ${removed} temp test database(s), ${(bytes / 1024 / 1024).toFixed(0)} MB`);
  }
}

sweepTestDatabases(RUN_STARTED_AT);
process.exit(failed === 0 ? 0 : 1);
