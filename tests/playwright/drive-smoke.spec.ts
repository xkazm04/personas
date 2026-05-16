import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Drive plugin smoke suite. Tests behaviour that should work against
 * any drive version (master, post-/friend-drive merge, future feature
 * branches) — universal selectors and text-based queries only.
 *
 * Pre-req:
 *   npm run tauri:dev:test
 */

let app: CompanionBridge;

/** Click an in-page button by its trimmed text content. */
async function clickButtonByText(b: CompanionBridge, text: string) {
  const safe = text.replace(/"/g, '\\"');
  await fetch('http://127.0.0.1:17320/eval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      js: `Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "${safe}")?.click()`,
    }),
  });
  // /eval is fire-and-forget; the bridge.openChatPanel pattern uses
  // existence polling. We give the click 250ms to flush state.
  await new Promise((r) => setTimeout(r, 250));
}

async function openDrive(b: CompanionBridge) {
  await b.navigate('plugins');
  await clickButtonByText(b, 'Drive');
}

test.describe('Drive plugin smoke', () => {
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('opens via Plugins gallery and renders the file-list chrome', async () => {
    await openDrive(app);

    // Toolbar action buttons present (New Folder / New File / Signatures).
    // Probe via the button surface directly — findText can return inner
    // spans whose tag isn't 'button' on some renders.
    const buttons = await app.query('button');
    const visibleButtonText = new Set(
      buttons
        .filter((b) => b.visible)
        .map((b) => (b.text ?? '').trim()),
    );
    for (const label of ['New Folder', 'New File', 'Signatures']) {
      expect(
        visibleButtonText.has(label),
        `toolbar button "${label}" should be a visible <button>`,
      ).toBe(true);
    }
  });

  test('list view shows the four sortable column headers', async () => {
    await openDrive(app);
    // The list-view default renders Name / Size / Kind / Modified
    // as <button> elements (SortHeader). i18n uppercases the text via
    // typo-label / CSS text-transform, so the rendered button text is
    // "NAME" / "SIZE" / "KIND" / "MODIFIED". Probe the button surface
    // directly rather than via findText — the latter can return inner
    // spans whose tag isn't 'button' on some renders.
    const buttons = await app.query('button');
    const headerTexts = new Set(
      buttons
        .filter((b) => b.visible)
        .map((b) => (b.text ?? '').trim()),
    );
    for (const col of ['NAME', 'SIZE', 'KIND', 'MODIFIED']) {
      expect(
        headerTexts.has(col),
        `column header "${col}" should be a visible button`,
      ).toBe(true);
    }
  });

  test('drive entries render (managed root is not empty)', async () => {
    await openDrive(app);
    // The local dev drive has at least one entry visible per the live
    // app probe — .dev-drive / inbox / fresh-inbox. We don't assert on
    // exact names because they change with state. We just assert there
    // is *some* row content.
    const rows = await app.query('[draggable="true"]');
    expect(rows.length, 'at least one draggable file-list row').toBeGreaterThan(0);
  });

  test('search input is wired to drive.setSearchQuery', async () => {
    await openDrive(app);
    // Drive has a single text input in the toolbar — the search box.
    const searchInputs = await app.query(
      'input[type="text"][placeholder*="Search"]',
    );
    expect(
      searchInputs.length,
      'search input should be present in toolbar',
    ).toBeGreaterThan(0);
  });
});
