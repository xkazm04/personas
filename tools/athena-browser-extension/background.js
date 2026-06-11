/**
 * Athena Browser Bridge — MV3 service worker.
 *
 * WS client for the Personas desktop app's browser-bridge
 * (src-tauri/src/browser_bridge/relay.rs). Answers browser_* command frames:
 *
 *   bridge → ext : {"id": n, "method": "browser_*", "params": {...}}
 *   ext  → bridge: {"id": n, "result": ...} | {"id": n, "error": "msg"}
 *   ext  → bridge: {"event": "ping"}  (keepalive, no id)
 *
 * Design constraints:
 * - The extension ONLY drives the dedicated test tab it created itself —
 *   never the user's existing tabs. That tab is opened on the first
 *   browser_navigate and reused for the session.
 * - Console capture needs chrome.debugger (CDP Runtime/Log/Network events);
 *   Chrome shows the "is debugging this browser" infobar while attached —
 *   that visibility is intentional.
 * - WS traffic resets the MV3 service-worker idle timer (Chrome 116+), so a
 *   20s keepalive keeps the worker alive while paired; a 1-minute alarm is
 *   the wake-up fallback that re-establishes a dropped connection.
 *
 * Config: chrome.storage.local {port, token, enabled} (set via options page)
 * overrides the packaged config.json (used by automated QA harnesses).
 */

let sock = null;
let sockGeneration = 0;
let keepaliveTimer = null;

let testTabId = null;
let debuggerAttached = false;
/** Console/network entries captured since attach. Bounded ring. */
let consoleBuf = [];
const CONSOLE_BUF_MAX = 200;

// ── Config ───────────────────────────────────────────────────────────────────

async function loadConfig() {
  const stored = await chrome.storage.local.get(['port', 'token', 'enabled']);
  if (stored.token) {
    return {
      port: Number(stored.port) || 17400,
      token: String(stored.token),
      enabled: stored.enabled !== false,
    };
  }
  try {
    const res = await fetch(chrome.runtime.getURL('config.json'));
    const cfg = await res.json();
    if (cfg?.token) {
      return { port: Number(cfg.port) || 17400, token: String(cfg.token), enabled: true };
    }
  } catch {
    /* no packaged config — needs options-page pairing */
  }
  return null;
}

// ── Connection ───────────────────────────────────────────────────────────────

async function ensureConnected() {
  if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const cfg = await loadConfig();
  if (!cfg || !cfg.enabled) {
    await setStatus('unpaired');
    return;
  }
  const gen = ++sockGeneration;
  const url = `ws://127.0.0.1:${cfg.port}/browser-bridge/ws?token=${encodeURIComponent(cfg.token)}`;
  const ws = new WebSocket(url);
  sock = ws;

  ws.onopen = () => {
    if (gen !== sockGeneration) return;
    console.log('[athena-bridge] connected to Personas app');
    setStatus('connected');
    clearInterval(keepaliveTimer);
    keepaliveTimer = setInterval(() => {
      try {
        ws.send(JSON.stringify({ event: 'ping' }));
      } catch {
        /* close handler reconnects */
      }
    }, 20_000);
  };
  ws.onmessage = async (ev) => {
    let frame;
    try {
      frame = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text());
    } catch {
      return;
    }
    if (frame.id === undefined) return;
    let reply;
    try {
      const result = await handleCommand(frame.method, frame.params ?? {});
      reply = { id: frame.id, result };
    } catch (e) {
      reply = { id: frame.id, error: String(e?.message ?? e) };
    }
    try {
      ws.send(JSON.stringify(reply));
    } catch {
      /* connection died mid-command; bridge times out cleanly */
    }
  };
  ws.onclose = () => {
    if (gen !== sockGeneration) return;
    clearInterval(keepaliveTimer);
    sock = null;
    setStatus('disconnected');
    setTimeout(ensureConnected, 3_000);
  };
  ws.onerror = () => {
    /* onclose follows */
  };
}

async function setStatus(status) {
  try {
    await chrome.storage.session.set({ bridgeStatus: status, bridgeStatusAt: Date.now() });
    await chrome.action.setBadgeText({ text: status === 'connected' ? '●' : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  } catch {
    /* cosmetic */
  }
}

chrome.runtime.onInstalled.addListener(ensureConnected);
chrome.runtime.onStartup.addListener(ensureConnected);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.token || changes.port || changes.enabled)) {
    try {
      sockGeneration++; // invalidate current socket's handlers
      sock?.close();
    } catch { /* fresh connect below */ }
    sock = null;
    ensureConnected();
  }
});
chrome.alarms.create('athena-bridge-reconnect', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'athena-bridge-reconnect') ensureConnected();
});
ensureConnected();

