#!/usr/bin/env node
/**
 * Turn-by-turn driver for the ChainSonar Studio build (dual-dev Track 1).
 *
 * Drives the LIVE Personas app through the test-automation server. Unlike
 * scripts/studio-mk-live.mjs (an autonomous ~35-min barrel), this is
 * INTENTIONALLY one-turn-per-invocation so the operator stays in the loop each
 * turn and can watch/fix the Studio feature (Track 2). Reads the active build
 * runtime via the bridge's `studioState()` method over /bridge-exec.
 *
 * Requires: `npm run tauri:dev:test` running (server on :17320).
 *
 *   node scripts/studio-chain.mjs health
 *   node scripts/studio-chain.mjs open            # scaffold + seed the vision
 *   node scripts/studio-chain.mjs state           # compact runtime snapshot
 *   node scripts/studio-chain.mjs send "do X"     # one build turn, wait, report
 *   node scripts/studio-chain.mjs answer 0        # answer decision option #0
 *   node scripts/studio-chain.mjs answer "Build it"
 *   node scripts/studio-chain.mjs files           # project routes + newest mtime
 *
 * Vision/name mirror docs/plans/chain-signal-studio-app.md — edit there first.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.PERSONAS_BASE || 'http://127.0.0.1:17320';
const NAME = process.env.CHAIN_NAME || 'ChainSonar';

const VISION = `Build ChainSonar — a local, read-only research desk for spotting and vetting low-market-cap Ethereum (ERC-20) tokens BEFORE any real trading. It is a data/analytics tool, not a marketing site: the data pipeline and the analytics ARE the product, so prioritize a correct, resilient pipeline and clear, dense, legible analytics over hero/brand flourish (still hold a high visual bar — think a Bloomberg-terminal-grade tool, not a landing page).

Audience: a hands-on crypto trader who researches micro-caps and is tired of getting rugged. Primary goal: given a token (address) or a watchlist, tell them (a) is this a trap? (rug/honeypot/mint/owner risk) and (b) is there a real, improving opportunity here? — then let them define entry/exit rules and BACKTEST + PAPER-TRADE those rules with a virtual portfolio. No wallet, no private keys, no signing, no real orders — read-only + paper only. Tone: precise, trustworthy, fast, data-dense (dark, terminal-like).

Data: pull on-chain data DIRECTLY over Ethereum JSON-RPC. Reach the RPC through a Next.js route handler (server-side) so the browser never hits CORS/rate limits or leaks a key; read the endpoint from process.env.ETH_RPC_URL with a sensible public mainnet default and document adding an Alchemy/Infura key in .env.local. Use viem for RPC/ABI calls — install it. From RPC derive: ERC-20 metadata (name/symbol/decimals/totalSupply), the token's main Uniswap v2/v3 pool + price from reserves/slot0, holder set + concentration from Transfer logs, and contract-safety facts (has code, owner()/renounced, mint capability, LP burned/locked, transfer-tax/blacklist heuristics). Produce a composite SIGNAL score (momentum + liquidity/holder growth) and a SAFETY score (risk flags) per token; be HONEST when a check can't be done over RPC alone (flag "unknown", don't fake it).

Persistence: yes — a watchlist, cached token data, and the paper-trade portfolio + trade ledger survive reloads (localStorage is fine for v1; a small SQLite via a route handler is welcome for the ledger). Because it's a real app, empty/loading/error states are first-class (RPC calls fail and rate-limit — handle it gracefully and show it).

Start with the foundation + the core data flow: a token lookup by address that fetches metadata + price + a safety report card from RPC and renders it. Then the watchlist scoreboard, then the rule/backtest/paper-trade engine, then charts. I'm calling it ChainSonar for now — confirm or rename it, and confirm the v1 feature scope, before building around them.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${txt.slice(0, 300)}`);
  return txt;
}

/** Call a window.__TEST__ method and parse its JSON result (bridge returns a
 *  JSON-serialized string; occasionally double-encoded — parse defensively). */
