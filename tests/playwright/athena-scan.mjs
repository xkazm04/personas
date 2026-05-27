/** Live test: ask Athena to CONTEXT-SCAN an existing project. Verifies she emits
 * an `enqueue_dev_job` (scan_codebase) approval — NOT a build_oneshot — and that
 * approving it runs the real context scan (dev_contexts populate).
 * Usage: PERSONAS_BASE=http://localhost:17321 node athena-scan.mjs "<repo-frag>" */
import Database from 'better-sqlite3';
const BASE = process.env.PERSONAS_BASE || 'http://localhost:17320';
const DB = 'C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db';
const FRAG = process.argv[2] || 'ai-paralegal';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json()).catch(() => ({}));
const query = (s) => post('/query', { selector: s });
const ev = (js) => post('/eval', { js });
const exists = async (s) => (await query(s)).length > 0;
const alive = async () => (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';
function ctxCount() {
  const db = new Database(DB, { readonly: true });
  const p = db.prepare("SELECT id FROM dev_projects WHERE root_path LIKE ?").get('%' + FRAG + '%');
  const c = p ? db.prepare("SELECT count(*) c FROM dev_contexts WHERE project_id=?").get(p.id).c : -1;
  db.close(); return c;
}

(async () => {
  if (!(await alive())) { console.log('app down'); process.exit(1); }
  const before = ctxCount();
  console.log(`${FRAG}: dev_contexts before = ${before}`);
  await ev('location.reload()'); await sleep(9000);
  await ev(`(()=>{try{window.__TEST__.openCompanion()}catch(e){}})()`); await sleep(2000);
  const intent = `Please run a context scan (map the codebase structure) for the ${FRAG} Dev Tools project — I want its context map populated.`;
  await ev(`(()=>{const ta=document.querySelector('[data-testid=companion-composer]');if(!ta)return;const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;s.call(ta,${JSON.stringify(intent)});ta.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(500); await post('/click-testid', { test_id: 'companion-send' });
  console.log('sent scan request');

  // Detect the approval card via /query (reliable; /eval-result reads are flaky).
  let action = null;
  for (let i = 0; i < 70; i++) {
    await sleep(5000);
    const scan = (await query('[data-companion-approval-action="enqueue_dev_job"]')).length;
    const build = (await query('[data-companion-approval-action="build_oneshot"]')).length
      + (await query('[data-companion-approval-action="prefill_persona_create"]')).length;
    if (scan > 0) { action = 'enqueue_dev_job'; console.log(`[t+${i * 5}s] ✓ Athena proposed a context scan (enqueue_dev_job)`); break; }
    if (build > 0) { action = 'WRONG: build_oneshot/prefill'; console.log(`[t+${i * 5}s] ✗ Athena proposed an agent build`); break; }
    if (i % 4 === 3) console.log(`[t+${i * 5}s] waiting for Athena's proposal…`);
  }
  if (action === 'enqueue_dev_job') {
    console.log('PASS (correct action): emitting enqueue_dev_job — approving…');
    await ev(`(()=>{const c=document.querySelector('[data-companion-approval-action="enqueue_dev_job"]');if(c){c.querySelector('button')?.click();}})()`);
    let after = before;
    for (let i = 0; i < 60; i++) { await sleep(6000); after = ctxCount(); if (after > before || (before <= 0 && after > 0)) break; }
    console.log(`${FRAG}: dev_contexts after = ${after} ${after > Math.max(before, 0) ? '✓ scan populated' : '(still scanning / unchanged)'}`);
  } else if (action) {
    console.log(`FAIL (wrong action): Athena emitted ${action} for a scan request`);
  } else {
    console.log('NO approval card appeared');
  }
})().catch((e) => { console.error('DRIVER ERROR:', e.message); process.exit(1); });
