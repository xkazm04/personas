#!/usr/bin/env node
/**
 * Athena browser-page reaction harness — the measured use case in
 * docs/tests/athena-browser-react/README.md.
 *
 * Drives the RUNNING app (npm run tauri:dev:test, test-automation server on
 * :17320) over its HTTP bridge: serves the fixture page locally, opens it in
 * the Browser webview, sets Athena's MAIN tier per setup, and sends the three
 * scripted turns (A, B, B2) in fresh conversations while a page-side
 * `companion://stream` listener (bridge method `athenaStreamTimeline`) stamps
 * every stream event. Rows land in .planning/athena-browser-react/results.jsonl;
 * `--report` aggregates them.
 *
 * Every figure names the two events it is measured between (see
 * scripts/test/lib/stream-timing.mjs): the UI-side first token is the first
 * `text_delta` stamp minus the page-side send stamp; the ledger first token is
 * `companion_turn.first_text_ms`. They are never pooled.
 *
 * The operator runs this; it is never part of a gate. `node <this> --help`.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SETUPS, MESSAGES, USAGE, parseScenarios, parseSetups, reduceTimeline, renderReport, rowKey, turnIdsInSession,
} from './lib/athena-browser-react-lib.mjs';

process.on('uncaughtException', (e) => { console.error('FATAL uncaught exception:', e); shutdown(1); });
process.on('unhandledRejection', (e) => { console.error('FATAL unhandled rejection:', e); shutdown(1); });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIXTURE_DIR = path.join(ROOT, 'docs', 'tests', 'athena-browser-react', 'fixture');
const OUT_DIR = path.join(ROOT, '.planning', 'athena-browser-react');
const RESULTS = path.join(OUT_DIR, 'results.jsonl');
const REPORT = path.join(OUT_DIR, 'report.md');
const DB_DIR = process.env.PERSONAS_DB_DIR || path.join(process.env.APPDATA || '', 'com.personas.desktop');
const USER_DB = path.join(DB_DIR, 'personas_data.db');

// ── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
if (has('--help') || has('-h')) { console.log(USAGE); process.exit(0); }
const KNOWN = new Set(['--setups', '--reps', '--scenarios', '--port', '--fixture-port', '--timeout', '--fresh', '--dry-run', '--report']);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) continue;
  if (!KNOWN.has(a)) { console.error(`unknown flag ${a}\n\n${USAGE}`); process.exit(1); }
  if (['--setups', '--reps', '--scenarios', '--port', '--fixture-port', '--timeout'].includes(a)) i++;
}
const PORT = Number(opt('--port', process.env.PERSONAS_TEST_PORT || 17320));
const BASE = process.env.PERSONAS_BASE || `http://127.0.0.1:${PORT}`;
const FIXTURE_PORT = Number(opt('--fixture-port', 3000));
const FIXTURE_ORIGIN = `http://localhost:${FIXTURE_PORT}`;
const FIXTURE_URL = `${FIXTURE_ORIGIN}/index.html`;
const REPS = Math.max(1, Number(opt('--reps', 1)) || 1);
const TIMEOUT_MS = Math.max(10, Number(opt('--timeout', 300)) || 300) * 1000;
const FRESH = has('--fresh');
const DRY = has('--dry-run');
const JOB_APPEAR_MS = 20_000;
const PAGE_SETTLE_MS = 1500;

let setups; let scenarios;
try {
  setups = parseSetups(opt('--setups', DEFAULT_SETUPS));
  scenarios = parseScenarios(opt('--scenarios', 'A,B'));
} catch (e) { console.error(String(e.message || e)); process.exit(1); }

// ── bridge ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(route, body, timeoutMs = 30_000) {
  const res = await fetch(BASE + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} -> ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/** Call a `window.__TEST__` method through /bridge-exec; the body is the method's JSON result. */
async function exec(method, params = {}, timeoutSecs = 30) {
  const r = await post('/bridge-exec', { method, params, timeout_secs: timeoutSecs }, (timeoutSecs + 5) * 1000);
  if (r && typeof r === 'object' && typeof r.error === 'string' && Object.keys(r).length === 1) throw new Error(`${method}: ${r.error}`);
  return r;
}

