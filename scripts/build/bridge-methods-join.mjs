#!/usr/bin/env node
/**
 * Join the test-automation bridge across the wire: every method name the Rust
 * side dispatches into `window.__TEST__` must be a method the JS side
 * actually installs.
 *
 * Why this exists. `unused-commands.mjs` joins the TS -> Rust direction
 * (registered Tauri commands nobody invokes). Nothing joined the reverse
 * direction: `src-tauri/src/test_automation.rs` calls
 * `eval_bridge_method*("name", ...)` and the name is resolved at runtime by
 * `__exec__` in `src/test/automation/bridge.ts` (parameter-name reflection).
 * A renamed or deleted bridge method breaks a test-driver endpoint with no
 * compile error on either side, and knip cannot see the caller because it is
 * Rust. This is the "cross-boundary registration" orphan class from the
 * registry's dead-code roster; this file is its instrument for this direction.
 *
 * It is dependency-free, read-only, and biased toward over-reporting: a name
 * the Rust side assembles at runtime would be invisible here (none exist
 * today), and a JS method installed under a computed key would read as
 * missing. Both are reported as candidates, never verdicts.
 *
 * Usage:
 *   node scripts/build/bridge-methods-join.mjs            # exit 1 on any unresolved name
 *   node scripts/build/bridge-methods-join.mjs --self-test  # prove it can fail
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUST = path.join(root, 'src-tauri', 'src', 'test_automation.rs');
const JS = [
  path.join(root, 'src', 'test', 'automation', 'bridge.ts'),
  path.join(root, 'src', 'test', 'automation', 'perfInstrument.ts'),
];

function rustInvokedNames(src) {
  // eval_bridge_method("name", ...) / eval_bridge_method_with_timeout(&state, "name", ...)
  // The call may be split over lines, so match the call head then the first string literal after it.
  const names = new Set();
  const re = /eval_bridge_method(?:_with_timeout)?\s*\(\s*(?:&?\w+\s*,\s*)?"([A-Za-z_][A-Za-z0-9_]*)"/g;
  for (const m of src.matchAll(re)) names.add(m[1]);
  return names;
}

function jsInstalledNames(sources) {
  // Two install shapes exist today:
  //   object-literal methods on the bridge:   `  async cliCaptureRun(serviceType) {`  /  `  navigate: (...) =>`
  //   late assignment onto the bridge object: `testBridge.perfMark = (label) => {`
  const names = new Set();
  for (const src of sources) {
    for (const m of src.matchAll(/^\s*(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|:\s*(?:async\s*)?\()/gm)) names.add(m[1]);
    for (const m of src.matchAll(/\b(?:testBridge|bridge|window\.__TEST__)\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) names.add(m[1]);
  }
  return names;
}

function join(rustSrc, jsSrcs) {
  const invoked = rustInvokedNames(rustSrc);
  const installed = jsInstalledNames(jsSrcs);
  const unresolved = [...invoked].filter((n) => !installed.has(n)).sort();
  return { invoked: invoked.size, installed: installed.size, unresolved };
}

function selfTest() {
  // The instrument must be able to return the other answer: inject one call the
  // JS side does not install and require it to be reported, then confirm the
  // real tree resolves fully. A check that cannot fail certifies nothing.
  const rust = fs.readFileSync(RUST, 'utf8');
  const js = JS.map((p) => fs.readFileSync(p, 'utf8'));
  const poisoned = rust + '\n// self-test\nasync fn __st() { eval_bridge_method(&state, "definitelyNotInstalled", &json!({})).await }\n';
  const r = join(poisoned, js);
  if (!r.unresolved.includes('definitelyNotInstalled')) {
    console.error('self-test FAILED: injected unresolved name was not reported');
    process.exit(2);
  }
  if (r.unresolved.length !== 1) {
    console.error(`self-test FAILED: expected exactly 1 unresolved after injection, got ${r.unresolved.length}: ${r.unresolved.join(', ')}`);
    process.exit(2);
  }
  console.log(`self-test OK: ${r.invoked} invoked names, ${r.installed} installed methods, injected miss reported and nothing else`);
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

for (const p of [RUST, ...JS]) {
  if (!fs.existsSync(p)) {
    console.error(`bridge-methods-join: missing ${path.relative(root, p)} - the instrument cannot run, refusing to report green`);
    process.exit(2);
  }
}
const result = join(fs.readFileSync(RUST, 'utf8'), JS.map((p) => fs.readFileSync(p, 'utf8')));
console.log(`bridge-methods-join: ${result.invoked} names dispatched from Rust, ${result.installed} methods installed on window.__TEST__`);
if (result.unresolved.length) {
  console.log(`UNRESOLVED (${result.unresolved.length}) - dispatched by Rust, not installed by JS (candidates, not verdicts):`);
  for (const n of result.unresolved) console.log(`  ${n}`);
  process.exit(1);
}
console.log('all dispatched names resolve');
