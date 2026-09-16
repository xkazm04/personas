import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * End-to-end smoke against the live `tauri:dev:test` app for the Twin
 * plugin AFTER the 2026-09-16 v2 restructure: three tabs (Profiles /
 * Setup / Hub) instead of seven. BOTH have been consolidated onto their Desk
 * (each prototype switcher and its three losing renderers are gone); the Hub's
 * Desk carries four LANES over the one feed — Queue, History, Knowledge,
 * Replies — which is where the deleted renderers' capability went.
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
    // Nothing to pin any more: neither tab stores a renderer choice, because
    // neither tab has one. The Hub's lane is component state that starts on
    // Queue every mount, so a previous run cannot decide what these tests see.
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

  test('Setup renders its permanent chrome: readiness strip and score', async () => {
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

  test('Setup renders the Desk: the guide turn, the thread above it, the composer', async () => {
    await openTwinTab('setup');

    // One surface now. The switcher and the three losing renderers are gone,
    // and their absence is asserted rather than assumed: a leftover pill would
    // mean the consolidation only reached the imports.
    expect(await appears('[data-testid="setup-desk"]'), 'the Desk did not mount').toBe(true);
    expect((await app.query('[data-testid="setup-variant-switcher"]')).length).toBe(0);
    for (const id of ['conversation', 'orbit', 'canvas', 'desk']) {
      const pill = await app.query(`[data-testid="setup-variant-${id}"]`);
      expect(pill.length, `variant pill "${id}" survived the consolidation`).toBe(0);
    }
    expect((await app.query('[data-testid="setup-transcript"]')).length, 'the transcript variant is still rendering').toBe(0);

    // The question is a CONVERSATION TURN, not a bare prompt: the guide's turn
    // carries the question, and the composer and the key legend are permanent.
    expect(await appears('[data-testid="setup-desk-turn"]'), 'the guide turn did not render').toBe(true);
    expect(await appears('[data-testid="setup-desk-question"]')).toBe(true);
    expect(await appears('[data-testid="setup-desk-composer"]')).toBe(true);

    // Suggestions are the generator's, so their COUNT is not asserted — but
    // whatever arrives must be numbered from 1 without a hole, because the
    // digit keys are bound to exactly those positions.
    const first = await app.query('[data-testid="setup-desk-suggestion-1"]');
    if (first.length > 0) {
      let n = 1;
      while ((await app.query(`[data-testid="setup-desk-suggestion-${n + 1}"]`)).length > 0) n++;
      expect(n, 'more suggestion cards than the digit keys bind').toBeLessThanOrEqual(3);
    }

    // The trail is a thread, never a transcript: at most the last two
    // exchanges are open, the rest sit behind the "earlier" row.
    const trail = await app.query('[data-testid="setup-desk-trail"]');
    if (trail.length > 0) {
      const open = await app.query('[data-testid="setup-desk-trail-exchange"]');
      const earlier = await app.query('[data-testid="setup-desk-trail-earlier"]');
      if (earlier.length === 0) {
        expect(open.length, 'the trail grew into a transcript').toBeLessThanOrEqual(2);
      }
    }
  });

  test('the Setup Fields PAGE carries every slot, including a full tone card per channel', async () => {
    await openTwinTab('setup');
    // `setup-open-fields` is the Fields tab of the mode switch since the drawer
    // became page content; the id did not move with the redesign.
    expect(await appears('[data-testid="setup-open-fields"]')).toBe(true);
    await app.clickTestId('setup-open-fields');
    expect(await appears('[data-testid="setup-fields-page"]'), 'the Fields page did not open').toBe(true);
    // And the drawer it replaced is gone rather than merely unreachable.
    expect((await app.query('[data-testid="setup-fields-drawer"]')).length).toBe(0);

    // One band per checklist slot, in SETUP_FOCUS_ORDER.
    for (const slot of ['identity', 'tone', 'channels', 'memories']) {
      const section = await app.query(`[data-testid="setup-fields-section-${slot}"]`);
      expect(section.length, `Fields band for "${slot}" is missing`).toBeGreaterThan(0);
    }

    for (const slot of ['name', 'role', 'bio', 'obsidianSubpath']) {
      const field = await app.query(`[data-testid="setup-field-${slot}"]`);
      expect(field.length, `field "${slot}" is missing from the page`).toBeGreaterThan(0);
    }

    // The tone slots are the reason the page reads `session.values` rather
    // than the profile row — the store has no field for them, so before the
    // fix every tone input opened blank. At minimum the generic one exists,
    // and it now carries the three parts the drawer never showed.
    const toneFields = await app.query('[data-testid^="setup-field-tone-"]');
    expect(toneFields.length, 'no per-channel tone field on the page').toBeGreaterThan(0);
    for (const part of ['examples', 'constraints', 'length']) {
      const parts = await app.query(`[data-testid$="-${part}"][data-testid^="setup-field-tone-"]`);
      expect(parts.length, `no tone "${part}" field on the page`).toBeGreaterThan(0);
    }
  });

  test('a readiness-strip click in Fields mode reveals that slot rather than asking a question', async () => {
    await openTwinTab('setup');
    await app.clickTestId('setup-open-fields');
    expect(await appears('[data-testid="setup-fields-page"]')).toBe(true);

    // The strip is the same control in both modes and it drives the content in
    // both: here it scrolls the band in, and the Desk is not what is showing.
    await app.clickTestId('setup-readiness-tone');
    expect(await appears('[data-testid="setup-fields-section-tone"]')).toBe(true);
    expect((await app.query('[data-testid="setup-desk"]')).length, 'Fields mode is still rendering the Desk').toBe(0);
  });

  test('Hub renders its chrome and the Desk offers all four lanes', async () => {
    await openTwinTab('hub');
    expect(await appears('[data-testid="twin-hub-page"]'), 'HubShell did not mount').toBe(true);
    expect(await appears('[data-testid="hub-desk"]'), 'HubDesk did not mount').toBe(true);

    for (const id of ['queue', 'history', 'knowledge', 'replies']) {
      const tab = await app.query(`[data-testid="hub-lane-${id}"]`);
      expect(tab.length, `Hub lane "${id}" is missing from the lane control`).toBeGreaterThan(0);
    }

    // The lane strip is a REAL tab strip: exactly one panel is rendered, and it
    // declares itself as one, so the aria-controls each tab emits resolves.
    const panel = await app.query('[role="tabpanel"]');
    expect(panel.length, 'the swapped lane region is not a tabpanel').toBe(1);

    // Every lane renders, and the chrome survives each switch whether or not
    // the feed has anything in it: a fetch never replaces it, and an empty feed
    // is not an error.
    for (const id of ['history', 'knowledge', 'replies', 'queue']) {
      await app.clickTestId(`hub-lane-${id}`);
      expect(await appears('[data-testid="twin-hub-page"]'), `chrome vanished on lane "${id}"`).toBe(true);
      expect(await appears('[data-testid="hub-desk"]'), `desk vanished on lane "${id}"`).toBe(true);
    }
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
