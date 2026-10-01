// Integrated-page capture of the Activity board with the usage strip simulated.
// usage: node shot_probe.cjs <outDir> [probe]
const { chromium } = require('C:/Users/kazda/kiro/personas/node_modules/playwright');

const MOCK = () => {
  window.__PERSONAS_TEST_MODE__ = true;
  window.__invoked = [];
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  try { localStorage.setItem('__personas_user_consent_accepted', '3'); } catch { /* ignore */ }
  let cb = 1;
  const fixtures = {
    fleet_claude_accounts_list: { activeAccountId: null, liveEmail: null, liveCaptured: false, livePresent: false, accounts: [], profiles: [], autoRotate: { enabled: false, thresholdPct: 80, cooldownSecs: 900 }, lastRotation: null },
    get_circuit_breaker_status: { providers: [], recentTransitions: [] },
    fleet_queue_snapshot: { entries: [], cap: 3, running: 0, overAdmitted: 0, paused: false, autopilot: false },
    fleet_cli_usage: { providers: [] },
    fleet_list_sessions: { sessions: [], hookPort: 0, fleet: null, hooksInstalled: true },
    get_auth_state: { is_authenticated: true, is_offline: false, is_offline_authenticated: false, user: { id: 'u', email: 'sim@simulated.test', display_name: 'Sim' }, subscription: null },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
      windows: [{ label: 'main' }],
      webviews: [{ windowLabel: 'main', label: 'main' }],
    },
    plugins: {},
    transformCallback: (f) => { const id = cb++; window['_' + id] = f; return id; },
    unregisterCallback: () => {},
    convertFileSrc: (p) => p,
    invoke: async (cmd) => {
      window.__invoked.push(cmd);
      if (cmd === 'plugin:event|listen') return 1;
      if (cmd.startsWith('plugin:')) return null;
      if (cmd in fixtures) return fixtures[cmd];
      // Universal empty: an array that also answers to the usual page/collection fields.
      return Object.assign([], { rows: [], items: [], ideas: [], data: [], sessions: [], providers: [], proposals: [], hasMore: false, nextCursor: null, total: 0, count: 0, pending: 0, approved: 0, rejected: 0, unread: 0, running: 0, counts: { pending: 0, accepted: 0, rejected: 0, total: 0 } });
    },
  };
};

(async () => {
  const outDir = process.argv[2];
  const probe = process.argv[3] === 'probe';
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const shots = probe
    ? [{ w: 1280, h: 800, scheme: 'dark', name: 'probe' }]
    : [
      { w: 1280, h: 800, scheme: 'dark', name: 'activity-needs-you-1280x800-dark' },
      { w: 1280, h: 800, scheme: 'light', name: 'activity-needs-you-1280x800-light' },
      { w: 1920, h: 1080, scheme: 'dark', name: 'activity-needs-you-1920x1080-dark' },
      { w: 1920, h: 1080, scheme: 'light', name: 'activity-needs-you-1920x1080-light' },
    ];
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.scheme });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/UNHANDLED|global-error|stampede/.test(m.text())) console.log('console.error:', m.text().slice(0, 240)); });
    page.on('pageerror', (e) => { if (!/unregisterListener/.test(String(e))) console.log('pageerror:', String(e).slice(0, 240)); });
    await page.addInitScript(MOCK);
    await page.addInitScript((scheme) => {
      try { localStorage.setItem('persona-theme', JSON.stringify({ state: { themeId: scheme === 'light' ? 'light-ice' : 'dark-midnight' }, version: 0 })); } catch { /* ignore */ }
    }, s.scheme);
    await page.goto('http://localhost:1420/', { waitUntil: 'load' });
    await page.waitForTimeout(7000);
    console.log(s.name, 'body:', (await page.evaluate(() => document.body.innerText)).slice(0, 160).replace(/\n/g, ' | '));
    await page.locator('[data-testid="titlebar-process-activity"]').click();
    await page.waitForTimeout(5000);
    const sim = page.locator('[data-testid="fleet-grid-simulation-toggle"]');
    console.log('sim toggle:', await sim.count());
    if (await sim.count()) {
      await sim.first().click();
      await page.waitForTimeout(4000);
    }
    if (probe) {
      console.log('invoked:', JSON.stringify([...new Set(await page.evaluate(() => window.__invoked))]).slice(0, 800));
      console.log('testids:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).slice(0, 80))));
    }
    await page.screenshot({ path: `${outDir}/${s.name}.png` });
    await ctx.close();
  }
  await browser.close();
})();