/** Invoke a Tauri command via the generic passthrough; throws on rejection. */
async function invoke(command, params = {}, timeoutSecs = 20) {
  const r = await exec('invokeCommand', { command, params }, timeoutSecs);
  if (!r || r.success !== true) throw new Error(`${command} failed: ${r?.error ?? JSON.stringify(r).slice(0, 300)}`);
  return r.result;
}

async function health() {
  try { const r = await fetch(BASE + '/health', { signal: AbortSignal.timeout(4000) }); return r.ok; } catch { return false; }
}

/**
 * Fire a chat turn WITHOUT holding the bridge open (the /bridge-exec dispatcher
 * caps a method at 25 s while a turn can run minutes). The page stamps
 * `performance.now()` right before the invoke and writes the outcome to a DOM
 * node the harness polls with /query — the eval→DOM-readback shape
 * scripts/test/bridge.mjs uses. Only the two episode ids are kept so the node
 * text stays far under /query's truncation.
 */
async function sendTurn(tag, message, conversationId) {
  const id = `abr_${tag}`;
  const params = { message, voiceEnabled: false, recallSynthesisEnabled: false, autonomousMode: false, systemSource: null, conversationId };
  const js = `(async()=>{const d=document.getElementById(${JSON.stringify(id)})||document.createElement('div');d.id=${JSON.stringify(id)};d.setAttribute('data-testid',${JSON.stringify(id)});d.style.display='none';document.body.appendChild(d);const sendPerfNow=performance.now();const sendWallMs=Date.now();d.textContent=JSON.stringify({pending:true,sendPerfNow,sendWallMs});let out;try{const r=await window.__TEST__.invokeCommand('companion_send_message',${JSON.stringify(params)});out=r&&r.success?{ok:true,sendPerfNow,sendWallMs,userEpisodeId:r.result&&r.result.userEpisodeId,assistantEpisodeId:r.result&&r.result.assistantEpisodeId}:{ok:false,sendPerfNow,sendWallMs,e:String(r&&r.error||'send failed')};}catch(e){out={ok:false,sendPerfNow,sendWallMs,e:String((e&&e.message)||e)};}d.textContent=JSON.stringify(out);})()`;
  await post('/eval', { js });
  // The stamp is written synchronously in the same task as the invoke, so the
  // first read after the eval lands carries it.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const cur = await readNode(id);
    if (cur && typeof cur.sendPerfNow === 'number') return { id, sendPerfNow: cur.sendPerfNow, sendWallMs: cur.sendWallMs };
    await sleep(200);
  }
  throw new Error(`send ${tag}: the page never stamped the send`);
}

async function readNode(id) {
  const rows = await post('/query', { selector: `[data-testid="${id}"]` });
  const text = Array.isArray(rows) && rows[0] && typeof rows[0].text === 'string' ? rows[0].text : null;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function removeNode(id) {
  try { await post('/eval', { js: `document.getElementById(${JSON.stringify(id)})?.remove()` }); } catch (e) { note(`cleanup of ${id} failed: ${e.message}`); }
}

/** Wait for the turn's DOM node to leave `pending`; `timedOut: true` past the ceiling. */
async function waitTurn(send, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cur = await readNode(send.id);
    if (cur && !cur.pending) return { ...cur, timedOut: false };
    await sleep(1000);
  }
  return { ok: false, timedOut: true, e: `turn exceeded ${Math.round(timeoutMs / 1000)} s` };
}

async function timeline(action) {
  const r = await exec('athenaStreamTimeline', { action }, 20);
  if (!r?.success) throw new Error(`athenaStreamTimeline ${action}: ${r?.error ?? 'no result'}`);
  return r;
}

