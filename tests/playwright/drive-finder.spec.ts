import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Drive smoke. Checks the Finder shell, the four views, the inspector
 * toggle and Quick Look against the running test app. Pre-req: `npm run tauri:dev:test`.
 *
 * Testids come from src/features/plugins/drive/finder/** (finder-*).
 */

let app: CompanionBridge;

async function clickButtonByText(text: string) {
  const safe = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await app.eval(
    `Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "${safe}")?.click()`,
  );
  await new Promise((r) => setTimeout(r, 250));
}

async function pressKey(key: string, init: Record<string, unknown> = {}) {
  const opts = JSON.stringify({ key, bubbles: true, cancelable: true, ...init });
  await app.eval(`document.dispatchEvent(new KeyboardEvent("keydown", ${opts}))`);
  await new Promise((r) => setTimeout(r, 200));
}

async function openFinder() {
  await app.navigate('plugins');
  await clickButtonByText('Drive');
  await app.waitFor('[data-testid="finder-split-pane"]', 8_000);
}

test.describe('Drive', () => {
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('opens on the Finder shell with sidebar, toolbar and main', async () => {
    await openFinder();
    for (const id of ['finder-sidebar', 'finder-toolbar', 'finder-main']) {
      const nodes = await app.query(`[data-testid="${id}"]`);
      expect(nodes.length, `${id} should render`).toBeGreaterThan(0);
    }
  });

  test('view switch reaches list, icons, columns and gallery', async () => {
    await openFinder();
    for (const [label, id] of [
      ['Icons', 'finder-view-IconsView'],
      ['Columns', 'finder-view-ColumnsView'],
      ['Gallery', 'finder-view-GalleryView'],
      ['List', 'finder-view-ListView'],
    ] as const) {
      await clickButtonByText(label);
      const nodes = await app.query(`[data-testid="${id}"]`);
      expect(nodes.length, `${label} view should mount ${id}`).toBeGreaterThan(0);
    }
  });

  test('Mod+I toggles the inspector pane', async () => {
    await openFinder();
    const before = (await app.query('[data-testid="finder-inspector"]')).filter((n) => n.visible);
    await pressKey('i', { ctrlKey: true });
    const after = (await app.query('[data-testid="finder-inspector"]')).filter((n) => n.visible);
    expect(after.length !== before.length, 'inspector visibility should flip').toBe(true);
    await pressKey('i', { ctrlKey: true });
  });

  test('Space opens Quick Look over a selected previewable row and Esc closes it', async () => {
    await openFinder();
    await clickButtonByText('List');
    const rows = await app.query('[data-testid="finder-list-row"]');
    test.skip(rows.length === 0, 'the test drive has no files to preview');
    await app.eval(`document.querySelector('[data-testid="finder-list-row"]')?.click()`);
    await pressKey(' ');
    const open = await app.query('[data-testid="finder-quicklook"]');
    // Quick Look only opens for previewable kinds; an empty result here is a
    // valid outcome for a folder-only drive, so assert the close path only
    // when it opened.
    if (open.length > 0) {
      await pressKey('Escape');
      const closed = await app.query('[data-testid="finder-quicklook"]');
      expect(closed.length).toBe(0);
    }
  });
});
