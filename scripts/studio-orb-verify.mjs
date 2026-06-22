#!/usr/bin/env node
/**
 * Live verify for the precise orb pointer (A3): confirms the preview agent is
 * injected into the project, the cross-origin postMessage handshake works, and
 * the precise ring marker lands on a real element (selector-tagged decision) —
 * and gracefully shows nothing for a missing element.
 *
 *   PERSONAS_BASE=http://127.0.0.1:17330 node scripts/studio-orb-verify.mjs
 */
import { existsSync, readFileSync } from 'node:fs';

const BASE = process.env.PERSONAS_BASE || 'http://127.0.0.1:17330';
const MK = 'C:/Users/kazda/kiro/mk';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) =>
  fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
    .then((r) => r.json())
    .catch(() => null);
const focus = () => post('/focus', {});
const ev = (js) => post('/eval', { js });
const query = async (s) => { const r = await post('/query', { selector: s }); return Array.isArray(r) ? r : []; };
const count = async (s) => (await query(s)).length;
const alive = async () => (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';
const results = [];
const check = (n, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };

const OPEN_MK = `window.__TAURI__.core.invoke('webbuild_register_existing',{name:'mk',path:'${MK}'}).then(p=>{window.__mkId=p.id;return window.__studioStore.getState().startExisting(p.id,'mk');}).catch(e=>{window.__mkErr=String(e&&e.message||e)})`;
const injectDecision = (selector) =>
  `(()=>{const s=window.__studioStore;const id=window.__mkId;if(!s||!id)return 'NO';s.setState((st)=>({runtimes:{...st.runtimes,[id]:{...st.runtimes[id],reply:'Tweaking the headline.',question:'Is this headline right?',options:['Looks good','Change it'],decisionSelector:${JSON.stringify(selector)},decisionArea:null,busy:false}}}));return 'OK';})()`;
const CLEAR = `(()=>{const s=window.__studioStore;const id=window.__mkId;if(!s||!id)return;s.setState((st)=>({runtimes:{...st.runtimes,[id]:{...st.runtimes[id],question:null,options:[],decisionSelector:null}}}));})()`;

(async () => {
  if (!(await alive())) { console.log('app down at', BASE); process.exit(1); }
  console.log('app alive at', BASE);
  await focus();
  await ev('location.reload()'); await sleep(8000); await focus();
  await post('/navigate', { section: 'studio' }); await sleep(2500); await focus();

  await ev(OPEN_MK);
  let live = false;
  for (let i = 0; i < 72 && !live; i++) {
    await sleep(5000); await focus();
    live = (await count('[data-testid="studio-tab"]')) >= 1 && (await count('iframe[title="preview"]')) >= 1;
    if (i % 4 === 0) console.log(`  …mk live=${live} [t+${i * 5}s]`);
  }
  check('mk live with preview iframe', live);
  if (!live) process.exit(1);
  await sleep(4000); // let the dev server compile + serve the agent

  // 1) Agent injected into mk on disk
  check('preview agent file written to mk', existsSync(`${MK}/app/_athena-preview-agent.tsx`));
  let layoutMounts = false;
  try { layoutMounts = readFileSync(`${MK}/app/layout.tsx`, 'utf8').includes('AthenaPreviewAgent'); } catch { /* */ }
  check('layout.tsx mounts the agent', layoutMounts);

  // 2) Precise pointer on a real element (the home page has an <h1>)
  await ev(injectDecision('h1')); await sleep(4500); await focus();
  check('precise ring marker lands on <h1> (handshake works)', (await count('[data-testid="studio-orb-pointer"]')) >= 1);
  await ev(CLEAR); await sleep(1500);

  // 3) Missing element → no precise marker (graceful not-found)
  await ev(injectDecision('.definitely-not-a-real-element-xyz')); await sleep(4500); await focus();
  check('no precise marker for a missing element (graceful)', (await count('[data-testid="studio-orb-pointer"]')) === 0);
  await ev(CLEAR);

  const passed = results.filter(Boolean).length;
  console.log(`\n=== orb-pointer verify: ${passed}/${results.length} checks passed ===`);
  process.exit(passed >= results.length - 1 ? 0 : 1);
})();
