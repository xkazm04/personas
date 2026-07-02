#!/usr/bin/env node
/**
 * Patch dependencies that ASSIGN to inherited Object.prototype members
 * (`x.toString = fn`) at module scope — a pattern that throws
 * "Cannot assign to read only property 'toString'" when the runtime freezes
 * `Object.prototype`.
 *
 * Why: since ~2026-06-28 the machine-wide WebView2 environment (an Edge
 * experiment — independent of runtime version 149.0.4022.80/.98, profile, and
 * variations seed; a fresh about:blank realm is born frozen) creates realms
 * with `Object.isFrozen(Object.prototype) === true`. In strict-mode ESM,
 * assigning a member that shadows a frozen inherited data property throws, so
 * `@xterm/xterm` (and `@xterm/addon-webgl` — both vendor VS Code's
 * KeyCodeUtils namespace) die at import time and take the Fleet page with
 * them. `public/webview2-compat.js` used to convert these prototype members to
 * accessors, but the frozen prototype is now also non-configurable, so the
 * shim can no longer apply.
 *
 * Fix: rewrite the assignment into Object.defineProperty, which defines an OWN
 * property and is always legal on a non-frozen target regardless of the
 * prototype's state. Idempotent — safe to run repeatedly; wired to
 * `postinstall` so reinstalls/upgrades re-apply (and it reports when an
 * upgrade made the patch unnecessary).
 *
 * After running this you must clear the Vite dep cache (node_modules/.vite)
 * so the optimizer re-bundles the patched sources — `predev` does this
 * automatically when the patch changes a file.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Files known to carry the namespace `X.toString = fn;` assignment. */
const TARGETS = [
  'node_modules/@xterm/xterm/lib/xterm.mjs',
  'node_modules/@xterm/xterm/lib/xterm.js',
  'node_modules/@xterm/addon-webgl/lib/addon-webgl.mjs',
  'node_modules/@xterm/addon-webgl/lib/addon-webgl.js',
];

// `<ident>.toString=<ident>;` (minified namespace pattern). Deliberately does
// NOT match `.prototype.toString=` (legal: own property of a plain prototype
// object) or longer right-hand sides.
const PATTERN = /\b([A-Za-z_$][\w$]*)\.toString=([A-Za-z_$][\w$]*);/g;

let patchedAny = false;
for (const rel of TARGETS) {
  const file = resolve(root, rel);
  if (!existsSync(file)) {
    console.warn(`[fix-frozen-intrinsics] missing (skipped): ${rel}`);
    continue;
  }
  const src = readFileSync(file, 'utf8');
  if (src.includes('__frozen_intrinsics_patched__')) {
    console.log(`[fix-frozen-intrinsics] already patched: ${rel}`);
    continue;
  }
  let count = 0;
  const out = src.replace(PATTERN, (_m, obj, fn) => {
    count++;
    return `Object.defineProperty(${obj},"toString",{value:${fn},writable:true,configurable:true});`;
  });
  if (count === 0) {
    console.log(`[fix-frozen-intrinsics] no match in ${rel} — dependency may have fixed it upstream`);
    continue;
  }
  writeFileSync(file, `${out}\n/*__frozen_intrinsics_patched__*/\n`);
  console.log(`[fix-frozen-intrinsics] patched ${count} assignment(s) in ${rel}`);
  patchedAny = true;
}

if (patchedAny) {
  // Invalidate the Vite dep cache so the optimizer re-bundles patched sources.
  const viteCache = resolve(root, 'node_modules/.vite');
  if (existsSync(viteCache)) {
    rmSync(viteCache, { recursive: true, force: true });
    console.log('[fix-frozen-intrinsics] cleared node_modules/.vite (dep cache re-bundles on next dev/build)');
  }
}
