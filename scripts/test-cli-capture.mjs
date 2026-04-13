#!/usr/bin/env node
/**
 * CLI Capture end-to-end test driver.
 *
 * Exercises the full `list_cli_capturable_services` + `cli_capture_run` code
 * path for every connector that has a capture spec. Hits the Tauri
 * test-automation HTTP bridge (port 17320) so it validates the real running
 * app, not mocks.
 *
 * Preconditions:
 *   1. App is running with `npm run tauri dev --features test-automation`
 *   2. The 5 CLIs are installed (this driver reports which are missing but
 *      does NOT install them itself — the user controls system state).
 *
 * Usage:
 *   node scripts/test-cli-capture.mjs                              # full run
 *   node scripts/test-cli-capture.mjs --only=gcp_cloud              # single
 *   node scripts/test-cli-capture.mjs --only=gcp_cloud,github       # subset
 *   node scripts/test-cli-capture.mjs --json                        # machine readable
 *
 * Exit code: 0 if every installed CLI captured successfully, 1 otherwise.
 * Services whose binary is missing on this machine are skipped, not failed.
 */

const PORT = Number(process.env.PERSONAS_TEST_PORT ?? 17320);
const BASE = `http://127.0.0.1:${PORT}`;

const SERVICES = [
  { serviceType: 'gcp_cloud', binary: 'gcloud',  expectFields: ['service_account_json', 'project_id'], ttl: 3600 },
  { serviceType: 'github',    binary: 'gh',      expectFields: ['token'],                              ttl: null },
  { serviceType: 'vercel',    binary: 'vercel',  expectFields: ['token'],                              ttl: null },
  { serviceType: 'netlify',   binary: 'netlify', expectFields: ['token'],                              ttl: null },
  { serviceType: 'heroku',    binary: 'heroku',  expectFields: ['api_key'],                            ttl: null },
];

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const onlyFilter = onlyArg
  ? new Set(onlyArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean))
  : null;

const color = (c, s) => (jsonMode ? s : `\x1b[${c}m${s}\x1b[0m`);
const green = (s) => color(32, s);
const red = (s) => color(31, s);
const yellow = (s) => color(33, s);
const dim = (s) => color(90, s);
const bold = (s) => color(1, s);

function log(...args) {
  if (!jsonMode) console.log(...args);
}

async function http(method, path, body) {
  const url = `${BASE}${path}`;
  const init = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 240)}`);
  }
  // The bridge returns the bridge method's JSON-serialized return as a string
  // wrapped inside another JSON layer. Parse once; if it's still a string,
  // parse again.
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      try { return JSON.parse(parsed); } catch { return parsed; }
    }
    return parsed;
  } catch {
    return text;
  }
}

async function waitForBridge(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
      lastErr = new Error(`health: ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `Test bridge not reachable at ${BASE}/health after ${timeoutMs}ms. ` +
    `Is the app running with --features test-automation?\n` +
    `Last error: ${lastErr?.message}`,
  );
}

function classifyError(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('not found') || m.includes('not allowlisted') || m.includes('binarymissing')) {
    return 'binary_missing';
  }
  if (m.includes('not authenticated') || m.includes('not signed in') || m.includes('unauthenticated')) {
    return 'unauthenticated';
  }
  if (m.includes('timeout') || m.includes('timed out')) return 'timeout';
  return 'capture_failed';
}

async function testOneService(svc) {
  const started = Date.now();
  const result = {
    serviceType: svc.serviceType,
    binary: svc.binary,
    status: 'pending',
    classification: null,
    fieldCount: null,
    expectedFields: svc.expectFields,
    actualFields: null,
    tokenTtlSeconds: null,
    expiresAt: null,
    error: null,
    durationMs: 0,
  };

  try {
    const response = await http('POST', '/cli-capture-run', { service_type: svc.serviceType });
    if (response?.success) {
      result.status = 'captured';
      result.fieldCount = response.fieldCount ?? null;
      result.actualFields = response.fieldKeys ?? null;
      result.tokenTtlSeconds = response.tokenTtlSeconds ?? null;
      result.expiresAt = response.expiresAt ?? null;

      // Validate expected field keys present
      if (Array.isArray(response.fieldKeys)) {
        const missing = svc.expectFields.filter((k) => !response.fieldKeys.includes(k));
        if (missing.length > 0) {
          result.status = 'bad_shape';
          result.error = `captured but missing expected fields: ${missing.join(', ')}`;
        }
      }
      // TTL sanity check
      if (svc.ttl && result.tokenTtlSeconds !== svc.ttl) {
        result.status = 'bad_shape';
        result.error = `ttl mismatch: expected ${svc.ttl}s, got ${result.tokenTtlSeconds}s`;
      }
    } else {
      const msg = response?.error ?? JSON.stringify(response);
      result.error = msg;
      result.classification = classifyError(msg);
      result.status = result.classification === 'binary_missing' ? 'skipped' : 'failed';
    }
  } catch (e) {
    result.status = 'failed';
    result.error = e.message;
    result.classification = classifyError(e.message);
  }

  result.durationMs = Date.now() - started;
  return result;
}

