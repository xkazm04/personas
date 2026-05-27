// Thin client over the test-automation HTTP bridge (:17320 / :17321).
// `invoke` uses the eval→DOM-readback pattern (the /eval endpoint is
// fire-and-forget and always returns {success:true}, so to get a command's
// RESULT we stash it on a DOM node and read it back via /query). This is the
// same reliable pattern used to drive repair_team_handoff.
const BASE = process.env.PERSONAS_BASE || 'http://127.0.0.1:17321';

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r;
}

export async function health() {
  try {
    const r = await fetch(BASE + '/health');
    return r.status;
  } catch {
    return 0;
  }
}

export async function query(selector) {
  const r = await post('/query', { selector });
  try {
    return await r.json();
  } catch {
    return [];
  }
}

export async function evalJs(js) {
  await post('/eval', { js });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Invoke a Tauri command via window.__TEST__.invokeCommand and return its
 * result. Throws on command rejection or timeout.
 */
export async function invoke(command, params = {}, { timeoutMs = 120000, pollMs = 1500 } = {}) {
  const id = 'inv_' + Math.random().toString(36).slice(2, 10);
  // Bound the stored result: /query truncates long element text, which broke
  // JSON.parse on large command returns (Persona/PersonaExecution objects) and
  // surfaced as "unparseable result" even though the command SUCCEEDED. Store
  // the full result only when it's small; otherwise just confirm ok + size.
  const js = `(async()=>{let res;try{const r=await window.__TEST__.invokeCommand(${JSON.stringify(command)}, ${JSON.stringify(params)});let s;try{s=JSON.stringify(r);}catch{s=null;}res=(s&&s.length<2000)?{ok:true,r:r}:{ok:true,big:(s?s.length:0)};}catch(e){res={ok:false,e:String((e&&e.message)||e)};}let d=document.getElementById(${JSON.stringify(id)})||document.createElement('div');d.id=${JSON.stringify(id)};d.setAttribute('data-testid',${JSON.stringify(id)});d.textContent=JSON.stringify(res);document.body.appendChild(d);})()`;
  await evalJs(js);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await query(`[data-testid="${id}"]`);
    if (Array.isArray(rows) && rows.length && rows[0].text) {
      let parsed;
      try {
        parsed = JSON.parse(rows[0].text);
      } catch {
        parsed = null;
      }
      await evalJs(`document.getElementById(${JSON.stringify(id)})?.remove()`);
      if (parsed && parsed.ok) return parsed.r;
      throw new Error(`invoke ${command} failed: ${parsed ? parsed.e : 'unparseable result'}`);
    }
    await sleep(pollMs);
  }
  await evalJs(`document.getElementById(${JSON.stringify(id)})?.remove()`);
  throw new Error(`invoke ${command} timed out after ${timeoutMs}ms`);
}
