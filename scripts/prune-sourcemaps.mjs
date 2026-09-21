#!/usr/bin/env node
// prune-sourcemaps.mjs — moves every *.map file out of dist/ into a sibling
// dist-sourcemaps/ directory (same relative path), so Tauri's frontendDist
// ("../dist") never packages sourcemaps into the installer.
//
// Why this exists (ADR "eager-bundle-leaks"): vite.config.ts sets
// `sourcemap: "hidden"` on purpose (Sentry needs them to symbolicate crash
// reports) — hidden maps are emitted to disk but not referenced by a
// `//# sourceMappingURL=` comment, so they're safe to ship separately. The
// defect was never sourcemap *generation*; it was that they landed inside
// the directory Tauri bundles wholesale. ~1,400 .map files, tens of MB, rode
// into every installer for no runtime benefit — nothing in the shipped app
// ever reads them.
//
// This script does NOT generate sourcemaps and does NOT change what Sentry
// receives — it only moves where the files land on disk after `vite build`
// finishes, before Tauri (or anything else) reads dist/.
//
// UPDATED 2026-09-20. Two things changed under it:
//
//  1. Generation is now conditional. `vite.config.ts` emits `hidden` maps only
//     when `PERSONAS_RELEASE=1`, so the ordinary case for this script is now
//     "there are none, by design". That is NOT the same outcome as "the walk
//     found none", and the two are reported differently below — a pruner that
//     says "nothing to prune" when the build silently stopped emitting maps is
//     a gate running green while checking nothing.
//  2. The CI hole this header used to describe as out of scope is CLOSED.
//     release.yml's frontend job now runs this script itself and uploads
//     `dist-sourcemaps/` as its own artifact, so `frontend-dist` — the artifact
//     tauri-action packages — is map-free and the installers no longer carry
//     ~1,500 .map files. The Sentry step reads both directories.
//
// Wiring: tauri.conf.json's `beforeBuildCommand` (so a local `tauri build` /
// `tauri:build:lite` / `tauri:build:stable` is covered) AND release.yml's
// frontend job.

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(repoRoot, 'dist');
const outDir = join(repoRoot, 'dist-sourcemaps');

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      out.push(full);
    }
  }
}

function main() {
  if (!existsSync(distDir)) {
    console.log('prune-sourcemaps: no dist/ — nothing to do (run after `vite build`).');
    return;
  }

  const maps = [];
  walk(distDir, maps);

  if (maps.length === 0) {
    // Say WHICH zero this is. "No maps because the build was told not to emit
    // them" is the expected path; "no maps although the build was told to emit
    // them" means generation broke and Sentry is about to receive nothing —
    // and the two used to print the same reassuring line.
    if (process.env.PERSONAS_RELEASE === '1') {
      console.error(
        'prune-sourcemaps: 0 maps in dist/ — but PERSONAS_RELEASE=1 asked for them. ' +
          'Sourcemap generation did not happen; Sentry will not be able to symbolicate this build.',
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      'prune-sourcemaps: 0 maps — sourcemaps are disabled for this build ' +
        '(vite emits them only when PERSONAS_RELEASE=1). Nothing to prune.',
    );
    return;
  }

  // Fresh per build: chunk hashes change every build, so a stale prior
  // dist-sourcemaps/ only accumulates dead entries for chunks that no
  // longer exist.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  let totalBytes = 0;
  for (const src of maps) {
    totalBytes += statSync(src).size;
    const rel = relative(distDir, src);
    const dest = join(outDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(src, dest);
  }

  const mb = (totalBytes / (1024 * 1024)).toFixed(1);
  console.log(`prune-sourcemaps: moved ${maps.length} .map file(s) (${mb} MB) from dist/ to dist-sourcemaps/.`);
}

main();