function printSummary(results, capturable) {
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  log('');
  log(bold('CLI capture test results'));
  log(dim('─'.repeat(78)));
  log(pad('service', 14) + pad('binary', 10) + pad('status', 14) + pad('fields', 10) + 'detail');
  log(dim('─'.repeat(78)));

  for (const r of results) {
    const installed = capturable.includes(r.serviceType);
    const statusLabel =
      r.status === 'captured' ? green('captured') :
      r.status === 'skipped' ? yellow('skipped') :
      r.status === 'bad_shape' ? red('bad_shape') :
      r.status === 'failed' ? red('failed') : r.status;
    const fieldsLabel = r.fieldCount != null ? `${r.fieldCount}/${r.expectedFields.length}` : dim('—');
    const detail = r.status === 'captured'
      ? dim(`ttl=${r.tokenTtlSeconds ?? 'long'}${r.expiresAt ? ` exp=${r.expiresAt.slice(0, 19)}` : ''}`)
      : r.status === 'skipped'
        ? dim('binary not installed')
        : dim(r.error?.slice(0, 80) ?? '');
    const installMark = installed ? '' : dim(' (not detected)');
    log(pad(r.serviceType, 14) + pad(r.binary + installMark, 10) + pad(statusLabel, 22) + pad(fieldsLabel, 10) + detail);
  }

  log(dim('─'.repeat(78)));
  const captured = results.filter((r) => r.status === 'captured').length;
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'bad_shape').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  log(
    `${green(`${captured} captured`)}, ` +
    `${failed > 0 ? red(`${failed} failed`) : `${failed} failed`}, ` +
    `${yellow(`${skipped} skipped`)}`,
  );

  const needsAuth = results
    .filter((r) => r.classification === 'unauthenticated')
    .map((r) => r.binary);
  if (needsAuth.length) {
    log('');
    log(bold(yellow('CLIs that need authentication:')));
    const authCmd = {
      gcloud: 'gcloud auth login',
      gh: 'gh auth login',
      vercel: 'vercel login',
      netlify: 'netlify login',
      heroku: 'heroku login',
    };
    for (const bin of needsAuth) log(`  ${bold('$')} ${authCmd[bin] ?? bin + ' login'}`);
  }

  return { captured, failed, skipped };
}

async function main() {
  log(dim(`[bridge] waiting for ${BASE}/health ...`));
  await waitForBridge();
  log(dim(`[bridge] ready`));

  const capturableResp = await http('GET', '/list-cli-capturable');
  const capturable = Array.isArray(capturableResp?.services) ? capturableResp.services : [];
  log(dim(`[probe] resolve_cli_path reports ${capturable.length} capturable service(s): ${capturable.join(', ') || '(none)'}`));

  const toTest = SERVICES.filter((s) => !onlyFilter || onlyFilter.has(s.serviceType));
  if (toTest.length === 0) {
    console.error(`No services match --only=${[...(onlyFilter ?? [])].join(',')}`);
    process.exit(2);
  }

  const results = [];
  for (const svc of toTest) {
    log(dim(`[run ] ${svc.serviceType} via ${svc.binary} ...`));
    results.push(await testOneService(svc));
  }

  if (jsonMode) {
    console.log(JSON.stringify({ capturable, results }, null, 2));
  } else {
    printSummary(results, capturable);
  }

  // Exit nonzero if anything genuinely failed (shape mismatch or capture failed)
  const hard = results.some((r) => r.status === 'failed' || r.status === 'bad_shape');
  process.exit(hard ? 1 : 0);
}

main().catch((e) => {
  console.error(red(`fatal: ${e.message}`));
  process.exit(2);
});
