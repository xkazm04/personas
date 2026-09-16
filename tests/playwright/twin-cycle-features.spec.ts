import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * End-to-end smoke against the live `tauri:dev:test` app for the Twin
 * plugin AFTER the 2026-09-16 v2 restructure: three tabs (Profiles /
 * Setup / Hub) instead of seven, each of the two new tabs carrying four
 * prototype renderers behind a switcher.
 *
 * Every assertion below is driven by a `data-testid` the surface actually
 * carries. The previous version of this file probed for headings in the
 * deleted Brain and Knowledge tabs ("Distilled facts", "Reflections",
 * "Recall preview") and for two pills that no longer exist; two of its
 * checks also asserted headings that never co-rendered. Nothing here
 * asserts on a control that only appears when the seeded twin happens to
 * have data — a check that cannot be driven is worse than no check.
 *
 * Pre-req: `npm run tauri:dev:test` already running (port 17320), serving
 * source that includes the v2 restructure. See
 * docs/tests/strategy/parallel-cli-workflow.md "dual-checkout trap" for why
 * frontend changes only reach the running app via the main checkout.
 */

const BASE = 'http://127.0.0.1:17320';

let app: CompanionBridge;

/** `setTwinTab` also flips `pluginTab` to 'twin', so the page mounts. */
async function openTwinTab(tab: 'profiles' | 'setup' | 'hub'): Promise<void> {
  const res = await fetch(`${BASE}/bridge-exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'setTwinTab', params: { tab } }),
  });
  const body = await res.json().catch(() => null);
  expect(res.ok, `setTwinTab(${tab}) failed: ${JSON.stringify(body)}`).toBe(true);
}

/** Poll until a selector has at least one node, or give up and report false. */
async function appears(selector: string, timeoutMs = 6_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nodes = await app.query(selector);
    if (nodes.length > 0) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

test.describe('Twin v2 — three tabs', () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
    // Both switchers remember a variant per surface. Pin the defaults so a
    // previous run's choice cannot decide which renderer these tests see.
    await fetch(`${BASE}/eval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        js: "localStorage.setItem('twin-variant:setup','conversation');localStorage.setItem('twin-variant:hub','desk')",
      }),
    });
  });

  test.beforeEach(async () => {
    // Idempotent re-seed — a previous test may have moved the active twin.
    const seedRes = await fetch(`${BASE}/bridge-exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'seedTwin', params: { name: 'Smoke Test Twin' } }),
    });
    const body = await seedRes.json().catch(() => null);
    expect(seedRes.ok, `seedTwin bridge call failed: ${JSON.stringify(body)}`).toBe(true);
  });

  test('app responds and the sidebar exposes the plugins section', async () => {
    const res = await app.navigate('plugins');
    expect(res).toMatchObject({ success: true });
    const sidebarPlugins = await app.query('[data-testid="sidebar-plugins"]');
    expect(sidebarPlugins.length).toBeGreaterThan(0);
  });

  test('the Twin tile is reachable from the plugin browser', async () => {
    await fetch(`${BASE}/bridge-exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'setPluginTab', params: { tab: 'browse' } }),
    });
    await new Promise((r) => setTimeout(r, 300));
    const candidates = await app.query('h3.typo-card-label');
    const twinTile = candidates.find((n) => /^Twin$/.test(n.text.trim()));
    expect(twinTile, 'Twin tile heading was not found in plugin browser').toBeDefined();
  });

  test('Profiles renders the roster and a twin card', async () => {
    await app.navigate('plugins');
    await openTwinTab('profiles');
    expect(await appears('[data-testid="twin-page"]'), 'TwinPage did not mount').toBe(true);
    expect(
      await appears('[data-testid="twin-card"]'),
      'No twin card rendered after seedTwin — the roster is empty or the seed failed',
    ).toBe(true);
  });

  test('Setup renders its permanent chrome: readiness strip, score, variant switcher', async () => {
    await openTwinTab('setup');
    expect(await appears('[data-testid="twin-setup-page"]'), 'SetupShell did not mount').toBe(true);

    // The chrome is unconditional — it paints before any turn is in flight.
    expect(await appears('[data-testid="setup-readiness-strip"]')).toBe(true);
    expect(await appears('[data-testid="setup-readiness-score"]')).toBe(true);
    expect(await appears('[data-testid="setup-open-fields"]')).toBe(true);

    // Four slots, one segment each.
    for (const slot of ['identity', 'tone', 'channels', 'memories']) {
      const seg = await app.query(`[data-testid="setup-readiness-${slot}"]`);
      expect(seg.length, `readiness segment for "${slot}" is missing`).toBeGreaterThan(0);
    }

    // The score is a number in 0..100, printed exactly once.
    const scoreNodes = await app.query('[data-testid="setup-readiness-score"]');
    expect(scoreNodes.length).toBe(1);
    const score = Number((scoreNodes[0]?.text ?? '').trim());
    expect(Number.isFinite(score), `readiness score was not a number: "${scoreNodes[0]?.text}"`).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('Setup offers all four prototype variants, and switching mounts the picked one', async () => {
    await openTwinTab('setup');
    expect(await appears('[data-testid="setup-variant-switcher"]')).toBe(true);

    for (const id of ['conversation', 'desk', 'orbit', 'canvas']) {
      const pill = await app.query(`[data-testid="setup-variant-${id}"]`);
      expect(pill.length, `Setup variant pill "${id}" is missing from the switcher`).toBeGreaterThan(0);
    }

    // conversation is the default and renders the transcript.
    expect(await appears('[data-testid="setup-transcript"]'), 'ConversationVariant did not render').toBe(true);

    // Orbit and Canvas landed in this spark; before it they were dimmed and
    // marked pending, so this is the check that proves the flip is real.
    await app.clickTestId('setup-variant-orbit');
    expect(await appears('[data-testid="setup-orbit"]'), 'OrbitVariant did not mount when picked').toBe(true);

    await app.clickTestId('setup-variant-canvas');
    expect(await appears('[data-testid="setup-canvas-passport"]'), 'CanvasVariant did not mount when picked').toBe(true);

    await app.clickTestId('setup-variant-conversation');
    expect(await appears('[data-testid="setup-transcript"]')).toBe(true);
  });

  test('the Setup fields drawer opens on every slot, including one tone field per channel', async () => {
    await openTwinTab('setup');
    expect(await appears('[data-testid="setup-open-fields"]')).toBe(true);
    await app.clickTestId('setup-open-fields');
    expect(await appears('[data-testid="setup-fields-drawer"]'), 'fields drawer did not open').toBe(true);

    for (const slot of ['name', 'role', 'bio', 'obsidianSubpath']) {
      const field = await app.query(`[data-testid="setup-field-${slot}"]`);
      expect(field.length, `drawer field "${slot}" is missing`).toBeGreaterThan(0);
    }

    // The tone slots are the reason the drawer reads `session.values` rather
    // than the profile row — the store has no field for them, so before the
    // fix every tone input opened blank. At minimum the generic one exists.
    const toneFields = await app.query('[data-testid^="setup-field-tone-"]');
    expect(toneFields.length, 'no per-channel tone field in the drawer').toBeGreaterThan(0);
  });

  test('Hub renders its chrome and offers all four prototype variants', async () => {
    await openTwinTab('hub');
    expect(await appears('[data-testid="twin-hub-page"]'), 'HubShell did not mount').toBe(true);
    expect(await appears('[data-testid="hub-variant-switcher"]')).toBe(true);

    for (const id of ['desk', 'river', 'map', 'contacts']) {
      const pill = await app.query(`[data-testid="hub-variant-${id}"]`);
      expect(pill.length, `Hub variant pill "${id}" is missing from the switcher`).toBeGreaterThan(0);
    }

    // The chrome renders whether or not the feed has anything in it: a fetch
    // never replaces it, and an empty feed is not an error.
    await app.clickTestId('hub-variant-river');
    expect(await appears('[data-testid="twin-hub-page"]')).toBe(true);
    await app.clickTestId('hub-variant-desk');
    expect(await appears('[data-testid="twin-hub-page"]')).toBe(true);
  });

  test('a retired tab id is refused by the bridge and leaves the page standing', async () => {
    // Six ids left `TwinTab` with the pages that used them. The bridge's
    // allow-list collapsed with the union, so naming one is now an error
    // rather than a navigation to a blank screen.
    await openTwinTab('profiles');
    const res = await fetch(`${BASE}/bridge-exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'setTwinTab', params: { tab: 'knowledge' } }),
    });
    const raw = await res.text();
    expect(raw, 'a retired twin tab id was accepted by the bridge').toMatch(/Invalid twin tab/i);
    expect(await appears('[data-testid="twin-page"]'), 'TwinPage blanked after a refused id').toBe(true);
  });
});
