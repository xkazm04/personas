/** Reusable helpers to drive the Athena companion via the :17320 bridge from a
 * plain node script. Opening the panel is non-obvious: with the floating orb
 * enabled (default), the footer button only toggles the orb (minimized) — the
 * chat panel opens on an orb *tap*, which is pointer-gesture based, so a plain
 * .click() won't do it. We dispatch a synthetic pointerdown+pointerup tap on
 * `companion-orb` (the tap path calls setState('open') regardless of pointer
 * capture). Falls back to the footer (orb disabled → footer opens directly). */
export const BASE = process.env.COMPANION_BRIDGE || 'http://localhost:17320';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
export const clickTestId = (id) => call('/click-testid', { test_id: id });
export const evalJs = (js) => call('/eval', { js });
export const query = (s) => call('/query', { selector: s });

export async function bridgeExec(method, params = {}) {
  const raw = await call('/bridge-exec', { method, params });
  const r = raw && typeof raw === 'object' && 'result' in raw ? raw.result : raw;
  if (typeof r === 'string') { try { return JSON.parse(r); } catch { return r; } }
  return r;
}
export const inspect = () => bridgeExec('companionInspect');
export const health = () => fetch(BASE + '/health').then((r) => r.json()).catch((e) => ({ err: e.message }));

/** Tap the orb via synthetic pointer events (the tap path → setState('open')). */
const tapOrb = () => evalJs(`(()=>{const o=document.querySelector('[data-testid="companion-orb"]');if(!o)return'no-orb';const r=o.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const opt={bubbles:true,cancelable:true,composed:true,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,clientX:x,clientY:y};o.dispatchEvent(new PointerEvent('pointerdown',{...opt,buttons:1}));o.dispatchEvent(new PointerEvent('pointerup',{...opt,buttons:0}));return'tapped';})()`);

/** Open the chat panel. The footer toggles the orb (minimized↔collapsed) when
 * the orb is enabled, so we never blindly re-click it: if the orb is present we
 * tap it; otherwise we click the footer to summon it, then tap. Converges to
 * panelVisible. */
export async function openPanel(timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await inspect();
    if (st && st.panelVisible) return true;
    const orb = await query('[data-testid="companion-orb"]');
    if (orb.length > 0) { await tapOrb(); await sleep(1500); }
    else { await clickTestId('footer-companion'); await sleep(1500); }
  }
  const st = await inspect();
  return !!(st && st.panelVisible);
}

export const fillComposer = (val) => evalJs(`(()=>{const ta=document.querySelector('[data-testid="companion-composer"]');if(!ta)return'no-composer';const proto=ta.tagName==='TEXTAREA'?window.HTMLTextAreaElement:window.HTMLInputElement;const set=Object.getOwnPropertyDescriptor(proto.prototype,'value').set;set.call(ta,${JSON.stringify(val)});ta.dispatchEvent(new Event('input',{bubbles:true}));return'filled:'+ta.value.length;})()`);

/** Send a message and wait for the assistant reply. Returns the reply text. */
export async function sendAndAwait(text, timeoutMs = 300000) {
  const before = await inspect();
  const beforeN = ((before && before.messages) || []).filter((m) => m.role === 'assistant').length;
  await fillComposer(text);
  await sleep(400);
  await clickTestId('companion-send');
  const deadline = Date.now() + timeoutMs;
  let i = 0;
  while (Date.now() < deadline) {
    await sleep(4000);
    const s = await inspect();
    const asst = ((s && s.messages) || []).filter((m) => m.role === 'assistant');
    if (asst.length > beforeN && !s.streaming) return asst[asst.length - 1].text || '';
    if (i++ % 5 === 0) console.log(`  [await] streaming=${s && s.streaming} asst=${asst.length}/${beforeN + 1}`);
  }
  throw new Error('sendAndAwait: timed out');
}

export async function resetConversation() {
  await openPanel();
  await clickTestId('companion-reset');
  await sleep(1500);
}

/** Click the Approve button on the latest pending companion approval card.
 * Returns 'approved:<label>' | 'no-approval' | 'no-approve-btn'. */
export const approveLatest = () => evalJs(`(()=>{const cards=document.querySelectorAll('[data-companion-approval]');if(!cards.length)return'no-approval';const card=cards[cards.length-1];const btns=Array.from(card.querySelectorAll('button'));const ap=btns.find(b=>/^approve/i.test((b.innerText||'').replace(/\\s+/g,' ').trim()));if(!ap)return'no-approve-btn';ap.click();return'approved:'+(ap.innerText||'').replace(/\\s+/g,' ').trim();})()`);

/** Click the primary "Build from this" button on a walkthrough/persona-ready card. */
export const clickBuildFromCard = () => evalJs(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>/build from this|build it|build persona/i.test((x.innerText||'').replace(/\\s+/g,' ').trim()));if(!b)return'no-build-btn';b.click();return'clicked:'+(b.innerText||'').replace(/\\s+/g,' ').trim();})()`);

/** Count of pending approval cards in the panel. */
export async function approvalCount() {
  const n = await query('[data-companion-approval]');
  return n.length;
}
