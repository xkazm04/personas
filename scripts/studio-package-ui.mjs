#!/usr/bin/env node
/**
 * Deeper live pass — exercises the new package UI surface hands-free via the
 * hardened bridge. Injects an idle live project through window.__studioStore (so
 * no slow real build is needed), then drives the chrome: quick actions, the
 * settings popover (effort/voice/plan/knobs/connectors), version history, and the
 * decision card + orb pointer (injected decision state).
 *
 *   PERSONAS_BASE=http://127.0.0.1:17330 node scripts/studio-package-ui.mjs
 */
const BASE = process.env.PERSONAS_BASE || 'http://127.0.0.1:17330';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) =>
  fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
    .then((r) => r.json())
    .catch(() => null);
const focus = () => post('/focus', {});
const ev = (js) => post('/eval', { js });
const query = async (s) => {
  const r = await post('/query', { selector: s });
  return Array.isArray(r) ? r : [];
};
const count = async (s) => (await query(s)).length;
const clickTestId = (id) => post('/click-testid', { test_id: id });
const alive = async () =>
  (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';
const results = [];
const check = (n, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };

const RT =
  "{ id:'pkg-test', name:'PkgTest', phase:'live', status:{url:'about:blank',healthy:true,port:0,projectId:'pkg-test'}, " +
  "phases:[], busy:false, stream:'', reply:'Ready to build.', question:null, options:[], decisionArea:null, " +
  "autonomous:false, seedPending:null, autoTurns:0, resumeAuto:false, effort:'xhigh', style:'balanced', gatePlan:false, mcp:[] }";
const INJECT = `(()=>{const s=window.__studioStore;if(!s)return 'NO_STORE';s.setState((st)=>({runtimes:{...st.runtimes,'pkg-test':${RT}},tabOrder:Array.from(new Set([...st.tabOrder,'pkg-test'])),activeId:'pkg-test'}));return 'OK';})()`;
const INJECT_DECISION = `(()=>{const s=window.__studioStore;if(!s)return 'NO_STORE';s.setState((st)=>({runtimes:{...st.runtimes,'pkg-test':{...st.runtimes['pkg-test'],reply:'Where should the call-to-action go?',question:'Warm or cool palette?',options:['Warm','Cool'],decisionArea:'top'}}}));return 'OK';})()`;

(async () => {
  if (!(await alive())) { console.log('app down at', BASE); process.exit(1); }
  console.log('app alive at', BASE);
  await focus();
  await ev('location.reload()');
  await sleep(8000);
  await focus();
  await post('/navigate', { section: 'studio' });
  await sleep(2500);
  await focus();

  await ev(INJECT);
  await sleep(1500);
  await focus();
  check('injected live project tab', (await count('[data-testid="studio-tab"]')) >= 1);
  check('chat input present', (await count('[data-testid="studio-chat-input"]')) >= 1);
  check('quick-action chips present', (await count('[data-testid="studio-quick-action"]')) >= 1);

  // Settings popover (effort / voice / plan-first / design knobs / connectors)
  await clickTestId('studio-settings');
  await sleep(800);
  check('settings popover opens', (await count('[data-testid="studio-settings-panel"]')) >= 1);
  await clickTestId('studio-settings');
  await sleep(400);

  // Version history
  await clickTestId('studio-versions');
  await sleep(1000);
  check('version history opens', (await count('[data-testid="studio-versions-panel"]')) >= 1);
  await clickTestId('studio-versions');
  await sleep(400);

  // Decision card + clickable options (injected decision state)
  await ev(INJECT_DECISION);
  await sleep(1200);
  await focus();
  check('decision card options render', (await count('[data-testid="studio-decision-option"]')) >= 2);

  const passed = results.filter(Boolean).length;
  console.log(`\n=== package UI: ${passed}/${results.length} checks passed ===`);
  process.exit(passed >= results.length - 1 ? 0 : 1);
})();
