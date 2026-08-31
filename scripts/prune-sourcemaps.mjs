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
// This script does NOT touch sourcemap generation (still `hidden` in
// vite.config.ts) and does NOT change what Sentry receives — it only moves
// where the files land on disk after `vite build` finishes, before Tauri
// (or anything else) reads dist/.
//
// Wiring: local packaging only (tauri.conf.json's `beforeBuildCommand`, so
// `tauri build` / `tauri:build:lite` / `tauri:build:stable` all get it). CI's
// release.yml builds the frontend once in its own job and uploads `dist/` as
// an artifact for the Sentry-sourcemap-upload step in a LATER job to read —
// wiring this into that pipeline needs the artifact upload/download and the
// `upload-sourcemaps` step's source path updated together, which is out of
// this change's verified scope. See the CLI report for that follow-up.

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
    console.log('prune-sourcemaps: no .map files found in dist/ — nothing to prune.');
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