async function bridgeExec(method, params) {
  const txt = await post('/bridge-exec', { method, params: params || {} });
  let v;
  try { v = JSON.parse(txt); } catch { return txt; }
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
}

const evalJs = (js) => post('/eval', { js }).catch((e) => { console.error('eval failed:', e.message); });
const health = () => fetch(BASE + '/health').then((r) => r.json()).catch(() => null);
const studio = () => bridgeExec('studioState', {});

function printState(s) {
  if (!s || !s.success) { console.log('studioState:', s?.error || 'unavailable'); return; }
  const a = s.active;
  if (!a) { console.log(`no active project (tabs: ${(s.tabs || []).length})`); return; }
  console.log(`\n── ${a.name} [${a.phase}]${a.busy ? ' BUSY' : ''}${a.autonomous ? ' AUTO' : ''} ${a.healthy ? '● live ' + a.url : ''}`);
  const phases = (a.phases || []).map((p) => `${p.status === 'done' ? '✓' : p.status === 'active' ? '▶' : '·'} ${p.title}`).join('  ');
  if (phases) console.log('   plan:', phases);
  if (a.reply) console.log('   reply:', String(a.reply).replace(/\s+/g, ' ').slice(0, 400));
  if (a.question) {
    console.log('   ❓ QUESTION:', a.question);
    (a.options || []).forEach((o, i) => console.log(`      [${i}] ${o}`));
    if (a.decisionSelector) console.log('   ↳ selector:', a.decisionSelector);
  }
  if (a.pageErrors?.length) console.log('   ⚠ pageErrors:', a.pageErrors);
  if ((s.pageErrors || []).length) console.log('   ⚠ page:', s.pageErrors);
}

async function waitTurn(label, { maxMs = 1560000 } = {}) {
  // Wait for busy to rise then fall (a build turn). Print periodic progress.
  const t0 = Date.now();
  let sawBusy = false, lastStream = '';
  while (Date.now() - t0 < maxMs) {
    const s = await studio();
    const a = s?.active;
    if (a?.busy) sawBusy = true;
    const tail = (a?.streamTail || '').replace(/\s+/g, ' ').trim().slice(-160);
    if (tail && tail !== lastStream) {
      console.log(`   … [t+${Math.round((Date.now() - t0) / 1000)}s] ${tail}`);
      lastStream = tail;
    }
    if (sawBusy && a && !a.busy) { printState(s); return s; }
    // Fast/no-op turn that never flipped busy: settle then report.
    if (!sawBusy && Date.now() - t0 > 25000 && a && !a.busy) { printState(s); return s; }
    await sleep(4000);
  }
  console.log(`   (${label}: timed out after ${Math.round(maxMs / 1000)}s)`);
  return studio();
}

async function activeId() {
  const s = await studio();
  return s?.active?.id || null;
}

async function cmdOpen() {
  console.log(`navigating to Studio + scaffolding "${NAME}" (Bun install — can take minutes)…`);
  await post('/navigate', { section: 'studio' });
  await post('/focus', {});
  await sleep(800);
  await evalJs(`window.__studioStore.getState().createWithVision(${JSON.stringify(NAME)}, ${JSON.stringify(VISION)})`);
  // Runtime does not exist until Bun scaffold finishes (createWithVision awaits it).
  const t0 = Date.now();
  let appeared = false;
  while (Date.now() - t0 < 720000) {
    const s = await studio();
    if (s?.active) {
      if (!appeared) { appeared = true; console.log(`   runtime up [t+${Math.round((Date.now() - t0) / 1000)}s], phase=${s.active.phase}`); }
      if (s.active.healthy) { console.log('   ● dev server live — seed vision auto-sends now.'); break; }
    } else if ((Date.now() - t0) % 20000 < 5000) {
      console.log(`   … scaffolding (Bun), no runtime yet [t+${Math.round((Date.now() - t0) / 1000)}s]`);
    }
    await sleep(5000);
  }
  console.log('   watching the seed (first) build turn…');
  await waitTurn('seed');
}

