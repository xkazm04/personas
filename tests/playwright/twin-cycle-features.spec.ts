import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * End-to-end smoke against the live `tauri:dev:test` app, asserting the
 * UI surfaces added across the cycles 1-16 `/friend` session over the
 * twin plugin. Probes presence of distinctive text and selectors that
 * uniquely identify the new affordances:
 *
 *   cycle 1   "ReadinessGapPopover" → readiness pill text "% ready"
 *   cycle 2   "WikiFreshnessPill" → text "Wiki:" prefix on the selector
 *   cycle 12  "DistilledFactsPanel" → "Distilled facts" heading in Brain
 *   cycle 14  "ContactsPanel" → "Contacts" section in Knowledge
 *   cycle 15  "ReflectionsPanel" → "Reflections" section in Brain
 *   cycle 16  "RecallPreviewPanel" → "Recall preview" section in Brain
 *
 * Pre-req:
 *   - `npm run tauri:dev:test` already running (port 17320)
 *   - The running app must be serving source that includes worktree-
 *     friend-twin-130914's commits. If the running app is on master
 *     and the worktree hasn't been merged, the new-feature assertions
 *     will fail — that's the intended signal: merging activates these
 *     features. See docs/tests/parallel-cli-workflow.md "dual-checkout
 *     trap" for why frontend changes only reach the running app via
 *     the main checkout's source (or via merge into master).
 */

let app: CompanionBridge;

test.describe('Twin /friend session UI smoke', () => {
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('app responds and sidebar exposes the plugins section', async () => {
    const res = await app.navigate('plugins');
    expect(res).toMatchObject({ success: true });
    const sidebarPlugins = await app.query('[data-testid="sidebar-plugins"]');
    expect(sidebarPlugins.length).toBeGreaterThan(0);
  });

  test('Twin plugin tile is reachable from the plugin browser', async () => {
    await app.navigate('plugins');
    // Browse view renders one card per plugin. The card title is the
    // word "Twin" — we look for the heading rather than a testid because
    // browse cards don't currently expose stable testids.
    const candidates = await app.query('h3.typo-card-label');
    const twinTile = candidates.find((n) => /^Twin$/.test(n.text.trim()));
    expect(twinTile, 'Twin tile heading was not found in plugin browser').toBeDefined();
  });

  test('TwinPage renders after opening the Twin plugin', async () => {
    await app.navigate('plugins');
    // Click the "Twin" plugin card. The card is a button wrapping the h3.
    // Without a stable testid we use a content-based locator via /eval.
    await fetch('http://127.0.0.1:17320/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        js: `(() => {
          const headers = document.querySelectorAll('h3.typo-card-label');
          for (const h of headers) {
            if (h.textContent.trim() === 'Twin') {
              const btn = h.closest('button');
              if (btn) { btn.click(); return true; }
            }
          }
          return false;
        })()`,
      }),
    });
    // Wait for the canonical twin-page testid (TwinPage.tsx:49).
    const deadline = Date.now() + 5_000;
    let found = false;
    while (Date.now() < deadline) {
      const nodes = await app.query('[data-testid="twin-page"]');
      if (nodes.length > 0) { found = true; break; }
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(found, 'TwinPage did not render after clicking Twin tile').toBe(true);
  });

  test('cycle 1: readiness gap pill renders on the TwinSelector banner', async () => {
    // The pill renders only when there is an active twin profile. We
    // probe by visible text "% ready" which is unique to this surface
    // (twin.profiles.readyPercent = "{pct}% ready").
    const nodes = await app.query('button');
    const readinessBtn = nodes.find((n) => /\d+% ready/.test(n.text ?? ''));
    expect(readinessBtn, 'Readiness pill (text "{pct}% ready") not found — needs worktree-friend-twin-130914 merged').toBeDefined();
  });

  test('cycle 2: wiki freshness pill renders next to the readiness pill', async () => {
    // Pill text covers three states: "Wiki: not compiled" / "Wiki: {rel} ago" / "Wiki…".
    // All three include the "Wiki" stem. Probe for the button.
    const nodes = await app.query('button');
    const wikiPill = nodes.find((n) => /Wiki/.test(n.text ?? '') && (n.text ?? '').length < 60);
    expect(wikiPill, 'Wiki freshness pill not found — needs worktree-friend-twin-130914 merged').toBeDefined();
  });

  test('cycle 12: Distilled facts section renders in the Brain sub-tab', async () => {
    // Brain is reached via the dot-strip on the selector banner. Without
    // a stable testid we click the dot via aria-label match on the icon.
    await fetch('http://127.0.0.1:17320/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        js: `(() => {
          const btns = document.querySelectorAll('button[aria-label]');
          for (const b of btns) {
            if (/Brain/i.test(b.getAttribute('aria-label') || '')) { b.click(); return true; }
          }
          return false;
        })()`,
      }),
    });
    const deadline = Date.now() + 5_000;
    let found = false;
    while (Date.now() < deadline) {
      const nodes = await app.query('h2, .typo-section-title');
      if (nodes.some((n) => /Distilled facts/i.test(n.text ?? ''))) { found = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(found, 'DistilledFactsPanel heading not found — needs worktree-friend-twin-130914 merged').toBe(true);
  });

  test('cycle 15-16: Reflections + Recall preview sections render in Brain', async () => {
    // Already on Brain from the prior test.
    const headings = await app.query('h2, .typo-section-title');
    const headingText = headings.map((h) => (h.text ?? '').trim());
    expect(
      headingText.some((t) => /^Reflections$/i.test(t)),
      'ReflectionsPanel heading not found — needs worktree-friend-twin-130914 merged',
    ).toBe(true);
    expect(
      headingText.some((t) => /Recall preview/i.test(t)),
      'RecallPreviewPanel heading not found — needs worktree-friend-twin-130914 merged',
    ).toBe(true);
  });
});
