#!/usr/bin/env node
/**
 * Establish (or refresh) the connector-API-docs baseline in Pumper.
 *
 * The `connector-api-watch` Pumper app diffs each connector's public docs page
 * against the last snapshot in its change-detected `connector_docs` dataset.
 * The FIRST run is a baseline: every doc is New (not Changed), so it emits ZERO
 * firings — it just records the snapshot every future monthly run diffs against.
 * Run this once now; after that the app's monthly cron (`0 0 6 1 * *`) keeps the
 * snapshot current and surfaces real changes as changes.json.
 *
 * Prereq: the Pumper server is running with the connector-api-watch app built in
 *   (cd C:/Users/mkdol/dolla/pumper && cargo run -p pumper-server   # :8088)
 * and its watch list is current (catalog/connector-docs.json — regenerate on the
 * personas side with `node scripts/events/generate-connector-events.mjs` and copy
 * it into pumper/catalog/).
 *
 * Usage:
 *   node scripts/events/run-connector-baseline.mjs                 # full baseline (all connectors)
 *   node scripts/events/run-connector-baseline.mjs --only elevenlabs,stripe
 *   node scripts/events/run-connector-baseline.mjs --limit 10      # smoke a subset
 *   PUMPER_URL=http://127.0.0.1:8088 node scripts/events/run-connector-baseline.mjs
 */
const BASE = process.env.PUMPER_URL || 'http://127.0.0.1:8088';
const APP = 'connector-api-watch';

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

async function main() {
  // 1. Is the server up + is the app registered?
  let apps;
  try {
    const res = await fetch(`${BASE}/apps`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`GET /apps → ${res.status}`);
    apps = await res.json();
  } catch (e) {
    console.error(`✗ Pumper not reachable at ${BASE} (${e.message}).`);
    console.error('  Start it:  cd C:/Users/mkdol/dolla/pumper && cargo run -p pumper-server');
    process.exit(1);
  }
  const names = Array.isArray(apps) ? apps.map((a) => a.name ?? a) : Object.keys(apps ?? {});
  if (!names.includes(APP)) {
    console.error(`✗ Pumper is up but the '${APP}' app is not registered.`);
    console.error('  Rebuild the server after adding the crate (registry.rs).');
    process.exit(1);
  }

  // 2. Build params.
  const params = { summarize: true };
  const limit = flag('--limit');
  if (limit) params.limit = Number(limit);
  const only = flag('--only');
  if (only) params.only = only.split(',').map((s) => s.trim()).filter(Boolean);

  // 3. Enqueue the job.
  console.log(`→ Enqueuing ${APP} baseline scan on ${BASE}${only ? ` (only: ${params.only.join(', ')})` : ''}${limit ? ` (limit ${limit})` : ''}…`);
  const enq = await fetch(`${BASE}/apps/${APP}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Docs scraping over ~122 sites is slow; give it a generous single attempt.
    body: JSON.stringify({ params, max_attempts: 1 }),
  });
  if (!enq.ok) {
    console.error(`✗ enqueue failed: ${enq.status} ${await enq.text()}`);
    process.exit(1);
  }
  const { id } = await enq.json();
  console.log(`  job ${id} queued. Polling… (Ctrl-C is safe; the job keeps running server-side)`);

  // 4. Poll to completion.
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const jr = await fetch(`${BASE}/jobs/${id}`);
    if (!jr.ok) { console.error(`✗ poll failed: ${jr.status}`); process.exit(1); }
    const job = await jr.json();
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    if (job.status === 'succeeded') {
      const r = job.result ?? {};
      console.log(`\n✓ Baseline scan done in ${mins} min.`);
      console.log(`  scanned : ${r.scanned ?? '?'}`);
      console.log(`  changed : ${r.changed ?? 0}  (expected 0 on a first baseline)`);
      console.log(`  errors  : ${Array.isArray(r.errors) ? r.errors.length : 0}`);
      if (Array.isArray(r.errors) && r.errors.length) {
        console.log('  (errors are connectors whose docs are behind auth / JS-heavy / offline — safe to ignore;');
        console.log('   they simply won\'t be watched until their docs_url is publicly fetchable.)');
      }
      if ((r.changed ?? 0) > 0) {
        console.log(`\n  This run reported ${r.changed} change(s). Pull the artifact and bake them:`);
        console.log(`    (pumper) data/artifacts/${APP}/${id}/changes.json`);
        console.log('    (personas) node scripts/events/generate-connector-events.mjs --changes <that file>');
      }
      console.log('\nBaseline recorded. The monthly cron (0 0 6 1 * *) will diff against it from now on.');
      return;
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      console.error(`\n✗ job ${job.status}: ${job.error ?? ''}`);
      process.exit(1);
    }
    process.stdout.write(`  … ${job.status} (${mins} min)\r`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
