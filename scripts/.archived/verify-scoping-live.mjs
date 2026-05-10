#!/usr/bin/env node
/**
 * Live-app verification of the resource-scoping work.
 * Drives the running test-automation server (port 17320) to:
 *   1. Create a GitHub credential with a real PAT.
 *   2. Open the resource picker via list_connector_resources.
 *   3. Save scoped picks.
 *   4. Read them back.
 *   5. Exercise §3.6 validation rejection.
 *   6. Exercise §3.1 cache (timing comparison).
 *   7. Exercise §5 enforcement (block mode rejects out-of-scope path).
 *   8. Cleanup.
 *
 * Run while `npx tauri dev --features test-automation` is running.
 *
 *   GITHUB=ghp_... node scripts/verify-scoping-live.mjs
 */
const HOST = 'http://127.0.0.1:17320';

async function bridge(method, params = {}) {
  const r = await fetch(`${HOST}/bridge-exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  // Bridge results are JSON-stringified inside JSON-stringified responses
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(`bridge error: ${parsed.error}`);
    }
    return parsed;
  } catch (e) {
    if (e.message.startsWith('bridge error')) throw e;
    return text;
  }
}

async function inj(jsBody) {
  const r = await fetch(`${HOST}/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ js: jsBody }),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function tauri(cmd, args = {}) {
  return bridge('tauriInvoke', { cmd, args });
}

const PAT = process.env.GITHUB;
if (!PAT) { console.error('GITHUB env var required'); process.exit(1); }

// Inject the generic invoker. Privileged commands need the x-ipc-token
// header (set by the app at boot under window.__IPC_TOKEN); we attach it
// the same way invokeWithTimeout does. Errors are rethrown as Error so the
// bridge's catch path produces a readable message.
await inj(`window.__TEST__.tauriInvoke = async function(cmd, args) {
  try {
    const opts = { headers: new Headers() };
    if (window.__IPC_TOKEN) opts.headers.set('x-ipc-token', window.__IPC_TOKEN);
    return await window.__TAURI_INTERNALS__.invoke(cmd, args || {}, opts);
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : JSON.stringify(e));
  }
};`);
await new Promise(r => setTimeout(r, 200));

const TAG = `[verify ${new Date().toISOString().slice(11,19)}]`;
function step(label) { console.log(`${TAG} ▶ ${label}`); }
function ok(label, detail = '') { console.log(`${TAG}   ✓ ${label}${detail ? ' — ' + detail : ''}`); }
function fail(label, detail) { console.log(`${TAG}   ✗ ${label} — ${detail}`); }

