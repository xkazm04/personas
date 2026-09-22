#!/usr/bin/env node
// `npm run typecheck:native` -- `tsc --noEmit` with the TS 7 native compiler.
//
// WHY A WRAPPER AND NOT `tsc` FROM node_modules/.bin. TS 7 ships as the package
// `typescript` with the bin name `tsc` -- both already taken here by TS 6, which has to
// stay: TS 7.0 has no programmatic API, and the gate daemon (a warm builder program),
// typescript-eslint and ts-rs tooling all import the TS 6 one. So the native compiler
// enters as an npm ALIAS, `typescript-native` -> `npm:typescript@7`, and is only ever
// run by explicit path. Measured 2026-09-18 in a scratch install: with both present
// `.bin/tsc` stayed 6.0.3 under `npm install` and under `npm ci`, but nothing here
// depends on that staying true.
//
// ITS OWN tsBuildInfo. tsconfig.json points `tsBuildInfoFile` at ./tsconfig.tsbuildinfo.
// Two compilers sharing that file would each discard the other's and rewrite it, so
// every alternation (this script, then a pre-push cold fallback on TS 6) would be a cold
// build for both. Measured: with the override below the TS 6 file's sha256 is unchanged
// across native runs.
//
// NOT INSTALLED IS AN ERROR, not a fallback to TS 6: a gate that quietly became ten
// times slower would go unnoticed for months. TSGO_BIN overrides the lookup, which is
// how the zero-diff probe (scripts/gate/tsgo-diff.mjs) and the ledger rows were taken
// before the dependency existed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function resolveNative() {
  if (process.env.TSGO_BIN) return path.resolve(process.env.TSGO_BIN);
  try {
    const pkg = createRequire(path.join(root, 'package.json')).resolve('typescript-native/package.json');
    return path.join(path.dirname(pkg), 'bin', 'tsc');
  } catch {
    return null;
  }
}

const bin = resolveNative();
if (!bin || !fs.existsSync(bin)) {
  process.stderr.write(
    'typecheck:native: the TS 7 native compiler is not installed.\n' +
      '  npm install --save-dev --save-exact typescript-native@npm:typescript@7.0.2\n' +
      '  (or set TSGO_BIN to a native bin/tsc). `npx tsc --noEmit` is the TS 6 equivalent.\n',
  );
  process.exit(2);
}

// Keyed by the checkout root: worktrees reach ONE node_modules through a junction, and two
// checkouts writing one buildinfo would evict each other on every run.
const rootKey = crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 12);
const cacheDir = path.join(root, 'node_modules', '.cache', 'tsgo', rootKey);
fs.mkdirSync(cacheDir, { recursive: true });
const r = spawnSync(
  process.execPath,
  [bin, '--noEmit', '-p', path.join(root, 'tsconfig.json'), '--tsBuildInfoFile', path.join(cacheDir, 'tsconfig.tsbuildinfo'), ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit' },
);
if (r.error) {
  process.stderr.write(`typecheck:native: ${r.error.message}\n`);
  process.exit(2);
}
process.exit(r.status ?? 2);