// ── db ────────────────────────────────────────────────────────────────────
function withDb(fn) {
  if (!fs.existsSync(USER_DB)) throw new Error(`user db not found at ${USER_DB} (set PERSONAS_DB_DIR)`);
  const db = new DatabaseSync(USER_DB, { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}
const q = (db, sql, params = []) => db.prepare(sql).all(...params);

const TURN_COLS = 'id, origin, trigger_kind, model, engine, tier_class, first_text_ms, duration_ms, is_error, error_reason, assistant_episode_id, created_at';
function ledgerByEpisode(episodeId) {
  if (!episodeId) return null;
  return withDb((db) => q(db, `select ${TURN_COLS} from companion_turn where assistant_episode_id = ? order by created_at desc limit 1`, [episodeId])[0] ?? null);
}
/** The ledger row is written after the turn resolves; give it a few seconds. */
async function ledgerByEpisodeSoon(episodeId, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const row = ledgerByEpisode(episodeId);
    if (row) return row;
    await sleep(500);
  }
  return null;
}
function jobsOf(conversationId) {
  return withDb((db) => q(db, `select id, kind, status, created_at, started_at, completed_at, conversation_id, parent_turn_id, substr(coalesce(result_text,''),1,300) as result_text, error_text from companion_background_job where conversation_id = ? order by created_at`, [conversationId]));
}
/** Proactive follow-up turns of a conversation, joined through the assistant episode node. */
function proactiveTurnsOf(conversationId, sinceSql) {
  return withDb((db) => q(db, `select t.${TURN_COLS.split(', ').join(', t.')}, substr(coalesce(n.body_excerpt,''),1,1200) as body_excerpt from companion_turn t join companion_node n on n.id = t.assistant_episode_id where n.session_id = ? and t.origin = 'proactive' and t.created_at >= ? order by t.created_at`, [conversationId, sinceSql]));
}
/** A stored timestamp -> epoch ms. Two shapes live in this database: SQLite
 *  `datetime('now')` text (UTC, no zone: `2026-09-18 16:36:18`) and RFC 3339
 *  with nanoseconds and an offset (`2026-09-18T16:36:18.548304200+00:00`, the
 *  job table). Measured 2026-09-18: appending `Z` to the second made every
 *  job comparison NaN. */
const sqlMs = (s) => {
  if (!s) return null;
  let t = String(s).trim().replace(' ', 'T');
  t = t.replace(/(\.\d{3})\d+/, '$1'); // nanoseconds -> milliseconds
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(t)) t += 'Z';
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : ms;
};
const toSql = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const jobRunningAt = (job, wallMs) => Boolean(job && job.started_at && sqlMs(job.started_at) <= wallMs && (!job.completed_at || sqlMs(job.completed_at) > wallMs));

// ── results ───────────────────────────────────────────────────────────────
const notes = [];
function note(msg) { if (!notes.includes(msg)) { notes.push(msg); console.log(`  note: ${msg}`); } }
function loadRows() {
  if (!fs.existsSync(RESULTS)) return [];
  return fs.readFileSync(RESULTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
const recorded = new Set(FRESH ? [] : loadRows().filter((r) => !r.error && !r.timedOut).map(rowKey));
function writeRow(row) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const full = { ts: new Date().toISOString(), ...row, note: row.note ?? notes[notes.length - 1] ?? null };
  fs.appendFileSync(RESULTS, JSON.stringify(full) + '\n');
  const lat = full.skipped ? 'skipped' : full.timedOut ? 'TIMED OUT' : `ui ${full.uiFirstTextMs ?? '-'} ms · ledger ${full.ledgerFirstTextMs ?? '-'} ms · total ${full.durationMs ?? '-'} ms`;
  console.log(`  ${rowKey(full)}: ${lat}${full.toolsUsed?.length ? ` · tools ${full.toolsUsed.join(',')}` : ''}${full.error ? ` · error ${String(full.error).slice(0, 120)}` : ''}`);
}
function baseRow(setup, rep, scenario, turn, conversationId) {
  return {
    setup: setup.id, engine: setup.engine, model: setup.model, effort: setup.effort, rep, scenario, turn, conversationId,
    message: MESSAGES[turn] ?? null, uiFirstTextMs: null, ledgerFirstTextMs: null, durationMs: null, toolsUsed: [],
    researchDispatched: null, jobCreatedAt: null, jobStartedAt: null, jobCompletedAt: null, jobStillRunningAtSend: null,
    jobStillRunningAtFirstToken: null, followupLatencyMs: null, turnText: null, error: null, timedOut: false, skipped: false,
  };
}

// ── fixture server ────────────────────────────────────────────────────────
let server = null;
function serveFixture() {
  return new Promise((resolve, reject) => {
    const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.txt': 'text/plain' };
    server = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || '/').split('?')[0]);
      const file = path.normalize(path.join(FIXTURE_DIR, rel === '/' ? 'index.html' : rel));
      if (req.method !== 'GET' || !file.startsWith(FIXTURE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve(server));
  });
}
function shutdown(code) {
  try { server?.close(); } catch { /* closing */ }
  process.exit(code);
}