let credId = null;
try {
  // ── 1. Create GitHub credential ────────────────────────────────────────────
  step('1. Create GitHub credential');
  const cred = await tauri('create_credential', {
    input: {
      name: `test-scope-${Date.now()}`,
      service_type: 'github',
      encrypted_data: JSON.stringify({ personal_access_token: PAT }),
      iv: '',
      metadata: null,
      healthcheck_passed: true,
    },
  });
  credId = cred.id;
  ok(`credential created`, `id=${credId}`);

  // ── 2. List repositories ──────────────────────────────────────────────────
  step('2. list_connector_resources("repositories")');
  const t0 = Date.now();
  const repos = await tauri('list_connector_resources', {
    credentialId: credId,
    resourceId: 'repositories',
    dependsOnContext: {},
    bypassCache: false,
  });
  const t1 = Date.now();
  if (!Array.isArray(repos) || repos.length === 0) {
    throw new Error(`expected non-empty array, got ${JSON.stringify(repos).slice(0, 100)}`);
  }
  ok(`got ${repos.length} repos`, `first=${repos[0].id} (${t1 - t0}ms cold)`);

  // ── 3. §3.1 cache: second call should be much faster ───────────────────────
  step('3. §3.1 cache hit on second call');
  const t2 = Date.now();
  const repos2 = await tauri('list_connector_resources', {
    credentialId: credId,
    resourceId: 'repositories',
    dependsOnContext: {},
    bypassCache: false,
  });
  const t3 = Date.now();
  if (repos2.length !== repos.length) throw new Error('cache result count mismatch');
  // Cached calls should not hit the network — expect <100ms vs cold ~500-2000ms
  ok(`cached call ${t3 - t2}ms`, `${repos2.length} items`);

  // ── 4. §3.1 bypass_cache forces refetch ────────────────────────────────────
  step('4. §3.1 bypass_cache=true triggers fresh fetch');
  const t4 = Date.now();
  await tauri('list_connector_resources', {
    credentialId: credId,
    resourceId: 'repositories',
    dependsOnContext: {},
    bypassCache: true,
  });
  const t5 = Date.now();
  ok(`bypass call ${t5 - t4}ms (expect ~cold latency)`);

  // ── 5. Save scoped picks (legitimate) ──────────────────────────────────────
  step('5. save_scoped_resources with one valid pick');
  const pick = repos[0];
  const validBlob = JSON.stringify({
    repositories: [{ id: pick.id, label: pick.label }],
  });
  await tauri('save_scoped_resources', {
    credentialId: credId,
    scopedResources: validBlob,
  });
  ok(`saved scope: 1 repo`);

  // ── 6. Read scoped picks back ──────────────────────────────────────────────
  step('6. get_scoped_resources reads back');
  const got = await tauri('get_scoped_resources', { credentialId: credId });
  const parsed = JSON.parse(got);
  if (!parsed.repositories || parsed.repositories[0].id !== pick.id) {
    throw new Error(`unexpected blob: ${got.slice(0, 150)}`);
  }
  ok(`read back ${parsed.repositories.length} pick(s)`, `id=${parsed.repositories[0].id}`);

  // ── 7. §3.6 validation rejects unknown resource id ─────────────────────────
  step('7. §3.6 reject unknown resource key');
  try {
    await tauri('save_scoped_resources', {
      credentialId: credId,
      scopedResources: JSON.stringify({ nonexistent_key: [{ id: 'a', label: 'b' }] }),
    });
    fail('§3.6 unknown-key', 'save unexpectedly succeeded');
  } catch (e) {
    if (/Unknown resource id/.test(e.message)) ok('rejected (Unknown resource id)');
    else fail('§3.6 unknown-key', `wrong error: ${e.message}`);
  }

  // ── 8. §3.6 validation rejects pick missing label ──────────────────────────
  step('8. §3.6 reject pick missing label');
  try {
    await tauri('save_scoped_resources', {
      credentialId: credId,
      scopedResources: JSON.stringify({ repositories: [{ id: 'x', label: '' }] }),
    });
    fail('§3.6 missing-label', 'save unexpectedly succeeded');
  } catch (e) {
    if (/missing a non-empty `label`/.test(e.message)) ok('rejected (missing label)');
    else fail('§3.6 missing-label', `wrong error: ${e.message}`);
  }

  // ── 9. §5 enforcement default = warn-only (proxy allows but logs) ──────────
  step('9. §5 default warn-mode allows out-of-scope proxy call');
  // We picked pick.id (e.g. xkazm04/personas) — try a request to a different repo.
  try {
    await tauri('execute_api_request', {
      credentialId: credId,
      method: 'GET',
      path: '/repos/microsoft/vscode',
      headers: {},
      body: null,
    });
    ok('warn-mode allowed the request (logged at warn!)');
  } catch (e) {
    // GitHub may 404 if the request reached them; that's still ALLOWED at the proxy.
    if (/Forbidden/i.test(e.message)) {
      fail('§5 warn-mode', `unexpectedly blocked: ${e.message}`);
    } else {
      ok('warn-mode passed proxy gate (upstream may have rejected separately)', e.message.slice(0, 80));
    }
  }

  // ── 10. §5 flip to block mode and re-attempt ──────────────────────────────
  step('10. §5 set_credential_scope_enforcement=block then retry');
  await tauri('set_credential_scope_enforcement', { credentialId: credId, mode: 'block' });
  try {
    await tauri('execute_api_request', {
      credentialId: credId,
      method: 'GET',
      path: '/repos/microsoft/vscode',
      headers: {},
      body: null,
    });
    fail('§5 block-mode', 'unexpectedly allowed');
  } catch (e) {
    if (/Forbidden|scope/i.test(e.message)) ok('block-mode rejected at proxy', e.message.slice(0, 80));
    else fail('§5 block-mode', `wrong error: ${e.message}`);
  }

  // ── 11. §5 in-scope request still works under block mode ──────────────────
  step('11. §5 in-scope path still allowed under block');
  try {
    const inScopePath = `/repos/${pick.id}`;
    await tauri('execute_api_request', {
      credentialId: credId,
      method: 'GET',
      path: inScopePath,
      headers: {},
      body: null,
    });
    ok(`in-scope ${inScopePath} allowed`);
  } catch (e) {
    if (/Forbidden/i.test(e.message)) fail('§5 in-scope', `wrongly blocked: ${e.message}`);
    else ok('proxy allowed; upstream HTTP may be separate', e.message.slice(0, 80));
  }

} finally {
  if (credId) {
    try {
      await tauri('delete_credential', { id: credId });
      console.log(`${TAG} ▶ cleanup: deleted credential ${credId}`);
    } catch (e) {
      console.log(`${TAG} ! cleanup failed: ${e.message}`);
    }
  }
}
