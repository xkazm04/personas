// One-off audit script for the requires-macro migration: reports any
// require_privileged_sync / require_privileged / require_cloud_auth call
// whose literal command-name argument does not match its enclosing fn name.
//
// Each divergence is an existing latent bug (renamed fn, stale literal in
// audit logs) — the macro fixes it by auto-deriving the name from `fn`.
// Reporting them upfront makes the audit-log delta explicit.

import fs from 'node:fs';
import path from 'node:path';

function walkRs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkRs(p));
    else if (e.name.endsWith('.rs')) out.push(p);
  }
  return out;
}

const files = walkRs('src-tauri/src/commands');
const divergent = [];
const matched = { sync: 0, async_p: 0, cloud: 0 };

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/require_(privileged_sync|privileged|cloud_auth)\(&state,\s*"([^"]+)"/);
    if (!m) continue;
    const guard = m[1];
    const literal = m[2];
    let fnName = null;
    for (let j = i - 1; j >= Math.max(0, i - 30); j--) {
      const fm = lines[j].match(/^pub\s+(async\s+)?fn\s+(\w+)/);
      if (fm) { fnName = fm[2]; break; }
    }
    if (!fnName) continue;
    if (literal === fnName) {
      if (guard === 'privileged_sync') matched.sync++;
      else if (guard === 'privileged') matched.async_p++;
      else if (guard === 'cloud_auth') matched.cloud++;
    } else {
      divergent.push({ file: f.replaceAll('\\', '/'), line: i + 1, fn: fnName, literal, guard });
    }
  }
}

console.log('Matched (literal == fn_name):');
console.log('  privileged_sync:', matched.sync);
console.log('  privileged (async):', matched.async_p);
console.log('  cloud_auth:', matched.cloud);
console.log('  Total matched:', matched.sync + matched.async_p + matched.cloud);
console.log('');
console.log('DIVERGENT (literal != fn_name):', divergent.length);
for (const d of divergent) {
  console.log(`  ${d.file}:${d.line} fn=${d.fn} literal="${d.literal}" guard=${d.guard}`);
}