// ── app-side setup ────────────────────────────────────────────────────────
async function ensureWhitelist() {
  const sites = await invoke('browser_sites_list');
  const row = (Array.isArray(sites) ? sites : []).find((s) => s.origin === FIXTURE_ORIGIN);
  if (!row) {
    await invoke('browser_sites_upsert', { input: { origin: FIXTURE_ORIGIN, label: 'athena-browser-react fixture', enabled: true, created_by: 'operator' } });
    console.log(`whitelist: added ${FIXTURE_ORIGIN}`);
  } else if (!row.enabled) {
    await invoke('browser_sites_set_enabled', { origin: FIXTURE_ORIGIN, enabled: true });
    console.log(`whitelist: enabled ${FIXTURE_ORIGIN}`);
  } else {
    console.log(`whitelist: ${FIXTURE_ORIGIN} present and enabled`);
  }
}

async function openFixtureInWebview() {
  // The webview host is only on screen while the Browser > Webview route is
  // mounted (browser_webview_set_visible follows the route), so open the page
  // first: sidebar section `teams`, then the `teams-webview-nav` item.
  await post('/navigate', { section: 'teams' });
  await post('/click-testid', { test_id: 'teams-webview-nav' });
  await sleep(500);
  let tabs = await invoke('browser_webview_list');
  let tab = (tabs ?? []).find((t) => t.url === FIXTURE_URL || String(t.url).startsWith(FIXTURE_ORIGIN));
  if (!tab) {
    const id = await invoke('browser_webview_open', { url: FIXTURE_URL, principal: null });
    tab = { id };
    console.log(`webview: opened tab ${id} on ${FIXTURE_URL}`);
  } else {
    if (tab.url !== FIXTURE_URL) await invoke('browser_webview_navigate', { id: tab.id, url: FIXTURE_URL });
    await invoke('browser_webview_focus', { id: tab.id });
    console.log(`webview: reusing tab ${tab.id}`);
  }
  // `browser_webview_list` exposes `focused` per tab, so the focus wait is
  // observed, not a fixed sleep; the settle after it is for the document load,
  // which no command exposes.
  const deadline = Date.now() + 15_000;
  let focused = false;
  while (Date.now() < deadline) {
    tabs = await invoke('browser_webview_list');
    const cur = (tabs ?? []).find((t) => t.id === tab.id);
    if (cur && cur.focused && String(cur.url).startsWith(FIXTURE_ORIGIN)) { focused = true; break; }
    await sleep(300);
  }
  if (!focused) note('the fixture tab never reported focused=true within 15 s; continuing anyway');
  await sleep(PAGE_SETTLE_MS);
  note(`page load is not observable through a command; the harness waits a fixed ${PAGE_SETTLE_MS} ms after the tab reports focused`);
  return tab.id;
}

async function probe() {
  const list = await invoke('companion_probe_engines', {}, 40);
  for (const e of list ?? []) console.log(`engine ${e.engine}: ${e.installed ? `installed (${e.version ?? '?'})` : `not installed${e.detail ? ` - ${e.detail}` : ''}`}`);
  return list ?? [];
}

async function applySetup(setup) {
  const cur = await invoke('companion_get_engine_settings');
  const next = { ...cur, main: { engine: setup.engine, model: setup.model, effort: setup.effort } };
  await invoke('companion_set_engine_settings', { settings: next });
  console.log(`main tier -> ${setup.engine}/${setup.model}/${setup.effort || 'default'} (aside ${cur.aside?.engine}/${cur.aside?.model}, micro ${cur.micro?.engine}/${cur.micro?.model} kept)`);
}

async function newConversation(title) {
  const row = await invoke('companion_create_conversation', { title, origin: 'user' });
  if (!row?.id) throw new Error('companion_create_conversation returned no id');
  return row.id;
}