// ── Test tab management ──────────────────────────────────────────────────────

async function getTestTab() {
  if (testTabId === null) return null;
  try {
    return await chrome.tabs.get(testTabId);
  } catch {
    testTabId = null;
    debuggerAttached = false;
    return null;
  }
}

async function ensureTestTab(url) {
  const existing = await getTestTab();
  if (existing) {
    if (url) {
      await chrome.tabs.update(existing.id, { url, active: true });
      await waitForTabComplete(existing.id);
    }
    return existing.id;
  }
  const tab = await chrome.tabs.create({ url: url ?? 'about:blank', active: true });
  testTabId = tab.id;
  await waitForTabComplete(tab.id);
  return tab.id;
}

function waitForTabComplete(tabId, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') return resolve();
      } catch {
        return resolve(); // tab gone; caller surfaces the real error
      }
      if (Date.now() > deadline) return resolve();
      setTimeout(poll, 250);
    };
    poll();
  });
}

// ── Debugger (console capture) ───────────────────────────────────────────────

async function ensureDebugger(tabId) {
  if (debuggerAttached) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  debuggerAttached = true;
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
  await chrome.debugger.sendCommand({ tabId }, 'Log.enable');
  await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
}

function pushConsole(entry) {
  consoleBuf.push(entry);
  if (consoleBuf.length > CONSOLE_BUF_MAX) consoleBuf.shift();
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== testTabId) return;
  if (method === 'Runtime.exceptionThrown') {
    const d = params.exceptionDetails;
    const text =
      d?.exception?.description ?? d?.text ?? 'Uncaught exception (no description)';
    pushConsole({ level: 'error', text });
  } else if (method === 'Runtime.consoleAPICalled') {
    if (params.type === 'error' || params.type === 'warning') {
      const text = (params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(' ');
      pushConsole({ level: params.type, text });
    }
  } else if (method === 'Log.entryAdded') {
    const e = params.entry;
    if (e.level === 'error' || e.level === 'warning') {
      pushConsole({ level: e.level, text: `${e.source}: ${e.text}${e.url ? ` (${e.url})` : ''}` });
    }
  } else if (method === 'Network.loadingFailed') {
    pushConsole({
      level: 'error',
      text: `network: loading failed — ${params.errorText} (${params.type})`,
    });
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === testTabId) debuggerAttached = false;
});

// ── Page script helpers (run inside the test tab) ────────────────────────────

function pageSnapshot() {
  const lines = [`page url: ${location.href}`, `title: ${document.title}`];
  const seen = new Set();
  const describe = (el) => {
    if (el.id) return `#${el.id}`;
    const cls = typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    return `${el.tagName.toLowerCase()}${cls}`;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const walk = (root, depth) => {
    if (depth > 12 || lines.length > 300) return;
    for (const el of root.children) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
      if (!visible(el) && !['OPTION'].includes(el.tagName)) {
        // Hidden content still matters for audit (e.g. white-on-white text is
        // "visible" per rects; display:none is not) — skip true zero-size.
        continue;
      }
      const tag = el.tagName.toLowerCase();
      const text = (el.childElementCount === 0 ? el.textContent : '')?.trim().slice(0, 160);
      if (/^h[1-6]$/.test(tag)) {
        lines.push(`heading ${tag}: "${el.textContent.trim().slice(0, 120)}" [${describe(el)}]`);
      } else if (tag === 'button' || (tag === 'input' && ['button', 'submit'].includes(el.type))) {
        lines.push(`button: "${(el.textContent || el.value || '').trim().slice(0, 80)}" [${describe(el)}]`);
      } else if (tag === 'a' && el.href) {
        lines.push(`link: "${el.textContent.trim().slice(0, 80)}" → ${el.getAttribute('href')} [${describe(el)}]`);
      } else if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        lines.push(
          `${tag}[type=${el.type ?? 'text'}]: value="${String(el.value ?? '').slice(0, 80)}" placeholder="${el.placeholder ?? ''}" [${describe(el)}]`,
        );
      } else if (tag === 'li') {
        const cls = el.className ? ` [class=${el.className}]` : '';
        lines.push(`  - listitem${cls}: "${el.textContent.trim().slice(0, 120)}"`);
      } else if (tag === 'ul' || tag === 'ol') {
        lines.push(`list [${describe(el)}] (${el.children.length} items):`);
      } else if (text && !seen.has(text)) {
        seen.add(text);
        lines.push(`text: "${text}"`);
      }
      walk(el, depth + 1);
    }
  };
  walk(document.body, 0);
  return lines.join('\n').slice(0, 12_000);
}

