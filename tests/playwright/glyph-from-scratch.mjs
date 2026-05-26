/** Build a persona FROM SCRATCH via the glyph build session (intent → glyph
 * generation), not template adoption. 1:1 with the sub_glyph create flow, driven
 * through the :17320 bridge. Usage:
 *   node tests/playwright/glyph-from-scratch.mjs "<Persona Name>" "<intent…>"
 * Reads the shared project_id from an existing persona so the new one lands in
 * the same workspace. one_shot mode: the glyph generates the full persona from
 * the intent without interactive Q&A. */
import Database from 'better-sqlite3';

const BASE = 'http://localhost:17320';
const DB = 'C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db';
const [, , NAME, INTENT] = process.argv;
if (!NAME || !INTENT) { console.error('usage: <name> <intent>'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const ev = (js) => post('/eval', { js });

// Resolve project_id from any existing persona (same workspace).
function projectId() {
  const db = new Database(DB, { readonly: true });
  const r = db.prepare('SELECT project_id FROM personas WHERE project_id IS NOT NULL LIMIT 1').get();
  db.close();
  return r ? r.project_id : null;
}

// invoke a Tauri command in the webview, return its result via a DOM marker.
async function invoke(cmd, args) {
  const id = '__inv_' + Math.random().toString(36).slice(2, 8);
  // Proven pattern: kick off the promise, wait, then a SINGLE eval that awaits +
  // writes the result to a DOM node, then read it (avoids per-poll await/timeout races).
  await ev(`window.${id}=(async()=>{try{const m=await import("/src/lib/tauriInvoke.ts");return await m.invokeWithTimeout(${JSON.stringify(cmd)}, ${JSON.stringify(args)});}catch(e){return {__err:String(e&&e.message||e)};}})()`);
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(2500);
    // Project to a COMPACT result (id or __err) — the full Persona object is large
    // and /query truncates long text, breaking JSON.parse.
    await ev(`(async()=>{const v=await window.${id};const c=(v&&v.id)?{id:v.id}:(v&&v.__err)?{__err:v.__err}:v;let n=document.getElementById(${JSON.stringify(id)});if(!n){n=document.createElement('span');n.id=${JSON.stringify(id)};n.style.cssText='position:fixed;left:-9999px';document.body.appendChild(n);}n.textContent=JSON.stringify(c);})()`);
    const q = await post('/query', { selector: '#' + id });
    const t = q[0] && q[0].text;
    if (t && t !== 'null' && t !== 'undefined') { try { return JSON.parse(t); } catch { return null; } }
  }
  return null;
}

(async () => {
  const pid_proj = projectId();
  console.log('project_id:', pid_proj);

  // 1. Create the draft persona (glyph will fill in the real prompt/capabilities).
  const persona = await invoke('create_persona', {
    input: { name: NAME, system_prompt: 'Draft — generated from scratch via glyph.', project_id: pid_proj, description: null, structured_prompt: null, icon: null, color: null, enabled: false, max_concurrent: null, timeout_ms: null, model_profile: null, max_budget_usd: null, max_turns: null, design_context: null, notification_channels: null },
  });
  if (!persona || persona.__err || !persona.id) { console.log('create_persona failed:', JSON.stringify(persona)); return; }
  const personaId = persona.id;
  console.log('draft persona:', personaId);

  // 2. Start the glyph build session from the intent (one_shot = no Q&A).
  const started = await post('/build/start', { persona_id: personaId, intent: INTENT, mode: 'one_shot' });
  console.log('build/start:', JSON.stringify(started).slice(0, 160));
  const sessionId = started.sessionId || started.session_id;
  if (!sessionId) { console.log('no sessionId — aborting'); return; }

  // 3. Poll build status until terminal (glyph generation runs as a CLI subprocess).
  let phase = '';
  for (let i = 0; i < 130; i++) {
    await sleep(3000);
    const st = await post('/build/status', { session_id: sessionId });
    phase = st.phase || '?';
    if (st.pendingQuestion) {
      // one_shot shouldn't ask, but if it does, log it (we can't auto-answer well here).
      console.log(`[t+${i * 3}s] pendingQuestion:`, JSON.stringify(st.pendingQuestion).slice(0, 120));
    }
    if (i % 5 === 0) console.log(`[t+${i * 3}s] phase=${phase} agentIr=${st.agentIrPresent} err=${st.errorMessage || ''}`);
    if (st.isTerminal || phase === 'test_complete' || phase === 'ready' || phase === 'failed') { console.log(`[t+${i * 3}s] TERMINAL phase=${phase} agentIr=${st.agentIrPresent}`); break; }
  }

  // 4. Promote the generated draft.
  const promoted = await post('/promote-build', { session_id: sessionId, persona_id: personaId });
  console.log('promote-build:', JSON.stringify(promoted).slice(0, 300));
  console.log('DONE persona_id:', personaId);
})().catch((e) => { console.error('GLYPH-SCRATCH ERROR:', e.message); process.exit(1); });