// ── one turn ──────────────────────────────────────────────────────────────
async function runTurn(row, conversationId, extra = {}) {
  const send = await sendTurn(`${row.scenario}${row.rep}_${row.turn}`, row.message, conversationId);
  row.sendWallMs = send.sendWallMs;
  const done = await waitTurn(send, TIMEOUT_MS);
  await removeNode(send.id);
  const tl = await timeline('read');
  const ids = turnIdsInSession(tl.events, conversationId).filter((t) => !extra.knownTurnIds?.includes(t));
  const turnId = ids[ids.length - 1] ?? null;
  const red = reduceTimeline(tl.events, { turnId, sessionId: conversationId, sendPerfNow: send.sendPerfNow });
  row.turnId = turnId;
  row.uiFirstTextMs = red.uiFirstTextMs;
  row.uiFirstChunkMs = red.uiFirstChunkMs;
  row.uiFirstChunkKind = red.uiFirstChunkKind;
  row.uiFinishedMs = red.uiFinishedMs;
  row.firstTextWallMs = red.firstTextWallMs;
  row.toolsUsed = red.toolsUsed;
  row.turnText = (turnId && tl.texts?.[turnId]) ? tl.texts[turnId].slice(0, 1200) : null;
  if (done.timedOut) { row.timedOut = true; row.error = done.e; return { done, turnId }; }
  if (!done.ok) { row.error = done.e; return { done, turnId }; }
  row.assistantEpisodeId = done.assistantEpisodeId ?? null;
  const ledger = await ledgerByEpisodeSoon(done.assistantEpisodeId);
  if (ledger) {
    row.ledgerTurnId = ledger.id;
    row.ledgerFirstTextMs = ledger.first_text_ms;
    row.durationMs = ledger.duration_ms;
    row.ledgerEngine = ledger.engine;
    row.ledgerModel = ledger.model;
    row.ledgerTierClass = ledger.tier_class;
    if (ledger.is_error) row.error = `ledger is_error (${ledger.error_reason ?? 'no reason'})`;
  } else {
    note('no companion_turn row was found for an assistant episode within 8 s; durationMs / ledgerFirstTextMs are null for that turn');
  }
  if (row.durationMs == null && red.uiFinishedMs != null) row.durationMs = red.uiFinishedMs;
  return { done, turnId };
}

// ── scenarios ─────────────────────────────────────────────────────────────
async function scenarioA(setup, rep) {
  const conversationId = await newConversation(`abr A ${setup.id} #${rep}`);
  await timeline('drain');
  const row = baseRow(setup, rep, 'A', 'A', conversationId);
  await runTurn(row, conversationId);
  const research = jobsOf(conversationId).filter((j) => j.kind === 'research');
  row.researchDispatched = research.length > 0;
  if (research.length) note('scenario A dispatched a research job; the immediate-reaction expectation is "no job"');
  writeRow(row);
}

