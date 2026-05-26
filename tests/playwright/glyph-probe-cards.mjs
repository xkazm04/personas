/** Diagnostic + completion driver for the from-scratch glyph build. At every
 * awaiting_input it DUMPS the open GlyphAnswerCard's real structure (question,
 * option pills, free-text input, connector picker) via a marker readback so we
 * can SEE what's rendered, then answers it (prefer a real option/connector, else
 * short text), and continues to draft_ready → test → promote. Gentle eval load. */
import Database from 'better-sqlite3';
const BASE = process.env.PERSONAS_BASE || 'http://localhost:17320';
const DB = 'C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db';
const [, , NAME, INTENT] = process.argv;
if (!INTENT) { console.error('usage: <name> <intent>'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json()).catch(() => ({}));
const query = (s) => post('/query', { selector: s });
const ev = (js) => post('/eval', { js });
const clickTestId = (id) => post('/click-testid', { test_id: id });
const alive = async () => (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';
// read a window expression's string value out via a hidden marker (chunked)
async function readBack(expr, max = 700) {
  await ev(`window.__rb=String(${expr}||'')`);
  let out = '';
  for (let off = 0; off < max; off += 220) {
    await ev(`(()=>{let n=document.getElementById('__rbn');if(!n){n=document.createElement('span');n.id='__rbn';n.style.cssText='position:fixed;left:-9999px';document.body.appendChild(n);}n.textContent=JSON.stringify(window.__rb.slice(${off},${off + 220}))})()`);
    await sleep(30);
    const q = await query('#__rbn'); let s = ''; try { s = JSON.parse(q[0].text); } catch {} if (!s) break; out += s;
  }
  return out;
}
function sessionAfter(tsIso) { const db = new Database(DB, { readonly: true }); const r = db.prepare('SELECT id, persona_id FROM build_sessions WHERE created_at > ? ORDER BY created_at DESC LIMIT 1').get(tsIso); db.close(); return r || null; }
function phaseOf(id) { const db = new Database(DB, { readonly: true }); const r = db.prepare('SELECT phase, agent_ir IS NOT NULL ir FROM build_sessions WHERE id=?').get(id); db.close(); return r || {}; }

// dump the open card's structure (question + pills + input + connector picker)
const dumpCardExpr = `(()=>{
  const card=[...document.querySelectorAll('[class*=rounded-modal]')].find(e=>e.offsetParent!==null && e.querySelector('p'));
  if(!card)return 'NO-CARD';
  const q=(card.querySelector('p')||{}).innerText||'';
  const pills=[...card.querySelectorAll('button')].map(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()).filter(t=>t&&(b=>true));
  const inp=card.querySelector('input,textarea');
  const conn=[...card.querySelectorAll('*')].some(e=>/connector|vault/i.test((e.className&&e.className.toString())||''));
  return 'Q='+q.replace(/\\s+/g,' ').slice(0,80)+' || PILLS='+JSON.stringify(pills.slice(0,8))+' || INPUT='+(inp?inp.tagName+'[ph='+(inp.placeholder||'').slice(0,18)+']':'none')+' || CONNPICKER='+conn;
})()`;
// answer the open card. The REAL option pills are button.rounded-full (per
// GlyphAnswerCard source); "Glyph"/"Edit"/"Send" + the Close X are chrome and
// must be excluded. Scope to the card via the free-text input's .rounded-modal
// ancestor so we never pick a layout-toggle button.
const answerExpr = `(()=>{
  const inp=[...document.querySelectorAll('input[type=text],textarea')].find(e=>/own words/i.test(e.placeholder||'')&&e.offsetParent!==null);
  if(inp){
    let card=inp; for(let k=0;k<8&&card.parentElement;k++){card=card.parentElement; if(((card.className||'')+'').includes('rounded-modal')) break;}
    const pills=[...card.querySelectorAll('button')].filter(b=>(((b.className||'')+'').includes('rounded-full'))&&b.offsetParent!==null);
    if(pills.length>0){pills[0].click();return 'pill:'+(pills[0].innerText||'').replace(/\\s+/g,' ').trim().slice(0,30);}
    const s=Object.getOwnPropertyDescriptor((inp.tagName==='TEXTAREA'?window.HTMLTextAreaElement:window.HTMLInputElement).prototype,'value').set;
    s.call(inp,'standard configuration for an autonomous scheduled agent');inp.dispatchEvent(new Event('input',{bubbles:true}));
    const send=[...card.querySelectorAll('button')].find(b=>/^send$/i.test((b.innerText||'').replace(/\\s+/g,' ').trim()));
    if(send){send.click();return 'text+send';}return 'filled-no-send';
  }
  // connector-picker card: pick the codebase/local connector (or first)
  const conn=[...document.querySelectorAll('button,[role=option],[role=button]')].filter(e=>e.offsetParent!==null&&/codebase|local|messaging|gmail|notion/i.test(e.innerText||''));
  if(conn.length){const c=conn.find(e=>/bookkeeper/i.test(e.innerText||''))||conn.find(e=>/codebase|local/i.test(e.innerText||''))||conn[0];c.click();return 'conn:'+(c.innerText||'').replace(/\\s+/g,' ').trim().slice(0,24);}
  return 'no-card';
})()`;

(async () => {
  if (!(await alive())) { console.log('app down'); return; }
  // single reset reload so startCreateAgent reliably opens a fresh canvas
  // (the app accumulates view state across builds; one reload is safe, the
  // crash earlier came from reload + CONTINUOUS heavy polling, not a single reset).
  await ev('location.reload()'); await sleep(9000);
  const t0 = new Date(Date.now() - 5000).toISOString(); // keep ISO 'T' — DB created_at is T-format
  await ev(`(async()=>{try{const b=window.__TEST__;if(b&&b.startCreateAgent)return b.startCreateAgent();}catch(e){}})()`); await sleep(2500);
  const canvas = (await query('[data-testid="agent-intent-input"]')).length;
  console.log('canvas present:', canvas);
  await ev(`(()=>{const i=document.querySelector('[data-testid=agent-intent-input]');if(!i)return 0;const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;s.call(i,${JSON.stringify(INTENT)});i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`); await sleep(800);
  await clickTestId('agent-launch-btn'); console.log('launched'); await sleep(3000);
  let session = null; for (let i = 0; i < 8 && !session; i++) { session = sessionAfter(t0); if (!session) await sleep(2000); }
  if (!session) { console.log('no session'); return; }
  console.log('session', session.id, 'persona', session.persona_id);
  let answered = 0, last = '';
  for (let i = 0; i < 140; i++) {
    await sleep(4000);
    if (!(await alive())) { console.log(`[t+${i * 4}s] APP DIED`); return; }
    const st = phaseOf(session.id); const ph = st.phase || '?';
    if (ph !== last) { console.log(`[t+${i * 4}s] phase=${ph} ir=${st.ir}`); last = ph; }
    if ((ph === 'draft_ready' || ph === 'test_complete') && st.ir) { console.log(`READY (${ph}) with IR`); break; }
    if (ph === 'awaiting_input' || ph === 'refine') {
      const dump = await readBack(dumpCardExpr, 400);
      if (!dump.includes('NO-CARD')) {
        console.log(`  CARD: ${dump}`);
        const a = await readBack(answerExpr, 120);
        console.log(`  -> answered: ${a}`); answered++; await sleep(1500);
      }
    }
    if (ph === 'failed') { console.log('FAILED'); break; }
  }
  const fin = phaseOf(session.id);
  console.log('final phase', JSON.stringify(fin), 'answered', answered);
  // auto-promote if the draft is ready with an IR
  if (fin.ir && (fin.phase === 'test_complete' || fin.phase === 'draft_ready')) {
    const pr = await post('/promote-build', { session_id: session.id, persona_id: session.persona_id });
    console.log('promote:', JSON.stringify(pr).slice(0, 220));
  } else {
    console.log('NOT promoting (phase=' + fin.phase + ' ir=' + fin.ir + ')');
  }
  console.log('persona', session.persona_id);
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
