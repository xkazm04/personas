/** Compose + build a persona for ai-paralegal entirely through Athena chat:
 * send a design+build request, let her design, approve her build action, then
 * monitor the DB for the resulting persona + its build/verification.
 * Run (app up on :17320): node tests/playwright/companion-adopt-build.mjs */
import Database from 'better-sqlite3';
import { openPanel, resetConversation, sendAndAwait, inspect, approveLatest, approvalCount, clickBuildFromCard, sleep } from './companion-lib.mjs';

// PERSONAS_DB points at the instance-under-test's personas.db. Defaults to the
// production dir; for an isolated test instance set it to
// <PERSONAS_DATA_DIR>/personas.db so monitoring reads the right DB.
const DB = process.env.PERSONAS_DB || 'C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db';
const startMs = Date.now() - 30_000;
const since = () => new Date(startMs).toISOString().replace('T', ' ').replace('Z', '');
// new build sessions (faster signal than the finished persona) + personas, scoped
// to legal/paralegal/review intent so the master thread's ai-bookkeeper work doesn't
// show up as a false positive.
const progress = () => {
  const db = new Database(DB, { readonly: true });
  const sessions = db.prepare("SELECT id,persona_id,phase,mode,substr(intent,1,70) intent,datetime(created_at) c FROM build_sessions WHERE created_at > ? ORDER BY created_at DESC").all(since())
    .filter((s) => /paralegal|legal|review|test/i.test(s.intent || ''));
  const personas = db.prepare("SELECT id,name,setup_status,datetime(created_at) c FROM personas WHERE created_at > ? ORDER BY created_at DESC").all(since())
    .filter((p) => /paralegal|legal|review|qa|test/i.test(p.name || ''));
  db.close();
  return { sessions, personas };
};

const REQUEST = process.argv[2] ||
  "Design and build a persona for my ai-paralegal codebase — it's registered as a Dev Tools project. The persona should proactively review the ai-paralegal code for bugs and missing tests, grounded in the actual source (read it through that codebase). One-shot the build — you decide the design, I trust you.";

(async () => {
  if (!(await openPanel())) { console.log('cannot open panel'); return; }
  await resetConversation();
  await openPanel();

  console.log('>>> turn 1:', REQUEST.slice(0, 80), '...');
  const reply = await sendAndAwait(REQUEST);
  console.log('reply 1 (240):', String(reply).replace(/\s+/g, ' ').slice(0, 240));

  // Approve the build card the INSTANT it appears — never nudge, because each
  // subsequent turn emits an empty companion://approvals event that replaces
  // (clears) the rendered card. Tight-poll for ~30s.
  let approved = false;
  for (let i = 0; i < 30; i++) {
    const ac = await approvalCount();
    if (ac > 0) {
      const r = await approveLatest();
      console.log(`approval card appeared at +${i}s → approve →`, JSON.stringify(r));
      approved = true;
      break;
    }
    if (i === 0) {
      // also try a walkthrough/persona-ready "Build from this" button
      const b = await clickBuildFromCard();
      if (typeof b === 'string' && b.startsWith('clicked')) { console.log('build-from-card →', b); approved = true; break; }
    }
    await sleep(1000);
  }
  console.log('approved/committed:', approved);
  if (!approved) {
    // card never rendered — is the approval pending in the DB (frontend gap)?
    const db = new Database(DB, { readonly: true });
    const a = db.prepare("SELECT id,kind,status,datetime(created_at) c FROM companion_approval WHERE created_at > ? ORDER BY rowid DESC LIMIT 3").all(since());
    db.close();
    console.log('DB pending approvals (card did not render):', JSON.stringify(a));
  }

  // monitor for a new ai-paralegal build session → persona over ~8 min
  console.log('\n=== monitoring DB (build_sessions + personas, paralegal-scoped) ===');
  let sawSession = false;
  for (let i = 0; i < 60; i++) {
    await sleep(8000);
    const { sessions, personas } = progress();
    if (sessions.length && !sawSession) { sawSession = true; console.log(`[t+${i * 8}s] BUILD SESSION:`, JSON.stringify(sessions)); }
    if (personas.length) { console.log(`[t+${i * 8}s] PERSONA:`, JSON.stringify(personas)); if (personas.some((p) => p.setup_status)) break; }
    else if (i % 4 === 0) console.log(`[t+${i * 8}s] sessions=${sessions.length} personas=${personas.length}`);
  }
  console.log('\nFINAL:', JSON.stringify(progress(), null, 1));
})().catch((e) => { console.error('BUILD ERROR:', e.message); process.exit(1); });