async function scenarioB(setup, rep) {
  const conversationId = await newConversation(`abr B ${setup.id} #${rep}`);
  await timeline('drain');
  const rowB = baseRow(setup, rep, 'B', 'B', conversationId);
  const { turnId: turnB } = await runTurn(rowB, conversationId);
  // Wait up to 20 s from the send for a research job in this conversation.
  const jobDeadline = rowB.sendWallMs + JOB_APPEAR_MS;
  let job = null;
  for (;;) {
    job = jobsOf(conversationId).find((j) => j.kind === 'research') ?? null;
    if (job || Date.now() >= jobDeadline) break;
    await sleep(500);
  }
  rowB.researchDispatched = Boolean(job);
  if (job) { rowB.jobId = job.id; rowB.jobCreatedAt = job.created_at; rowB.jobStartedAt = job.started_at; rowB.jobCompletedAt = job.completed_at; }
  else note(`no research job appeared within ${JOB_APPEAR_MS / 1000} s of the B send: research_dispatched=false (pre-work behaviour is WebSearch/WebFetch in-turn; see toolsUsed)`);
  writeRow(rowB);
  if (rowB.timedOut) return;

  // B2 goes out as soon as the job is running (or right away when there is no job).
  if (job) {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      job = jobsOf(conversationId).find((j) => j.id === rowB.jobId) ?? job;
      if (job.status !== 'queued') break;
      await sleep(500);
    }
    if (job.status === 'queued') note('the research job never left queued before the B2 send');
  }
  const rowB2 = baseRow(setup, rep, 'B', 'B2', conversationId);
  rowB2.researchDispatched = rowB.researchDispatched;
  const jobAtSend = job ? jobsOf(conversationId).find((j) => j.id === job.id) ?? job : null;
  rowB2.jobStillRunningAtSend = job ? jobAtSend.status === 'running' : null;
  await runTurn(rowB2, conversationId, { knownTurnIds: [turnB] });
  if (job) {
    const jobNow = jobsOf(conversationId).find((j) => j.id === job.id) ?? job;
    rowB2.jobId = job.id; rowB2.jobCreatedAt = jobNow.created_at; rowB2.jobStartedAt = jobNow.started_at; rowB2.jobCompletedAt = jobNow.completed_at;
    rowB2.jobStillRunningAtFirstToken = rowB2.firstTextWallMs != null ? jobRunningAt(jobNow, rowB2.firstTextWallMs) : null;
  }
  writeRow(rowB2);
  if (!job) return;

  // The proactive follow-up: wait for the job to complete, then for a
  // proactive turn in this conversation (stream first, ledger as the backstop).
  const rowF = baseRow(setup, rep, 'B', 'B_followup', conversationId);
  rowF.researchDispatched = true; rowF.jobId = job.id; rowF.message = null;
  const deadline = Date.now() + TIMEOUT_MS;
  let done = null;
  while (Date.now() < deadline) {
    done = jobsOf(conversationId).find((j) => j.id === job.id) ?? null;
    if (done && (done.status === 'completed' || done.status === 'failed')) break;
    await sleep(1000);
  }
  rowF.jobCreatedAt = done?.created_at ?? null; rowF.jobStartedAt = done?.started_at ?? null; rowF.jobCompletedAt = done?.completed_at ?? null;
  if (!done || (done.status !== 'completed' && done.status !== 'failed')) { rowF.timedOut = true; rowF.error = 'research job did not finish before the ceiling'; writeRow(rowF); return; }
  if (done.status === 'failed') { rowF.error = `research job failed: ${done.error_text ?? ''}`.trim(); writeRow(rowF); return; }
  const completedMs = sqlMs(done.completed_at);
  const known = [turnB, rowB2.turnId].filter(Boolean);
  let followTurnId = null; let tl = null;
  while (Date.now() < deadline) {
    tl = await timeline('read');
    const fresh = turnIdsInSession(tl.events, conversationId).filter((t) => !known.includes(t));
    const withText = fresh.find((t) => tl.events.some((e) => e.turnId === t && e.isTextDelta));
    if (withText) { followTurnId = withText; break; }
    await sleep(1000);
  }
  // First token seen; now let the turn FINISH before reading its text and its
  // ledger row (the row is written at turn end). Measured 2026-09-18: reading
  // at the first token recorded a 15-char text and no ledger row.
  while (followTurnId && Date.now() < deadline) {
    tl = await timeline('read');
    const ended = tl.events.some((e) => e.turnId === followTurnId && (e.kind === 'finished' || e.kind === 'error' || e.isResult));
    if (ended) { await sleep(1500); tl = await timeline('read'); break; }
    await sleep(1000);
  }
  const ledgerRows = proactiveTurnsOf(conversationId, toSql(rowB.sendWallMs - 1000));
  const ledger = ledgerRows[ledgerRows.length - 1] ?? null;
  if (followTurnId) {
    const red = reduceTimeline(tl.events, { turnId: followTurnId, sessionId: conversationId });
    rowF.turnId = followTurnId;
    rowF.followupLatencyMs = red.firstTextWallMs != null && completedMs != null ? Math.round(red.firstTextWallMs - completedMs) : null;
    rowF.uiFirstTextMs = null; // no user send to anchor on; the follow-up anchor is job completion
    rowF.toolsUsed = red.toolsUsed;
    rowF.turnText = tl.texts?.[followTurnId]?.slice(0, 1200) ?? null;
  }
  if (ledger) {
    rowF.ledgerTurnId = ledger.id; rowF.ledgerFirstTextMs = ledger.first_text_ms; rowF.durationMs = ledger.duration_ms;
    rowF.ledgerTriggerKind = ledger.trigger_kind; rowF.ledgerEngine = ledger.engine; rowF.ledgerModel = ledger.model; rowF.ledgerTierClass = ledger.tier_class;
    rowF.turnText ??= ledger.body_excerpt || null;
    if (rowF.followupLatencyMs == null && completedMs != null) {
      // Ledger backstop: created_at is the turn END, so subtract its duration to approximate the start.
      const endMs = sqlMs(ledger.created_at);
      if (endMs != null && ledger.duration_ms != null) rowF.followupLatencyMs = Math.max(0, Math.round(endMs - ledger.duration_ms - completedMs) + (ledger.first_text_ms ?? 0));
      note('follow-up latency for at least one row is the ledger approximation (created_at - duration_ms + first_text_ms - job completed_at), second resolution');
    }
  }
  if (!followTurnId && !ledger) { rowF.timedOut = true; rowF.error = 'no proactive follow-up turn appeared before the ceiling'; }
  writeRow(rowF);
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  if (has('--report')) {
    const rows = loadRows();
    if (!rows.length) { console.error(`no results at ${RESULTS}`); process.exit(1); }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT, renderReport(rows));
    console.log(`report: ${REPORT} (${rows.length} rows)`);
    return;
  }
  if (!(await health())) { console.error(`app not reachable on ${BASE} (npm run tauri:dev:test)`); process.exit(2); }
  console.log(`bridge ${BASE} · db ${USER_DB} · setups ${setups.map((s) => s.id).join(', ')} · scenarios ${scenarios.join(',')} · reps ${REPS}${DRY ? ' · DRY RUN' : ''}`);
  await serveFixture();
  console.log(`fixture served at ${FIXTURE_URL} from ${FIXTURE_DIR}`);
  const engines = await probe();
  await ensureWhitelist();
  await openFixtureInWebview();
  const installed = await timeline('install');
  console.log(`stream listener installed (${installed.count} events buffered)`);
  if (DRY) {
    const settings = await invoke('companion_get_engine_settings');
    console.log(`current tiers: main ${settings.main.engine}/${settings.main.model}/${settings.main.effort || 'default'}; aside ${settings.aside.engine}/${settings.aside.model}; micro ${settings.micro.engine}/${settings.micro.model}`);
    console.log('dry run complete: nothing was sent, nothing was written');
    return;
  }
  // The tier table is the operator's setting, not the harness's: remember it
  // and put it back however the run ends. Measured 2026-09-18: a matrix that
  // ended on grok left Athena's MAIN tier on grok until someone noticed.
  const originalTiers = await invoke('companion_get_engine_settings');
  const restoreTiers = async () => {
    try {
      await invoke('companion_set_engine_settings', { settings: originalTiers });
      console.log(`tiers restored: main ${originalTiers.main.engine}/${originalTiers.main.model}/${originalTiers.main.effort || 'default'}`);
    } catch (e) {
      console.error(`could not restore the tier table: ${String(e.message || e)} - set it back in Settings > Engine > Athena tiers`);
    }
  };
  process.once('SIGINT', () => { void restoreTiers().then(() => shutdown(130)); });
  try {
    await runSetups(setups, engines, scenarios, recorded);
  } finally {
    await restoreTiers();
  }
  console.log(`done: results in ${RESULTS}; aggregate with --report`);
}

