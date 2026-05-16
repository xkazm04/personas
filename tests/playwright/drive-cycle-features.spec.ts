import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Cycle-feature coverage for the /friend-drive session. These specs
 * assert on behaviour introduced by cycles 1–34. They will FAIL against
 * the master branch (the features don't exist there yet) — that's the
 * point. Run them after merging worktree-friend-drive-130941 to
 * verify everything landed.
 *
 * To run against this branch only, restart `tauri:dev:test` from the
 * worktree:
 *   cd .claude/worktrees/friend-drive-130941
 *   npm run tauri:dev:test
 * then in another terminal:
 *   npm run test:playwright -- drive-cycle-features
 *
 * Pre-req:
 *   the app is running and on the drive plugin
 */

let app: CompanionBridge;

async function clickButtonByText(text: string) {
  const safe = text.replace(/"/g, '\\"');
  // innerText respects CSS text-transform — labels under typo-label are
  // rendered uppercase. Matching textContent (the DOM-source case)
  // would diverge from what the test bridge's `text` field reports.
  await fetch('http://127.0.0.1:17320/eval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      js: `Array.from(document.querySelectorAll("button")).find(b => (b.innerText||"").trim() === "${safe}")?.click()`,
    }),
  });
  await new Promise((r) => setTimeout(r, 300));
}

async function openDrive() {
  await app.navigate('plugins');
  await clickButtonByText('Drive');
  // Drive plugin mounts the sidebar + file list + storage block in
  // parallel; useDrive fires several IPC calls (drive_list,
  // drive_list_tree, drive_storage_info, drive_recent) on mount. The
  // 300ms in clickButtonByText covers React commit but not the IPC
  // round-trips that populate the sidebar's Recent rail. Wait for one
  // such IPC effect to land via a sidebar marker — the Folders tree
  // label or the sidebar root header (both i18n strings the master
  // build always renders).
  for (let i = 0; i < 30; i++) {
    const nodes = await app.query('aside');
    if (nodes.some((n) => /\bFolders\b|Drive root/i.test(n.text ?? ''))) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

test.describe('Cycle 11: Recent rail in the sidebar', () => {
  test.setTimeout(30_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('sidebar shows a "Recent" section header', async () => {
    await openDrive();
    // typo-label uppercases via CSS — bridge `text` field reports the
    // rendered form. The DOM-source label is "Recent" but the user
    // sees "RECENT".
    const hits = await app.findText('Recent');
    const visible = hits.some(
      (n) => n.visible && (n.text ?? '').trim() === 'RECENT',
    );
    expect(visible, 'Recent section header in sidebar').toBe(true);
  });
});

test.describe('Cycle 23: Storage block honest hierarchy', () => {
  test.setTimeout(30_000);

  test.beforeAll(async () => {
    app = bridge();
  });

  test('storage label is uppercase "STORAGE"', async () => {
    await openDrive();
    // After cycle 23, the storage label uses uppercase tracking-wider.
    // The bridge's /find-text matches by DOM textContent (so search for
    // the i18n "Storage" string) but the returned `text` field is the
    // CSS-rendered "STORAGE" — assert on both halves to prove the
    // uppercase CSS shipped, not just that the label exists.
    const hits = await app.findText('Storage');
    const renderedUppercase = hits.some(
      (n) => n.visible && (n.text ?? '').trim() === 'STORAGE',
    );
    expect(
      renderedUppercase,
      'Storage label should render as uppercase after cycle 23',
    ).toBe(true);
  });

  test('storage block does not render a progress bar', async () => {
    await openDrive();
    // The cycle-23 cleanup dropped the log-scale progress bar. Its
    // role="progressbar" element should be absent in the sidebar.
    const bars = await app.query('aside [role="progressbar"]');
    expect(bars.length, 'no progressbar in sidebar after cycle 23').toBe(0);
  });
});

test.describe('Cycle 4: Breadcrumb edit mode (Ctrl+L)', () => {
  test.setTimeout(30_000);

  test.beforeAll(async () => {
    app = bridge();
  });

  test('Ctrl+L swaps breadcrumb for a path input', async () => {
    await openDrive();

    // Trigger Ctrl+L via a synthetic keydown on document. The DrivePage
    // keyboard handler is bound to document.
    await fetch('http://127.0.0.1:17320/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        js: `document.dispatchEvent(new KeyboardEvent("keydown",{key:"l",ctrlKey:true,bubbles:true}))`,
      }),
    });
    await new Promise((r) => setTimeout(r, 250));

    // The path input has a distinctive placeholder ("Type a path…").
    const inputs = await app.query('input[placeholder*="path"]');
    expect(
      inputs.length,
      'path input should appear after Ctrl+L',
    ).toBeGreaterThan(0);
  });
});

test.describe('Cycle 19: Toolbar visual-hierarchy reset', () => {
  test.setTimeout(30_000);

  test.beforeAll(async () => {
    app = bridge();
  });

  test('+New folder no longer renders as a cyan-primary gradient', async () => {
    await openDrive();
    // After cycle 19, +New folder uses the ghost variant — bg-secondary
    // + border-primary/15 — not the primary cyan-gradient. Find the
    // button and check the class signature.
    const buttons = await app.query('button');
    const newFolder = buttons.find(
      (b) => (b.text ?? '').trim() === 'New Folder',
    );
    expect(newFolder, 'New Folder button present').toBeTruthy();
    expect(
      newFolder!.className?.includes('from-cyan-500/25'),
      'New Folder should NOT use primary cyan gradient after cycle 19',
    ).toBe(false);
  });
});

test.describe('Cycle 18: Kind column header muted when grouped', () => {
  test.setTimeout(30_000);

  test.beforeAll(async () => {
    app = bridge();
  });

  test('clicking the Kind column header to group → header text mutes', async () => {
    await openDrive();

    // Default sortKey is "name" — Kind header is in its default state.
    // Click it to switch sortKey to "kind". Cycle 18 mutes the Kind
    // header text to text-cyan-200/45 in this state.
    await clickButtonByText('KIND');

    const buttons = await app.query('button');
    const kindHeader = buttons.find((b) => (b.text ?? '').trim() === 'KIND');
    expect(kindHeader, 'Kind column header present').toBeTruthy();
    expect(
      (kindHeader!.className ?? '').includes('text-cyan-200/45'),
      'Kind column header should mute when grouping is active',
    ).toBe(true);
  });
});
