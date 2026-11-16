#!/usr/bin/env node
// Personas against a RUNNING bp demo (spark roadmap S6, the "Done when" of bp's ROADMAP S6), on the app's real TS paths
// (bpLiveSurfaces.tsx): this script stands in for Personas' Rust layer only. Every invoke the page makes is answered
// here the way the Rust commands answer it: bp_focus_read / bp_focus_move / bp_products / bp_morning over bp's loopback
// HTTP with no Origin (as reqwest sends it), lens_scan_decide through lens-scan's store.mjs with the same argv, and
// lens_scan_snapshot from a dump Rust made (`read_snapshot`). It serves bp's DEMO products only (refuses any root that is
// not under <bp>/.demo/), never a real store.
//
//   node scripts/style/page-harness/bpLiveDrive.mjs --bp http://127.0.0.1:4320 --bp-root C:/t/bp-ref-s6
//        --snapshots <dir of <slug>.json dumps> --registry <ai-registry> --out <dir> [--port 4321]
//        [--phases presence,deck,standin,table,morning,hidden]
//
// Phases (each writes PNGs and appends to <out>/drive.json):
//   presence  the Blueprint tab is on screen: bp lists personas:main live; with Follow on, bp's own chip says "Personas follows"
//   deck      bp's Morning deck on bp's web (M, then →): each card's place lands on the Personas node it names
//   standin   bp's scripts/focus-standin.ts --lead (n = the next room): each room lands on its bay
//   table     the remaining rows of the place table, published as a probe reader: site, wing, a bp bay <cap>.<kind>,
//             a feature with lens=, an unknown id, a product Personas has not got, another Personas product
//   morning   the Morning tab: Enter on the repeat (D14: Decline with the brief's note), Approve on another; the store
//             moves and bp's deck drops both on its next read
//   hidden    the tab hidden: Personas stops saying hello; bp's chip drops "Personas follows" once LIVE_MS (45 s) has passed
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarnessServer, launchHarnessBrowser, HARNESS } from './harnessRun.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
const BP = String(args.bp ?? 'http://127.0.0.1:4320').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BP)) throw new Error('--bp must be a loopback origin');
const BP_ROOT = resolve(String(args['bp-root']));
const DEMO = join(BP_ROOT, '.demo').replace(/\\/g, '/').toLowerCase();
const SNAPS = resolve(String(args.snapshots));
const REGISTRY = resolve(String(args.registry));
const OUT = resolve(String(args.out));
const PORT = Number(args.port ?? 4321);
if (PORT < 4320 || PORT > 4329) throw new Error('--port must be in 4320-4329 (this session\'s range)');
const PHASES = new Set(String(args.phases ?? 'presence,deck,standin,table,morning,hidden').split(','));
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, 'drive.json');
writeFileSync(LOG, '');
const log = (o) => { const line = { t: new Date().toISOString(), ...o }; appendFileSync(LOG, JSON.stringify(line) + '\n'); console.log(JSON.stringify(line)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (r) => r.trim().replace(/\\/g, '/').replace(/^\/\/\?\//, '').replace(/\/+$/, '').toLowerCase();

// ---------------------------------------------------------------- the Rust stand-in
/** Personas' projects: bp's kettle-web and kettle-phone demo products (kettle-desk is "Not in Personas"). */
const PROJECTS = [
  { projectId: 'p-kettle-web', slug: 'kettle-web', name: 'Kettle Web' },
  { projectId: 'p-kettle-phone', slug: 'kettle-phone', name: 'Kettle Phone' },
];
const bpGet = async (path) => { const r = await fetch(BP + path, { cache: 'no-store' }); if (!r.ok) throw new Error(`bp answered ${r.status}`); return r.json(); };
const bpPost = async (body) => {
  const r = await fetch(BP + '/api/session/focus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`bp refused ${body.op}: ${r.status} ${j?.error ?? ''}`);
  return j;
};
let products = [];
const rootOf = (projectId) => {
  const p = PROJECTS.find((x) => x.projectId === projectId), row = products.find((x) => x.slug === p?.slug);
  if (!row) throw new Error(`no demo product for ${projectId}`);
  if (!norm(row.root).startsWith(DEMO + '/')) throw new Error(`refusing a root outside bp's demo: ${row.root}`);
  return row.root;
};
const snapshot = (projectId) => JSON.parse(readFileSync(join(SNAPS, PROJECTS.find((p) => p.projectId === projectId).slug + '.json'), 'utf8'));
function productRow(p) {
  let snap;
  try { snap = snapshot(p.projectId); } catch { snap = { storeVersion: 4, scan: { proposals: [] } }; }
  const props = snap.scan.proposals;
  const counts = {};
  for (const x of props) counts[x.status] = (counts[x.status] ?? 0) + 1;
  return { projectId: p.projectId, name: p.name, root: rootOf(p.projectId), storeVersion: snap.storeVersion, counts, awaitingTriage: counts.done ?? 0, unreleasedAccepted: 0, hasMap: true, features: 133, lenses: 8, measuredFacets: 600, hasEvents: false };
}
const moves = [];
async function bridge(cmd, a) {
  switch (cmd) {
    case 'bp_focus_read':
      try { return { base: BP, online: true, view: await bpGet('/api/session/focus') }; } catch (e) { return { base: BP, online: false, error: String(e.message), retryInMs: 5000 }; }
    case 'bp_focus_move': {
      const reader = `personas:${a.window}`, op = a.op;
      const body = op === 'unfollow' || op === 'forget' ? { op, reader } : { op, reader, surface: 'personas', label: 'Personas', ...(op === 'follow' ? { of: '*' } : {}) };
      moves.push({ at: Date.now(), op });
      const j = await bpPost(body);
      return { base: BP, online: true, view: j.view };
    }
    case 'bp_products':
      return products.map((x) => { const p = PROJECTS.find((y) => norm(rootOf(y.projectId)) === norm(x.root)); return { slug: x.slug, name: x.name, root: x.root, ...(p ? { projectId: p.projectId } : {}) }; });
    case 'bp_morning': {
      const q = a.opened ? '?opened=' + encodeURIComponent(a.opened) : '';
      try { return { base: BP, online: true, deck: await bpGet('/api/companion/morning' + q) }; } catch (e) { return { base: BP, online: false, error: String(e.message) }; }
    }
    case 'lens_scan_products': return PROJECTS.map(productRow);
    case 'lens_scan_snapshot': return snapshot(a.projectId);
    case 'lens_scan_decide': {
      // lens_scan_decide: node --no-warnings store.mjs --db <root>/.ai/lens-scan/scan.db decide --ids .. --decision .. --by .. [--note ..]
      const root = rootOf(a.projectId);
      const argv = ['--no-warnings', join(REGISTRY, 'skills', 'lens-scan', 'scripts', 'store.mjs'), '--db', join(root, '.ai', 'lens-scan', 'scan.db'), 'decide',
        '--ids', a.ids.join(','), '--decision', a.decision, '--by', 'user:personas', ...(a.note ? ['--note', a.note] : [])];
      const out = execFileSync(process.execPath, argv, { cwd: join(root, '.ai', 'lens-scan'), encoding: 'utf8' });
      log({ phase: 'decide', projectId: a.projectId, ids: a.ids, decision: a.decision, note: a.note ?? null, store: JSON.parse(out) });
      return JSON.parse(out);
    }
    case 'get_app_setting': return null;
    default:
      log({ unknownInvoke: cmd });
      return null;
  }
}

// ---------------------------------------------------------------- the page
const tape = { version: 1, source: 'synthetic', recordedAt: new Date().toISOString(), calls: [] };
const { server, url } = await startHarnessServer({ port: PORT });
const browser = await launchHarnessBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.exposeFunction('__bpLiveInvoke', (cmd, a) => bridge(cmd, a));
await page.addInitScript((t) => { window.__PAGE_HARNESS_TAPE__ = t; }, tape);
const open = (view) => page.goto(`${url}${HARNESS}?module=decision-center/bp-live&theme=dark-midnight&view=${view}`, { timeout: 240_000, waitUntil: 'domcontentloaded' });
const shot = async (p, name) => { const f = join(OUT, name + '.png'); await p.screenshot({ path: f }); return f; };

/** What Personas shows now: is a sheet open, on which product, at which level and place; the status line. */
const personas = () => page.evaluate(() => {
  const sheet = document.querySelector('[data-testid="blueprint-sheet"]');
  const txt = (s) => document.querySelector(s)?.textContent?.trim() ?? null;
  return {
    sheet: !!sheet,
    product: txt('.bp-here .bp-hd2'),
    level: document.querySelector('nav.bp-lv [aria-current="true"]')?.getAttribute('data-level') ?? null,
    here: txt('.bp-here .bp-hn'),
    featureSheet: !!document.querySelector('[data-testid="blueprint-feature-sheet"]'),
    featureTitle: txt('[data-testid="blueprint-feature-sheet"] h2, [data-testid="blueprint-feature-sheet"] h3'),
    say: txt('.bp-say'),
    chip: txt('[data-testid="blueprint-follow-chip"]') ?? txt('[data-testid="picker-follow-chip"]'),
    pickerNote: txt('[data-testid="picker-follow-note"]'),
  };
});
const plans = {};
const planOf = async (slug) => (plans[slug] ??= await bpGet(`/api/products/${slug}/plan`));
const nameIn = (plan, kind, id) => (plan[kind] ?? []).find((x) => x.id === id)?.name ?? null;
/** Wait until Personas shows what the check says, or time out; then log the outcome either way. */
async function landed(label, check, ms = 8000) {
  const t0 = Date.now();
  let st;
  for (;;) {
    st = await personas();
    if (check(st) || Date.now() - t0 > ms) break;
    await sleep(250);
  }
  const ok = check(st);
  log({ step: label, ok, ms: Date.now() - t0, personas: st });
  return ok;
}
const shared = async () => (await bpGet('/api/session/focus')).shared;

products = await bpGet('/api/products');
log({ bp: BP, products: products.map((p) => `${p.slug} ${p.root}`), personasProjects: PROJECTS });

// ---------------------------------------------------------------- presence
const bpWeb = await ctx.newPage();
if (PHASES.has('presence') || PHASES.has('deck') || PHASES.has('hidden')) {
  await open('blueprint');
  await page.waitForSelector('[data-testid="picker-follow-chip"]', { timeout: 240_000 });
  await sleep(1500);
  const v = await bpGet('/api/session/focus');
  log({ step: 'presence: the Blueprint tab is on screen', ok: v.readers.some((r) => r.id === 'personas:main' && r.live && r.label === 'Personas'), readers: v.readers });
  await page.click('[data-testid="picker-follow-chip"]');
  await sleep(1500);
  await bpWeb.goto(`${BP}/?product=kettle-web`);
  await bpWeb.waitForSelector('#fx-chip', { timeout: 30000 });
  await sleep(2500);
  const chip = await bpWeb.textContent('#fx-chip');
  log({ step: "presence: bp's chip lists Personas while the tab is visible (Follow on)", ok: /Personas follows|Personas,|, Personas/.test(chip ?? ''), bpChip: chip });
  await shot(bpWeb, 'presence-bp-chip-lists-personas');
  await shot(page, 'presence-personas-picker-following');
}

// ---------------------------------------------------------------- bp's Morning deck drives the place
if (PHASES.has('deck')) {
  // bp's web publishes each card's place as it is read (M opens the deck, → reads the next card)
  await bpWeb.bringToFront();
  await bpWeb.keyboard.press('m');
  await sleep(1500);
  const deck = await bpGet('/api/companion/morning');
  const seen = new Set();
  for (let i = 0; i < deck.cards.length + 1; i++) {
    const s = await shared();
    const p = s?.place;
    if (p && !seen.has(JSON.stringify(p))) {
      seen.add(JSON.stringify(p));
      const plan = await planOf(p.product).catch(() => null);
      const t = p.target, inPersonas = PROJECTS.some((x) => x.slug === p.product);
      const want = !inPersonas ? { note: `Not in Personas: ${p.product}` }
        : !t || t.kind === 'site' ? { level: '0' }
          : t.kind === 'room' ? { level: '2', here: plan && nameIn(plan, 'rooms', t.id) }
            : t.kind === 'feature' ? { feature: plan && nameIn(plan, 'tiles', t.id) }
              : { level: '1', here: plan && nameIn(plan, 'wings', t.id) };
      const ok = await landed(`deck card ${i}: ${p.product} ${t ? t.kind + ' ' + t.id : 'site'} -> ${JSON.stringify(want)}`, (st) =>
        want.note ? (st.pickerNote ?? st.say ?? '').includes(want.note)
          : want.feature !== undefined ? st.featureSheet
            : st.sheet && (st.product ?? '').includes(PROJECTS.find((x) => x.slug === p.product).name) && st.level === want.level && (!want.here || (st.here ?? '').includes(want.here)));
      await shot(page, `deck-${String(i).padStart(2, '0')}-${p.product}-${t ? t.kind : 'site'}`);
      if (!ok) log({ step: 'deck: bp place', place: p });
    }
    await bpWeb.bringToFront();
    await bpWeb.keyboard.press('ArrowRight');
    await sleep(1800);
  }
  await bpWeb.keyboard.press('Escape');
}

// ---------------------------------------------------------------- focus-standin --lead
if (PHASES.has('standin')) {
  // put the shared place on kettle-web first (the stand-in leads within the shared place's product)
  await bpPost({ op: 'hello', reader: 'web:probe', surface: 'web', label: 'Probe' });
  await bpPost({ op: 'publish', reader: 'web:probe', surface: 'web', label: 'Probe', place: { product: 'kettle-web', level: 'L0' } });
  await sleep(1500);
  const shim = pathToFileURL(join(OUT, 'tty-shim.mjs')).href;
  writeFileSync(join(OUT, 'tty-shim.mjs'), "// focus-standin's --lead reads raw keys from a TTY; this pipe stands in for one\nprocess.stdin.isTTY = true;\nprocess.stdin.setRawMode = function () { return this; };\n");
  const kid = spawn(process.execPath, ['--import', shim, '--import', '@bp/core/register', 'scripts/focus-standin.ts', '--base', BP, '--lead'], { cwd: BP_ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  kid.stdout.on('data', (d) => { out += d; });
  kid.stderr.on('data', (d) => { out += d; });
  await sleep(4000);
  const plan = await planOf('kettle-web');
  for (let k = 0; k < 3; k++) {
    kid.stdin.write('n');
    await sleep(1500);
    const p = (await shared())?.place;
    const name = p?.target ? nameIn(plan, 'rooms', p.target.id) : null;
    await landed(`standin --lead n#${k + 1}: ${p?.target?.kind} ${p?.target?.id} (${name}) -> that room at level 2`, (st) => st.sheet && st.level === '2' && (st.here ?? '').includes(name));
    await shot(page, `standin-${k + 1}-${p?.target?.id}`);
  }
  kid.stdin.write('q');
  await sleep(800);
  try { kid.kill(); } catch { /* exited */ }
  writeFileSync(join(OUT, 'standin.log'), out);
}

// ---------------------------------------------------------------- the rest of the place table
if (PHASES.has('table')) {
  const plan = await planOf('kettle-web');
  const wing = plan.wings[1] ?? plan.wings[0], room = plan.rooms[3] ?? plan.rooms[0];
  const bay = plan.bays.find((b) => b.parentId === room.id) ?? plan.bays[0];
  const tile = plan.tiles.find((t) => t.parentId === bay.id) ?? plan.tiles[0];
  const probe = { reader: 'web:probe', surface: 'web', label: 'Probe' };
  await bpPost({ op: 'hello', ...probe });
  const rows = [
    ['site', { product: 'kettle-web', level: 'L0' }, (st) => st.sheet && st.level === '0'],
    [`bp wing ${wing.id} (a domain group, no Personas node) holds still and says so`, { product: 'kettle-web', target: { kind: 'wing', id: wing.id }, level: 'L1' }, (st) => (st.say ?? '').includes(`wing ${wing.id} is not on Personas' plan`)],
    [`room ${room.id} -> that room at level 2`, { product: 'kettle-web', target: { kind: 'room', id: room.id }, level: 'L2' }, (st) => st.level === '2' && (st.here ?? '').includes(room.name)],
    [`a Personas wing id 0:${room.id} -> the wing at level 1`, { product: 'kettle-web', target: { kind: 'wing', id: '0:' + room.id }, level: 'L1' }, (st) => st.level === '1' && (st.here ?? '').includes(room.name)],
    [`bp bay ${bay.id} -> the same bay at level 3`, { product: 'kettle-web', target: { kind: 'room', id: bay.id }, level: 'L3', say: 'A bay of ' + room.name }, (st) => st.level === '3' && (st.here ?? '').includes(bay.name)],
    [`feature ${tile.id} on lens=performance`, { product: 'kettle-web', target: { kind: 'feature', id: tile.id }, level: 'L4', hash: '#at=' + tile.id + '&lens=performance' }, (st) => st.featureSheet],
    ['an unknown id holds still', { product: 'kettle-web', target: { kind: 'room', id: 'ghost-capability' }, level: 'L2' }, (st) => (st.say ?? '').includes('ghost-capability')],
    ['a product Personas has not got', { product: 'kettle-desk', target: { kind: 'room', id: 'booking' }, level: 'L2' }, (st) => (st.say ?? st.pickerNote ?? '').includes('Not in Personas: kettle-desk')],
    ['another Personas product opens its sheet at the place', { product: 'kettle-phone', target: { kind: 'room', id: 'member-experience' }, level: 'L2' }, (st) => st.sheet && (st.product ?? '').includes('Kettle Phone') && st.level === '2' && (st.here ?? '').includes('Member Experience')],
  ];
  // the sheet must be open on kettle-web for the in-place rows: the first publish opens it from the tab
  for (const [i, [label, place, check]] of rows.entries()) {
    await bpPost({ op: 'publish', ...probe, place });
    await landed(`table: ${label}`, check);
    await shot(page, `table-${String(i + 1).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`);
  }
  // the bp bay id in the row above is bp's bay id (`<cap>.<kind>` in bp's plan when it has one)
  log({ table: { wing: wing.id, room: room.id, bay: bay.id, tile: tile.id } });
}

// ---------------------------------------------------------------- the Morning tab decides
if (PHASES.has('morning')) {
  await open('morning');
  await page.waitForSelector('[data-card]', { timeout: 20000 });
  await sleep(1500);
  const before = await bpGet('/api/companion/morning');
  const dec = before.cards.filter((c) => c.kind === 'decision' && c.product === 'kettle-web');
  log({ step: 'morning: the deck before', decisions: dec.map((c) => ({ id: c.decision.proposal, recommend: c.decision.brief?.recommend ?? null })) });
  await shot(page, 'morning-1-before');
  const repeat = dec.find((c) => c.decision.brief?.recommend === 'decline'), plain = dec.find((c) => !c.decision.brief?.recommend);
  // walk the cursor to the repeat and press Enter: D14 takes the recommended answer, Decline with the brief's note
  const order = await page.$$eval('[data-card]', (els) => els.map((e) => e.getAttribute('data-card')));
  await page.focus('[data-testid="monitor-morning"]');
  for (let i = 0; i < order.indexOf(repeat.id); i++) await page.keyboard.press('j');
  await page.$eval(`[data-card="${repeat.id}"]`, (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await shot(page, 'morning-1b-the-repeat-and-its-brief');
  await page.focus('[data-testid="monitor-morning"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector(`[data-card="${repeat.id}"]`, { state: 'detached', timeout: 15000 }).catch(() => {});
  await sleep(800);
  await page.$eval('[data-testid="morning-said"]', (e) => e.scrollIntoView({ block: 'start' }));
  await shot(page, 'morning-2-after-enter-on-repeat');
  log({ step: 'morning: Enter on the repeat', said: await page.textContent('[data-testid="morning-said"]') });
  await page.$eval(`[data-card="${plain.id}"]`, (e) => e.scrollIntoView({ block: 'center' }));
  await page.click(`[data-testid="morning-approve-${plain.id}"]`);
  await page.waitForSelector(`[data-card="${plain.id}"]`, { state: 'detached', timeout: 15000 }).catch(() => {});
  await sleep(800);
  await page.$eval('[data-testid="morning-said"]', (e) => e.scrollIntoView({ block: 'start' }));
  await shot(page, 'morning-3-after-approve');
  const after = await bpGet('/api/companion/morning');
  const still = (id) => after.cards.some((c) => c.decision?.proposal === id);
  log({ step: "morning: bp's deck drops both on its next read", ok: !still(repeat.decision.proposal) && !still(plain.decision.proposal), gone: [repeat.decision.proposal, plain.decision.proposal], deckAfter: after.cards.filter((c) => c.kind === 'decision').map((c) => c.decision.proposal), said: await page.textContent('[data-testid="morning-said"]').catch(() => null) });
}

// ---------------------------------------------------------------- hidden: bp lets Personas go after LIVE_MS
if (PHASES.has('hidden')) {
  if (!PHASES.has('presence')) { await open('blueprint'); await page.waitForSelector('[data-testid="picker-follow-chip"]', { timeout: 240_000 }); await page.click('[data-testid="picker-follow-chip"]'); await sleep(1500); }
  await bpWeb.bringToFront();
  await bpWeb.goto(`${BP}/?product=kettle-web`);
  await bpWeb.waitForSelector('#fx-chip', { timeout: 30000 });
  await sleep(2000);
  log({ step: 'hidden: bp chip before', bpChip: await bpWeb.textContent('#fx-chip') });
  // the window goes hidden (minimised): document.visibilityState is 'hidden' and the event fires
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenAt = Date.now();
  const lastHello = Math.max(...moves.filter((m) => m.op === 'hello').map((m) => m.at));
  let goneAt = null, chip = '';
  while (Date.now() - hiddenAt < 90_000) {
    await sleep(2500);
    chip = (await bpWeb.textContent('#fx-chip')) ?? '';
    const v = await bpGet('/api/session/focus');
    const live = v.readers.some((r) => r.id === 'personas:main' && r.live);
    if (!/Personas/.test(chip) && !live) { goneAt = Date.now(); break; }
  }
  const hellosAfter = moves.filter((m) => m.op === 'hello' && m.at > hiddenAt).length;
  log({ step: "hidden: bp's chip shows Personas gone after LIVE_MS", ok: goneAt !== null && goneAt - lastHello >= 45_000 && hellosAfter === 0, sinceHiddenS: goneAt && (goneAt - hiddenAt) / 1000, sinceLastHelloS: goneAt && (goneAt - lastHello) / 1000, hellosAfterHidden: hellosAfter, bpChip: chip });
  await shot(bpWeb, 'hidden-bp-chip-after-45s');
}

log({ done: true, pageErrors: errors.slice(0, 20) });
await browser.close();
await server.close();