async function runSetups(setups, engines, scenarios, recorded) {
  for (const setup of setups) {
    const avail = engines.find((e) => e.engine === setup.engine);
    if (!avail?.installed) {
      console.log(`setup ${setup.id}: engine ${setup.engine} not installed, recording skipped rows`);
      for (let rep = 1; rep <= REPS; rep++) for (const sc of scenarios) for (const turn of sc === 'A' ? ['A'] : ['B', 'B2', 'B_followup']) {
        const row = baseRow(setup, rep, sc, turn, null);
        if (recorded.has(rowKey(row))) continue;
        writeRow({ ...row, skipped: true, note: `engine ${setup.engine} not installed${avail?.detail ? `: ${avail.detail}` : ''}` });
      }
      continue;
    }
    await applySetup(setup);
    for (let rep = 1; rep <= REPS; rep++) {
      for (const sc of scenarios) {
        const probeKey = rowKey({ setup: setup.id, rep, scenario: sc, turn: sc });
        if (recorded.has(probeKey)) { console.log(`  ${probeKey}: recorded, skipping`); continue; }
        console.log(`setup ${setup.id} rep ${rep} scenario ${sc}`);
        try {
          if (sc === 'A') await scenarioA(setup, rep); else await scenarioB(setup, rep);
        } catch (e) {
          writeRow({ ...baseRow(setup, rep, sc, sc, null), error: `harness: ${String(e.message || e).slice(0, 300)}` });
        }
      }
    }
  }
}

main().then(() => shutdown(0)).catch((e) => { console.error('harness failed:', e.message || e); shutdown(1); });
