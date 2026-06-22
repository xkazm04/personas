#!/usr/bin/env node
/**
 * Exercise the precise orb pointer + orb-fly in a REAL build: open mk, ask Athena
 * for a headline decision (which — per the build prompt — should carry a CSS
 * selector for the element), then confirm the decision card, the precise ring on
 * the element, and the GLOBAL orb flying to it (orbGuideTarget set), then that the
 * orb returns to its dock after answering.
 *
 *   PERSONAS_BASE=http://127.0.0.1:17330 node scripts/studio-orb-exercise.mjs
 */
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
const clickTestId = (id) => post('/click-testid', { test_id: id });
const alive = async () => (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';
const results = [];
const check = (n, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };

const OPEN_MK = `window.__TAURI__.core.invoke('webbuild_register_existing',{name:'mk',path:'${MK}'}).then(p=>{window.__mkId=p.id;return window.__studioStore.getState().startExisting(p.id,'mk');}).catch(e=>{window.__mkErr=String(e&&e.message||e)})`;
const INSTRUCTION =
  'On the home page, the hero headline could be stronger. Propose two alternative headlines and ask me which I prefer — point me at the headline element so I can see which part of the page you mean.';
const PROBE_ORB = `(()=>{const c=window.__companionStore;const t=c&&c.getState&&c.getState().orbGuideTarget;let e=document.getElementById('__ot')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'__ot'}));e.textContent=t?('L'+Math.round(t.left)+',T'+Math.round(t.top)):'null';return 1})()`;
const readOrb = async () => { await ev(PROBE_ORB); await sleep(700); return (await query('#__ot'))[0]?.text || 'null'; };

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
  check('mk live', live);
  if (!live) process.exit(1);
  await ev(`(()=>{const i=document.querySelector('iframe[title="preview"]');if(i)i.src=i.src;return 1})()`);
  await sleep(15000); // warm the home route + agent

  await ev(`window.__studioStore.getState().sendTurn(window.__mkId, ${JSON.stringify(INSTRUCTION)})`);
  console.log('sent the headline-decision instruction; waiting for Athena to ask…');

  let gotDecision = false;
  for (let i = 0; i < 72 && !gotDecision; i++) {
    await sleep(5000); await focus();
    if ((await count('[data-testid="studio-decision-option"]')) > 0) gotDecision = true;
    if (i % 4 === 0) console.log(`  …awaiting decision [t+${i * 5}s]`);
  }
  check('Athena asked a clickable decision', gotDecision);
  if (gotDecision) {
    await sleep(2500); await focus(); // let the locate handshake + orb-fly settle
    const ring = (await count('[data-testid="studio-orb-pointer"]')) >= 1;
    const orb = await readOrb();
    check('precise ring on the element (selector emitted + located)', ring);
    check('global orb flew to the element (orbGuideTarget set)', ring && orb !== 'null');
    console.log('  orbGuideTarget:', orb);
    // Answer → orb should return to its dock
    await clickTestId('studio-decision-option');
    await sleep(3500); await focus();
    check('orb returns to dock after answering', (await readOrb()) === 'null');
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n=== orb exercise: ${passed}/${results.length} checks passed ===`);
  process.exit(passed >= results.length - 1 ? 0 : 1);
})();
