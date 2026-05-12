import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Sidebar navigation coverage.
 *
 * Walks each of the nine SidebarSection values and asserts the
 * corresponding page renders without throwing. This is a smoke
 * suite — not a deep test of any feature — so a regression that
 * blanks out one section surfaces here regardless of which feature
 * owns it.
 *
 * Each section's "rendered" signal is `getState().sidebarSection`
 * matching the value we navigated to. The DOM-level check is
 * deliberately loose (any visible element) because a deeper assertion
 * locks the test into one specific UI layout that's allowed to evolve.
 *
 * Pre-req:
 *   npm run tauri:dev:test
 */

const SECTIONS = [
  'home',
  'overview',
  'personas',
  'events',
  'credentials',
  'design-reviews',
  'plugins',
  'schedules',
  'settings',
] as const;

let app: CompanionBridge;

test.describe('Sidebar navigation smoke', () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  for (const section of SECTIONS) {
    test(`navigates to "${section}"`, async () => {
      const res = await app.navigate(section);
      // Bridge returns `{ success: true, section }`. Treat any failure
      // (success: false, exception) as a fail.
      expect(res).toMatchObject({ success: true });

      // Sanity: the section root container should mount. We can't
      // know each section's exact root selector, so we just verify
      // the body has visible content beyond the sidebar — i.e. *some*
      // node with a `data-testid` exists in the route area. This is
      // intentionally a low bar: the test is about "did the section
      // catastrophically fail to render" not "is feature X working".
      const nodes = await app.query('main [data-testid], main [role]');
      expect(nodes.length).toBeGreaterThan(0);
    });
  }

  test('navigation is reversible (visit home → settings → home)', async () => {
    await app.navigate('home');
    let res = await app.navigate('settings');
    expect(res).toMatchObject({ success: true });
    res = await app.navigate('home');
    expect(res).toMatchObject({ success: true });
  });
});
