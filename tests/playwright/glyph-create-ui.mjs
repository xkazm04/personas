/** Create a persona FROM SCRATCH by driving the real sub_glyph UI 1:1 via the
 * :17320 bridge. Gentle/status-driven: open the create canvas, type the intent,
 * launch, then poll the lightweight /build/status (DB-backed) and only fire an
 * /eval when a question-card is actually pending — answering it the way a user
 * would (option pill, free-text + Send, or connector pick). Minimal eval traffic
 * + no location.reload, to avoid the WebView2 crash the heavy old driver caused.
 * Usage: node tests/playwright/glyph-create-ui.mjs "<Name>" "<intent…>" */
import Database from 'better-sqlite3';
const BASE = 'http://localhost:17320';
const DB = 'C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db';
const [, , NAME, INTENT] = process.argv;
if (!INTENT) { console.error('usage: <name> <intent>'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json()).catch(() => ({}));
const query = (s) => post('/query', { selector: s });
const ev = (js) => post('/eval', { js });
const clickTestId = (id) => post('/click-testid', { test_id: id });
const alive = async () => (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';

function latestSessionAfter(tsIso) {
  const db = new Database(DB, { readonly: true });
  const r = db.prepare('SELECT id, persona_id, phase FROM build_sessions WHERE created_at > ? ORDER BY created_at DESC LIMIT 1').get(tsIso);
  db.close();
  return r || null;
}

const FREE_ANSWER = 'Use sensible defaults for an autonomous, scheduled software-delivery agent working on the ai-bookkeeper codebase.';

// Answer the currently-open GlyphAnswerCard. Returns a short description or 'none'.
async function answerCard() {
  return ev(`(()=>{
    const inp=[...document.querySelectorAll('input[type=text]')].find(e=>/own words/i.test(e.placeholder||'')&&e.offsetParent!==null);
    if(inp){
      // climb to the card root (the element that also holds the question <p>)
      let root=inp; for(let k=0;k<6&&root.parentElement;k++){root=root.parentElement; if(root.querySelector('p')) break;}
      const q=((root.querySelector('p')||{}).innerText||'').replace(/\\s+/g,' ').trim();
      const pills=[...root.querySelectorAll('button')].filter(b=>{const t=(b.innerText||'').replace(/\\s+/g,' ').trim();return t&&!/^send$/i.test(t)&&(b.getAttribute('aria-label')||'')!=='Close';});
      if(pills.length>0){pills[0].click();return 'option:"'+(pills[0].innerText||'').replace(/\\s+/g,' ').trim().slice(0,28)+'" | '+q.slice(0,46);}
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(inp,${JSON.stringify(FREE_ANSWER)});inp.dispatchEvent(new Event('input',{bubbles:true}));
      const send=[...root.querySelectorAll('button')].find(b=>/^send$/i.test((b.innerText||'').replace(/\\s+/g,' ').trim()));
      if(send){send.click();return 'text+send | '+q.slice(0,46);}
      return 'filled-no-send';
    }
    // connector-picker card (VaultConnectorPicker) — pick the first connector option
    const picker=[...document.querySelectorAll('button,[role=option],[role=button]')].filter(e=>e.offsetParent!==null&&/codebase|connector|select|gmail|messaging|local/i.test((e.innerText||'')+(e.getAttribute('aria-label')||'')));
    if(picker.length){const c=picker.find(e=>/codebase|local/i.test(e.innerText||''))||picker[0];c.click();return 'connector:"'+(c.innerText||'').replace(/\\s+/g,' ').trim().slice(0,28)+'"';}
    return 'none';
  })()`);
}

const promoteReady = () => ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^promote( anyway)?$/i.test((x.innerText||'').replace(/\\s+/g,' ').trim())&&x.offsetParent!==null);return b?'ready':'';})()`);

(async () => {
  if (!(await alive())) { console.log('app not up'); return; }
  const t0 = new Date(Date.now() - 5000).toISOString().replace('T', ' ').slice(0, 19);
  // 1. open the create canvas (no reload — app is fresh)
  await ev(`(async()=>{try{const b=window.__TEST__;if(b&&b.startCreateAgent)return b.startCreateAgent();}catch(e){}})()`); await sleep(2000);
  const canvas = (await query('[data-testid="build-layout-prototype"]')).length || (await query('[data-testid="agent-intent-input"]')).length;
  console.log('create canvas present:', canvas);
  // 2. fill intent + launch
  await ev(`(()=>{const i=document.querySelector('[data-testid=agent-intent-input]');if(!i)return 0;const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;s.call(i,${JSON.stringify(INTENT)});i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`); await sleep(800);
  console.log('launch:', JSON.stringify(await clickTestId('agent-launch-btn'))); await sleep(3000);
  // 3. resolve the build session from the DB
  let session = null;
  for (let i = 0; i < 8 && !session; i++) { session = latestSessionAfter(t0); if (!session) await sleep(2000); }
  console.log('session:', session ? session.id + ' persona=' + session.persona_id : 'NOT FOUND');
  if (!session) return;

  // 4. status-driven loop: answer cards while awaiting_input; Promote when ready.
  let answered = 0, lastPhase = '';
  for (let i = 0; i < 150; i++) {
    await sleep(4000);
    if (!(await alive())) { console.log(`[t+${i * 4}s] APP DIED`); return; }
    let st = {};
    { const db = new Database(DB, { readonly: true }); st = db.prepare('SELECT phase, error_message FROM build_sessions WHERE id=?').get(session.id) || {}; db.close(); }
    const phase = st.phase || '?';
    if (phase !== lastPhase) { console.log(`[t+${i * 4}s] phase=${phase}${st.error_message ? ' err=' + st.error_message : ''}`); lastPhase = phase; }
    if (JSON.stringify(await promoteReady()).includes('ready')) { console.log(`[t+${i * 4}s] PROMOTE ready (answered ${answered})`); break; }
    if (phase === 'awaiting_input' || phase === 'refine') {
      const a = await answerCard(); const s = JSON.stringify(a);
      if (!s.includes('none')) { answered++; console.log(`[t+${i * 4}s] answered #${answered}: ${s}`); await sleep(1200); }
    }
    if (phase === 'failed') { console.log('build failed'); break; }
  }
  // 5. Promote
  const ap = await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^promote( anyway)?$/i.test((x.innerText||'').replace(/\\s+/g,' ').trim()));if(!b)return 'no-promote';b.click();return (b.innerText||'').trim();})()`);
  console.log('Promote ->', JSON.stringify(ap)); await sleep(4000);
  console.log('alive?', await alive(), '| persona_id:', session.persona_id);
})().catch((e) => { console.error('GLYPH-UI ERROR:', e.message); process.exit(1); });
