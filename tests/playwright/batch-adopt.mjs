/** Run auto-adopt.mjs for several templates sequentially (one at a time — the
 * live app is a singleton). Usage: node tests/playwright/batch-adopt.mjs "A" "B" ... */
import { spawn } from 'node:child_process';

const names = process.argv.slice(2);
if (!names.length) { console.error('usage: batch-adopt.mjs "Template A" "Template B" ...'); process.exit(1); }

function run(name) {
  return new Promise((resolve) => {
    console.log(`\n######## ADOPT: ${name} ########`);
    const p = spawn('node', ['tests/playwright/auto-adopt.mjs', name], { stdio: 'inherit' });
    p.on('close', (code) => { console.log(`######## ${name} exited ${code} ########`); resolve(code); });
  });
}

for (const n of names) {
  await run(n);
  await new Promise((r) => setTimeout(r, 2500)); // settle between adoptions
}
console.log('\n=== batch complete ===');
