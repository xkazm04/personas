/**
 * Dev-team Glyph template-adoption driver (live, 1:1).
 *
 * Drives the running tauri:dev:test app through the test-automation HTTP
 * bridge (:17320) using DOM-level primitives only — no IPC shortcuts, so it
 * exercises the real user path. See docs/tests/autonomous-dev-team-adoption-test.md.
 *
 * Usage (node 18+):
 *   node tests/playwright/dev-team-adoption-driver.mjs health
 *   node tests/playwright/dev-team-adoption-driver.mjs dump            # list visible testids
 *   node tests/playwright/dev-team-adoption-driver.mjs gallery         # open Templates
 *   node tests/playwright/dev-team-adoption-driver.mjs find "<text>"   # find-text dump
 *   node tests/playwright/dev-team-adoption-driver.mjs open "<name>"   # gallery → search → open + Adopt
 *   node tests/playwright/dev-team-adoption-driver.mjs inspect-modal   # dump the adoption modal DOM
 *   node tests/playwright/dev-team-adoption-driver.mjs adopt "<name>"  # full flow (WIP: answering refined live)
 */

const PORT = process.env.COMPANION_TEST_PORT ?? '17320';
// localhost resolves to ::1 in this env (the bridge binds IPv6 loopback).
const BASE = `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}
const get = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
};

const health = () => get('/health');
const query = (selector) => call('/query', { selector });
const findText = (text) => call('/find-text', { text });
const clickTestId = (test_id) => call('/click-testid', { test_id });
const evalJs = (js) => call('/eval', { js });

async function waitForHealth(timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const h = await health();
      if (h?.status === 'ok') return h;
    } catch { /* not up yet */ }
    await sleep(2000);
  }
  throw new Error('bridge :17320 did not become healthy in time');
}

async function waitForTestId(id, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await query(`[data-testid="${id}"]`);
    if (n.some((x) => x.visible)) return true;
    await sleep(150);
  }
  return false;
}

async function waitForText(text, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await findText(text);
    if (n.some((x) => x.visible)) return n.filter((x) => x.visible);
    await sleep(150);
  }
  return [];
}

/** Type into a React-controlled input via the native value setter + input event. */
async function typeInto(selector, value) {
  return evalJs(
    `(() => { const i = document.querySelector(${JSON.stringify(selector)});` +
    ` if (!i) return 'no-input';` +
    ` const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;` +
    ` s.call(i, ${JSON.stringify(value)});` +
    ` i.dispatchEvent(new Event('input', { bubbles: true }));` +
    ` return 'typed'; })()`,
  );
}

/** Click the first <button> whose innerText contains `text`. */
async function clickButtonByText(text) {
  return evalJs(
    `(() => { const b = Array.from(document.querySelectorAll('button'))` +
    `.find((x) => ((x.innerText || '').trim().includes(${JSON.stringify(text)})));` +
    ` if (!b) return false; b.click(); return true; })()`,
  );
}

const dumpTestids = async () => {
  const nodes = await query('[data-testid]');
  return nodes.filter((n) => n.visible).map((n) => ({ id: n.testId, text: (n.text || '').slice(0, 50) }));
};

// ── Adoption steps ──────────────────────────────────────────────────────

async function openGallery() {
  await clickTestId('sidebar-design-reviews');
  await sleep(1200);
  return waitForTestId('templates-page', 5000);
}

/** Search the gallery + return the visible template-row whose text matches name. */
async function findTemplateRow(name) {
  await typeInto('[data-testid="template-search-input"]', name);
  await sleep(1200);
  const rows = (await query('[data-testid^="template-row-"]')).filter((n) => n.visible);
  return rows.find((r) => (r.text || '').includes(name)) ?? rows[0] ?? null;
}

async function openTemplate(name) {
  await openGallery();
  const row = await findTemplateRow(name);
  if (!row?.testId) throw new Error(`template row for "${name}" not found`);
  await clickTestId(row.testId);
  await sleep(800);
  // Adopt CTA — try testid, then text.
  if (await waitForTestId('adopt-template', 1500)) {
    await clickTestId('adopt-template');
  } else {
    const ok = await clickButtonByText('Adopt');
    if (!ok?.success && ok !== true) {
      // re-find after expand
      await sleep(400);
      await clickButtonByText('Adopt');
    }
  }
  await sleep(1500);
  const modal = await query('[aria-labelledby="adoption-matrix-title"]');
  return modal[0] ?? null;
}

/** Dump the adoption modal structure for mapping the glyph flow. */
async function inspectModal() {
  const modal = await query('[aria-labelledby="adoption-matrix-title"]');
  if (!modal[0]) return { open: false };
  const testids = (await query('[aria-labelledby="adoption-matrix-title"] [data-testid]'))
    .filter((n) => n.visible).map((n) => ({ id: n.testId, tag: n.tag, text: (n.text || '').slice(0, 40) }));
  const buttons = (await query('[aria-labelledby="adoption-matrix-title"] button'))
    .filter((n) => n.visible).map((n) => (n.text || '').slice(0, 40)).filter(Boolean);
  return { open: true, testids, buttons };
}

// ── CLI ─────────────────────────────────────────────────────────────────

const [cmd, arg] = process.argv.slice(2);
const out = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));

try {
  switch (cmd) {
    case 'health': out(await health()); break;
    case 'wait': out(await waitForHealth(Number(arg) || 240_000)); break;
    case 'dump': out(await dumpTestids()); break;
    case 'find': out((await findText(arg)).filter((n) => n.visible).map((n) => ({ tag: n.tag, id: n.testId, text: (n.text || '').slice(0, 60) }))); break;
    case 'gallery': out(await openGallery()); break;
    case 'open': out(await openTemplate(arg)); break;
    case 'inspect-modal': out(await inspectModal()); break;
    default:
      out('commands: health | wait [ms] | dump | find <text> | gallery | open <name> | inspect-modal');
  }
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
