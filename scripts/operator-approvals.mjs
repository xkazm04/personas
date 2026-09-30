#!/usr/bin/env node
/**
 * operator-approvals - the operator's headless approval desk over the management API
 * (docs/architecture/cloud-integration-bridge.md §10.10).
 *
 *   node scripts/operator-approvals.mjs list                      pending approvals + pending pairings
 *   node scripts/operator-approvals.mjs approve <id> [note...]    approve one approval (appr_...)
 *   node scripts/operator-approvals.mjs reject <id> [reason...]   reject one approval
 *   node scripts/operator-approvals.mjs pair-approve <nonce>      approve a pending pairing
 *   node scripts/operator-approvals.mjs pair-reject <nonce>       reject a pending pairing
 *
 * The token is read from the operator key file Personas writes at boot
 * (<app data>/operator-api-key; PERSONAS_DATA_DIR overrides the directory) and is never
 * printed. PERSONAS_BRIDGE_URL overrides http://127.0.0.1:9420. This is the OPERATOR's
 * tool: a paired app's key cannot use these routes (personas:approve is never pairable).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = (process.env.PERSONAS_BRIDGE_URL || 'http://127.0.0.1:9420').replace(/\/+$/, '');

function dataDir() {
  if (process.env.PERSONAS_DATA_DIR) return process.env.PERSONAS_DATA_DIR;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'com.personas.desktop');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'com.personas.desktop');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'com.personas.desktop');
}

function token() {
  const file = path.join(dataDir(), 'operator-api-key');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (t) return t;
  } catch {
    /* reported below: a missing file means the app has not booted, or PERSONAS_OPERATOR_KEY=0 */
  }
  console.error(`No operator key at ${file}. Start the Personas desktop app (it writes the key at boot).`);
  process.exit(2);
}

async function call(method, route, body) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((e) => {
    console.error(`Personas unreachable at ${base}: ${e.message}`);
    process.exit(2);
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    console.error(`${method} ${route} -> ${res.status} ${json?.code ?? ''} ${json?.error ?? ''}`.trim());
    process.exit(1);
  }
  return json?.data ?? json;
}

const [cmd, arg, ...rest] = process.argv.slice(2);
const text = rest.join(' ').trim() || undefined;

switch (cmd) {
  case 'list': {
    const { approvals } = await call('GET', '/api/approvals?status=pending');
    const { pairings } = await call('GET', '/api/pairings/pending');
    console.log(`Pending approvals: ${approvals.length}`);
    for (const a of approvals) {
      const s = a.summary ?? {};
      const what = s.personaName ? `${s.personaName}${s.placementWorkspaceName ? ` -> workspace '${s.placementWorkspaceName}'` : ''}${s.maxBudgetUsd != null ? `, $${s.maxBudgetUsd}` : ''}` : (a.rationale ?? '').slice(0, 120);
      console.log(`  ${a.id}  ${a.action}  ${what}  (by ${a.requestedBy?.keyName ?? 'unknown'}, expires ${a.expiresAt})`);
    }
    console.log(`Pending pairings: ${pairings.length}`);
    for (const p of pairings) console.log(`  ${p.nonce}  ${p.appName ?? ''} from ${p.origin}  scopes ${JSON.stringify(p.requestedScopes)}`);
    break;
  }
  case 'approve':
  case 'reject': {
    if (!arg) { console.error(`usage: ${cmd} <approval id> [${cmd === 'approve' ? 'note' : 'reason'}]`); process.exit(2); }
    const body = cmd === 'approve' ? (text ? { note: text } : {}) : (text ? { reason: text } : {});
    const r = await call('POST', `/api/approvals/${encodeURIComponent(arg)}/${cmd}`, body);
    console.log(`${r.id}: ${r.status}${r.personaId ? ` persona ${r.personaId}` : ''}${r.building ? ' (building)' : ''} - ${r.message ?? ''}`);
    break;
  }
  case 'pair-approve':
  case 'pair-reject': {
    if (!arg) { console.error(`usage: ${cmd} <nonce>`); process.exit(2); }
    const r = await call('POST', `/api/pairings/${encodeURIComponent(arg)}/${cmd === 'pair-approve' ? 'approve' : 'reject'}`, {});
    console.log(`${r.nonce}: ${r.status} ${r.origin ?? ''}${r.scopes ? ` scopes ${JSON.stringify(r.scopes)}` : ''}`);
    break;
  }
  default:
    console.log('usage: operator-approvals.mjs list | approve <id> [note] | reject <id> [reason] | pair-approve <nonce> | pair-reject <nonce>');
    process.exit(cmd ? 2 : 0);
}