async function cmdSend(text) {
  const id = await activeId();
  if (!id) { console.log('no active project — run `open` first.'); return; }
  console.log(`→ turn: ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
  await post('/focus', {});
  await evalJs(`window.__studioStore.getState().sendTurn(${JSON.stringify(id)}, ${JSON.stringify(text)})`);
  await sleep(2000);
  await waitTurn('send');
}

async function cmdAnswer(arg) {
  const s = await studio();
  const a = s?.active;
  if (!a) { console.log('no active project.'); return; }
  let text = arg;
  if (/^\d+$/.test(arg)) {
    const opt = (a.options || [])[Number(arg)];
    if (!opt) { console.log(`no option #${arg} (have ${(a.options || []).length}).`); return; }
    text = opt;
  }
  await cmdSend(text);
}

function projectRoutes(root) {
  const out = [];
  let newest = 0;
  const walk = (dir, rel, kind) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.next', '.git'].includes(e.name)) continue;
        walk(p, kind === 'app' ? rel + '/' + e.name : rel, kind);
      } else {
        if (/\.(tsx?|jsx?|css)$/.test(e.name)) {
          try { const m = statSync(p).mtimeMs; if (m > newest) newest = m; } catch { /* ignore */ }
        }
        if (kind === 'app' && /^page\.(tsx?|jsx?)$/.test(e.name)) out.push(rel === '' ? '/' : rel);
      }
    }
  };
  walk(join(root, 'app'), '', 'app');
  for (const d of ['components', 'lib', 'src']) walk(join(root, d), '', d);
  return { routes: [...new Set(out)].sort(), newest };
}

async function cmdFiles() {
  const id = await activeId();
  if (!id) { console.log('no active project.'); return; }
  const list = await bridgeExec('invokeCommand', { command: 'dev_tools_list_projects', params: { status: null } });
  const proj = (list?.result || []).find((p) => p.id === id);
  if (!proj?.root_path) { console.log('could not resolve project root_path for', id); return; }
  const { routes, newest } = projectRoutes(proj.root_path);
  console.log(`project: ${proj.root_path}`);
  console.log(`routes (${routes.length}): ${routes.join(' ') || '(none yet)'}`);
  console.log(`newest source mtime: ${newest ? new Date(newest).toISOString() : '(none)'}`);
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const h = await health();
  if (!h || h.status !== 'ok') {
    console.error(`test server not reachable at ${BASE}. Start it: npm run tauri:dev:test`);
    process.exit(1);
  }
  switch (cmd) {
    case 'health': console.log('ok', BASE, JSON.stringify(h)); break;
    case 'open': await cmdOpen(); break;
    case 'state': printState(await studio()); break;
    case 'seed': {
      // Send the full ChainSonar vision as a turn to the ACTIVE project (used
      // when the auto-seed on createWithVision didn't land, e.g. a failed first
      // turn left no session continuity). Reuses the VISION constant verbatim.
      const id = await activeId();
      if (!id) { console.log('no active project — run `open` first.'); break; }
      console.log('seeding the full ChainSonar vision to the active project…');
      await post('/focus', {});
      await evalJs(`window.__studioStore.getState().sendTurn(${JSON.stringify(id)}, ${JSON.stringify(VISION)})`);
      await sleep(2000);
      await waitTurn('seed');
      break;
    }
    case 'send': await cmdSend(rest.join(' ')); break;
    case 'answer': await cmdAnswer(rest.join(' ')); break;
    case 'files': await cmdFiles(); break;
    default:
      console.log('usage: studio-chain.mjs <health|open|state|send "..."|answer <n|text>|files>');
  }
  process.exit(0);
})();
