/** From an answered adoption modal: Continue to build → wait → Promote. Scoped. */
const BASE = 'http://localhost:17320';
const MODAL = '[aria-labelledby="adoption-matrix-title"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const query = (s) => call('/query', { selector: s });
const evalJs = (js) => call('/eval', { js });
const clickModal = (t) => evalJs(`(()=>{const r=document.querySelector(${JSON.stringify(MODAL)});if(!r)return'no-modal';const b=Array.from(r.querySelectorAll('button')).find(x=>((x.innerText||'').replace(/\\s+/g,' ').trim().toUpperCase().includes(${JSON.stringify(t)}.toUpperCase())));if(!b)return'no-btn';b.click();return'clicked';})()`);
const alive = async () => (await fetch(BASE + '/health').then(r => r.json()).catch(() => null))?.status === 'ok';
// read modal button list as a real array (chunked to avoid /query text truncation)
async function modalButtons() {
  await evalJs(`(()=>{const r=document.querySelector(${JSON.stringify(MODAL)});window.__mb=r?Array.from(r.querySelectorAll('button')).filter(b=>b.offsetParent!==null).map(b=>(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,40)).filter(Boolean):[];})()`);
  await sleep(60);
  const n = await evalJs(`window.__mb.length`);
  const len = (await query('#__nope')) && 0; // noop
  // pull each via separate marker reads
  const out = [];
  const lenRes = await readVal(`window.__mb.length`);
  for (let i = 0; i < (lenRes || 0); i++) out.push(await readVal(`window.__mb[${i}]`));
  return out;
}
async function readVal(expr) {
  await evalJs(`(()=>{let n=document.getElementById('__v');if(!n){n=document.createElement('span');n.id='__v';n.style.cssText='position:fixed;left:-9999px';document.body.appendChild(n);}n.textContent=JSON.stringify(${expr});})()`);
  await sleep(50);
  const n = await query('#__v');
  try { return JSON.parse(n[0].text); } catch { return null; }
}

(async () => {
  console.log('buttons before:', JSON.stringify(await modalButtons()));
  console.log('Continue→', JSON.stringify(await clickModal('CONTINUE TO BUILD')));
  // poll for build progress / promote affordance
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    if (!(await alive())) { console.log(`[t+${i*3}s] APP DIED`); return; }
    const btns = await modalButtons();
    const interesting = btns.filter((b) => /promote|build|create|finish|done|adopt|retry|error|fail/i.test(b));
    console.log(`[t+${i*3}s] alive  modalBtns=${btns.length}  signals=${JSON.stringify(interesting)}`);
    if (btns.some((b) => /promote/i.test(b))) { console.log('>>> PROMOTE available'); break; }
  }
})().catch((e) => { console.error('BUILD-PROMOTE ERROR:', e.message); process.exit(1); });
