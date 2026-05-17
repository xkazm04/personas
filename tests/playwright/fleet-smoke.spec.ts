import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Fleet plugin smoke test against the live Tauri app.
 *
 * Pre-req:
 *   npm run tauri:dev:test
 * (The running app must have the fleet branch's source — either via a
 * merge into master so HMR picks it up, or by launching a second app
 * from the worktree with `COMPANION_TEST_PORT` set.)
 *
 * Coverage:
 *  1. Fleet sidebar entry is visible (DEV-only — only renders when
 *     enabledPlugins contains 'fleet', which is gated by
 *     import.meta.env.DEV in uiSlice.ts).
 *  2. Three sub-tabs render: Sessions / Decisions / Settings.
 *  3. Settings tab — install/uninstall hook round-trip ends in the
 *     same banner state we started in (no side-effect leakage).
 *  4. Sessions tab — spawn flyout opens + cancels (does NOT actually
 *     spawn; that requires a real cwd and would launch `claude`).
 *  5. Decisions tab — composer text area accepts input.
 *
 * Bridge methods used: navigate, clickTestId, query, waitFor. No
 * bridge.ts changes — fleet is reachable via existing primitives, so
 * this spec runs without needing an app restart.
 */

let app: CompanionBridge;

const FLEET_TABS = ['grid', 'decisions', 'settings'] as const;

async function openFleet(app: CompanionBridge): Promise<void> {
  await app.navigate('plugins');
  // The sidebar entry only renders in DEV builds — fail fast with a
  // clear message if it's missing so the user knows it's a build-tier
  // issue rather than a Fleet bug.
  const fleetSidebar = await app.query('[data-testid="tab-fleet"]');
  if (fleetSidebar.length === 0) {
    throw new Error(
      'tab-fleet not found in sidebar — is the running app a DEV build (tauri:dev:test)? Production builds gate Fleet behind import.meta.env.DEV.',
    );
  }
  await app.clickTestId('tab-fleet');
}

test.describe('Fleet plugin smoke', () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('sidebar entry renders and opens the Fleet plugin', async () => {
    await openFleet(app);
    // Default sub-tab is 'grid' (uiSlice initial state).
    const grid = await app.query('[data-testid="fleet-grid-page"]');
    expect(grid.length).toBeGreaterThan(0);
  });

  for (const subtab of FLEET_TABS) {
    test(`sub-tab "${subtab}" navigates`, async () => {
      await openFleet(app);
      await app.clickTestId(`fleet-subtab-${subtab}`);
      const wrapper = await app.query(`[data-testid="fleet-${subtab}-page"]`);
      expect(wrapper.length).toBeGreaterThan(0);
    });
  }

  test('Settings — install/uninstall round-trip returns to baseline', async () => {
    await openFleet(app);
    await app.clickTestId('fleet-subtab-settings');
    // Wait for the settings page to mount.
    await app.waitFor('[data-testid="fleet-settings-page"]');

    // Capture the starting banner — installed OR missing. Mismatch
    // means the user has stale hooks pointing at a different port;
    // we treat that as a precondition failure rather than try to fix it.
    const installedBefore = await app.query('[data-testid="fleet-hooks-banner-installed"]');
    const missingBefore = await app.query('[data-testid="fleet-hooks-banner-missing"]');
    const mismatchBefore = await app.query('[data-testid="fleet-hooks-banner-mismatch"]');
    expect(mismatchBefore.length).toBe(0);
    expect(installedBefore.length + missingBefore.length).toBe(1);
    const startedInstalled = installedBefore.length > 0;

    // Toggle once — install if missing, uninstall if installed.
    if (startedInstalled) {
      await app.clickTestId('fleet-uninstall-hooks');
      // Wait until the banner flips.
      await app.waitFor('[data-testid="fleet-hooks-banner-missing"]', 5_000);
    } else {
      await app.clickTestId('fleet-install-hooks');
      await app.waitFor('[data-testid="fleet-hooks-banner-installed"]', 5_000);
    }

    // Toggle back so we leave the user's settings.json the way we
    // found it.
    if (startedInstalled) {
      await app.clickTestId('fleet-install-hooks');
      await app.waitFor('[data-testid="fleet-hooks-banner-installed"]', 5_000);
    } else {
      await app.clickTestId('fleet-uninstall-hooks');
      await app.waitFor('[data-testid="fleet-hooks-banner-missing"]', 5_000);
    }

    // Final assertion — baseline restored.
    const installedAfter = await app.query('[data-testid="fleet-hooks-banner-installed"]');
    const missingAfter = await app.query('[data-testid="fleet-hooks-banner-missing"]');
    expect(installedAfter.length > 0).toBe(startedInstalled);
    expect(missingAfter.length > 0).toBe(!startedInstalled);
  });

  test('Sessions — spawn flyout opens and cancels without launching a session', async () => {
    await openFleet(app);
    await app.clickTestId('fleet-subtab-grid');
    await app.waitFor('[data-testid="fleet-grid-page"]');

    // Flyout starts hidden.
    let flyout = await app.query('[data-testid="fleet-spawn-flyout"]');
    expect(flyout.length).toBe(0);

    // Open it.
    await app.clickTestId('fleet-spawn-toggle');
    flyout = await app.query('[data-testid="fleet-spawn-flyout"]');
    expect(flyout.length).toBeGreaterThan(0);

    // Cancel — same button toggles back.
    await app.clickTestId('fleet-spawn-toggle');
    flyout = await app.query('[data-testid="fleet-spawn-flyout"]');
    expect(flyout.length).toBe(0);

    // Sanity: no session row appeared (we never typed a cwd / clicked Spawn).
    // The grid empty-state copy ("No sessions yet") is brittle — better to
    // just assert that fleet-spawn-confirm never got clicked by confirming
    // no terminal pane was attached.
    const term = await app.query('[data-testid^="fleet-terminal-"]');
    expect(term.length).toBe(0);
  });

  test('Decisions — composer accepts text input', async () => {
    await openFleet(app);
    await app.clickTestId('fleet-subtab-decisions');
    await app.waitFor('[data-testid="fleet-decisions-page"]');

    await app.fillField('fleet-decision-text', 'approve');
    const nodes = await app.query('[data-testid="fleet-decision-text"]');
    expect(nodes.length).toBeGreaterThan(0);
    // The /query endpoint includes the textarea's value via the `text`
    // field for inputs/textareas; if it doesn't, /fill-field success
    // is the strongest evidence we have without a getState bridge call.
  });
});
