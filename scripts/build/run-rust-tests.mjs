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
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectPe } from './inspect-pe-imports.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const MANIFEST = join(HERE, 'comctl32-v6.manifest');
const CARGO_TOML = join(REPO_ROOT, 'src-tauri', 'Cargo.toml');

const argv = process.argv.slice(2);
const sepIdx = argv.indexOf('--');
const flags = sepIdx >= 0 ? argv.slice(0, sepIdx) : argv;
const harnessArgs = sepIdx >= 0 ? argv.slice(sepIdx + 1) : [];
const cratesLane = flags.includes('--crates');

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
  if (out.status !== 0) process.exit(out.status ?? 1);
  const exes = [];
  for (const line of (out.stdout ?? '').split('\n')) {
    if (!line.startsWith('{')) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.reason === 'compiler-artifact' && msg.executable) exes.push(msg.executable);
  }
  return exes;
}

const cargoArgs = cratesLane
  ? ['test', '--manifest-path', CARGO_TOML, '-p', 'personas-core', '-p', 'personas-db', '-p', 'personas-engine', '--lib']
  : ['test', '--manifest-path', CARGO_TOML, '--features', 'desktop', '--lib'];

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
  const run = spawnSync(exe, harnessArgs, { stdio: 'inherit' });
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
process.exit(failed === 0 ? 0 : 1);