function pageClick(selector, text) {
  let el = null;
  if (selector) el = document.querySelector(selector);
  if (!el && text) {
    const want = text.trim().toLowerCase();
    const candidates = [
      ...document.querySelectorAll('button, a, input[type=button], input[type=submit], [role=button], li, label'),
    ];
    el =
      candidates.find((c) => (c.textContent || c.value || '').trim().toLowerCase() === want) ??
      candidates.find((c) => (c.textContent || c.value || '').trim().toLowerCase().includes(want));
  }
  if (!el) return { ok: false, error: `no element matched selector=${selector ?? '-'} text=${text ?? '-'}` };
  el.scrollIntoView({ block: 'center' });
  el.click();
  const d = el.id ? `#${el.id}` : el.tagName.toLowerCase();
  return { ok: true, clicked: d, text: (el.textContent || el.value || '').trim().slice(0, 60) };
}

function pageType(selector, text, submit) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, error: `no element matched ${selector}` };
  el.focus();
  // React-controlled inputs ignore plain .value writes — use the native
  // setter so the framework's onChange sees the change.
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  let submitted = false;
  if (submit) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const form = el.closest('form');
    if (form) {
      form.requestSubmit ? form.requestSubmit() : form.submit();
      submitted = true;
    }
  }
  return { ok: true, typed: text, submitted };
}

function pageContainsText(text) {
  return document.body.innerText.toLowerCase().includes(text.toLowerCase());
}

async function execInTab(tabId, func, args = []) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return result;
}

// ── Command handlers ─────────────────────────────────────────────────────────

async function handleCommand(method, params) {
  switch (method) {
    case 'browser_status': {
      const tab = await getTestTab();
      return {
        extension_version: chrome.runtime.getManifest().version,
        tab: tab ? { url: tab.url, title: tab.title } : null,
        debugger_attached: debuggerAttached,
      };
    }
    case 'browser_navigate': {
      if (!params.url) throw new Error('browser_navigate needs url');
      consoleBuf = [];
      const tabId = await ensureTestTab(params.url);
      await ensureDebugger(tabId);
      const tab = await chrome.tabs.get(tabId);
      return { ok: true, url: tab.url, title: tab.title };
    }
    case 'browser_snapshot': {
      const tabId = await requireTab();
      return await execInTab(tabId, pageSnapshot);
    }
    case 'browser_click': {
      const tabId = await requireTab();
      return await execInTab(tabId, pageClick, [params.selector ?? null, params.text ?? null]);
    }
    case 'browser_type': {
      const tabId = await requireTab();
      if (!params.selector) throw new Error('browser_type needs selector');
      return await execInTab(tabId, pageType, [
        params.selector,
        params.text ?? '',
        Boolean(params.submit),
      ]);
    }
    case 'browser_screenshot': {
      const tabId = await requireTab();
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      await new Promise((r) => setTimeout(r, 150)); // let the activation paint
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return { data: dataUrl.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' };
    }
    case 'browser_console':
      return { entries: consoleBuf };
    case 'browser_wait_for': {
      const tabId = await requireTab();
      const timeout = Math.min(Number(params.timeout_ms) || 5_000, 30_000);
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await execInTab(tabId, pageContainsText, [params.text ?? ''])) {
          return { found: true, text: params.text };
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      return { found: false, text: params.text, waited_ms: timeout };
    }
    case 'browser_detach': {
      const tab = await getTestTab();
      if (tab && debuggerAttached) {
        try {
          await chrome.debugger.detach({ tabId: tab.id });
        } catch { /* already detached */ }
      }
      debuggerAttached = false;
      consoleBuf = [];
      return { ok: true, detached: true, tab_kept_open: Boolean(tab) };
    }
    default:
      throw new Error(`unknown command ${method}`);
  }
}

async function requireTab() {
  const tab = await getTestTab();
  if (!tab) throw new Error('no test tab — call browser_navigate first');
  return tab.id;
}
