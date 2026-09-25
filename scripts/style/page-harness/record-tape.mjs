#!/usr/bin/env node
// Record an IPC tape from the RUNNING app, for the style page harness.
//
// Needs the app up with the test-automation bridge (`npm run tauri:dev:test`,
// HTTP on :17320). The recorder itself is src/test/automation/ipcTape.ts,
// reached over /bridge-exec: tapeStart -> (boot commands, route steps) ->
// settle -> tapeStop -> tapeDump in pages. The tap sits in invokeWithTimeout
// (src/lib/tauriInvoke.ts), so the app must be running a build that has it.
//
//   node scripts/style/page-harness/record-tape.mjs --module overview/sub_events
//   node scripts/style/page-harness/record-tape.mjs --module home/sub_releases --manual
//
// --manual skips the scripted route steps: navigate in the app yourself, then
// press Enter. Default output: tmp/style-tapes/<module with / as __>.json.
// Tapes can hold personal data: they stay under tmp/ (gitignored), never commit one.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const BRIDGE = (process.env.TEST_AUTOMATION_URL || '').trim() || 'http://127.0.0.1:17320';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const moduleId = opt('module');
const modules = JSON.parse(readFileSync(join(HERE, 'modules.json'), 'utf8'));
if (!moduleId || !modules[moduleId]) {
  console.error(`--module <id> required; known: ${Object.keys(modules).filter((k) => !k.startsWith('$')).join(', ')}`);
  process.exit(2);
}
const spec = modules[moduleId];
const out = resolve(opt('out', join(REPO, 'tmp', 'style-tapes', `${moduleId.replace(/\//g, '__')}.json`)));
const settleMs = Number(opt('settle', '4000'));

async function exec(method, params = {}) {
  if (flag('verbose')) console.log(`-> ${method} ${JSON.stringify(params).slice(0, 120)}`);
  const res = await fetch(`${BRIDGE}/bridge-exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  const health = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(2500) }).catch(() => null);
  if (!health?.ok) throw new Error(`no test-automation bridge at ${BRIDGE}; start the app with npm run tauri:dev:test`);

  const started = await exec('tapeStart');
  if (!started?.success) throw new Error(`tapeStart failed: ${JSON.stringify(started)}`);
  const recordedAt = new Date().toISOString();
  // Boot commands go through the bridge's raw invoke, which the tap does not
  // see, so their answers are added here as wildcards (no args): the page's
  // own boot-time call shape is not known to this script.
  const bootCalls = [];
  try {
    for (const [cmd, params] of spec.boot ?? []) {
      const r = await exec('invokeCommand', { command: cmd, params: params ?? {} });
      if (r?.success) bootCalls.push({ cmd, response: r.result ?? null });
      else console.warn(`boot command ${cmd} failed: ${r?.error}`);
    }
    if (flag('manual') || !spec.record?.length) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      await rl.question(`Tape is rolling. Open ${spec.title ?? moduleId} in the app, let it settle, then press Enter. `);
      rl.close();
    } else {
      for (const step of spec.record) {
        const r = await exec(step.method, step.params ?? {});
        if (r && r.success === false) console.warn(`step ${step.method} ${JSON.stringify(step.params)}: ${r.error}`);
        await new Promise((ok) => setTimeout(ok, 600));
      }
      await new Promise((ok) => setTimeout(ok, settleMs));
    }
  } finally {
    await exec('tapeStop');
  }

  const calls = [...bootCalls];
  for (let offset = 0; ; ) {
    const page = await exec('tapeDump', { offset, limit: 100 });
    for (const e of page.entries ?? []) {
      calls.push(e.error !== undefined ? { cmd: e.cmd, args: e.args, error: e.error } : { cmd: e.cmd, args: e.args, response: e.response });
    }
    offset += (page.entries ?? []).length;
    if (!page.entries?.length || offset >= page.total) break;
  }
  const seen = new Set(calls.map((c) => c.cmd));
  const filled = Object.entries(spec.fill ?? {}).filter(([cmd]) => !seen.has(cmd));
  for (const [cmd, response] of filled) calls.push({ cmd, response });
  const note = `Recorded from ${BRIDGE}.${filled.length ? ` Not reached while recording, answered from modules.json fill: ${filled.map(([c]) => c).join(', ')}.` : ''}`;
  const tape = { version: 1, module: moduleId, source: 'recorded', recordedAt, note, calls };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(tape, null, 2));
  const cmds = [...new Set(calls.map((c) => c.cmd))];
  console.log(`${calls.length} calls, ${cmds.length} commands -> ${out}`);
  console.log(`shoot it: node scripts/style/shoot.mjs --module ${moduleId} --tape ${out} --out tmp/style-shots/<name> --label before`);
}

main().catch((err) => { console.error(err?.message ?? err); process.exit(1); });
